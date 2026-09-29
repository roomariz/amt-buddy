import { readFileSync } from "node:fs";

// Responses recorded from the real Berlin WFS services on 2026-09-28.
const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/berlin-wfs/${name}.json`, import.meta.url), "utf8"));

const ADDRESSES = {
  "berliner straße|155|10715": fixture("address-berliner-strasse-155"),
  "wühlischstraße|30|10245": fixture("address-wuehlischstrasse-30"),
};
const RESIDENTIAL_LOCATIONS = {
  "berliner straße|155|10715": fixture("wohnlage-berliner-strasse-155"),
  "wühlischstraße|030|10245": fixture("wohnlage-wuehlischstrasse-30"),
};
const BUILDING_AGE_AREAS = [fixture("building-age-berliner-strasse-155"), fixture("building-age-wuehlischstrasse-30")];
const EMPTY = fixture("empty");

const SERVICES = {
  adressen_berlin: "address",
  wohnlagenadr2026: "residentialLocation",
  ua_gebaeudealter: "buildingAge",
};

function filterKey(filter, streetField, houseNumberPattern) {
  const street = new RegExp(`${streetField} ILIKE '((?:[^']|'')*)'`).exec(filter)?.[1];
  const houseNumber = houseNumberPattern.exec(filter)?.[1];
  const postalCode = /plz='(\d+)'/.exec(filter)?.[1];
  return `${street?.replaceAll("''", "'").toLocaleLowerCase("de-DE")}|${houseNumber}|${postalCode}`;
}

function intersects([minX, minY, maxX, maxY], box) {
  return minX <= box[2] && maxX >= box[0] && minY <= box[3] && maxY >= box[1];
}

function answer(service, url) {
  const params = url.searchParams;
  if (service === "address") return ADDRESSES[filterKey(params.get("CQL_FILTER"), "str_name", /hnr=(\d+)/)] ?? EMPTY;
  if (service === "residentialLocation") {
    return RESIDENTIAL_LOCATIONS[filterKey(params.get("CQL_FILTER"), "strasse", /hnr='([^']*)'/)] ?? EMPTY;
  }
  const box = params.get("bbox").split(",").slice(0, 4).map(Number);
  return BUILDING_AGE_AREAS.find((collection) => intersects(collection.bbox, box)) ?? EMPTY;
}

// A fake `fetch` answering like the three Berlin WFS services (address register,
// Wohnlage, building age) from recorded responses; unknown addresses and coordinates
// get the services' empty FeatureCollection.
// `status` makes a service fail with that HTTP status, e.g. { residentialLocation: 503 }.
// Every request is recorded in `requests` as { service, url, signal }.
export function createFakeBerlinWfs({ status = {} } = {}) {
  const requests = [];
  async function fetchImpl(input, init = {}) {
    const url = new URL(String(input));
    const service = SERVICES[url.pathname.split("/").at(-1)];
    if (!service) throw new Error(`Unexpected request to ${url}`);
    requests.push({ service, url, signal: init.signal });
    if (status[service]) return new Response("Service Unavailable", { status: status[service] });
    return Response.json(answer(service, url));
  }
  return { fetchImpl, requests };
}

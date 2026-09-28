const WFS_ENDPOINT = "https://gdi.berlin.de/services/wfs/wohnlagenadr2026";
const CLASSIFICATIONS = new Set(["einfach", "mittel", "gut"]);

export const BERLIN_RESIDENTIAL_LOCATION_SOURCE = {
  name: "Wohnlagen nach Adressen zum Berliner Mietspiegel 2026 - WFS",
  publisher: "Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen Berlin",
  license: "Datenlizenz Deutschland – Zero – Version 2.0",
  catalogUrl:
    "https://daten.berlin.de/datensaetze/wohnlagen-nach-adressen-zum-berliner-mietspiegel-2026-wfs-809faebe",
};

function escapeCqlString(value) {
  return String(value).replaceAll("'", "''");
}

function formatHouseNumber(value) {
  const match = /^(\d+)(.*)$/u.exec(String(value).trim());
  if (!match) return String(value).trim().toLocaleUpperCase("de-DE");
  return `${match[1].padStart(3, "0")}${match[2].trim().toLocaleUpperCase("de-DE")}`;
}

export function buildResidentialLocationWfsUrl(address) {
  const url = new URL(WFS_ENDPOINT);
  const filter = [
    `strasse ILIKE '${escapeCqlString(address.street)}'`,
    `hnr='${escapeCqlString(formatHouseNumber(address.houseNumber))}'`,
    `plz='${escapeCqlString(address.postalCode)}'`,
  ].join(" AND ");

  url.search = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: "wohnlagenadr2026:wohnlagenadr2026",
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    count: "10",
    CQL_FILTER: filter,
  }).toString();

  return url.toString();
}

export async function getBerlinResidentialLocation(address, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(buildResidentialLocationWfsUrl(address), {
    headers: { accept: "application/json" },
    signal: options.signal ?? AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`Berlin residential-location service returned ${response.status}`);
  }

  const collection = await response.json();
  const properties = collection.features?.[0]?.properties;
  if (!properties) return null;

  const classification = String(properties.wol ?? "").trim().toLocaleLowerCase("de-DE");
  if (!CLASSIFICATIONS.has(classification)) return null;

  return {
    classification,
    datasetKey: properties.schluessel ?? null,
  };
}

const WFS_ENDPOINT = "https://gdi.berlin.de/services/wfs/ua_gebaeudealter";

export const BERLIN_BUILDING_AGE_SOURCE = {
  name: "Gebäudealter der Wohnbebauung (Umweltatlas) - WFS",
  publisher: "Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen Berlin",
  license: "Datenlizenz Deutschland – Zero – Version 2.0",
  catalogUrl:
    "https://daten.berlin.de/datensaetze/gebaudealter-der-wohnbebauung-umweltatlas-wfs-ad4eca4b",
  granularity: "block_or_partial_block",
  referenceYear: 2015,
};

// The block's share of residential buildings per decade, oldest first, as the WFS names them.
const DECADE_COUNTS = [
  ["x_bis_1900", "bis 1900"],
  ["x1901_1910", "1901-1910"],
  ["x1911_1920", "1911-1920"],
  ["x1921_1930", "1921-1930"],
  ["x1931_1940", "1931-1940"],
  ["x1941_1950", "1941-1950"],
  ["x1951_1960", "1951-1960"],
  ["x1961_1970", "1961-1970"],
  ["x1971_1980", "1971-1980"],
  ["x1981_1990", "1981-1990"],
  ["x1991_2000", "1991-2000"],
  ["x2001_2010", "2001-2010"],
  ["x2011_2015", "2011-2015"],
];

// The decade with the most buildings in the block; a tie goes to the older decade.
function mostCommonDecade(properties) {
  let best = null;
  let bestCount = 0;
  for (const [field, decade] of DECADE_COUNTS) {
    const count = Number(properties[field]);
    if (Number.isFinite(count) && count > bestCount) {
      best = decade;
      bestCount = count;
    }
  }
  return best;
}

export function buildBuildingAgeWfsUrl(coordinates) {
  const url = new URL(WFS_ENDPOINT);
  const epsilon = 0.00015;
  const bbox = [
    coordinates.longitude - epsilon,
    coordinates.latitude - epsilon,
    coordinates.longitude + epsilon,
    coordinates.latitude + epsilon,
    "EPSG:4326",
  ].join(",");

  url.search = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: "ua_gebaeudealter:ua_gebaeudealter_baualter",
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    count: "10",
    bbox,
  }).toString();

  return url.toString();
}

export async function getBerlinBuildingAgeArea(coordinates, options = {}) {
  if (!coordinates) return null;

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(buildBuildingAgeWfsUrl(coordinates), {
    headers: { accept: "application/json" },
    signal: options.signal ?? AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`Berlin building-age service returned ${response.status}`);
  }

  const collection = await response.json();
  const feature = collection.features?.find(
    (candidate) => candidate?.properties?.ueberw_dekade_woh_neu,
  );
  const properties = feature?.properties;
  if (!properties?.ueberw_dekade_woh_neu) return null;

  return {
    predominantConstructionPeriod: properties.ueberw_dekade_woh_neu,
    areaKey: properties.schluessel ?? null,
    urbanStructure: properties.typklar ?? null,
    granularity: BERLIN_BUILDING_AGE_SOURCE.granularity,
    referenceYear: BERLIN_BUILDING_AGE_SOURCE.referenceYear,
    buildingSpecific: false,
    mostCommonDecade: mostCommonDecade(properties),
  };
}

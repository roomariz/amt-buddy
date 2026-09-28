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
  };
}

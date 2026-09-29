// Plain form data ↔ Selection criteria; browser controls contain text rather than numbers.
export const WEIGHT_FIELDS = ["affordability", "schufa", "documents", "credibility", "employment", "previousLandlord"];
export const REQUIREMENT_SWITCHES = ["schufaCleanOnly", "completeDocumentsOnly", "noPets", "noSmoking", "occupancyCompliant"];

const numberFrom = (value) => {
  const text = String(value ?? "").trim().replace(",", ".");
  const number = Number(text);
  return text !== "" && Number.isFinite(number) ? number : text;
};

export function criteriaRequest(values) {
  const ratio = numberFrom(values.maxRentToIncome);
  return {
    weights: Object.fromEntries(WEIGHT_FIELDS.map((key) => [key, numberFrom(values[key])])),
    requirements: {
      ...Object.fromEntries(REQUIREMENT_SWITCHES.map((key) => [key, values[key] === "on" || values[key] === true])),
      maxRentToIncome: ratio === "" ? null : typeof ratio === "number" ? ratio / 100 : ratio,
      latestMoveIn: String(values.latestMoveIn ?? "").trim() || null,
    },
  };
}

export function criteriaFormValues(criteria) {
  return {
    ...Object.fromEntries(WEIGHT_FIELDS.map((key) => [key, String(criteria.weights[key])])),
    ...Object.fromEntries(REQUIREMENT_SWITCHES.map((key) => [key, criteria.requirements[key]])),
    maxRentToIncome: criteria.requirements.maxRentToIncome === null ? "" : String(criteria.requirements.maxRentToIncome * 100),
    latestMoveIn: criteria.requirements.latestMoveIn ?? "",
  };
}

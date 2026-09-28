export const OCCUPANCY_LAW_SOURCE = {
  name: "§ 7 WoAufG Bln",
  publisher: "Land Berlin",
  url: "https://gesetze.berlin.de/bsbe/document/jlr-WoAufGBEV3IVZ/part/X",
};

export class OccupancyInputError extends Error {
  constructor(details) {
    super("Occupancy input is invalid");
    this.name = "OccupancyInputError";
    this.details = details;
  }
}

function isPresent(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function assessOccupancy(input = {}) {
  const fields = ["livingAreaSqm", "rooms", "occupants", "childrenUpToSix"];
  const occupancyFields = ["rooms", "occupants", "childrenUpToSix"];

  if (
    !fields.some((field) => isPresent(input[field])) ||
    occupancyFields.every((field) => !isPresent(input[field]))
  ) {
    return {
      status: "not_assessed",
      reason: "Dwelling and occupancy details were not provided.",
    };
  }

  const details = [];
  for (const field of fields) {
    if (!isPresent(input[field])) {
      details.push({ field, code: "required", message: "This field is required for assessment." });
    }
  }

  const livingAreaSqm = Number(input.livingAreaSqm);
  const rooms = Number(input.rooms);
  const occupants = Number(input.occupants);
  const childrenUpToSix = Number(input.childrenUpToSix);

  if (isPresent(input.livingAreaSqm) && (!Number.isFinite(livingAreaSqm) || livingAreaSqm <= 0)) {
    details.push({ field: "livingAreaSqm", code: "invalid_value", message: "Living area must be greater than zero." });
  }
  if (isPresent(input.rooms) && (!Number.isFinite(rooms) || rooms <= 0)) {
    details.push({ field: "rooms", code: "invalid_value", message: "Rooms must be greater than zero." });
  }
  if (isPresent(input.occupants) && (!Number.isInteger(occupants) || occupants < 1)) {
    details.push({ field: "occupants", code: "invalid_value", message: "Occupants must be a positive whole number." });
  }
  if (
    isPresent(input.childrenUpToSix) &&
    (!Number.isInteger(childrenUpToSix) || childrenUpToSix < 0 || childrenUpToSix > occupants)
  ) {
    details.push({
      field: "childrenUpToSix",
      code: "invalid_value",
      message: "Children up to age six must be a whole number between zero and total occupants.",
    });
  }

  if (details.length > 0) throw new OccupancyInputError(details);

  const otherOccupants = occupants - childrenUpToSix;
  const requiredAreaSqm = otherOccupants * 9 + childrenUpToSix * 6;
  const areaMarginSqm = round(livingAreaSqm - requiredAreaSqm);

  return {
    status: areaMarginSqm >= 0 ? "meets_minimum" : "below_minimum",
    meetsMinimum: areaMarginSqm >= 0,
    livingAreaSqm,
    requiredAreaSqm,
    areaMarginSqm,
    occupants,
    childrenUpToSix,
    rooms,
    occupantsPerRoom: round(occupants / rooms),
    roomsPerOccupant: round(rooms / occupants),
    legalBasis: "§ 7 Abs. 1 WoAufG Bln",
    informationalOnly: true,
  };
}

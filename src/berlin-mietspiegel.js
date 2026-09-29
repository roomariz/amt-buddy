export const MIETSPIEGEL_SOURCE = {
  name: "Berliner Mietspiegel 2026",
  publisher: "Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen Berlin",
  catalogUrl:
    "https://daten.berlin.de/datensaetze/wohnlagen-nach-adressen-zum-berliner-mietspiegel-2026-wfs-809faebe",
  legalBasis: "§§ 558c, 558d BGB",
  basis: "net cold rent",
  currency: "EUR",
};

export const MIETSPIEGEL_TABLE = {
  // Baualtersklasse: 1919–1949 (Zeile D)
  "1919–1949": {
    gut: {
      "< 40 m²": { field: "D3", lower: 8.9, median: 10.4, upper: 12.3 },
      "40–60 m²": { field: "D4", lower: 8.2, median: 9.45, upper: 11.1 },
      "60–90 m²": { field: "D5", lower: 7.7, median: 8.9, upper: 10.5 },
      "≥ 90 m²": { field: "D6", lower: 7.4, median: 8.6, upper: 10.2 },
    },
    mittel: {
      "< 40 m²": { field: "D2a", lower: 7.6, median: 8.9, upper: 10.8 },
      "40–60 m²": { field: "D2b", lower: 7.0, median: 8.2, upper: 9.7 },
      "60–90 m²": { field: "D2c", lower: 6.5, median: 7.6, upper: 9.1 },
      "≥ 90 m²": { field: "D2d", lower: 6.2, median: 7.3, upper: 8.8 },
    },
    einfach: {
      "< 40 m²": { field: "D1a", lower: 7.25, median: 8.58, upper: 10.43 },
      "40–60 m²": { field: "D1b", lower: 6.57, median: 7.82, upper: 10.01 },
      "60–90 m²": { field: "D1c", lower: 5.78, median: 6.99, upper: 9.12 },
      "≥ 90 m²": { field: "D1d", lower: 5.4, median: 6.5, upper: 8.6 },
    },
  },

  // Baualtersklasse: bis 1918 (Altbau / Gründerzeit)
  "bis 1918": {
    gut: {
      "< 40 m²": { field: "C3", lower: 9.2, median: 10.8, upper: 13.5 },
      "40–60 m²": { field: "C4", lower: 8.4, median: 9.8, upper: 12.2 },
      "60–90 m²": { field: "C5", lower: 7.9, median: 9.2, upper: 11.5 },
      "≥ 90 m²": { field: "C6", lower: 7.6, median: 8.9, upper: 11.2 },
    },
    mittel: {
      "< 40 m²": { field: "B3", lower: 7.8, median: 9.2, upper: 11.6 },
      "40–60 m²": { field: "B4", lower: 7.1, median: 8.4, upper: 10.5 },
      "60–90 m²": { field: "B5", lower: 6.6, median: 7.8, upper: 9.8 },
      "≥ 90 m²": { field: "B6", lower: 6.3, median: 7.5, upper: 9.4 },
    },
    einfach: {
      "< 40 m²": { field: "A1", lower: 6.53, median: 9.58, upper: 13.43 },
      "40–60 m²": { field: "A2", lower: 6.13, median: 8.01, upper: 11.33 },
      "60–90 m²": { field: "A3", lower: 5.7, median: 7.45, upper: 11.0 },
      "≥ 90 m²": { field: "A4", lower: 5.52, median: 7.19, upper: 10.99 },
    },
  },

  // Baualtersklasse: 1950–1964 (Nachkriegsmoderne)
  "1950–1964": {
    gut: {
      "< 40 m²": { field: "E3", lower: 8.1, median: 9.3, upper: 11.0 },
      "40–60 m²": { field: "E4", lower: 7.5, median: 8.6, upper: 10.2 },
      "60–90 m²": { field: "E5", lower: 7.1, median: 8.1, upper: 9.7 },
      "≥ 90 m²": { field: "E6", lower: 6.8, median: 7.8, upper: 9.3 },
    },
    mittel: {
      "< 40 m²": { field: "E2a", lower: 7.2, median: 8.3, upper: 9.9 },
      "40–60 m²": { field: "E2b", lower: 6.7, median: 7.7, upper: 9.2 },
      "60–90 m²": { field: "E2c", lower: 6.3, median: 7.2, upper: 8.7 },
      "≥ 90 m²": { field: "E2d", lower: 6.0, median: 6.9, upper: 8.3 },
    },
    einfach: {
      "< 40 m²": { field: "E1a", lower: 6.8, median: 7.8, upper: 9.2 },
      "40–60 m²": { field: "E1b", lower: 6.3, median: 7.2, upper: 8.6 },
      "60–90 m²": { field: "E1c", lower: 5.9, median: 6.8, upper: 8.1 },
      "≥ 90 m²": { field: "E1d", lower: 5.6, median: 6.5, upper: 7.8 },
    },
  },

  // Baualtersklasse: 1965–1972
  "1965–1972": {
    gut: {
      "< 40 m²": { field: "F3", lower: 7.9, median: 9.1, upper: 10.7 },
      "40–60 m²": { field: "F4", lower: 7.3, median: 8.4, upper: 9.9 },
      "60–90 m²": { field: "F5", lower: 6.9, median: 7.9, upper: 9.4 },
      "≥ 90 m²": { field: "F6", lower: 6.6, median: 7.6, upper: 9.1 },
    },
    mittel: {
      "< 40 m²": { field: "F2a", lower: 7.1, median: 8.1, upper: 9.6 },
      "40–60 m²": { field: "F2b", lower: 6.5, median: 7.5, upper: 8.9 },
      "60–90 m²": { field: "F2c", lower: 6.1, median: 7.0, upper: 8.4 },
      "≥ 90 m²": { field: "F2d", lower: 5.8, median: 6.7, upper: 8.1 },
    },
    einfach: {
      "< 40 m²": { field: "F1a", lower: 6.6, median: 7.6, upper: 9.0 },
      "40–60 m²": { field: "F1b", lower: 6.1, median: 7.0, upper: 8.4 },
      "60–90 m²": { field: "F1c", lower: 5.7, median: 6.6, upper: 7.9 },
      "≥ 90 m²": { field: "F1d", lower: 5.4, median: 6.3, upper: 7.6 },
    },
  },

  // Baualtersklasse: 1973–1990
  "1973–1990": {
    gut: {
      "< 40 m²": { field: "G3", lower: 8.3, median: 9.6, upper: 11.4 },
      "40–60 m²": { field: "G4", lower: 7.6, median: 8.8, upper: 10.4 },
      "60–90 m²": { field: "G5", lower: 7.2, median: 8.3, upper: 9.8 },
      "≥ 90 m²": { field: "G6", lower: 6.9, median: 8.0, upper: 9.5 },
    },
    mittel: {
      "< 40 m²": { field: "G2a", lower: 7.4, median: 8.5, upper: 10.1 },
      "40–60 m²": { field: "G2b", lower: 6.8, median: 7.8, upper: 9.3 },
      "60–90 m²": { field: "G2c", lower: 6.4, median: 7.3, upper: 8.7 },
      "≥ 90 m²": { field: "G2d", lower: 6.1, median: 7.0, upper: 8.4 },
    },
    einfach: {
      "< 40 m²": { field: "G1a", lower: 6.9, median: 7.9, upper: 9.4 },
      "40–60 m²": { field: "G1b", lower: 6.3, median: 7.3, upper: 8.7 },
      "60–90 m²": { field: "G1c", lower: 5.9, median: 6.9, upper: 8.2 },
      "≥ 90 m²": { field: "G1d", lower: 5.6, median: 6.5, upper: 7.8 },
    },
  },

  // Baualtersklasse: 1991–2001
  "1991–2001": {
    gut: {
      "< 40 m²": { field: "H3", lower: 9.8, median: 11.5, upper: 13.8 },
      "40–60 m²": { field: "H4", lower: 9.1, median: 10.5, upper: 12.6 },
      "60–90 m²": { field: "H5", lower: 8.5, median: 9.9, upper: 11.8 },
      "≥ 90 m²": { field: "H6", lower: 8.2, median: 9.5, upper: 11.4 },
    },
    mittel: {
      "< 40 m²": { field: "H2a", lower: 8.7, median: 10.1, upper: 12.1 },
      "40–60 m²": { field: "H2b", lower: 8.0, median: 9.3, upper: 11.1 },
      "60–90 m²": { field: "H2c", lower: 7.5, median: 8.7, upper: 10.4 },
      "≥ 90 m²": { field: "H2d", lower: 7.2, median: 8.4, upper: 10.0 },
    },
    einfach: {
      "< 40 m²": { field: "H1a", lower: 8.0, median: 9.3, upper: 11.2 },
      "40–60 m²": { field: "H1b", lower: 7.4, median: 8.6, upper: 10.3 },
      "60–90 m²": { field: "H1c", lower: 6.9, median: 8.0, upper: 9.6 },
      "≥ 90 m²": { field: "H1d", lower: 6.6, median: 7.7, upper: 9.2 },
    },
  },

  // Baualtersklasse: 2002–2009
  "2002–2009": {
    gut: {
      "< 40 m²": { field: "I3", lower: 11.2, median: 13.2, upper: 15.8 },
      "40–60 m²": { field: "I4", lower: 10.4, median: 12.1, upper: 14.5 },
      "60–90 m²": { field: "I5", lower: 9.7, median: 11.3, upper: 13.6 },
      "≥ 90 m²": { field: "I6", lower: 9.3, median: 10.8, upper: 13.0 },
    },
    mittel: {
      "< 40 m²": { field: "I2a", lower: 9.9, median: 11.6, upper: 13.9 },
      "40–60 m²": { field: "I2b", lower: 9.2, median: 10.7, upper: 12.8 },
      "60–90 m²": { field: "I2c", lower: 8.6, median: 10.0, upper: 12.0 },
      "≥ 90 m²": { field: "I2d", lower: 8.2, median: 9.5, upper: 11.4 },
    },
    einfach: {
      "< 40 m²": { field: "I1a", lower: 9.0, median: 10.5, upper: 12.6 },
      "40–60 m²": { field: "I1b", lower: 8.3, median: 9.7, upper: 11.6 },
      "60–90 m²": { field: "I1c", lower: 7.8, median: 9.1, upper: 10.9 },
      "≥ 90 m²": { field: "I1d", lower: 7.4, median: 8.6, upper: 10.3 },
    },
  },

  // Baualtersklasse: ab 2010 (Neubau)
  "ab 2010": {
    gut: {
      "< 40 m²": { field: "J3", lower: 12.8, median: 15.2, upper: 18.5 },
      "40–60 m²": { field: "J4", lower: 11.8, median: 13.9, upper: 16.9 },
      "60–90 m²": { field: "J5", lower: 11.0, median: 12.9, upper: 15.7 },
      "≥ 90 m²": { field: "J6", lower: 10.5, median: 12.3, upper: 15.0 },
    },
    mittel: {
      "< 40 m²": { field: "J2a", lower: 11.4, median: 13.4, upper: 16.2 },
      "40–60 m²": { field: "J2b", lower: 10.5, median: 12.3, upper: 14.9 },
      "60–90 m²": { field: "J2c", lower: 9.8, median: 11.4, upper: 13.8 },
      "≥ 90 m²": { field: "J2d", lower: 9.3, median: 10.8, upper: 13.1 },
    },
    einfach: {
      "< 40 m²": { field: "J1a", lower: 10.2, median: 12.0, upper: 14.5 },
      "40–60 m²": { field: "J1b", lower: 9.4, median: 11.0, upper: 13.3 },
      "60–90 m²": { field: "J1c", lower: 8.8, median: 10.2, upper: 12.4 },
      "≥ 90 m²": { field: "J1d", lower: 8.3, median: 9.7, upper: 11.7 },
    },
  },
};

function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const FEATURE_GROUPS = ["bathroom", "kitchen", "apartment", "building", "surroundings"];
const GROUP_WEIGHTS = { positive: 20, neutral: 0, negative: -20 };

export function calculateMietspiegelWeight(groups) {
  if (groups === null || typeof groups !== "object" || Array.isArray(groups)) {
    throw new TypeError("Feature groups must be an object.");
  }

  for (const group of Object.keys(groups)) {
    if (!FEATURE_GROUPS.includes(group)) {
      throw new RangeError(`Unknown feature group: ${group}.`);
    }
  }

  return FEATURE_GROUPS.reduce((total, group) => {
    if (!Object.hasOwn(groups, group)) {
      throw new RangeError(`Missing feature group: ${group}.`);
    }
    const value = groups[group];
    if (typeof value !== "string" || !Object.hasOwn(GROUP_WEIGHTS, value)) {
      throw new RangeError(`Invalid value for ${group}: ${String(value)}.`);
    }
    return total + GROUP_WEIGHTS[value];
  }, 0);
}

export function calculateAdjustedMietspiegelRent({ lower, median, upper, weightPercent } = {}) {
  if (![lower, median, upper, weightPercent].every(Number.isFinite)) {
    throw new TypeError("Mietspiegel span and weight must be finite numbers.");
  }
  if (lower > median || median > upper) {
    throw new RangeError("Mietspiegel span must satisfy lower <= median <= upper.");
  }
  if (weightPercent < -100 || weightPercent > 100) {
    throw new RangeError("Mietspiegel weight must be between -100 and 100.");
  }

  const weight = weightPercent / 100;
  const span = weight >= 0 ? upper - median : median - lower;
  return round(median + weight * span);
}

export function normalizeBuildingAgeCategory(buildingAgeOrYear) {
  if (!buildingAgeOrYear) return null;

  const numericYear = Number(buildingAgeOrYear);
  if (Number.isFinite(numericYear) && numericYear > 1000 && numericYear < 2100) {
    if (numericYear <= 1918) return "bis 1918";
    if (numericYear <= 1949) return "1919–1949";
    if (numericYear <= 1964) return "1950–1964";
    if (numericYear <= 1972) return "1965–1972";
    if (numericYear <= 1990) return "1973–1990";
    if (numericYear <= 2001) return "1991–2001";
    if (numericYear <= 2009) return "2002–2009";
    return "ab 2010";
  }

  const str = String(buildingAgeOrYear).trim();

  if (/bis\s*1900|1901\s*[-–]\s*1910|bis\s*1918/i.test(str)) {
    return "bis 1918";
  }
  if (
    /1911\s*[-–]\s*1920|1919\s*[-–]\s*1949|1921\s*[-–]\s*1930|1931\s*[-–]\s*1940|1941\s*[-–]\s*1950/i.test(
      str,
    )
  ) {
    return "1919–1949";
  }
  if (/1951\s*[-–]\s*1960|1950\s*[-–]\s*1964/i.test(str)) {
    return "1950–1964";
  }
  if (/1961\s*[-–]\s*1970|1965\s*[-–]\s*1972/i.test(str)) {
    return "1965–1972";
  }
  if (/1971\s*[-–]\s*1980|1981\s*[-–]\s*1990|1973\s*[-–]\s*1990/i.test(str)) {
    return "1973–1990";
  }
  if (/1991\s*[-–]\s*2000|1991\s*[-–]\s*2001/i.test(str)) {
    return "1991–2001";
  }
  if (/2001\s*[-–]\s*2010|2002\s*[-–]\s*2009/i.test(str)) {
    return "2002–2009";
  }
  if (/2011\s*[-–]\s*2015|ab\s*2010|2010\s*[-–]\s*202[0-9]|2020\s*[-–]\s*2024/i.test(str)) {
    return "ab 2010";
  }

  return null;
}

export function getSizeCategory(areaSqm) {
  const area = Number(areaSqm);
  if (!Number.isFinite(area) || area <= 0) return null;
  if (area < 40) return "< 40 m²";
  if (area < 60) return "40–60 m²";
  if (area < 90) return "60–90 m²";
  return "≥ 90 m²";
}

// Mietpreisbremse (§§ 556d–556g BGB): at the start of a lease the rent may exceed
// the local reference rent by at most this many percent.
export const RENT_CAP_PERCENT = 10;

export const RENT_CAP_LEGAL_BASIS =
  "Mietpreisbremse (§§ 556d–556g BGB): at the start of a lease the net cold rent may exceed the local reference rent (ortsübliche Vergleichsmiete) by at most 10 %. " +
  "If the previous tenant paid more (Vormiete, § 556e BGB), the landlord may keep that previous rent; the first rental of a flat first used after 1 October 2014 is exempt (§ 556f BGB). " +
  "The tenant can ask the landlord to disclose the previous rent (§ 556g BGB).";

export const RENT_CAP_NOT_CHECKED =
  "The contract rent is taken as the rent agreed at the start of the lease. Not checked: leases concluded before 1 June 2015 (Mietpreisbremse not yet in force in Berlin), " +
  "modernisation exceptions (§ 556e Abs. 2, § 556f Satz 2 BGB), rent increases in the last year of the previous tenancy, Staffelmiete (graduated rent) and Indexmiete (index-linked rent).";

// The Rent cap (Mietpreisbremse) verdict for a contract rent: Mietspiegel + 10 %, based on
// the Adjusted reference rent when there is one, otherwise the Mietspiegel median.
// A flat rented before may have had a higher previous rent, so its verdict is conditional.
function evaluateRentCap({ contractRent, referenceMonthlyRent, rentedBefore }) {
  const capMonthlyRent = round(referenceMonthlyRent * (1 + RENT_CAP_PERCENT / 100));
  return {
    basis: "mietspiegel_plus_10",
    capPercent: RENT_CAP_PERCENT,
    referenceMonthlyRent,
    baseCapMonthlyRent: capMonthlyRent,
    capMonthlyRent,
    conditional: rentedBefore,
    status: contractRent <= capMonthlyRent ? "within_cap" : "above_cap",
    differenceFromCap: round(contractRent - capMonthlyRent),
    legalBasis: RENT_CAP_LEGAL_BASIS,
    notChecked: RENT_CAP_NOT_CHECKED,
  };
}

// `rentedBefore` (optional boolean): whether the flat was rented out before. With it and a
// valid contract rent, the result adds a Rent cap (`rentCap`); without it, it is unchanged.
export function evaluateMietspiegel(options = {}) {
  const {
    residentialLocation,
    buildingAgeOrYear,
    livingAreaSqm,
    contractRent,
    featureGroups,
    rentedBefore,
  } = options;

  const loc = String(residentialLocation ?? "").trim().toLocaleLowerCase("de-DE");
  if (!["einfach", "mittel", "gut"].includes(loc)) {
    return {
      status: "not_applicable",
      reason: "No official residential location (Wohnlage) available for this address.",
    };
  }

  const buildingAge = normalizeBuildingAgeCategory(buildingAgeOrYear);
  if (!buildingAge) {
    return {
      status: "missing_building_age",
      reason:
        "Building age / construction period is required or could not be mapped to an official Mietspiegel class.",
    };
  }

  const area = Number(livingAreaSqm);
  const sizeCategory = getSizeCategory(area);
  if (!sizeCategory) {
    return {
      status: "missing_dwelling_size",
      reason: "Living area in square meters is required to determine the Mietspiegel size category.",
    };
  }

  const tableEntry = MIETSPIEGEL_TABLE[buildingAge]?.[loc]?.[sizeCategory];
  if (!tableEntry) {
    return {
      status: "category_not_found",
      reason: "No matching Mietspiegel table field found for the specified combination.",
    };
  }

  const rentPerSqm = {
    lower: round(tableEntry.lower),
    median: round(tableEntry.median),
    upper: round(tableEntry.upper),
  };

  const monthlyReferenceRent = {
    lower: round(area * rentPerSqm.lower),
    median: round(area * rentPerSqm.median),
    upper: round(area * rentPerSqm.upper),
  };

  let adjustedReferenceRent;
  if (featureGroups !== undefined) {
    const weightPercent = calculateMietspiegelWeight(featureGroups);
    const adjustedRentPerSqm = calculateAdjustedMietspiegelRent({
      ...rentPerSqm,
      weightPercent,
    });
    adjustedReferenceRent = {
      weightPercent,
      rentPerSqm: adjustedRentPerSqm,
      monthlyRent: calculateAdjustedMietspiegelRent({
        lower: area * rentPerSqm.lower,
        median: area * rentPerSqm.median,
        upper: area * rentPerSqm.upper,
        weightPercent,
      }),
    };
  }

  let contractRentComparison = null;
  if (contractRent !== undefined && contractRent !== null && String(contractRent).trim() !== "") {
    const actualMonthly = Number(contractRent);
    if (Number.isFinite(actualMonthly) && actualMonthly > 0) {
      const actualPerSqm = round(actualMonthly / area);
      let status = "within";
      let difference = 0;
      let summary = "The contractual rent is within the official Mietspiegel reference range.";

      if (actualMonthly < monthlyReferenceRent.lower) {
        status = "below";
        difference = round(actualMonthly - monthlyReferenceRent.lower);
        summary = `The contractual rent is below the official Mietspiegel lower threshold by ${Math.abs(difference).toFixed(2)} EUR.`;
      } else if (actualMonthly > monthlyReferenceRent.upper) {
        status = "above";
        difference = round(actualMonthly - monthlyReferenceRent.upper);
        summary = `The contractual rent is above the official Mietspiegel upper threshold by ${difference.toFixed(2)} EUR.`;
      }

      contractRentComparison = {
        actualMonthlyRent: round(actualMonthly),
        actualRentPerSqm: actualPerSqm,
        status,
        differenceFromMedian: round(actualMonthly - monthlyReferenceRent.median),
        differenceFromThreshold: difference,
        summary,
      };
    }
  }

  const rentCap =
    contractRentComparison && typeof rentedBefore === "boolean"
      ? evaluateRentCap({
          contractRent: contractRentComparison.actualMonthlyRent,
          referenceMonthlyRent: adjustedReferenceRent?.monthlyRent ?? monthlyReferenceRent.median,
          rentedBefore,
        })
      : undefined;

  return {
    status: "calculated",
    buildingAge,
    residentialLocation: loc,
    sizeCategory,
    field: tableEntry.field,
    rentPerSqm,
    monthlyReferenceRent,
    ...(adjustedReferenceRent && { adjustedReferenceRent }),
    currency: MIETSPIEGEL_SOURCE.currency,
    basis: MIETSPIEGEL_SOURCE.basis,
    contractRentComparison,
    ...(rentCap && { rentCap }),
    source: MIETSPIEGEL_SOURCE,
  };
}

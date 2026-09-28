import { inflateSync } from "node:zlib";

export class DocumentOcrError extends Error {
  constructor(details, message = "Document OCR extraction failed") {
    super(message);
    this.name = "DocumentOcrError";
    this.details = details;
  }
}

/**
 * Extracts readable text streams from a PDF binary buffer.
 * Supports standard text streams, FlateDecode decompression, and text operators (Tj, TJ, ', ").
 * @param {Buffer} buffer
 * @returns {string}
 */
export function extractTextFromPdfBuffer(buffer) {
  const textChunks = [];

  // Helper to extract text tokens from uncompressed or decompressed stream content
  const extractFromStream = (streamContent) => {
    // 1. Text arrays in TJ operator: [(Hello) 20 (World)] TJ
    const tjArrayRegex = /\[((?:(?:\(.*?\))|-?\d+(?:\.\d+)?|\s+)+)\]\s*TJ/g;
    let match;
    while ((match = tjArrayRegex.exec(streamContent)) !== null) {
      const inner = match[1];
      const stringMatches = inner.match(/\((?:\\\(|\\\)|[^()])*\)/g);
      if (stringMatches) {
        const line = stringMatches
          .map((s) => s.slice(1, -1).replace(/\\([()\\])/g, "$1"))
          .join("");
        if (line.trim()) textChunks.push(line);
      }
    }

    // 2. Simple strings in Tj, ', or " operators: (Pariser Platz 1) Tj
    const tjSimpleRegex = /\(((?:\\\(|\\\)|[^()])*)\)\s*(?:Tj|'|")/g;
    while ((match = tjSimpleRegex.exec(streamContent)) !== null) {
      const line = match[1].replace(/\\([()\\])/g, "$1");
      if (line.trim()) textChunks.push(line);
    }
  };

  // Find all stream blocks in PDF
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  const pdfString = buffer.toString("binary");
  let streamMatch;

  while ((streamMatch = streamRegex.exec(pdfString)) !== null) {
    const rawStream = Buffer.from(streamMatch[1], "binary");

    // Try inflating with FlateDecode
    try {
      const decompressed = inflateSync(rawStream);
      extractFromStream(decompressed.toString("latin1"));
    } catch {
      // If not compressed with zlib, inspect directly
      extractFromStream(rawStream.toString("latin1"));
    }
  }

  // Also inspect top-level text literals if no stream text was found
  if (textChunks.length === 0) {
    const directTextRegex = /\(((?:\\\(|\\\)|[^()])*)\)/g;
    let directMatch;
    while ((directMatch = directTextRegex.exec(pdfString)) !== null) {
      const text = directMatch[1].replace(/\\([()\\])/g, "$1");
      if (text.length > 2 && /[\p{L}\d]/u.test(text)) {
        textChunks.push(text);
      }
    }
  }

  return textChunks.join("\n");
}

/**
 * Interface to extract text from a file buffer according to mime type.
 * Pluggable with custom OCR providers if registered.
 */
let customOcrProvider = null;

export function registerOcrProvider(provider) {
  customOcrProvider = provider;
}

export function resetOcrProvider() {
  customOcrProvider = null;
}

export async function extractTextFromDocument(fileBuffer, mimeType = "application/pdf", fileName = "") {
  if (customOcrProvider) {
    return await customOcrProvider(fileBuffer, mimeType, fileName);
  }

  const normalizedMime = String(mimeType).toLowerCase();
  const lowerName = String(fileName).toLowerCase();

  if (normalizedMime.includes("pdf") || lowerName.endsWith(".pdf")) {
    const text = extractTextFromPdfBuffer(fileBuffer);
    if (text.trim().length > 0) return text;
    throw new DocumentOcrError(
      [{ field: "file", code: "ocr_no_text", message: "No text layer found in PDF. Scanned images require an OCR provider." }],
      "Could not extract text from PDF document.",
    );
  }

  if (
    normalizedMime.includes("text") ||
    normalizedMime.includes("json") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".csv")
  ) {
    return fileBuffer.toString("utf8");
  }

  if (normalizedMime.startsWith("image/") || /\.(png|jpe?g|webp|bmp|tiff)$/i.test(lowerName)) {
    throw new DocumentOcrError(
      [{ field: "file", code: "image_ocr_provider_required", message: "Processing scanned images requires configuring an external OCR provider." }],
      "Image OCR requires an OCR provider engine.",
    );
  }

  // Fallback try utf8 string
  return fileBuffer.toString("utf8");
}

/**
 * Parses German number formatting: "1.250,50" -> 1250.5, "50,5" -> 50.5, "750" -> 750
 */
function parseGermanNumber(str) {
  if (!str) return null;
  const cleaned = str.trim().replace(/\s/g, "");
  // If format is like 1.250,50
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
  }
  // If format is like 1250,50
  if (/^\d+,\d+$/.test(cleaned)) {
    return parseFloat(cleaned.replace(",", "."));
  }
  // Standard decimal or integer
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

/**
 * Parses tenancy and dwelling metadata from raw text (e.g. from Mietvertrag or Wohnungsgeberbestätigung).
 * @param {string} rawText
 * @returns {object} Extracted fields, confidence scores, and API-ready payload.
 */
export function parseTenancyDocument(rawText) {
  if (!rawText || typeof rawText !== "string" || !rawText.trim()) {
    throw new DocumentOcrError([
      { field: "document", code: "empty_text", message: "Document text is empty or missing." },
    ]);
  }

  const text = rawText.replace(/\r\n/g, "\n");
  const warnings = [];
  const fields = {};
  const confidence = {};

  // 1. Street and House Number Extraction
  // German street suffixes: -straße, -str., -platz, -allee, -weg, -damm, -chaussee, -ufer, -zeile, etc.
  const streetPatterns = [
    // Standard Berlin address: "Berliner Straße 155", "Karl-Liebknecht-Str. 5a", "Unter den Linden 77"
    /(?:(?:Mietobjekt|Wohnung|Anschrift|Lage\s+der\s+Wohnung|Adresse|Räume\s+in)\s*:?\s*)?([A-ZÄÖÜ][a-zäöüßA-Z0-9.\-\s]+?(?:straße|strasse|str\.|platz|allee|weg|damm|chaussee|ufer|zeile|ring|gasse|markt|steg|promenade|berg))\s+(\d{1,4}\s*[a-z]?)(?=\s|,|\n|$)/iu,
    // Two-word or titled streets: "Pariser Platz 1", "Ernst-Reuter-Platz 3"
    /([A-ZÄÖÜ][a-zäöüßA-Z0-9.\-\s]{2,40})\s+(\d{1,4}\s*[a-z]?)(?:,\s*|\n|\s+)(?:10\d{3}|12\d{3}|13\d{3}|14[01]\d{2})/iu,
  ];

  let street = null;
  let houseNumber = null;

  for (const pattern of streetPatterns) {
    const match = pattern.exec(text);
    if (match) {
      street = match[1].trim();
      houseNumber = match[2].trim();
      break;
    }
  }

  // 2. Postal Code & City Extraction (Berlin PLZ: 10000 - 14199)
  const berlinPlzRegex = /\b(10\d{3}|12\d{3}|13\d{3}|14[01]\d{2})\b(?:\s+(?:Berlin[a-zA-Z\-\s]*|Berlin))?/iu;
  const plzMatch = berlinPlzRegex.exec(text);
  const postalCode = plzMatch ? plzMatch[1] : null;
  const city = "Berlin";

  // Address confidence calculation
  if (street && houseNumber && postalCode) {
    fields.street = street;
    fields.houseNumber = houseNumber;
    fields.postalCode = postalCode;
    fields.city = city;
    fields.address = `${street} ${houseNumber}\n${postalCode} ${city}`;
    confidence.address = 0.95;
  } else if (street && houseNumber) {
    fields.street = street;
    fields.houseNumber = houseNumber;
    confidence.address = 0.6;
    warnings.push("Berlin postal code (PLZ) could not be unambiguously identified.");
  } else if (postalCode) {
    fields.postalCode = postalCode;
    confidence.address = 0.4;
    warnings.push("Street or house number could not be found.");
  } else {
    confidence.address = 0.0;
    warnings.push("No valid Berlin address was detected.");
  }

  // 3. Living Area Extraction (Wohnfläche in m² / qm)
  const livingAreaRegex = /(?:Wohnfläche|Wohnfl\.|Fläche|Größe|Grösse)[^\d\n]{0,35}?([0-9]+(?:[.,][0-9]+)?)\s*(?:m²|qm|Quadratmeter)/iu;
  const areaMatch = livingAreaRegex.exec(text);
  if (areaMatch) {
    const val = parseGermanNumber(areaMatch[1]);
    if (val && val >= 10 && val <= 500) {
      fields.livingAreaSqm = val;
      confidence.livingAreaSqm = 0.95;
    } else if (val) {
      fields.livingAreaSqm = val;
      confidence.livingAreaSqm = 0.5;
      warnings.push(`Extracted living area (${val} m²) seems unusual.`);
    }
  } else {
    confidence.livingAreaSqm = 0.0;
  }

  // 4. Rent Extraction: Net Cold Rent (Nettokaltmiete / Grundmiete / Kaltmiete)
  const coldRentRegex = /(?:Netto-?kaltmiete|Kaltmiete|Grundmiete|monatliche\s+(?:Netto-?)?Kaltmiete|Mietzins)[^\d\n]{0,35}?(?:EUR|€)?\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?)/iu;
  const coldRentMatch = coldRentRegex.exec(text);
  if (coldRentMatch) {
    const val = parseGermanNumber(coldRentMatch[1]);
    if (val && val >= 50 && val <= 25_000) {
      fields.contractRent = val;
      fields.netColdRent = val;
      confidence.contractRent = 0.95;
    } else if (val) {
      fields.contractRent = val;
      fields.netColdRent = val;
      confidence.contractRent = 0.5;
      warnings.push(`Extracted contract rent (${val} EUR) seems unusual.`);
    }
  } else {
    confidence.contractRent = 0.0;
  }

  // Warm rent / Total rent (optional)
  const warmRentRegex = /(?:Warmmiete|Gesamtmiete|Bruttomiete|Bruttowarmmiete)[^\d\n]{0,35}?(?:EUR|€)?\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?)/iu;
  const warmRentMatch = warmRentRegex.exec(text);
  if (warmRentMatch) {
    fields.warmRent = parseGermanNumber(warmRentMatch[1]);
  }

  // Operating costs / Nebenkosten (optional)
  const operatingCostsRegex = /(?:Betriebskosten|Nebenkosten|Heizkostenvorauszahlung|Betriebskostenvorauszahlung)[^\d\n]{0,35}?(?:EUR|€)?\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?)/iu;
  const operatingCostsMatch = operatingCostsRegex.exec(text);
  if (operatingCostsMatch) {
    fields.operatingCosts = parseGermanNumber(operatingCostsMatch[1]);
  }

  // 5. Rooms (Zimmer / Räume)
  const roomsRegex = /(?:Zimmeranzahl|Räume|Zimmer|Wohnräume)\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)|([0-9]+(?:[.,][0-9]+)?)[ \t]+(?:Zimmer|Zimmern|Wohnräume|Räume)/iu;
  const roomsMatch = roomsRegex.exec(text);
  if (roomsMatch) {
    const rawVal = roomsMatch[1] ?? roomsMatch[2];
    const val = parseGermanNumber(rawVal);
    if (val && val >= 1 && val <= 20) {
      fields.rooms = val;
      confidence.rooms = 0.9;
    }
  }

  // 6. Year of Construction (Baujahr)
  const buildingYearRegex = /(?:Baujahr|Errichtungsjahr|Baujahr\s+des\s+Gebäudes)[^\d\n]{0,35}?([12][0-9]{3})/iu;
  const yearMatch = buildingYearRegex.exec(text);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    const currentYear = new Date().getFullYear();
    if (year >= 1700 && year <= currentYear + 2) {
      fields.buildingYear = year;
      confidence.buildingYear = 0.95;
    }
  }

  // 7. Occupants & Children (for § 7 WoAufG Bln)
  const occupantsRegex = /(?:Personen|Mieter|Bewohner|Haushaltsangehörige)\s*[:=]?\s*([0-9]+)|([0-9]+)[ \t]+(?:Personen|Mieter|Bewohner|Haushaltsangehörige)/iu;
  const occupantsMatch = occupantsRegex.exec(text);
  if (occupantsMatch) {
    const rawVal = occupantsMatch[1] ?? occupantsMatch[2];
    fields.occupants = parseInt(rawVal, 10);
    confidence.occupants = 0.85;
  }

  const childrenRegex = /(?:Kinder?(?:\s*(?:unter|bis)\s*6(?:\s*Jahre[n]?|\s*J\.?)?)?)\s*[:=]\s*([0-9]+)|([0-9]+)[ \t]+Kind(?:er)?(?:\s*(?:unter|bis)\s*6(?:\s*Jahre[n]?|\s*J\.?)?)?/iu;
  const childrenMatch = childrenRegex.exec(text);
  if (childrenMatch) {
    const rawVal = childrenMatch[1] ?? childrenMatch[2];
    fields.childrenUpToSix = parseInt(rawVal, 10);
    confidence.childrenUpToSix = 0.85;
  }

  // Overall confidence score
  const scoreKeys = Object.keys(confidence);
  const overallConfidence = scoreKeys.length > 0
    ? Number((scoreKeys.reduce((acc, k) => acc + confidence[k], 0) / scoreKeys.length).toFixed(2))
    : 0.0;

  // Build prefilledApiPayload conforming to POST /api/v1/address-verifications
  const prefilledApiPayload = {};
  if (fields.address) prefilledApiPayload.address = fields.address;
  if (fields.street) prefilledApiPayload.street = fields.street;
  if (fields.houseNumber) prefilledApiPayload.houseNumber = fields.houseNumber;
  if (fields.postalCode) prefilledApiPayload.postalCode = fields.postalCode;
  if (fields.livingAreaSqm !== undefined) prefilledApiPayload.livingAreaSqm = fields.livingAreaSqm;
  if (fields.contractRent !== undefined) prefilledApiPayload.contractRent = fields.contractRent;
  if (fields.buildingYear !== undefined) prefilledApiPayload.buildingYear = fields.buildingYear;
  if (fields.rooms !== undefined) prefilledApiPayload.rooms = fields.rooms;
  if (fields.occupants !== undefined) prefilledApiPayload.occupants = fields.occupants;
  if (fields.childrenUpToSix !== undefined) prefilledApiPayload.childrenUpToSix = fields.childrenUpToSix;

  return {
    rawTextLength: text.length,
    fields,
    confidence: {
      ...confidence,
      overall: overallConfidence,
    },
    prefilledApiPayload,
    warnings,
  };
}

/**
 * Reads the text of an uploaded payload: { file: base64String, mimeType, fileName } or { text: string }.
 * @param {object} input
 * @returns {Promise<string>}
 */
export async function extractDocumentText(input) {
  if (!input || typeof input !== "object") {
    throw new DocumentOcrError([
      { field: "body", code: "missing_payload", message: "Request body is missing." },
    ]);
  }

  if (typeof input.text === "string") {
    if (!input.text.trim()) {
      throw new DocumentOcrError([
        { field: "document", code: "empty_text", message: "Document text is empty or missing." },
      ]);
    }
    return input.text.trim();
  }

  if (input.file) {
    const buffer = Buffer.from(input.file, "base64");
    if (buffer.length > 15 * 1024 * 1024) {
      throw new DocumentOcrError([
        { field: "file", code: "file_too_large", message: "File exceeds maximum size of 15MB." },
      ]);
    }
    return await extractTextFromDocument(buffer, input.mimeType, input.fileName);
  }

  throw new DocumentOcrError([
    { field: "file", code: "no_content", message: "Provide either a base64 encoded 'file' or a 'text' string." },
  ]);
}

/**
 * Handles document ingestion and OCR extraction from uploaded payload.
 * Accepts { file: base64String, mimeType, fileName } or { text: string }.
 * @param {object} input
 * @returns {Promise<object>}
 */
export async function processDocumentOcr(input) {
  return parseTenancyDocument(await extractDocumentText(input));
}

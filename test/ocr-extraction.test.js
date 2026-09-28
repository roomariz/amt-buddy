import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";

import {
  DocumentOcrError,
  extractTextFromPdfBuffer,
  extractTextFromDocument,
  parseTenancyDocument,
  processDocumentOcr,
  registerOcrProvider,
  resetOcrProvider,
} from "../src/ocr-extraction.js";

test("parses a standard German Mietvertrag text and extracts tenancy facts", () => {
  const sampleLease = `
    MIETVERTRAG FÜR WOHNRAUM
    
    Zwischen dem Vermieter Hausverwaltung Müller GmbH
    und dem Mieter Max Mustermann.
    
    § 1 Mieträume
    Vermietet wird die Wohnung in:
    Berliner Straße 155
    10715 Berlin
    
    Die Wohnfläche beträgt ca. 75,5 m².
    Die Wohnung besteht aus 3 Zimmern, Küche, Bad und Flur.
    Das Baujahr des Gebäudes ist 1935.
    
    § 2 Miete und Betriebskosten
    Die monatliche Nettokaltmiete beträgt 850,00 EUR.
    Die Vorauszahlung für Betriebskosten beträgt 150,00 EUR.
    Die Gesamtmiete beträgt somit 1.000,00 EUR.
    
    § 3 Belegung
    Die Wohnung wird von 2 Personen und 1 Kind unter 6 Jahren bezogen.
  `;

  const result = parseTenancyDocument(sampleLease);

  assert.equal(result.fields.street, "Berliner Straße");
  assert.equal(result.fields.houseNumber, "155");
  assert.equal(result.fields.postalCode, "10715");
  assert.equal(result.fields.city, "Berlin");
  assert.equal(result.fields.address, "Berliner Straße 155\n10715 Berlin");
  assert.equal(result.fields.livingAreaSqm, 75.5);
  assert.equal(result.fields.contractRent, 850.0);
  assert.equal(result.fields.warmRent, 1000.0);
  assert.equal(result.fields.operatingCosts, 150.0);
  assert.equal(result.fields.rooms, 3);
  assert.equal(result.fields.buildingYear, 1935);
  assert.equal(result.fields.occupants, 2);
  assert.equal(result.fields.childrenUpToSix, 1);

  // Confidence check
  assert.equal(result.confidence.address, 0.95);
  assert.equal(result.confidence.livingAreaSqm, 0.95);
  assert.equal(result.confidence.contractRent, 0.95);
  assert.equal(result.confidence.buildingYear, 0.95);
  assert.ok(result.confidence.overall >= 0.85);

  // Check prefilled payload format for Amt-Buddy API
  assert.deepEqual(result.prefilledApiPayload, {
    address: "Berliner Straße 155\n10715 Berlin",
    street: "Berliner Straße",
    houseNumber: "155",
    postalCode: "10715",
    livingAreaSqm: 75.5,
    contractRent: 850.0,
    buildingYear: 1935,
    rooms: 3,
    occupants: 2,
    childrenUpToSix: 1,
  });
});

test("parses a Wohnungsgeberbestätigung format with comma-separated address", () => {
  const sampleConfirmation = `
    Wohnungsgeberbestätigung nach § 19 des Bundesmeldegesetzes (BMG)
    
    Lage der Wohnung:
    Alexanderplatz 1, 10178 Berlin
    Wohnfläche: 52 qm
    Zimmer: 2
    Kaltmiete: 620 €
    Baujahr: 1970
    Einzug von 1 Personen
  `;

  const result = parseTenancyDocument(sampleConfirmation);

  assert.equal(result.fields.street, "Alexanderplatz");
  assert.equal(result.fields.houseNumber, "1");
  assert.equal(result.fields.postalCode, "10178");
  assert.equal(result.fields.livingAreaSqm, 52);
  assert.equal(result.fields.contractRent, 620);
  assert.equal(result.fields.rooms, 2);
  assert.equal(result.fields.buildingYear, 1970);
  assert.equal(result.fields.occupants, 1);
});

test("handles currency with thousands dots and comma decimals", () => {
  const text = `
    Mietvertrag
    Anschrift: Pariser Platz 1
    10117 Berlin
    Grundmiete: 1.450,50 EUR
    Wohnfläche von 98,2 m²
    Baujahr: 1998
  `;

  const result = parseTenancyDocument(text);
  assert.equal(result.fields.contractRent, 1450.5);
  assert.equal(result.fields.livingAreaSqm, 98.2);
  assert.equal(result.fields.buildingYear, 1998);
});

test("reports warnings when crucial fields like address or PLZ are missing", () => {
  const incompleteText = `
    Nur eine Notiz:
    Wohnfläche 45 m², Kaltmiete 500 €
  `;

  const result = parseTenancyDocument(incompleteText);
  assert.equal(result.confidence.address, 0.0);
  assert.ok(result.warnings.length > 0);
  assert.equal(result.fields.livingAreaSqm, 45);
  assert.equal(result.fields.contractRent, 500);
});

test("extracts text from simulated PDF buffer with compressed streams", () => {
  const streamContent = `
    BT
    /F1 12 Tf
    (Berliner Strasse 155) Tj
    T*
    (10715 Berlin) Tj
    T*
    [(Wohnflaeche 50 qm) 10 (Kaltmiete 600 EUR)] TJ
    ET
  `;

  const compressedStream = deflateSync(Buffer.from(streamContent, "latin1"));
  const pdfHeader = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Length " + compressedStream.length + " /Filter /FlateDecode >>\nstream\n", "binary");
  const pdfFooter = Buffer.from("\nendstream\nendobj\n%%EOF", "binary");
  const fakePdf = Buffer.concat([pdfHeader, compressedStream, pdfFooter]);

  const extracted = extractTextFromPdfBuffer(fakePdf);
  assert.ok(extracted.includes("Berliner Strasse 155"));
  assert.ok(extracted.includes("10715 Berlin"));
  assert.ok(extracted.includes("Wohnflaeche 50 qm"));
});

test("supports pluggable custom OCR provider", async () => {
  registerOcrProvider(async (buffer, mimeType, fileName) => {
    return `
      Mietvertrag
      Objekt: Kantstr. 12b
      10623 Berlin
      Wohnfläche 60 m²
      Nettokaltmiete 720 €
      Baujahr: 1910
      2 Zimmer
    `;
  });

  try {
    const fakeImageBuffer = Buffer.from("fake-image-bytes");
    const result = await processDocumentOcr({
      file: fakeImageBuffer.toString("base64"),
      mimeType: "image/png",
      fileName: "scan.png",
    });

    assert.equal(result.fields.street, "Kantstr.");
    assert.equal(result.fields.houseNumber, "12b");
    assert.equal(result.fields.postalCode, "10623");
    assert.equal(result.fields.livingAreaSqm, 60);
    assert.equal(result.fields.contractRent, 720);
    assert.equal(result.fields.buildingYear, 1910);
  } finally {
    resetOcrProvider();
  }
});

test("throws DocumentOcrError on empty or invalid payload", async () => {
  await assert.rejects(
    async () => {
      await processDocumentOcr(null);
    },
    (err) => err instanceof DocumentOcrError && err.details[0].field === "body",
  );

  await assert.rejects(
    async () => {
      await processDocumentOcr({ text: "   " });
    },
    (err) => err instanceof DocumentOcrError && err.details[0].field === "document",
  );
});

test("extracted payload from lease feeds seamlessly into verifyBerlinAddress", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("wohnlagenadr2026")) {
      return new Response(
        JSON.stringify({
          features: [
            {
              properties: {
                wol: "gut",
                schluessel: "00509155",
                strasse: "Berliner Straße",
                hnr: "155",
                plz: "10715",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (urlStr.includes("ua_gebaeudealter")) {
      return new Response(
        JSON.stringify({
          features: [
            {
              properties: {
                schluessel: "0900431581000000",
                ueberw_dekade_woh_neu: "1919-1949",
                typklar: "Blockrandbebauung",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        features: [
          {
            geometry: { type: "Point", coordinates: [13.3295, 52.4872] },
            properties: {
              adressid: "147765",
              hnr: 155,
              hnr_zusatz: null,
              str_name: "Berliner Straße",
              plz: "10715",
              bez_name: "Charlottenburg-Wilmersdorf",
              ort_name: "Wilmersdorf",
              plr_name: "Babelsberger Straße",
              qualitaet: "Qualitaet A",
              adr_datum: "2008-01-28",
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const rawContract = `
      Mietvertrag
      Mietobjekt: Berliner Straße 155
      10715 Berlin
      Wohnfläche: 50 m²
      Kaltmiete: 500 €
      Baujahr: 1935
      Zimmer: 2
      Personen: 2
      Kinder: 0
    `;

    const ocrResult = await processDocumentOcr({ text: rawContract });
    assert.equal(ocrResult.confidence.address, 0.95);

    // Pass directly to verifyBerlinAddress
    const { verifyBerlinAddress } = await import("../src/berlin-address.js");
    const verified = await verifyBerlinAddress(ocrResult.prefilledApiPayload);

    assert.equal(verified.verified, true);
    assert.equal(verified.address.street, "Berliner Straße");
    assert.equal(verified.address.houseNumber, "155");
    assert.equal(verified.address.postalCode, "10715");
    assert.equal(verified.mietspiegel.status, "calculated");
    assert.equal(verified.mietspiegel.contractRentComparison.status, "within");
    assert.equal(verified.occupancyAssessment.status, "meets_minimum");
  } finally {
    globalThis.fetch = originalFetch;
  }
});


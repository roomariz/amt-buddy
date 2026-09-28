# Amt Buddy

Amt Buddy validates a user-provided Berlin address against the official open
address dataset published by Amt für Statistik Berlin-Brandenburg.

## Run locally

Requires Node.js 20 or newer. No third-party packages are required.

```sh
npm start
```

Open `http://localhost:3000`.

If port `3000` is already occupied, the server automatically tries the next
available port through `3010` and prints the selected URL. To require a specific
port instead, set `PORT` before starting the server; for example in PowerShell:

```powershell
$env:PORT = 4000
npm start
```

## Test

```sh
npm test
```

Tests mock the upstream service so they are deterministic and do not require
network access.

## API

`POST /api/v1/address-verifications`

### Request

```json
{
  "address": "Berliner Straße 155\n10715 Berlin-Bezirk Charlottenburg-Wilmersdorf",
  "livingAreaSqm": 50,
  "contractRent": 500.0,
  "buildingYear": 1935,
  "rooms": 2,
  "occupants": 2,
  "childrenUpToSix": 0
}
```

- **Address inputs**: Provide `address` (multi-line or comma-separated) or component fields (`street`, `houseNumber`, `postalCode`).
- **Optional dwelling & rent inputs**:
  - `livingAreaSqm`: Living area in m² (used for both § 7 WoAufG Bln and Mietspiegel calculation).
  - `contractRent` / `actualMonthlyRent`: Optional contractual net cold rent in EUR to compare against the reference range.
  - `buildingYear` / `buildingAge`: Optional construction year/era to specify or override block-level area data.
  - `rooms`, `occupants`, `childrenUpToSix`: Required for the § 7 WoAufG Bln occupancy assessment.

### Response

```json
{
  "data": {
    "verified": true,
    "address": {
      "officialId": "147765",
      "street": "Berliner Straße",
      "houseNumber": "155",
      "postalCode": "10715",
      "city": "Berlin",
      "district": "Charlottenburg-Wilmersdorf",
      "locality": "Wilmersdorf",
      "planningArea": "Babelsberger Straße",
      "quality": "Qualitaet A",
      "recordedAt": "2008-01-28",
      "coordinates": { "longitude": 13.3295, "latitude": 52.4872 },
      "residentialLocation": "gut",
      "residentialLocationKey": "00509155",
      "rentTier": {
        "locationCategory": "gut",
        "monetaryRentVerified": false,
        "note": "Wohnlage is a Mietspiegel location category, not a rent amount."
      },
      "buildingAge": {
        "verificationStatus": "area_class_only",
        "exactBuildingAgeVerified": false,
        "exactBuildingYear": null,
        "areaBuildingAgeClass": "1951-1960",
        "predominantAreaConstructionPeriod": "1951-1960",
        "areaKey": "0900431581000000",
        "urbanStructure": "Heterogene, innerstädtische Mischbebauung, Lückenschluss nach 1945",
        "granularity": "block_or_partial_block",
        "referenceYear": 2015,
        "note": "Official predominant construction period for the block or partial block; exact building-level construction year is not verified."
      }
    },
    "mietspiegel": {
      "status": "calculated",
      "buildingAge": "1919–1949",
      "residentialLocation": "gut",
      "sizeCategory": "40–60 m²",
      "field": "D4",
      "rentPerSqm": {
        "lower": 8.20,
        "median": 9.45,
        "upper": 11.10
      },
      "monthlyReferenceRent": {
        "lower": 410.00,
        "median": 472.50,
        "upper": 555.00
      },
      "currency": "EUR",
      "basis": "net cold rent",
      "contractRentComparison": {
        "actualMonthlyRent": 500.0,
        "actualRentPerSqm": 10.0,
        "status": "within",
        "differenceFromMedian": 27.5,
        "differenceFromThreshold": 0,
        "summary": "The contractual rent is within the official Mietspiegel reference range."
      },
      "source": {
        "name": "Berliner Mietspiegel 2026",
        "publisher": "Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen Berlin",
        "legalBasis": "§§ 558c, 558d BGB",
        "basis": "net cold rent",
        "currency": "EUR"
      }
    },
    "occupancyAssessment": {
      "status": "meets_minimum",
      "meetsMinimum": true,
      "livingAreaSqm": 50,
      "requiredAreaSqm": 18,
      "areaMarginSqm": 32,
      "occupants": 2,
      "childrenUpToSix": 0,
      "rooms": 2,
      "occupantsPerRoom": 1.0,
      "roomsPerOccupant": 1.0,
      "legalBasis": "§ 7 Abs. 1 WoAufG Bln",
      "informationalOnly": true
    },
    "source": { "name": "Adressen Berlin - WFS", "..." : "..." },
    "sources": {
      "address": { "name": "Adressen Berlin - WFS", "..." : "..." },
      "residentialLocation": { "name": "Wohnlagen nach Adressen zum Berliner Mietspiegel 2026 - WFS", "..." : "..." },
      "buildingAge": { "name": "Gebäudealter der Wohnbebauung (Umweltatlas) - WFS", "..." : "..." },
      "mietspiegel": { "name": "Berliner Mietspiegel 2026", "..." : "..." },
      "occupancyLaw": { "name": "§ 7 WoAufG Bln", "..." : "..." }
    }
  }
}
```

`POST /api/v1/documents/ocr`

Extracts tenancy facts (address, net cold rent, living area, construction year, rooms, occupants, children) from uploaded rental contracts (`Mietvertrag`) or registration documents (`Wohnungsgeberbestätigung`).

### Request

```json
{
  "file": "<base64_encoded_file_content>",
  "mimeType": "application/pdf",
  "fileName": "mietvertrag.pdf"
}
```
*(Or send `{ "text": "raw contract text" }` directly).*

### Response

```json
{
  "data": {
    "rawTextLength": 1250,
    "fields": {
      "street": "Berliner Straße",
      "houseNumber": "155",
      "postalCode": "10715",
      "city": "Berlin",
      "address": "Berliner Straße 155\n10715 Berlin",
      "livingAreaSqm": 75.5,
      "contractRent": 850.0,
      "buildingYear": 1935,
      "rooms": 3,
      "occupants": 2,
      "childrenUpToSix": 1
    },
    "confidence": {
      "address": 0.95,
      "livingAreaSqm": 0.95,
      "contractRent": 0.95,
      "buildingYear": 0.95,
      "rooms": 0.9,
      "occupants": 0.85,
      "childrenUpToSix": 0.85,
      "overall": 0.92
    },
    "prefilledApiPayload": {
      "address": "Berliner Straße 155\n10715 Berlin",
      "livingAreaSqm": 75.5,
      "contractRent": 850.0,
      "buildingYear": 1935,
      "rooms": 3,
      "occupants": 2,
      "childrenUpToSix": 1
    },
    "warnings": []
  }
}
```

`POST /api/v1/chat`

Conversational AI orchestrator that interprets natural language queries in German or English, classifies user intent, calls official backend tools (`validate_berlin_address`, `calculate_mietspiegel`, `assess_occupancy_compliance`, `extract_document_ocr`), and synthesizes markdown explanations with statutory citations.

### Request

```json
{
  "message": "Prüfe bitte Pariser Platz 1, 10117 Berlin und sag mir den Mietspiegel für 50 m²",
  "history": []
}
```

### Response

```json
{
  "data": {
    "reply": "### Offizielle Berliner Adresse bestätigt: **Pariser Platz 1**\n\n- **Postleitzahl & Ort**: 10117 Berlin (Mitte)\n- **Wohnlage**: **gut**...",
    "intent": "address_verification",
    "toolCalls": [
      {
        "success": true,
        "name": "validate_berlin_address",
        "executionTimeMs": 28,
        "result": { "..." : "..." }
      }
    ],
    "suggestions": [
      "Mietspiegel für diese Adresse berechnen",
      "Belegung für 3 Personen prüfen"
    ]
  }
}
```

### Output specifics & limitations

1. **Berliner Mietspiegel 2026 Reference Rent Range (`mietspiegel`)**:
   - Source: Qualified Berliner Mietspiegel 2026 under §§ 558c, 558d BGB.
   - Classification: Combines Wohnlage (`einfach`, `mittel`, `gut`), building age class, and size category into the specific table field (e.g. `D4`).
   - Outputs: `rentPerSqm` (lower, median, upper bounds) and calculated `monthlyReferenceRent` (lower, median, upper) based on living area.
   - Contract rent comparison: When `contractRent` is provided, assesses whether contractual rent is `below`, `within`, or `above` the official statutory reference range.
2. **Residential location & Rent tier (`rentTier`)**:
   - Source: Berliner Mietspiegel 2026 WFS (`wohnlagenadr2026`).
   - Categorization: `einfach`, `mittel`, or `gut`.
   - *Important*: Wohnlage is an official statutory location classification, not a monetary euro rent figure.
3. **Building age (`buildingAge`)**:
   - Source: Umweltatlas Berlin Gebäudealter WFS (`ua_gebaeudealter`).
   - *Limitation*: Open Berlin WFS data provides predominant construction age classes at the **block or partial-block level** (granularity: `block_or_partial_block`, reference year: 2015 / ISU5 2010), not individual building certificates. Exact building-level construction year is set to `null` and flagged as `exactBuildingAgeVerified: false` to avoid false precision.
4. **Occupancy assessment (`occupancyAssessment`)**:
   - Legal basis: **§ 7 Abs. 1 WoAufG Bln** (Wohnungsaufsichtsgesetz Berlin).
   - Statutory floor-area thresholds: Minimum **9 m² per person** and **6 m² per child up to age 6** for whole self-contained dwellings.
   - Descriptive density metrics: `occupantsPerRoom` and `roomsPerOccupant`.
   - *Legal notice*: The calculation is purely informational based on user-provided dwelling facts and does not constitute official inspection or legal advice.

## Data policy

- Geographic scope: Berlin only.
- Address source: [Adressen Berlin – WFS](https://daten.berlin.de/datensaetze/adressen-berlin-wfs-634ab8ba).
- Residential-location source: [Wohnlagen nach Adressen zum Berliner Mietspiegel 2026 – WFS](https://daten.berlin.de/datensaetze/wohnlagen-nach-adressen-zum-berliner-mietspiegel-2026-wfs-809faebe).
- Building-age source: [Gebäudealter der Wohnbebauung (Umweltatlas) – WFS](https://daten.berlin.de/datensaetze/gebaudealter-der-wohnbebauung-umweltatlas-wfs-ad4eca4b).
- Mietspiegel table: [Berliner Mietspiegel 2026](https://daten.berlin.de/datensaetze/wohnlagen-nach-adressen-zum-berliner-mietspiegel-2026-wfs-809faebe) (SenStadt).
- Statutory reference: [§ 7 WoAufG Bln](https://gesetze.berlin.de/bsbe/document/jlr-WoAufGBEV3IVZ/part/X).
- Publisher: Land Berlin (Amt für Statistik Berlin-Brandenburg & Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen).
- License: Datenlizenz Deutschland – Zero – Version 2.0.
- Market-data extensions must use Berlin-specific datasets with an open license and a publicly documented source. Proprietary listing or valuation databases are out of scope.

No address data is persisted by this application.

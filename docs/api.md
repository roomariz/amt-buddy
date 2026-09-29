# HTTP API

Plain JSON endpoints, callable without the chat. The chat endpoints (`/api/v1/orchestrator/*`) are described in [orchestrator.md](orchestrator.md#http-and-sse-interface).

## `POST /api/v1/address-verifications`

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

## `POST /api/v1/documents/ocr`

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

## `POST /api/v1/chat`

The rule-based chatbot. It interprets German or English questions, classifies the intent, calls the backend tools (`validate_berlin_address`, `calculate_mietspiegel`, `assess_occupancy_compliance`, `extract_document_ocr`) and replies in Markdown with statutory citations. It keeps no memory between requests; the chat page uses it only as the fallback when no model is configured.

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

## Output specifics & limitations (`address-verifications`)

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

## Landlord

The landlord side (page `/landlord`). A Landlord signs in with a name only; their state lives in SQLite (Node's built-in `node:sqlite`) at `LANDLORD_DB_PATH` (default `data/landlord.sqlite`, gitignored). Errors use the usual shape `{ "error": { "code", "message", "details"? } }`: `422 validation_error` with one `details` entry per field, `404 landlord_not_found` for an unknown `landlordId`.

### `POST /api/v1/landlord/sessions`

```json
{ "name": "Erika Muster" }
```

→ `200 { "data": { "landlordId": "5b0c…", "name": "Erika Muster" } }`. The same name (trimmed, case-insensitive) always returns the same landlord; the first sign-in creates it. An empty name (or one over 100 characters) is a 422.

### `PUT /api/v1/landlord/:landlordId/listing`

Saves the landlord's one Listing (replacing an earlier one) and returns it with its Rent check.

```json
{ "address": "Wühlischstraße 30, 10245 Berlin", "livingAreaSqm": 50, "rooms": 2, "askingRent": 700, "buildingYear": 1905 }
```

- `address`: street, house number and postal code (`Wühlischstr. 30 10245` works too); verified against the official address register.
- `livingAreaSqm` (at most 1000), `rooms` (at most 20), `askingRent` (monthly net cold rent in EUR, at most 100 000): numbers above 0.
- `buildingYear` (optional, 1800 to five years ahead): replaces the block's predominant construction period in the Mietspiegel.

The Rent check runs `evaluateMietspiegel` with the asking rent as contract rent and `rentedBefore: true` (a re-let, so the Mietpreisbremse applies; the new-build exemption and a previous rent are not considered).

```json
{
  "data": {
    "address": "Wühlischstraße 30, 10245 Berlin",
    "canonicalAddress": { "street": "Wühlischstraße", "houseNumber": "30", "postalCode": "10245", "city": "Berlin", "district": "Friedrichshain-Kreuzberg", "locality": "Friedrichshain", "coordinates": { "longitude": 13.4576, "latitude": 52.5097 } },
    "addressVerified": true,
    "livingAreaSqm": 50,
    "rooms": 2,
    "askingRent": 700,
    "buildingYear": null,
    "residentialLocation": "gut",
    "buildingAgePeriod": "1901-1910",
    "rentCheck": {
      "askingRent": 700,
      "askingRentPerSqm": 14,
      "range": { "lower": 420, "median": 490, "upper": 610 },
      "rangePerSqm": { "lower": 8.4, "median": 9.8, "upper": 12.2 },
      "position": "high",
      "aboveCap": true,
      "allowedRent": 539,
      "differenceFromAllowed": 161,
      "capPercent": 10,
      "mietspiegelField": "C4",
      "buildingAgeClass": "bis 1918",
      "residentialLocation": "gut",
      "legalBasis": "Mietpreisbremse (§§ 556d–556g BGB): …",
      "source": { "name": "Berliner Mietspiegel 2026", "…": "…" }
    },
    "note": null,
    "updatedAt": "2026-09-29T16:33:50.553Z"
  }
}
```

- `position`: `low` (below the Mietspiegel range), `typical` (within it) or `high` (above it).
- `aboveCap`: the asking rent is above Mietspiegel median + 10 %; `allowedRent` is that cap and `differenceFromAllowed` the asking rent minus it.
- When there is no Rent check, `rentCheck` is `null` and `note` says why (`{ "code", "message" }`); the Listing is still saved:
  - `address_not_verified`: the register has no such address (`addressVerified: false`, `canonicalAddress: null`).
  - `berlin_data_service_unavailable`: an official Berlin service failed; save the Listing again later.
  - `rent_check_not_possible`: the Mietspiegel does not apply (e.g. no official Wohnlage).

### `GET /api/v1/landlord/:landlordId/dashboard`

→ `200 { "data": { "listing", "rentCheck", "criteria", "ranked", "excluded", "stats", "recommendations", "hint", "poolErrors" } }`. Later landlord features add fields (Shortlist, …).

- `listing` / `rentCheck`: the saved Listing and its Rent check, or `null`.
- `criteria`: the Selection criteria used: `weights` (relative, per criterion: `affordability` 30, `schufa` 20, `documents` 15, `credibility` 15, `employment` 15, `previousLandlord` 5; normalised to sum to 100 %) and `requirements` (`schufaCleanOnly`, `completeDocumentsOnly`, `maxRentToIncome`, `noPets`, `noSmoking`, `latestMoveIn`, all off; `occupancyCompliant` on). Not tunable yet.
- `ranked`: the Applicant pool scored for the Listing (`rankApplicants`, `src/landlord/scorer.js`; ADR 0004), best first, ties by applicant id:

```json
{
  "applicantId": "A-007",
  "rank": 1,
  "matchScore": 94.2,
  "rentToIncome": 0.1842,
  "breakdown": { "affordability": { "subscore": 1, "weight": 30 }, "schufa": { "subscore": 1, "weight": 20 }, "…": {} },
  "name": "Lena Schmidt",
  "documents": { "schufa": "present", "incomeProof": "present", "previousLandlord": "not_required", "arrears": false, "complete": true }
}
```

  `documents` holds each Application document's Document check status, `arrears` (the previous landlord confirms rent arrears) and `complete`.

  `subscore` is 0–1, `weight` the criterion's share of the Match score in %. Subscores: affordability 1 at a rent-to-income ratio of at most 25 %, 0 at 40 % or more, linear in between; SCHUFA clean 1, minor entries 0.5, negative or missing 0; documents the share of required documents present and valid; credibility the Credibility score / 100; employment permanent or civil servant 1, fixed-term or self-employed 0.6, student with guarantor 0.5, other 0.3; previous landlord no arrears 1, first-time renter 0.5, missing or unusable 0.3, arrears 0.
- `excluded`: applicants who fail a Requirement, by id: `{ applicantId, excludedBy, reasons: [{ requirement, message, …values }], name, documents }`. `excludedBy` is the first failed Requirement; the values depend on it (e.g. `occupancyCompliant`: `householdSize`, `requiredAreaSqm` under § 7 WoAufG Bln, `livingAreaSqm`; `maxRentToIncome`: `rentToIncome`, `limit`).
- `stats`: the pool statistics, counted over the whole pool (excluded applicants too), or `null` without a Listing:

```json
{ "total": 40, "completeDocuments": 19, "canAfford": 22, "canAffordAtMedian": 31, "cleanSchufa": 24, "excluded": 4, "maxRentToIncome": 0.3333, "medianRent": 490 }
```

  `canAfford`: rent-to-income at the asking rent at most `maxRentToIncome` (the Requirement's value, or 1/3 while it is off). `canAffordAtMedian`: the same at the Rent check's Mietspiegel median (`medianRent`, i.e. median €/m² × living area), showing how much a lower rent would widen the pool; both are `null` when the Listing has no Rent check (unknown, not zero).
- `recommendations`: the top two `ranked` applicants (fewer when fewer are ranked), each with reasons generated by code (no model) from the Match score breakdown:

```json
{
  "applicantId": "A-007",
  "rank": 1,
  "matchScore": 94.2,
  "strengths": ["affordability", "schufa", "documents"],
  "weakness": "credibility",
  "reason": {
    "de": "Dieser Bewerber könnte Ihnen gefallen: geringe Mietbelastung (18,4 % des Haushaltsnettoeinkommens), saubere SCHUFA und vollständige Unterlagen. Zu beachten: geringe Glaubwürdigkeit (55/100).",
    "en": "You may like this applicant for their low rent burden (18.4 % of net household income), clean SCHUFA and complete documents. To note: low credibility (55/100)."
  },
  "name": "Lena Schmidt"
}
```

  `strengths`: up to three criteria with a subscore of at least 0.75, strongest first (ties by weight); `weakness`: the criterion with the lowest subscore below 0.6 (ties by weight), or `null`. Without a strength, the reason names the Match score instead.
- `name` is joined in for display only; the scorer never sees names or contact details.
- `hint`: `{ "code": "listing_required", "message" }` without a Listing (then `ranked` and `excluded` are empty), otherwise `null`.
- `poolErrors`: `[{ file, reason }]`, the pool files that could not be read as an application.

The server reads the Applicant pool once at start from `APPLICANT_POOL_DIR` (default: the committed pool in `data/applicants`), as of `APPLICANT_POOL_TODAY` (default: `POOL_DATE`, the day the committed pool was generated, so its SCHUFA-Auskünfte do not expire).

### `GET /api/v1/landlord/:landlordId/applicants/:applicantId`

→ `200 { "data": { "profile", "score", "rentToIncome", "contact" } }`. An unknown applicant returns `404 applicant_not_found`; an unknown landlord returns `404 landlord_not_found`.

- `profile` is the Applicant pool's anonymised profile: household size and counts, net household income, employment type, SCHUFA status, move-in date, pets, smoking, Credibility score, and the complete Document check. Each document has a status and reason; `documentCheck.issues` lists consistency and other document issues.
- `score` is the current Listing's entry from `rankApplicants`: either `{ applicantId, rank, matchScore, breakdown, rentToIncome }` or `{ applicantId, excludedBy, reasons }`. It is `null` before a Listing is saved. `rentToIncome` is also returned at the top level for excluded applicants; it is `null` without a Listing.
- `contact` contains only `{ name, email, phone }` for page display. The reusable lookup in `src/landlord/applicant-profile.js` leaves contact out for the later chat Tool. Protected source fields and raw document text are never returned.

### `POST /api/v1/landlord/:landlordId/chat`

One turn of the Landlord Orchestrator (`src/landlord/orchestrator/`), a LangGraph graph of its own (`ingest → agent ⇄ tools → verifyGrounding → finalize`; the tenant Orchestrator is not involved). The conversation is kept in memory, one thread per landlord.

```json
{ "message": "Only applicants with a clean SCHUFA, please." }
```

→ `200 text/event-stream`, the same framing as the tenant chat (`event: <type>` + `data: <the event as JSON>`, `: keep-alive` comments):

- `{ "type": "token", "text": "…" }`: the answer (Markdown), once it has passed the grounding check (ADR 0003): every number comes from a Tool result of this turn, the landlord's Listing or their own message; applicant ids (`A-007`) are not checked as figures.
- `{ "type": "criteria" }` / `{ "type": "shortlist" }`: a Tool changed the Selection criteria / the Shortlist; the page reloads the dashboard after `done`.
- `{ "type": "done" }` or `{ "type": "error", "message" }`: exactly one ends every turn.

Without `OPENAI_MODEL` and `OPENAI_API_KEY` the stream is a single `token` saying the AI chat is not configured (in German or English, following the message), then `done`. A body without a non-empty `message` of at most 4000 characters is a `422 validation_error`; an unknown landlord a `404 landlord_not_found`.

The six landlord Tools have shared zod contracts in `src/landlord/orchestrator/tool-contracts.js` (`get_ranking`, `get_applicant_profile`, `update_selection_criteria`, `remember_preference`, `update_shortlist`, `get_rent_check`); the Orchestrator refuses to start if one is missing. A Tool gets the landlord as `config.configurable.landlordId` and must return applicant ids only, never names or protected characteristics. Until the real Tools exist, the server runs on the stub Tools (`createLandlordStubTools`), which return fixed data.

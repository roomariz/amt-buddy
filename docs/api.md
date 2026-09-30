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

→ `200 { "data": { "listing", "rentCheck", "criteria", "defaultCriteria", "ranked", "excluded", "stats", "recommendations", "hint", "shortlist", "notes", "poolErrors" } }`.

- `listing` / `rentCheck`: the saved Listing and its Rent check, or `null`.
- `criteria`: the Selection criteria used: `weights` (relative, per criterion: `affordability` 30, `schufa` 20, `documents` 15, `credibility` 15, `employment` 15, `previousLandlord` 5; normalised to sum to 100 %) and `requirements` (`schufaCleanOnly`, `completeDocumentsOnly`, `maxRentToIncome`, `noPets`, `noSmoking`, `latestMoveIn`, all off; `occupancyCompliant` on). Saved per landlord; new landlords get these defaults.
- `defaultCriteria`: the defaults above, used by the page to reset all weights and Requirements.
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
- `shortlist`: the landlord's Shortlist, in the order the entries were added: `[{ applicantId, name, status, note, added, rank, matchScore, excluded }]`. `rank` and `matchScore` come from `ranked`; both are `null` without a Listing or when the applicant is excluded (`excluded: true`). `name` is `null` for an applicant no longer in the pool.
- `notes`: the Landlord preferences the chat remembered (`remember_preference`), oldest first: `[{ noteId, note, created }]`, also without a Listing.
- `poolErrors`: `[{ file, reason }]`, the pool files that could not be read as an application.

`PUT listing` also saves the Listing's address, size, rooms, rent and building year as the landlord's flat details (see `GET overview`), so both pages agree.

### `GET /api/v1/landlord/:landlordId/overview`

The chat-first page's data (`/landlord-chat.html`). Unlike `GET dashboard` it ranks from the first visit: the pool is ranked for the flat details, a Listing or not, and a fact about the flat that is still missing switches off what depends on it (it is listed in `inactive`).

→ `200 { "data": { "flat", "missing", "rentCheck", "rentCheckNote", "criteria", "inactive", "ranked", "stats", "shortlist", "poolErrors" } }`:

```json
{
  "flat": { "address": null, "livingAreaSqm": 65, "rooms": 2, "askingRent": null, "buildingYear": null },
  "missing": ["address", "askingRent"],
  "rentCheck": null,
  "rentCheckNote": null,
  "criteria": {
    "weights": { "affordability": 30, "schufa": 20, "documents": 15, "credibility": 15, "employment": 15, "previousLandlord": 5 },
    "activeWeights": { "affordability": 0, "schufa": 28.6, "documents": 21.4, "credibility": 21.4, "employment": 21.4, "previousLandlord": 7.1 },
    "requirements": { "schufaCleanOnly": false, "completeDocumentsOnly": false, "maxRentToIncome": null, "noPets": false, "noSmoking": false, "latestMoveIn": null, "occupancyCompliant": true }
  },
  "inactive": [{ "criterion": "affordability", "missing": ["askingRent"] }],
  "ranked": [
    { "applicantId": "A-007", "name": "Lena Schmidt", "householdShape": "couple", "rank": 1, "matchScore": 97.1, "reason": { "de": "…", "en": "…" } }
  ],
  "stats": { "total": 40, "completeDocuments": 19, "canAfford": null, "canAffordAtMedian": null, "cleanSchufa": 24, "excluded": 0, "maxRentToIncome": 0.3333, "medianRent": null },
  "shortlist": [
    { "applicantId": "A-012", "name": "…", "status": "invited", "note": null, "added": "…", "rank": null, "matchScore": null, "excluded": true, "householdShape": "family", "excludedBy": "noPets" }
  ],
  "poolErrors": []
}
```

- `flat`: the flat details the landlord gave so far, each `null` until known (on either page: the chat's `update_flat_details` or `PUT listing`). `missing`: what the Listing and its Rent check still need (`address`, `livingAreaSqm`, `rooms`, `askingRent`; the building year is optional).
- `rentCheck`: the Listing's Rent check (as in `PUT listing`), or `null`; `rentCheckNote` is the Listing's `note` (`{ code, message }`) when a Listing exists without a Rent check, otherwise `null`.
- `criteria.weights`: the saved shares in %, one decimal (what the chat quotes); `criteria.activeWeights`: each criterion's share of the Match score now, with the inactive ones at 0 and the others renormalised (the same as `weights` when nothing is inactive).
- `inactive`: `[{ criterion | requirement, missing: [fact] }]`. Without `askingRent`: `affordability` (and the `maxRentToIncome` Requirement when it is set; it is not evaluated); without `livingAreaSqm` or `rooms`: the `occupancyCompliant` Requirement when it is on. A Requirement that is off is not listed.
- `ranked`: every applicant who meets the (evaluated) Requirements, best first, with the `reason` of `recommendations` (see `GET dashboard`) for each, not just the top two; it never mentions the rent burden while affordability is inactive. `householdShape` is computed from the profile's adults and children only (never from gender): `family` with any children, otherwise `single` (1 adult), `couple` (2) or `group` (3 or more).
- `stats`: as in `GET dashboard`; `canAfford` is `null` without an asking rent, `canAffordAtMedian` and `medianRent` without a Rent check.
- `shortlist`: the dashboard's Shortlist entries, plus `householdShape`, `excludedBy` (the Requirement that now excludes the applicant, or `null`) and `rating`.
- `bonusPoints`: what the landlord's thumbs up or down is worth (5 by default, 0–20; see `PUT ratings`). Each `ranked` entry has `rating` (`"up"`, `"down"` or `null`) and `bonus` (+`bonusPoints`, −`bonusPoints` or 0). The ranking orders by `matchScore` + `bonus`; `matchScore` itself stays objective.

The server reads the Applicant pool once at start from `APPLICANT_POOL_DIR` (default: the committed pool in `data/applicants`), as of `APPLICANT_POOL_TODAY` (default: `POOL_DATE`, the day the committed pool was generated, so its SCHUFA-Auskünfte do not expire).

### `PUT /api/v1/landlord/:landlordId/shortlist/:applicantId`

Adds the applicant to the Shortlist, or changes their entry. Nothing is sent to the applicant; the status only tracks what the landlord still has to do.

```json
{ "status": "to_invite", "note": "Stable income, call on Monday" }
```

→ `200 { "data": { "applicantId": "A-007", "status": "to_invite", "note": "Stable income, call on Monday" } }`.

- `status`: `to_invite`, `invited` or `declined`.
- `note`: optional, at most 500 characters after trimming. Left out, the entry keeps its note (so a status change does not wipe it); `null` or blank clears it.
- An invalid `status` or `note` is a `422 validation_error`. Adding an applicant id that is not in the Applicant pool is a `404 applicant_not_found`; an entry already on the Shortlist can still be changed after its applicant has left the pool (e.g. another `APPLICANT_POOL_DIR`). Nothing is saved on an error.

The same logic (`updateShortlist`, `src/landlord/shortlist.js`) backs the chat Tool `update_shortlist`, so its checks hold there too.

### `DELETE /api/v1/landlord/:landlordId/shortlist/:applicantId`

Takes the applicant off the Shortlist → `200 { "data": { "applicantId": "A-007", "status": "removed", "note": null } }`. Removing an applicant who is not on the Shortlist changes nothing and is not an error; one who is neither on the Shortlist nor in the pool is a `404 applicant_not_found`. An entry whose applicant has left the pool can always be removed.

### `PUT /api/v1/landlord/:landlordId/ratings/:applicantId`

The landlord's own thumbs up or down for an applicant: `{ "rating": "up" }` or `{ "rating": "down" }` → `200 { "data": { "applicantId": "A-007", "rating": "up" } }`. It adds (up) or subtracts (down) the landlord's bonus points to the applicant's ranking score, on both pages; the Match score is unchanged. An invalid `rating` is a `422 validation_error`; an applicant not in the pool a `404 applicant_not_found`. Ratings are saved in SQLite (`ratings`) and survive a restart. The chat sees them only as ids with +N or −N and cannot set them.

### `DELETE /api/v1/landlord/:landlordId/ratings/:applicantId`

Reverts the rating → `200 { "data": { "applicantId": "A-007", "rating": null } }`; idempotent. A `404 applicant_not_found` only for an applicant who is neither in the pool nor rated (a rating whose applicant left the pool can still be removed).

### `DELETE /api/v1/landlord/:landlordId/notes/:noteId`

Deletes one remembered Landlord preference → `200 { "data": { "noteId": "…", "deleted": true } }`. A note id this landlord does not have (unknown, already deleted, or another landlord's) is a `404 note_not_found`; an unknown landlord a `404 landlord_not_found`. The notes are kept in SQLite (`preference_notes`) across reloads, returning sign-ins and server restarts; there is no endpoint to add one: the chat does.

### `PUT /api/v1/landlord/:landlordId/criteria`

Save partial changes to Selection criteria and return the same dashboard shape as `GET dashboard`.

```json
{ "weights": { "employment": 30 }, "requirements": { "schufaCleanOnly": true, "maxRentToIncome": 0.33 } }
```

Omitted weights and Requirements retain their saved values. Weights must be finite,
non-negative numbers with at least one positive value after merging; they are
normalised to sum to 100 on save. Boolean Requirements accept only `true` or
`false`. `maxRentToIncome` is a ratio above 0 and at most 1, or `null` to disable
it. `latestMoveIn` is a valid calendar date (`YYYY-MM-DD`), or `null` to disable it.
Unknown fields are rejected. Invalid input returns `422 validation_error` with
`details` naming the fields, leaving the saved criteria unchanged. An unknown
landlord returns `404 landlord_not_found`.

Criteria are kept in SQLite across reloads, returning sign-ins and server restarts.
The response recalculates the ranking, exclusions, statistics and Recommendations.
To reset, send the dashboard's complete `defaultCriteria` object to this endpoint.
The page displays the income limit as a percentage (33 → API ratio 0.33).

The reusable `updateSelectionCriteria({ store, landlordId, input })` function in
`src/landlord/criteria.js` validates, merges and saves, returning `{ previous,
criteria }` for the later chat Tool integration.
### `GET /api/v1/landlord/:landlordId/applicants/:applicantId`

→ `200 { "data": { "profile", "score", "rentToIncome", "contact" } }`. An unknown applicant returns `404 applicant_not_found`; an unknown landlord returns `404 landlord_not_found`.

- `profile` is the Applicant pool's anonymised profile: household size and counts, net household income, employment type, SCHUFA status, move-in date, pets, smoking, Credibility score, and the complete Document check. Each document has a status and reason; `documentCheck.issues` lists consistency and other document issues.
- `score` is the current Listing's entry from `rankApplicants`: either `{ applicantId, rank, matchScore, breakdown, rentToIncome }` or `{ applicantId, excludedBy, reasons }`. It is `null` before a Listing is saved. `rentToIncome` is also returned at the top level for excluded applicants; it is `null` without a Listing.
- `contact` contains only `{ name, email, phone }` for page display. The reusable lookup in `src/landlord/applicant-profile.js` leaves contact out for the later chat Tool. Protected source fields and raw document text are never returned.

### `POST /api/v1/landlord/:landlordId/chat`

One turn of the Landlord Orchestrator (`src/landlord/orchestrator/`), a LangGraph graph of its own (`ingest → agent ⇄ tools → verifyGrounding → finalize`; the tenant Orchestrator is not involved). The conversation is kept in memory, one thread per landlord. At the start of every turn the system prompt gets, from SQLite, the Landlord preferences (the saved Selection criteria, weights to one decimal, and the remembered notes), the Listing (with its Rent check) or, before one, the flat details and what is still missing, the inactive items, the pool stats under those criteria, the top 5 of the ranking (`{ applicantId, rank, matchScore, rentToIncome }`) and the Shortlist (`{ applicantId, status }`, no notes). All of it counts as evidence for the grounding check, so a follow-up answer that quotes the top of the ranking without calling a Tool keeps its figures; `rentToIncome` and `maxRentToIncome` also ground their percentage and 3-decimal forms (19.3 % for 0.1933). That is the long-term memory: it survives a server restart even though the thread does not.

```json
{ "message": "Only applicants with a clean SCHUFA, please." }
```

→ `200 text/event-stream`, the same framing as the tenant chat (`event: <type>` + `data: <the event as JSON>`, `: keep-alive` comments):

- `{ "type": "token", "text": "…" }`: the answer (Markdown), once it has passed the grounding check (ADR 0003): every number comes from a Tool result of this turn, the landlord's Listing, the pool stats or their own message; applicant ids (`A-007`) are not checked as figures. The model only knows applicant ids; the page shows each known applicant's name next to the id.
- `{ "type": "criteria" }` / `{ "type": "shortlist" }` / `{ "type": "notes" }` / `{ "type": "flat" }`: a Tool changed the Selection criteria / the Shortlist / remembered a Landlord preference / saved flat details (and, with all four facts, the Listing); it is saved already. After a turn with one of them the page reloads its data.
- `{ "type": "done" }` or `{ "type": "error", "message" }`: exactly one ends every turn.

Without `OPENAI_MODEL` and `OPENAI_API_KEY` the stream is a single `token` saying the AI chat is not configured (in German or English, following the message), then `done`. A body without a non-empty `message` of at most 4000 characters is a `422 validation_error`; an unknown landlord a `404 landlord_not_found`.

The nine landlord Tools have shared zod contracts in `src/landlord/orchestrator/tool-contracts.js` (`get_ranking`, `get_applicant_profile`, `compare_applicants`, `update_selection_criteria`, `adjust_selection_criteria`, `update_flat_details`, `remember_preference`, `update_shortlist`, `get_rent_check`); the Orchestrator refuses to start if one is missing. A Tool gets the landlord as `config.configurable.landlordId` and must return applicant ids only, never names or protected characteristics. The server runs on the real Tools (`createLandlordTools({ getStore, getApplicantPool, fetchImpl })`, `src/landlord/orchestrator/landlord-tools.js`), built on the dashboard's functions. They rank for the flat details, a Listing or not; the ranking Tools' results carry `inactive` as in `GET overview`:

- `get_ranking`: the top 10 ranked applicants (`applicantId`, `rank`, `matchScore`, `rentToIncome`, `breakdown`), `rankedCount`, the pool `stats`, `excludedByReason` (count per Requirement), the `criteria`, the `shortlist` as `{ applicantId, status }` (notes are left out: they are the landlord's free text) and `inactive`. An inactive criterion's breakdown entry is `{ "subscore": null, "weight": 0 }`, and `rentToIncome` is `null` without an asking rent.
- `get_applicant_profile`: the anonymised profile (names on other people's documents removed), `rank`, `matchScore`, `breakdown`, `contributions` (per criterion subscore × weight, the points it adds to the Match score, one decimal; `null` for an inactive criterion, and `null` as a whole for an excluded applicant; the chat compares these to explain why one applicant ranks above another), `rentToIncome`, `excludedBy` and `exclusionReasons`, `shortlistStatus` and `inactive`.
- `set_bonus_points { by: "factor" | "points", value }`: changes what the landlord's thumbs are worth ("give my impression more weight" → × 1.3), computed in code, 0–20 (a request above 20 is capped and reported; a negative one is an input error). Returns `{ previous, bonusPoints, requested, capped, maxBonusPoints: 20, top }` and emits `criteria` (the ranking changes).
- `compare_applicants { applicantIds: [a, b] }`: two distinct ids, ranked as `get_ranking` ranks. Returns `{ applicants: [{ applicantId, rank, matchScore, excludedBy }], leader, scoreGap, differences: [{ criterion, points: { [a], [b] }, difference }], equal: [criterion], note }`: the points are the `contributions` (subscore × weight), sorted by the size of the difference, computed in code; `equal` lists criteria within 0.05 points; a tie or an excluded applicant gives `leader: null` and a `note`. When either applicant is rated, both get `bonus` and `rankingScore`, the bonus is a line of its own in `differences` (or in `equal`), the leader is decided by ranking score, and `rankingGap` joins `scoreGap` (which stays the Match-score gap). The chat uses it to explain why one applicant ranks above another (a live model misread per-criterion numbers it had to compare itself).
- `update_selection_criteria { changes: [{ requirement, value }] }`: Requirements only (`updateSelectionCriteria`), listing only the ones the landlord changes (`value`: `true`/`false`, a ratio or `null` for `maxRentToIncome`, a day or `null` for `latestMoveIn`; a Requirement listed twice is an input error); its contract refuses `weights`, so the chat changes weights only through `adjust_selection_criteria` and its limits (`PUT criteria` keeps its absolute weights and has no 50 % cap). Returns `previous` and `criteria` (weights rounded to one decimal, so the chat can quote them), the new `top` 3 and `inactive`.
- `adjust_selection_criteria { changes: [{ criterion, by: "factor" | "share", value }] }`: `adjustSelectionCriteria` (`src/landlord/criteria.js`), relative changes computed in code. A named criterion's new share is its saved share × `value` (`by: "factor"`: 1.3 = 30 % more, 0 = ignore) or `value` % (`by: "share"`, at most 100); the criteria not named keep their proportions and fill the rest to 100 %. No share can exceed 50 % (a request above is capped); an unnamed share may not be pushed above 50 %, at least two criteria stay above 0, and when every unnamed criterion is at 0 the named ones must reach 100 %; otherwise it is an input error and nothing is saved. Returns `{ previous, criteria, applied: [{ criterion, from, requested, to, capped }], maxShare: 50, top, inactive }`, shares in % to one decimal. A change to an inactive criterion is saved too.
- `update_flat_details { facts: [{ fact, value }] }` (`fact`: `address`, `livingAreaSqm`, `rooms`, `askingRent` or `buildingYear`, the last only when the landlord states it; a fact listed twice is an input error): `updateFlatDetails` (`src/landlord/flat-details.js`) merges what is given into the saved flat details, each value checked as `PUT listing` checks it (a value it refuses, or an address without postal code, is an input error with the same message, and nothing is saved). Once address, size, rooms and rent are all known it builds and saves the Listing with its Rent check as `PUT listing` does. Returns `{ flat, missing, listing, rentCheck, note, stats, top, inactive }`: `listing` is `{ addressVerified, canonicalAddress, residentialLocation, buildingAgePeriod }` or `null`; `note` says why there is no Rent check (facts still missing, or the Listing's note, e.g. an address the register does not know).
- `update_shortlist { applicantId, status, note }`: `updateShortlist`, the same checks as the HTTP endpoint. `note` is required and may be `null`; `null` or blank keeps the entry's note, so the chat never clears one. The result's `note` is only the note the model sent in this call (an earlier note is the landlord's free text and is not handed back).

Every landlord Tool input lists only what the landlord changes, with no optional fields: a live model filled optional numbers with 0 (a `share` of 0 beside a `factor`, a building year of 0 and then an invented 1800). `test/landlord/landlord-tools.test.js` fails if an optional property comes back.
- `get_rent_check`: the Listing's Rent check, or `null` with a `note` saying why (before a Listing also `missing`: the facts it still needs).
- `remember_preference`: stores the trimmed `note` for the landlord (`preference_notes`) and returns `{ noteId, note }`; a blank note is an input error. It is shown in the system prompt of every later turn and conversation, and on the page.

`createLandlordStubTools` (fixed data) remains for tests.

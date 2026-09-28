# Amt-Buddy: Agentic AI Roadmap & Task Breakdown (`task.md`)

This document outlines the tasks required to evolve Amt-Buddy into an intelligent, agent-driven Berlin housing and compliance platform. The architecture centers around an **Orchestrator Agent**, modular **Tool Calling**, an interactive **Chat UI**, and an **OCR & Document Extraction Pipeline** for user-uploaded rental contracts and official documents.

---

## Architecture Overview

```
                      +-----------------------------+
                      |       Interactive Chat UI    |
                      |  (Uploads, Stream, Reviews) |
                      +--------------+--------------+
                                     |
                                     v
                      +-----------------------------+
                      |      Orchestrator Agent     |
                      |  (Intent routing, Planner)  |
                      +-------+--------------+------+
                              |              |
         +--------------------+              +--------------------+
         v                                                        v
+-----------------------+                                +-----------------------+
|  Specialized Agents   |                                |  Tool Calling Engine  |
|  & OCR Extraction     |                                |  (Schemas & Execution)|
|  - OCR Worker Agent   |                                |  - Address Validator  |
|  - Lease Parser       |                                |  - Mietspiegel Lookup |
|  - Compliance Auditor |                                |  - Occupancy Assessor |
+-----------------------+                                +-----------------------+
```

---

## 1. Orchestrator Agent Architecture

The Orchestrator acts as the central brain that manages conversation state, routes user requests to specialized workers or tools, and synthesizes answers for the user.

- [x] **1.1 Core Orchestration Engine**
  - **Task**: Central orchestrator lifecycle (Receive Input -> Classify Intent -> Plan & Execute Tools -> Format Markdown Reply with statutory explanations).
  - **Priority**: High
  - **Status**: Implemented (`src/chatbot-orchestrator.js`).

- [x] **1.2 Intent Classification & Router**
  - **Task**: Intent classification distinguishing address verification, Mietspiegel calculation, occupancy checks (§ 7 WoAufG Bln), document OCR, and general queries.
  - **Priority**: High
  - **Status**: Implemented (`classifyIntent` in `src/chatbot-orchestrator.js`).

- [x] **1.3 Multi-Agent / Pluggable LLM Provider Handoff**
  - **Task**: Extensible provider interface (`registerChatModelProvider`) allowing plug-in of LLMs (Gemini, Claude, GPT) with deterministic fallback rule engine.
  - **Priority**: Medium
  - **Status**: Implemented (`src/chatbot-orchestrator.js`).

- [x] **1.4 Guardrails, Safety & Fallbacks**
  - **Task**: Informational disclaimers on Mietspiegel and occupancy rules; graceful fallback responses for ambiguous inputs.
  - **Priority**: Medium
  - **Status**: Implemented.

---

## 2. Tool Calling Infrastructure

Formalize functions as structured tools conforming to standard JSON schemas for LLM tool/function calling.

- [x] **2.1 Tool Registry & Standardized Interface**
  - **Task**: Extensible tool registry (`CHATBOT_TOOLS`, `getToolSchemas`, `executeTool`) with type-safe JSON Schemas.
  - **Priority**: High
  - **Status**: Implemented (`src/chatbot-tools.js`).

- [x] **2.2 Existing Service Tool Adapters**
  - **Task**: Wrapped services into callable agent tools:
    - `validate_berlin_address`: Wraps `verifyBerlinAddress`.
    - `calculate_mietspiegel`: Wraps `evaluateMietspiegel`.
    - `assess_occupancy_compliance`: Wraps `assessOccupancy`.
    - `extract_document_ocr`: Wraps `processDocumentOcr`.
  - **Priority**: High
  - **Status**: Implemented (`src/chatbot-tools.js`).

- [x] **2.3 Dynamic Tool Execution & Error Handling**
  - **Task**: Safe execution pipeline measuring latency, catching validation errors, and returning structured error payloads.
  - **Priority**: High
  - **Status**: Implemented (`executeTool`).

- [x] **2.4 Tool Execution Auditing & Logging**
  - **Task**: Execution latency tracking (`executionTimeMs`), tool names, and parameters reported in chat response.
  - **Priority**: Low
  - **Status**: Implemented.

---

## 3. Interactive Chat UI

Upgrade the front-end to support conversational AI, interactive tool previews, and quick suggestion prompts.

- [x] **3.1 Chat Interface Layout & Message Stream**
  - **Task**: Floating, collapsible chat assistant widget with message bubble history, typing indicators, and markdown formatting.
  - **Priority**: High
  - **Status**: Implemented (`public/index.html`, `public/app.js`, `public/styles.css`).

- [x] **3.2 Tool Call & Progress Visualization**
  - **Task**: Visual tool execution chips (`⚙️ Tool: <name> (X ms)`) indicating active operations in chat replies.
  - **Priority**: Medium
  - **Status**: Implemented (`.tool-chip`).

- [x] **3.3 Quick Suggestions & Follow-ups**
  - **Task**: Clickable prompt suggestion pills to explore Mietspiegel, address checks, and occupancy rules with one click.
  - **Priority**: Medium
  - **Status**: Implemented (`.suggestion-pill`).

---

## 4. OCR & Document Data Extraction Pipeline

Extract relevant tenancy and dwelling metadata from user-uploaded files (rental contracts, Wohnungsgeberbestätigung, Anmeldung).

- [x] **4.1 File Upload & Ingestion Endpoint**
  - **Task**: Create a secure upload handler (`POST /api/v1/documents/ocr`) with MIME validation, size limits (up to 15MB), base64/buffer payload, and memory-safe processing.
  - **Priority**: High
  - **Status**: Implemented (`src/server.js` and `src/ocr-extraction.js`).

- [x] **4.2 OCR Engine & PDF Text Stream Ingestion**
  - **Task**: Ingest raw text and stream decompressed text tokens (`FlateDecode` / zlib inflate, `BT ... ET`, `Tj`, `TJ`) from digital PDFs without third-party dependencies, plus pluggable provider registry for external OCR engines.
  - **Priority**: High
  - **Status**: Implemented (`src/ocr-extraction.js`).

- [x] **4.3 Berlin Tenancy Information Extraction Parser**
  - **Task**: Implement an extraction schema to extract key fields from tenancy documents:
    - **Address components**: Street, house number, Berlin postal code (10000–14199), city.
    - **Rent metrics**: Net cold rent (`Nettokaltmiete`), warm rent (`Warmmiete`), operating costs (`Betriebskosten`).
    - **Apartment metrics**: Living area (`Wohnfläche` in m²), room count (`Zimmeranzahl`).
    - **Building metadata**: Year of construction (`Baujahr`).
    - **Occupancy facts**: Total occupants, children up to age 6 (for § 7 WoAufG Bln).
  - **Priority**: High
  - **Status**: Implemented (`parseTenancyDocument` in `src/ocr-extraction.js`).

- [x] **4.4 Confidence Scoring & Fallback Clarification**
  - **Task**: Compute field-level extraction confidence scores; flag ambiguous or low-confidence values with warnings and confidence pills.
  - **Priority**: Medium
  - **Status**: Implemented (`confidence` calculation and `warnings` array).

- [x] **4.5 Privacy, In-Memory Processing & API Pre-filling**
  - **Task**: Transform extracted fields into ready-to-run API payload (`prefilledApiPayload`) conforming to `/api/v1/address-verifications`, and auto-populate user form without persisting user document files.
  - **Priority**: High
  - **Status**: Implemented (end-to-end integration verified with 100% test pass).

---

## 5. End-to-End Workflows & Integration

Combine all components into seamless user journeys.

- [ ] **5.1 End-to-End Document-to-Compliance Flow**
  - **Task**: Connect Document Upload -> OCR Extraction -> Orchestrator Review -> Tool Calls (`berlin-address`, `berlin-mietspiegel`, `occupancy-assessment`) -> Formatted Chat Report.
  - **Priority**: High
  - **Acceptance Criteria**: Uploading a standard Berlin rental contract yields a full compliance check report without manual data entry.

- [ ] **5.2 Conversational Correction Loop**
  - **Task**: Enable user to correct any parsed field in chat (e.g., "Actually the cold rent is 720, not 780") and have the orchestrator re-run tool calculations.
  - **Priority**: Medium
  - **Acceptance Criteria**: Tool recalculation reflects user adjustments immediately in subsequent chat messages.

- [ ] **5.3 Automated Testing & E2E Verification**
  - **Task**: Write unit and integration tests for:
    - Tool call execution and schema validation.
    - OCR extraction mocks with sample Berlin lease contracts.
    - Orchestrator multi-turn state transitions.
  - **Priority**: Medium
  - **Acceptance Criteria**: Test suite passes with `npm test`.

---

## Priority & Implementation Roadmap

| Phase | Milestone | Focus Areas | Target Deliverables |
|---|---|---|---|
| **Phase 1** | Foundations & Tooling | Tool Calling & Adapters | Standard tool schemas for address, Mietspiegel, & occupancy services |
| **Phase 2** | Ingestion & OCR | Document Upload & OCR | Secure upload API, document parser, tenancy schema extraction |
| **Phase 3** | Agent Core | Orchestrator & State Machine | Intent routing, tool invocation loop, clarifying dialogues |
| **Phase 4** | User Experience | Chat UI & Visual Components | Modern chat interface, upload zone, progress cards, data confirmation |
| **Phase 5** | Hardening & Privacy | Security, PII & Testing | Ephemeral file cleanup, PII masking, automated test suites |

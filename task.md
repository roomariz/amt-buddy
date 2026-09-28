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
  - **Task**: Define the central orchestrator lifecycle (Receive Input -> Plan Steps -> Invoke Tools/Agents -> Evaluate Output -> Respond).
  - **Priority**: High
  - **Acceptance Criteria**: State machine maintains conversation memory, session state, and execution history across multi-turn dialogs.
  - **Status (LangGraph Orchestrator, `src/orchestrator/`)**: Done in `src/orchestrator/` (LangGraph state machine, per-thread checkpointer, Tenancy, audit log).
  - **Status (rule-based chatbot, `src/chatbot-orchestrator.js`)**: Implemented (`src/chatbot-orchestrator.js`).

- [x] **1.2 Intent Classification & Router**
  - **Task**: Implement intent classification to distinguish between:
    - General Berlin housing inquiries.
    - Official address verification queries.
    - Mietspiegel calculation requests.
    - § 7 WoAufG Bln occupancy compliance checks.
    - Document analysis / lease contract upload workflows.
  - **Priority**: High
  - **Acceptance Criteria**: Router selects the appropriate sub-pipeline or worker with >95% accuracy.
  - **Status (LangGraph Orchestrator, `src/orchestrator/`)**: Partial: router with all five Intents plus `out_of_scope`, multi-Intent and follow-up aware (`src/orchestrator/intents.js`). The >95% accuracy has not been measured yet.
  - **Status (rule-based chatbot, `src/chatbot-orchestrator.js`)**: Implemented (`classifyIntent` in `src/chatbot-orchestrator.js`).

- [x] **1.3 Multi-Agent Handoff & Worker Coordination**
  - **Task**: Create specialized sub-agents:
    - `LeaseAnalysisAgent`: Focuses on interpreting parsed lease documents.
    - `ComplianceAgent`: Evaluates rent caps, Mietspiegel tiers, and overcrowding.
    - `OfficialDataAgent`: Interfaces with Berlin open data endpoints.
  - **Priority**: Medium
  - **Acceptance Criteria**: Orchestrator delegates tasks to sub-agents and gracefully aggregates results into a single coherent response.
  - **Status (LangGraph Orchestrator, `src/orchestrator/`)**: Done: OfficialDataAgent, ComplianceAgent, LeaseAnalysisAgent, delegated by the Supervisor.
  - **Status (rule-based chatbot, `src/chatbot-orchestrator.js`)**: Implemented (`src/chatbot-orchestrator.js`).

- [x] **1.4 Guardrails, Safety & Fallbacks**
  - **Task**: Implement prompt guardrails, hallucination checks against Berlin statutory rules, and graceful fallback responses for ambiguous inputs.
  - **Priority**: Medium
  - **Acceptance Criteria**: Disclaimer provided that outputs do not replace formal legal counsel; out-of-scope requests are politely rejected.
  - **Status (LangGraph Orchestrator, `src/orchestrator/`)**: Done: out-of-scope rejection, grounding check on every figure, "not legal advice" disclaimer on verdicts, fallback question.
  - **Status (rule-based chatbot, `src/chatbot-orchestrator.js`)**: Implemented.

---

## 2. Tool Calling Infrastructure

Formalize functions as structured tools conforming to standard JSON schemas for LLM tool/function calling.

- [x] **2.1 Tool Registry & Standardized Interface**
  - **Task**: Extensible tool registry (`CHATBOT_TOOLS`, `getToolSchemas`, `executeTool`) with type-safe JSON Schemas.
  - **Priority**: High
  - **Acceptance Criteria**: Any new tool can be registered with type-safe schema definitions and automatic input validation.
  - **Status (LangGraph Orchestrator, `src/orchestrator/`)**: Partial: Tool contracts with zod input/output schemas and validation (`src/orchestrator/tool-contracts.js`); no general-purpose registry.
  - **Status (rule-based chatbot, `src/chatbot-orchestrator.js`)**: Implemented (`src/chatbot-tools.js`).

- [x] **2.2 Existing Service Tool Adapters**
  - **Task**: Wrap current Amt-Buddy backend services into callable agent tools:
    - `validate_berlin_address`: Calls `src/berlin-address.js` with street, house number, postal code.
    - `lookup_building_age`: Calls `src/berlin-building-age.js` to determine block-level construction period.
    - `calculate_mietspiegel`: Calls `src/berlin-mietspiegel.js` to evaluate reference rent and rent cap conformity.
    - `assess_occupancy_compliance`: Calls `src/occupancy-assessment.js` for § 7 WoAufG Bln living area per person checks.
  - **Priority**: High
  - **Acceptance Criteria**: Agent reliably invokes tools with correct extracted parameters and handles API error responses gracefully.
  - **Status (LangGraph Orchestrator, `src/orchestrator/`)**: Done: `createBerlinTools()` (`src/orchestrator/berlin-tools.js`) gives all four Tools on the official Berlin services and real calculations, with input vs. upstream errors and a per-call time budget matching the Tool wrapper; offline contract tests on recorded WFS responses, opt-in live test (`BERLIN_LIVE=1`). `extract_lease_data` is still a stub there.
  - **Status (rule-based chatbot, `src/chatbot-orchestrator.js`)**: Implemented (`src/chatbot-tools.js`).

- [x] **2.3 Dynamic Tool Execution & Error Handling**
  - **Task**: Implement execution pipeline handling tool timeouts, retries, parameter coercion, and structured error feedback returned to the model.
  - **Priority**: High
  - **Acceptance Criteria**: When a tool returns missing data or errors, the orchestrator asks clarifying questions or attempts recovery.
  - **Status (LangGraph Orchestrator, `src/orchestrator/`)**: Done: timeout, one retry, argument pinning and number parsing, input vs. upstream errors, `needs_facts` leads to clarifying questions.
  - **Status (rule-based chatbot, `src/chatbot-orchestrator.js`)**: Implemented (`executeTool`).

- [x] **2.4 Tool Execution Auditing & Logging**
  - **Task**: Log tool call traces (input arguments, execution latency, raw response, error states) for debugging and audit compliance.
  - **Priority**: Low
  - **Acceptance Criteria**: Structured log events generated for each tool execution during a conversation.
  - **Status (LangGraph Orchestrator, `src/orchestrator/`)**: Done: one structured audit line per Tool call (latency, attempts, outcome); argument values and raw responses are left out on purpose (PII).
  - **Status (rule-based chatbot, `src/chatbot-orchestrator.js`)**: Implemented.

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

- [ ] **3.4 Extracted Data Review & Verification Card**
  - **Task**: Build an interactive form card inside chat allowing users to review and manually correct extracted OCR data (rent, area, address, rooms) before triggering compliance calculations.
  - **Priority**: High
  - **Acceptance Criteria**: Editable field cards with confidence highlights (green/yellow/red) allowing one-click confirmation to run calculations.
  - **Status**: Backend only: `send({ confirm })` confirms Unconfirmed facts; no UI card yet.

- [ ] **3.5 Session Management & Conversation History**
  - **Task**: Provide conversation reset, thread persistence in `localStorage` or session backend, and export to PDF/Markdown report.
  - **Priority**: Low
  - **Acceptance Criteria**: User can restart context or save their compliance evaluation report.

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
  - **Acceptance Criteria**: Fields with confidence < 80% prompt the Orchestrator to confirm details with the user in chat.
  - **Status (LangGraph Orchestrator)**: lease facts with confidence < 0.8 are Unconfirmed and block verdicts until the user confirms them.
  - **Status (OCR, `src/ocr-extraction.js`)**: Implemented (`confidence` calculation and `warnings` array).

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

- [x] **5.2 Conversational Correction Loop**
  - **Task**: Enable user to correct any parsed field in chat (e.g., "Actually the cold rent is 720, not 780") and have the orchestrator re-run tool calculations.
  - **Priority**: Medium
  - **Acceptance Criteria**: Tool recalculation reflects user adjustments immediately in subsequent chat messages.
  - **Status**: Done in the Orchestrator and tested through `send()`; not yet wired to the UI.

- [ ] **5.3 Automated Testing & E2E Verification**
  - **Task**: Write unit and integration tests for:
    - Tool call execution and schema validation.
    - OCR extraction mocks with sample Berlin lease contracts.
    - Orchestrator multi-turn state transitions.
  - **Priority**: Medium
  - **Acceptance Criteria**: Test suite passes with `npm test`.
  - **Status**: Partial: Tool contract and Orchestrator multi-turn tests pass with `npm test`; OCR mock tests are not part of the Orchestrator work.

---

## Priority & Implementation Roadmap

| Phase | Milestone | Focus Areas | Target Deliverables |
|---|---|---|---|
| **Phase 1** | Foundations & Tooling | Tool Calling & Adapters | Standard tool schemas for address, Mietspiegel, & occupancy services |
| **Phase 2** | Ingestion & OCR | Document Upload & OCR | Secure upload API, document parser, tenancy schema extraction |
| **Phase 3** | Agent Core | Orchestrator & State Machine | Intent routing, tool invocation loop, clarifying dialogues |
| **Phase 4** | User Experience | Chat UI & Visual Components | Modern chat interface, upload zone, progress cards, data confirmation |
| **Phase 5** | Hardening & Privacy | Security, PII & Testing | Ephemeral file cleanup, PII masking, automated test suites |

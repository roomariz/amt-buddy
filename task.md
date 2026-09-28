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

- [ ] **1.1 Core Orchestration Engine**
  - **Task**: Define the central orchestrator lifecycle (Receive Input -> Plan Steps -> Invoke Tools/Agents -> Evaluate Output -> Respond).
  - **Priority**: High
  - **Acceptance Criteria**: State machine maintains conversation memory, session state, and execution history across multi-turn dialogs.

- [ ] **1.2 Intent Classification & Router**
  - **Task**: Implement intent classification to distinguish between:
    - General Berlin housing inquiries.
    - Official address verification queries.
    - Mietspiegel calculation requests.
    - § 7 WoAufG Bln occupancy compliance checks.
    - Document analysis / lease contract upload workflows.
  - **Priority**: High
  - **Acceptance Criteria**: Router selects the appropriate sub-pipeline or worker with >95% accuracy.

- [ ] **1.3 Multi-Agent Handoff & Worker Coordination**
  - **Task**: Create specialized sub-agents:
    - `LeaseAnalysisAgent`: Focuses on interpreting parsed lease documents.
    - `ComplianceAgent`: Evaluates rent caps, Mietspiegel tiers, and overcrowding.
    - `OfficialDataAgent`: Interfaces with Berlin open data endpoints.
  - **Priority**: Medium
  - **Acceptance Criteria**: Orchestrator delegates tasks to sub-agents and gracefully aggregates results into a single coherent response.

- [ ] **1.4 Guardrails, Safety & Fallbacks**
  - **Task**: Implement prompt guardrails, hallucination checks against Berlin statutory rules, and graceful fallback responses for ambiguous inputs.
  - **Priority**: Medium
  - **Acceptance Criteria**: Disclaimer provided that outputs do not replace formal legal counsel; out-of-scope requests are politely rejected.

---

## 2. Tool Calling Infrastructure

Formalize functions as structured tools conforming to standard JSON schemas for LLM tool/function calling.

- [ ] **2.1 Tool Registry & Standardized Interface**
  - **Task**: Build an extensible `ToolRegistry` with standardized definitions (name, description, JSON schema parameters, execute callback).
  - **Priority**: High
  - **Acceptance Criteria**: Any new tool can be registered with type-safe schema definitions and automatic input validation.

- [ ] **2.2 Existing Service Tool Adapters**
  - **Task**: Wrap current Amt-Buddy backend services into callable agent tools:
    - `validate_berlin_address`: Calls `src/berlin-address.js` with street, house number, postal code.
    - `lookup_building_age`: Calls `src/berlin-building-age.js` to determine block-level construction period.
    - `calculate_mietspiegel`: Calls `src/berlin-mietspiegel.js` to evaluate reference rent and rent cap conformity.
    - `assess_occupancy_compliance`: Calls `src/occupancy-assessment.js` for § 7 WoAufG Bln living area per person checks.
  - **Priority**: High
  - **Acceptance Criteria**: Agent reliably invokes tools with correct extracted parameters and handles API error responses gracefully.

- [ ] **2.3 Dynamic Tool Execution & Error Handling**
  - **Task**: Implement execution pipeline handling tool timeouts, retries, parameter coercion, and structured error feedback returned to the model.
  - **Priority**: High
  - **Acceptance Criteria**: When a tool returns missing data or errors, the orchestrator asks clarifying questions or attempts recovery.

- [ ] **2.4 Tool Execution Auditing & Logging**
  - **Task**: Log tool call traces (input arguments, execution latency, raw response, error states) for debugging and audit compliance.
  - **Priority**: Low
  - **Acceptance Criteria**: Structured log events generated for each tool execution during a conversation.

---

## 3. Interactive Chat UI

Upgrade the front-end to support conversational AI, streaming responses, interactive tool previews, and file attachments.

- [ ] **3.1 Chat Interface Layout & Message Stream**
  - **Task**: Implement a modern, responsive chat component with real-time SSE (Server-Sent Events) or WebSocket streaming for model tokens.
  - **Priority**: High
  - **Acceptance Criteria**: Smooth typing animation, markdown rendering (tables, bold, lists, alerts), and auto-scrolling behavior.

- [ ] **3.2 Tool Call & Progress Visualization**
  - **Task**: Create visual widgets indicating active agent operations (e.g., "🔍 Searching official Berlin address register...", "📊 Calculating Mietspiegel reference rent...", "📄 Analyzing Mietvertrag...").
  - **Priority**: Medium
  - **Acceptance Criteria**: Users see collapsible status cards showing tool status (running, success, error) and expandable inspection payloads.

- [ ] **3.3 Document Upload & Dropzone Integration**
  - **Task**: Embed a drag-and-drop file upload zone in the chat input (supporting PDF, PNG, JPG up to 15MB).
  - **Priority**: High
  - **Acceptance Criteria**: Shows file upload progress bar, document thumbnail, file type badge, and option to remove uploaded files.

- [ ] **3.4 Extracted Data Review & Verification Card**
  - **Task**: Build an interactive form card inside chat allowing users to review and manually correct extracted OCR data (rent, area, address, rooms) before triggering compliance calculations.
  - **Priority**: High
  - **Acceptance Criteria**: Editable field cards with confidence highlights (green/yellow/red) allowing one-click confirmation to run calculations.

- [ ] **3.5 Session Management & Conversation History**
  - **Task**: Provide conversation reset, thread persistence in `localStorage` or session backend, and export to PDF/Markdown report.
  - **Priority**: Low
  - **Acceptance Criteria**: User can restart context or save their compliance evaluation report.

---

## 4. OCR & Document Data Extraction Pipeline

Extract relevant tenancy and dwelling metadata from user-uploaded files (rental contracts, Wohnungsgeberbestätigung, Anmeldung).

- [ ] **4.1 File Upload & Ingestion Endpoint**
  - **Task**: Create a secure upload handler (`POST /api/v1/documents/upload`) with MIME validation, virus/malware scanning considerations, and temp storage.
  - **Priority**: High
  - **Acceptance Criteria**: Accepts valid PDF and image documents, converts multi-page PDFs to image buffers if required, returns a `documentId`.

- [ ] **4.2 OCR Engine Integration**
  - **Task**: Integrate OCR processing engine (e.g., Tesseract.js / Google Cloud Vision API / Vision LLM multimodal extraction).
  - **Priority**: High
  - **Acceptance Criteria**: Extracts raw text and bounding boxes/layout structure from both digital PDFs and scanned camera photos.

- [ ] **4.3 Berlin Tenancy Information Extraction Parser**
  - **Task**: Implement an extraction schema to extract key fields from tenancy documents:
    - **Address components**: Street, house number, postal code, district/locality.
    - **Rent metrics**: Net cold rent (`Nettokaltmiete`), warm rent (`Warmmiete`), operating costs (`Betriebskosten/Heizkosten`).
    - **Apartment metrics**: Living area (`Wohnfläche` in m²), room count (`Zimmeranzahl`), floor/location.
    - **Building metadata**: Year of construction (`Baujahr`), heating type, amenities.
    - **Contract metadata**: Start date, landlord/tenant identifiers, subletting clauses.
  - **Priority**: High
  - **Acceptance Criteria**: Structured JSON payload produced conforming to Amt-Buddy's address verification & Mietspiegel API formats.

- [ ] **4.4 Confidence Scoring & Fallback Clarification**
  - **Task**: Compute field-level extraction confidence scores; flag ambiguous or low-confidence values for user confirmation.
  - **Priority**: Medium
  - **Acceptance Criteria**: Fields with confidence < 80% prompt the Orchestrator to confirm details with the user in chat.

- [ ] **4.5 Privacy, PII Sanitization & Data Retention Policy**
  - **Task**: Mask unnecessary personally identifiable information (tenant bank details, IDs, phone numbers) and enforce ephemeral file cleanup.
  - **Priority**: High
  - **Acceptance Criteria**: Files deleted from disk/memory post-processing; no sensitive PII stored in conversation logs.

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

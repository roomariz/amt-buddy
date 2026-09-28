# Orchestrator Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Amt-Buddy's Orchestrator: a LangGraph.js agent that classifies each message, delegates to three Sub-agents over teammates' Tools, keeps a structured Tenancy per conversation, and only releases grounded answers.

**Architecture:** `ingest → classifyIntent → (rejectOutOfScope | supervisor ⇄ delegate) → verifyGrounding (⇄ supervisor once) → finalize`, compiled with a checkpointer keyed by `threadId`. The Supervisor's tools are the three Sub-agents plus `record_tenancy_facts`; `delegate` gates each Sub-agent in code, runs it as a small ReAct loop over wrapped Tools, and turns Tool results into Tenancy facts. The public interface is `createOrchestrator({ models, tools }) → { send, getTenancy }`, where `send()` yields domain events for the UI teammate's SSE endpoint.

**Tech Stack:** Node ≥ 20 ESM (plain JavaScript), `@langchain/langgraph` 1.4, `@langchain/core` 1.2, `@langchain/openai` 1.6, `zod` 4, `node:test`.

**Spec:** GitHub issue [roomariz/amt-buddy#1](https://github.com/roomariz/amt-buddy/issues/1) — read it first, together with [`CONTEXT.md`](../../CONTEXT.md) (vocabulary) and [`docs/adr/`](../adr/) (0001 Tool contracts, 0002 missing facts end the turn, 0003 grounding check).

## Test seams

Agreed with the developer; do not add tests at other seams.

1. **Primary — the Orchestrator's public interface** (`createOrchestrator` → `send` / `getTenancy`), driven by a scripted fake chat model and the stub Tools. Everything behavioural is tested here, including grounding, Sub-agent gating, facts from Tool results, argument pinning and Intent routing.
2. **Secondary — Tenancy merge** (`mergeTenancy` and friends): the precedence rules.
3. **Secondary — Tool wrapper** (`wrapTool`): timeout, retry, error kinds, audit log, pinned arguments.

Plus the Tool contract test (stubs satisfy every contract) and the opt-in live smoke test.

## Global Constraints

- Plain JavaScript ES modules (`"type": "module"`), no TypeScript, no build step; Node ≥ 20.
- Tests use `node:test` + `node:assert/strict` and must run offline with `npm test`; no test may need an API key except the explicitly skipped live test.
- Dependencies: exactly `@langchain/langgraph@^1.4.18`, `@langchain/core@^1.2.13`, `@langchain/openai@^1.6.0`, `zod@^4.6.5`.
- Tool names are fixed: `validate_berlin_address`, `lookup_building_age`, `calculate_mietspiegel`, `assess_occupancy_compliance`, `extract_lease_data`.
- Tool timeout 10 s (`DEFAULT_TOOL_TIMEOUT_MS = 10_000`), exactly one retry, upstream failures only.
- Confidence threshold for Unconfirmed facts: `0.8`.
- No model name is hard-coded: `OPENAI_MODEL` (required), `OPENAI_ROUTER_MODEL` (optional).
- Audit log entries never contain Tool argument values or results.
- Use the domain vocabulary from `CONTEXT.md` in names, comments and prompts (Tenancy, Tenancy fact, Sub-agent, Intent, Canonical address, Compliance verdict).
- All code in this plan was run and passes in a scratch copy of the repo (67 tests including the existing suite, 1 skipped); the grounding and gating scenarios were mutation-checked (breaking the rule makes a scenario fail). Copy it exactly; if a step's expected output differs, stop and investigate rather than editing tests to pass.

## Review Focus

- **A short follow-up answer ("4 people", "yes")** must keep the Intents of the question it answers, never be rejected as out of scope → the router gets the last 6 messages and an explicit rule; pinned by the missing-fact scenario in Task 4 (asserts the router sees the previous question).
- **A Sub-agent model passing a value that differs from the Tenancy** (e.g. contract rent 800 while the Tenancy says 780) would produce a "grounded" but wrong verdict → Tool arguments are pinned to confirmed Tenancy values; pinned by the wrapper test in Task 3 and the multi-hop scenario in Task 4.
- **German-format numbers from the model or the review card** (`"720,50"`) and garbage values (`"abc"`) → parsed correctly or ignored, never stored as `NaN`; pinned by the last Tenancy test in Task 2 and the German answer in Task 4's multi-hop scenario.
- **A Supervisor that never stops delegating** → the graph's recursion limit (40) ends the turn with an `error` event instead of hanging; pinned by the runaway-loop scenario in Task 4.
- **A lower-precedence address (from a lease) arriving after a user-stated, verified address** must neither replace it nor wipe its official facts; pinned by the lease-address Tenancy test in Task 2.

---
### Task 1: Dependencies, Tool contracts and stub Tools

Adds the LangChain/LangGraph dependencies and the contract your teammates build their Tools against (ADR 0001). Stub Tools satisfy the contracts so the Orchestrator can be built and tested before the real Tools exist; the Mietspiegel and occupancy stubs delegate to the existing pure functions. The contract test is the agreed check that stubs (and, later, real Tools) match every input and output schema.

**Files:**
- Create: `src/orchestrator/tool-contracts.js`
- Create: `src/orchestrator/stub-tools.js`
Modify: `package.json` (dependencies)
Create: `.gitignore`
- Test: `test/orchestrator/tool-contracts.test.js`

**Interfaces:**
- Consumes: `evaluateMietspiegel(options)` from `src/berlin-mietspiegel.js`, `assessOccupancy(input)` from `src/occupancy-assessment.js`.
- Produces: `TOOL_CONTRACTS` (name → `{ name, description, schema, output }`), `TOOL_NAMES`, `assertToolsMatchContracts(tools) → Map<name, tool>` (throws `missing required tools: …`), `createStubTools(overrides?) → { tools, calls }` where `calls` is `[{ name, args }]`.

- [ ] **Step 1: Install dependencies**

Run: `npm install @langchain/langgraph@^1.4.18 @langchain/core@^1.2.13 @langchain/openai@^1.6.0 zod@^4.6.5`
Expected: `package.json` gains a `dependencies` block with those four packages and `package-lock.json` is created. Create `.gitignore` containing `node_modules/`.

- [ ] **Step 2: Write the failing tests**

`test/orchestrator/tool-contracts.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { assertToolsMatchContracts, TOOL_CONTRACTS, TOOL_NAMES } from "../../src/orchestrator/tool-contracts.js";
import { createStubTools } from "../../src/orchestrator/stub-tools.js";

test("stub tools satisfy every tool contract", async () => {
  const { tools } = createStubTools();
  const byName = assertToolsMatchContracts(tools);
  const sampleArgs = {
    validate_berlin_address: { address: "Berliner Straße 155, 10715 Berlin" },
    lookup_building_age: { longitude: 13.3295, latitude: 52.4872 },
    calculate_mietspiegel: { residentialLocation: "gut", buildingAgeOrYear: 1935, livingAreaSqm: 50, contractRent: 500 },
    assess_occupancy_compliance: { livingAreaSqm: 50, rooms: 2, occupants: 2, childrenUpToSix: 0 },
    extract_lease_data: { documentId: "doc-1" },
  };
  for (const name of TOOL_NAMES) {
    const result = await byName.get(name).invoke(sampleArgs[name]);
    assert.doesNotThrow(() => TOOL_CONTRACTS[name].output.parse(result), name);
  }
});

test("rejects a tool set with a missing tool", () => {
  const { tools } = createStubTools();
  assert.throws(
    () => assertToolsMatchContracts(tools.filter((t) => t.name !== "calculate_mietspiegel")),
    /missing required tools: calculate_mietspiegel/,
  );
});

test("stub overrides replace a handler and calls are recorded", async () => {
  const { tools, calls } = createStubTools({ validate_berlin_address: () => ({ verified: false, address: null }) });
  const byName = assertToolsMatchContracts(tools);
  assert.deepEqual(await byName.get("validate_berlin_address").invoke({ address: "Nowhere 1" }), {
    verified: false,
    address: null,
  });
  assert.deepEqual(calls, [{ name: "validate_berlin_address", args: { address: "Nowhere 1" } }]);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/orchestrator/tool-contracts.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for the module(s) this task creates.

- [ ] **Step 4: Write the implementation**

`src/orchestrator/tool-contracts.js`:

```js
import { z } from "zod";

const address = z.looseObject({
  street: z.string(),
  houseNumber: z.string(),
  postalCode: z.string(),
  district: z.string().nullable(),
  coordinates: z.object({ longitude: z.number(), latitude: z.number() }).nullable(),
  residentialLocation: z.enum(["einfach", "mittel", "gut"]).nullable(),
});

const extractedField = (value) => z.object({ value, confidence: z.number().min(0).max(1) });

export const TOOL_CONTRACTS = {
  validate_berlin_address: {
    name: "validate_berlin_address",
    description:
      "Verify a Berlin address against the official address register. Returns the official address, its coordinates and its Mietspiegel residential location (Wohnlage).",
    schema: z.object({
      address: z.string().describe("Free-form address, e.g. 'Berliner Straße 155, 10715 Berlin'"),
    }),
    output: z.looseObject({ verified: z.boolean(), address: address.nullable() }),
  },
  lookup_building_age: {
    name: "lookup_building_age",
    description:
      "Look up the official predominant construction period of the residential block at the given coordinates.",
    schema: z.object({ longitude: z.number(), latitude: z.number() }),
    output: z.looseObject({ predominantConstructionPeriod: z.string().nullable() }),
  },
  calculate_mietspiegel: {
    name: "calculate_mietspiegel",
    description:
      "Calculate the Berliner Mietspiegel 2026 reference rent range and compare an optional contract net cold rent against it.",
    schema: z.object({
      residentialLocation: z.enum(["einfach", "mittel", "gut"]),
      buildingAgeOrYear: z.union([z.number(), z.string()]),
      livingAreaSqm: z.number().positive(),
      contractRent: z.number().positive().optional(),
    }),
    output: z.looseObject({ status: z.string() }),
  },
  assess_occupancy_compliance: {
    name: "assess_occupancy_compliance",
    description: "Check the minimum living area per person under § 7 WoAufG Bln.",
    schema: z.object({
      livingAreaSqm: z.number().positive(),
      rooms: z.number().positive(),
      occupants: z.number().int().min(1),
      childrenUpToSix: z.number().int().min(0),
    }),
    output: z.looseObject({ status: z.string() }),
  },
  extract_lease_data: {
    name: "extract_lease_data",
    description: "Extract tenancy facts from an uploaded lease document, each with a confidence between 0 and 1.",
    schema: z.object({ documentId: z.string() }),
    output: z.looseObject({
      fields: z.object({
        address: extractedField(z.string()).optional(),
        contractRent: extractedField(z.number()).optional(),
        livingAreaSqm: extractedField(z.number()).optional(),
        rooms: extractedField(z.number()).optional(),
        buildingYear: extractedField(z.number()).optional(),
      }),
    }),
  },
};

export const TOOL_NAMES = Object.keys(TOOL_CONTRACTS);

export function assertToolsMatchContracts(tools) {
  const byName = new Map(tools.map((candidate) => [candidate.name, candidate]));
  const missing = TOOL_NAMES.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(`Orchestrator is missing required tools: ${missing.join(", ")}`);
  }
  for (const name of TOOL_NAMES) {
    if (typeof byName.get(name).invoke !== "function") {
      throw new Error(`Tool ${name} is not a LangChain tool (no invoke method)`);
    }
  }
  return byName;
}
```

`src/orchestrator/stub-tools.js`:

```js
import { tool } from "@langchain/core/tools";

import { evaluateMietspiegel } from "../berlin-mietspiegel.js";
import { assessOccupancy } from "../occupancy-assessment.js";
import { TOOL_CONTRACTS } from "./tool-contracts.js";

const DEFAULT_HANDLERS = {
  validate_berlin_address: () => ({
    verified: true,
    address: {
      street: "Berliner Straße",
      houseNumber: "155",
      postalCode: "10715",
      district: "Charlottenburg-Wilmersdorf",
      coordinates: { longitude: 13.3295, latitude: 52.4872 },
      residentialLocation: "gut",
    },
  }),
  lookup_building_age: () => ({ predominantConstructionPeriod: "1921 - 1930" }),
  calculate_mietspiegel: (args) => evaluateMietspiegel(args),
  assess_occupancy_compliance: (args) => assessOccupancy(args),
  extract_lease_data: () => ({
    fields: {
      address: { value: "Berliner Straße 155, 10715 Berlin", confidence: 0.95 },
      contractRent: { value: 780, confidence: 0.6 },
      livingAreaSqm: { value: 50, confidence: 0.92 },
      rooms: { value: 2, confidence: 0.9 },
    },
  }),
};

// Contract-conforming fake Tools for tests and for running the Orchestrator
// before the real Tools exist. `overrides` replaces a handler by tool name.
export function createStubTools(overrides = {}) {
  const calls = [];
  const tools = Object.values(TOOL_CONTRACTS).map((contract) => {
    const handler = overrides[contract.name] ?? DEFAULT_HANDLERS[contract.name];
    return tool(
      async (args) => {
        calls.push({ name: contract.name, args });
        return handler(args);
      },
      { name: contract.name, description: contract.description, schema: contract.schema },
    );
  });
  return { tools, calls };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/orchestrator/tool-contracts.test.js` and then `npm test`
Expected: all tests in the task PASS; `npm test` shows `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore src/orchestrator/tool-contracts.js src/orchestrator/stub-tools.js test/orchestrator/tool-contracts.test.js
git commit -m "feat(orchestrator): add Tool contracts and stub Tools"
```

### Task 2: Tenancy and its precedence rules (secondary seam)

The Tenancy is the single set of facts every check reads. `mergeTenancy` applies the agreed precedence (user > lease > official; latest user statement wins; the Canonical address replaces the stated one and keeps the precedence of whoever stated it; a replaced address clears facts derived from the old one; German-format numbers are parsed and unparsable values ignored). This is one of the two agreed secondary test seams. `numbers.js` is an internal helper, also reused by the grounding check in Task 4, and is tested only through this seam and through `send()`.

**Files:**
- Create: `src/orchestrator/numbers.js`
- Create: `src/orchestrator/tenancy.js`
- Test: `test/orchestrator/tenancy.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseNumber(token) → number | null`; `STATED_FACTS`, `OFFICIAL_ONLY_FACTS`, `TENANCY_FACTS`, `CONFIDENCE_THRESHOLD` (0.8); `mergeTenancy(tenancy, updates) → tenancy` where an update is `{ fact, value, source: "user"|"lease"|"official", confidence? }` and a stored fact is `{ value, source, confidence?, statedBy? }`; `tenancyReducer(current, updates | null)`; `isUnconfirmed(fact)`; `factsFromConfirm(confirm) → updates`; `confirmedValues(tenancy) → { fact: value }`.

- [ ] **Step 1: Write the failing tests**

`test/orchestrator/tenancy.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  confirmedValues,
  factsFromConfirm,
  isUnconfirmed,
  mergeTenancy,
  tenancyReducer,
} from "../../src/orchestrator/tenancy.js";

test("a user statement beats an extracted lease value", () => {
  const tenancy = mergeTenancy({}, [
    { fact: "livingAreaSqm", value: 50, source: "lease", confidence: 0.92 },
    { fact: "livingAreaSqm", value: 52, source: "user" },
  ]);
  assert.deepEqual(tenancy.livingAreaSqm, { value: 52, source: "user" });
});

test("a later lease value does not overwrite a user statement", () => {
  const tenancy = mergeTenancy({ contractRent: { value: 720, source: "user" } }, [
    { fact: "contractRent", value: 780, source: "lease", confidence: 0.99 },
  ]);
  assert.equal(tenancy.contractRent.value, 720);
});

test("the most recent user statement wins", () => {
  const tenancy = mergeTenancy({ contractRent: { value: 780, source: "user" } }, [
    { fact: "contractRent", value: "720", source: "user" },
  ]);
  assert.deepEqual(tenancy.contractRent, { value: 720, source: "user" });
});

test("a lease building year beats the official block estimate", () => {
  const tenancy = mergeTenancy({}, [
    { fact: "buildingYear", value: "1950 - 1959", source: "official" },
    { fact: "buildingYear", value: 1935, source: "lease", confidence: 0.9 },
  ]);
  assert.equal(tenancy.buildingYear.value, 1935);
  const reversed = mergeTenancy(tenancy, [{ fact: "buildingYear", value: "1950 - 1959", source: "official" }]);
  assert.equal(reversed.buildingYear.value, 1935);
});

test("the Canonical address replaces the typed address", () => {
  const tenancy = mergeTenancy({ address: { value: "Berliner Str. 155", source: "user" } }, [
    { fact: "address", value: "Berliner Straße 155, 10715 Berlin", source: "official" },
    { fact: "residentialLocation", value: "gut", source: "official" },
  ]);
  assert.deepEqual(tenancy.address, {
    value: "Berliner Straße 155, 10715 Berlin",
    source: "official",
    statedBy: "user",
  });
  assert.equal(tenancy.residentialLocation.value, "gut");
});

test("a newly stated address clears facts derived from the old one", () => {
  const before = {
    address: { value: "Berliner Straße 155, 10715 Berlin", source: "official" },
    coordinates: { value: { longitude: 13.3, latitude: 52.4 }, source: "official" },
    residentialLocation: { value: "gut", source: "official" },
    buildingYear: { value: "1921 - 1930", source: "official" },
    livingAreaSqm: { value: 50, source: "user" },
  };
  const after = mergeTenancy(before, [{ fact: "address", value: "Karl-Marx-Allee 1", source: "user" }]);
  assert.deepEqual(Object.keys(after).sort(), ["address", "livingAreaSqm"]);
  assert.equal(after.address.value, "Karl-Marx-Allee 1");
});

test("restating the canonical address keeps derived facts", () => {
  const before = {
    address: { value: "Berliner Straße 155, 10715 Berlin", source: "official" },
    residentialLocation: { value: "gut", source: "official" },
  };
  const after = mergeTenancy(before, [
    { fact: "address", value: "Berliner Straße 155, 10715 Berlin", source: "user" },
  ]);
  assert.equal(after.residentialLocation.value, "gut");
});

test("a lease address neither replaces a user-stated canonical address nor clears its facts", () => {
  const before = {
    address: { value: "Berliner Straße 155, 10715 Berlin", source: "official", statedBy: "user" },
    residentialLocation: { value: "gut", source: "official" },
  };
  const after = mergeTenancy(before, [{ fact: "address", value: "Hauptstr. 1", source: "lease", confidence: 0.9 }]);
  assert.deepEqual(after, before);
});

test("a lease fact below 0.8 confidence is unconfirmed until the user confirms it", () => {
  let tenancy = mergeTenancy({}, [{ fact: "contractRent", value: 780, source: "lease", confidence: 0.6 }]);
  assert.equal(isUnconfirmed(tenancy.contractRent), true);
  assert.deepEqual(confirmedValues(tenancy), {});
  tenancy = mergeTenancy(tenancy, factsFromConfirm({ contractRent: 780 }));
  assert.equal(isUnconfirmed(tenancy.contractRent), false);
  assert.deepEqual(confirmedValues(tenancy), { contractRent: 780 });
});

test("unknown facts and empty values are ignored; null resets the Tenancy", () => {
  const tenancy = tenancyReducer({}, [
    { fact: "petName", value: "Rex", source: "user" },
    { fact: "rooms", value: "", source: "user" },
  ]);
  assert.deepEqual(tenancy, {});
  assert.deepEqual(tenancyReducer({ rooms: { value: 2, source: "user" } }, null), {});
});

test("numeric facts accept German decimals and ignore unparsable values", () => {
  const tenancy = mergeTenancy({ occupants: { value: 2, source: "user" } }, [
    { fact: "contractRent", value: "720,50", source: "user" },
    { fact: "occupants", value: "abc", source: "user" },
  ]);
  assert.deepEqual(tenancy.contractRent, { value: 720.5, source: "user" });
  assert.deepEqual(tenancy.occupants, { value: 2, source: "user" });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/orchestrator/tenancy.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for the module(s) this task creates.

- [ ] **Step 3: Write the implementation**

`src/orchestrator/numbers.js`:

```js
// Parses a number written in German ("1.234,56", "9,20") or English ("1,234.56", "9.20")
// notation, rounded to cents. Returns null when the token is not a number.
export function parseNumber(token) {
  const hasDot = token.includes(".");
  const hasComma = token.includes(",");
  let normalised = token;
  if (hasDot && hasComma) {
    const decimal = token.lastIndexOf(".") > token.lastIndexOf(",") ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    normalised = token.split(thousands).join("").replace(decimal, ".");
  } else if (hasComma) {
    normalised = /^\d{1,3}(,\d{3})+$/.test(token) ? token.replaceAll(",", "") : token.replace(",", ".");
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(token)) {
    normalised = token.replaceAll(".", "");
  }
  const value = Number(normalised);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}
```

`src/orchestrator/tenancy.js`:

```js
import { parseNumber } from "./numbers.js";

// Facts the user (or a lease) can state about their Tenancy.
export const STATED_FACTS = [
  "address",
  "livingAreaSqm",
  "contractRent",
  "buildingYear",
  "rooms",
  "occupants",
  "childrenUpToSix",
];

// Facts only official data supplies; they belong to the current address.
export const OFFICIAL_ONLY_FACTS = ["coordinates", "residentialLocation"];

export const TENANCY_FACTS = [...STATED_FACTS, ...OFFICIAL_ONLY_FACTS];

const NUMERIC_FACTS = new Set(["livingAreaSqm", "contractRent", "rooms", "occupants", "childrenUpToSix"]);
const SOURCE_RANK = { official: 1, lease: 2, user: 3 };
export const CONFIDENCE_THRESHOLD = 0.8;

export function isUnconfirmed(fact) {
  return fact?.source === "lease" && (fact.confidence ?? 0) < CONFIDENCE_THRESHOLD;
}

// Numeric facts accept numbers or German/English numeric strings ("720,50");
// anything unparsable yields undefined and the update is ignored.
function coerce(name, value) {
  if (NUMERIC_FACTS.has(name)) return typeof value === "number" ? value : (parseNumber(String(value).trim()) ?? undefined);
  if (name === "buildingYear" && /^\d{4}$/.test(String(value).trim())) return Number(value);
  return value;
}

function clearAddressDerivedFacts(tenancy) {
  for (const name of OFFICIAL_ONLY_FACTS) delete tenancy[name];
  if (tenancy.buildingYear?.source === "official") delete tenancy.buildingYear;
}

function rank(fact) {
  // A Canonical address keeps the precedence of the statement it canonicalised.
  if (fact.source === "official" && fact.statedBy) return SOURCE_RANK[fact.statedBy];
  return SOURCE_RANK[fact.source];
}

// Applies Tenancy fact updates in order. Precedence: user > lease > official,
// except that an official address (the Canonical address) always replaces the
// stated one. A replaced address invalidates facts derived from the old one.
export function mergeTenancy(current, updates) {
  const next = { ...current };
  for (const { fact: name, value, source, confidence } of updates) {
    if (!TENANCY_FACTS.includes(name) || value === undefined || value === null || value === "") continue;
    const coerced = coerce(name, value);
    if (coerced === undefined || Number.isNaN(coerced)) continue;
    const incoming = { value: coerced, source };
    if (confidence !== undefined) incoming.confidence = confidence;
    const existing = next[name];

    if (name === "address" && source === "official") {
      const statedBy = existing?.statedBy ?? (existing?.source !== "official" ? existing?.source : undefined);
      next.address = statedBy ? { ...incoming, statedBy } : incoming;
      continue;
    }

    if (existing && SOURCE_RANK[source] < rank(existing)) continue;
    if (name === "address" && existing?.value !== incoming.value) clearAddressDerivedFacts(next);
    next[name] = incoming;
  }
  return next;
}

export function tenancyReducer(current, updates) {
  if (updates === null) return {};
  return mergeTenancy(current, updates);
}

export function factsFromConfirm(confirm) {
  return Object.entries(confirm ?? {})
    .filter(([name]) => STATED_FACTS.includes(name))
    .map(([fact, value]) => ({ fact, value, source: "user" }));
}

// Plain values of every fact a Sub-agent may rely on (Unconfirmed facts excluded).
export function confirmedValues(tenancy) {
  return Object.fromEntries(
    Object.entries(tenancy)
      .filter(([, fact]) => !isUnconfirmed(fact))
      .map(([name, fact]) => [name, fact.value]),
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/orchestrator/tenancy.test.js` and then `npm test`
Expected: all tests in the task PASS; `npm test` shows `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/numbers.js src/orchestrator/tenancy.js test/orchestrator/tenancy.test.js
git commit -m "feat(orchestrator): add Tenancy with precedence rules"
```

### Task 3: Tool wrapper: timeout, retry, audit log, pinned arguments (secondary seam)

Every Tool call goes through `wrapTool`: 10 s timeout, one retry for upstream failures only, input errors never retried, errors returned to the model as JSON rather than thrown, one PII-free audit line per call (argument names, never values), and `pinnedArgs` that override whatever the model passed. This is the second agreed secondary seam: Tool authors rely on this behaviour, and it needs controlled failing Tools to exercise.

**Files:**
- Create: `src/orchestrator/tool-wrapper.js`
- Test: `test/orchestrator/tool-wrapper.test.js`

**Interfaces:**
- Consumes: `OccupancyInputError` from `src/occupancy-assessment.js` (tests only).
- Produces: `DEFAULT_TOOL_TIMEOUT_MS` (10000); `errorKind(error) → "input" | "upstream"`; `defaultAuditLog(entry)`; `wrapTool(baseTool, { agent, threadId, timeoutMs?, retries?, log?, onEvidence?, pinnedArgs? }) → tool` whose output is a JSON string (the result, or `{ error, message }`); audit entry `{ event: "tool_call", threadId, agent, tool, argKeys, attempts, latencyMs, outcome: "ok"|"error", errorKind? }`; evidence entry `{ tool, args, result }` or `{ tool, args, error: { kind, message } }`.

- [ ] **Step 1: Write the failing tests**

`test/orchestrator/tool-wrapper.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { OccupancyInputError } from "../../src/occupancy-assessment.js";
import { errorKind, wrapTool } from "../../src/orchestrator/tool-wrapper.js";

function fakeTool(impl) {
  let calls = 0;
  const base = tool(async (args) => impl(args, ++calls), {
    name: "lookup_building_age",
    description: "test",
    schema: z.object({ longitude: z.number(), latitude: z.number() }),
  });
  return { base, calls: () => calls };
}

function wrap(base, extra = {}) {
  const logs = [];
  const evidence = [];
  const wrapped = wrapTool(base, {
    agent: "official_data",
    threadId: "t-1",
    timeoutMs: 50,
    log: (entry) => logs.push(entry),
    onEvidence: (entry) => evidence.push(entry),
    ...extra,
  });
  return { wrapped, logs, evidence };
}

const ARGS = { longitude: 13.3, latitude: 52.4 };

test("returns the result as JSON, records evidence and logs no argument values", async () => {
  const { base } = fakeTool(() => ({ predominantConstructionPeriod: "1921 - 1930" }));
  const { wrapped, logs, evidence } = wrap(base);
  assert.equal(await wrapped.invoke(ARGS), JSON.stringify({ predominantConstructionPeriod: "1921 - 1930" }));
  assert.deepEqual(evidence, [
    { tool: "lookup_building_age", args: ARGS, result: { predominantConstructionPeriod: "1921 - 1930" } },
  ]);
  assert.equal(logs.length, 1);
  assert.deepEqual(
    { ...logs[0], latencyMs: 0 },
    {
      event: "tool_call",
      threadId: "t-1",
      agent: "official_data",
      tool: "lookup_building_age",
      argKeys: ["longitude", "latitude"],
      attempts: 1,
      latencyMs: 0,
      outcome: "ok",
    },
  );
  assert.doesNotMatch(JSON.stringify(logs), /13\.3/);
});

test("retries an upstream failure once and then succeeds", async () => {
  const { base, calls } = fakeTool((_, n) => {
    if (n === 1) throw new Error("Berlin building-age service returned 503");
    return { predominantConstructionPeriod: "1921 - 1930" };
  });
  const { wrapped, logs } = wrap(base);
  assert.match(await wrapped.invoke(ARGS), /1921 - 1930/);
  assert.equal(calls(), 2);
  assert.equal(logs[0].attempts, 2);
});

test("gives up after one retry and returns a structured upstream error", async () => {
  const { base, calls } = fakeTool(() => {
    throw new Error("down");
  });
  const { wrapped, logs, evidence } = wrap(base);
  assert.deepEqual(JSON.parse(await wrapped.invoke(ARGS)), { error: "upstream", message: "down" });
  assert.equal(calls(), 2);
  assert.equal(logs[0].outcome, "error");
  assert.equal(logs[0].errorKind, "upstream");
  assert.deepEqual(evidence[0].error, { kind: "upstream", message: "down" });
});

test("times out a slow tool and counts it as upstream", async () => {
  const { base, calls } = fakeTool(() => new Promise(() => {}));
  const { wrapped } = wrap(base);
  const result = JSON.parse(await wrapped.invoke(ARGS));
  assert.equal(result.error, "upstream");
  assert.match(result.message, /did not respond within 50 ms/);
  assert.equal(calls(), 2);
});

test("never retries an input error", async () => {
  const { base, calls } = fakeTool(() => {
    throw new OccupancyInputError([{ field: "occupants", code: "required" }]);
  });
  const { wrapped } = wrap(base);
  assert.equal(JSON.parse(await wrapped.invoke(ARGS)).error, "input");
  assert.equal(calls(), 1);
});

test("pinned arguments override what the model passed", async () => {
  const seen = [];
  const { base } = fakeTool((args) => {
    seen.push(args);
    return { predominantConstructionPeriod: null };
  });
  const { wrapped } = wrap(base, { pinnedArgs: { longitude: 13.3295 } });
  await wrapped.invoke({ longitude: 99, latitude: 52.4 });
  assert.deepEqual(seen, [{ longitude: 13.3295, latitude: 52.4 }]);
});

test("classifies errors", () => {
  assert.equal(errorKind(Object.assign(new Error("x"), { kind: "input" })), "input");
  assert.equal(errorKind(new OccupancyInputError([])), "input");
  assert.equal(errorKind(new TypeError("fetch failed")), "upstream");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/orchestrator/tool-wrapper.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for the module(s) this task creates.

- [ ] **Step 3: Write the implementation**

`src/orchestrator/tool-wrapper.js`:

```js
import { tool } from "@langchain/core/tools";

export const DEFAULT_TOOL_TIMEOUT_MS = 10_000;

class ToolTimeoutError extends Error {
  constructor(name, timeoutMs) {
    super(`${name} did not respond within ${timeoutMs} ms`);
    this.name = "ToolTimeoutError";
  }
}

// "input": the arguments were wrong (never retried; the user or model must fix them).
// "upstream": everything else, e.g. the Berlin WFS being slow or down.
export function errorKind(error) {
  if (error?.kind === "input" || error?.kind === "upstream") return error.kind;
  if (/InputError$/.test(error?.name ?? "")) return "input";
  if (error?.name === "ToolInputParsingException" || error?.name === "ZodError") return "input";
  return "upstream";
}

function withTimeout(promise, timeoutMs, name) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ToolTimeoutError(name, timeoutMs)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function defaultAuditLog(entry) {
  console.log(JSON.stringify(entry));
}

// Wraps a Tool with a timeout, one retry for upstream failures, a PII-free audit
// log entry per call, and structured errors returned to the model instead of thrown.
// `pinnedArgs` override whatever the model passed, so Tools always see Tenancy values.
export function wrapTool(
  baseTool,
  {
    agent,
    threadId,
    timeoutMs = DEFAULT_TOOL_TIMEOUT_MS,
    retries = 1,
    log = defaultAuditLog,
    onEvidence = () => {},
    pinnedArgs = {},
  },
) {
  return tool(
    async (modelArgs) => {
      const args = { ...modelArgs, ...pinnedArgs };
      const startedAt = Date.now();
      let attempts = 0;
      let lastError;
      while (attempts <= retries) {
        attempts += 1;
        try {
          const result = await withTimeout(Promise.resolve(baseTool.invoke(args)), timeoutMs, baseTool.name);
          log({
            event: "tool_call",
            threadId,
            agent,
            tool: baseTool.name,
            argKeys: Object.keys(args ?? {}),
            attempts,
            latencyMs: Date.now() - startedAt,
            outcome: "ok",
          });
          onEvidence({ tool: baseTool.name, args, result });
          return JSON.stringify(result);
        } catch (error) {
          lastError = error;
          if (errorKind(error) === "input") break;
        }
      }
      const failure = { kind: errorKind(lastError), message: lastError?.message ?? String(lastError) };
      log({
        event: "tool_call",
        threadId,
        agent,
        tool: baseTool.name,
        argKeys: Object.keys(args ?? {}),
        attempts,
        latencyMs: Date.now() - startedAt,
        outcome: "error",
        errorKind: failure.kind,
      });
      onEvidence({ tool: baseTool.name, args, error: failure });
      return JSON.stringify({ error: failure.kind, message: failure.message });
    },
    { name: baseTool.name, description: baseTool.description, schema: baseTool.schema },
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/orchestrator/tool-wrapper.test.js` and then `npm test`
Expected: all tests in the task PASS; `npm test` shows `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/tool-wrapper.js test/orchestrator/tool-wrapper.test.js
git commit -m "feat(orchestrator): wrap Tools with timeout, retry and audit log"
```

### Task 4: The Orchestrator: graph and createOrchestrator (primary seam)

Builds everything behind the primary seam, `createOrchestrator` → `send()` / `getTenancy()`, and tests it **only** through that seam, with a scripted fake chat model and the stub Tools. The internal modules (replies, Intent router pieces, facts from Tool results, Sub-agent gating, grounding check, Sub-agent runner, Supervisor, graph, event translation) have no tests of their own by design: they may be refactored freely as long as the scenarios pass.

The scenarios cover: out-of-scope rejection; a mixed Intent treated as in scope; the disclaimer once per thread and on every Compliance verdict; the multi-hop Official Data → Compliance chain with a German, grounded answer (German number formats, a rounded value, a legal citation) and an argument the Sub-agent model got wrong being pinned back to the Tenancy value; Sub-agents reporting `needs_facts` without calling Tools; a missing fact ending the turn and the router seeing the question on the next turn; a correction re-running the check; an unconfirmed lease fact blocking the verdict until confirmed; an unverified address adding no official facts; grounding rewrite, stripping and fallback; an upstream failure; input validation; a runaway Supervisor loop; and a missing Tool contract.

The answer text is emitted as a single `token` event by `finalize`, after the grounding check, so no ungrounded text ever reaches the UI.

**Files:**
- Create: `src/orchestrator/replies.js`
- Create: `src/orchestrator/intents.js`
- Create: `src/orchestrator/evidence.js`
- Create: `src/orchestrator/requirements.js`
- Create: `src/orchestrator/grounding.js`
- Create: `src/orchestrator/sub-agents.js`
- Create: `src/orchestrator/supervisor.js`
- Create: `src/orchestrator/graph.js`
- Create: `src/orchestrator/events.js`
- Create: `src/orchestrator/index.js`
- Test: `test/orchestrator/helpers/scripted-model.js`
- Test: `test/orchestrator/orchestrator.test.js`

**Interfaces:**
- Consumes: Tasks 1–3 with the signatures listed there.
- Produces: `createOrchestrator({ models: { router, supervisor, subAgent }, tools, checkpointer?, log?, toolTimeoutMs? }) → { send, getTenancy }`; `send({ threadId, message?, documentId?, confirm? })` is an async generator of `{ type: "intent" | "agent_step" | "tenancy" | "token" | "done" | "error", … }`; `getTenancy(threadId) → Promise<tenancy>`; `index.js` also re-exports `TOOL_CONTRACTS` and `createStubTools`. Test helper: `ScriptedChatModel(script)` with `calls` and `remaining`.

- [ ] **Step 1: Write the failing tests**

`test/orchestrator/helpers/scripted-model.js`:

```js
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";

let nextCallId = 0;

// A fake chat model that replays a script, one entry per model call:
// - a string        → an AIMessage with that text
// - { toolCalls }   → an AIMessage calling those tools: [{ name, args }]
// - any other object → the parsed result of withStructuredOutput()
// Every call's input messages are recorded in `calls`.
export class ScriptedChatModel extends BaseChatModel {
  constructor(script) {
    super({});
    this.script = [...script];
    this.calls = [];
  }

  _llmType() {
    return "scripted";
  }

  bindTools() {
    return this;
  }

  withStructuredOutput() {
    return RunnableLambda.from(async (messages) => {
      this.calls.push(messages);
      return this.#next();
    });
  }

  async _generate(messages) {
    this.calls.push(messages);
    const entry = this.#next();
    const message =
      typeof entry === "string"
        ? new AIMessage(entry)
        : new AIMessage({
            content: "",
            tool_calls: entry.toolCalls.map(({ name, args }) => ({ id: `call_${++nextCallId}`, name, args })),
          });
    return { generations: [{ message, text: typeof entry === "string" ? entry : "" }] };
  }

  get remaining() {
    return this.script.length;
  }

  #next() {
    if (this.script.length === 0) throw new Error("ScriptedChatModel ran out of scripted responses");
    return this.script.shift();
  }
}
```

`test/orchestrator/orchestrator.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { createOrchestrator } from "../../src/orchestrator/index.js";
import { createStubTools } from "../../src/orchestrator/stub-tools.js";
import { ScriptedChatModel } from "./helpers/scripted-model.js";

function setup({ router = [], supervisor = [], subAgent = [], toolOverrides } = {}) {
  const models = {
    router: new ScriptedChatModel(router),
    supervisor: new ScriptedChatModel(supervisor),
    subAgent: new ScriptedChatModel(subAgent),
  };
  const { tools, calls } = createStubTools(toolOverrides);
  const logs = [];
  const orchestrator = createOrchestrator({ models, tools, log: (entry) => logs.push(entry), toolTimeoutMs: 50 });
  return { orchestrator, models, calls, logs };
}

async function collect(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

const answerOf = (events) => events.filter((e) => e.type === "token").map((e) => e.text).join("");
const stepsOf = (events) => events.filter((e) => e.type === "agent_step").map((e) => `${e.agent}:${e.status}`);

const OFFICIAL_DATA_SCRIPT = [
  { toolCalls: [{ name: "validate_berlin_address", args: { address: "Berliner Str. 155" } }] },
  { toolCalls: [{ name: "lookup_building_age", args: { longitude: 13.3295, latitude: 52.4872 } }] },
  "Address verified, Wohnlage gut, block built 1921 - 1930.",
];

test("an out-of-scope request is rejected without reaching the Supervisor", async () => {
  const { orchestrator, models } = setup({ router: [{ intents: ["out_of_scope"], language: "en" }] });

  const events = await collect(orchestrator.send({ threadId: "t1", message: "Write me a poem about cats" }));

  assert.deepEqual(events[0], { type: "intent", intents: ["out_of_scope"] });
  assert.match(answerOf(events), /I can only help with Berlin housing questions/);
  assert.equal(events.at(-1).type, "done");
  assert.equal(models.supervisor.calls.length, 0);
});

test("a general question gets the disclaimer once per thread", async () => {
  const { orchestrator } = setup({
    router: [
      { intents: ["general"], language: "en" },
      { intents: ["general"], language: "en" },
    ],
    supervisor: [
      "Kaltmiete (cold rent) excludes heating and service charges; Warmmiete (warm rent) includes them.",
      "An Anmeldung (residence registration) is required when you move.",
    ],
  });

  const first = answerOf(await collect(orchestrator.send({ threadId: "t2", message: "Kaltmiete vs Warmmiete?" })));
  const second = answerOf(await collect(orchestrator.send({ threadId: "t2", message: "What is an Anmeldung?" })));

  assert.match(first, /not legal advice/);
  assert.doesNotMatch(second, /not legal advice/);
});

test("one turn chains Official Data and Compliance into a grounded Mietspiegel verdict", async () => {
  const { orchestrator, models, calls, logs } = setup({
    router: [{ intents: ["address", "mietspiegel"], language: "de" }],
    supervisor: [
      {
        toolCalls: [
          {
            name: "record_tenancy_facts",
            args: {
              facts: [
                { fact: "address", value: "Berliner Str. 155" },
                { fact: "livingAreaSqm", value: 50 },
                { fact: "contractRent", value: 780 },
              ],
            },
          },
          { name: "ask_official_data_agent", args: { request: "Verify the address" } },
        ],
      },
      { toolCalls: [{ name: "ask_compliance_agent", args: { request: "Check the rent", checks: ["mietspiegel"] } }] },
      // German number formats, a rounded value (15.6 → 16) and a citation, all grounded in the Tool result.
      "Ihre Nettokaltmiete von 780 € liegt 225,00 € über der Obergrenze des Mietspiegels 2026 (8,20–11,10 €/m², also 410–555 € für 50 m², §§ 558c, 558d BGB). Das sind rund 16 €/m².",
    ],
    subAgent: [
      ...OFFICIAL_DATA_SCRIPT,
      {
        toolCalls: [
          {
            name: "calculate_mietspiegel",
            // The Sub-agent model drifts from the Tenancy (800 instead of 780); pinning corrects it.
            args: { residentialLocation: "gut", buildingAgeOrYear: "1921 - 1930", livingAreaSqm: 50, contractRent: 800 },
          },
        ],
      },
      "Mietspiegel calculated; contract rent above the upper threshold.",
    ],
  });

  const events = await collect(
    orchestrator.send({ threadId: "t3", message: "Berliner Str. 155, 50 m², 780 € kalt. Zahle ich zu viel?" }),
  );

  assert.deepEqual(stepsOf(events), [
    "OfficialDataAgent:started",
    "OfficialDataAgent:finished",
    "ComplianceAgent:started",
    "ComplianceAgent:finished",
  ]);
  assert.deepEqual(
    calls.map((c) => c.name),
    ["validate_berlin_address", "lookup_building_age", "calculate_mietspiegel"],
  );
  assert.equal(calls[2].args.contractRent, 780);
  const tenancy = await orchestrator.getTenancy("t3");
  assert.deepEqual(tenancy.address, { value: "Berliner Straße 155, 10715 Berlin", source: "official", statedBy: "user" });
  assert.equal(tenancy.residentialLocation.value, "gut");
  assert.deepEqual(tenancy.buildingYear, { value: "1921 - 1930", source: "official" });
  const answer = answerOf(events);
  assert.match(answer, /225,00 € über der Obergrenze/);
  assert.match(answer, /rund 16 €\/m²/);
  assert.doesNotMatch(answer, /weggelassen/);
  assert.match(answer, /keine Rechtsberatung/);
  assert.equal(models.supervisor.calls.length, 3, "no grounding rewrite was needed");
  assert.ok(events.some((e) => e.type === "tenancy"));
  assert.equal(logs.length, 3);
});

test("a missing fact ends the turn with a question, and the next turn completes the check", async () => {
  const { orchestrator, models, calls } = setup({
    router: [
      { intents: ["occupancy"], language: "en" },
      { intents: ["occupancy"], language: "en" },
    ],
    supervisor: [
      {
        toolCalls: [
          {
            name: "record_tenancy_facts",
            args: { facts: [{ fact: "livingAreaSqm", value: 50 }, { fact: "rooms", value: 2 }] },
          },
          { name: "ask_compliance_agent", args: { request: "Check occupancy", checks: ["occupancy"] } },
        ],
      },
      "How many people live in the flat, and how many of them are children up to six?",
      {
        toolCalls: [
          {
            name: "record_tenancy_facts",
            args: { facts: [{ fact: "occupants", value: 4 }, { fact: "childrenUpToSix", value: 1 }] },
          },
          { name: "ask_compliance_agent", args: { request: "Check occupancy", checks: ["occupancy"] } },
        ],
      },
      "For 4 people (1 child up to six) the flat needs 33 m²; your 50 m² meets § 7 WoAufG Bln.",
    ],
    subAgent: [
      {
        toolCalls: [
          { name: "assess_occupancy_compliance", args: { livingAreaSqm: 50, rooms: 2, occupants: 4, childrenUpToSix: 1 } },
        ],
      },
      "Meets minimum; required 33 m².",
    ],
  });

  const first = await collect(orchestrator.send({ threadId: "t4", message: "Is my 50 m² 2-room flat overcrowded?" }));
  assert.deepEqual(stepsOf(first), ["ComplianceAgent:needs_facts"]);
  assert.match(answerOf(first), /How many people/);
  assert.equal(calls.length, 0);

  const second = await collect(orchestrator.send({ threadId: "t4", message: "4 people, one is 3 years old" }));
  const routerInput = models.router.calls[1].map((m) => m.content).join("\n");
  assert.match(routerInput, /How many people live in the flat/, "the router sees the question being answered");
  assert.deepEqual(stepsOf(second), ["ComplianceAgent:started", "ComplianceAgent:finished"]);
  assert.match(answerOf(second), /needs 33 m²/);
});

test("a correction replaces the fact and the check re-runs with the new value", async () => {
  const mietspiegelCall = (contractRent) => ({
    toolCalls: [
      {
        name: "calculate_mietspiegel",
        args: { residentialLocation: "gut", buildingAgeOrYear: "1921 - 1930", livingAreaSqm: 50, contractRent },
      },
    ],
  });
  const { orchestrator, calls } = setup({
    router: [
      { intents: ["mietspiegel"], language: "en" },
      { intents: ["mietspiegel"], language: "en" },
    ],
    supervisor: [
      {
        toolCalls: [
          {
            name: "record_tenancy_facts",
            args: {
              facts: [
                { fact: "address", value: "Berliner Str. 155" },
                { fact: "livingAreaSqm", value: 50 },
                { fact: "contractRent", value: 780 },
              ],
            },
          },
          { name: "ask_official_data_agent", args: { request: "Verify" } },
          { name: "ask_compliance_agent", args: { request: "Rent check", checks: ["mietspiegel"] } },
        ],
      },
      "Your rent of 780 € is above the range.",
      {
        toolCalls: [
          { name: "record_tenancy_facts", args: { facts: [{ fact: "contractRent", value: 720 }] } },
          { name: "ask_compliance_agent", args: { request: "Rent check", checks: ["mietspiegel"] } },
        ],
      },
      "With 720 € your rent is still above the range.",
    ],
    subAgent: [
      ...OFFICIAL_DATA_SCRIPT,
      mietspiegelCall(780),
      "Calculated.",
      mietspiegelCall(720),
      "Calculated.",
    ],
  });

  await collect(orchestrator.send({ threadId: "t5", message: "Berliner Str. 155, 50 m², 780 € cold" }));
  const second = await collect(orchestrator.send({ threadId: "t5", message: "Actually the cold rent is 720, not 780" }));

  assert.deepEqual((await orchestrator.getTenancy("t5")).contractRent, { value: 720, source: "user" });
  assert.equal(calls.filter((c) => c.name === "calculate_mietspiegel").at(-1).args.contractRent, 720);
  assert.match(answerOf(second), /With 720 €/);
  assert.match(answerOf(second), /not legal advice/, "every Compliance verdict carries the disclaimer");
});

test("an unconfirmed lease fact blocks the verdict until the user confirms it", async () => {
  const { orchestrator, calls } = setup({
    router: [{ intents: ["document", "mietspiegel"], language: "en" }],
    supervisor: [
      { toolCalls: [{ name: "ask_lease_analysis_agent", args: { request: "Extract facts" } }] },
      { toolCalls: [{ name: "ask_official_data_agent", args: { request: "Verify" } }] },
      { toolCalls: [{ name: "ask_compliance_agent", args: { request: "Rent check", checks: ["mietspiegel"] } }] },
      "I read a Nettokaltmiete (net cold rent) of 780 € but I'm not sure. Is that right?",
      { toolCalls: [{ name: "ask_compliance_agent", args: { request: "Rent check", checks: ["mietspiegel"] } }] },
      "Your confirmed rent of 780 € is above the range.",
    ],
    subAgent: [
      { toolCalls: [{ name: "extract_lease_data", args: { documentId: "doc-1" } }] },
      "Extracted; contract rent has confidence 0.6.",
      ...OFFICIAL_DATA_SCRIPT,
      {
        toolCalls: [
          {
            name: "calculate_mietspiegel",
            args: { residentialLocation: "gut", buildingAgeOrYear: "1921 - 1930", livingAreaSqm: 50, contractRent: 780 },
          },
        ],
      },
      "Calculated.",
    ],
  });

  const first = await collect(
    orchestrator.send({ threadId: "t6", message: "Here is my lease. Am I overpaying?", documentId: "doc-1" }),
  );
  assert.ok(stepsOf(first).includes("ComplianceAgent:needs_facts"));
  assert.equal(calls.some((c) => c.name === "calculate_mietspiegel"), false);
  assert.equal((await orchestrator.getTenancy("t6")).contractRent.confidence, 0.6);

  const second = await collect(orchestrator.send({ threadId: "t6", confirm: { contractRent: 780 } }));
  assert.equal(second.some((e) => e.type === "intent"), false);
  assert.deepEqual(stepsOf(second), ["ComplianceAgent:started", "ComplianceAgent:finished"]);
  assert.deepEqual((await orchestrator.getTenancy("t6")).contractRent, { value: 780, source: "user" });
  assert.match(answerOf(second), /confirmed rent of 780 €/);
});

test("an ungrounded figure triggers one rewrite", async () => {
  const { orchestrator, models } = setup({
    router: [{ intents: ["general"], language: "en" }],
    supervisor: [
      "The Kappungsgrenze in Berlin is 15% over 3 years.",
      "The Kappungsgrenze (cap on rent increases) is set by law; see the Senatsverwaltung website.",
    ],
  });

  const answer = answerOf(await collect(orchestrator.send({ threadId: "t7", message: "What is the Kappungsgrenze?" })));

  assert.match(answer, /set by law/);
  assert.doesNotMatch(answer, /15%/);
  const retrySystemPrompt = models.supervisor.calls[1][0].content;
  assert.match(retrySystemPrompt, /not backed by any Sub-agent result or Tenancy fact: 15, 3/);
});

test("a still-ungrounded rewrite has the offending sentences removed", async () => {
  const { orchestrator } = setup({
    router: [{ intents: ["general"], language: "de" }],
    supervisor: ["Die Kappungsgrenze beträgt 15 %. Details beim Mieterverein.", "Sie liegt bei 15 %. Mehr beim Mieterverein."],
  });

  const answer = answerOf(await collect(orchestrator.send({ threadId: "t8", message: "Was ist die Kappungsgrenze?" })));

  assert.doesNotMatch(answer, /15/);
  assert.match(answer, /Mehr beim Mieterverein\./);
  assert.match(answer, /Zahlen, die ich nicht mit amtlichen Daten belegen konnte/);
  assert.match(answer, /keine Rechtsberatung/);
});

test("Sub-agents without their required facts report needs_facts and call no Tools", async () => {
  const { orchestrator, calls } = setup({
    router: [{ intents: ["document", "mietspiegel"], language: "en" }],
    supervisor: [
      {
        toolCalls: [
          { name: "ask_lease_analysis_agent", args: { request: "Read the lease" } },
          { name: "ask_official_data_agent", args: { request: "Verify the address" } },
          { name: "ask_compliance_agent", args: { request: "Rent check", checks: ["mietspiegel"] } },
        ],
      },
      "Please upload your lease or tell me your address and living area.",
    ],
  });

  const events = await collect(orchestrator.send({ threadId: "t12", message: "Am I paying too much?" }));

  assert.deepEqual(stepsOf(events), [
    "LeaseAnalysisAgent:needs_facts",
    "OfficialDataAgent:needs_facts",
    "ComplianceAgent:needs_facts",
  ]);
  assert.equal(calls.length, 0);
});

test("an unverified address adds no official facts", async () => {
  const { orchestrator } = setup({
    router: [{ intents: ["address"], language: "en" }],
    supervisor: [
      {
        toolCalls: [
          { name: "record_tenancy_facts", args: { facts: [{ fact: "address", value: "Fantasiestraße 1" }] } },
          { name: "ask_official_data_agent", args: { request: "Verify" } },
        ],
      },
      "I couldn't find Fantasiestraße 1 in the official Berlin register. Could you check the spelling?",
    ],
    subAgent: [
      { toolCalls: [{ name: "validate_berlin_address", args: { address: "Fantasiestraße 1" } }] },
      "Address not found.",
    ],
    toolOverrides: { validate_berlin_address: () => ({ verified: false, address: null }) },
  });

  const events = await collect(orchestrator.send({ threadId: "t13", message: "Is Fantasiestraße 1 a real address?" }));

  assert.deepEqual(stepsOf(events), ["OfficialDataAgent:started", "OfficialDataAgent:finished"]);
  assert.deepEqual(await orchestrator.getTenancy("t13"), { address: { value: "Fantasiestraße 1", source: "user" } });
});

test("a message mixing a housing Intent with out_of_scope is handled as in scope", async () => {
  const { orchestrator, models } = setup({
    router: [{ intents: ["mietspiegel", "out_of_scope"], language: "en" }],
    supervisor: ["Tell me your address and living area and I'll check the Mietspiegel."],
  });

  const events = await collect(orchestrator.send({ threadId: "t14", message: "Rent check, and tell me a joke" }));

  assert.deepEqual(events[0], { type: "intent", intents: ["mietspiegel"] });
  assert.equal(models.supervisor.calls.length, 1);
});

test("an answer with no grounded content left is replaced by a fallback question", async () => {
  const { orchestrator } = setup({
    router: [{ intents: ["general"], language: "en" }],
    supervisor: ["The cap is 15%.", "It is 20%."],
  });

  const answer = answerOf(await collect(orchestrator.send({ threadId: "t15", message: "What is the cap?" })));

  assert.match(answer, /I couldn't verify my answer against official data/);
  assert.doesNotMatch(answer, /%/);
});

test("an upstream failure is reported as failed and gives no verdict data", async () => {
  const { orchestrator } = setup({
    router: [{ intents: ["address"], language: "en" }],
    supervisor: [
      {
        toolCalls: [
          { name: "record_tenancy_facts", args: { facts: [{ fact: "address", value: "Berliner Str. 155" }] } },
          { name: "ask_official_data_agent", args: { request: "Verify" } },
        ],
      },
      "The official Berlin address register is not responding right now. Please try again later.",
    ],
    subAgent: [
      { toolCalls: [{ name: "validate_berlin_address", args: { address: "Berliner Str. 155" } }] },
      "The address service returned an upstream error.",
    ],
    toolOverrides: {
      validate_berlin_address: () => {
        throw new Error("Berlin address service returned 503");
      },
    },
  });

  const events = await collect(orchestrator.send({ threadId: "t9", message: "Check Berliner Str. 155" }));

  assert.deepEqual(stepsOf(events), ["OfficialDataAgent:started", "OfficialDataAgent:failed"]);
  assert.equal((await orchestrator.getTenancy("t9")).residentialLocation, undefined);
});

test("send() validates its input and surfaces graph errors as an error event", async () => {
  const { orchestrator } = setup({ router: [] });
  await assert.rejects(collect(orchestrator.send({ message: "hi" })), /requires a threadId/);
  await assert.rejects(collect(orchestrator.send({ threadId: "t10" })), /requires a message/);

  const events = await collect(orchestrator.send({ threadId: "t10", message: "hi" }));
  assert.deepEqual(events, [{ type: "error", message: "ScriptedChatModel ran out of scripted responses" }]);
});

test("a Supervisor that never stops delegating ends the turn with an error event", async () => {
  const recordForever = { toolCalls: [{ name: "record_tenancy_facts", args: { facts: [{ fact: "rooms", value: 2 }] } }] };
  const { orchestrator } = setup({
    router: [{ intents: ["general"], language: "en" }],
    supervisor: Array.from({ length: 30 }, () => recordForever),
  });

  const events = await collect(orchestrator.send({ threadId: "t11", message: "hello" }));

  assert.equal(events.at(-1).type, "error");
  assert.match(events.at(-1).message, /Recursion limit/i);
});

test("createOrchestrator refuses a tool set that misses a contract", () => {
  const { tools } = createStubTools();
  assert.throws(
    () =>
      createOrchestrator({
        models: {},
        tools: tools.filter((t) => t.name !== "extract_lease_data"),
      }),
    /missing required tools: extract_lease_data/,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/orchestrator/orchestrator.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for the module(s) this task creates.

- [ ] **Step 3: Write the internal helpers: fixed replies, Intent router pieces, facts from Tool results, gating and grounding**

`src/orchestrator/replies.js`:

```js
// Fixed replies the Orchestrator adds by code, never by the model.
const REPLIES = {
  outOfScope: {
    en: "I can only help with Berlin housing questions: verifying an address, the Mietspiegel reference rent, § 7 WoAufG Bln occupancy rules, and analysing your lease. What would you like to check?",
    de: "Ich kann nur bei Fragen rund ums Wohnen in Berlin helfen: Adressprüfung, ortsübliche Vergleichsmiete nach Mietspiegel, Belegung nach § 7 WoAufG Bln und Analyse Ihres Mietvertrags. Was möchten Sie prüfen?",
  },
  disclaimer: {
    en: "_This is general information based on official Berlin data, not legal advice. For a binding assessment, contact a tenants' association (Mieterverein) or a lawyer._",
    de: "_Dies ist eine allgemeine Information auf Grundlage amtlicher Berliner Daten und keine Rechtsberatung. Für eine verbindliche Einschätzung wenden Sie sich an einen Mieterverein oder eine Anwältin bzw. einen Anwalt._",
  },
  removedFigures: {
    en: "I left out figures I could not verify against official data.",
    de: "Zahlen, die ich nicht mit amtlichen Daten belegen konnte, habe ich weggelassen.",
  },
  fallback: {
    en: "I couldn't verify my answer against official data. Could you tell me which check you'd like (address, Mietspiegel or occupancy) and the missing details?",
    de: "Ich konnte meine Antwort nicht mit amtlichen Daten belegen. Welche Prüfung möchten Sie (Adresse, Mietspiegel oder Belegung), und welche Angaben fehlen noch?",
  },
};

export function reply(key, language) {
  return REPLIES[key][language] ?? REPLIES[key].en;
}
```

`src/orchestrator/intents.js`:

```js
import { SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

export const INTENTS = ["general", "address", "mietspiegel", "occupancy", "document", "out_of_scope"];

export const intentSchema = z.object({
  intents: z.array(z.enum(INTENTS)).min(1).describe("Every Intent present in the latest user message"),
  language: z.string().describe("ISO 639-1 code of the language of the latest user message, e.g. 'de' or 'en'"),
});

export const ROUTER_PROMPT = `You classify the latest user message for Amt-Buddy, an assistant for tenants in Berlin.
Intents:
- general: general questions about renting or housing in Berlin
- address: verifying a Berlin address
- mietspiegel: rent level, Mietspiegel, ortsübliche Vergleichsmiete, "am I paying too much"
- occupancy: living space per person, overcrowding, § 7 WoAufG Bln
- document: an uploaded lease (Mietvertrag) or other tenancy document
- out_of_scope: anything unrelated to housing in Berlin
A message may have several Intents. A short answer to the assistant's previous question (e.g. "4 people", "yes") belongs to the Intents of that question, never out_of_scope.`;

const CONTEXT_MESSAGES = 6;

export function routerMessages(messages) {
  return [new SystemMessage(ROUTER_PROMPT), ...messages.slice(-CONTEXT_MESSAGES)];
}

// out_of_scope only ever stands alone: mixed with a housing Intent, the request is in scope.
export function normalizeIntents(intents) {
  const unique = [...new Set(intents)];
  const inScope = unique.filter((intent) => intent !== "out_of_scope");
  return inScope.length > 0 ? inScope : ["out_of_scope"];
}
```

`src/orchestrator/evidence.js`:

```js
// Evidence: one entry per Tool call made during a turn,
// `{ tool, args, result }` on success or `{ tool, args, error: { kind, message } }`.

function formatAddress(address) {
  return `${address.street} ${address.houseNumber}, ${address.postalCode} Berlin`;
}

// Tenancy fact updates implied by successful Tool results.
export function factsFromEvidence(evidence) {
  const updates = [];
  for (const { tool, result } of evidence) {
    if (!result) continue;
    if (tool === "validate_berlin_address" && result.verified && result.address) {
      updates.push({ fact: "address", value: formatAddress(result.address), source: "official" });
      updates.push({ fact: "coordinates", value: result.address.coordinates, source: "official" });
      updates.push({ fact: "residentialLocation", value: result.address.residentialLocation, source: "official" });
    }
    if (tool === "lookup_building_age") {
      updates.push({ fact: "buildingYear", value: result.predominantConstructionPeriod, source: "official" });
    }
    if (tool === "extract_lease_data") {
      for (const [fact, extracted] of Object.entries(result.fields ?? {})) {
        updates.push({ fact, value: extracted.value, source: "lease", confidence: extracted.confidence });
      }
    }
  }
  return updates;
}

// True when any Tool result in the evidence is a Compliance verdict.
export function hasComplianceVerdict(evidence) {
  return evidence.some(
    ({ tool, result }) =>
      (tool === "calculate_mietspiegel" && result?.status === "calculated") ||
      (tool === "assess_occupancy_compliance" && ["meets_minimum", "below_minimum"].includes(result?.status)),
  );
}
```

`src/orchestrator/requirements.js`:

```js
import { isUnconfirmed } from "./tenancy.js";

const CHECK_REQUIREMENTS = {
  mietspiegel: ["residentialLocation", "buildingYear", "livingAreaSqm"],
  occupancy: ["livingAreaSqm", "rooms", "occupants", "childrenUpToSix"],
};

function requiredFacts(agent, args) {
  if (agent === "official_data") return ["address"];
  if (agent === "compliance") return [...new Set((args.checks ?? []).flatMap((check) => CHECK_REQUIREMENTS[check]))];
  return [];
}

// Which facts block a Sub-agent from running. Missing facts are absent from the
// Tenancy; unconfirmed facts are present but need the user's confirmation.
// Optional facts that are unconfirmed (e.g. contract rent for a Mietspiegel check)
// also block, so no Compliance verdict is ever based on an Unconfirmed fact.
export function blockingFacts(agent, args, tenancy, documentId) {
  const missing = requiredFacts(agent, args).filter((name) => !tenancy[name]);
  if (agent === "lease_analysis" && !documentId) missing.push("documentId");

  const relevant = agent === "compliance" ? [...requiredFacts(agent, args), "contractRent"] : requiredFacts(agent, args);
  const unconfirmed = relevant.filter((name) => isUnconfirmed(tenancy[name]));

  return { missing, unconfirmed, blocked: missing.length > 0 || unconfirmed.length > 0 };
}
```

`src/orchestrator/grounding.js`:

```js
import { parseNumber } from "./numbers.js";

// Grounding check: every number in an answer must be traceable to a Tool result,
// a Tenancy fact, or the user's own message.

const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g;
// Legal citations and list markers are not claims.
const IGNORED_PATTERNS = [/§+\s*\d+[a-z]?(?:\s*(?:Abs\.|Absatz)\s*\d+)?/gi, /^\s*\d+[.)]\s/gm];

export function extractNumbers(text) {
  let cleaned = String(text ?? "");
  for (const pattern of IGNORED_PATTERNS) cleaned = cleaned.replace(pattern, " ");
  return (cleaned.match(NUMBER_PATTERN) ?? [])
    .map((token) => ({ token, value: parseNumber(token) }))
    .filter(({ value }) => value !== null);
}

function collect(value, into) {
  if (typeof value === "number") into.add(Math.round(value * 100) / 100);
  else if (typeof value === "string") for (const { value: n } of extractNumbers(value)) into.add(n);
  else if (Array.isArray(value)) for (const item of value) collect(item, into);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collect(item, into);
}

export function allowedNumbers({ evidence = [], tenancy = {}, userText = "" }) {
  const allowed = new Set();
  collect(evidence.map((entry) => entry.result).filter(Boolean), allowed);
  collect(Object.values(tenancy).map((fact) => fact.value), allowed);
  collect(userText, allowed);
  return allowed;
}

function isAllowed(value, allowed) {
  if (allowed.has(value)) return true;
  // "about €14/m²" for 14.4 is fine; inventing 15 is not.
  return Number.isInteger(value) && [...allowed].some((candidate) => Math.round(candidate) === value);
}

export function checkGrounding(answer, sources) {
  const allowed = allowedNumbers(sources);
  const ungrounded = extractNumbers(answer)
    .filter(({ value }) => !isAllowed(value, allowed))
    .map(({ token }) => token);
  return { grounded: ungrounded.length === 0, ungrounded: [...new Set(ungrounded)] };
}

// Drops every sentence (or list line) that contains an ungrounded number.
export function stripUngrounded(answer, ungrounded) {
  const offending = new Set(ungrounded);
  return answer
    .split("\n")
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !extractNumbers(sentence).some(({ token }) => offending.has(token)))
        .join(" "),
    )
    .filter((line, index, lines) => line.trim() !== "" || (index > 0 && lines[index - 1].trim() !== ""))
    .join("\n")
    .trim();
}
```

- [ ] **Step 4: Write the Sub-agent runner and the Supervisor definition**

`src/orchestrator/sub-agents.js`:

```js
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";

const SHARED_RULES = `Call your tools with values taken exactly from the Tenancy facts given to you; never invent or guess a value.
If a tool returns an error, do not retry it yourself; report the error.
Finish with a short factual summary of what the tools returned, in English, without advice.`;

export const SUB_AGENTS = {
  official_data: {
    label: "OfficialDataAgent",
    tools: ["validate_berlin_address", "lookup_building_age"],
    prompt: `You are the Official Data agent of Amt-Buddy. You verify Berlin addresses against the official register.
After a successful address verification, always look up the building age with the returned coordinates.
${SHARED_RULES}`,
  },
  compliance: {
    label: "ComplianceAgent",
    tools: ["calculate_mietspiegel", "assess_occupancy_compliance"],
    prompt: `You are the Compliance agent of Amt-Buddy. You run only the checks you are asked for:
- mietspiegel: call calculate_mietspiegel with residentialLocation, buildingYear (as buildingAgeOrYear), livingAreaSqm and, if known, contractRent.
- occupancy: call assess_occupancy_compliance with livingAreaSqm, rooms, occupants and childrenUpToSix.
${SHARED_RULES}`,
  },
  lease_analysis: {
    label: "LeaseAnalysisAgent",
    tools: ["extract_lease_data"],
    prompt: `You are the Lease Analysis agent of Amt-Buddy. Extract the tenancy facts from the uploaded lease with extract_lease_data.
Report which facts were found and flag every fact with confidence below 0.8 as needing the user's confirmation.
${SHARED_RULES}`,
  },
};

// Tool arguments that must equal a Tenancy fact: tool → { argument: fact }.
const TOOL_ARG_FACTS = {
  validate_berlin_address: { address: "address" },
  calculate_mietspiegel: {
    residentialLocation: "residentialLocation",
    buildingAgeOrYear: "buildingYear",
    livingAreaSqm: "livingAreaSqm",
    contractRent: "contractRent",
  },
  assess_occupancy_compliance: {
    livingAreaSqm: "livingAreaSqm",
    rooms: "rooms",
    occupants: "occupants",
    childrenUpToSix: "childrenUpToSix",
  },
};

// Arguments pinned to confirmed Tenancy values, so a Sub-agent model cannot
// pass a Tool a value that differs from the Tenancy.
export function pinnedArgs(toolName, facts) {
  if (toolName === "lookup_building_age") return facts.coordinates ?? {};
  return Object.fromEntries(
    Object.entries(TOOL_ARG_FACTS[toolName] ?? {})
      .filter(([, fact]) => facts[fact] !== undefined)
      .map(([arg, fact]) => [arg, facts[fact]]),
  );
}

const MAX_SUB_AGENT_STEPS = 12;

// Runs one Sub-agent as a small ReAct loop over its (already wrapped) Tools and
// returns its final summary text.
export async function runSubAgent({ agent, model, tools, task }) {
  const bound = model.bindTools(tools);
  const graph = new StateGraph(MessagesAnnotation)
    .addNode("agent", async (state) => ({ messages: [await bound.invoke(state.messages)] }))
    .addNode("tools", new ToolNode(tools))
    .addEdge(START, "agent")
    .addConditionalEdges("agent", toolsCondition, ["tools", END])
    .addEdge("tools", "agent")
    .compile();

  const result = await graph.invoke(
    { messages: [new SystemMessage(SUB_AGENTS[agent].prompt), new HumanMessage(task)] },
    { recursionLimit: MAX_SUB_AGENT_STEPS },
  );
  const last = result.messages.at(-1);
  return typeof last.content === "string" ? last.content : JSON.stringify(last.content);
}

export function subAgentTask({ args, facts, documentId }) {
  const lines = [`Task: ${args.request}`];
  if (args.checks) lines.push(`Checks: ${args.checks.join(", ")}`);
  lines.push(`Tenancy facts: ${JSON.stringify(facts)}`);
  if (documentId) lines.push(`Document ID: ${documentId}`);
  return lines.join("\n");
}
```

`src/orchestrator/supervisor.js`:

```js
import { SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { isUnconfirmed, STATED_FACTS } from "./tenancy.js";

const request = z.string().describe("What the Sub-agent should do, in one or two sentences");

// Schema-only tool definitions: the Supervisor's `delegate` node executes them.
export const SUPERVISOR_TOOLS = [
  {
    name: "ask_official_data_agent",
    description:
      "Verify the Tenancy's address against the official Berlin register and look up the official building age and Wohnlage. Needed before a Mietspiegel check.",
    schema: z.object({ request }),
  },
  {
    name: "ask_compliance_agent",
    description:
      "Run Compliance checks on the Tenancy: 'mietspiegel' (reference rent, and contract rent comparison if known) and/or 'occupancy' (§ 7 WoAufG Bln).",
    schema: z.object({ request, checks: z.array(z.enum(["mietspiegel", "occupancy"])).min(1) }),
  },
  {
    name: "ask_lease_analysis_agent",
    description: "Extract Tenancy facts from the lease document the user uploaded.",
    schema: z.object({ request }),
  },
  {
    name: "record_tenancy_facts",
    description:
      "Record Tenancy facts the user stated or corrected in this conversation, e.g. 'the rent is 720' or 'we are 4 people'.",
    schema: z.object({
      facts: z.array(z.object({ fact: z.enum(STATED_FACTS), value: z.union([z.string(), z.number()]) })).min(1),
    }),
  },
];

export const AGENT_FOR_TOOL = {
  ask_official_data_agent: "official_data",
  ask_compliance_agent: "compliance",
  ask_lease_analysis_agent: "lease_analysis",
};

function describeTenancy(tenancy) {
  const entries = Object.entries(tenancy);
  if (entries.length === 0) return "(no facts yet)";
  return entries
    .map(([name, fact]) => {
      const flags = [fact.source];
      if (isUnconfirmed(fact)) flags.push(`UNCONFIRMED, confidence ${fact.confidence}`);
      return `- ${name}: ${JSON.stringify(fact.value)} (${flags.join(", ")})`;
    })
    .join("\n");
}

export function supervisorSystemMessage({ intents, language, tenancy, documentId, groundingFeedback }) {
  const parts = [
    `You are the Orchestrator of Amt-Buddy, which helps tenants check their Berlin tenancy against official data and rules.
You never calculate anything yourself: you delegate to Sub-agents through your tools and then answer the user.

Rules:
- Record any fact the user states or corrects with record_tenancy_facts before delegating.
- A Mietspiegel check needs the Official Data agent first (it supplies Wohnlage and building age).
- If a Sub-agent reports needs_facts, run whatever else can run, then ask the user only for facts no Sub-agent can supply. Ask the user to confirm UNCONFIRMED facts; never treat them as known.
- If a Sub-agent reports an upstream error, say the official service is not responding right now. Never give a Compliance verdict from guessed or incomplete data.
- Every number in your answer must come from a Sub-agent result or the Tenancy facts. Do not quote legal thresholds or figures from memory; point to the official source instead.
- Reply in the user's language (ISO code: ${language}). Keep German legal and official terms in German with a short gloss, e.g. "Nettokaltmiete (net cold rent)".
- Do not add a legal disclaimer; it is added automatically.`,
    `Intents of the latest message: ${intents.join(", ") || "(confirmation only)"}`,
    `Tenancy facts:\n${describeTenancy(tenancy)}`,
  ];
  if (documentId) parts.push(`Uploaded document: ${documentId}`);
  if (groundingFeedback) parts.push(`Correction: ${groundingFeedback}`);
  return new SystemMessage(parts.join("\n\n"));
}
```

- [ ] **Step 5: Write the graph, the event translator and the public interface**

`src/orchestrator/graph.js`:

```js
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { Annotation, END, getWriter, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";

import { factsFromEvidence, hasComplianceVerdict } from "./evidence.js";
import { checkGrounding, stripUngrounded } from "./grounding.js";
import { intentSchema, normalizeIntents, routerMessages } from "./intents.js";
import { reply } from "./replies.js";
import { blockingFacts } from "./requirements.js";
import { pinnedArgs, runSubAgent, SUB_AGENTS, subAgentTask } from "./sub-agents.js";
import { AGENT_FOR_TOOL, SUPERVISOR_TOOLS, supervisorSystemMessage } from "./supervisor.js";
import { confirmedValues, factsFromConfirm, mergeTenancy, tenancyReducer } from "./tenancy.js";
import { wrapTool } from "./tool-wrapper.js";

const replace = (fallback) => Annotation({ reducer: (_, update) => update, default: fallback });

export const OrchestratorState = Annotation.Root({
  ...MessagesAnnotation.spec,
  tenancy: Annotation({ reducer: tenancyReducer, default: () => ({}) }),
  // Evidence of the current turn; `null` resets it.
  evidence: Annotation({ reducer: (current, update) => (update === null ? [] : current.concat(update)), default: () => [] }),
  intents: replace(() => []),
  language: replace(() => "en"),
  documentId: replace(() => null),
  disclaimerShown: replace(() => false),
  // Per-turn input and scratch values, reset by `ingest`.
  confirm: replace(() => null),
  skipRouter: replace(() => false),
  userText: replace(() => ""),
  draft: replace(() => ""),
  groundingAttempts: replace(() => 0),
  groundingFeedback: replace(() => ""),
  groundingStatus: replace(() => ""),
});

const MAX_GROUNDING_RETRIES = 1;

function emit(event) {
  try {
    getWriter()?.(event);
  } catch {
    // Not running under stream(): nothing to emit to.
  }
}

export function buildGraph({ models, tools, log, toolTimeoutMs }) {
  async function ingest(state) {
    const last = state.messages.at(-1);
    const update = {
      evidence: null,
      intents: [],
      draft: "",
      groundingAttempts: 0,
      groundingFeedback: "",
      groundingStatus: "",
      confirm: null,
      userText: HumanMessage.isInstance(last) ? String(last.content) : "",
    };
    if (state.confirm) {
      update.tenancy = factsFromConfirm(state.confirm);
      if (state.skipRouter) {
        update.messages = [new HumanMessage(`[Confirmed Tenancy facts] ${JSON.stringify(state.confirm)}`)];
      }
    }
    return update;
  }

  async function classifyIntent(state) {
    const result = await models.router.withStructuredOutput(intentSchema).invoke(routerMessages(state.messages));
    return { intents: normalizeIntents(result.intents), language: result.language || state.language };
  }

  async function rejectOutOfScope(state) {
    const text = reply("outOfScope", state.language);
    emit({ type: "token", text });
    return { messages: [new AIMessage(text)] };
  }

  async function supervisor(state, config) {
    const system = supervisorSystemMessage(state);
    const response = await models.supervisor.bindTools(SUPERVISOR_TOOLS).invoke([system, ...state.messages], config);
    if (response.tool_calls?.length) return { messages: [response], draft: "" };
    const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    return { draft: text.trim() || reply("fallback", state.language) };
  }

  async function delegate(state, config) {
    const threadId = config?.configurable?.thread_id;
    const call = state.messages.at(-1);
    let tenancy = state.tenancy;
    const tenancyUpdates = [];
    const evidence = [];
    const toolMessages = [];

    for (const toolCall of call.tool_calls) {
      let report;
      if (toolCall.name === "record_tenancy_facts") {
        const updates = toolCall.args.facts.map(({ fact, value }) => ({ fact, value, source: "user" }));
        tenancy = mergeTenancy(tenancy, updates);
        tenancyUpdates.push(...updates);
        report = { status: "recorded" };
      } else {
        const agent = AGENT_FOR_TOOL[toolCall.name];
        const label = SUB_AGENTS[agent].label;
        const blocking = blockingFacts(agent, toolCall.args, tenancy, state.documentId);
        if (blocking.blocked) {
          emit({ type: "agent_step", agent: label, status: "needs_facts" });
          report = { status: "needs_facts", missing: blocking.missing, unconfirmed: blocking.unconfirmed };
        } else {
          emit({ type: "agent_step", agent: label, status: "started" });
          const agentEvidence = [];
          const facts = confirmedValues(tenancy);
          const agentTools = SUB_AGENTS[agent].tools.map((name) =>
            wrapTool(tools.get(name), {
              agent,
              threadId,
              timeoutMs: toolTimeoutMs,
              log,
              onEvidence: (entry) => agentEvidence.push(entry),
              pinnedArgs: pinnedArgs(name, facts),
            }),
          );
          const summary = await runSubAgent({
            agent,
            model: models.subAgent,
            tools: agentTools,
            task: subAgentTask({ args: toolCall.args, facts, documentId: state.documentId }),
          });
          const updates = factsFromEvidence(agentEvidence);
          tenancy = mergeTenancy(tenancy, updates);
          tenancyUpdates.push(...updates);
          evidence.push(...agentEvidence);
          const failed = agentEvidence.length > 0 && agentEvidence.every((entry) => entry.error);
          emit({ type: "agent_step", agent: label, status: failed ? "failed" : "finished" });
          report = {
            status: failed ? "failed" : "done",
            summary,
            results: agentEvidence.map(({ tool, result, error }) => (error ? { tool, error } : { tool, result })),
          };
        }
      }
      toolMessages.push(new ToolMessage({ tool_call_id: toolCall.id, name: toolCall.name, content: JSON.stringify(report) }));
    }
    return { messages: toolMessages, tenancy: tenancyUpdates, evidence };
  }

  async function verifyGrounding(state) {
    const check = checkGrounding(state.draft, {
      evidence: state.evidence,
      tenancy: state.tenancy,
      userText: state.userText,
    });
    if (check.grounded) return { groundingStatus: "grounded" };
    if (state.groundingAttempts < MAX_GROUNDING_RETRIES) {
      return {
        groundingStatus: "retry",
        groundingAttempts: state.groundingAttempts + 1,
        groundingFeedback: `Your previous draft contained figures not backed by any Sub-agent result or Tenancy fact: ${check.ungrounded.join(", ")}. Rewrite the answer without them, or delegate to obtain them.`,
      };
    }
    const stripped = stripUngrounded(state.draft, check.ungrounded);
    const draft = stripped ? `${stripped}\n\n${reply("removedFigures", state.language)}` : reply("fallback", state.language);
    return { groundingStatus: "stripped", draft };
  }

  async function finalize(state) {
    const needsDisclaimer = hasComplianceVerdict(state.evidence) || !state.disclaimerShown;
    const text = needsDisclaimer ? `${state.draft}\n\n${reply("disclaimer", state.language)}` : state.draft;
    emit({ type: "token", text });
    return { messages: [new AIMessage(text)], disclaimerShown: state.disclaimerShown || needsDisclaimer, draft: "" };
  }

  return new StateGraph(OrchestratorState)
    .addNode("ingest", ingest)
    .addNode("classifyIntent", classifyIntent)
    .addNode("rejectOutOfScope", rejectOutOfScope)
    .addNode("supervisor", supervisor)
    .addNode("delegate", delegate)
    .addNode("verifyGrounding", verifyGrounding)
    .addNode("finalize", finalize)
    .addEdge(START, "ingest")
    .addConditionalEdges("ingest", (state) => (state.skipRouter ? "supervisor" : "classifyIntent"), [
      "supervisor",
      "classifyIntent",
    ])
    .addConditionalEdges(
      "classifyIntent",
      (state) => (state.intents.includes("out_of_scope") ? "rejectOutOfScope" : "supervisor"),
      ["rejectOutOfScope", "supervisor"],
    )
    .addEdge("rejectOutOfScope", END)
    .addConditionalEdges("supervisor", (state) => (state.draft ? "verifyGrounding" : "delegate"), [
      "verifyGrounding",
      "delegate",
    ])
    .addEdge("delegate", "supervisor")
    .addConditionalEdges(
      "verifyGrounding",
      (state) => (state.groundingStatus === "retry" ? "supervisor" : "finalize"),
      ["supervisor", "finalize"],
    )
    .addEdge("finalize", END);
}
```

`src/orchestrator/events.js`:

```js
// Translates LangGraph stream chunks (streamMode ["custom", "values"]) into the
// Orchestrator's domain events, so the UI never sees LangGraph internals.
export function createEventTranslator() {
  let lastIntents = null;
  let lastTenancy = null;

  return function translate(mode, chunk) {
    if (mode === "custom") return [chunk];

    const events = [];
    const intents = JSON.stringify(chunk.intents ?? []);
    if (lastIntents !== null && intents !== lastIntents && chunk.intents.length > 0) {
      events.push({ type: "intent", intents: chunk.intents });
    }
    lastIntents = intents;

    const tenancy = JSON.stringify(chunk.tenancy ?? {});
    if (lastTenancy !== null && tenancy !== lastTenancy) {
      events.push({ type: "tenancy", tenancy: chunk.tenancy });
    }
    lastTenancy = tenancy;
    return events;
  };
}
```

`src/orchestrator/index.js`:

```js
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";

import { createEventTranslator } from "./events.js";
import { buildGraph } from "./graph.js";
import { assertToolsMatchContracts } from "./tool-contracts.js";
import { defaultAuditLog, DEFAULT_TOOL_TIMEOUT_MS } from "./tool-wrapper.js";

export { TOOL_CONTRACTS } from "./tool-contracts.js";
export { createStubTools } from "./stub-tools.js";

const RECURSION_LIMIT = 40;
const DOCUMENT_ONLY_MESSAGE = "[The user uploaded a lease document]";

// models: { router, supervisor, subAgent } chat models supporting bindTools / withStructuredOutput.
// tools: LangChain tools implementing every contract in TOOL_CONTRACTS.
export function createOrchestrator({
  models,
  tools,
  checkpointer = new MemorySaver(),
  log = defaultAuditLog,
  toolTimeoutMs = DEFAULT_TOOL_TIMEOUT_MS,
}) {
  const toolsByName = assertToolsMatchContracts(tools);
  const graph = buildGraph({ models, tools: toolsByName, log, toolTimeoutMs }).compile({ checkpointer });

  // One user turn. Yields domain events:
  // { type: "intent", intents } | { type: "agent_step", agent, status }
  // | { type: "tenancy", tenancy } | { type: "token", text } | { type: "done" } | { type: "error", message }
  async function* send({ threadId, message, documentId, confirm }) {
    if (!threadId) throw new TypeError("send() requires a threadId");
    const text = message?.trim() || (documentId ? DOCUMENT_ONLY_MESSAGE : "");
    if (!text && !confirm) throw new TypeError("send() requires a message, a documentId or confirm");

    const input = {
      messages: text ? [new HumanMessage(text)] : [],
      confirm: confirm ?? null,
      skipRouter: !text,
    };
    if (documentId) input.documentId = documentId;

    const translate = createEventTranslator();
    try {
      const stream = await graph.stream(input, {
        configurable: { thread_id: threadId },
        streamMode: ["custom", "values"],
        recursionLimit: RECURSION_LIMIT,
      });
      for await (const [mode, chunk] of stream) {
        yield* translate(mode, chunk);
      }
      yield { type: "done" };
    } catch (error) {
      yield { type: "error", message: error?.message ?? String(error) };
    }
  }

  async function getTenancy(threadId) {
    const snapshot = await graph.getState({ configurable: { thread_id: threadId } });
    return snapshot.values?.tenancy ?? {};
  }

  return { send, getTenancy };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/orchestrator/orchestrator.test.js` and then `npm test`
Expected: all tests in the task PASS; `npm test` shows `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add src/orchestrator/replies.js src/orchestrator/intents.js src/orchestrator/evidence.js src/orchestrator/requirements.js src/orchestrator/grounding.js src/orchestrator/sub-agents.js src/orchestrator/supervisor.js src/orchestrator/graph.js src/orchestrator/events.js src/orchestrator/index.js test/orchestrator/helpers/scripted-model.js test/orchestrator/orchestrator.test.js
git commit -m "feat(orchestrator): add Supervisor graph and createOrchestrator"
```

### Task 5: OpenAI models, live smoke test and handoff notes

Builds the real models from the environment, adds a live smoke test that is skipped unless `OPENAI_API_KEY` and `OPENAI_MODEL` are set, and writes the handoff notes your teammates build against (Tool authoring rules, the `send()` event contract, env vars, and the LangSmith/PII warning).

**Files:**
- Create: `src/orchestrator/openai.js`
Create: `docs/orchestrator.md`
Modify: `README.md` (add an Orchestrator section linking to the handoff notes)
- Test: `test/orchestrator/openai-live.test.js`

**Interfaces:**
- Consumes: `createOrchestrator`, `createStubTools` (Task 4).
- Produces: `createOpenAIModels(env?) → { router, supervisor, subAgent }` (throws `Set OPENAI_MODEL …` when unset).

- [ ] **Step 1: Write the failing tests**

`test/orchestrator/openai-live.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { createOrchestrator, createStubTools } from "../../src/orchestrator/index.js";
import { createOpenAIModels } from "../../src/orchestrator/openai.js";

const live = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);

test("createOpenAIModels requires OPENAI_MODEL", () => {
  assert.throws(() => createOpenAIModels({}), /Set OPENAI_MODEL/);
});

test(
  "live: a full Mietspiegel check against the real model with stub tools",
  { skip: live ? false : "set OPENAI_API_KEY and OPENAI_MODEL to run", timeout: 120_000 },
  async () => {
    const orchestrator = createOrchestrator({
      models: createOpenAIModels(),
      tools: createStubTools().tools,
      log: () => {},
    });
    const events = [];
    for await (const event of orchestrator.send({
      threadId: "live-1",
      message: "Berliner Straße 155, 10715 Berlin, 50 m², Nettokaltmiete 780 €. Zahle ich zu viel?",
    })) {
      events.push(event);
    }
    assert.equal(events.at(-1).type, "done", JSON.stringify(events.at(-1)));
    assert.ok(events.some((e) => e.type === "agent_step" && e.agent === "ComplianceAgent" && e.status === "finished"));
    const answer = events.filter((e) => e.type === "token").map((e) => e.text).join("");
    assert.match(answer, /Rechtsberatung/);
  },
);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/orchestrator/openai-live.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for the module(s) this task creates.

- [ ] **Step 3: Write the implementation**

`src/orchestrator/openai.js`:

```js
import { ChatOpenAI } from "@langchain/openai";

// Builds the Orchestrator's models from the environment:
// OPENAI_API_KEY (read by ChatOpenAI), OPENAI_MODEL (required),
// OPENAI_ROUTER_MODEL (optional, a cheaper model for Intent classification).
export function createOpenAIModels(env = process.env) {
  const model = env.OPENAI_MODEL;
  if (!model) throw new Error("Set OPENAI_MODEL to the OpenAI chat model the Orchestrator should use");
  const main = new ChatOpenAI({ model });
  const router = env.OPENAI_ROUTER_MODEL ? new ChatOpenAI({ model: env.OPENAI_ROUTER_MODEL }) : main;
  return { router, supervisor: main, subAgent: main };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/orchestrator/openai-live.test.js` and then `npm test`
Expected: all tests in the task PASS (the live test is reported as skipped unless `OPENAI_API_KEY` and `OPENAI_MODEL` are set); `npm test` shows `# fail 0`.

- [ ] **Step 5: Write the handoff notes**

`docs/orchestrator.md`:

```markdown
# Orchestrator: handoff notes

The Orchestrator (`src/orchestrator/`) is the conversational agent behind the chat. It is a LangGraph.js graph: an Intent router, then a Supervisor that delegates to three Sub-agents (Official Data, Compliance, Lease Analysis), each calling its own Tools. Vocabulary: [`CONTEXT.md`](../CONTEXT.md). Decisions: [`docs/adr/`](adr/).

## For Tool authors

Build every Tool from its contract in `src/orchestrator/tool-contracts.js`:

```js
import { tool } from "@langchain/core/tools";
import { TOOL_CONTRACTS } from "./orchestrator/tool-contracts.js";

const { name, description, schema } = TOOL_CONTRACTS.calculate_mietspiegel;
export const calculateMietspiegelTool = tool(async (args) => evaluateMietspiegel(args), { name, description, schema });
```

| Tool | Sub-agent | Input | Returns |
|---|---|---|---|
| `validate_berlin_address` | Official Data | `{ address }` | `{ verified, address: { street, houseNumber, postalCode, district, coordinates, residentialLocation } \| null }` |
| `lookup_building_age` | Official Data | `{ longitude, latitude }` | `{ predominantConstructionPeriod }` |
| `calculate_mietspiegel` | Compliance | `{ residentialLocation, buildingAgeOrYear, livingAreaSqm, contractRent? }` | result of `evaluateMietspiegel` |
| `assess_occupancy_compliance` | Compliance | `{ livingAreaSqm, rooms, occupants, childrenUpToSix }` | result of `assessOccupancy` |
| `extract_lease_data` | Lease Analysis | `{ documentId }` | `{ fields: { address?, contractRent?, livingAreaSqm?, rooms?, buildingYear? } }`, each `{ value, confidence }` |

- Return a plain JSON-serialisable object; check it with `TOOL_CONTRACTS.<name>.output.parse(result)` in your tests.
- Errors: throw. Set `error.kind = "input"` (or use an error class whose name ends in `InputError`) when the arguments are wrong; the user is then asked to fix them and the call is never retried. Any other error counts as `upstream`: retried once, then reported as "the official service is not responding".
- No timeouts or retries of your own: the Orchestrator applies a 10 s timeout and one retry to every call.
- Numbers are numbers: `780.5`, not `"780,50 €"`. Confidence is between 0 and 1; below 0.8 the user must confirm the value.

## For the UI

```js
import { createOrchestrator } from "./orchestrator/index.js";
import { createOpenAIModels } from "./orchestrator/openai.js";

const orchestrator = createOrchestrator({ models: createOpenAIModels(), tools });

for await (const event of orchestrator.send({ threadId, message, documentId, confirm })) {
  // write `event` to the SSE stream
}
const tenancy = await orchestrator.getTenancy(threadId);
```

`send()` takes a `threadId` and at least one of `message`, `documentId` or `confirm` (review-card edits, e.g. `{ contractRent: 720 }`). It yields, in order:

| Event | When |
|---|---|
| `{ type: "intent", intents }` | the message was classified (absent for confirm-only turns) |
| `{ type: "agent_step", agent, status }` | a Sub-agent `started`, `finished`, `failed` or reports `needs_facts` |
| `{ type: "tenancy", tenancy }` | the Tenancy changed; each fact is `{ value, source, confidence? }` and is unconfirmed when `source === "lease"` and `confidence < 0.8` |
| `{ type: "token", text }` | the answer, after the grounding check (one event with the whole text) |
| `{ type: "done" }` or `{ type: "error", message }` | end of the turn |

Until the real Tools exist, pass `createStubTools().tools` (from `src/orchestrator/stub-tools.js`).

## Configuration

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | OpenAI credentials |
| `OPENAI_MODEL` | chat model for the Supervisor and Sub-agents (required) |
| `OPENAI_ROUTER_MODEL` | optional cheaper model for Intent classification |
| `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT` | LangSmith tracing, **development only** |

LangSmith traces contain full prompts and Tool payloads, including lease contents. Keep `LANGSMITH_TRACING` off whenever real leases are processed. The built-in audit log (one JSON line per Tool call on stdout) never contains argument values.

`npm test` runs everything offline. The live smoke test in `test/orchestrator/openai-live.test.js` runs only when `OPENAI_API_KEY` and `OPENAI_MODEL` are set.
```

- [ ] **Step 6: Link the handoff notes from the README**

Append to `README.md`:

```markdown
## Orchestrator

`src/orchestrator/` contains the LangGraph.js Orchestrator behind the chat. Tool authors and the UI build against the contracts described in [docs/orchestrator.md](docs/orchestrator.md); the vocabulary is in [CONTEXT.md](CONTEXT.md).
```

- [ ] **Step 7: Commit**

```bash
git add src/orchestrator/openai.js test/orchestrator/openai-live.test.js docs/orchestrator.md README.md
git commit -m "feat(orchestrator): add OpenAI models, live smoke test and handoff notes"
```

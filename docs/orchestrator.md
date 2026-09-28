# Orchestrator: handoff notes

The Orchestrator (`src/orchestrator/`) is the conversational agent behind the chat. It is a LangGraph.js graph: an Intent router, then a Supervisor that delegates to three Sub-agents (Official Data, Compliance, Lease Analysis), each calling its own Tools, then a grounding check before the answer reaches the user.

```
ingest → classifyIntent → (rejectOutOfScope | supervisor ⇄ delegate) → verifyGrounding (⇄ supervisor once) → finalize
```

Vocabulary (Tenancy, Tenancy fact, Unconfirmed fact, Canonical address, Compliance verdict, Grounded claim): [`CONTEXT.md`](../CONTEXT.md). Decisions: [`docs/adr/`](adr/) — 0001 shared Tool contracts, 0002 missing facts end the turn, 0003 grounding check.

## For Tool authors

Build every Tool from its contract in `src/orchestrator/tool-contracts.js` (ADR 0001). `createOrchestrator` refuses to start if a Tool with a contract's name is missing (a misnamed Tool counts as missing) or has no `invoke` method.

```js
import { tool } from "@langchain/core/tools";
import { TOOL_CONTRACTS } from "./orchestrator/tool-contracts.js";

const { name, description, schema } = TOOL_CONTRACTS.calculate_mietspiegel;
export const calculateMietspiegelTool = tool(async (args) => evaluateMietspiegel(args), { name, description, schema });
```

| Tool | Sub-agent | Input | Returns |
|---|---|---|---|
| `validate_berlin_address` | Official Data | `{ address }` | `{ verified, address: { street, houseNumber, postalCode, district, coordinates: { longitude, latitude }, residentialLocation } \| null }`; `district`, `coordinates` and `residentialLocation` may be `null` |
| `lookup_building_age` | Official Data | `{ longitude, latitude }` | `{ predominantConstructionPeriod }` (e.g. `"1921 - 1930"`, or `null`) |
| `calculate_mietspiegel` | Compliance | `{ residentialLocation, buildingAgeOrYear, livingAreaSqm, contractRent?, featureGroups? }`; `featureGroups` is `{ bathroom, kitchen, apartment, building, surroundings }`, each `"positive"` / `"neutral"` / `"negative"`, all five or none | result of `evaluateMietspiegel`, at least `{ status }` (`"calculated"` counts as a Compliance verdict); with `featureGroups` it adds `adjustedReferenceRent: { weightPercent, rentPerSqm, monthlyRent }` |
| `assess_occupancy_compliance` | Compliance | `{ livingAreaSqm, rooms, occupants, childrenUpToSix }` | result of `assessOccupancy`, at least `{ status }` (`"meets_minimum"` / `"below_minimum"` count as a Compliance verdict) |
| `extract_lease_data` | Lease Analysis | `{ documentId }` | `{ fields: { address?, contractRent?, livingAreaSqm?, rooms?, buildingYear? } }`, each `{ value, confidence }` |

- **Return** a plain JSON-serialisable object. The Orchestrator does not validate your result against the contract's `output` schema, so check it yourself in your tests: `TOOL_CONTRACTS.<name>.output.parse(result)`. `test/orchestrator/tool-contracts.test.js` shows how.
- **Errors: throw.** The Orchestrator sorts them into two kinds:
  - `input` — the arguments are wrong (e.g. an address that does not exist). Set `error.kind = "input"`, or throw an error class whose `name` ends in `InputError`. Arguments your schema rejects count as input errors too. Input errors are never retried; the Supervisor asks the user to check that value.
  - `upstream` — anything else (the Berlin WFS is slow or down). Retried once; if it still fails, the error goes back to the Sub-agent as that call's result and the Supervisor tells the user the official service is not responding right now. The Sub-agent's step reports `failed` only when every Tool call of its run errored and at least one error was upstream; if another call succeeded (e.g. the address was verified but the building-age lookup timed out) it reports `finished` with the error in its results.
- **No timeouts or retries of your own.** The Orchestrator wraps every call with a 10 s timeout per attempt (`DEFAULT_TOOL_TIMEOUT_MS`) and exactly one retry for upstream errors, so a call can take up to about 20 s before it gives up. Aborting your own requests when that attempt ends is fine (the Berlin Tools share one `AbortSignal.timeout` of the same length across a call's requests, see below); anything shorter or retrying is not.
- **Arguments come from the Tenancy.** The Orchestrator overwrites (pins) every Tenancy-backed argument with the Tenancy's confirmed value, whatever the Sub-agent model passed, and drops it when the fact is absent or unconfirmed. `extract_lease_data.documentId` is always the uploaded document, and `lookup_building_age` always gets the verified coordinates. `calculate_mietspiegel.featureGroups` is built from the tenant's five Feature group ratings and passed only when all five are known; otherwise it is left out.
- **Numbers are numbers**: `780.5`, not `"780,50 €"`. The one exception is `buildingAgeOrYear`, which is a year (`1935`) or an official construction period string (`"1921 - 1930"`).
- **Confidence** (lease extraction only) is a number between 0 and 1. A lease value with confidence below **0.8** — or with no numeric confidence at all — is an Unconfirmed fact: no Compliance check runs on it until the user confirms it.
- **Audit log**: the Orchestrator logs one entry per Tool call — `{ event: "tool_call", threadId, agent, tool, argKeys, attempts, latencyMs, outcome, errorKind? }` — with argument names but never values or results. By default it is written as a JSON line to stdout; pass `log` to `createOrchestrator` to send it elsewhere.

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

`createOrchestrator({ models, tools, checkpointer?, log?, toolTimeoutMs? })`:

- `models`: `{ router, supervisor, subAgent }` chat models; `createOpenAIModels()` builds them from the environment (see Configuration).
- `tools`: the five Tools above.
- `checkpointer`: where conversations live. The default is LangGraph's in-memory `MemorySaver`, so conversations are lost when the process restarts.

`send({ threadId, message?, documentId?, confirm? })` runs one user turn:

- `threadId` is required, plus at least one of `message`, `documentId` or `confirm`. Otherwise the generator throws a `TypeError` on its first iteration (no events are yielded).
- `documentId` is the id of an uploaded lease, passed through to `extract_lease_data`. It is remembered for later turns of the thread. An upload without a message is handled as "the user uploaded a lease".
- `confirm` holds the values the user confirmed or corrected on the review card, e.g. `{ contractRent: 720 }` or `{ contractRent: "720,50" }`. Keys are Tenancy fact names (`address`, `livingAreaSqm`, `contractRent`, `buildingYear`, `rooms`, `occupants`, `childrenUpToSix`, and the Feature group ratings `bathroomRating`, `kitchenRating`, `apartmentRating`, `buildingRating`, `surroundingsRating`); other keys are ignored, and so are numeric values that do not parse, building years without a four-digit year and ratings other than `positive` / `neutral` / `negative` (an `address` is taken as given). Confirmed values become the user's own Tenancy facts. A confirm without a message skips the Intent router, and the Supervisor is told which facts were confirmed.

It yields these events:

| Event | When |
|---|---|
| `{ type: "tenancy", tenancy }` | the Tenancy changed: as the first event of a turn whose `confirm` changed it, and once after each round of Supervisor tool calls (all Sub-agents of that round) that changed it |
| `{ type: "intent", intents }` | the message was classified (not on confirm-only turns). `intents` ⊆ `general`, `address`, `mietspiegel`, `occupancy`, `document`, `out_of_scope`; `out_of_scope` only ever stands alone |
| `{ type: "agent_step", agent, status }` | `agent` is `OfficialDataAgent`, `ComplianceAgent` or `LeaseAnalysisAgent`; `status` is `started`, `finished`, `failed` or `needs_facts` (`failed`: see the error convention above; also emitted when the Sub-agent's own loop breaks, e.g. its 12-step limit, and the turn then ends with `error`). A partly blocked Compliance request emits `needs_facts` for the blocked check, then `started` / `finished` for the one that could run |
| `{ type: "token", text }` | the answer, once, after the grounding check: one event with the whole text, including the legal disclaimer when one applies |
| `{ type: "done" }` or `{ type: "error", message }` | exactly one of them ends every turn |

An out-of-scope message yields `intent`, `token`, `done` and never reaches the Supervisor. A Supervisor that keeps delegating is stopped by the graph's recursion limit (40) with an `error` event.

**The Tenancy** (`tenancy` events and `getTenancy()`, which returns `{}` for an unknown thread) maps each fact name to `{ value, source, confidence?, statedBy? }`:

- Facts: `address`, `livingAreaSqm`, `contractRent`, `buildingYear`, `rooms`, `occupants`, `childrenUpToSix`, the Feature group ratings `bathroomRating`, `kitchenRating`, `apartmentRating`, `buildingRating`, `surroundingsRating` (each `positive`, `neutral` or `negative`), plus the official-only `coordinates` and `residentialLocation`.
- A changed address clears the official facts of the old one, and the Feature group ratings (they describe the old flat). The first address, and the Canonical address of a stated one, keep the ratings.
- `source` is `user`, `lease` or `official`. Precedence is user > lease > official, except that the Canonical address (official) always replaces a stated address; it then carries `statedBy` with the source of the address it replaced.
- A fact is Unconfirmed when `source === "lease"` and `confidence` is missing or below 0.8. Show these on the review card and send the user's answer back as `confirm`.

**The legal disclaimer** is appended by code (ADR 0003), in the user's language: to every answer with a Compliance verdict from this turn's Tool results, and otherwise to the conversation's first answer that is not an out-of-scope reply.

### Running with real Tools or stub Tools

**Real Tools** (official Berlin data):

```js
import { createBerlinTools, createOrchestrator } from "./orchestrator/index.js";

const orchestrator = createOrchestrator({ models: createOpenAIModels(), tools: createBerlinTools().tools });
```

`createBerlinTools({ fetchImpl?, timeoutMs? })` (`src/orchestrator/berlin-tools.js`) returns the four real Tools plus the stub `extract_lease_data` (lease OCR is not wired in here yet), so the set is complete:

| Tool | Backed by | Requests |
|---|---|---|
| `validate_berlin_address` | `parseAddressInput` + `lookupBerlinAddress` (`src/berlin-address.js`), `getBerlinResidentialLocation` | address register, then Wohnlage 2026 WFS |
| `lookup_building_age` | `getBerlinBuildingAgeArea` | Umweltatlas building-age WFS |
| `calculate_mietspiegel` | `evaluateMietspiegel` | none |
| `assess_occupancy_compliance` | `assessOccupancy` | none |

- `validate_berlin_address` only verifies the address and looks up its Wohnlage; unlike the form endpoint's `verifyBerlinAddress`, it does no building-age, Mietspiegel or occupancy work (those are their own Tools). A well-formed address the register does not know returns `{ verified: false, address: null }`.
- `lookup_building_age` with no data for the coordinates returns `{ predominantConstructionPeriod: null, note }`. The value is the block's predominant period, not the building's own year (`buildingSpecific: false`).
- `fetchImpl` replaces the global `fetch` for every Berlin request (tests pass a fake). `timeoutMs` (default `DEFAULT_TOOL_TIMEOUT_MS`, 10 s) is one Tool call's budget for all its requests: keep it equal to `createOrchestrator`'s `toolTimeoutMs`, so the requests are aborted when the Tool wrapper gives up on an attempt. The adapters never retry; the wrapper does. (The legacy `POST /api/v1/address-verifications` keeps its own 8 s per request.)
- Errors: an address without house number or postal code, or outside Berlin's postal codes, and invalid Mietspiegel or occupancy arguments are input errors (the Supervisor asks the user); HTTP errors, network failures and timeouts of the Berlin services are upstream errors.

**Addresses the chat can pass** to `validate_berlin_address`: street, house number and a Berlin postal code, in this order. These forms are understood: `Berliner Straße 155, 10715 Berlin`, `Berliner Str. 155, 10715 Berlin`, `Berliner Straße 155 10715` (no comma), `Berliner Strasse 155 10715 Berlin`, `berliner str. 155, 10715`, `Berliner Straße 155a, 10715`, and the two-line form (whether the house number exists is up to the register). The adapter expands `Str.` / `str.` and `Strasse` to `Straße` (the register matches street names exactly, ignoring case) and inserts the missing comma before the postal code. Without a postal code (`Berliner Straße 155`, `Berliner Straße 155, Berlin`) or house number, the call is an input error saying that street, house number and postal code are needed, so the Supervisor asks for them. Not supported: the postal code before the street (`10715 Berlin, Berliner Straße 155`), `Str` without a dot, and other abbreviations such as `Pl.`; these are simply not found (`verified: false`) or, without a recognisable house number and postal code, input errors.

**Stub Tools** (no network, fixed data):

```js
import { createOrchestrator, createStubTools } from "./orchestrator/index.js";

const orchestrator = createOrchestrator({ models: createOpenAIModels(), tools: createStubTools().tools });
```

The stubs satisfy every contract: address verification always returns Berliner Straße 155, 10715 Berlin (Wohnlage `gut`), the building-age lookup always returns `"1921 - 1930"`, the Mietspiegel and occupancy stubs run the real calculations in `src/berlin-mietspiegel.js` and `src/occupancy-assessment.js`, and the lease stub returns a lease with an Unconfirmed contract rent (780 €, confidence 0.6). `createStubTools(overrides)` replaces a handler by Tool name, e.g. to simulate a failing service.

## Configuration

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | OpenAI (or OpenRouter) credentials |
| `OPENAI_BASE_URL` | optional API endpoint; set `https://openrouter.ai/api/v1` to go through OpenRouter (read by `@langchain/openai`, no code needed). Leave unset for OpenAI directly |
| `OPENAI_MODEL` | chat model for the Supervisor and the Sub-agents (**required**; `createOpenAIModels` throws `Set OPENAI_MODEL …` without it) |
| `OPENAI_ROUTER_MODEL` | optional cheaper model for Intent classification; defaults to `OPENAI_MODEL` |
| `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT` | LangSmith tracing, **development only** |

No model name is hard-coded. Copy `.env.example` to `.env` (gitignored) and load it with Node's built-in loader, e.g. `node --env-file=.env src/server.js`. Never commit keys or a `.env` file.

Through OpenRouter, prefer OpenAI models (e.g. `openai/gpt-4.1`, router `openai/gpt-4.1-mini`): the Intent router uses a strict JSON schema and the Supervisor uses tool calling, which other providers support unevenly.

> **Warning: LangSmith traces contain personal data.** A trace holds the full prompts, messages, Tenancy and Tool payloads, including the contents of uploaded leases. Keep `LANGSMITH_TRACING` off whenever real leases or real tenants' data are processed; use it only with stub Tools and made-up data. The built-in audit log never contains argument values.

## Tests

`npm test` runs everything offline against a scripted fake model (`test/orchestrator/helpers/scripted-model.js`), the stub Tools, and the real Tools on a fake `fetch` that replays recorded Berlin WFS responses (`test/helpers/fake-berlin-wfs.js`, `test/fixtures/berlin-wfs/`).

`test/orchestrator/berlin-live.test.js` calls the real Berlin services for one known address (Wühlischstraße 30, 10245) and is skipped unless `BERLIN_LIVE=1`:

```sh
BERLIN_LIVE=1 node --test test/orchestrator/berlin-live.test.js
```

The live smoke tests in `test/orchestrator/openai-live.test.js` call the real OpenAI API (with stub Tools) and are skipped unless both `OPENAI_API_KEY` and `OPENAI_MODEL` are set:

```sh
node --env-file=.env --test test/orchestrator/openai-live.test.js
# or: OPENAI_API_KEY=… OPENAI_MODEL=… node --test test/orchestrator/openai-live.test.js
```

They check that a German Mietspiegel question ends with `done`, a finished `ComplianceAgent` step and the German disclaimer, and that confirming the lease's Unconfirmed contract rent re-runs the Mietspiegel check.

## Mietspiegel span weighting

The Mietspiegel check always runs on the reference range. As an optional follow-up, the Supervisor may offer a more precise estimate: five short questions (bathroom, kitchen, apartment, building, surroundings: better than usual, average or worse). The answers become Feature group ratings (user facts, answerable across turns and correctable one by one). Once all five are known, a re-run passes `featureGroups` to `calculate_mietspiegel`, and the answer states `adjustedReferenceRent` as an estimate based on the Orientierungshilfe, which is not part of the qualified Mietspiegel: the range stays the reference, and the contract rent is still compared with the range.

## Known gaps

- **Re-running a check after a confirmation is a prompt rule, not code.** When the user confirms an Unconfirmed fact, the Supervisor prompt tells the model to re-run the checks that were waiting for it; nothing in the graph tracks the pending check. The second live smoke test covers this and passed on 2026-09-28 with `openai/gpt-4.1`; run it again (or try it by hand) whenever the prompt or model changes.
- **Re-running the Mietspiegel check once the fifth rating arrives is a prompt rule**, like the re-run after a confirmation above. Offering the follow-up at all is the model's choice.
- **Restating the same address in another spelling clears the Feature group ratings**, because the flat cannot be told apart before verification; the Supervisor has to ask for them again.
- **A low-confidence lease building year blocks the Mietspiegel check.** A lease value outranks official data, so an Unconfirmed lease `buildingYear` replaces the official construction period and blocks the Mietspiegel check until the user confirms it.
- **`confirm` together with a message** merges the facts as the user's, but the Supervisor only sees them as `(user)` facts in the Tenancy, with no "[Confirmed Tenancy facts]" marker.
- **Mixed construction periods leave the building year open.** Where the block's predominant period is `gemischte Baualtersklasse` (e.g. the real Berliner Straße 155), it contains no year, so no official `buildingYear` is recorded and the Mietspiegel check reports `needs_facts` for it: the Supervisor asks the tenant for the building year.
- **Tool results are not validated** against the contracts' `output` schemas at runtime (see "For Tool authors").
- **Grounding is number-based and permissive** (ADR 0003): Unconfirmed lease values count as grounded, any integer equal to a rounded grounded value passes, every number inside a Tool result string (years, house numbers, postal codes) is grounded, and Compliance verdicts themselves are not checked. Dates must match a source literally.
- **The disclaimer follows this turn's Tool results.** A later answer that restates an earlier verdict without calling a Tool again gets no disclaimer (unless it is the conversation's first answer).
- **Verified against a real model, with limits.** On 2026-09-28 both live smoke tests passed via OpenRouter with `openai/gpt-4.1` (router `openai/gpt-4.1-mini`), with stub Tools: the provider accepted the Intent router's strict JSON schema, the trimmed router history and the Supervisor's tool calls; a German Mietspiegel question ended with `done`, a finished `ComplianceAgent` step and the German disclaimer; and the model re-ran the Mietspiegel check after the rent was confirmed. Still unverified: the OpenAI API directly (without OpenRouter), other models, real (non-stub) Tools, and the quality of the answers — the tests assert the event structure, not whether a real model trips grounding rewrites on citations such as "§ 7 Abs. 1" or on dates it writes.

import test from "node:test";
import assert from "node:assert/strict";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { OccupancyInputError } from "../../src/occupancy-assessment.js";
import { wrapTool } from "../../src/orchestrator/tool-wrapper.js";

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
  assert.equal(typeof logs[0].latencyMs, "number");
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
  assert.doesNotMatch(JSON.stringify(logs), /13\.3|52\.4|1921/);
});

test("retries an upstream failure once and then succeeds", async () => {
  const { base, calls } = fakeTool((_, n) => {
    if (n === 1) throw new Error("Berlin building-age service returned 503");
    return { predominantConstructionPeriod: "1921 - 1930" };
  });
  const { wrapped, logs } = wrap(base);
  assert.match(await wrapped.invoke(ARGS), /1921 - 1930/);
  assert.equal(calls(), 2);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].attempts, 2);
  assert.equal(logs[0].outcome, "ok");
});

test("gives up after one retry and returns a structured upstream error instead of throwing", async () => {
  const { base, calls } = fakeTool(() => {
    throw new Error("down");
  });
  const { wrapped, logs, evidence } = wrap(base);
  assert.deepEqual(JSON.parse(await wrapped.invoke(ARGS)), { error: "upstream", message: "down" });
  assert.equal(calls(), 2);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].attempts, 2);
  assert.equal(logs[0].outcome, "error");
  assert.equal(logs[0].errorKind, "upstream");
  assert.deepEqual(evidence, [{ tool: "lookup_building_age", args: ARGS, error: { kind: "upstream", message: "down" } }]);
});

test("times out a slow tool, counts it as upstream and retries it once", async () => {
  const { base, calls } = fakeTool(() => new Promise(() => {}));
  const { wrapped, logs } = wrap(base);
  const result = JSON.parse(await wrapped.invoke(ARGS));
  assert.equal(result.error, "upstream");
  assert.match(result.message, /lookup_building_age did not respond within 50 ms/);
  assert.equal(calls(), 2);
  assert.equal(logs[0].errorKind, "upstream");
});

test("never retries an input error, whether marked by kind or by an *InputError class", async () => {
  for (const makeError of [
    () => new OccupancyInputError([{ field: "occupants", code: "required" }]),
    () => Object.assign(new Error("house number missing"), { kind: "input" }),
  ]) {
    const { base, calls } = fakeTool(() => {
      throw makeError();
    });
    const { wrapped, logs } = wrap(base);
    assert.equal(JSON.parse(await wrapped.invoke(ARGS)).error, "input");
    assert.equal(calls(), 1);
    assert.equal(logs[0].attempts, 1);
    assert.equal(logs[0].errorKind, "input");
  }
});

test("pinned arguments override what the model passed", async () => {
  const seen = [];
  const { base } = fakeTool((args) => {
    seen.push(args);
    return { predominantConstructionPeriod: null };
  });
  const { wrapped, evidence } = wrap(base, { pinnedArgs: { longitude: 13.3295 } });
  await wrapped.invoke({ longitude: 99, latitude: 52.4 });
  assert.deepEqual(seen, [{ longitude: 13.3295, latitude: 52.4 }]);
  assert.deepEqual(evidence[0].args, { longitude: 13.3295, latitude: 52.4 });
});

test("pinned arguments can be resolved at call time", async () => {
  const seen = [];
  const { base } = fakeTool((args) => {
    seen.push(args);
    return { predominantConstructionPeriod: null };
  });
  let pinned = {};
  const { wrapped } = wrap(base, { pinnedArgs: () => pinned });
  await wrapped.invoke({ longitude: 1, latitude: 2 });
  pinned = { longitude: 13.3295, latitude: 52.4872 };
  await wrapped.invoke({ longitude: 1, latitude: 2 });
  assert.deepEqual(seen, [
    { longitude: 1, latitude: 2 },
    { longitude: 13.3295, latitude: 52.4872 },
  ]);
});

test("arguments the Tool's schema rejects are an audited input error, not retried", async () => {
  const { base, calls } = fakeTool(() => ({ predominantConstructionPeriod: null }));
  const { wrapped, logs, evidence } = wrap(base);
  const result = JSON.parse(await wrapped.invoke({ longitude: "east", latitude: 52.4 }));
  assert.equal(result.error, "input");
  assert.equal(calls(), 0);
  assert.deepEqual(
    logs.map((l) => [l.attempts, l.outcome, l.errorKind]),
    [[1, "error", "input"]],
  );
  assert.equal(evidence[0].error.kind, "input");
});

test("pinned arguments fill in an argument the model left out", async () => {
  const seen = [];
  const { base } = fakeTool((args) => {
    seen.push(args);
    return { predominantConstructionPeriod: null };
  });
  const { wrapped } = wrap(base, { pinnedArgs: { longitude: 13.3295 } });
  await wrapped.invoke({ latitude: 52.4 });
  assert.deepEqual(seen, [{ longitude: 13.3295, latitude: 52.4 }]);
});

test("a guard that refuses the call returns an audited input error without calling the Tool", async () => {
  const { base, calls } = fakeTool(() => ({ predominantConstructionPeriod: "1921 - 1930" }));
  const { wrapped, logs, evidence } = wrap(base, { guard: () => "verify the address first" });
  assert.deepEqual(JSON.parse(await wrapped.invoke(ARGS)), { error: "input", message: "verify the address first" });
  assert.equal(calls(), 0);
  assert.deepEqual(
    logs.map((l) => [l.attempts, l.outcome, l.errorKind]),
    [[0, "error", "input"]],
  );
  assert.equal(evidence[0].result, undefined);
});

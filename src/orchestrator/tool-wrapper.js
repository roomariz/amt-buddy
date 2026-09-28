import { tool } from "@langchain/core/tools";

export const DEFAULT_TOOL_TIMEOUT_MS = 10_000;

class ToolTimeoutError extends Error {
  constructor(name, timeoutMs) {
    super(`${name} did not respond within ${timeoutMs} ms`);
    this.name = "ToolTimeoutError";
  }
}

// "input": the arguments were wrong (never retried; the user or model must fix them),
// signalled by `kind: "input"` or a class name ending in InputError.
// "upstream": everything else, e.g. the Berlin WFS being slow or down.
export function errorKind(error) {
  if (error?.kind === "input") return "input";
  if (/InputError$/.test(error?.name ?? "") || /InputError$/.test(error?.constructor?.name ?? "")) return "input";
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

// Wraps a Tool with a timeout, one retry for upstream failures, a PII-free audit log entry
// per call (argument names, never values), one evidence entry per call, and
// structured errors returned to the Sub-agent instead of thrown.
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
      let outcome;
      while (attempts <= retries) {
        attempts += 1;
        try {
          outcome = { result: await withTimeout(Promise.resolve(baseTool.invoke(args)), timeoutMs, baseTool.name) };
          break;
        } catch (error) {
          outcome = { error: { kind: errorKind(error), message: error?.message ?? String(error) } };
          if (outcome.error.kind === "input") break;
        }
      }
      log({
        event: "tool_call",
        threadId,
        agent,
        tool: baseTool.name,
        argKeys: Object.keys(args ?? {}),
        attempts,
        latencyMs: Date.now() - startedAt,
        outcome: outcome.error ? "error" : "ok",
        ...(outcome.error && { errorKind: outcome.error.kind }),
      });
      onEvidence({ tool: baseTool.name, args, ...outcome });
      if (outcome.error) return JSON.stringify({ error: outcome.error.kind, message: outcome.error.message });
      return JSON.stringify(outcome.result);
    },
    { name: baseTool.name, description: baseTool.description, schema: baseTool.schema },
  );
}

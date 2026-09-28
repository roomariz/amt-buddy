// Translates LangGraph stream chunks (streamMode ["custom", "values"]) into the
// Orchestrator's domain events, so the UI never sees LangGraph internals.
export function createEventTranslator() {
  let lastIntents = null;

  return function translate(mode, chunk) {
    if (mode === "custom") return [chunk];

    const events = [];
    const intents = JSON.stringify(chunk.intents ?? []);
    // The first values chunk is the state before this turn ran; only later changes are news.
    if (lastIntents !== null && intents !== lastIntents && chunk.intents.length > 0) {
      events.push({ type: "intent", intents: chunk.intents });
    }
    lastIntents = intents;
    return events;
  };
}

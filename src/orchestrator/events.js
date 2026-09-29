// Translates LangGraph stream chunks (streamMode ["custom"], chunks as [mode, chunk]) into the
// Orchestrator's domain events, so the UI never sees LangGraph internals.
// Graph nodes emit domain events themselves through LangGraph's stream writer.
export function createEventTranslator() {
  return function translate(mode, chunk) {
    return mode === "custom" ? [chunk] : [];
  };
}

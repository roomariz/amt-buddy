# Missing Tenancy facts end the turn instead of using interrupt()

When a Sub-agent cannot proceed because a Tenancy fact is missing (e.g. `occupants` for the occupancy check), it reports the missing facts, the Supervisor finishes whatever work can still run, and the turn ends with a clarifying question; the user's next message fills the Tenancy and the Supervisor resumes from what the Tenancy still lacks. We deliberately did not use LangGraph's `interrupt()` / `Command({ resume })`: it would force the UI to handle a paused-graph state, whereas ending the turn keeps `send()` a plain request/response loop and reuses the same path as conversational corrections.

## Consequences

Resumption relies on the Tenancy being the source of truth for what is known and missing, not on graph position. `interrupt()` remains the right tool for a future approval step (e.g. "send this letter?").

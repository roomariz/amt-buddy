# The landlord's thumbs up/down is an additive bonus outside the Match score

On the chat-first page the landlord can rate an applicant thumbs up or down. A rating adds or subtracts N bonus points to that applicant's ranking score (Match score + bonus):
- **N** is 5 by default and stays within 0–20. The chat changes it with `set_bonus_points`, computed in code (ADR 0004).
- **The Match score itself stays objective.** Nobody's score or rank changes until the landlord rates someone.

We rejected a seventh weighted criterion ("your impression", unrated = half marks). It would shift every applicant's Match score and every hand-computed test, and it would put a subjective judgement inside the number the ADR 0004 scorer defends as reproducible.

## Consequences

**Ratings are per landlord and applicant, in SQLite.**
- Both pages rank with them, so the classic dashboard's order moves too.
- Unrated results are unchanged: the scorer's output gains `rating` and `bonus` only on rated entries.

**The model sees ratings only as ids with +N or −N.** It cannot set them, and it must refuse to suggest them on protected grounds.

**A subjective rating is where discrimination under the AGG can enter**, because it bypasses the lawful criteria. The page puts a hint beside the thumbs: "rate only what you could defend: reliability, communication, the viewing". Whether ratings should also need a short reason, so a landlord can later show why, is open for the team.

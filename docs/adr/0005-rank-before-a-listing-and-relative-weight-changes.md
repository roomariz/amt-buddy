# Rank before a Listing, and change weights relatively in code, within limits

The chat-first landlord page (`/landlord-chat.html`, a prototype beside the classic dashboard) shows a ranking from the first visit. Until then `rankApplicants` needed a Listing (rent and size). Now a fact about the flat that is still missing switches off only what depends on it:
- **without an asking rent**, affordability's share is 0 and the active criteria are renormalised, and the `maxRentToIncome` Requirement is not evaluated;
- **without the size or the rooms**, the `occupancyCompliant` Requirement is not evaluated;
- **the result says so** in `inactive`.

The landlord gives the flat's facts in the chat (`update_flat_details`), one at a time or together. Once address, size, rooms and rent are known, the same `buildListing` as the classic form builds the Listing with its Rent check.

Weight changes from the chat are relative ("give SCHUFA 30 % more importance") and are computed by `adjustSelectionCriteria` (`src/landlord/criteria.js`), never by the model (ADR 0004): the named criterion's share × factor, or a target share, while the criteria not named keep their proportions and fill the rest. The operation holds the limits:
- every share stays between 0 and 50 %;
- a request above 50 % is capped and reported as capped;
- a criterion not named may not be pushed above 50 %;
- at least two criteria stay above 0;
- the named shares may not exceed 100 %;
- all of it is checked before the store changes.

We rejected two alternatives:
- **A demo Listing on sign-in:** it would rank for a flat the landlord does not have.
- **Absolute weights from the model:** the model would do the arithmetic, and nothing would stop 90 % on one criterion.

## Consequences

**The landlord chat Tools no longer refuse without a Listing**, on both pages. `update_selection_criteria` keeps Requirements only (its contract rejects `weights`), so the chat can change weights only through `adjust_selection_criteria` and its limits. The classic page's `PUT criteria` (the sliders) is unchanged and has no 50 % cap; whether it should get one is open for the team.

**The 50 % cap applies to the saved shares.** While affordability is inactive, the active shares can be higher (50 of the 70 active points is 71 %); the chat and the tips name inactive criteria as "not counted yet".

**When only inactive criteria carry weight**, every Match score is 0 and ties fall back to applicant id.

**With a full Listing, results are meant to be identical to before.** Two things back this:
- **Kept tests:** the scorer tests from before pass unchanged; the branch only adds to `test/landlord/scorer.test.js`.
- **A one-off comparison, not kept as a test:** on 2026-09-30 the verifier compared `a3585d2` with `0e9cd8c`. It covered 20 scorer runs on the real pool and the dashboard in 3 states, and the outputs were byte-identical.

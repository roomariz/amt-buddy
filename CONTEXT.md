# Amt-Buddy

Amt-Buddy helps Berlin tenants check a tenancy against official Berlin data and rules: address verification, Mietspiegel reference rent, and § 7 WoAufG Bln occupancy. It also helps a Berlin landlord check the asking rent of the flat they let (the Listing) against the Mietspiegel and the Mietpreisbremse.

## Language

### Agent

**Orchestrator**:
The conversational agent that receives a user's message, decides which Tools to call, and composes the answer. It owns the conversation, not the domain calculations.
_Avoid_: Bot, assistant, router, brain

**Tool**:
A single named capability the Orchestrator can invoke with structured arguments (e.g. `validate_berlin_address`, `calculate_mietspiegel`). Tools are built independently of the Orchestrator and handed to it.
_Avoid_: Function, plugin, skill, service

**Sub-agent**:
A specialised agent the Orchestrator delegates a focused task to (Official Data, Compliance, Lease Analysis). Each Sub-agent works with its own subset of Tools and reports back to the Orchestrator, never to the user directly.
_Avoid_: Worker, specialist, expert

**Intent**:
A category of request the Orchestrator recognises in a user's message before acting on it: general, address, mietspiegel, occupancy, document, or out of scope. A message may carry several Intents at once; out of scope only ever stands alone.
_Avoid_: Topic, route, mode

### Tenancy

**Tenancy**:
The rental arrangement under evaluation in a conversation: the flat's address, living area, rooms and building year, plus its contract rent and who lives there (occupants, children up to six). It is the single set of facts every compliance check reads from.
_Avoid_: Dwelling, case, apartment, profile

**Tenancy fact**:
One value in a Tenancy (e.g. contract rent), together with its source (stated by the user, extracted from a lease, or looked up from official data) and, for extracted values, a confidence.
_Avoid_: Field, attribute

**Unconfirmed fact**:
A Tenancy fact extracted from a lease with confidence below 0.8 that the user has not yet confirmed. No compliance check runs on an Unconfirmed fact; once the user confirms or corrects it, its source becomes the user.
_Avoid_: Draft, pending, guess

**Canonical address**:
The official form of the Tenancy's address as returned by address verification. Once it exists, it replaces whatever address the user or lease supplied.
_Avoid_: Normalized address, clean address

**Feature group rating**:
The tenant's rating of one of the five feature groups of the Mietspiegel Orientierungshilfe (bathroom, kitchen, apartment, building, surroundings): positive, neutral or negative, i.e. better than usual, average or worse. A Tenancy fact the tenant states; it belongs to the flat, so a changed address clears it.
_Avoid_: Score, grade, Merkmal

**Adjusted reference rent**:
An estimate of the flat's reference rent within the Mietspiegel range, weighted by all five Feature group ratings. It is based on the Orientierungshilfe, which is not part of the qualified Mietspiegel, so the range stays the reference and the contract rent is compared with the range.
_Avoid_: Exact rent, precise Mietspiegel value

**Rented before**:
Whether the flat was rented out before the current lease, a Tenancy fact the tenant states (yes/no). A tenant who does not know is recorded as rented before. It belongs to the flat, so a changed address clears it.
_Avoid_: Previous tenancy, occupied before

**Previous rent (Vormiete)**:
The monthly net cold rent the previous tenant paid for a flat rented before (§ 556e BGB), a Tenancy fact the tenant states. If it is higher than Mietspiegel + 10 %, it becomes the Rent cap. It is optional: without it the Rent cap verdict is conditional. It belongs to the flat, so a changed address clears it.
_Avoid_: Old rent, former rent

**First used after 2014**:
Whether a flat never rented before was first used (first occupied) after 1 October 2014, a Tenancy fact the tenant states (yes/no). The first rental of such a new build is exempt from the Rent cap (§ 556f BGB). It is asked only when the building is not known to be from before 2014. It belongs to the flat, so a changed address clears it.
_Avoid_: Neubau flag, built after 2014 (the building year is not the date of first use)

### Conversation

**Transcript**:
The visible part of a conversation: the tenant's turns (message text, a lease upload, confirmed values) and Amt-Buddy's final answers, in order. It is what the chat page draws again after a reload. It is not the model's message history: it leaves out Tool calls, Tool results, internal markers and grounding drafts.
_Avoid_: History, chat log, messages

### Answers

**Compliance verdict**:
A conclusion about whether the Tenancy meets a Berlin rule: its contract rent relative to the Mietspiegel reference range, or its living area per person under § 7 WoAufG Bln. Every Compliance verdict carries the legal disclaimer.
_Avoid_: Result, finding, judgement

**Rent cap (Mietpreisbremse)**:
The Compliance verdict on the contract rent under §§ 556d–556g BGB: at the start of a lease the rent may be at most the local reference rent + 10 %. The reference rent is the Adjusted reference rent when all five Feature group ratings are known, otherwise the Mietspiegel median. For a flat rented before, a higher Previous rent (Vormiete) becomes the cap; while the previous rent is unknown, the verdict is conditional, because a higher previous rent could justify a higher rent. The first rental of a flat never rented before and First used after 2014 is exempt: there is no cap. It assumes the contract rent is the rent agreed at the start of the lease and sits next to the unchanged range comparison.
_Avoid_: Rent limit, rent brake, Kappungsgrenze (that is the cap on rent increases)

**Grounded claim**:
A number or Compliance verdict in an answer that can be traced to a Tool result of the current turn (or a missing-facts report from gating), a Tenancy fact, or the tenant's own message in that turn. Only Grounded claims may reach the user.
_Avoid_: Verified claim, fact-checked

### Landlord

**Landlord**:
The person letting one flat, identified by the name they sign in with (trimmed, case-insensitive; no password). Owns one Listing, their Selection criteria, Landlord preferences and a Shortlist.
_Avoid_: Owner, user, account, Vermieter-Profil

**Listing**:
The flat the Landlord lets: address (becomes a Canonical address once verified), living area, rooms, asking net cold rent, optional building year, plus the official facts looked up for it (Wohnlage, building-age period) and its Rent check.
_Avoid_: Offer, ad, property, Tenancy (that is the tenant's side)

**Rent check**:
The result of running the Mietspiegel / Rent cap calculation on the Listing with the asking rent as contract rent, on a flat rented before: the Mietspiegel range, where the asking rent sits in it (low / typical / high), and whether it exceeds Mietspiegel + 10 % with the rent that would be allowed. It is informational for the Landlord, not a Compliance verdict on a Tenancy.
_Avoid_: Rent verdict, compliance check, valuation

**Applicant**:
A person (household) who applied for the flat; one file in the Applicant pool.
_Avoid_: Candidate, tenant (until a lease is signed), lead

**Applicant pool**:
The set of applications, read from the synthetic Markdown files. Read-only for the app.
_Avoid_: Applications database, inbox

**Application document**:
One document inside an application: SCHUFA-Auskunft, Income proof (payslips / employer confirmation / guarantor), Previous-landlord confirmation (Vormieterbescheinigung / Mietschuldenfreiheitsbescheinigung).
_Avoid_: Attachment, upload, file

**Document check**:
The per-Applicant result of checking the Application documents: present / missing / expired / inconsistent (or not required: a first-time renter has no Previous-landlord confirmation), each with a reason, plus the list of issues found (including rent arrears confirmed by the previous landlord).
_Avoid_: Verification, KYC

**Credibility score**:
0–100, derived only from the Document check: how much of the declared data the documents support.
_Avoid_: Trust score, rating

**Applicant profile**:
The anonymised, structured view of an Applicant that everything downstream uses: id, household size (with adults, children and children up to six, as § 7 WoAufG Bln needs them), net household income, employment type, SCHUFA status, move-in date, pets/smoking, Document check, Credibility score. It never contains protected characteristics. Names and contact details stay in the source data and never reach the landlord interface, scorer, or model; the interface identifies applications by id.
_Avoid_: Applicant record, dossier

**Selection criteria**:
The Landlord's tunable weights per scoring criterion plus hard Requirements.
_Avoid_: Filters, settings, preferences (those are Landlord preferences)

**Requirement**:
A hard filter within the Selection criteria (e.g. clean SCHUFA only). An Applicant who fails one is Excluded, with the reason.
_Avoid_: Rule, must-have, filter

**Match score**:
0–100, the weighted score of an Applicant profile for this Listing under the current Selection criteria, with its per-criterion breakdown.
_Avoid_: Rank, rating, fit

**Recommendation**:
One of the top 1–2 non-excluded Applicants, with reasons generated from their score breakdown.
_Avoid_: Suggestion, pick, top match

**Landlord preferences**:
The long-term memory about a Landlord: saved Selection criteria plus free-text preference notes from the chat.
_Avoid_: Memory, profile, settings

**Landlord Orchestrator**:
The conversational agent of the landlord side: one agent with its own Tools (ranking, Applicant profile, Selection criteria, Landlord preferences, Shortlist, Rent check), separate from the tenant Orchestrator, with no Intent router and no Sub-agents. It sees applicants by id only. The Amt-Buddy agent acts as an intelligent intermediary between the landlord's natural-language intent and the application's deterministic screening and ranking tools. It clarifies ambiguous instructions, builds a structured understanding of the landlord's preferences, confirms that understanding, and only then invokes the appropriate tools to update criteria, filter or re-rank applicants and explain the resulting changes.
_Avoid_: Landlord bot, landlord assistant

**Shortlist**:
The Applicants the Landlord selected, each with a status (`to_invite`, `invited`, `declined`) and an optional note.
_Avoid_: Favourites, watchlist, selection

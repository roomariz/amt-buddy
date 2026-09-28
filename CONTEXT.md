# Amt-Buddy

Amt-Buddy helps Berlin tenants check a tenancy against official Berlin data and rules: address verification, Mietspiegel reference rent, and § 7 WoAufG Bln occupancy.

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

### Answers

**Compliance verdict**:
A conclusion about whether the Tenancy meets a Berlin rule: its contract rent relative to the Mietspiegel reference range, or its living area per person under § 7 WoAufG Bln. Every Compliance verdict carries the legal disclaimer.
_Avoid_: Result, finding, judgement

**Grounded claim**:
A number or Compliance verdict in an answer that can be traced to a Tool result of the current turn, a Tenancy fact, or the tenant's own message in that turn. Only Grounded claims may reach the user.
_Avoid_: Verified claim, fact-checked

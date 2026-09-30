# Amt Buddy

Amt Buddy helps Berlin tenants check their flat against official Berlin open
data. Ask it in German or English, or upload your lease, and it tells you:

- whether your **address** is an official Berlin address, and its Wohnlage
  (residential location category);
- the **Mietspiegel 2026** reference rent for your flat, and whether your rent is
  below, within or above it;
- whether the **Mietpreisbremse** (rent cap) may apply to your rent;
- whether the flat is **big enough for the people living in it**
  (§ 7 WoAufG Bln).

Every answer cites its source. The results are informational and are not legal
advice.

## Quick start

You need [Node.js](https://nodejs.org/) 22.13 or newer (the landlord page uses
Node's built-in SQLite).

```sh
npm install
npm start
```

Open <http://localhost:3000>.

This starts the app **without the AI chat**: the chat answers with a simpler
rule-based assistant that does not remember the conversation. To turn on the AI
chat, see [Enable the AI chat](#enable-the-ai-chat).

## Using Amt Buddy

Type a question and press Enter. While it works, small step chips show what Amt
Buddy is checking. If a detail is missing it asks for it, so a short reply such
as "60 m²" is enough. It answers in the language you write in; the **DE | EN**
switch in the header changes the page text. If you reload the page, the
conversation comes back.

Try for example:

```text
Does my rent fall within Mietspiegel? Wühlischstraße 30, 10245 Berlin, 60 m², €900 base rent.

Is my apartment overcrowded? 50 m², 2 rooms, 4 people, including one child under the age of 6.

Please check the address Berliner Straße 155, 10715 Berlin.

What does "Wohnlage" mean in the Berlin Mietspiegel?
```

The buttons under the welcome text send questions like these with one click.

## For landlords

Open <http://localhost:3000/landlord>. Sign in with just your name (no
password), then enter your flat: address, living area, rooms, asking net cold
rent and, if you know it, the building year. Amt Buddy verifies the address,
looks up the Wohnlage and building age, and shows the Mietspiegel range for the
flat with your asking rent on it. If the asking rent is above Mietspiegel + 10 %,
it warns you and shows the rent the Mietpreisbremse would allow.

Below the Rent check, every applicant in the (synthetic) Applicant pool is ranked
by a Match score from 0 to 100, with a bar per criterion (affordability, SCHUFA,
documents, credibility, employment, previous landlord) and flags for missing or
expired documents. Sort the table or show complete applications only. Applicants
whose household is too large for the flat (§ 7 WoAufG Bln) are listed separately
as excluded, with the reason. The pool is read at start from `data/applicants`
(set `APPLICANT_POOL_DIR` and `APPLICANT_POOL_TODAY` to use another pool or day).

Put applicants you want to act on on your **Shortlist** with **Add to Shortlist**
in the ranking, on a Recommendation card or in an applicant's profile. In the
Shortlist panel, set each entry's status (to invite, invited, declined), add a
short note, or remove it.
Amt Buddy never contacts applicants; the status only helps you keep track.

Tell the chat what matters to you (for example "I'd like someone who stays
long-term") and Amt Buddy remembers it for your next conversations, together
with your Selection criteria. The **Remembered preferences** panel lists what it
remembered; delete any entry you don't want kept.

Signing in again with the same name brings your flat, your Shortlist and your
remembered preferences back, also after a restart.
The data is kept in `data/landlord.sqlite` (set `LANDLORD_DB_PATH` to use another
file).

### Chat-first page (prototype)

<http://localhost:3000/landlord-chat.html> is an alternative to the dashboard:
you work through the chat instead of forms and sliders. It uses the same sign-in
and the same data, so both pages always agree.

- **Two Recommendation slots** show two of your six best-matching applicants,
  picked at random, as generic avatars (household shape only). **Add to
  Shortlist** moves an applicant into the Shortlist beside the chat, and **Skip**
  brings another one from the top six.
- **👍 / 👎 on the slots and the Shortlist** add or subtract your own bonus
  points to an applicant's ranking (5 by default; ask the chat to give your
  impression more or less weight). The Match score stays objective. A 👎 on a slot
  also replaces the card. Rate only what you could defend (AGG). See
  [ADR 0006](docs/adr/0006-landlord-bonus-is-additive-outside-the-match-score.md).
- **The Shortlist** shows each applicant's current rank, and an expander to set
  the status (to invite, invited, declined) with a note.
- **The ranking works from the first visit.** Until you tell the chat the asking
  rent, affordability doesn't count; until you give the size and rooms, the
  household-size check is off.
- **Tell the chat about the flat** ("65 m², 2 rooms, 1,100 €, Wühlischstraße 30,
  10245"). Once it knows the address, size, rooms and rent, it runs the
  Mietspiegel check.
- **Change what matters by saying so** ("give SCHUFA 30 % more importance").
  - The code, not the model, recomputes the weights.
  - No criterion goes above 50 %, and at least two stay above 0.
  - The slots and the Shortlist ranks update, with arrows showing who moved.
- **Tips below the input** change after each chat turn and show what you can ask.

See [ADR 0005](docs/adr/0005-rank-before-a-listing-and-relative-weight-changes.md).

## Checking your lease (Mietvertrag)

Drop the file on the upload card, or attach it with **+** next to the input, and
send. Amt Buddy shows what it read (address, area, rent, rooms, building year,
occupants) in a review card. Correct anything that is wrong, then confirm to run
the checks.

Good to know:

- Accepted files: PDF with a text layer, TXT and Markdown, up to 15 MB.
- The lease reader understands German lease wording.
- **Scanned PDFs don't work**, and neither do many PDFs exported from word
  processors (for example LibreOffice), because their text is stored in a way
  Amt Buddy can't read yet. If your PDF isn't read, paste the text into a `.txt`
  file instead.

## Enable the AI chat

The AI chat needs an OpenAI-compatible model (OpenAI or OpenRouter).

1. Copy `.env.example` to `.env`. The `.env` file stays out of git.
2. Fill in `OPENAI_API_KEY` and `OPENAI_MODEL`. The example file shows the
   settings for both OpenAI and OpenRouter.
3. Start the server with the file loaded:

   ```sh
   node --env-file=.env src/server.js
   ```

> **Privacy:** leave `LANGSMITH_TRACING=false` when you use real leases. Traces
> contain the full lease text.

## Troubleshooting

- **Port 3000 is busy.** The server tries the next free port up to 3010 and
  prints the URL it chose. To use a fixed port, set `PORT` (for example
  `PORT=4000 npm start`, or `$env:PORT = 4000` in PowerShell).
- **The chat forgets earlier messages.** The AI chat isn't configured, so the
  rule-based assistant is answering. See [Enable the AI chat](#enable-the-ai-chat).
- **Restarting the server clears conversations.** Chats and uploads are kept in
  memory only.

## Data sources

Amt Buddy covers Berlin only and uses only official open data:

- Addresses: [Adressen Berlin – WFS](https://daten.berlin.de/datensaetze/adressen-berlin-wfs-634ab8ba)
- Wohnlage: [Wohnlagen nach Adressen zum Berliner Mietspiegel 2026 – WFS](https://daten.berlin.de/datensaetze/wohnlagen-nach-adressen-zum-berliner-mietspiegel-2026-wfs-809faebe)
- Building age: [Gebäudealter der Wohnbebauung (Umweltatlas) – WFS](https://daten.berlin.de/datensaetze/gebaudealter-der-wohnbebauung-umweltatlas-wfs-ad4eca4b)
- Mietspiegel table: [Berliner Mietspiegel 2026](https://daten.berlin.de/datensaetze/wohnlagen-nach-adressen-zum-berliner-mietspiegel-2026-wfs-809faebe) (SenStadt)
- Occupancy law: [§ 7 WoAufG Bln](https://gesetze.berlin.de/bsbe/document/jlr-WoAufGBEV3IVZ/part/X)

Publisher: Land Berlin (Amt für Statistik Berlin-Brandenburg and Senatsverwaltung
für Stadtentwicklung, Bauen und Wohnen). License: Datenlizenz Deutschland – Zero
– Version 2.0.

Two limits of the data:

- The building age comes from block-level data, not from the individual
  building, so Amt Buddy never claims an exact construction year.
- Wohnlage (`einfach`, `mittel`, `gut`) is a location category, not a rent
  amount.

Amt Buddy stores no address data. Any extension must use Berlin-specific open
data with a publicly documented source; proprietary listing or valuation
databases are out of scope.

## For developers

Run the tests:

```sh
npm test
```

The tests mock all upstream services, so they run offline and always give the
same result. The live smoke tests run only when the model variables are set.

More documentation:

- [docs/orchestrator.md](docs/orchestrator.md): the LangGraph.js Orchestrator
  behind the AI chat. It covers the chat's HTTP/SSE endpoints, the `send()` event
  contract, how to write Tools, configuration and the LangSmith/PII warning.
- [docs/api.md](docs/api.md): the plain JSON endpoints (address check, lease
  reading, rule-based chat, the landlord side), with request and response examples.
- [CONTEXT.md](CONTEXT.md): the project's vocabulary.


### Demo: name clarification (#61)

On `/landlord`, save a Listing and open an applicant with a name discrepancy. The landlord interface identifies applicants only by ID and omits names and contact details throughout. In **Name clarification · Demo**, choose **Prepare 24-hour request**. The landlord sees a generic explanation; the copyable email and WhatsApp drafts identify the affected document types without including names or contact details. **A-002** has one differing income-proof name and **A-011** has several. No message is sent. The request survives reloads and server restarts when using the normal SQLite database; after the deadline it becomes overdue without a score penalty or automatic exclusion. The drafts ask the applicant to confirm whether the documents are theirs, explain the discrepancy, and describe the action they will take to resolve it and by when. There is no applicant reply or upload flow in this demo. Existing seven-day demo requests adopt the 24-hour deadline from their original creation time on server startup.

Names with common presentation differences are compared conservatively. Remaining name discrepancies are clarification issues, not scoring penalties; other document findings still apply. See [the API contract](docs/api.md) for persistence, status and error behavior.

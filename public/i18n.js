// The UI language (German or English) for both pages. Only page text is translated: AI answers
// follow the language the user writes in, and server-generated text stays as the server sends it.
// Importable under Node (tests): every browser access is guarded.

export const LANGUAGES = ["de", "en"];
const DEFAULT_LANGUAGE = "de";
export const LANGUAGE_KEY = "amt-buddy.language";
export const LANGUAGE_EVENT = "amt-buddy:languagechange";

const de = {
  meta: {
    chatTitle: "Amt-Buddy · Chat",
    chatDescription:
      "Amt-Buddy Chat: Fragen zu Berliner Adressen, Mietspiegel 2026 und Belegung (§ 7 WoAufG Bln) stellen oder den Mietvertrag prüfen lassen.",
    landlordTitle: "Amt-Buddy · Vermieter",
    landlordDescription:
      "Amt-Buddy für Vermieter: Wohnung eintragen und die Angebotsmiete mit dem Berliner Mietspiegel 2026 und der Mietpreisbremse vergleichen.",
  },
  lang: { label: "Sprache" },
  turn: {
    failed: "Amt-Buddy konnte diese Nachricht gerade nicht beantworten. Bitte versuchen Sie es gleich noch einmal.",
    connectionLost: "Die Verbindung zu Amt-Buddy wurde unterbrochen. Bitte senden Sie Ihre Nachricht noch einmal.",
    done: "Antwort ist da.",
  },
  steps: {
    OfficialDataAgent: {
      running: "Prüfe das amtliche Berliner Adressregister …",
      done: "Adresse im amtlichen Register geprüft",
      failed: "Der amtliche Berliner Dienst antwortet gerade nicht",
      needs_facts: "Für die Adressprüfung fehlen noch Angaben",
    },
    ComplianceAgent: {
      running: {
        mietspiegel: "Berechne den Mietspiegel …",
        occupancy: "Prüfe die Belegung (§ 7 WoAufG Bln) …",
        both: "Prüfe Mietspiegel und Belegung …",
        remaining: "Führe die mögliche Prüfung durch …",
      },
      done: {
        mietspiegel: "Mietspiegel berechnet",
        occupancy: "Belegung geprüft",
        both: "Mietspiegel und Belegung geprüft",
        remaining: "Mögliche Prüfung abgeschlossen",
      },
      failed: "Die Prüfung konnte nicht abgeschlossen werden",
      needs_facts: "Für die Prüfung fehlen noch Angaben",
    },
    LeaseAnalysisAgent: {
      running: "Lese Ihren Mietvertrag …",
      done: "Mietvertrag gelesen",
      failed: "Der Mietvertrag konnte nicht gelesen werden",
      needs_facts: "Bitte laden Sie Ihren Mietvertrag hoch",
    },
    other: {
      running: "Arbeite an Ihrer Anfrage …",
      done: "Schritt erledigt",
      failed: "Ein Schritt ist fehlgeschlagen",
      needs_facts: "Es fehlen noch Angaben",
    },
  },
  upload: {
    noTextLayer:
      "In diesem PDF ist kein lesbarer Text (zum Beispiel ein eingescannter Vertrag). Bitte laden Sie ein PDF mit Text oder eine Textdatei hoch.",
    image:
      "Bilder von Mietverträgen können noch nicht gelesen werden. Bitte laden Sie ein PDF mit Text oder eine Textdatei hoch.",
    tooLarge: "Die Datei ist zu groß (höchstens 15 MB).",
    empty: "Das Dokument ist leer.",
    failed: "Der Mietvertrag konnte nicht hochgeladen werden. Bitte versuchen Sie es noch einmal.",
    running: "Lade Ihren Mietvertrag hoch …",
    done: "Mietvertrag hochgeladen",
    stepFailed: "Hochladen fehlgeschlagen",
  },
  mode: { orchestrator: "KI-Chat", rule_based: "Regelmodus", unknown: "Chat" },
  facts: {
    address: "Adresse",
    contractRent: "Nettokaltmiete",
    livingAreaSqm: "Wohnfläche",
    rooms: "Zimmer",
    buildingYear: "Baujahr",
    occupants: "Personen im Haushalt",
    childrenUpToSix: "Kinder bis 6 Jahre",
    perMonth: "€ / Monat",
  },
  review: {
    title: "📋 Werte aus Ihrem Mietvertrag prüfen",
    hint: "Unsicher erkannte Werte sind gelb oder rot markiert. Bitte prüfen oder korrigieren Sie sie – erst dann rechnet Amt-Buddy damit.",
    high: "sicher erkannt",
    medium: "unsicher erkannt",
    low: "sehr unsicher erkannt",
    noConfidence: "ohne Angabe zur Sicherheit",
    submit: "Werte bestätigen und prüfen",
  },
  chat: {
    newChat: "Neuer Chat",
    sidebarToggle: "Seitenleiste umschalten",
    sidebar: "Seitenleiste",
    heroSubtitle:
      "Stellen Sie Ihre Frage oder laden Sie Ihren Mietvertrag hoch. Amt-Buddy prüft Adresse, Mietspiegel und Belegung mit amtlichen Berliner Daten.",
    uploadTitle: "Mietvertrag hochladen",
    uploadDesc: "PDF mit Text, TXT oder Markdown hier ablegen oder Datei auswählen",
    selectFile: "Datei auswählen",
    suggestions: "Beispielfragen",
    suggestRent: "💶 Mietspiegel prüfen",
    suggestRentPrompt: "Liegt meine Miete im Mietspiegel? Wühlischstraße 30, 10245 Berlin, 60 m², 900 € Nettokaltmiete.",
    suggestOccupancy: "👥 Belegung prüfen",
    suggestOccupancyPrompt: "Ist meine Wohnung überbelegt? 50 m², 2 Zimmer, 4 Personen, davon 1 Kind unter 6 Jahren.",
    suggestAddress: "📍 Adresse prüfen",
    suggestAddressPrompt: "Bitte prüfe die Adresse Berliner Straße 155, 10715 Berlin.",
    suggestLocation: "❓ Was ist die Wohnlage?",
    suggestLocationPrompt: "Was bedeutet die Wohnlage im Berliner Mietspiegel?",
    conversation: "Unterhaltung",
    attachTitle: "Mietvertrag anhängen (PDF oder Text)",
    attach: "Mietvertrag anhängen",
    removeFile: "Datei entfernen",
    inputLabel: "Nachricht an Amt-Buddy",
    inputPlaceholder: "Frage stellen oder Mietvertrag anhängen …",
    send: "Senden",
    modeNote:
      "Der KI-Chat ist nicht eingerichtet. Amt-Buddy antwortet mit festen Regeln und merkt sich den Gesprächsverlauf nicht.",
    disclaimer:
      "Amt-Buddy nutzt offizielle Berliner Open Data (WFS-Kataster & Mietspiegel 2026). Angaben dienen der rechtlichen Orientierung.",
    botTag: "Offizielle Prüfung · Berlin Open Data",
    steps: "Arbeitsschritte",
    working: "Amt-Buddy arbeitet …",
    confirmedValues: "Werte bestätigt – {summary}",
    leaseUploaded: "Mietvertrag hochgeladen",
  },
  landlord: {
    title: "Amt-Buddy Vermieter",
    toChat: "Zum Mieter-Chat",
    signOut: "Abmelden",
    signedInAs: "Angemeldet als {name}",
    signInTitle: "Anmelden",
    signInIntro:
      "Geben Sie Ihren Namen ein. Ein Passwort gibt es nicht: Mit demselben Namen finden Sie Ihre Wohnung beim nächsten Mal wieder.",
    name: "Ihr Name",
    signIn: "Anmelden",
    listingTitle: "Ihre Wohnung",
    listingIntro:
      "Amt-Buddy prüft die Adresse im amtlichen Berliner Register, sucht Wohnlage und Baualter heraus und vergleicht Ihre Angebotsmiete mit dem Mietspiegel 2026.",
    address: "Adresse",
    addressPlaceholder: "Wühlischstraße 30, 10245 Berlin",
    livingArea: "Wohnfläche (m²)",
    rooms: "Zimmer",
    askingRent: "Angebotsmiete netto kalt (€ / Monat)",
    buildingYear: "Baujahr (optional)",
    buildingYearHint: "Ohne Baujahr nimmt Amt-Buddy das überwiegende Baualter des Blocks.",
    save: "Wohnung speichern und prüfen",
    saving: "Prüfe …",
    rentCheckTitle: "Mietcheck",
    officialAddress: "Amtliche Adresse",
    residentialLocation: "Wohnlage",
    buildingAgePeriod: "Baualter des Blocks",
    buildingYearUsed: "Baujahr (Ihre Angabe)",
    unknown: "unbekannt",
    rangeLabel: "Mietspiegel-Spanne für Ihre Wohnung",
    lower: "Untergrenze",
    median: "Mittelwert",
    upper: "Obergrenze",
    allowedMark: "Mietspiegel + 10 %",
    askingMark: "Ihre Miete",
    position: {
      low: "Ihre Angebotsmiete von {rent} liegt unter der Mietspiegel-Spanne.",
      typical: "Ihre Angebotsmiete von {rent} liegt innerhalb der Mietspiegel-Spanne.",
      high: "Ihre Angebotsmiete von {rent} liegt über der Mietspiegel-Spanne.",
    },
    warning:
      "Achtung: Ihre Angebotsmiete liegt {excess} über Mietspiegel + 10 %. Nach der Mietpreisbremse sind höchstens {allowed} zulässig, außer die Vormiete war höher.",
    withinCap: "Ihre Angebotsmiete liegt innerhalb von Mietspiegel + 10 % (zulässig bis {allowed}).",
    notes: {
      address_not_verified:
        "Diese Adresse steht nicht im amtlichen Berliner Adressregister. Bitte prüfen Sie Straße, Hausnummer und Postleitzahl.",
      berlin_data_service_unavailable:
        "Ein amtlicher Berliner Datendienst antwortet gerade nicht. Ihre Wohnung ist gespeichert, den Mietcheck gibt es, wenn Sie sie später noch einmal speichern.",
      rent_check_not_possible: "Für diese Adresse lässt sich der Mietspiegel nicht berechnen (zum Beispiel ohne amtliche Wohnlage).",
    },
    disclaimer:
      "Der Mietcheck dient der Orientierung und ist keine Rechtsberatung. Nicht berücksichtigt: eine höhere Vormiete, Modernisierung und die Ausnahme für Neubauten.",
    errors: {
      unreachable: "Amt-Buddy ist gerade nicht erreichbar. Bitte versuchen Sie es gleich noch einmal.",
      failed: "Das hat nicht geklappt. Bitte versuchen Sie es noch einmal.",
      nameRequired: "Bitte geben Sie Ihren Namen ein (höchstens 100 Zeichen).",
    },
    chat: {
      title: "Chat mit Amt-Buddy",
      intro:
        "Fragen Sie nach Ihren Bewerbern oder Ihrer Miete, oder sagen Sie, was Ihnen wichtig ist (zum Beispiel „nur saubere SCHUFA“). Amt-Buddy wählt nie nach Herkunft, Geschlecht, Religion, Alter oder Behinderung aus (AGG).",
      label: "Ihre Nachricht",
      placeholder: "Wer ist mein bester Bewerber?",
      send: "Senden",
      you: "Sie",
      amtBuddy: "Amt-Buddy",
      thinking: "Amt-Buddy denkt nach …",
    },
    ranking: {
      title: "Bewerber-Ranking",
      intro:
        "Jeder Bewerber bekommt aus festen Kriterien einen Match-Score von 0 bis 100: Bezahlbarkeit, SCHUFA, Unterlagen, Glaubwürdigkeit, Beschäftigung und Vorvermieter. Der Name wird nur angezeigt, er zählt nicht.",
      hint: "Speichern Sie zuerst Ihre Wohnung: Die Bewerber werden für ihre Miete und Größe gerankt.",
      count: "{ranked} Bewerber im Ranking, {excluded} ausgeschlossen",
      sort: "Sortieren nach",
      sortBy: { rank: "Match-Score", name: "Name", rentToIncome: "Mietbelastung" },
      completeOnly: "Nur vollständige Unterlagen",
      rank: "Platz",
      name: "Name",
      score: "Score",
      breakdown: "Aufschlüsselung",
      rentToIncome: "Miete / Einkommen",
      documents: "Unterlagen",
      empty: "Kein Bewerber passt zu diesem Filter.",
      excludedTitle: "Ausgeschlossen",
      excludedIntro: "Diese Bewerber erfüllen eine Ihrer Anforderungen nicht.",
      reason: "Grund",
      poolErrors: "{count} Bewerbung(en) konnten nicht gelesen werden.",
      bar: "{criterion}: {percent} % (Gewicht {weight} %)",
      criteria: {
        affordability: "Bezahlbarkeit",
        schufa: "SCHUFA",
        documents: "Unterlagen",
        credibility: "Glaubwürdigkeit",
        employment: "Beschäftigung",
        previousLandlord: "Vorvermieter",
      },
      document: { schufa: "SCHUFA", incomeProof: "Einkommensnachweis", previousLandlord: "Vorvermieterbescheinigung" },
      documentStatus: { present: "vorhanden", missing: "fehlt", expired: "abgelaufen", inconsistent: "unstimmig", not_required: "nicht nötig" },
      schufaStatus: { clean: "ohne Einträge", minor_entries: "geringfügige Einträge", negative: "negative Einträge", missing: "fehlt" },
      excludedBy: {
        occupancyCompliant:
          "Ein Haushalt mit {householdSize} Personen braucht mindestens {requiredAreaSqm} m² (§ 7 WoAufG Bln); die Wohnung hat {livingAreaSqm} m².",
        maxRentToIncome: "Die Miete ist {rentToIncome} des Haushaltsnettoeinkommens (höchstens {limit}).",
        latestMoveIn: "Einzug erst am {moveInDate} (spätestens {limit}).",
        schufaCleanOnly: "SCHUFA nicht sauber: {schufaStatus}.",
        completeDocumentsOnly: "Unterlagen unvollständig: {documents}.",
        noPets: "Der Haushalt hat Haustiere.",
        noSmoking: "Im Haushalt wird geraucht.",
      },
    },
  },
};

const en = {
  meta: {
    chatTitle: "Amt-Buddy · Chat",
    chatDescription:
      "Amt-Buddy chat: ask about Berlin addresses, the Mietspiegel 2026 and occupancy (§ 7 WoAufG Bln), or have your lease checked.",
    landlordTitle: "Amt-Buddy · Landlord",
    landlordDescription:
      "Amt-Buddy for landlords: enter your flat and compare the asking rent with the Berlin Mietspiegel 2026 and the Mietpreisbremse.",
  },
  lang: { label: "Language" },
  turn: {
    failed: "Amt-Buddy could not answer this message right now. Please try again in a moment.",
    connectionLost: "The connection to Amt-Buddy was interrupted. Please send your message again.",
    done: "The answer is ready.",
  },
  steps: {
    OfficialDataAgent: {
      running: "Checking the official Berlin address register …",
      done: "Address checked in the official register",
      failed: "The official Berlin service is not responding right now",
      needs_facts: "Some details are still missing for the address check",
    },
    ComplianceAgent: {
      running: {
        mietspiegel: "Calculating the Mietspiegel …",
        occupancy: "Checking occupancy (§ 7 WoAufG Bln) …",
        both: "Checking Mietspiegel and occupancy …",
        remaining: "Running the check that is possible …",
      },
      done: {
        mietspiegel: "Mietspiegel calculated",
        occupancy: "Occupancy checked",
        both: "Mietspiegel and occupancy checked",
        remaining: "Possible check completed",
      },
      failed: "The check could not be completed",
      needs_facts: "Some details are still missing for the check",
    },
    LeaseAnalysisAgent: {
      running: "Reading your lease …",
      done: "Lease read",
      failed: "The lease could not be read",
      needs_facts: "Please upload your lease",
    },
    other: {
      running: "Working on your request …",
      done: "Step done",
      failed: "A step failed",
      needs_facts: "Some details are still missing",
    },
  },
  upload: {
    noTextLayer:
      "This PDF has no readable text (for example a scanned contract). Please upload a PDF with text or a text file.",
    image: "Images of leases cannot be read yet. Please upload a PDF with text or a text file.",
    tooLarge: "The file is too large (15 MB at most).",
    empty: "The document is empty.",
    failed: "The lease could not be uploaded. Please try again.",
    running: "Uploading your lease …",
    done: "Lease uploaded",
    stepFailed: "Upload failed",
  },
  mode: { orchestrator: "AI chat", rule_based: "Rule mode", unknown: "Chat" },
  facts: {
    address: "Address",
    contractRent: "Nettokaltmiete (net cold rent)",
    livingAreaSqm: "Living area",
    rooms: "Rooms",
    buildingYear: "Year built",
    occupants: "People in the household",
    childrenUpToSix: "Children up to 6",
    perMonth: "€ / month",
  },
  review: {
    title: "📋 Check the values from your lease",
    hint: "Values read with low certainty are marked yellow or red. Please check or correct them – only then does Amt-Buddy use them.",
    high: "read with certainty",
    medium: "read with low certainty",
    low: "read with very low certainty",
    noConfidence: "no certainty given",
    submit: "Confirm values and check",
  },
  chat: {
    newChat: "New chat",
    sidebarToggle: "Toggle sidebar",
    sidebar: "Sidebar",
    heroSubtitle:
      "Ask your question or upload your lease. Amt-Buddy checks address, Mietspiegel and occupancy against official Berlin data.",
    uploadTitle: "Upload your lease",
    uploadDesc: "Drop a PDF with text, TXT or Markdown here, or choose a file",
    selectFile: "Choose file",
    suggestions: "Example questions",
    suggestRent: "💶 Check the Mietspiegel",
    suggestRentPrompt: "Is my rent within the Mietspiegel? Wühlischstraße 30, 10245 Berlin, 60 m², 900 € net cold rent.",
    suggestOccupancy: "👥 Check occupancy",
    suggestOccupancyPrompt: "Is my flat overcrowded? 50 m², 2 rooms, 4 people, including 1 child under 6.",
    suggestAddress: "📍 Check an address",
    suggestAddressPrompt: "Please check the address Berliner Straße 155, 10715 Berlin.",
    suggestLocation: "❓ What is the Wohnlage?",
    suggestLocationPrompt: "What does the Wohnlage (residential location) mean in the Berlin Mietspiegel?",
    conversation: "Conversation",
    attachTitle: "Attach your lease (PDF or text)",
    attach: "Attach your lease",
    removeFile: "Remove file",
    inputLabel: "Message to Amt-Buddy",
    inputPlaceholder: "Ask a question or attach your lease …",
    send: "Send",
    modeNote:
      "The AI chat is not set up. Amt-Buddy answers with fixed rules and does not remember the conversation.",
    disclaimer:
      "Amt-Buddy uses official Berlin Open Data (WFS cadastre & Mietspiegel 2026). The information is for legal orientation only.",
    botTag: "Official check · Berlin Open Data",
    steps: "Steps",
    working: "Amt-Buddy is working …",
    confirmedValues: "Values confirmed – {summary}",
    leaseUploaded: "Lease uploaded",
  },
  landlord: {
    title: "Amt-Buddy Landlord",
    toChat: "Tenant chat",
    signOut: "Sign out",
    signedInAs: "Signed in as {name}",
    signInTitle: "Sign in",
    signInIntro: "Enter your name. There is no password: signing in with the same name brings your flat back next time.",
    name: "Your name",
    signIn: "Sign in",
    listingTitle: "Your flat",
    listingIntro:
      "Amt-Buddy checks the address in the official Berlin register, looks up the Wohnlage and building age, and compares your asking rent with the Mietspiegel 2026.",
    address: "Address",
    addressPlaceholder: "Wühlischstraße 30, 10245 Berlin",
    livingArea: "Living area (m²)",
    rooms: "Rooms",
    askingRent: "Asking net cold rent (€ / month)",
    buildingYear: "Building year (optional)",
    buildingYearHint: "Without a building year, Amt-Buddy uses the block's predominant construction period.",
    save: "Save and check the flat",
    saving: "Checking …",
    rentCheckTitle: "Rent check",
    officialAddress: "Official address",
    residentialLocation: "Wohnlage",
    buildingAgePeriod: "Block's construction period",
    buildingYearUsed: "Building year (as you stated)",
    unknown: "unknown",
    rangeLabel: "Mietspiegel range for your flat",
    lower: "Lower bound",
    median: "Median",
    upper: "Upper bound",
    allowedMark: "Mietspiegel + 10 %",
    askingMark: "Your rent",
    position: {
      low: "Your asking rent of {rent} is below the Mietspiegel range.",
      typical: "Your asking rent of {rent} is within the Mietspiegel range.",
      high: "Your asking rent of {rent} is above the Mietspiegel range.",
    },
    warning:
      "Warning: your asking rent is {excess} above Mietspiegel + 10 %. Under the Mietpreisbremse at most {allowed} is allowed, unless the previous rent was higher.",
    withinCap: "Your asking rent is within Mietspiegel + 10 % (allowed up to {allowed}).",
    notes: {
      address_not_verified:
        "This address is not in the official Berlin address register. Please check the street, house number and postal code.",
      berlin_data_service_unavailable:
        "An official Berlin data service is not answering right now. Your flat is saved; save it again later to get the rent check.",
      rent_check_not_possible: "The Mietspiegel cannot be calculated for this address (for example without an official Wohnlage).",
    },
    disclaimer:
      "The rent check is for orientation and is not legal advice. Not considered: a higher previous rent, modernisation and the new-build exemption.",
    errors: {
      unreachable: "Amt-Buddy cannot be reached right now. Please try again in a moment.",
      failed: "That did not work. Please try again.",
      nameRequired: "Please enter your name (at most 100 characters).",
    },
    chat: {
      title: "Chat with Amt-Buddy",
      intro:
        "Ask about your applicants or your rent, or say what matters to you (for example “clean SCHUFA only”). Amt-Buddy never selects by origin, gender, religion, age or disability (AGG).",
      label: "Your message",
      placeholder: "Who is my best applicant?",
      send: "Send",
      you: "You",
      amtBuddy: "Amt-Buddy",
      thinking: "Amt-Buddy is thinking …",
    },
    ranking: {
      title: "Applicant ranking",
      intro:
        "Every applicant gets a Match score from 0 to 100 from fixed criteria: affordability, SCHUFA, documents, credibility, employment and previous landlord. The name is only shown; it does not count.",
      hint: "Save your flat first: the applicants are ranked for its rent and size.",
      count: "{ranked} applicants ranked, {excluded} excluded",
      sort: "Sort by",
      sortBy: { rank: "Match score", name: "Name", rentToIncome: "Rent burden" },
      completeOnly: "Complete documents only",
      rank: "Rank",
      name: "Name",
      score: "Score",
      breakdown: "Breakdown",
      rentToIncome: "Rent / income",
      documents: "Documents",
      empty: "No applicant matches this filter.",
      excludedTitle: "Excluded",
      excludedIntro: "These applicants do not meet one of your requirements.",
      reason: "Reason",
      poolErrors: "{count} application(s) could not be read.",
      bar: "{criterion}: {percent} % (weight {weight} %)",
      criteria: {
        affordability: "Affordability",
        schufa: "SCHUFA",
        documents: "Documents",
        credibility: "Credibility",
        employment: "Employment",
        previousLandlord: "Previous landlord",
      },
      document: { schufa: "SCHUFA", incomeProof: "Income proof", previousLandlord: "Previous-landlord confirmation" },
      documentStatus: { present: "present", missing: "missing", expired: "expired", inconsistent: "inconsistent", not_required: "not required" },
      schufaStatus: { clean: "clean", minor_entries: "minor entries", negative: "negative entries", missing: "missing" },
      excludedBy: {
        occupancyCompliant: "A household of {householdSize} needs at least {requiredAreaSqm} m² (§ 7 WoAufG Bln); the flat has {livingAreaSqm} m².",
        maxRentToIncome: "The rent is {rentToIncome} of the net household income (at most {limit}).",
        latestMoveIn: "Moves in only on {moveInDate} (at the latest {limit}).",
        schufaCleanOnly: "SCHUFA not clean: {schufaStatus}.",
        completeDocumentsOnly: "Documents incomplete: {documents}.",
        noPets: "The household has pets.",
        noSmoking: "The household smokes.",
      },
    },
  },
};

export const DICTIONARIES = { de, en };

// Storage may be missing or throw (Node, private mode, blocked site data): the language then
// lasts as long as the page.
function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function storedLanguage() {
  try {
    const lang = storage()?.getItem(LANGUAGE_KEY);
    return LANGUAGES.includes(lang) ? lang : null;
  } catch {
    return null;
  }
}

let current = storedLanguage() ?? DEFAULT_LANGUAGE;

export const getLanguage = () => current;

const lookup = (dictionary, key) =>
  key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), dictionary);

// The text for `key` in the current language, with {name} placeholders filled from `vars`.
// An unknown key shows as itself, so a gap is visible instead of blank.
export function t(key, vars = {}) {
  const text = lookup(DICTIONARIES[current], key);
  if (typeof text !== "string") return key;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

// "placeholder:form.x;aria-label:form.y" → [["placeholder", "form.x"], ["aria-label", "form.y"]]
export function parseAttrSpec(spec) {
  return String(spec ?? "")
    .split(";")
    .map((pair) => pair.split(":").map((part) => part.trim()))
    .filter(([attr, key]) => attr && key);
}

// Re-renders the static page text: `data-i18n` sets the text, `data-i18n-attr` the attributes.
export function applyTranslations(root) {
  for (const node of root.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const node of root.querySelectorAll("[data-i18n-attr]")) {
    for (const [attr, key] of parseAttrSpec(node.dataset.i18nAttr)) node.setAttribute(attr, t(key));
  }
}

// Switches the language: persists it, updates the static text and tells the page (LANGUAGE_EVENT)
// so it can redraw its dynamic parts. Text already shown in the chat stays as it was.
export function setLanguage(lang) {
  if (!LANGUAGES.includes(lang)) return;
  current = lang;
  try {
    storage()?.setItem(LANGUAGE_KEY, lang);
  } catch {
    // Not persisted; the choice holds until the page is left.
  }
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  applyTranslations(document);
  document.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: { lang } }));
}

// Calls fn(lang) after every switch.
export function onLanguageChange(fn) {
  if (typeof document !== "undefined") document.addEventListener(LANGUAGE_EVENT, () => fn(current));
}

// Page start: shows the stored language and wires the DE | EN buttons (`.lang-switch [data-lang]`).
export function startI18n() {
  document.documentElement.lang = current;
  applyTranslations(document);
  const buttons = [...document.querySelectorAll(".lang-switch [data-lang]")];
  const markPressed = () => {
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.lang === current));
  };
  for (const button of buttons) button.addEventListener("click", () => setLanguage(button.dataset.lang));
  onLanguageChange(markPressed);
  markPressed();
}

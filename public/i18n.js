// The UI language (German or English) for both pages. Only page text is translated: AI answers
// follow the language the user writes in, and server-generated text stays as the server sends it.
// Importable under Node (tests): every browser access is guarded.

export const LANGUAGES = ["de", "en"];
const DEFAULT_LANGUAGE = "de";
export const LANGUAGE_KEY = "amt-buddy.language";
export const LANGUAGE_EVENT = "amt-buddy:languagechange";

const de = {
  meta: {
    formTitle: "Amt Buddy · Berliner Adresse prüfen",
    formDescription: "Amt Buddy prüft Berliner Adressen gegen den offiziellen offenen Datensatz des Landes Berlin.",
    chatTitle: "Amt-Buddy · Chat",
    chatDescription:
      "Amt-Buddy Chat: Fragen zu Berliner Adressen, Mietspiegel 2026 und Belegung (§ 7 WoAufG Bln) stellen oder den Mietvertrag prüfen lassen.",
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
    backToForm: "Zur Formularansicht",
    sidebarToggle: "Seitenleiste umschalten",
    sidebar: "Seitenleiste",
    standardForm: "Standard-Formular ↗",
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
  },
  form: {
    heading: "Ist diese Adresse offiziell?",
    intro: "Amt Buddy gleicht eine Anschrift direkt mit dem amtlichen Berliner Adressbestand ab.",
    chatLink: "💬 Zum Vollbild-Chatbot (Geführter Assistent) →",
    ocrStep: "SCHRITT 00 (OPTIONAL)",
    ocrHeading: "Dokument per OCR einlesen",
    ocrIntro:
      "Laden Sie Ihren Berliner Mietvertrag oder eine Wohnungsgeberbestätigung (PDF oder Text) hoch. Die Daten werden automatisch per OCR extrahiert und in das Formular eingetragen.",
    dropzone: "Datei per Drag-and-Drop ablegen oder zum Durchsuchen klicken",
    dropHere: "Mietvertrag hierher ziehen",
    or: "oder",
    selectFile: "Datei auswählen",
    ocrHint: "Unterstützt PDF, TXT bis 15 MB",
    addressStep: "SCHRITT 01",
    addressHeading: "Adresse eingeben",
    berlinOnly: "Nur Berlin",
    address: "Vollständige Adresse",
    addressPlaceholder: "Berliner Straße 155\n10715 Berlin",
    addressHint: "Straße und Hausnummer in Zeile 1, Postleitzahl und Berlin in Zeile 2.",
    optionalLegend: "Optionale Wohnungsangaben",
    optionalHint:
      "Wohnfläche (m²) und Kaltmiete für die Mietspiegel-Vergleichsmiete; Zimmer und Personen für die Belegungsprüfung (§ 7 WoAufG Bln).",
    livingArea: "Wohnfläche (m²)",
    contractRent: "Nettokaltmiete (€, optional)",
    buildingYear: "Baujahr (optional)",
    rooms: "Zimmeranzahl",
    occupants: "Personen gesamt",
    children: "Kinder bis 6 J.",
    livingAreaExample: "z. B. 50",
    contractRentExample: "z. B. 850",
    buildingYearExample: "z. B. 1935",
    roomsExample: "z. B. 2",
    occupantsExample: "z. B. 2",
    childrenExample: "z. B. 0",
    submit: "Adresse prüfen",
    checking: "Wird geprüft …",
    sources: "Quellen:",
    openData: "Offizielle Berliner Open Data · DL-DE Zero 2.0",
  },
  result: {
    verified: "Amtlich bestätigt",
    notVerified: "Nicht bestätigt",
    notVerifiedText:
      "Diese Kombination wurde im amtlichen Berliner Adressbestand nicht gefunden. Bitte Schreibweise und Hausnummer prüfen.",
    failedTitle: "Prüfung nicht möglich",
    failed: "Die Prüfung ist fehlgeschlagen.",
    notShown: "Nicht ausgewiesen",
    notAvailable: "Nicht verfügbar",
    location: "Wohnlage (Mietspiegel 2026)",
    rentTier: "Mietstufe",
    blockAge: "Baualtersklasse (Block)",
    yearVerified: "Gebäude-Baujahr verifiziert",
    yes: "Ja",
    blockOnly: "Nein (nur Blockebene)",
    district: "Bezirk",
    locality: "Ortsteil",
    addressId: "Adress-ID",
    ageNoteTitle: "Mietspiegel & Gebäudealter:",
    ageNote: "Wohnlage ist die amtliche Mietspiegel-Lagekategorie, kein Geldbetrag.",
    defaultAgeNote:
      "Überwiegende Baualtersklasse des Blocks (Umweltatlas Berlin, Stand 2015). Exaktes Gebäude-Baujahr amtlich nicht einzeln verifiziert.",
    mietspiegelField: "Berliner Mietspiegel 2026 (Tabellenfeld {field})",
    rentFound: "Mietwert ermittelt",
    range: "Amtliche Mietspiegel-Referenzspanne (Nettokaltmiete)",
    lower: "Unterer Wert",
    median: "Mittelwert (Median)",
    upper: "Oberer Wert",
    perMonth: "€ / Mo.",
    field: "Mietspiegelfeld",
    buildingAge: "Baualtersklasse",
    residentialLocation: "Wohnlage",
    sizeCategory: "Größenklasse",
    compare: "Vertragsmiete vergleichen (optional):",
    comparePlaceholder: "Kaltmiete in € (z. B. 500)",
    compareButton: "Prüfen",
    mietspiegelNote:
      "Gesetzlicher qualifizierter Mietspiegel nach §§ 558c, 558d BGB. Die Spanne bildet die ortsübliche Vergleichsmiete für typische Wohnungen ab. Die konkrete Einordnung innerhalb der Spanne erfolgt über die Orientierungshilfe (Merkmale zu Bad, Küche, Wohnung, Gebäude, Umfeld).",
    missingSize:
      "Wohnfläche (m²) oben angeben, um das zutreffende Mietspiegelfeld und die monatliche Referenzmiete zu berechnen.",
    missingAge:
      "Baualtersklasse für diesen Block nicht eindeutig ermittelbar. Bitte optional das konkrete Baujahr oben eingeben.",
    compareBelow: "liegt unterhalb der amtlichen Mietspiegel-Referenzspanne ({lower} € – {upper} €).",
    compareAbove: "liegt oberhalb der amtlichen Mietspiegel-Referenzspanne ({lower} € – {upper} €).",
    compareWithin: "liegt innerhalb der amtlichen Mietspiegel-Referenzspanne ({lower} € – {upper} €).",
    diffLower: "Differenz zur Untergrenze: -{diff} €.",
    diffUpper: "Überschreitung der Obergrenze: +{diff} €.",
    diffMedian: "Abweichung zum Mittelwert: {sign}{diff} €.",
    perMonthLong: "€ / Monat",
    occupancy: "Belegungsprüfung ({basis})",
    meetsMinimum: "Mindestwohnfläche eingehalten",
    belowMinimum: "Mindestwohnfläche unterschritten",
    actualArea: "Tatsächliche Wohnfläche",
    requiredArea: "Gesetzliche Mindestfläche",
    requiredAreaRule: "(9 m²/Erw., 6 m²/Kind ≤ 6 J.)",
    areaMargin: "Flächenreserve / Differenz",
    peopleRooms: "Personen / Zimmer",
    peopleRoomsValue: "{occupants} Pers. in {rooms} Zi.",
    perRoom: "Personen pro Zimmer",
    roomsPerPerson: "Zimmer pro Person",
    occupancyNoteTitle: "Hinweis nach § 7 WoAufG Bln:",
    occupancyNote:
      "Berechnet auf Basis der Selbstauskunft (statutarische Untergrenze: 9 m² je Person, 6 m² je Kind bis zum vollendeten 6. Lebensjahr). Keine amtliche Feststellung oder Rechtsberatung.",
    notAssessed: "Nicht geprüft (optionale Wohnungs- und Belegungsdaten wurden nicht angegeben).",
  },
  ocr: {
    processing: '📄 Verarbeite "{name}" per OCR … Bitte warten.',
    failed: "OCR Extraktion fehlgeschlagen.",
    errorTitle: "Fehler bei der OCR-Extraktion:",
    success: "✓ Daten erfolgreich extrahiert und in das Formular eingetragen!",
    reviewHint: "Bitte überprüfen Sie die eingetragenen Daten und klicken Sie unten auf",
    postalCode: "PLZ {value}",
    rent: "Kaltmiete: {value} €",
    buildingYear: "Baujahr: {value}",
    rooms: "{value} Zimmer",
    occupants: "{value} Personen",
  },
  errors: {
    addressFormat: "Bitte die Adresse in zwei Zeilen eingeben, zum Beispiel: Pariser Platz 1 / 10117 Berlin.",
    streetLength: "Die Straße muss 2 bis 120 Zeichen lang sein.",
    houseNumber: "Die Hausnummer muss eine Zahl sein, optional mit einem Buchstaben.",
    postalCode: "Die Postleitzahl muss im Berliner Bereich 10115–14199 liegen.",
    serviceUnavailable: "Ein amtlicher Berliner Datendienst ist gerade nicht erreichbar.",
  },
};

const en = {
  meta: {
    formTitle: "Amt Buddy · Check a Berlin address",
    formDescription: "Amt Buddy checks Berlin addresses against the State of Berlin's official open dataset.",
    chatTitle: "Amt-Buddy · Chat",
    chatDescription:
      "Amt-Buddy chat: ask about Berlin addresses, the Mietspiegel 2026 and occupancy (§ 7 WoAufG Bln), or have your lease checked.",
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
    backToForm: "Back to the form",
    sidebarToggle: "Toggle sidebar",
    sidebar: "Sidebar",
    standardForm: "Standard form ↗",
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
  },
  form: {
    heading: "Is this address official?",
    intro: "Amt Buddy checks an address directly against the official Berlin address register.",
    chatLink: "💬 Open the full-screen chatbot (guided assistant) →",
    ocrStep: "STEP 00 (OPTIONAL)",
    ocrHeading: "Read a document with OCR",
    ocrIntro:
      "Upload your Berlin lease or a Wohnungsgeberbestätigung (landlord's confirmation; PDF or text). The data is extracted automatically with OCR and filled into the form.",
    dropzone: "Drag and drop a file or click to browse",
    dropHere: "Drag your lease here",
    or: "or",
    selectFile: "choose a file",
    ocrHint: "Supports PDF, TXT up to 15 MB",
    addressStep: "STEP 01",
    addressHeading: "Enter the address",
    berlinOnly: "Berlin only",
    address: "Full address",
    addressPlaceholder: "Berliner Straße 155\n10715 Berlin",
    addressHint: "Street and house number on line 1, postcode and Berlin on line 2.",
    optionalLegend: "Optional flat details",
    optionalHint:
      "Living area (m²) and rent for the Mietspiegel reference rent; rooms and people for the occupancy check (§ 7 WoAufG Bln).",
    livingArea: "Living area (m²)",
    contractRent: "Nettokaltmiete – net cold rent (€, optional)",
    buildingYear: "Year built (optional)",
    rooms: "Number of rooms",
    occupants: "People in total",
    children: "Children up to 6",
    livingAreaExample: "e.g. 50",
    contractRentExample: "e.g. 850",
    buildingYearExample: "e.g. 1935",
    roomsExample: "e.g. 2",
    occupantsExample: "e.g. 2",
    childrenExample: "e.g. 0",
    submit: "Check address",
    checking: "Checking …",
    sources: "Sources:",
    openData: "Official Berlin Open Data · DL-DE Zero 2.0",
  },
  result: {
    verified: "Officially confirmed",
    notVerified: "Not confirmed",
    notVerifiedText:
      "This combination was not found in the official Berlin address register. Please check the spelling and house number.",
    failedTitle: "Check not possible",
    failed: "The check failed.",
    notShown: "Not designated",
    notAvailable: "Not available",
    location: "Wohnlage (Mietspiegel 2026)",
    rentTier: "Rent tier",
    blockAge: "Building age class (block)",
    yearVerified: "Year built verified",
    yes: "Yes",
    blockOnly: "No (block level only)",
    district: "District",
    locality: "Locality",
    addressId: "Address ID",
    ageNoteTitle: "Mietspiegel & building age:",
    ageNote: "Wohnlage is the official Mietspiegel location category, not an amount of money.",
    defaultAgeNote:
      "Predominant building age class of the block (Umweltatlas Berlin, 2015). The exact year the building was built is not officially verified.",
    mietspiegelField: "Berliner Mietspiegel 2026 (table field {field})",
    rentFound: "Reference rent found",
    range: "Official Mietspiegel reference range (Nettokaltmiete, net cold rent)",
    lower: "Lower value",
    median: "Median",
    upper: "Upper value",
    perMonth: "€ / mo.",
    field: "Mietspiegel field",
    buildingAge: "Building age class",
    residentialLocation: "Wohnlage",
    sizeCategory: "Size class",
    compare: "Compare your contract rent (optional):",
    comparePlaceholder: "Net cold rent in € (e.g. 500)",
    compareButton: "Check",
    mietspiegelNote:
      "Qualified Mietspiegel under §§ 558c, 558d BGB. The range shows the local reference rent for typical flats. Where a flat sits within the range is set by the Orientierungshilfe (features of bathroom, kitchen, flat, building, surroundings).",
    missingSize: "Enter the living area (m²) above to calculate the Mietspiegel field and the monthly reference rent.",
    missingAge: "The building age class for this block cannot be determined. Optionally enter the exact year built above.",
    compareBelow: "is below the official Mietspiegel reference range ({lower} € – {upper} €).",
    compareAbove: "is above the official Mietspiegel reference range ({lower} € – {upper} €).",
    compareWithin: "is within the official Mietspiegel reference range ({lower} € – {upper} €).",
    diffLower: "Difference to the lower limit: -{diff} €.",
    diffUpper: "Above the upper limit by: +{diff} €.",
    diffMedian: "Difference to the median: {sign}{diff} €.",
    perMonthLong: "€ / month",
    occupancy: "Occupancy check ({basis})",
    meetsMinimum: "Minimum living area met",
    belowMinimum: "Below the minimum living area",
    actualArea: "Actual living area",
    requiredArea: "Legal minimum area",
    requiredAreaRule: "(9 m²/adult, 6 m²/child ≤ 6)",
    areaMargin: "Area margin / difference",
    peopleRooms: "People / rooms",
    peopleRoomsValue: "{occupants} people in {rooms} rooms",
    perRoom: "People per room",
    roomsPerPerson: "Rooms per person",
    occupancyNoteTitle: "Note under § 7 WoAufG Bln:",
    occupancyNote:
      "Calculated from your own details (statutory minimum: 9 m² per person, 6 m² per child up to their 6th birthday). Not an official finding or legal advice.",
    notAssessed: "Not checked (the optional flat and occupancy details were not given).",
  },
  ocr: {
    processing: '📄 Reading "{name}" with OCR … Please wait.',
    failed: "OCR extraction failed.",
    errorTitle: "OCR extraction error:",
    success: "✓ Data extracted and filled into the form!",
    reviewHint: "Please check the filled-in data and click",
    postalCode: "Postcode {value}",
    rent: "Net cold rent: {value} €",
    buildingYear: "Year built: {value}",
    rooms: "{value} rooms",
    occupants: "{value} people",
  },
  errors: {
    addressFormat: "Enter the address on two lines, for example: Pariser Platz 1 / 10117 Berlin.",
    streetLength: "The street must have between 2 and 120 characters.",
    houseNumber: "The house number must be a number, optionally with a letter.",
    postalCode: "The postcode must be within Berlin's 10115–14199 range.",
    serviceUnavailable: "An official Berlin data service is temporarily unavailable.",
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

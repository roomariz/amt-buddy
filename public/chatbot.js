/**
 * Amt-Buddy Guided Chatbot (ChatGPT Style Layout)
 * Provides an intuitive, structured rule-based conversational experience
 * for Berlin address checking, Mietspiegel 2026, occupancy compliance, and OCR.
 */

const chatStream = document.querySelector("#chat-stream");
const gptHero = document.querySelector("#gpt-hero");
const gptScrollContainer = document.querySelector("#gpt-scroll-container");
const quickOptions = document.querySelector("#quick-options");
const chatInputForm = document.querySelector("#chat-input-form");
const chatUserInput = document.querySelector("#chat-user-input");
const chatFileInput = document.querySelector("#chat-file-input");
const chatUploadBtn = document.querySelector("#chat-upload-btn");
const btnNewChat = document.querySelector("#btn-new-chat");
const sidebarToggleBtn = document.querySelector("#sidebar-toggle-btn");
const gptSidebar = document.querySelector("#gpt-sidebar");

// State machine states
const STATES = {
  HERO: "HERO",
  MAIN_MENU: "MAIN_MENU",
  ADDRESS_INPUT: "ADDRESS_INPUT",
  MIETSPIEGEL_AREA: "MIETSPIEGEL_AREA",
  MIETSPIEGEL_LOCATION: "MIETSPIEGEL_LOCATION",
  MIETSPIEGEL_YEAR: "MIETSPIEGEL_YEAR",
  MIETSPIEGEL_RENT: "MIETSPIEGEL_RENT",
  OCCUPANCY_AREA: "OCCUPANCY_AREA",
  OCCUPANCY_ROOMS: "OCCUPANCY_ROOMS",
  OCCUPANCY_PERSONS: "OCCUPANCY_PERSONS",
  OCCUPANCY_CHILDREN: "OCCUPANCY_CHILDREN",
  OCR_INPUT: "OCR_INPUT",
};

let currentState = STATES.HERO;
let sessionData = {};

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showChatView() {
  if (gptHero) gptHero.style.display = "none";
}

function scrollToBottom() {
  if (gptScrollContainer) {
    gptScrollContainer.scrollTop = gptScrollContainer.scrollHeight;
  }
}

function appendBotMessage(html) {
  showChatView();
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble bot";
  bubble.innerHTML = html;
  chatStream.appendChild(bubble);
  scrollToBottom();
}

function appendUserMessage(text) {
  showChatView();
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble user";
  bubble.textContent = text;
  chatStream.appendChild(bubble);
  scrollToBottom();
}

function setActionButtons(options = []) {
  quickOptions.innerHTML = "";
  if (!options || options.length === 0) {
    quickOptions.hidden = true;
    return;
  }
  quickOptions.hidden = false;

  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chat-option-btn";
    btn.textContent = opt.label;
    btn.addEventListener("click", () => {
      handleUserAction(opt.value || opt.label);
    });
    quickOptions.appendChild(btn);
  });
  scrollToBottom();
}

function resetToNewChat() {
  currentState = STATES.HERO;
  sessionData = {};
  chatStream.innerHTML = "";
  setActionButtons([]);
  if (gptHero) gptHero.style.display = "block";
  if (chatUserInput) {
    chatUserInput.value = "";
    chatUserInput.focus();
  }
}

async function verifyAddressFlow(addressText) {
  appendBotMessage("🔍 <em>Prüfe Adresse gegen das offizielle Berliner Liegenschaftskataster (WFS) …</em>");

  try {
    const res = await fetch("/api/v1/address-verifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: addressText }),
    });

    const body = await res.json();

    if (!res.ok) {
      throw new Error(body.error?.details?.[0]?.message || body.error?.message || "Prüfung fehlgeschlagen.");
    }

    if (!body.data.verified) {
      appendBotMessage(
        `❌ <strong>Adresse nicht im Berliner Liegenschaftskataster gefunden.</strong><br />` +
          `Möglicherweise liegt ein Tippfehler vor oder die Hausnummer ist noch nicht amtlich erfasst.<br />` +
          `<em>Beispiel für gültige Eingabe: "Berliner Straße 155, 10715 Berlin"</em>`,
      );
      setActionButtons([
        { label: "🔄 Andere Adresse prüfen", value: "start_address" },
        { label: "🔙 Zum Hauptmenü", value: "menu" },
      ]);
      return;
    }

    const { address } = body.data;
    sessionData.verifiedAddress = address;

    const locText = address.residentialLocation
      ? address.residentialLocation.charAt(0).toUpperCase() + address.residentialLocation.slice(1)
      : "Nicht ausgewiesen";

    const ageText =
      address.buildingAge?.areaBuildingAgeClass ||
      address.buildingAge?.predominantAreaConstructionPeriod ||
      "Nicht verfügbar";

    appendBotMessage(
      `✓ <strong>Offizielle Berliner Adresse bestätigt!</strong><br /><br />` +
        `• <strong>Straße & Nr.:</strong> ${escapeHtml(address.street)} ${escapeHtml(address.houseNumber)}<br />` +
        `• <strong>PLZ & Ort:</strong> ${escapeHtml(address.postalCode)} Berlin (${escapeHtml(address.district)})<br />` +
        `• <strong>Wohnlage (Mietspiegel 2026):</strong> <strong>${escapeHtml(locText)}</strong><br />` +
        `• <strong>Baualtersklasse:</strong> ${escapeHtml(ageText)}<br />` +
        `• <strong>Koordinaten:</strong> ${address.coordinates?.latitude?.toFixed(4) || "-"}, ${address.coordinates?.longitude?.toFixed(4) || "-"}`,
    );

    setActionButtons([
      { label: "💶 Mietspiegel für diese Adresse berechnen", value: "address_calc_mietspiegel" },
      { label: "👥 Belegungsprüfung für diese Wohnung", value: "address_calc_occupancy" },
      { label: "📍 Andere Adresse prüfen", value: "start_address" },
      { label: "🔙 Zum Start", value: "menu" },
    ]);
  } catch (err) {
    appendBotMessage(`⚠️ <strong>Fehler bei der Adressprüfung:</strong> ${escapeHtml(err.message)}`);
    setActionButtons([
      { label: "🔄 Erneut versuchen", value: "start_address" },
      { label: "🔙 Zum Start", value: "menu" },
    ]);
  }
}

async function runMietspiegelCalculation() {
  appendBotMessage("📊 <em>Ermittle amtliches Tabellenfeld des Berliner Mietspiegels 2026 …</em>");

  try {
    const payload = {
      address: sessionData.verifiedAddress
        ? `${sessionData.verifiedAddress.street} ${sessionData.verifiedAddress.houseNumber}\n${sessionData.verifiedAddress.postalCode} Berlin`
        : "Berliner Straße 155\n10715 Berlin",
      livingAreaSqm: sessionData.livingAreaSqm,
      buildingYear: sessionData.buildingYear,
      contractRent: sessionData.contractRent,
    };

    const res = await fetch("/api/v1/address-verifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const body = await res.json();
    const ms = body.data?.mietspiegel;

    if (!ms || ms.status !== "calculated") {
      appendBotMessage(
        `Mietspiegel-Berechnung für ${sessionData.livingAreaSqm} m² in ${sessionData.residentialLocation}er Wohnlage (${sessionData.buildingYear}): Status ${ms?.status || "unvollständig"}.`,
      );
      setActionButtons([{ label: "🔙 Zum Start", value: "menu" }]);
      return;
    }

    let comparisonHtml = "";
    if (ms.contractRentComparison) {
      const cmp = ms.contractRentComparison;
      const statusLabel =
        cmp.status === "within"
          ? "liegt innerhalb der amtlichen Referenzspanne (Mietpreisbremse eingehalten)"
          : cmp.status === "above"
            ? "liegt über der amtlichen Referenzspanne"
            : "liegt unter der amtlichen Referenzspanne";

      comparisonHtml = `<br />• <strong>Ihre Kaltmiete (${cmp.actualMonthlyRent} €):</strong> ${statusLabel}`;
    }

    appendBotMessage(
      `✓ <strong>Berliner Mietspiegel 2026 Auswertung:</strong><br /><br />` +
        `• <strong>Tabellenfeld:</strong> Feld <strong>${ms.field}</strong> (${ms.sizeCategory}, ${ms.buildingAge}, ${ms.residentialLocation}e Wohnlage)<br />` +
        `• <strong>Referenzspanne:</strong> ${ms.rentPerSqm.lower} € – ${ms.rentPerSqm.upper} € / m²<br />` +
        `• <strong>Mittelwert:</strong> <strong>${ms.rentPerSqm.median} € / m²</strong><br />` +
        `• <strong>Monatliche Vergleichsmiete:</strong> <strong>${ms.monthlyReferenceRent.lower.toFixed(2)} € – ${ms.monthlyReferenceRent.upper.toFixed(2)} €</strong> (Mittelwert: <strong>${ms.monthlyReferenceRent.median.toFixed(2)} €</strong>)` +
        comparisonHtml,
    );

    setActionButtons([
      { label: "👥 Jetzt Belegungsprüfung durchführen", value: "start_occupancy" },
      { label: "🔄 Neuen Mietspiegel berechnen", value: "start_mietspiegel" },
      { label: "🔙 Zum Start", value: "menu" },
    ]);
  } catch (err) {
    appendBotMessage(`⚠️ Fehler bei der Berechnung: ${escapeHtml(err.message)}`);
    setActionButtons([{ label: "🔙 Zum Start", value: "menu" }]);
  }
}

async function runOccupancyCalculation() {
  const { livingAreaSqm, rooms, occupants, childrenUpToSix = 0 } = sessionData;
  const otherOccupants = occupants - childrenUpToSix;
  const requiredAreaSqm = otherOccupants * 9 + childrenUpToSix * 6;
  const meets = livingAreaSqm >= requiredAreaSqm;
  const perPerson = Math.round((livingAreaSqm / occupants) * 10) / 10;
  const occPerRoom = Math.round((occupants / rooms) * 10) / 10;

  appendBotMessage(
    `<strong>Ergebnis der Belegungsprüfung (§ 7 Abs. 1 WoAufG Bln):</strong><br /><br />` +
      `• <strong>Bewertung:</strong> <strong>${meets ? "✓ Gesetzliche Mindeststandards erfüllt" : "⚠️ Überbelegungsrisiko (§ 7 WoAufG Bln unterschritten)"}</strong><br />` +
      `• <strong>Wohnungsgröße:</strong> ${livingAreaSqm} m² auf ${rooms} Zimmer<br />` +
      `• <strong>Haushalt:</strong> ${occupants} Personen (${childrenUpToSix} Kinder bis 6 J.)<br />` +
      `• <strong>Gesetzliche Mindestfläche:</strong> ${requiredAreaSqm} m² (9 m²/Erwachsener, 6 m²/Kind bis 6 J.)<br />` +
      `• <strong>Tatsächliche Fläche pro Person:</strong> ${perPerson} m²<br />` +
      `• <strong>Zimmerdichte:</strong> ${occPerRoom} Personen / Zimmer<br /><br />` +
      `<em>Rechtsgrundlage: § 7 Wohnungsaufsichtsgesetz Berlin (WoAufG Bln).</em>`,
  );

  setActionButtons([
    { label: "💶 Mietspiegel berechnen", value: "start_mietspiegel" },
    { label: "📍 Adresse prüfen", value: "start_address" },
    { label: "🔙 Zum Start", value: "menu" },
  ]);
}

async function handleOcrUpload(file) {
  if (!file) return;
  appendBotMessage(`📄 <em>Lese "${escapeHtml(file.name)}" per OCR ein und analysiere Mietvertragsdaten …</em>`);

  try {
    const reader = new FileReader();
    const base64Promise = new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const base64Data = await base64Promise;
    const res = await fetch("/api/v1/documents/ocr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        file: base64Data,
        mimeType: file.type || "application/pdf",
        fileName: file.name,
      }),
    });

    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error?.message || "OCR-Extraktion fehlgeschlagen.");
    }

    const { fields, confidence } = body.data;
    sessionData.ocrExtracted = fields;

    appendBotMessage(
      `✓ <strong>Mietvertrag erfolgreich per OCR eingelesen!</strong><br /><br />` +
        `• <strong>Adresse:</strong> ${escapeHtml(fields.address || "Nicht erkannt")}<br />` +
        `• <strong>Kaltmiete:</strong> ${fields.contractRent ? `${fields.contractRent} €` : "Nicht erkannt"}<br />` +
        `• <strong>Wohnfläche:</strong> ${fields.livingAreaSqm ? `${fields.livingAreaSqm} m²` : "Nicht erkannt"}<br />` +
        `• <strong>Zimmer:</strong> ${fields.rooms || "Nicht erkannt"}<br />` +
        `• <strong>Baujahr:</strong> ${fields.buildingYear || "Nicht erkannt"}<br />` +
        `• <strong>Erkennungsrate:</strong> ${Math.round((confidence.overall || 0) * 100)}%`,
    );

    if (fields.address) {
      setActionButtons([
        { label: `📍 Adresse direkt verifizieren: "${fields.street} ${fields.houseNumber}"`, value: `verify_ocr_address` },
        { label: "🔙 Zum Start", value: "menu" },
      ]);
    } else {
      setActionButtons([{ label: "🔙 Zum Start", value: "menu" }]);
    }
  } catch (err) {
    appendBotMessage(`⚠️ Fehler bei der OCR-Extraktion: ${escapeHtml(err.message)}`);
    setActionButtons([{ label: "🔙 Zum Start", value: "menu" }]);
  }
}

function handleUserAction(value) {
  if (value === "menu" || value === "reset" || value === "start") {
    resetToNewChat();
    return;
  }

  if (value === "start_address") {
    currentState = STATES.ADDRESS_INPUT;
    appendBotMessage("Bitte geben Sie die Berliner Adresse ein (z. B. <strong>Berliner Straße 155, 10715 Berlin</strong>):");
    setActionButtons([
      { label: "Berliner Straße 155, 10715 Berlin", value: "Berliner Straße 155, 10715 Berlin" },
      { label: "Pariser Platz 1, 10117 Berlin", value: "Pariser Platz 1, 10117 Berlin" },
      { label: "🔙 Zum Start", value: "menu" },
    ]);
    chatUserInput.focus();
    return;
  }

  if (value === "start_mietspiegel" || value === "address_calc_mietspiegel") {
    currentState = STATES.MIETSPIEGEL_AREA;
    appendBotMessage("Schritt 1: Wie groß ist die Wohnung in Quadratmetern (Wohnfläche in m²)?");
    setActionButtons([
      { label: "40 m²", value: "40" },
      { label: "50 m²", value: "50" },
      { label: "65 m²", value: "65" },
      { label: "80 m²", value: "80" },
      { label: "🔙 Zum Start", value: "menu" },
    ]);
    chatUserInput.focus();
    return;
  }

  if (value === "start_occupancy" || value === "address_calc_occupancy") {
    currentState = STATES.OCCUPANCY_AREA;
    appendBotMessage("Schritt 1: Wie groß ist die gesamte Wohnfläche der Wohnung in m²?");
    setActionButtons([
      { label: "35 m²", value: "35" },
      { label: "50 m²", value: "50" },
      { label: "75 m²", value: "75" },
      { label: "🔙 Zum Start", value: "menu" },
    ]);
    chatUserInput.focus();
    return;
  }

  if (value === "start_ocr") {
    currentState = STATES.OCR_INPUT;
    appendBotMessage(
      `Bitte laden Sie Ihren Berliner Mietvertrag oder eine Wohnungsgeberbestätigung (PDF oder Text) hoch ` +
        `oder fügen Sie den Vertragstext hier in das Chatfeld ein.<br /><br />` +
        `Klicken Sie auf das <strong>+</strong> Symbol links neben dem Eingabefeld, um eine Datei auszuwählen.`,
    );
    setActionButtons([{ label: "🔙 Zum Start", value: "menu" }]);
    return;
  }

  if (value === "verify_ocr_address" && sessionData.ocrExtracted?.address) {
    appendUserMessage(`Prüfe: ${sessionData.ocrExtracted.address}`);
    verifyAddressFlow(sessionData.ocrExtracted.address);
    return;
  }

  if (value === "faq") {
    appendBotMessage(
      `<strong>Häufige Fragen zu den Berliner Wohnungsregeln:</strong><br /><br />` +
        `• <strong>Was bedeutet Wohnlage?</strong><br />` +
        `Die Wohnlage (einfach, mittel, gut) ist eine amtliche statistische Lagekategorie der Senatsverwaltung für Stadtentwicklung und bestimmt die Mietspiegelspanne nach Straßenabschnitten.<br /><br />` +
        `• <strong>Was regelt § 7 WoAufG Bln?</strong><br />` +
        `Das Berliner Wohnungsaufsichtsgesetz fordert mind. 9 m² Wohnfläche für jeden Erwachsenen und mind. 6 m² für Kinder bis 6 Jahre. Eine Unterschreitung stellt eine behördlich rügbare Überbelegung dar.<br /><br />` +
        `• <strong>Woher stammen die Daten?</strong><br />` +
        `Alle Daten werden in Echtzeit aus dem amtlichen WFS-Liegenschaftskataster Berlin (Amt für Statistik Berlin-Brandenburg) und dem Berliner Mietspiegel 2026 abgerufen.`,
    );
    setActionButtons([
      { label: "📍 Adresse prüfen", value: "start_address" },
      { label: "💶 Mietspiegel berechnen", value: "start_mietspiegel" },
      { label: "🔙 Zum Start", value: "menu" },
    ]);
    return;
  }

  handleStateInput(value);
}

function handleStateInput(input) {
  const trimmed = input.trim();

  switch (currentState) {
    case STATES.ADDRESS_INPUT: {
      appendUserMessage(trimmed);
      verifyAddressFlow(trimmed);
      break;
    }

    case STATES.MIETSPIEGEL_AREA: {
      const area = parseFloat(trimmed.replace(",", "."));
      if (isNaN(area) || area <= 0) {
        appendBotMessage("Bitte geben Sie eine gültige Zahl für die Wohnfläche in m² ein (z. B. 50):");
        return;
      }
      sessionData.livingAreaSqm = area;
      appendUserMessage(`${area} m²`);
      currentState = STATES.MIETSPIEGEL_LOCATION;
      appendBotMessage("Schritt 2: In welcher amtlichen Wohnlage befindet sich die Wohnung?");
      setActionButtons([
        { label: "gut", value: "gut" },
        { label: "mittel", value: "mittel" },
        { label: "einfach", value: "einfach" },
      ]);
      break;
    }

    case STATES.MIETSPIEGEL_LOCATION: {
      const loc = trimmed.toLowerCase();
      if (!["gut", "mittel", "einfach"].includes(loc)) {
        appendBotMessage("Bitte wählen Sie: gut, mittel oder einfach:");
        return;
      }
      sessionData.residentialLocation = loc;
      appendUserMessage(`Wohnlage: ${loc}`);
      currentState = STATES.MIETSPIEGEL_YEAR;
      appendBotMessage("Schritt 3: Welches Baujahr oder welche Baualtersklasse hat das Gebäude?");
      setActionButtons([
        { label: "bis 1918 (Altbau)", value: "bis 1918" },
        { label: "1919–1949", value: "1919–1949" },
        { label: "1950–1964", value: "1950–1964" },
        { label: "1965–1972", value: "1965–1972" },
        { label: "1973–1990", value: "1973–1990" },
        { label: "1991–2001", value: "1991–2001" },
        { label: "ab 2010 (Neubau)", value: "ab 2010" },
      ]);
      break;
    }

    case STATES.MIETSPIEGEL_YEAR: {
      sessionData.buildingYear = trimmed;
      appendUserMessage(`Baujahr: ${trimmed}`);
      currentState = STATES.MIETSPIEGEL_RENT;
      appendBotMessage("Schritt 4 (Optional): Wie hoch ist Ihre tatsächliche monatliche Kaltmiete in EUR (für den Vergleich)?");
      setActionButtons([
        { label: "500 €", value: "500" },
        { label: "700 €", value: "700" },
        { label: "900 €", value: "900" },
        { label: "Überspringen", value: "skip" },
      ]);
      break;
    }

    case STATES.MIETSPIEGEL_RENT: {
      if (trimmed.toLowerCase() !== "skip" && trimmed !== "Überspringen") {
        const rent = parseFloat(trimmed.replace(",", "."));
        if (!isNaN(rent) && rent > 0) {
          sessionData.contractRent = rent;
          appendUserMessage(`Kaltmiete: ${rent} €`);
        } else {
          appendUserMessage("Übersprungen");
        }
      } else {
        appendUserMessage("Übersprungen");
      }
      runMietspiegelCalculation();
      break;
    }

    case STATES.OCCUPANCY_AREA: {
      const area = parseFloat(trimmed.replace(",", "."));
      if (isNaN(area) || area <= 0) {
        appendBotMessage("Bitte geben Sie eine gültige Zahl für die Wohnfläche in m² ein:");
        return;
      }
      sessionData.livingAreaSqm = area;
      appendUserMessage(`${area} m²`);
      currentState = STATES.OCCUPANCY_ROOMS;
      appendBotMessage("Schritt 2: Wie viele Zimmer hat die Wohnung?");
      setActionButtons([
        { label: "1 Zimmer", value: "1" },
        { label: "2 Zimmer", value: "2" },
        { label: "3 Zimmer", value: "3" },
        { label: "4 Zimmer", value: "4" },
      ]);
      break;
    }

    case STATES.OCCUPANCY_ROOMS: {
      const rooms = parseFloat(trimmed.replace(",", "."));
      if (isNaN(rooms) || rooms <= 0) {
        appendBotMessage("Bitte geben Sie die Anzahl der Zimmer ein (z. B. 2):");
        return;
      }
      sessionData.rooms = rooms;
      appendUserMessage(`${rooms} Zimmer`);
      currentState = STATES.OCCUPANCY_PERSONS;
      appendBotMessage("Schritt 3: Wie viele Personen bewohnen die Wohnung insgesamt?");
      setActionButtons([
        { label: "1 Person", value: "1" },
        { label: "2 Personen", value: "2" },
        { label: "3 Personen", value: "3" },
        { label: "4 Personen", value: "4" },
      ]);
      break;
    }

    case STATES.OCCUPANCY_PERSONS: {
      const persons = parseInt(trimmed, 10);
      if (isNaN(persons) || persons < 1) {
        appendBotMessage("Bitte geben Sie die Personenzahl ein (mindestens 1):");
        return;
      }
      sessionData.occupants = persons;
      appendUserMessage(`${persons} Personen`);
      currentState = STATES.OCCUPANCY_CHILDREN;
      appendBotMessage("Schritt 4: Wie viele davon sind Kinder bis 6 Jahre?");
      setActionButtons([
        { label: "0 Kinder", value: "0" },
        { label: "1 Kind", value: "1" },
        { label: "2 Kinder", value: "2" },
      ]);
      break;
    }

    case STATES.OCCUPANCY_CHILDREN: {
      const children = parseInt(trimmed, 10);
      sessionData.childrenUpToSix = isNaN(children) || children < 0 ? 0 : children;
      appendUserMessage(`${sessionData.childrenUpToSix} Kinder bis 6 J.`);
      runOccupancyCalculation();
      break;
    }

    case STATES.OCR_INPUT: {
      appendUserMessage(trimmed);
      (async () => {
        try {
          const res = await fetch("/api/v1/documents/ocr", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: trimmed }),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error?.message || "Analyse fehlgeschlagen");
          const { fields } = body.data;
          appendBotMessage(
            `✓ <strong>Mietvertragstext analysiert:</strong><br /><br />` +
              `• <strong>Adresse:</strong> ${fields.address || "Nicht erkannt"}<br />` +
              `• <strong>Kaltmiete:</strong> ${fields.contractRent ? `${fields.contractRent} €` : "Nicht erkannt"}<br />` +
              `• <strong>Wohnfläche:</strong> ${fields.livingAreaSqm ? `${fields.livingAreaSqm} m²` : "Nicht erkannt"}`,
          );
          setActionButtons([{ label: "🔙 Zum Start", value: "menu" }]);
        } catch (e) {
          appendBotMessage(`⚠️ Fehler: ${escapeHtml(e.message)}`);
          setActionButtons([{ label: "🔙 Zum Start", value: "menu" }]);
        }
      })();
      break;
    }

    default: {
      appendUserMessage(trimmed);
      const lower = trimmed.toLowerCase();
      if (/(?:straße|strasse|str\.|platz|allee|weg|damm|chaussee)\s+\d+/i.test(lower)) {
        verifyAddressFlow(trimmed);
      } else if (/mietspiegel|vergleichsmiete/i.test(lower)) {
        handleUserAction("start_mietspiegel");
      } else if (/belegung|überbelegung|woaufg/i.test(lower)) {
        handleUserAction("start_occupancy");
      } else if (/vertrag|ocr|upload/i.test(lower)) {
        handleUserAction("start_ocr");
      } else {
        appendBotMessage("Ich habe Ihre Eingabe erhalten. Wählen Sie bitte eine Option aus:");
        setActionButtons([
          { label: "📍 Adresse prüfen", value: "start_address" },
          { label: "💶 Mietspiegel berechnen", value: "start_mietspiegel" },
          { label: "👥 Belegung prüfen", value: "start_occupancy" },
          { label: "📄 Mietvertrag OCR", value: "start_ocr" },
        ]);
      }
      break;
    }
  }
}

// Event Listeners
chatInputForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatUserInput.value.trim();
  if (!text) return;
  chatUserInput.value = "";
  handleUserAction(text);
});

chatUserInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatInputForm.requestSubmit();
  }
});

btnNewChat?.addEventListener("click", () => {
  resetToNewChat();
});

sidebarToggleBtn?.addEventListener("click", () => {
  gptSidebar?.classList.toggle("collapsed");
});

chatUploadBtn?.addEventListener("click", () => {
  chatFileInput.click();
});

chatFileInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) {
    handleOcrUpload(file);
  }
});

// Sidebar nav items & hero cards event delegation
document.addEventListener("click", (e) => {
  const navBtn = e.target.closest("[data-action]");
  if (navBtn) {
    const action = navBtn.getAttribute("data-action");
    handleUserAction(action);
  }

  const historyBtn = e.target.closest("[data-prompt]");
  if (historyBtn) {
    const prompt = historyBtn.getAttribute("data-prompt");
    handleUserAction(prompt);
  }
});

// Initialize on page load
resetToNewChat();

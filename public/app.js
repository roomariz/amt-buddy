const form = document.querySelector("#address-form");
const result = document.querySelector("#result");
const button = form.querySelector("button");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showResult(kind, html) {
  result.className = `result ${kind}`;
  result.innerHTML = html;
  result.hidden = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  result.hidden = true;
  button.disabled = true;
  button.textContent = "Wird geprüft …";

  const rawData = Object.fromEntries(new FormData(form));
  const payload = { address: rawData.address };

  const optionalFields = [
    "livingAreaSqm",
    "contractRent",
    "rooms",
    "occupants",
    "childrenUpToSix",
    "buildingYear",
  ];
  const hasOptionalInput = optionalFields.some(
    (field) => rawData[field] && rawData[field].trim() !== "",
  );
  if (hasOptionalInput) {
    for (const field of optionalFields) {
      if (rawData[field] && rawData[field].trim() !== "") {
        payload[field] = rawData[field].trim();
      }
    }
  }

  try {
    const response = await fetch("/api/v1/address-verifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();

    if (!response.ok) {
      const message = body.error?.details?.[0]?.message ?? body.error?.message;
      throw new Error(message || "Die Prüfung ist fehlgeschlagen.");
    }

    if (!body.data.verified) {
      showResult(
        "not-verified",
        "<strong>Nicht bestätigt</strong><p>Diese Kombination wurde im amtlichen Berliner Adressbestand nicht gefunden. Bitte Schreibweise und Hausnummer prüfen.</p>",
      );
      return;
    }

    const { address, occupancyAssessment, mietspiegel } = body.data;
    const residentialLocation = address.residentialLocation
      ? address.residentialLocation.charAt(0).toLocaleUpperCase("de-DE") +
        address.residentialLocation.slice(1)
      : "Nicht ausgewiesen";

    const buildingAge = address.buildingAge;
    const buildingAgeText =
      buildingAge?.areaBuildingAgeClass ??
      buildingAge?.predominantAreaConstructionPeriod ??
      "Nicht verfügbar";

    let mietspiegelHtml = "";
    if (mietspiegel?.status === "calculated") {
      mietspiegelHtml = `
        <div class="result-section">
          <p class="result-section-title">
            <span>Berliner Mietspiegel 2026 (Tabellenfeld ${escapeHtml(mietspiegel.field)})</span>
            <span class="badge badge-success">Mietwert ermittelt</span>
          </p>

          <div class="reference-range-box">
            <div class="range-header">Amtliche Mietspiegel-Referenzspanne (Nettokaltmiete)</div>
            <div class="range-values">
              <div class="range-col">
                <span class="range-label">Unterer Wert</span>
                <span class="range-num">${escapeHtml(mietspiegel.rentPerSqm.lower.toFixed(2))} €/m²</span>
                <span class="range-sub">${escapeHtml(mietspiegel.monthlyReferenceRent.lower.toFixed(2))} € / Mo.</span>
              </div>
              <div class="range-col range-median">
                <span class="range-label">Mittelwert (Median)</span>
                <span class="range-num">${escapeHtml(mietspiegel.rentPerSqm.median.toFixed(2))} €/m²</span>
                <span class="range-sub">${escapeHtml(mietspiegel.monthlyReferenceRent.median.toFixed(2))} € / Mo.</span>
              </div>
              <div class="range-col">
                <span class="range-label">Oberer Wert</span>
                <span class="range-num">${escapeHtml(mietspiegel.rentPerSqm.upper.toFixed(2))} €/m²</span>
                <span class="range-sub">${escapeHtml(mietspiegel.monthlyReferenceRent.upper.toFixed(2))} € / Mo.</span>
              </div>
            </div>
          </div>

          <dl>
            <div><dt>Mietspiegelfeld</dt><dd><strong>${escapeHtml(mietspiegel.field)}</strong></dd></div>
            <div><dt>Baualtersklasse</dt><dd>${escapeHtml(mietspiegel.buildingAge)}</dd></div>
            <div><dt>Wohnlage</dt><dd>${escapeHtml(mietspiegel.residentialLocation)}</dd></div>
            <div><dt>Größenklasse</dt><dd>${escapeHtml(mietspiegel.sizeCategory)} (${escapeHtml(payload.livingAreaSqm ?? "–")} m²)</dd></div>
          </dl>

          <div class="interactive-comparison-box">
            <label for="interactive-rent-input" style="display: block; font-size: 0.74rem; font-weight: 700; text-transform: uppercase; margin-bottom: 6px; color: #59564f;">
              Vertragsmiete vergleichen (optional):
            </label>
            <div style="display: flex; gap: 8px; align-items: stretch; flex-wrap: wrap;">
              <input type="number" id="interactive-rent-input" step="0.01" min="0" placeholder="Kaltmiete in € (z. B. 500)" style="max-width: 220px; padding: 10px 12px; margin: 0;" />
              <button type="button" id="interactive-rent-btn" style="width: auto; padding: 10px 18px; margin: 0; font-size: 0.85rem;">Prüfen</button>
            </div>
            <div id="interactive-comparison-result"></div>
          </div>

          <div class="disclaimer-box">
            <strong>Berliner Mietspiegel 2026:</strong> Gesetzlicher qualifizierter Mietspiegel nach §§ 558c, 558d BGB. Die Spanne bildet die ortsübliche Vergleichsmiete für typische Wohnungen ab. Die konkrete Einordnung innerhalb der Spanne erfolgt über die Orientierungshilfe (Merkmale zu Bad, Küche, Wohnung, Gebäude, Umfeld).
          </div>
        </div>
      `;
    } else if (mietspiegel?.status === "missing_dwelling_size") {
      mietspiegelHtml = `
        <div class="result-section">
          <p class="result-section-title">Berliner Mietspiegel 2026</p>
          <p style="margin: 0; font-size: 0.8rem; color: #59564f;">Wohnfläche (m²) oben angeben, um das zutreffende Mietspiegelfeld und die monatliche Referenzmiete zu berechnen.</p>
        </div>
      `;
    } else if (mietspiegel?.status === "missing_building_age") {
      mietspiegelHtml = `
        <div class="result-section">
          <p class="result-section-title">Berliner Mietspiegel 2026</p>
          <p style="margin: 0; font-size: 0.8rem; color: #59564f;">Baualtersklasse für diesen Block nicht eindeutig ermittelbar. Bitte optional das konkrete Baujahr oben eingeben.</p>
        </div>
      `;
    }

    let occupancyHtml = "";
    if (occupancyAssessment?.status === "meets_minimum" || occupancyAssessment?.status === "below_minimum") {
      const meetsMin = occupancyAssessment.meetsMinimum;
      const statusBadge = meetsMin
        ? `<span class="badge badge-success">Mindestwohnfläche eingehalten</span>`
        : `<span class="badge badge-warning">Mindestwohnfläche unterschritten</span>`;

      occupancyHtml = `
        <div class="result-section">
          <p class="result-section-title">
            <span>Belegungsprüfung (${escapeHtml(occupancyAssessment.legalBasis)})</span>
            ${statusBadge}
          </p>
          <dl>
            <div><dt>Tatsächliche Wohnfläche</dt><dd>${escapeHtml(occupancyAssessment.livingAreaSqm)} m²</dd></div>
            <div><dt>Gesetzliche Mindestfläche</dt><dd>${escapeHtml(occupancyAssessment.requiredAreaSqm)} m² (9 m²/Erw., 6 m²/Kind ≤ 6 J.)</dd></div>
            <div><dt>Flächenreserve / Differenz</dt><dd>${occupancyAssessment.areaMarginSqm >= 0 ? "+" : ""}${escapeHtml(occupancyAssessment.areaMarginSqm)} m²</dd></div>
            <div><dt>Personen / Zimmer</dt><dd>${escapeHtml(occupancyAssessment.occupants)} Pers. in ${escapeHtml(occupancyAssessment.rooms)} Zi.</dd></div>
            <div><dt>Personen pro Zimmer</dt><dd>${escapeHtml(occupancyAssessment.occupantsPerRoom)}</dd></div>
            <div><dt>Zimmer pro Person</dt><dd>${escapeHtml(occupancyAssessment.roomsPerOccupant)}</dd></div>
          </dl>
          <div class="disclaimer-box">
            <strong>Hinweis nach § 7 WoAufG Bln:</strong> Berechnet auf Basis der Selbstauskunft (statutarische Untergrenze: 9 m² je Person, 6 m² je Kind bis zum vollendeten 6. Lebensjahr). Keine amtliche Feststellung oder Rechtsberatung.
          </div>
        </div>
      `;
    } else if (occupancyAssessment?.status === "not_assessed") {
      occupancyHtml = `
        <div class="result-section">
          <p class="result-section-title">Belegungsprüfung (§ 7 WoAufG Bln)</p>
          <p style="margin: 0; font-size: 0.8rem; color: #59564f;">Nicht geprüft (optionale Wohnungs- und Belegungsdaten wurden nicht angegeben).</p>
        </div>
      `;
    }

    const buildingAgeNote =
      buildingAge?.note ??
      "Überwiegende Baualtersklasse des Blocks (Umweltatlas Berlin, Stand 2015). Exaktes Gebäude-Baujahr amtlich nicht einzeln verifiziert.";

    showResult(
      "verified",
      `<strong>Amtlich bestätigt</strong>
       <p>${escapeHtml(address.street)} ${escapeHtml(address.houseNumber)} · ${escapeHtml(address.postalCode)} Berlin</p>
       <dl>
         <div><dt>Wohnlage (Mietspiegel 2026)</dt><dd>${escapeHtml(residentialLocation)}</dd></div>
         <div><dt>Mietstufe</dt><dd>${escapeHtml(address.rentTier?.locationCategory ? residentialLocation : "–")}</dd></div>
         <div><dt>Baualtersklasse (Block)</dt><dd>${escapeHtml(buildingAgeText)}</dd></div>
         <div><dt>Gebäude-Baujahr verifiziert</dt><dd>${buildingAge?.exactBuildingAgeVerified ? "Ja" : "Nein (nur Blockebene)"}</dd></div>
         <div><dt>Bezirk</dt><dd>${escapeHtml(address.district ?? "–")}</dd></div>
         <div><dt>Ortsteil</dt><dd>${escapeHtml(address.locality ?? "–")}</dd></div>
         <div><dt>Adress-ID</dt><dd>${escapeHtml(address.officialId)}</dd></div>
       </dl>
       <div class="disclaimer-box">
         <strong>Mietspiegel &amp; Gebäudealter:</strong> Wohnlage ist die amtliche Mietspiegel-Lagekategorie, kein Geldbetrag. ${escapeHtml(buildingAgeNote)}
       </div>
       ${mietspiegelHtml}
       ${occupancyHtml}`,
    );

    const rentInput = result.querySelector("#interactive-rent-input");
    const rentBtn = result.querySelector("#interactive-rent-btn");
    const rentComparisonDiv = result.querySelector("#interactive-comparison-result");

    if (rentInput && rentBtn && mietspiegel?.monthlyReferenceRent) {
      const runComparison = () => {
        const val = Number(rentInput.value);
        if (!Number.isFinite(val) || val <= 0) {
          rentComparisonDiv.innerHTML = "";
          return;
        }
        const lower = mietspiegel.monthlyReferenceRent.lower;
        const upper = mietspiegel.monthlyReferenceRent.upper;
        const median = mietspiegel.monthlyReferenceRent.median;
        const area = Number(payload.livingAreaSqm);
        const perSqm = area > 0 ? (val / area).toFixed(2) : "–";

        if (val < lower) {
          const diff = (lower - val).toFixed(2);
          rentComparisonDiv.innerHTML = `
            <div class="rent-comparison-banner comparison-below">
              <strong>${val.toFixed(2)} € / Monat (${perSqm} €/m²)</strong> liegt <em>unterhalb</em> der amtlichen Mietspiegel-Referenzspanne (${lower.toFixed(2)} € – ${upper.toFixed(2)} €).<br />Differenz zur Untergrenze: -${diff} €.
            </div>
          `;
        } else if (val > upper) {
          const diff = (val - upper).toFixed(2);
          rentComparisonDiv.innerHTML = `
            <div class="rent-comparison-banner comparison-above">
              <strong>${val.toFixed(2)} € / Monat (${perSqm} €/m²)</strong> liegt <em>oberhalb</em> der amtlichen Mietspiegel-Referenzspanne (${lower.toFixed(2)} € – ${upper.toFixed(2)} €).<br />Überschreitung der Obergrenze: +${diff} €.
            </div>
          `;
        } else {
          const diff = Math.abs(val - median).toFixed(2);
          rentComparisonDiv.innerHTML = `
            <div class="rent-comparison-banner comparison-within">
              <strong>${val.toFixed(2)} € / Monat (${perSqm} €/m²)</strong> liegt <em>innerhalb</em> der amtlichen Mietspiegel-Referenzspanne (${lower.toFixed(2)} € – ${upper.toFixed(2)} €).<br />Abweichung zum Mittelwert: ${val >= median ? "+" : "-"}${diff} €.
            </div>
          `;
        }
      };

      rentBtn.addEventListener("click", runComparison);
      rentInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          runComparison();
        }
      });
    }
  } catch (error) {
    showResult("error", `<strong>Prüfung nicht möglich</strong><p>${escapeHtml(error.message)}</p>`);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Adresse prüfen <span aria-hidden="true">→</span>';
  }
});

// ==========================================
// OCR Document Ingestion & Auto-Fill
// ==========================================

const ocrDropzone = document.querySelector("#ocr-dropzone");
const ocrFileInput = document.querySelector("#ocr-file-input");
const ocrBrowseBtn = document.querySelector("#ocr-browse-btn");
const ocrFeedback = document.querySelector("#ocr-feedback");

if (ocrDropzone && ocrFileInput) {
  ocrBrowseBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    ocrFileInput.click();
  });

  ocrDropzone.addEventListener("click", () => {
    ocrFileInput.click();
  });

  ocrDropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      ocrFileInput.click();
    }
  });

  ocrDropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    ocrDropzone.classList.add("dragover");
  });

  ocrDropzone.addEventListener("dragleave", () => {
    ocrDropzone.classList.remove("dragover");
  });

  ocrDropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    ocrDropzone.classList.remove("dragover");
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleFileSelected(files[0]);
    }
  });

  ocrFileInput.addEventListener("change", (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelected(files[0]);
    }
  });
}

async function handleFileSelected(file) {
  if (!file) return;

  if (file.size > 15 * 1024 * 1024) {
    showOcrFeedback("error", "Die Datei überschreitet die maximale Größe von 15 MB.");
    return;
  }

  showOcrFeedback("loading", `📄 Verarbeite "${escapeHtml(file.name)}" per OCR … Bitte warten.`);

  try {
    const base64Data = await readFileAsBase64(file);
    const response = await fetch("/api/v1/documents/ocr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        file: base64Data,
        mimeType: file.type || "application/pdf",
        fileName: file.name,
      }),
    });

    const body = await response.json();

    if (!response.ok) {
      const msg = body.error?.details?.[0]?.message ?? body.error?.message ?? "OCR Extraktion fehlgeschlagen.";
      throw new Error(msg);
    }

    const { fields, confidence, prefilledApiPayload, warnings } = body.data;

    // Prefill form
    if (prefilledApiPayload.address) {
      const addressField = form.querySelector('[name="address"]');
      if (addressField) addressField.value = prefilledApiPayload.address;
    }
    if (prefilledApiPayload.livingAreaSqm !== undefined) {
      const areaField = form.querySelector('[name="livingAreaSqm"]');
      if (areaField) areaField.value = prefilledApiPayload.livingAreaSqm;
    }
    if (prefilledApiPayload.contractRent !== undefined) {
      const rentField = form.querySelector('[name="contractRent"]');
      if (rentField) rentField.value = prefilledApiPayload.contractRent;
    }
    if (prefilledApiPayload.buildingYear !== undefined) {
      const yearField = form.querySelector('[name="buildingYear"]');
      if (yearField) yearField.value = prefilledApiPayload.buildingYear;
    }
    if (prefilledApiPayload.rooms !== undefined) {
      const roomsField = form.querySelector('[name="rooms"]');
      if (roomsField) roomsField.value = prefilledApiPayload.rooms;
    }
    if (prefilledApiPayload.occupants !== undefined) {
      const occupantsField = form.querySelector('[name="occupants"]');
      if (occupantsField) occupantsField.value = prefilledApiPayload.occupants;
    }
    if (prefilledApiPayload.childrenUpToSix !== undefined) {
      const childrenField = form.querySelector('[name="childrenUpToSix"]');
      if (childrenField) childrenField.value = prefilledApiPayload.childrenUpToSix;
    }

    // Build success message with pills
    const pills = [];
    if (fields.street && fields.houseNumber) {
      pills.push(`<span class="ocr-pill high-conf">📍 ${escapeHtml(fields.street)} ${escapeHtml(fields.houseNumber)} (${Math.round((confidence.address || 0) * 100)}%)</span>`);
    }
    if (fields.postalCode) {
      pills.push(`<span class="ocr-pill high-conf">📮 PLZ ${escapeHtml(fields.postalCode)}</span>`);
    }
    if (fields.livingAreaSqm) {
      pills.push(`<span class="ocr-pill high-conf">📐 ${fields.livingAreaSqm} m²</span>`);
    }
    if (fields.contractRent) {
      pills.push(`<span class="ocr-pill high-conf">💶 Kaltmiete: ${fields.contractRent} €</span>`);
    }
    if (fields.buildingYear) {
      pills.push(`<span class="ocr-pill high-conf">🏗️ Baujahr: ${fields.buildingYear}</span>`);
    }
    if (fields.rooms) {
      pills.push(`<span class="ocr-pill med-conf">🚪 ${fields.rooms} Zimmer</span>`);
    }
    if (fields.occupants) {
      pills.push(`<span class="ocr-pill med-conf">👥 ${fields.occupants} Personen</span>`);
    }

    let warningHtml = "";
    if (warnings && warnings.length > 0) {
      warningHtml = `<p style="margin: 8px 0 0; font-size: 0.85rem; color: #b45309;">⚠️ ${warnings.map(escapeHtml).join(" ")}</p>`;
    }

    showOcrFeedback(
      "success",
      `<strong>✓ Daten erfolgreich extrahiert und in das Formular eingetragen!</strong>
       <div class="ocr-pill-grid">${pills.join("")}</div>
       ${warningHtml}
       <p style="margin: 10px 0 0; font-size: 0.85rem;">Bitte überprüfen Sie die eingetragenen Daten und klicken Sie unten auf <strong>"Adresse prüfen"</strong>.</p>`
    );
  } catch (err) {
    showOcrFeedback("error", `<strong>Fehler bei der OCR-Extraktion:</strong> ${escapeHtml(err.message)}`);
  }
}

function showOcrFeedback(type, html) {
  if (!ocrFeedback) return;
  ocrFeedback.className = `ocr-feedback ${type}`;
  ocrFeedback.innerHTML = html;
  ocrFeedback.hidden = false;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(",")[1];
      resolve(base64);
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

// ==========================================
// Chatbot Orchestrator & Chat UI
// ==========================================

const chatbotContainer = document.querySelector("#chatbot-container");
const chatbotToggleBtn = document.querySelector("#chatbot-toggle-btn");
const chatbotWindow = document.querySelector("#chatbot-window");
const chatbotCloseBtn = document.querySelector("#chatbot-close-btn");
const chatbotMessages = document.querySelector("#chatbot-messages");
const chatbotSuggestions = document.querySelector("#chatbot-suggestions");
const chatbotForm = document.querySelector("#chatbot-form");
const chatbotInput = document.querySelector("#chatbot-input");
const chatbotSendBtn = document.querySelector("#chatbot-send-btn");

let chatHistory = [];
let hasGreeted = false;

function renderSimpleMarkdown(text) {
  if (!text) return "";
  let html = escapeHtml(text);

  // Headers: ### Header
  html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
  html = html.replace(/^#### (.*$)/gim, "<h4>$1</h4>");

  // Bold: **text**
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

  // Italic: *text*
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");

  // Unordered list items: - item
  html = html.replace(/^\- (.*$)/gim, "<li>$1</li>");
  // Wrap contiguous <li> with <ul>
  html = html.replace(/((?:<li>.*?<\/li>\s*)+)/gis, "<ul>$1</ul>");

  // Newlines to <br> (outside of lists and headers)
  html = html.replace(/(?:\r\n|\r|\n){2,}/g, "</p><p>");
  html = `<p>${html}</p>`.replace(/<p><(h3|h4|ul)/g, "<$1").replace(/<\/(h3|h4|ul)><\/p>/g, "</$1>");

  return html;
}

function appendMessage(role, content, toolCalls = []) {
  if (!chatbotMessages) return;

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role}`;

  let toolHtml = "";
  if (toolCalls && toolCalls.length > 0) {
    toolHtml = toolCalls
      .map(
        (t) =>
          `<div class="tool-chip ${t.success ? "success" : "error"}">⚙️ Tool: ${escapeHtml(t.name)} (${t.executionTimeMs}ms)</div>`,
      )
      .join("");
  }

  bubble.innerHTML = `${toolHtml}${renderSimpleMarkdown(content)}`;
  chatbotMessages.appendChild(bubble);
  chatbotMessages.scrollTop = chatbotMessages.scrollHeight;

  chatHistory.push({ role, content });
}

function setSuggestions(list) {
  if (!chatbotSuggestions) return;
  chatbotSuggestions.innerHTML = "";
  if (!list || list.length === 0) {
    chatbotSuggestions.hidden = true;
    return;
  }
  chatbotSuggestions.hidden = false;

  list.forEach((item) => {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "suggestion-pill";
    pill.textContent = item;
    pill.addEventListener("click", () => {
      sendChatMessage(item);
    });
    chatbotSuggestions.appendChild(pill);
  });
}

async function sendChatMessage(msgText) {
  const text = msgText || chatbotInput.value.trim();
  if (!text) return;

  appendMessage("user", text);
  if (chatbotInput) chatbotInput.value = "";
  if (chatbotSendBtn) chatbotSendBtn.disabled = true;

  // Typing indicator
  const typingBubble = document.createElement("div");
  typingBubble.className = "chat-bubble bot";
  typingBubble.id = "typing-indicator";
  typingBubble.innerHTML = "<em>Amt-Buddy denkt nach und führt Tools aus …</em>";
  chatbotMessages.appendChild(typingBubble);
  chatbotMessages.scrollTop = chatbotMessages.scrollHeight;

  try {
    const response = await fetch("/api/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: text,
        history: chatHistory.slice(-8),
      }),
    });

    const body = await response.json();
    typingBubble.remove();

    if (!response.ok) {
      throw new Error(body.error?.message || "Fehler bei der Kommunikation mit dem Assistenten.");
    }

    const { reply, toolCalls, suggestions } = body.data;
    appendMessage("bot", reply, toolCalls);
    setSuggestions(suggestions);
  } catch (err) {
    typingBubble.remove();
    appendMessage("bot", `⚠️ Entschuldigung, es ist ein Fehler aufgetreten: ${err.message}`);
  } finally {
    if (chatbotSendBtn) chatbotSendBtn.disabled = false;
    chatbotInput.focus();
  }
}

if (chatbotToggleBtn && chatbotWindow) {
  chatbotToggleBtn.addEventListener("click", () => {
    const isHidden = chatbotWindow.hidden;
    chatbotWindow.hidden = !isHidden;

    if (isHidden && !hasGreeted) {
      hasGreeted = true;
      sendChatMessage("Hallo");
    }

    if (isHidden) {
      chatbotInput.focus();
    }
  });

  chatbotCloseBtn?.addEventListener("click", () => {
    chatbotWindow.hidden = true;
  });

  chatbotForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    sendChatMessage();
  });
}

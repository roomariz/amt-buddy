import { executeTool, getToolSchemas } from "./chatbot-tools.js";
import { parseAddressInput } from "./berlin-address.js";
import { parseTenancyDocument } from "./ocr-extraction.js";

let customChatModelProvider = null;

export function registerChatModelProvider(provider) {
  customChatModelProvider = provider;
}

export function resetChatModelProvider() {
  customChatModelProvider = null;
}

/**
 * Classifies intent from user message and conversation context.
 */
export function classifyIntent(messageText, context = {}) {
  const text = String(messageText || "").toLowerCase();

  if (context.hasFile || /mietvertrag|wohnungsgeber|bestätigung|dokument|vertrag|anhang/i.test(text)) {
    return "document_analysis";
  }

  // Address pattern (street + number or plz + berlin)
  const hasStreetIndicator = /(?:straße|strasse|str\.|platz|allee|weg|damm|chaussee|ufer|zeile|ring|gasse)\s+\d+/i.test(text);
  const hasBerlinPlz = /\b(10\d{3}|12\d{3}|13\d{3}|14[01]\d{2})\b/i.test(text);
  if (hasStreetIndicator || (hasBerlinPlz && /berlin/i.test(text))) {
    return "address_verification";
  }

  // Occupancy / Overcrowding patterns
  if (
    /belegung|überbelegung|woaufg|personen|kinder|wie\s+viele\s+personen|mindestfläche|quadratmeter\s+pro\s+person|zulässig|darf\s+ich/i.test(
      text,
    ) &&
    /\d+\s*(?:m²|qm|personen|kinder|zimmer)/i.test(text)
  ) {
    return "occupancy_check";
  }

  // Mietspiegel / Rent check patterns
  if (
    /mietspiegel|vergleichsmiete|kaltmiete|miete|quadratmeterpreis|ortsübliche|mietpreisbremse/i.test(
      text,
    )
  ) {
    return "mietspiegel_check";
  }

  // General help or greeting
  if (/hallo|guten\s+tag|hi|hey|hilfe|help|wer\s+bist\s+du|was\s+kannst\s+du/i.test(text)) {
    return "greeting";
  }

  return "general_query";
}

/**
 * Extracts numbers for livingAreaSqm, contractRent, rooms, occupants, buildingYear from text.
 */
function extractDwellingFacts(text) {
  const facts = {};

  const areaMatch = /(?:(\d+(?:[.,]\d+)?)\s*(?:m²|qm|quadratmeter))|(?:wohnfläche[^\d]{0,20}(\d+(?:[.,]\d+)?))/i.exec(text);
  if (areaMatch) {
    const val = parseFloat((areaMatch[1] || areaMatch[2]).replace(",", "."));
    if (val > 0) facts.livingAreaSqm = val;
  }

  const rentMatch = /(?:(\d+(?:[.,]\d+)?)\s*(?:€|eur|euro))|(?:kaltmiete|miete)[^\d]{0,20}(\d+(?:[.,]\d+)?)/i.exec(text);
  if (rentMatch) {
    const val = parseFloat((rentMatch[1] || rentMatch[2]).replace(",", "."));
    if (val > 0) facts.contractRent = val;
  }

  const yearMatch = /\b(18\d{2}|19\d{2}|20[0-2]\d)\b/.exec(text);
  if (yearMatch) {
    facts.buildingYear = parseInt(yearMatch[1], 10);
  }

  const roomsMatch = /(\d+(?:[.,]\d+)?)\s*(?:zimmer|räume)/i.exec(text);
  if (roomsMatch) {
    facts.rooms = parseFloat(roomsMatch[1].replace(",", "."));
  }

  const occMatch = /(\d+)\s*(?:personen|mieter|bewohner|erwachsene)/i.exec(text);
  if (occMatch) {
    facts.occupants = parseInt(occMatch[1], 10);
  }

  const childMatch = /(\d+)\s*kind(?:er)?/i.exec(text);
  if (childMatch) {
    facts.childrenUpToSix = parseInt(childMatch[1], 10);
  }

  return facts;
}

/**
 * Main orchestrator handling conversational queries and autonomous tool dispatch.
 */
export async function processChat({ message, history = [], context = {} }) {
  if (customChatModelProvider) {
    return await customChatModelProvider({
      message,
      history,
      context,
      tools: getToolSchemas(),
      executeTool,
    });
  }

  const intent = classifyIntent(message, context);
  const toolCalls = [];
  let reply = "";
  const suggestions = [];

  switch (intent) {
    case "address_verification": {
      const facts = extractDwellingFacts(message);
      let addressParam = "";

      // Try parsing single or multi-line address from text
      const addressMatch = /([A-ZÄÖÜ][a-zäöüßA-Z0-9.\-\s]+?(?:straße|strasse|str\.|platz|allee|weg|damm|chaussee|ufer|zeile|ring)\s+\d{1,4}\s*[a-z]?)[,\s]+(10\d{3}|12\d{3}|13\d{3}|14[01]\d{2})(?:\s+Berlin)?/i.exec(
        message,
      );

      if (addressMatch) {
        addressParam = `${addressMatch[1].trim()}\n${addressMatch[2]} Berlin`;
      } else {
        addressParam = message.trim();
      }

      const params = {
        address: addressParam,
        ...facts,
      };

      const toolResult = await executeTool("validate_berlin_address", params);
      toolCalls.push(toolResult);

      if (toolResult.success && toolResult.result.verified) {
        const { address, mietspiegel, occupancyAssessment } = toolResult.result;
        reply = `### Offizielle Berliner Adresse bestätigt: **${address.street} ${address.houseNumber}**\n\n` +
          `- **Postleitzahl & Ort**: ${address.postalCode} ${address.city} (${address.district})\n` +
          `- **Wohnlage**: **${address.residentialLocation || "Nicht ausgewiesen"}**\n` +
          `- **Baualtersklasse**: ${address.buildingAge?.areaBuildingAgeClass || address.buildingAge?.predominantAreaConstructionPeriod || "Nicht verfügbar"}\n`;

        if (mietspiegel && mietspiegel.status === "calculated") {
          reply += `\n#### Mietspiegel 2026\n` +
            `- **Spanneneinordnung (Feld ${mietspiegel.field})**: ${mietspiegel.rentPerSqm.lower} € bis ${mietspiegel.rentPerSqm.upper} €/m² (Mittelwert: **${mietspiegel.rentPerSqm.median} €/m²**)\n` +
            `- **Monatliche Vergleichsmiete**: ${mietspiegel.monthlyReferenceRent.lower.toFixed(2)} € – ${mietspiegel.monthlyReferenceRent.upper.toFixed(2)} € (Mittel: **${mietspiegel.monthlyReferenceRent.median.toFixed(2)} €**)\n`;

          if (mietspiegel.contractRentComparison) {
            const cmp = mietspiegel.contractRentComparison;
            reply += `- **Vertragsmiete (${cmp.actualMonthlyRent} €)**: Liegt **${cmp.status === "within" ? "innerhalb" : cmp.status === "above" ? "über" : "unter"}** der amtlichen Spanne.\n`;
          }
        }

        if (occupancyAssessment && occupancyAssessment.status !== "not_assessed") {
          reply += `\n#### Belegungsprüfung (§ 7 WoAufG Bln)\n` +
            `- **Ergebnis**: ${occupancyAssessment.status === "meets_minimum" ? "✓ Gesetzliche Mindestwohnfläche eingehalten" : "⚠️ Mögliche Überbelegung gem. § 7 Abs. 1 WoAufG Bln"}\n` +
            `- **Wohnfläche pro Person**: ${occupancyAssessment.actualAreaPerOccupant} m² (Gesetzlich gefordert: mind. ${occupancyAssessment.requiredAreaTotal} m² gesamt)\n`;
        }

        suggestions.push("Mietspiegel für diese Adresse berechnen");
        suggestions.push("Belegung für 3 Personen prüfen");
      } else {
        const errorMsg = toolResult.error?.message || "Adresse konnte nicht im amtlichen Verzeichnis verifiziert werden.";
        reply = `⚠️ **Adresse nicht verifiziert**\n\n${errorMsg}\n\n*Hinweis: Bitte geben Sie eine vollständige Berliner Adresse mit Straße, Hausnummer und PLZ an (z. B. "Berliner Straße 155, 10715 Berlin").*`;
        suggestions.push("Berliner Straße 155, 10715 Berlin prüfen");
      }
      break;
    }

    case "mietspiegel_check": {
      const facts = extractDwellingFacts(message);
      let loc = "mittel";
      if (/gut/i.test(message)) loc = "gut";
      if (/einfach/i.test(message)) loc = "einfach";

      const buildingAgeOrYear = facts.buildingYear || "1919–1949";
      const area = facts.livingAreaSqm || 60;

      const params = {
        residentialLocation: loc,
        buildingAgeOrYear: String(buildingAgeOrYear),
        livingAreaSqm: area,
        contractRent: facts.contractRent,
      };

      const toolResult = await executeTool("calculate_mietspiegel", params);
      toolCalls.push(toolResult);

      if (toolResult.success && toolResult.result.status === "calculated") {
        const res = toolResult.result;
        reply = `### Berliner Mietspiegel 2026 Auswertung\n\n` +
          `- **Wohnlage**: ${loc}\n` +
          `- **Baualtersklasse**: ${res.buildingAge}\n` +
          `- **Wohnflächenkategorie**: ${res.sizeCategory} (${area} m²)\n` +
          `- **Tabellenfeld**: **${res.field}**\n\n` +
          `#### Amtliche Referenzspanne\n` +
          `- **Spanne**: **${res.rentPerSqm.lower} € – ${res.rentPerSqm.upper} € / m²** (Mittelwert: **${res.rentPerSqm.median} €/m²**)\n` +
          `- **Monatliche Vergleichsmiete**: **${res.monthlyReferenceRent.lower.toFixed(2)} € – ${res.monthlyReferenceRent.upper.toFixed(2)} €** (Mittel: **${res.monthlyReferenceRent.median.toFixed(2)} €**)\n`;

        if (res.contractRentComparison) {
          const cmp = res.contractRentComparison;
          reply += `\n**Mietpreisvergleich**: Ihre Kaltmiete von ${cmp.actualMonthlyRent} € liegt **${cmp.status === "within" ? "voll im Rahmen" : cmp.status === "above" ? "über" : "unter"}** der amtlichen Mietspiegelspanne.`;
        }
      } else {
        reply = `Für die genaue Mietspiegel-Berechnung benötige ich Wohnfläche (m²), Baujahr (oder Baualtersklasse) und Wohnlage (einfach, mittel oder gut).`;
      }
      suggestions.push("Mietspiegel für 50 m², gute Lage, Baujahr 1935");
      suggestions.push("Belegungsprüfung durchführen");
      break;
    }

    case "occupancy_check": {
      const facts = extractDwellingFacts(message);
      const area = facts.livingAreaSqm || 45;
      const rooms = facts.rooms || 2;
      const occupants = facts.occupants || 2;
      const children = facts.childrenUpToSix || 0;

      const params = {
        livingAreaSqm: area,
        rooms,
        occupants,
        childrenUpToSix: children,
      };

      const toolResult = await executeTool("assess_occupancy_compliance", params);
      toolCalls.push(toolResult);

      if (toolResult.success) {
        const occ = toolResult.result;
        const perPerson = Math.round((area / occupants) * 10) / 10;
        reply = `### Belegungsprüfung nach § 7 Abs. 1 WoAufG Bln\n\n` +
          `- **Status**: **${occ.status === "meets_minimum" ? "✓ Gesetzliche Mindeststandards erfüllt" : "⚠️ Unzureichende Wohnfläche (Überbelegungsrisiko)"}**\n` +
          `- **Wohnungsgröße**: ${area} m² auf ${rooms} Zimmer\n` +
          `- **Belegung**: ${occupants} Personen (davon ${children} Kinder bis 6 J.)\n` +
          `- **Erforderliche Mindestwohnfläche**: **${occ.requiredAreaSqm} m²** (Gesetz: 9 m²/Erwachsener, 6 m²/Kind bis 6 J.)\n` +
          `- **Tatsächliche Fläche pro Person**: **${perPerson} m²**\n` +
          `- **Zimmerdichte**: ${occ.occupantsPerRoom} Personen pro Zimmer\n\n` +
          `*Hinweis: Dies ist eine automatische Orientierungsberechnung auf Basis des Berliner Wohnungsaufsichtsgesetzes.*`;
      }
      suggestions.push("Ist eine 30 m² Wohnung für 3 Personen zulässig?");
      suggestions.push("Adresse prüfen");
      break;
    }

    case "document_analysis": {
      let docText = message;
      if (context.fileText) {
        docText = context.fileText;
      }

      const toolResult = await executeTool("extract_document_ocr", { text: docText });
      toolCalls.push(toolResult);

      if (toolResult.success) {
        const { fields, confidence, warnings } = toolResult.result;
        reply = `### Mietvertrags-Analyse per OCR abgeschlossen\n\n` +
          `Folgende Miet- und Wohnungsdaten wurden erkannt:\n\n` +
          `- **Adresse**: ${fields.address || "Nicht eindeutig erkannt"}\n` +
          `- **Nettokaltmiete**: ${fields.contractRent ? `${fields.contractRent} € / Monat` : "Nicht angegeben"}\n` +
          `- **Wohnfläche**: ${fields.livingAreaSqm ? `${fields.livingAreaSqm} m²` : "Nicht angegeben"}\n` +
          `- **Zimmer**: ${fields.rooms || "Nicht angegeben"}\n` +
          `- **Baujahr**: ${fields.buildingYear || "Nicht angegeben"}\n` +
          `- **Gesamterkennungsrate**: **${Math.round((confidence.overall || 0) * 100)}%**\n`;

        if (warnings && warnings.length > 0) {
          reply += `\n⚠️ *Hinweise: ${warnings.join("; ")}*\n`;
        }

        if (fields.address) {
          reply += `\nMöchten Sie diese Adresse nun direkt gegen das offizielle Berliner Liegenschaftsregister prüfen?`;
          suggestions.push(`Prüfe Adresse: ${fields.address.replace(/\n/, ", ")}`);
        }
      } else {
        reply = `Das Dokument konnte nicht analysiert werden: ${toolResult.error?.message}. Bitte laden Sie ein PDF hoch oder fügen Sie den Vertragstext ein.`;
      }
      break;
    }

    case "greeting":
    default: {
      reply = `👋 **Hallo! Ich bin Ihr Amt-Buddy Assistent.**\n\n` +
        `Ich helfe Ihnen bei allen Fragen rund um Berliner Wohnungen, Mietrecht und behördliche Prüfungen:\n\n` +
        `- 📍 **Offizielle Adressprüfung**: Berliner Anschriften gegen das WFS-Liegenschaftskataster abgleichen.\n` +
        `- 📊 **Berliner Mietspiegel 2026**: Referenzmiete und zulässige Kaltmiete ermitteln.\n` +
        `- 🏠 **Belegungsprüfung (§ 7 WoAufG Bln)**: Überbelegung und Mindestwohnflächen prüfen.\n` +
        `- 📄 **Dokumenten-OCR**: Mietvertrag oder Wohnungsgeberbestätigung analysieren.\n\n` +
        `Wie kann ich Ihnen helfen?`;

      suggestions.push("Prüfe Berliner Straße 155, 10715 Berlin");
      suggestions.push("Mietspiegel für 60 m² in guter Lage");
      suggestions.push("Mindestfläche für 3 Personen (§ 7 WoAufG)");
      break;
    }
  }

  return {
    reply,
    intent,
    toolCalls,
    suggestions,
  };
}

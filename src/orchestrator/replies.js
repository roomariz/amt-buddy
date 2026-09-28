// Fixed replies the Orchestrator adds by code, never by the model.
const REPLIES = {
  outOfScope: {
    en: "I can only help with Berlin housing questions: verifying an address, the Mietspiegel reference rent, § 7 WoAufG Bln occupancy rules, and analysing your lease. What would you like to check?",
    de: "Ich kann nur bei Fragen rund ums Wohnen in Berlin helfen: Adressprüfung, ortsübliche Vergleichsmiete nach Mietspiegel, Belegung nach § 7 WoAufG Bln und Analyse Ihres Mietvertrags. Was möchten Sie prüfen?",
  },
  disclaimer: {
    en: "_This is general information based on official Berlin data, not legal advice. For a binding assessment, contact a tenants' association (Mieterverein) or a lawyer._",
    de: "_Dies ist eine allgemeine Information auf Grundlage amtlicher Berliner Daten und keine Rechtsberatung. Für eine verbindliche Einschätzung wenden Sie sich an einen Mieterverein oder eine Anwältin bzw. einen Anwalt._",
  },
  fallback: {
    en: "I couldn't verify my answer against official data. Could you tell me which check you'd like (address, Mietspiegel or occupancy) and the missing details?",
    de: "Ich konnte meine Antwort nicht mit amtlichen Daten belegen. Welche Prüfung möchten Sie (Adresse, Mietspiegel oder Belegung), und welche Angaben fehlen noch?",
  },
};

export function reply(key, language) {
  return REPLIES[key][language] ?? REPLIES[key].en;
}

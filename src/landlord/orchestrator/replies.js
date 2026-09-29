// Fixed replies the Landlord Orchestrator adds by code, never by the model, in German or English.
const REPLIES = {
  removedFigures: {
    en: "I left out figures I could not back with your data.",
    de: "Zahlen, die ich nicht mit den Daten belegen konnte, habe ich weggelassen.",
  },
  fallback: {
    en: "I couldn't back my answer with your data. Would you like to see the ranking, an applicant's profile or your Rent check?",
    de: "Ich konnte meine Antwort nicht mit Ihren Daten belegen. Möchten Sie die Rangliste, das Profil eines Bewerbers oder Ihren Mietcheck sehen?",
  },
  notConfigured: {
    en: "The AI chat is not configured on this server (no OPENAI_MODEL / OPENAI_API_KEY). Your Listing and the Rent check work without it.",
    de: "Der KI-Chat ist auf diesem Server nicht eingerichtet (kein OPENAI_MODEL / OPENAI_API_KEY). Ihre Wohnung und der Mietcheck funktionieren auch ohne ihn.",
  },
};

export function landlordReply(key, language) {
  return REPLIES[key][language === "de" ? "de" : "en"];
}

const GERMAN = /\b(ich|ist|und|der|die|das|den|dem|nicht|mein|meine|meinen|wer|wie|was|warum|welche[rsn]?|bitte|miete|mieter|bewerber(in)?|zu|sie|ein|eine|einen|mit|für|auf|nur|gibt|soll|sollte|kann|möchte|hoch|niedrig|wohnung|keine?)\b|[äöüß]/gi;
const ENGLISH = /\b(i|is|and|the|not|my|who|how|what|why|which|please|rent|tenant|applicant|to|you|a|an|with|for|on|only|should|can|would|like|high|low|flat|apartment|no|me|about|tell|more)\b/gi;

// The language a landlord's message is written in: "de" or "en", or null when it gives no clue.
export function detectLanguage(text) {
  const german = String(text ?? "").match(GERMAN)?.length ?? 0;
  const english = String(text ?? "").match(ENGLISH)?.length ?? 0;
  if (german === english) return null;
  return german > english ? "de" : "en";
}

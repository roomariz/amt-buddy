// Fixed replies the Orchestrator adds by code, never by the model.
// Keyed by the ISO 639-1 language the Intent router detected; any other
// language falls back to English.
const REPLIES = {
  outOfScope: {
    en: "I can only help with Berlin housing questions: verifying an address, the Mietspiegel reference rent, § 7 WoAufG Bln occupancy rules, and analysing your lease. What would you like to check?",
    de: "Ich kann nur bei Fragen rund ums Wohnen in Berlin helfen: Adressprüfung, ortsübliche Vergleichsmiete nach Mietspiegel, Belegung nach § 7 WoAufG Bln und Analyse Ihres Mietvertrags. Was möchten Sie prüfen?",
    fr: "Je ne peux vous aider que pour des questions de logement à Berlin : vérification d'une adresse, loyer de référence du Mietspiegel, règles d'occupation du § 7 WoAufG Bln et analyse de votre bail (Mietvertrag). Que souhaitez-vous vérifier ?",
    es: "Solo puedo ayudarle con preguntas sobre vivienda en Berlín: verificar una dirección, el alquiler de referencia del Mietspiegel, las normas de ocupación del § 7 WoAufG Bln y el análisis de su contrato de alquiler (Mietvertrag). ¿Qué desea comprobar?",
    it: "Posso aiutarla solo con domande sull'abitare a Berlino: verifica di un indirizzo, affitto di riferimento del Mietspiegel, regole di occupazione del § 7 WoAufG Bln e analisi del suo contratto d'affitto (Mietvertrag). Cosa desidera verificare?",
    tr: "Yalnızca Berlin'deki konutla ilgili sorularda yardımcı olabilirim: adres doğrulama, Mietspiegel referans kirası, § 7 WoAufG Bln kapsamındaki kullanım kuralları ve kira sözleşmenizin (Mietvertrag) incelenmesi. Neyi kontrol etmek istersiniz?",
  },
  disclaimer: {
    en: "_This is general information based on official Berlin data, not legal advice. For a binding assessment, contact a tenants' association (Mieterverein) or a lawyer._",
    de: "_Dies ist eine allgemeine Information auf Grundlage amtlicher Berliner Daten und keine Rechtsberatung. Für eine verbindliche Einschätzung wenden Sie sich an einen Mieterverein oder eine Anwältin bzw. einen Anwalt._",
    fr: "_Il s'agit d'une information générale fondée sur des données officielles de Berlin, et non d'un conseil juridique. Pour une évaluation contraignante, adressez-vous à une association de locataires (Mieterverein) ou à un avocat._",
    es: "_Esta es información general basada en datos oficiales de Berlín, no asesoramiento jurídico. Para una valoración vinculante, diríjase a una asociación de inquilinos (Mieterverein) o a un abogado._",
    it: "_Si tratta di un'informazione generale basata su dati ufficiali di Berlino, non di una consulenza legale. Per una valutazione vincolante si rivolga a un'associazione di inquilini (Mieterverein) o a un avvocato._",
    tr: "_Bu, Berlin'in resmi verilerine dayanan genel bir bilgidir, hukuki danışmanlık değildir. Bağlayıcı bir değerlendirme için bir kiracılar derneğine (Mieterverein) veya bir avukata başvurun._",
  },
  removedFigures: {
    en: "I left out figures I could not verify against official data.",
    de: "Zahlen, die ich nicht mit amtlichen Daten belegen konnte, habe ich weggelassen.",
    fr: "J'ai omis les chiffres que je n'ai pas pu vérifier à l'aide de données officielles.",
    es: "He omitido las cifras que no he podido verificar con datos oficiales.",
    it: "Ho omesso le cifre che non sono riuscito a verificare con dati ufficiali.",
    tr: "Resmi verilerle doğrulayamadığım rakamları çıkardım.",
  },
  fallback: {
    en: "I couldn't verify my answer against official data. Could you tell me which check you'd like (address, Mietspiegel or occupancy) and the missing details?",
    de: "Ich konnte meine Antwort nicht mit amtlichen Daten belegen. Welche Prüfung möchten Sie (Adresse, Mietspiegel oder Belegung), und welche Angaben fehlen noch?",
    fr: "Je n'ai pas pu vérifier ma réponse à l'aide de données officielles. Quelle vérification souhaitez-vous (adresse, Mietspiegel ou occupation), et quelles informations manquent encore ?",
    es: "No he podido verificar mi respuesta con datos oficiales. ¿Qué comprobación desea (dirección, Mietspiegel u ocupación) y qué datos faltan?",
    it: "Non sono riuscito a verificare la mia risposta con dati ufficiali. Quale verifica desidera (indirizzo, Mietspiegel o occupazione) e quali dati mancano ancora?",
    tr: "Cevabımı resmi verilerle doğrulayamadım. Hangi kontrolü istersiniz (adres, Mietspiegel veya kullanım) ve hangi bilgiler eksik?",
  },
};

export function reply(key, language) {
  const code = String(language ?? "").toLowerCase().slice(0, 2);
  return REPLIES[key][code] ?? REPLIES[key].en;
}

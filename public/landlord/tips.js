// The rotating tips below the chat-first page's prompt, as a pure function of the overview (no DOM):
// what the landlord could say next, given what the page already knows about the flat and the
// Selection criteria. Each tip is { id, text, example }; `example` is the sentence to put into the
// prompt, or null when the tip has nothing to say back to the assistant.

import { t } from "../i18n.js";
import { CRITERIA, formatNumber } from "./ranking.js";

// Requirement tips in the order they are suggested. occupancyCompliant never gets one: it is a
// legal check that is on by default, not a preference to steer.
const REQUIREMENT_TIPS = ["schufaCleanOnly", "completeDocumentsOnly", "maxRentToIncome", "noPets", "noSmoking", "latestMoveIn"];

const criterionLabel = (criterion) => t(`landlord.ranking.criteria.${criterion}`);
const known = (value) => value !== null && value !== undefined;

// Criteria with a share above 0, largest first, ties to the earlier one in CRITERIA. It reads the
// *active* shares, not the saved weights: without an asking rent affordability is off and the
// others are renormalised, so the saved weights would name a criterion that is not counting.
function activeByShare(activeWeights) {
  return CRITERIA.filter((criterion) => activeWeights[criterion] > 0).sort(
    (a, b) => activeWeights[b] - activeWeights[a] || CRITERIA.indexOf(a) - CRITERIA.indexOf(b),
  );
}

export function landlordTips({ criteria, inactive, flat, rentCheck, ranked, bonusPoints = 5 }) {
  const active = activeByShare(criteria.activeWeights);
  // Nothing active (all weights 0) still needs a first tip; the first criterion stands in.
  const heaviest = active[0] ?? CRITERIA[0];
  const boost = active[1] ?? heaviest;

  const heaviestExample = t("landlordChat.tips.heaviestExample", { criterion: criterionLabel(boost) });
  const tips = [
    {
      id: "heaviest",
      text: t("landlordChat.tips.heaviest", { heaviest: criterionLabel(heaviest), example: heaviestExample }),
      example: heaviestExample,
    },
  ];
  const add = (id, textKey, exampleKey, vars = {}) => {
    const example = exampleKey ? t(exampleKey, vars) : null;
    tips.push({ id, text: t(`landlordChat.tips.${textKey}`, { ...vars, example }), example });
  };

  // What the page still does not know about the flat.
  if (!known(flat.askingRent)) add("noRent", "noRent", "landlordChat.tips.noRentExample");
  if (!known(flat.livingAreaSqm) || !known(flat.rooms)) add("noSize", "noSize", "landlordChat.tips.noSizeExample");
  if (known(flat.askingRent) && !rentCheck) add("noRentCheck", "noRentCheck", "landlordChat.tips.noRentCheckExample");

  // The landlord's own bonus (thumbs up/down), before the criteria it competes with.
  add("bonus", "bonus", "landlordChat.tips.bonusExample", { points: formatNumber(bonusPoints) });

  // The other active criteria, largest share first. A criterion at 0 % is not counting (the flat-fact
  // tips above speak for it) and the heaviest already has the first tip.
  for (const criterion of active.slice(1)) {
    add(`criterion:${criterion}`, "criterion", "landlordChat.tips.criterionExample", { criterion: criterionLabel(criterion) });
  }

  // Requirements that are off; the ones already on need no suggesting.
  for (const key of REQUIREMENT_TIPS) {
    const value = criteria.requirements[key];
    if (value === false || !known(value)) add(`requirement:${key}`, "requirement", `landlordChat.tips.requirementExample.${key}`);
  }

  // Tips that name real applicants by id; they disappear when there are too few to name.
  const [first, second] = ranked;
  if (first && second) {
    add("whyAbove", "whyAbove", "landlordChat.tips.whyAboveExample", { first: first.applicantId, second: second.applicantId });
  }
  if (first) {
    add("tellMore", "tellMore", "landlordChat.tips.tellMoreExample", { id: first.applicantId });
    add("markInvited", "markInvited", "landlordChat.tips.markInvitedExample", { id: first.applicantId });
  }

  add("memory", "memory", null);
  return tips;
}

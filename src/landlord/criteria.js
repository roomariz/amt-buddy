import { z } from "zod";
import { DEFAULT_CRITERIA } from "./scorer.js";

const weightsSchema = z.strictObject(Object.fromEntries(
  Object.keys(DEFAULT_CRITERIA.weights).map((key) => [key, z.number().nonnegative().optional()]),
));
const requirementsSchema = z.strictObject({
  schufaCleanOnly: z.boolean().optional(),
  completeDocumentsOnly: z.boolean().optional(),
  maxRentToIncome: z.number().positive().max(1).nullable().optional(),
  noPets: z.boolean().optional(),
  noSmoking: z.boolean().optional(),
  latestMoveIn: z.iso.date().nullable().optional(),
  occupancyCompliant: z.boolean().optional(),
});
const updateSchema = z.strictObject({ weights: weightsSchema.optional(), requirements: requirementsSchema.optional() });

const CRITERIA = Object.keys(DEFAULT_CRITERIA.weights);
// Every field required, so a model has no optional number to fill with 0 (it did: "share": 0 next
// to the factor it meant).
const changesSchema = z
  .array(z.strictObject({ criterion: z.enum(CRITERIA), by: z.enum(["factor", "share"]), value: z.number().nonnegative() }))
  .min(1);

export class CriteriaInputError extends Error {
  constructor(details) {
    super("Check the selection criteria.");
    this.details = details;
  }
}

// Shared by the HTTP endpoint and the update_selection_criteria chat Tool (whose contract has no
// weights: the chat changes weights with adjustSelectionCriteria, under its limits).
// Missing fields keep their saved values. Weights are relative, saved as percentages.
// Validation completes before the store is changed.
export function updateSelectionCriteria({ store, landlordId, input }) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    throw new CriteriaInputError(parsed.error.issues.map((issue) => ({
      field: issue.path.join(".") || "criteria", code: issue.code, message: issue.message,
    })));
  }
  input = parsed.data;
  const previous = store.getCriteria(landlordId);
  const weights = { ...previous.weights, ...input.weights };
  const largest = Math.max(...Object.values(weights));
  if (largest === 0) {
    throw new CriteriaInputError([{ field: "weights", code: "positive_total", message: "At least one weight must be above zero." }]);
  }
  const rawTotal = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  // Scale only when adding very large finite weights would overflow.
  const scale = Number.isFinite(rawTotal) ? 1 : largest;
  const total = scale === 1 ? rawTotal : Object.values(weights).reduce((sum, weight) => sum + weight / scale, 0);
  const criteria = {
    weights: input.weights === undefined ? previous.weights : Object.fromEntries(
      Object.entries(weights).map(([key, weight]) => [key, (weight / scale) / total * 100]),
    ),
    requirements: { ...previous.requirements, ...input.requirements },
  };
  store.saveCriteria(landlordId, criteria);
  return { previous, criteria };
}

// The largest share one criterion may get through adjustSelectionCriteria.
export const MAX_SHARE = 50;

// Tolerance for sums of shares that went through floating-point arithmetic.
const EPSILON = 1e-9;

const sum = (values) => values.reduce((total, value) => total + value, 0);
// A share to 1e-9 %, so that one worked out as 27.75 on paper is saved as 27.75, not
// 27.749999999999996, and rounds for the chat as the landlord would round it.
const tidy = (share) => Math.round(share * 1e9) / 1e9;
const shown = (share) => `${Math.round(share * 10) / 10} %`;

const refusal = (field, code, message) => new CriteriaInputError([{ field, code, message }]);

function parseChanges(changes) {
  const parsed = changesSchema.safeParse(changes);
  if (!parsed.success) {
    throw new CriteriaInputError(parsed.error.issues.map((issue) => ({
      field: ["changes", ...issue.path].join("."), code: issue.code, message: issue.message,
    })));
  }
  const problems = [];
  const seen = new Set();
  parsed.data.forEach(({ criterion, by, value }, index) => {
    if (by === "share" && value > 100) {
      problems.push({ field: `changes.${index}.value`, code: "too_big", message: `The share for '${criterion}' is at most 100 %.` });
    }
    if (seen.has(criterion)) {
      problems.push({ field: `changes.${index}.criterion`, code: "duplicate_criterion", message: `'${criterion}' is named more than once.` });
    }
    seen.add(criterion);
  });
  if (problems.length > 0) throw new CriteriaInputError(problems);
  return parsed.data;
}

// adjustSelectionCriteria({ store, landlordId, changes }) → { previous, criteria, applied }: the
// relative weight change of the chat ("give SCHUFA 30 % more importance"), computed in code, never
// by the model (ADR 0004).
// - changes: [{ criterion, by: "factor" | "share", value }]. A named criterion's new share is its
//   saved share × value (by "factor"), or value itself (by "share", at most 100), in % of the
//   saved criteria. The criteria not named keep their proportions and are scaled to fill the rest
//   to 100 %.
// - applied: [{ criterion, from, requested, to, capped }], unrounded.
// Limits, all checked before the store changes (CriteriaInputError otherwise):
// - a share above MAX_SHARE (50 %) is capped at it and reported as capped;
// - an unnamed share may not be pushed above MAX_SHARE (one already above it may shrink towards it:
//   the classic page's sliders have no cap);
// - the named shares may not add up to more than 100 %, and when every unnamed criterion is at 0
//   they must reach 100 % (the landlord names what fills the rest);
// - at least two criteria stay above 0 (one alone would be the whole Match score).
export function adjustSelectionCriteria({ store, landlordId, changes }) {
  const parsed = parseChanges(changes);
  const previous = store.getCriteria(landlordId);
  const savedTotal = sum(CRITERIA.map((criterion) => previous.weights[criterion]));
  const saved = Object.fromEntries(CRITERIA.map((criterion) => [criterion, (previous.weights[criterion] / savedTotal) * 100]));

  const applied = parsed.map(({ criterion, by, value }) => {
    const from = tidy(saved[criterion]);
    const requested = tidy(by === "share" ? value : from * value);
    return { criterion, from, requested, to: Math.min(requested, MAX_SHARE), capped: requested > MAX_SHARE };
  });
  const named = new Map(applied.map(({ criterion, to }) => [criterion, to]));
  const unnamed = CRITERIA.filter((criterion) => !named.has(criterion));
  const left = 100 - sum([...named.values()]);
  const rest = sum(unnamed.map((criterion) => saved[criterion]));
  if (left < -EPSILON) {
    throw refusal("changes", "over_total", `The shares named add up to ${shown(100 - left)}, more than 100 %.`);
  }
  if (rest === 0 && left > EPSILON) {
    throw refusal("changes", "rest_unfilled", `Every criterion not named is at 0 %, so nothing can fill the remaining ${shown(left)}: name the criteria that should fill it.`);
  }

  const weights = Object.fromEntries(CRITERIA.map((criterion) => [
    criterion,
    tidy(named.has(criterion) ? named.get(criterion) : rest === 0 ? 0 : Math.max(0, (saved[criterion] * left) / rest)),
  ]));
  const pushedAbove = unnamed.find((criterion) => weights[criterion] > MAX_SHARE + EPSILON && weights[criterion] > saved[criterion] + EPSILON);
  if (pushedAbove) {
    throw refusal("changes", "above_limit", `'${pushedAbove}' would rise to ${shown(weights[pushedAbove])}, above the ${MAX_SHARE} % limit: name it in the change as well.`);
  }
  if (CRITERIA.filter((criterion) => weights[criterion] > 0).length < 2) {
    throw refusal("changes", "too_few_criteria", "At least two criteria must stay above 0 %: one criterion alone would be the whole Match score.");
  }

  const criteria = { weights, requirements: previous.requirements };
  store.saveCriteria(landlordId, criteria);
  return { previous, criteria, applied };
}

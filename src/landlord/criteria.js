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

export class CriteriaInputError extends Error {
  constructor(details) {
    super("Check the selection criteria.");
    this.details = details;
  }
}

// Shared by the HTTP endpoint and, later, the update_selection_criteria chat Tool.
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

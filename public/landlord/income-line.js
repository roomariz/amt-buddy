// The minimum-income line of the Selection criteria: the rent is a fixed point on a line of
// monthly amounts, the landlord drags the minimum net household income along it. The Requirement
// it sets is the existing rent-to-income ratio (rent ÷ income).

// 0 to 5 × the rent (a third of the income for rent sits at 60 %), rounded up to the step.
export function incomeScale(rent) {
  const step = rent >= 2000 ? 50 : 10;
  return { min: 0, max: Math.ceil((rent * 5) / step) * step, step };
}

const percentOf = (amount, { min, max }) => Math.min(100, Math.max(0, ((amount - min) / (max - min)) * 100));

// Where the rent and the income sit on the line (0–100 %), the stretch between them and
// income − rent: above (left after rent), below (a shortfall) or equal.
export function incomeLineView({ rent, income }) {
  const scale = incomeScale(rent);
  const rentPercent = percentOf(rent, scale);
  const incomePercent = percentOf(income, scale);
  const difference = income - rent;
  return {
    scale,
    rentPercent,
    incomePercent,
    spanStart: Math.min(rentPercent, incomePercent),
    spanEnd: Math.max(rentPercent, incomePercent),
    difference,
    relation: difference > 0 ? "above" : difference < 0 ? "below" : "equal",
  };
}

// The form's maxRentToIncome field (a percentage) for this income: "33.3333" for 1000 of 3000.
export const ratioPercent = (rent, income) => String(Math.round((rent / income) * 100 * 10_000) / 10_000);

// The minimum income a saved ratio stands for, in whole euros.
export const incomeFromRatio = (rent, ratio) => Math.round(rent / ratio);

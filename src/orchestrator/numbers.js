// Parses a number written in German ("1.234,56", "9,20") or English ("1,234.56", "9.20")
// notation, rounded to cents. Returns null when the token is not a number.
export function parseNumber(token) {
  const hasDot = token.includes(".");
  const hasComma = token.includes(",");
  let normalised = token;
  if (hasDot && hasComma) {
    const decimal = token.lastIndexOf(".") > token.lastIndexOf(",") ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    normalised = token.split(thousands).join("").replace(decimal, ".");
  } else if (hasComma) {
    normalised = /^\d{1,3}(,\d{3})+$/.test(token) ? token.replaceAll(",", "") : token.replace(",", ".");
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(token)) {
    normalised = token.replaceAll(".", "");
  }
  if (normalised.trim() === "") return null;
  const value = Number(normalised);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

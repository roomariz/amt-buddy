// Parses a number written in German ("1.234,56", "9,20") or English ("1,234.56", "9.20")
// notation, rounded to cents. Returns null when the token is not a number.
// A group of three digits after a separator is read as thousands ("1.100" is 1100), except after a
// leading 0: "0.249" and "0,249" are decimals, since no thousands group follows a 0.
const THOUSANDS = (separator) => new RegExp(`^(?!0\\${separator})\\d{1,3}(\\${separator}\\d{3})+$`);
export function parseNumber(token) {
  const hasDot = token.includes(".");
  const hasComma = token.includes(",");
  let normalised = token;
  if (hasDot && hasComma) {
    const decimal = token.lastIndexOf(".") > token.lastIndexOf(",") ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    normalised = token.split(thousands).join("").replace(decimal, ".");
  } else if (hasComma) {
    normalised = THOUSANDS(",").test(token) ? token.replaceAll(",", "") : token.replace(",", ".");
  } else if (hasDot && THOUSANDS(".").test(token)) {
    normalised = token.replaceAll(".", "");
  }
  if (normalised.trim() === "") return null;
  const value = Number(normalised);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

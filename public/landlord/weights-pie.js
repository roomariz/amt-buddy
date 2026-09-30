// The weights pie on the chat-first page, under "At a glance": the saved shares of the Selection
// criteria as a pie with a legend, the criteria not counted yet muted, and the landlord's bonus
// beside it. Plain data and an SVG string (no DOM), so it is tested without a browser.

import { t } from "../i18n.js";
import { CRITERIA, formatNumber } from "./ranking.js";

// Colours for an SVG drawn outside the page's stylesheet; on the page the --pie-<criterion> tokens
// in styles.css win (they have a dark variant). The six categorical slots of the dataviz reference
// palette, in criteria order, which it validates for colour-blind separation between neighbours;
// documents, credibility and employment in their darker steps, which reach 3:1 against white.
const FALLBACK_COLOURS = {
  affordability: "#2a78d6",
  schufa: "#eb6834",
  documents: "#199e70",
  credibility: "#c98500",
  employment: "#d55181",
  previousLandlord: "#008300",
};

// { criteria: { weights }, inactive, bonusPoints } (the overview's) → { slices, legend, bonusText,
// ariaLabel }. The saved weights, not the active ones: the landlord sees what they chose, and a
// criterion that waits for a flat fact keeps its slice, muted, with a `hint` saying what would make
// it count (null for a counted one). Weights are drawn as shares of their
// sum, since the saved ones are rounded to one decimal and need not add up to exactly 100.
export function weightsPie({ criteria: { weights }, inactive = [], bonusPoints = 5 }) {
  const waiting = new Set(inactive.map((entry) => entry.criterion).filter(Boolean));
  const shown = CRITERIA.filter((criterion) => weights[criterion] > 0);
  const total = shown.reduce((sum, criterion) => sum + weights[criterion], 0);

  // Angles from the running sum of weights (× 360 / total) rather than by adding share × 3.6, so
  // whole-number weights give exact angles and the last slice ends at exactly 360.
  let before = 0;
  const slices = shown.map((criterion) => {
    const weight = weights[criterion];
    const slice = {
      criterion,
      label: t(`landlord.ranking.criteria.${criterion}`),
      share: (weight * 100) / total,
      counted: !waiting.has(criterion),
      startAngle: (before * 360) / total,
      endAngle: ((before + weight) * 360) / total,
    };
    before += weight;
    return slice;
  });

  const legend = [...slices]
    .sort((a, b) => b.share - a.share || CRITERIA.indexOf(a.criterion) - CRITERIA.indexOf(b.criterion))
    .map(({ criterion, label, share, counted }) => {
      const text = t("landlordChat.weightShare", { criterion: label, share: formatNumber(share) });
      if (counted) return { criterion, text, counted, hint: null };
      return { criterion, text: `${text} – ${t("landlordChat.notCounted")}`, counted, hint: t(`landlordChat.notCountedHint.${criterion}`) };
    });

  return {
    slices,
    legend,
    bonusText: t("landlordChat.bonusLegend", { points: formatNumber(bonusPoints) }),
    ariaLabel: t("landlordChat.weightsLabel"),
  };
}

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const coordinate = (value) => String(Number(value.toFixed(3)));

// The point on the circle at `angle` degrees, clockwise from 12 o'clock.
function pointAt(centre, radius, angle) {
  const radians = (angle * Math.PI) / 180;
  return `${coordinate(centre + radius * Math.sin(radians))} ${coordinate(centre - radius * Math.cos(radians))}`;
}

// The pie from weightsPie → an <svg> string for innerHTML. Only numbers and escaped texts go in.
// Each slice has its legend text as a <title> (the hover tooltip), a muted one followed by its hint;
// screen readers get the svg's
// label and the legend list beside it. The slices' outline in the surface colour (styles.css)
// leaves a gap between neighbours, which also separates two colours that are close.
export function weightsPieSvg(pie, { size = 120 } = {}) {
  const centre = size / 2;
  const radius = size / 2 - 1;
  const titles = new Map(pie.legend.map(({ criterion, text, hint }) => [criterion, hint ? `${text}. ${hint}` : text]));
  const shapes = pie.slices.map(({ criterion, counted, startAngle, endAngle }) => {
    const attributes = `data-criterion="${escape(criterion)}" class="lc-pie-slice${counted ? "" : " is-muted"}" fill="${FALLBACK_COLOURS[criterion] ?? "#888888"}"`;
    const title = `<title>${escape(titles.get(criterion) ?? criterion)}</title>`;
    // An arc from a point to itself draws nothing, so a lone slice is a circle.
    if (endAngle - startAngle >= 360) return `<circle ${attributes} cx="${coordinate(centre)}" cy="${coordinate(centre)}" r="${coordinate(radius)}">${title}</circle>`;
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    const d = `M ${coordinate(centre)} ${coordinate(centre)} L ${pointAt(centre, radius, startAngle)} A ${coordinate(radius)} ${coordinate(radius)} 0 ${largeArc} 1 ${pointAt(centre, radius, endAngle)} Z`;
    return `<path ${attributes} d="${d}">${title}</path>`;
  });
  return `<svg role="img" aria-label="${escape(pie.ariaLabel)}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">${shapes.join("")}</svg>`;
}

// The generic applicant avatars of the chat-first /landlord page, as inline SVG strings. They show
// the household's shape only — never gender: the pool records it, but the AGG protects it, so the
// figures carry no hair, clothing or other features that could read as one.

import { t } from "../i18n.js";

export const AVATAR_SHAPES = ["single", "couple", "family", "group"];

// One figure, a head and rounded shoulders, drawn around its own origin and placed by `transform`.
// The background-coloured stroke keeps overlapping figures apart.
const person = (x, y, scale) =>
  `<g transform="translate(${x} ${y}) scale(${scale})" fill="var(--avatar-fg, currentColor)" ` +
  `stroke="var(--avatar-bg, #e8eef7)" stroke-width="${+(1.5 / scale).toFixed(2)}">` +
  `<circle cx="0" cy="-8" r="6"/><path d="M-11 14V11a11 11 0 0 1 22 0V14z"/></g>`;

const FIGURES = {
  single: person(24, 24, 1.2),
  couple: person(14.5, 25, 0.85) + person(33.5, 25, 0.85),
  // Two adults with the smaller child in front of them.
  family: person(15, 21, 0.8) + person(33, 21, 0.8) + person(24, 32, 0.6),
  // Three adults, one behind the other two.
  group: person(24, 19, 0.7) + person(14, 27, 0.75) + person(34, 27, 0.75),
};

const escapeAttribute = (text) =>
  String(text).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// An unknown shape is drawn as the single adult. The label is looked up at render time, so it
// follows the page language.
export function avatarSvg(shape, { size = 48 } = {}) {
  const known = AVATAR_SHAPES.includes(shape) ? shape : "single";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeAttribute(t(`landlordChat.avatar.${known}`))}" ` +
    `data-shape="${known}" width="${size}" height="${size}" viewBox="0 0 48 48">` +
    `<circle cx="24" cy="24" r="24" fill="var(--avatar-bg, #e8eef7)"/>${FIGURES[known]}</svg>`
  );
}

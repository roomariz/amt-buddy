import test from "node:test";
import assert from "node:assert/strict";

class FakeNode {
  constructor() {
    this.hidden = false;
    this.textContent = "";
    this.listeners = new Map();
    this.elements = new Proxy({}, { get: () => ({ value: "" }) });
  }

  addEventListener(type, listener) { this.listeners.set(type, listener); }
  querySelectorAll() { return []; }
  replaceChildren() { this.textContent = ""; }
  focus() { this.focused = true; }
  click() { this.listeners.get("click")?.({ preventDefault() {} }); }
}

test("closing and signing out clear applicant details from the page DOM", async (t) => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, new FakeNode());
    return nodes.get(selector);
  };
  let signedOut = false;
  globalThis.document = {
    documentElement: { lang: "de" },
    querySelector: node,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  globalThis.window = { localStorage: { getItem: () => null, removeItem: () => { signedOut = true; } } };
  t.after(() => {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  });
  await import("../../public/landlord.js");

  const section = node("#applicant-detail");
  const body = node("#applicant-detail-body");
  const title = node("#applicant-detail-title");
  const status = node("#applicant-detail-status");
  const seedSensitiveContent = () => {
    section.hidden = false;
    body.textContent = "ada@example.org · €3,500 · SCHUFA";
    title.textContent = "Ada Beispiel";
    status.textContent = "Ada Beispiel's profile";
    status.hidden = false;
  };
  const assertCleared = () => {
    assert.equal(section.hidden, true);
    assert.equal(body.textContent, "");
    assert.equal(title.textContent, "");
    assert.equal(status.textContent, "");
    assert.equal(status.hidden, true);
  };

  seedSensitiveContent();
  node("#applicant-detail-close").click();
  assertCleared();

  seedSensitiveContent();
  node("#btn-sign-out").click();
  assertCleared();
  assert.equal(signedOut, true);
});

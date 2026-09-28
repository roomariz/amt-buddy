import test from "node:test";
import assert from "node:assert/strict";

import {
  CHATBOT_TOOLS,
  getToolSchemas,
  executeTool,
} from "../src/chatbot-tools.js";

import {
  classifyIntent,
  processChat,
  registerChatModelProvider,
  resetChatModelProvider,
} from "../src/chatbot-orchestrator.js";

test("returns standardized tool schemas for LLM function calling", () => {
  const schemas = getToolSchemas();
  assert.ok(Array.isArray(schemas));
  assert.ok(schemas.length >= 4);

  const toolNames = schemas.map((s) => s.name);
  assert.ok(toolNames.includes("validate_berlin_address"));
  assert.ok(toolNames.includes("calculate_mietspiegel"));
  assert.ok(toolNames.includes("assess_occupancy_compliance"));
  assert.ok(toolNames.includes("extract_document_ocr"));
});

test("executes calculate_mietspiegel tool successfully", async () => {
  const res = await executeTool("calculate_mietspiegel", {
    residentialLocation: "gut",
    buildingAgeOrYear: "1919–1949",
    livingAreaSqm: 50,
    contractRent: 500,
  });

  assert.equal(res.success, true);
  assert.equal(res.result.status, "calculated");
  assert.equal(res.result.field, "D4");
  assert.equal(res.result.contractRentComparison.status, "within");
});

test("executes assess_occupancy_compliance tool successfully", async () => {
  const res = await executeTool("assess_occupancy_compliance", {
    livingAreaSqm: 50,
    rooms: 2,
    occupants: 2,
    childrenUpToSix: 0,
  });

  assert.equal(res.success, true);
  assert.equal(res.result.status, "meets_minimum");
  assert.equal(res.result.requiredAreaSqm, 18);
  assert.equal(res.result.areaMarginSqm, 32);
});

test("classifies user query intents accurately", () => {
  assert.equal(classifyIntent("Hallo, wie kannst du mir helfen?"), "greeting");
  assert.equal(classifyIntent("Prüfe bitte Pariser Platz 1, 10117 Berlin"), "address_verification");
  assert.equal(classifyIntent("Was ist der Mietspiegel für 60 m² in guter Wohnlage?"), "mietspiegel_check");
  assert.equal(classifyIntent("Dürfen 3 Personen in 20 m² wohnen? Überbelegung"), "occupancy_check");
  assert.equal(classifyIntent("Hier ist mein Mietvertrag zur Prüfung"), "document_analysis");
});

test("orchestrator answers greeting with suggestions", async () => {
  const response = await processChat({ message: "Hallo" });
  assert.equal(response.intent, "greeting");
  assert.ok(response.reply.includes("Amt-Buddy Assistent"));
  assert.ok(response.suggestions.length > 0);
});

test("orchestrator handles Mietspiegel query and runs calculate_mietspiegel", async () => {
  const response = await processChat({
    message: "Was ist der Mietspiegel für 50 m² in guter Wohnlage, Baujahr 1935, Kaltmiete 500 €?",
  });

  assert.equal(response.intent, "mietspiegel_check");
  assert.equal(response.toolCalls.length, 1);
  assert.equal(response.toolCalls[0].name, "calculate_mietspiegel");
  assert.equal(response.toolCalls[0].success, true);
  assert.ok(response.reply.includes("Berliner Mietspiegel 2026"));
  assert.ok(response.reply.includes("D4"));
});

test("orchestrator handles occupancy compliance query and runs assess_occupancy_compliance", async () => {
  const response = await processChat({
    message: "Sind 30 m² mit 2 Zimmer für 3 Personen zulässig?",
  });

  assert.equal(response.intent, "occupancy_check");
  assert.equal(response.toolCalls.length, 1);
  assert.equal(response.toolCalls[0].name, "assess_occupancy_compliance");
  assert.equal(response.toolCalls[0].success, true);
  assert.ok(response.reply.includes("§ 7 Abs. 1 WoAufG Bln"));
});

test("orchestrator analyzes lease document text", async () => {
  const sampleLease = `
    Mietvertrag
    Wohnung: Berliner Straße 155, 10715 Berlin
    Wohnfläche: 50 m²
    Nettokaltmiete: 600 €
    Baujahr: 1955
    2 Zimmer
  `;

  const response = await processChat({
    message: sampleLease,
    context: { hasFile: true },
  });

  assert.equal(response.intent, "document_analysis");
  assert.equal(response.toolCalls.length, 1);
  assert.equal(response.toolCalls[0].name, "extract_document_ocr");
  assert.ok(response.reply.includes("Mietvertrags-Analyse per OCR"));
  assert.ok(response.reply.includes("Berliner Straße 155"));
  assert.ok(response.reply.includes("600 €"));
});

test("orchestrator supports custom LLM provider override", async () => {
  registerChatModelProvider(async ({ message }) => {
    return {
      reply: `Mocked LLM reply for: ${message}`,
      intent: "custom_llm",
      toolCalls: [],
      suggestions: ["Custom suggestion"],
    };
  });

  try {
    const res = await processChat({ message: "Test query" });
    assert.equal(res.intent, "custom_llm");
    assert.equal(res.reply, "Mocked LLM reply for: Test query");
  } finally {
    resetChatModelProvider();
  }
});

test("dedicated chatbot static files exist and include guided workflow elements", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { join } = await import("node:path");

  const chatbotHtml = await readFile(
    fileURLToPath(new URL("../public/chatbot.html", import.meta.url)),
    "utf8",
  );
  assert.ok(chatbotHtml.includes("Amt-Buddy Chatbot"));
  assert.ok(chatbotHtml.includes("Geführter Modus"));
  assert.ok(chatbotHtml.includes('src="/chatbot.js"'));

  const chatbotJs = await readFile(
    fileURLToPath(new URL("../public/chatbot.js", import.meta.url)),
    "utf8",
  );
  assert.ok(chatbotJs.includes("verifyAddressFlow"));
  assert.ok(chatbotJs.includes("runMietspiegelCalculation"));
  assert.ok(chatbotJs.includes("runOccupancyCalculation"));
});


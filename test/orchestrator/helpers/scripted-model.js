import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";

let nextCallId = 0;

// A fake chat model that replays a script, one entry per model call:
// - a string        → an AIMessage with that text
// - { toolCalls }   → an AIMessage calling those tools: [{ name, args }]
// - any other object → the parsed result of withStructuredOutput()
// Every call's input messages are recorded in `calls`.
export class ScriptedChatModel extends BaseChatModel {
  constructor(script) {
    super({});
    this.script = [...script];
    this.calls = [];
  }

  _llmType() {
    return "scripted";
  }

  bindTools() {
    return this;
  }

  withStructuredOutput() {
    return RunnableLambda.from(async (messages) => {
      this.calls.push(messages);
      return this.#next();
    });
  }

  async _generate(messages) {
    this.calls.push(messages);
    const entry = this.#next();
    const message =
      typeof entry === "string"
        ? new AIMessage(entry)
        : new AIMessage({
            content: "",
            tool_calls: entry.toolCalls.map(({ name, args }) => ({ id: `call_${++nextCallId}`, name, args })),
          });
    return { generations: [{ message, text: typeof entry === "string" ? entry : "" }] };
  }

  get remaining() {
    return this.script.length;
  }

  #next() {
    if (this.script.length === 0) throw new Error("ScriptedChatModel ran out of scripted responses");
    return this.script.shift();
  }
}

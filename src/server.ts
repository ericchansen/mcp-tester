#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createStdioTap } from "./logger.js";

const LOG_PATH = process.env.LOG_PATH ?? "./mcp-tester-server.log.jsonl";

type Phase = "alpha" | "beta";
const state: Record<string, Phase> = {
  tools: "alpha",
  resources: "alpha",
  prompts: "alpha",
};

// Handles stored at registration for later removal
let alphaToolHandle: { remove: () => void } | null = null;
let alphaResourceHandle: { remove: () => void } | null = null;
let alphaPromptHandle: { remove: () => void } | null = null;

// Install stdio tap BEFORE creating transport
const { tappedInput, tappedOutput, flush } = createStdioTap(LOG_PATH);

const server = new McpServer(
  { name: "mcp-tester", version: "0.1.0" },
  {
    // Coalesce remove+register into a single notification per tick
    debouncedNotificationMethods: [
      "notifications/tools/list_changed",
      "notifications/resources/list_changed",
      "notifications/prompts/list_changed",
    ],
  },
);

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

// Alpha probe tool
alphaToolHandle = server.tool(
  "mcptester_probe_alpha",
  "Returns a unique alpha confirmation. Call this to verify the server's initial state.",
  async () => ({
    content: [{ type: "text", text: `alpha called at ${new Date().toISOString()}` }],
  }),
);

// Mutate tools trigger
server.tool(
  "mcptester_mutate_tools",
  "Mutates the tool list: removes mcptester_probe_alpha, registers mcptester_probe_beta, sends notifications/tools/list_changed.",
  async () => {
    if (state.tools === "beta") {
      return {
        content: [{ type: "text", text: "Tools already mutated to beta state." }],
        isError: true,
      };
    }

    alphaToolHandle?.remove();
    alphaToolHandle = null;

    // SDK auto-sends notifications/tools/list_changed on both remove() and
    // registerTool(). debouncedNotificationMethods coalesces them into one.
    server.tool(
      "mcptester_probe_beta",
      "Returns a unique beta confirmation. This tool only exists after mutation.",
      async () => ({
        content: [{ type: "text", text: `beta called at ${new Date().toISOString()}` }],
      }),
    );

    state.tools = "beta";

    return {
      content: [{
        type: "text",
        text: `Tools mutated at ${new Date().toISOString()}. ` +
          "mcptester_probe_alpha removed, mcptester_probe_beta registered. " +
          "notifications/tools/list_changed sent (auto by SDK). " +
          "Now ask the agent to call mcptester_probe_beta.",
      }],
    };
  },
);

// Mutate resources trigger
server.tool(
  "mcptester_mutate_resources",
  "Mutates resources: removes resource probe://alpha, registers probe://beta, sends notifications/resources/list_changed.",
  async () => {
    if (state.resources === "beta") {
      return {
        content: [{ type: "text", text: "Resources already mutated to beta state." }],
        isError: true,
      };
    }

    alphaResourceHandle?.remove();
    alphaResourceHandle = null;

    server.resource(
      "probe-beta",
      "probe://beta",
      { description: "Beta probe resource (registered after mutation)" },
      async () => ({
        contents: [{ uri: "probe://beta", text: "I am the beta resource" }],
      }),
    );

    state.resources = "beta";

    return {
      content: [{
        type: "text",
        text: `Resources mutated at ${new Date().toISOString()}. ` +
          "probe://alpha removed, probe://beta registered. " +
          "notifications/resources/list_changed sent (auto by SDK). " +
          "Now ask the agent to read probe://beta.",
      }],
    };
  },
);

// Mutate prompts trigger
server.tool(
  "mcptester_mutate_prompts",
  "Mutates prompts: removes prompt mcptester_alpha_prompt, registers mcptester_beta_prompt, sends notifications/prompts/list_changed.",
  async () => {
    if (state.prompts === "beta") {
      return {
        content: [{ type: "text", text: "Prompts already mutated to beta state." }],
        isError: true,
      };
    }

    alphaPromptHandle?.remove();
    alphaPromptHandle = null;

    server.prompt(
      "mcptester_beta_prompt",
      "Beta probe prompt (registered after mutation)",
      async () => ({
        messages: [{
          role: "user",
          content: { type: "text", text: "Tell me about beta" },
        }],
      }),
    );

    state.prompts = "beta";

    return {
      content: [{
        type: "text",
        text: `Prompts mutated at ${new Date().toISOString()}. ` +
          "mcptester_alpha_prompt removed, mcptester_beta_prompt registered. " +
          "notifications/prompts/list_changed sent (auto by SDK). " +
          "Now ask the agent to use mcptester_beta_prompt.",
      }],
    };
  },
);

// Status tool
server.tool(
  "mcptester_status",
  "Returns the server's current internal state (which items are registered in each domain).",
  async () => ({
    content: [{ type: "text", text: JSON.stringify(state, null, 2) }],
  }),
);

// ---------------------------------------------------------------------------
// Resources (alpha)
// ---------------------------------------------------------------------------

alphaResourceHandle = server.resource(
  "probe-alpha",
  "probe://alpha",
  { description: "Alpha probe resource (initial state)" },
  async () => ({
    contents: [{ uri: "probe://alpha", text: "I am the alpha resource" }],
  }),
);

// ---------------------------------------------------------------------------
// Prompts (alpha)
// ---------------------------------------------------------------------------

alphaPromptHandle = server.prompt(
  "mcptester_alpha_prompt",
  "Alpha probe prompt (initial state)",
  async () => ({
    messages: [{
      role: "user",
      content: { type: "text", text: "Tell me about alpha" },
    }],
  }),
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport(tappedInput, tappedOutput);

process.on("SIGINT", () => {
  flush();
  process.exit(0);
});
process.on("SIGTERM", () => {
  flush();
  process.exit(0);
});

await server.connect(transport);
process.stderr.write(`mcp-tester server started. Logging to ${LOG_PATH}\n`);

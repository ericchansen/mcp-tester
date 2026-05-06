#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function log(msg: string): void {
  process.stderr.write(`[driver] ${msg}\n`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Run analyzer inline
// ---------------------------------------------------------------------------

function runAnalyzer(logPath: string, domain: string): string {
  // Re-use the analyze module's logic by reading and parsing the log directly
  const text = readFileSync(logPath, "utf-8");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  log(`Analyzer: ${lines.length} log entries for domain=${domain}`);
  return `(See full analysis by running: node dist/analyze.js ${logPath} --domain ${domain})`;
}

// ---------------------------------------------------------------------------
// Domain test protocols
// ---------------------------------------------------------------------------

async function testTools(client: Client, logPath: string): Promise<void> {
  log("=== TOOLS DOMAIN TEST ===");

  // Step 1: List tools
  log("Listing tools...");
  const toolsList = await client.listTools();
  const toolNames = toolsList.tools.map((t) => t.name);
  log(`Initial tools: ${toolNames.join(", ")}`);

  // Step 2: Call alpha
  log("Calling mcptester_probe_alpha...");
  const alphaResult = await client.callTool({
    name: "mcptester_probe_alpha",
    arguments: {},
  });
  log(
    `Alpha result: ${(alphaResult.content as Array<{ text: string }>)[0]?.text}`,
  );

  // Step 3: Call mutate
  log("Calling mcptester_mutate_tools...");
  const mutateResult = await client.callTool({
    name: "mcptester_mutate_tools",
    arguments: {},
  });
  log(
    `Mutate result: ${(mutateResult.content as Array<{ text: string }>)[0]?.text}`,
  );

  // Give debounced notification time to send
  await sleep(200);

  // Step 4: Re-list tools
  log("Re-listing tools after mutation...");
  const toolsList2 = await client.listTools();
  const toolNames2 = toolsList2.tools.map((t) => t.name);
  log(`Post-mutation tools: ${toolNames2.join(", ")}`);

  // Step 5: Call beta
  log("Calling mcptester_probe_beta...");
  const betaResult = await client.callTool({
    name: "mcptester_probe_beta",
    arguments: {},
  });
  log(
    `Beta result: ${(betaResult.content as Array<{ text: string }>)[0]?.text}`,
  );

  // Step 6: Call alpha (should be removed)
  log("Calling mcptester_probe_alpha (should be removed)...");
  const alphaAfter = await client.callTool({
    name: "mcptester_probe_alpha",
    arguments: {},
  });
  if (alphaAfter.isError) {
    log(`Alpha after removal: ERROR (expected) - ${(alphaAfter.content as Array<{ text: string }>)[0]?.text}`);
  } else {
    log(
      `Alpha after removal: SUCCEEDED (unexpected!) - ${(alphaAfter.content as Array<{ text: string }>)[0]?.text}`,
    );
  }

  // Step 7: Status
  log("Calling mcptester_status...");
  const status = await client.callTool({
    name: "mcptester_status",
    arguments: {},
  });
  log(
    `Status: ${(status.content as Array<{ text: string }>)[0]?.text}`,
  );

  log(`Tools test complete. Log: ${logPath}`);
}

async function testResources(
  client: Client,
  logPath: string,
): Promise<void> {
  log("=== RESOURCES DOMAIN TEST ===");

  // Step 1: List resources
  log("Listing resources...");
  const resList = await client.listResources();
  log(
    `Initial resources: ${resList.resources.map((r) => r.uri).join(", ")}`,
  );

  // Step 2: Read alpha
  log("Reading probe://alpha...");
  const alphaRead = await client.readResource({ uri: "probe://alpha" });
  log(
    `Alpha resource: ${(alphaRead.contents[0] as { text: string }).text}`,
  );

  // Step 3: Mutate
  log("Calling mcptester_mutate_resources...");
  const mutateResult = await client.callTool({
    name: "mcptester_mutate_resources",
    arguments: {},
  });
  log(
    `Mutate result: ${(mutateResult.content as Array<{ text: string }>)[0]?.text}`,
  );

  await sleep(200);

  // Step 4: Re-list
  log("Re-listing resources...");
  const resList2 = await client.listResources();
  log(
    `Post-mutation resources: ${resList2.resources.map((r) => r.uri).join(", ")}`,
  );

  // Step 5: Read beta
  log("Reading probe://beta...");
  const betaRead = await client.readResource({ uri: "probe://beta" });
  log(
    `Beta resource: ${(betaRead.contents[0] as { text: string }).text}`,
  );

  // Step 6: Try to read alpha (should fail)
  log("Reading probe://alpha (should fail)...");
  try {
    await client.readResource({ uri: "probe://alpha" });
    log("Alpha after removal: SUCCEEDED (unexpected!)");
  } catch (err) {
    log(
      `Alpha after removal: ERROR (expected) - ${(err as Error).message}`,
    );
  }

  log(`Resources test complete. Log: ${logPath}`);
}

async function testPrompts(
  client: Client,
  logPath: string,
): Promise<void> {
  log("=== PROMPTS DOMAIN TEST ===");

  // Step 1: List prompts
  log("Listing prompts...");
  const promptList = await client.listPrompts();
  log(
    `Initial prompts: ${promptList.prompts.map((p) => p.name).join(", ")}`,
  );

  // Step 2: Get alpha prompt
  log("Getting mcptester_alpha_prompt...");
  const alphaPrompt = await client.getPrompt({
    name: "mcptester_alpha_prompt",
  });
  log(
    `Alpha prompt message: ${(alphaPrompt.messages[0].content as { text: string }).text}`,
  );

  // Step 3: Mutate
  log("Calling mcptester_mutate_prompts...");
  const mutateResult = await client.callTool({
    name: "mcptester_mutate_prompts",
    arguments: {},
  });
  log(
    `Mutate result: ${(mutateResult.content as Array<{ text: string }>)[0]?.text}`,
  );

  await sleep(200);

  // Step 4: Re-list
  log("Re-listing prompts...");
  const promptList2 = await client.listPrompts();
  log(
    `Post-mutation prompts: ${promptList2.prompts.map((p) => p.name).join(", ")}`,
  );

  // Step 5: Get beta prompt
  log("Getting mcptester_beta_prompt...");
  const betaPrompt = await client.getPrompt({
    name: "mcptester_beta_prompt",
  });
  log(
    `Beta prompt message: ${(betaPrompt.messages[0].content as { text: string }).text}`,
  );

  // Step 6: Try to get alpha (should fail)
  log("Getting mcptester_alpha_prompt (should fail)...");
  try {
    await client.getPrompt({ name: "mcptester_alpha_prompt" });
    log("Alpha after removal: SUCCEEDED (unexpected!)");
  } catch (err) {
    log(
      `Alpha after removal: ERROR (expected) - ${(err as Error).message}`,
    );
  }

  log(`Prompts test complete. Log: ${logPath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const domainArg =
  args
    .find((a) => a.startsWith("--domain="))
    ?.split("=")[1] ??
  args[args.indexOf("--domain") + 1] ??
  "all";

const domains =
  domainArg === "all"
    ? ["tools", "resources", "prompts"]
    : [domainArg];

const serverScript = resolve(__dirname, "server.js");

for (const domain of domains) {
  const logPath = resolve(`./driver-${domain}-${stamp()}.log.jsonl`);
  log(`\n--- Testing domain: ${domain} ---`);
  log(`Server: ${serverScript}`);
  log(`Log: ${logPath}`);

  // Build clean env (filter out undefined values for strict typing)
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  env.LOG_PATH = logPath;

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverScript],
    env,
  });

  const client = new Client(
    { name: "mcp-tester-driver", version: "0.1.0" },
    { capabilities: {} },
  );

  await client.connect(transport);
  log("Connected to server");

  try {
    switch (domain) {
      case "tools":
        await testTools(client, logPath);
        break;
      case "resources":
        await testResources(client, logPath);
        break;
      case "prompts":
        await testPrompts(client, logPath);
        break;
      default:
        log(`Unknown domain: ${domain}`);
    }
  } catch (err) {
    log(`ERROR in ${domain} test: ${(err as Error).message}`);
    log((err as Error).stack ?? "");
  }

  // Clean shutdown
  await client.close();
  log("Client closed");

  // Small delay for log flush
  await sleep(500);

  // Print analyzer hint
  log(`\nTo analyze: node dist/analyze.js ${logPath} --domain ${domain}`);
  runAnalyzer(logPath, domain);
}

log("\n=== All domain tests complete ===");

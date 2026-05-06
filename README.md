# mcp-tester

Instrumented MCP server for testing client conformance to `*/list_changed` notifications and other protocol features.

## Why

[PR mcaps-microsoft/msx-mcp#321](https://github.com/mcaps-microsoft/msx-mcp/pull/321) proposed dynamic tool surfacing via `notifications/tools/list_changed`. The PR was closed with the claim that "Copilot CLI caches `tools/list` at session start and ignores `notifications/tools/list_changed`" -- but no instrumented experiment was ever run to prove or disprove this.

This repo provides the apparatus to test that claim -- and any MCP client's conformance to `list_changed` -- with real evidence.

## What It Does

1. **Probe MCP Server** (`src/server.ts`) -- A self-instrumenting MCP server that logs every JSON-RPC message on its stdio pipe. It exposes alpha-state tools, resources, and prompts, plus trigger tools that swap them to beta-state and send the corresponding `*/list_changed` notification.

2. **Automated Client Driver** (`src/driver.ts`) -- An SDK-based MCP `Client` that drives the server through the full mutation cycle. This is the **control**: it proves the protocol works when both endpoints honor the spec. Any client that diverges from this behavior is provably non-conformant.

3. **Log Analyzer** (`src/analyze.ts`) -- Reads the JSONL log and emits a markdown evidence table answering specific questions: Did the client receive the notification? Did it re-fetch? Can it call the new item? Can it still call the removed item?

4. **Human Protocol** (`PROTOCOL.md`) -- Step-by-step instructions for running the same test against Copilot CLI or any other MCP client.

## Quick Start

```bash
git clone https://github.com/ericchansen/mcp-tester.git
cd mcp-tester
npm install
npm run build
```

### Run the automated control (SDK client)

```bash
npm run driver -- --domain all
```

This spawns the probe server, runs the full mutation protocol for tools, resources, and prompts, and reports results. You should see all three domains pass with full conformance.

### Analyze a log

```bash
npm run analyze -- path/to/log.jsonl --domain tools
```

## Testing Your Own MCP Client

See [PROTOCOL.md](PROTOCOL.md) for step-by-step instructions on testing Copilot CLI or any other MCP client against this probe.

## Repo Layout

```
mcp-tester/
|-- README.md          # This file
|-- PROTOCOL.md        # Human-driven test procedure
|-- LICENSE            # MIT
|-- package.json
|-- tsconfig.json
|-- src/
|   |-- server.ts      # Probe MCP server (stdio)
|   |-- logger.ts      # JSONL stdio tap + log writer
|   |-- analyze.ts     # CLI: parses log -> markdown evidence table
|   +-- driver.ts      # CLI: spawns server, drives it via SDK Client
+-- results/
    +-- copilot-cli/
        +-- .gitkeep   # Committed experiment results go here
```

## How the Probe Works

### Initial State (Alpha)

| Domain    | Alpha Item                   |
|-----------|------------------------------|
| Tools     | `mcptester_probe_alpha`      |
| Resources | `probe://alpha`              |
| Prompts   | `mcptester_alpha_prompt`     |

Plus five permanent tools: `mcptester_mutate_tools`, `mcptester_mutate_resources`, `mcptester_mutate_prompts`, `mcptester_status`.

### After Mutation (Beta)

When a `mcptester_mutate_*` tool is called:

1. The alpha item is removed (via SDK `handle.remove()`)
2. The beta item is registered
3. The SDK auto-sends the corresponding `notifications/*/list_changed`
4. `debouncedNotificationMethods` coalesces remove + register into a single notification

| Domain    | Beta Item                    |
|-----------|------------------------------|
| Tools     | `mcptester_probe_beta`       |
| Resources | `probe://beta`               |
| Prompts   | `mcptester_beta_prompt`      |

### Logging

Every JSON-RPC message (inbound and outbound) is logged to a JSONL file. The logger taps `process.stdin` and `process.stdout` via Transform streams installed before the SDK transport, so it sees every byte without interfering with the protocol.

## Limitations

- **stdio transport only** -- no HTTP/SSE testing yet
- **Three `list_changed` flows only** -- future tests planned for sampling, elicitation, roots, progress, completions
- **Single-server testing** -- tests one MCP server connection at a time

## License

MIT

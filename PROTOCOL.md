# Test Protocol: MCP `list_changed` Conformance

Step-by-step procedure for testing whether an MCP client honors `notifications/tools/list_changed`, `notifications/resources/list_changed`, and `notifications/prompts/list_changed`.

Written for Copilot CLI but generalizable to any MCP client.

## Prerequisites

- Node >= 20
- This repo cloned and built: `npm install && npm run build`
- Your MCP client installed (e.g., Copilot CLI)
- Run `npm run driver -- --domain all` first to confirm the apparatus works (the automated control must pass before human testing has scientific value)

## 1. Configure MCP Server

Add the probe server to your MCP client's config.

### Copilot CLI (`~/.copilot/config/mcp-config.json`)

```json
{
  "mcpServers": {
    "mcp-tester": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-tester/dist/server.js"],
      "env": {
        "LOG_PATH": "/absolute/path/to/mcp-tester/results/copilot-cli/session.log.jsonl"
      }
    }
  }
}
```

Replace `/absolute/path/to/mcp-tester` with the actual path on your machine.

### VS Code (`.vscode/mcp.json`)

```json
{
  "servers": {
    "mcp-tester": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-tester/dist/server.js"],
      "env": {
        "LOG_PATH": "/absolute/path/to/mcp-tester/results/copilot-cli/session.log.jsonl"
      }
    }
  }
}
```

## 2. Reset Between Runs

Before each test:

1. Delete the log file: `rm results/copilot-cli/session.log.jsonl`
2. Restart your MCP client (new session) to get a clean `initialize` handshake

## 3. Run the Tools Test

Start a fresh client session. Enter the following prompts one at a time:

| Step | Prompt | Purpose |
|------|--------|---------|
| 1 | `Call mcptester_status.` | Verify connection; should show all domains as "alpha" |
| 2 | `Call mcptester_probe_alpha.` | Baseline: confirm alpha tool works |
| 3 | `Call mcptester_mutate_tools.` | Trigger: removes alpha tool, registers beta, sends notification |
| 4 | `Call mcptester_probe_beta.` | Test: can the client call the NEW tool? |
| 5 | (New prompt) `Call mcptester_probe_beta.` | Cross-turn test: does it work on the next turn? |
| 6 | `Call mcptester_probe_alpha.` | Test: does the client still try the REMOVED tool? |
| 7 | `Call mcptester_status.` | Verify: server state should show tools as "beta" |

## 4. Run the Resources Test

Restart client. Delete old log. Enter prompts:

| Step | Prompt | Purpose |
|------|--------|---------|
| 1 | `Call mcptester_status.` | Verify connection |
| 2 | (Attach resource `probe://alpha` if your client supports it, or ask the agent to read it) | Baseline |
| 3 | `Call mcptester_mutate_resources.` | Trigger mutation |
| 4 | (Attach resource `probe://beta` or ask agent to read it) | Test: can client read the NEW resource? |
| 5 | (Try to read `probe://alpha` again) | Test: does client still offer the REMOVED resource? |

**Note:** Resource testing depends on your client's UX for resource attachment. Some clients expose resources as attachable context; others require tool-based reading. Document which path you used.

## 5. Run the Prompts Test

Restart client. Delete old log. Enter prompts:

| Step | Prompt | Purpose |
|------|--------|---------|
| 1 | Check if `mcptester_alpha_prompt` appears in your slash-command list or prompt picker | Baseline |
| 2 | `Call mcptester_mutate_prompts.` | Trigger mutation |
| 3 | Check if `mcptester_beta_prompt` appears in your slash-command list | Test: new prompt visible? |
| 4 | Check if `mcptester_alpha_prompt` still appears | Test: removed prompt gone? |

**Note:** Prompt testing may be limited if your client doesn't expose prompts in its UI.

## 6. Analyze Results

```bash
node dist/analyze.js results/copilot-cli/session.log.jsonl --domain tools
node dist/analyze.js results/copilot-cli/session.log.jsonl --domain resources
node dist/analyze.js results/copilot-cli/session.log.jsonl --domain prompts
```

Save the output to `results/copilot-cli/REPORT.md`.

## 7. Interpretation Guide

### Tools Domain

| Outcome | Conclusion |
|---------|------------|
| Q8 yes + Q10 yes | Client honors `tools/list_changed` fully -- dynamic tool surfacing works. |
| Q8 no + Q10 no | Client ignores notification -- dynamic surfacing is impossible without restart. |
| Q8 yes + Q10 no | Client refreshes its internal list but doesn't re-prompt the LLM with new tools mid-session. |
| Q8 no + Q10 yes | Client allows direct `tools/call` without re-listing -- unusual, document. |
| Q11 yes (alpha callable after removal) | Client did not invalidate its cached tool list. |

### Resources Domain

| Outcome | Conclusion |
|---------|------------|
| Q5 yes + Q6 yes | Client honors `resources/list_changed`. |
| Q5 no + Q6 no | Client ignores resource notifications. |

### Prompts Domain

| Outcome | Conclusion |
|---------|------------|
| Q5 yes + Q6 yes | Client honors `prompts/list_changed`. |
| Q5 no + Q6 no | Client ignores prompt notifications. |

## 8. Filing Results

After running the protocol:

1. Commit the log and report to `results/copilot-cli/`
2. Include: client name, version, OS, date, and the full analysis tables
3. Note any behavioral nuances (e.g., "client refreshed between turns but not within a turn")

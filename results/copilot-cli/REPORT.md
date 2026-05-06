# Copilot CLI `notifications/tools/list_changed` Experiment Report

**Date:** 2026-05-06
**Client:** github-copilot-developer v1.0.42-0
**Server:** mcp-tester v0.1.0
**Protocol version:** 2025-11-25
**Transport:** stdio (non-interactive mode via `copilot -p`)

## TL;DR

Copilot CLI **partially supports** `notifications/tools/list_changed`:
- ✅ It re-fetches `tools/list` after receiving the notification (protocol-compliant)
- ❌ It does **not** surface the updated tool list to the LLM mid-turn (the LLM cannot call newly-registered tools)

This is **not** "ignoring the notification" — it's an architectural limitation where the LLM's tool schema is frozen at turn start and not updated mid-inference.

## Evidence Table (Automated Analysis)

| # | Question | Answer | Evidence |
|---|----------|--------|----------|
| 1 | Did client send initialize? | yes | log line 1, ts 2026-05-06T01:28:44.504Z |
| 2 | Client capabilities | `{"elicitation":{"form":{},"url":{}},"tasks":{"requests":{"tools":{"call":{}}}}}` | log line 1 |
| 3 | Server advertised tools.listChanged: true? | yes | log line 2 |
| 4 | Did client send tools/list initially? | yes | log line 4, ts 2026-05-06T01:28:48.935Z |
| 5 | Did client call mcptester_probe_alpha? | yes | log line 10, ts 2026-05-06T01:28:57.739Z |
| 6 | Did client call mcptester_mutate_tools? | yes | log line 12, ts 2026-05-06T01:29:02.104Z |
| 7 | Did server send notifications/tools/list_changed? | yes | log line 13, ts 2026-05-06T01:29:02.106Z |
| 8 | Did client send tools/list after notification? | **yes** | log line 15, ts 2026-05-06T01:29:02.114Z |
| 9 | Re-list response includes mcptester_probe_beta? | **yes** | response to request id 6 |
| 10 | Did client call mcptester_probe_beta? | **no** | absent |
| 11 | Did client call mcptester_probe_alpha AFTER mutation? | **no** | absent |

## Interpretation

Per the PROTOCOL.md interpretation guide:

> **Q8 yes + Q10 no**: Client refreshes but doesn't re-prompt LLM with new tools mid-session — partial support.

The client's MCP transport layer is fully spec-compliant: it receives the notification, immediately re-fetches `tools/list`, and gets the updated list (including `mcptester_probe_beta`). However, the LLM orchestration layer does not propagate the updated tool definitions to the model's current turn. The model continues with its stale tool schema.

## Implications for PR #321 (`msx_expand`)

The original PR #321 claim was:
> "Copilot CLI caches `tools/list` at session start and ignores `notifications/tools/list_changed`"

**This claim is partially wrong.** The client does NOT ignore the notification — it processes it and updates its internal registry. The limitation is:

1. **Mid-turn mutations are invisible to the LLM.** If a tool call triggers `list_changed`, the new tools won't be usable in the same turn.
2. **Cross-turn visibility is untested** in this experiment (non-interactive mode = single turn). An interactive session might surface new tools on the next turn.

### What this means for dynamic tool surfacing:

| Architecture | Would it work? |
|---|---|
| Gateway that hides tools and surfaces them mid-turn via `list_changed` | ❌ No — LLM can't see them until next turn |
| Gateway that pre-surfaces tools at turn start based on context/routing | ✅ Potentially — if mutation happens before LLM inference begins |
| Pre-registering all tools but using description/routing to guide selection | ✅ Yes — tools are always visible, selection is emergent |

## Raw Protocol Timeline

```
T+0.000s  → initialize (client: github-copilot-developer/1.0.42-0)
T+0.014s  ← initialize response (server: mcp-tester/0.1.0, tools.listChanged: true)
T+0.016s  → notifications/initialized
T+4.431s  → tools/list (initial fetch)
T+4.434s  ← tools/list response (5 tools: probe_alpha, mutate_tools, mutate_resources, mutate_prompts, status)
T+13.235s → tools/call mcptester_status
T+13.237s ← result: {tools: "alpha", resources: "alpha", prompts: "alpha"}
T+13.235s → tools/call mcptester_probe_alpha
T+13.237s ← result: "alpha called at ..."
T+17.600s → tools/call mcptester_mutate_tools
T+17.602s ← result: "Tools mutated..."
T+17.602s ← notifications/tools/list_changed (server → client)
T+17.610s → tools/list (CLIENT RE-FETCHED!)
T+17.612s ← tools/list response (5 tools: probe_beta, mutate_tools, mutate_resources, mutate_prompts, status)
           [NO further tools/call for mcptester_probe_beta]
T+22.xxx  → tools/call mcptester_status (final check)
```

## Methodology

1. **Server:** `mcp-tester` probe server with full JSONL logging of every JSON-RPC message
2. **Client:** Copilot CLI v1.0.42-0 in non-interactive mode (`-p` flag)
3. **Isolation:** All other MCP servers disabled via `--disable-builtin-mcps` + `--disable-mcp-server` for each configured server
4. **Control:** The `mcp-tester` driver (SDK client) proves the same server works correctly when the client fully honors `list_changed`
5. **Analysis:** Automated `analyze.ts` script produces the evidence table from raw JSONL logs

## Reproducibility

```bash
git clone https://github.com/ericchansen/mcp-tester.git
cd mcp-tester && npm install && npm run build

# Run the control (SDK client — proves server works)
npm run driver -- --domain tools

# Configure for Copilot CLI (add to ~/.copilot/mcp-config.json)
# Then run:
copilot -p "Call mcptester_probe_alpha, then mcptester_mutate_tools, then mcptester_probe_beta" \
  --disable-builtin-mcps --allow-all-tools -s

# Analyze:
node dist/analyze.js <log-path> --domain tools
```

## Files

- `session-tools-official.log.jsonl` — Raw JSONL log from the official experiment run (18 entries)
- This report was generated from automated analysis + manual interpretation

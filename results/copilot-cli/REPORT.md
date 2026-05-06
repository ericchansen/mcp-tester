# Copilot CLI `notifications/tools/list_changed` Experiment Report

**Date:** 2026-05-06
**Client:** github-copilot-developer v1.0.42-0
**Server:** mcp-tester v0.1.0
**Protocol version:** 2025-11-25
**Transport:** stdio (non-interactive mode via `copilot -p`)

## TL;DR

Copilot CLI **fully supports** `notifications/tools/list_changed` for multi-turn use:
- ✅ It re-fetches `tools/list` after receiving the notification (protocol-compliant)
- ✅ On the **next turn**, the LLM sees and can call dynamically-registered tools
- ❌ It does **not** surface the updated tool list to the LLM **mid-turn** (same-turn mutations are invisible)

This is **not** "ignoring the notification" — the client is fully protocol-compliant. The only limitation is that the LLM's tool schema is frozen within a single inference turn, which is expected behavior.

**Bottom line: Dynamic tool registration works across turns. A gateway like `msx_expand` IS viable if designed as a two-turn flow (turn 1: expand → turn 2: use new tools).**

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

> **Q8 yes + Q10 no** (single-turn): Client refreshes internal registry but LLM can't see new tools mid-inference.

The client's MCP transport layer is fully spec-compliant: it receives the notification, immediately re-fetches `tools/list`, and gets the updated list (including `mcptester_probe_beta`). Within the same turn, the model can't call the new tool. But on the **next turn**, it can.

## Multi-Turn Experiment (Interactive Mode)

| # | Question | Answer | Evidence |
|---|----------|--------|----------|
| 1 | Did mutation happen in turn 1? | yes | tools/call mcptester_mutate_tools at T+01:33:43 |
| 2 | Did client re-fetch tools/list after notification? | yes | tools/list at T+01:33:43 (same as single-turn) |
| 3 | Did client call mcptester_probe_beta in turn 2? | **YES** | tools/call mcptester_probe_beta at T+01:38:44 |
| 4 | Did server confirm beta execution? | yes | "beta called at 2026-05-06T01:38:44.894Z" |

**Conclusion:** Dynamic tool registration is fully functional across turns. The client's updated internal registry IS surfaced to the LLM at the start of the next turn.

## Implications for PR #321 (`msx_expand`)

The original PR #321 claim was:
> "Copilot CLI caches `tools/list` at session start and ignores `notifications/tools/list_changed`"

**This claim is wrong.** The client honors the notification, updates its registry, and surfaces new tools on the next turn. A dynamic gateway IS viable.

### What this means for dynamic tool surfacing:

| Architecture | Would it work? |
|---|---|
| Gateway that hides tools and surfaces them mid-turn via `list_changed` | ⚠️ Partially — new tools visible next turn, not same turn |
| Two-turn flow: turn 1 "expand X" → turn 2 uses new tools | ✅ Yes — fully supported |
| Pre-registering all tools with description-based routing | ✅ Yes — tools are always visible, selection is emergent |

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

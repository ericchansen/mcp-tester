#!/usr/bin/env node
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LogLine = {
  ts: string;
  dir: "in" | "out";
  parsed?: Record<string, unknown>;
  raw?: string;
};

type IndexedLog = LogLine & { lineNum: number };

type Answer = {
  num: number;
  question: string;
  answer: string;
  evidence: string;
};

// ---------------------------------------------------------------------------
// Parse log
// ---------------------------------------------------------------------------

function parseLog(path: string): IndexedLog[] {
  const text = readFileSync(path, "utf-8");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  return lines.map((l, i) => {
    try {
      const obj = JSON.parse(l) as LogLine;
      return { ...obj, lineNum: i + 1 };
    } catch {
      return { ts: "", dir: "in" as const, raw: l, lineNum: i + 1 };
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isJsonRpc(msg: Record<string, unknown>): boolean {
  return msg.jsonrpc === "2.0";
}

function isRequest(msg: Record<string, unknown>): boolean {
  return isJsonRpc(msg) && "method" in msg && "id" in msg;
}

function isNotification(msg: Record<string, unknown>): boolean {
  return isJsonRpc(msg) && "method" in msg && !("id" in msg);
}

function isResponse(msg: Record<string, unknown>): boolean {
  return isJsonRpc(msg) && "id" in msg && !("method" in msg);
}

function getMethod(entry: IndexedLog): string | undefined {
  return entry.parsed?.method as string | undefined;
}

function getId(entry: IndexedLog): unknown {
  return entry.parsed?.id;
}

function getParams(entry: IndexedLog): Record<string, unknown> | undefined {
  return entry.parsed?.params as Record<string, unknown> | undefined;
}

function getResult(entry: IndexedLog): Record<string, unknown> | undefined {
  return entry.parsed?.result as Record<string, unknown> | undefined;
}

function firstMatch(
  log: IndexedLog[],
  pred: (e: IndexedLog) => boolean,
  afterLine?: number,
): IndexedLog | undefined {
  for (const e of log) {
    if (afterLine !== undefined && e.lineNum <= afterLine) continue;
    if (pred(e)) return e;
  }
  return undefined;
}

function firstInboundRequest(
  log: IndexedLog[],
  method: string,
  afterLine?: number,
): IndexedLog | undefined {
  return firstMatch(
    log,
    (e) =>
      e.dir === "in" &&
      !!e.parsed &&
      isRequest(e.parsed) &&
      getMethod(e) === method,
    afterLine,
  );
}

function firstInboundToolCall(
  log: IndexedLog[],
  toolName: string,
  afterLine?: number,
): IndexedLog | undefined {
  return firstMatch(
    log,
    (e) => {
      if (e.dir !== "in" || !e.parsed || !isRequest(e.parsed)) return false;
      if (getMethod(e) !== "tools/call") return false;
      const params = getParams(e);
      return params?.name === toolName;
    },
    afterLine,
  );
}

function firstOutboundNotification(
  log: IndexedLog[],
  method: string,
  afterLine?: number,
): IndexedLog | undefined {
  return firstMatch(
    log,
    (e) =>
      e.dir === "out" &&
      !!e.parsed &&
      isNotification(e.parsed) &&
      getMethod(e) === method,
    afterLine,
  );
}

function findResponseTo(
  log: IndexedLog[],
  requestId: unknown,
): IndexedLog | undefined {
  return firstMatch(
    log,
    (e) =>
      e.dir === "out" &&
      !!e.parsed &&
      isResponse(e.parsed) &&
      getId(e) === requestId,
  );
}

// ---------------------------------------------------------------------------
// Domain analyzers
// ---------------------------------------------------------------------------

function analyzeTools(log: IndexedLog[]): Answer[] {
  const answers: Answer[] = [];

  // Q1: Did client send initialize?
  const initReq = firstInboundRequest(log, "initialize");
  answers.push({
    num: 1,
    question: "Did client send initialize?",
    answer: initReq ? "yes" : "no",
    evidence: initReq
      ? `log line ${initReq.lineNum}, ts ${initReq.ts}`
      : "absent",
  });

  // Q2: Client capabilities
  const clientCaps = initReq
    ? JSON.stringify(getParams(initReq)?.capabilities ?? null)
    : "N/A";
  answers.push({
    num: 2,
    question: "Client capabilities",
    answer: clientCaps.length > 80 ? clientCaps.slice(0, 77) + "..." : clientCaps,
    evidence: initReq ? `log line ${initReq.lineNum}` : "absent",
  });

  // Q3: Server's initialize response advertise tools.listChanged?
  const initResp = initReq ? findResponseTo(log, getId(initReq)) : undefined;
  let listChangedAdvertised = "N/A";
  if (initResp) {
    const result = getResult(initResp);
    const caps = result?.capabilities as Record<string, unknown> | undefined;
    const toolsCap = caps?.tools as Record<string, unknown> | undefined;
    listChangedAdvertised = toolsCap?.listChanged === true ? "yes" : "no";
  }
  answers.push({
    num: 3,
    question: "Server advertised tools.listChanged: true?",
    answer: listChangedAdvertised,
    evidence: initResp
      ? `log line ${initResp.lineNum}`
      : "no init response found",
  });

  // Q4: Did client send tools/list initially?
  const initialList = firstInboundRequest(log, "tools/list");
  answers.push({
    num: 4,
    question: "Did client send tools/list initially?",
    answer: initialList ? "yes" : "no",
    evidence: initialList
      ? `log line ${initialList.lineNum}, ts ${initialList.ts}`
      : "absent",
  });

  // Q5: Did client call mcptester_probe_alpha?
  const alphaCall = firstInboundToolCall(log, "mcptester_probe_alpha");
  answers.push({
    num: 5,
    question: "Did client call mcptester_probe_alpha?",
    answer: alphaCall ? "yes" : "no",
    evidence: alphaCall
      ? `log line ${alphaCall.lineNum}, ts ${alphaCall.ts}`
      : "absent",
  });

  // Q6: Did client call mcptester_mutate_tools?
  const mutateCall = firstInboundToolCall(log, "mcptester_mutate_tools");
  answers.push({
    num: 6,
    question: "Did client call mcptester_mutate_tools?",
    answer: mutateCall ? "yes" : "no",
    evidence: mutateCall
      ? `log line ${mutateCall.lineNum}, ts ${mutateCall.ts}`
      : "absent",
  });

  // Q7: Did server send notifications/tools/list_changed after mutation?
  const afterMutate = mutateCall?.lineNum;
  const notif = firstOutboundNotification(
    log,
    "notifications/tools/list_changed",
    afterMutate,
  );
  answers.push({
    num: 7,
    question: "Did server send notifications/tools/list_changed?",
    answer: notif ? "yes" : "no",
    evidence: notif
      ? `log line ${notif.lineNum}, ts ${notif.ts}`
      : afterMutate
        ? "absent after mutation"
        : "no mutation call found",
  });

  // Q8: Did client send a NEW tools/list after the notification?
  const afterNotif = notif?.lineNum ?? afterMutate;
  const relist = afterNotif
    ? firstInboundRequest(log, "tools/list", afterNotif)
    : undefined;
  answers.push({
    num: 8,
    question: "Did client send tools/list after notification?",
    answer: relist ? "yes" : "no",
    evidence: relist
      ? `log line ${relist.lineNum}, ts ${relist.ts}`
      : afterNotif
        ? "absent after notification"
        : "no notification found",
  });

  // Q9: If re-listed, did response include mcptester_probe_beta?
  let betaInList = "N/A";
  if (relist) {
    const resp = findResponseTo(log, getId(relist));
    if (resp) {
      const result = getResult(resp);
      const tools = (result?.tools ?? []) as Array<{ name?: string }>;
      const found = tools.some((t) => t.name === "mcptester_probe_beta");
      betaInList = found ? "yes" : "no";
    } else {
      betaInList = "no response found";
    }
  }
  answers.push({
    num: 9,
    question: "Re-list response includes mcptester_probe_beta?",
    answer: betaInList,
    evidence: relist
      ? `response to request id ${getId(relist) as string}`
      : "no re-list",
  });

  // Q10: Did client call mcptester_probe_beta after mutation?
  const betaCall = firstInboundToolCall(
    log,
    "mcptester_probe_beta",
    afterMutate,
  );
  answers.push({
    num: 10,
    question: "Did client call mcptester_probe_beta?",
    answer: betaCall ? "yes" : "no",
    evidence: betaCall
      ? `log line ${betaCall.lineNum}, ts ${betaCall.ts}`
      : "absent",
  });

  // Q11: Did client call mcptester_probe_alpha AFTER mutation?
  const alphaAfter = afterMutate
    ? firstInboundToolCall(log, "mcptester_probe_alpha", afterMutate)
    : undefined;
  answers.push({
    num: 11,
    question: "Did client call mcptester_probe_alpha AFTER mutation?",
    answer: alphaAfter ? "yes" : "no",
    evidence: alphaAfter
      ? `log line ${alphaAfter.lineNum}, ts ${alphaAfter.ts}`
      : "absent",
  });

  return answers;
}

function analyzeResources(log: IndexedLog[]): Answer[] {
  const answers: Answer[] = [];

  // Q1: Did client send resources/list initially?
  const initialList = firstInboundRequest(log, "resources/list");
  answers.push({
    num: 1,
    question: "Did client send resources/list initially?",
    answer: initialList ? "yes" : "no",
    evidence: initialList
      ? `log line ${initialList.lineNum}, ts ${initialList.ts}`
      : "absent",
  });

  // Q2: Did client read probe://alpha?
  const alphaRead = firstMatch(log, (e) => {
    if (e.dir !== "in" || !e.parsed || !isRequest(e.parsed)) return false;
    if (getMethod(e) !== "resources/read") return false;
    const params = getParams(e);
    return params?.uri === "probe://alpha";
  });
  answers.push({
    num: 2,
    question: "Did client read probe://alpha?",
    answer: alphaRead ? "yes" : "no",
    evidence: alphaRead
      ? `log line ${alphaRead.lineNum}, ts ${alphaRead.ts}`
      : "absent",
  });

  // Q3: Did client call mcptester_mutate_resources?
  const mutateCall = firstInboundToolCall(log, "mcptester_mutate_resources");
  answers.push({
    num: 3,
    question: "Did client call mcptester_mutate_resources?",
    answer: mutateCall ? "yes" : "no",
    evidence: mutateCall
      ? `log line ${mutateCall.lineNum}, ts ${mutateCall.ts}`
      : "absent",
  });

  // Q4: Did server send notifications/resources/list_changed?
  const afterMutate = mutateCall?.lineNum;
  const notif = firstOutboundNotification(
    log,
    "notifications/resources/list_changed",
    afterMutate,
  );
  answers.push({
    num: 4,
    question: "Did server send notifications/resources/list_changed?",
    answer: notif ? "yes" : "no",
    evidence: notif
      ? `log line ${notif.lineNum}, ts ${notif.ts}`
      : "absent",
  });

  // Q5: Did client send resources/list after notification?
  const afterNotif = notif?.lineNum ?? afterMutate;
  const relist = afterNotif
    ? firstInboundRequest(log, "resources/list", afterNotif)
    : undefined;
  answers.push({
    num: 5,
    question: "Did client send resources/list after notification?",
    answer: relist ? "yes" : "no",
    evidence: relist
      ? `log line ${relist.lineNum}, ts ${relist.ts}`
      : "absent",
  });

  // Q6: Did client read probe://beta?
  const betaRead = firstMatch(
    log,
    (e) => {
      if (e.dir !== "in" || !e.parsed || !isRequest(e.parsed)) return false;
      if (getMethod(e) !== "resources/read") return false;
      const params = getParams(e);
      return params?.uri === "probe://beta";
    },
    afterMutate,
  );
  answers.push({
    num: 6,
    question: "Did client read probe://beta after mutation?",
    answer: betaRead ? "yes" : "no",
    evidence: betaRead
      ? `log line ${betaRead.lineNum}, ts ${betaRead.ts}`
      : "absent",
  });

  // Q7: Did client try to read probe://alpha after mutation?
  const alphaAfter = afterMutate
    ? firstMatch(
        log,
        (e) => {
          if (e.dir !== "in" || !e.parsed || !isRequest(e.parsed)) return false;
          if (getMethod(e) !== "resources/read") return false;
          const params = getParams(e);
          return params?.uri === "probe://alpha";
        },
        afterMutate,
      )
    : undefined;
  answers.push({
    num: 7,
    question: "Did client read probe://alpha AFTER mutation?",
    answer: alphaAfter ? "yes" : "no",
    evidence: alphaAfter
      ? `log line ${alphaAfter.lineNum}, ts ${alphaAfter.ts}`
      : "absent",
  });

  return answers;
}

function analyzePrompts(log: IndexedLog[]): Answer[] {
  const answers: Answer[] = [];

  // Q1: Did client send prompts/list initially?
  const initialList = firstInboundRequest(log, "prompts/list");
  answers.push({
    num: 1,
    question: "Did client send prompts/list initially?",
    answer: initialList ? "yes" : "no",
    evidence: initialList
      ? `log line ${initialList.lineNum}, ts ${initialList.ts}`
      : "absent",
  });

  // Q2: Did client get mcptester_alpha_prompt?
  const alphaGet = firstMatch(log, (e) => {
    if (e.dir !== "in" || !e.parsed || !isRequest(e.parsed)) return false;
    if (getMethod(e) !== "prompts/get") return false;
    const params = getParams(e);
    return params?.name === "mcptester_alpha_prompt";
  });
  answers.push({
    num: 2,
    question: "Did client get mcptester_alpha_prompt?",
    answer: alphaGet ? "yes" : "no",
    evidence: alphaGet
      ? `log line ${alphaGet.lineNum}, ts ${alphaGet.ts}`
      : "absent",
  });

  // Q3: Did client call mcptester_mutate_prompts?
  const mutateCall = firstInboundToolCall(log, "mcptester_mutate_prompts");
  answers.push({
    num: 3,
    question: "Did client call mcptester_mutate_prompts?",
    answer: mutateCall ? "yes" : "no",
    evidence: mutateCall
      ? `log line ${mutateCall.lineNum}, ts ${mutateCall.ts}`
      : "absent",
  });

  // Q4: Did server send notifications/prompts/list_changed?
  const afterMutate = mutateCall?.lineNum;
  const notif = firstOutboundNotification(
    log,
    "notifications/prompts/list_changed",
    afterMutate,
  );
  answers.push({
    num: 4,
    question: "Did server send notifications/prompts/list_changed?",
    answer: notif ? "yes" : "no",
    evidence: notif
      ? `log line ${notif.lineNum}, ts ${notif.ts}`
      : "absent",
  });

  // Q5: Did client send prompts/list after notification?
  const afterNotif = notif?.lineNum ?? afterMutate;
  const relist = afterNotif
    ? firstInboundRequest(log, "prompts/list", afterNotif)
    : undefined;
  answers.push({
    num: 5,
    question: "Did client send prompts/list after notification?",
    answer: relist ? "yes" : "no",
    evidence: relist
      ? `log line ${relist.lineNum}, ts ${relist.ts}`
      : "absent",
  });

  // Q6: Did client get mcptester_beta_prompt?
  const betaGet = firstMatch(
    log,
    (e) => {
      if (e.dir !== "in" || !e.parsed || !isRequest(e.parsed)) return false;
      if (getMethod(e) !== "prompts/get") return false;
      const params = getParams(e);
      return params?.name === "mcptester_beta_prompt";
    },
    afterMutate,
  );
  answers.push({
    num: 6,
    question: "Did client get mcptester_beta_prompt after mutation?",
    answer: betaGet ? "yes" : "no",
    evidence: betaGet
      ? `log line ${betaGet.lineNum}, ts ${betaGet.ts}`
      : "absent",
  });

  // Q7: Did client try to get mcptester_alpha_prompt after mutation?
  const alphaAfter = afterMutate
    ? firstMatch(
        log,
        (e) => {
          if (e.dir !== "in" || !e.parsed || !isRequest(e.parsed)) return false;
          if (getMethod(e) !== "prompts/get") return false;
          const params = getParams(e);
          return params?.name === "mcptester_alpha_prompt";
        },
        afterMutate,
      )
    : undefined;
  answers.push({
    num: 7,
    question: "Did client get mcptester_alpha_prompt AFTER mutation?",
    answer: alphaAfter ? "yes" : "no",
    evidence: alphaAfter
      ? `log line ${alphaAfter.lineNum}, ts ${alphaAfter.ts}`
      : "absent",
  });

  return answers;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function renderTable(domain: string, answers: Answer[]): string {
  const lines: string[] = [];
  lines.push(`## Domain: ${domain}`);
  lines.push("");
  lines.push("| # | Question | Answer | Evidence |");
  lines.push("|---|----------|--------|----------|");
  for (const a of answers) {
    lines.push(`| ${a.num} | ${a.question} | ${a.answer} | ${a.evidence} |`);
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const logPath = args.find((a) => !a.startsWith("--"));
const domainArg = args
  .find((a) => a.startsWith("--domain="))
  ?.split("=")[1]
  ?? args[args.indexOf("--domain") + 1];

if (!logPath) {
  process.stderr.write(
    "Usage: mcp-tester-analyze <log-path> [--domain tools|resources|prompts]\n",
  );
  process.exit(1);
}

const log = parseLog(logPath);
const domains = domainArg
  ? [domainArg]
  : ["tools", "resources", "prompts"];

process.stdout.write(`# MCP list_changed Probe Analysis\n\n`);
process.stdout.write(`Log file: \`${logPath}\`\n`);
process.stdout.write(`Total log entries: ${log.length}\n\n`);

for (const domain of domains) {
  let answers: Answer[];
  switch (domain) {
    case "tools":
      answers = analyzeTools(log);
      break;
    case "resources":
      answers = analyzeResources(log);
      break;
    case "prompts":
      answers = analyzePrompts(log);
      break;
    default:
      process.stderr.write(`Unknown domain: ${domain}\n`);
      continue;
  }
  process.stdout.write(renderTable(domain, answers));
}

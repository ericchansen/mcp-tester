import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Transform, type Readable, type Writable } from "node:stream";

export type LogLine = {
  ts: string;
  dir: "in" | "out";
  parsed?: object;
  raw?: string;
};

/**
 * Creates tapped stdin/stdout streams that log every JSON-RPC message to a
 * JSONL file. Install BEFORE creating StdioServerTransport, then pass the
 * returned streams as its stdin/stdout.
 *
 * Returns { tappedInput, tappedOutput } — the tapped streams to hand to the
 * transport — plus a flush() for draining any partial buffers on shutdown.
 */
export function createStdioTap(logPath: string): {
  tappedInput: Readable;
  tappedOutput: Writable;
  flush: () => void;
} {
  const absPath = resolve(logPath);
  mkdirSync(dirname(absPath), { recursive: true });

  const inBuf: string[] = [];
  const outBuf: string[] = [];

  function appendLog(line: LogLine): void {
    appendFileSync(absPath, JSON.stringify(line) + "\n");
  }

  function drainBuffer(buf: string[], dir: "in" | "out"): void {
    const joined = buf.join("");
    buf.length = 0;
    const lines = joined.split("\n");
    // last element is a partial line — keep it in the buffer
    const partial = lines.pop()!;
    if (partial.length > 0) buf.push(partial);

    for (const line of lines) {
      if (line.length === 0) continue;
      const ts = new Date().toISOString();
      try {
        const parsed = JSON.parse(line) as object;
        appendLog({ ts, dir, parsed });
      } catch {
        appendLog({ ts, dir, raw: line });
      }
    }
  }

  // Tapped input: Transform that observes stdin bytes and forwards them
  const tappedInput = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      inBuf.push(chunk.toString("utf-8"));
      drainBuffer(inBuf, "in");
      this.push(chunk);
      callback();
    },
  });
  process.stdin.pipe(tappedInput);

  // Tapped output: Transform that observes outbound bytes before they
  // reach the real stdout
  const tappedOutput = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      outBuf.push(chunk.toString("utf-8"));
      drainBuffer(outBuf, "out");
      this.push(chunk);
      callback();
    },
  });
  tappedOutput.pipe(process.stdout);

  function flush(): void {
    // Flush any remaining partial buffers
    if (inBuf.length > 0) {
      const remaining = inBuf.join("");
      inBuf.length = 0;
      if (remaining.trim().length > 0) {
        appendLog({ ts: new Date().toISOString(), dir: "in", raw: remaining });
      }
    }
    if (outBuf.length > 0) {
      const remaining = outBuf.join("");
      outBuf.length = 0;
      if (remaining.trim().length > 0) {
        appendLog({ ts: new Date().toISOString(), dir: "out", raw: remaining });
      }
    }
  }

  return { tappedInput, tappedOutput, flush };
}

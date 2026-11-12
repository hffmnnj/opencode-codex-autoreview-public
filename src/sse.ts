import { bytes, object } from "./json.js";

/** Incremental SSE framing. Limits include ignored events and partial frames. */
export class Events {
  private line: string[] = [];
  private data: string[] = [];
  private skipLF = false;
  private total = 0;
  private tag: string | undefined;
  private done = false;
  constructor(private readonly limit: number, private readonly onEvent: (value: unknown) => void) {}

  push(text: string): void {
    if (!text.length) return;
    this.total += bytes(text);
    if (this.total > this.limit) throw new Error("size");
    // Scan each chunk once. Re-scanning a growing partial frame is quadratic on tiny chunks.
    let start = 0;
    if (this.skipLF && text.startsWith("\n")) start++;
    this.skipLF = false;
    const newline = /[\r\n]/g;
    newline.lastIndex = start;
    let match: RegExpExecArray | null;
    while ((match = newline.exec(text))) {
      this.line.push(text.slice(start, match.index));
      const line = this.line.join("");
      this.line = [];
      if (!line) {
        const data = this.data.join("\n");
        const hadData = this.data.length > 0;
        this.data = [];
        const tag = this.tag;
        this.tag = undefined;
        if (this.done && (hadData || tag !== undefined)) throw new Error("after-done");
        if (data === "[DONE]") {
          if (tag !== undefined) throw new Error("event-tag");
          this.done = true;
        } else if (data) {
          const value: unknown = JSON.parse(data);
          if (tag !== undefined && (!object(value) || value.type !== tag)) throw new Error("event-tag");
          this.onEvent(value);
        } else if (tag !== undefined) throw new Error("event-without-data");
      } else if (line === "data" || line.startsWith("data:")) {
        this.data.push(line === "data" ? "" : line.slice(5).replace(/^ /, ""));
      } else if (line === "event" || line.startsWith("event:")) {
        if (this.tag !== undefined) throw new Error("duplicate-event-tag");
        this.tag = line === "event" ? "" : line.slice(6).replace(/^ /, "");
      }
      start = match.index + 1;
      if (text[match.index] === "\r") {
        if (text[start] === "\n") start++;
        else if (start === text.length) this.skipLF = true;
      }
      newline.lastIndex = start;
    }
    if (start < text.length) this.line.push(text.slice(start));
  }

  end(): void {
    if (this.line.join("").trim() || this.data.length || this.tag !== undefined) throw new Error("incomplete-frame");
  }
}

export function completed(value: unknown): Record<string, unknown> | undefined {
  if (!object(value) || value.type !== "response.completed") return;
  if (!object(value.response) || value.response.status !== "completed" || typeof value.response.id !== "string" || !/^resp_[A-Za-z0-9_-]{1,200}$/.test(value.response.id)) throw new Error("completion");
  return value.response;
}

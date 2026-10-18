import { createHash } from "node:crypto";
import { types } from "node:util";

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Fingerprint only bounded JSON trees, never a lossy view of caller-owned action objects. */
export function canonical(value: unknown): string {
  const maxNodes = 16_384;
  const maxBytes = 256 * 1024;
  const seen = new WeakSet<object>();
  const output: string[] = [];
  let nodes = 0;
  let size = 0;
  const emit = (text: string) => {
    size += bytes(text);
    if (size > maxBytes) throw new Error("json-budget");
    output.push(text);
  };
  const quote = (text: string) => {
    // Bound work before JSON.stringify allocates escaped output (at most six times this input).
    if (text.length > maxBytes - size) throw new Error("json-budget");
    emit(JSON.stringify(text));
  };
  const ownValue = (owner: object, key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error("non-json-property");
    return descriptor.value as unknown;
  };
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > maxNodes) throw new Error("json-budget");
    if (depth > 40) throw new Error("depth");
    if (typeof item === "string") { quote(item); return; }
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) {
      if (typeof item === "number" && Object.is(item, -0)) throw new Error("non-json-negative-zero");
      emit(JSON.stringify(item));
      return;
    }
    if (item === null || typeof item !== "object" || types.isProxy(item)) throw new Error("non-json");
    // Repeated references are conservatively unsupported, avoiding cycles and exponential DAG expansion.
    if (seen.has(item)) throw new Error("repeated-reference");
    seen.add(item);
    const array = Array.isArray(item);
    if (array ? Object.getPrototypeOf(item) !== Array.prototype : ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error("non-json");
    const keys = Reflect.ownKeys(item);
    if (keys.length > maxNodes - nodes + (array ? 1 : 0)) throw new Error("json-budget");
    if (keys.some((key) => typeof key !== "string")) throw new Error("non-json-symbol");
    if (array) {
      if (item.length > maxNodes - nodes) throw new Error("json-budget");
      if (keys.length !== item.length + 1) throw new Error("non-json-sparse-or-property");
      emit("[");
      for (let i = 0; i < item.length; i++) {
        if (i) emit(",");
        visit(ownValue(item, String(i)), depth + 1);
      }
      emit("]");
      return;
    }
    const names = keys as string[];
    // Sorting must also be bounded by key size, even before key/value serialization starts.
    let keyLength = 0;
    for (const key of names) {
      keyLength += key.length;
      if (keyLength > maxBytes - size) throw new Error("json-budget");
    }
    emit("{");
    for (const [index, key] of names.sort().entries()) {
      if (index) emit(",");
      quote(key);
      emit(":");
      visit(ownValue(item, key), depth + 1);
    }
    emit("}");
  };
  visit(value, 0);
  return output.join("");
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function boundedBody(body: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal): Promise<string> {
  if (!body) throw new Error("body");
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let count = 0;
  let result = "";
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      count += chunk.value.byteLength;
      if (count > limit) throw new Error("size");
      result += decoder.decode(chunk.value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}

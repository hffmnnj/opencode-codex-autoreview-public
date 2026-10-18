import type { PermissionEvaluation } from "@opencode/plugin/promise/permission";
import type { SessionHttpRequest, SessionHttpResponse } from "@opencode/plugin/promise/session";
import { boundedBody, bytes, canonical, fingerprint, object } from "./json.js";
import { ENDPOINT, Reviewer, type TransportContext } from "./reviewer.js";
import { completed, Events } from "./sse.js";

export interface BeforeTool {
  readonly sessionID: string;
  readonly messageID: string;
  readonly id: string;
  tool: string;
  input: unknown;
}

interface Call { name: string; input: unknown }
interface State {
  valid: boolean;
  sessionID: string;
  model: string;
  authorization: string;
  account: string;
  evidence: unknown;
  parentID: string | undefined;
  calls: Map<string, Call>;
  tools: Map<string, { event: BeforeTool; snapshot: string }>;
  controller: AbortController;
  expires: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export type Status = "manual" | "unavailable" | "busy" | "shadow-allow" | "shadow-deny" | "shadow-abstain" | "denied" | "approval-unproven";
export interface Options { mode: "shadow" | "enforce" }

export function options(value: Readonly<Record<string, unknown>>): Options {
  if (Object.keys(value).some((key) => key !== "mode") || (value.mode !== undefined && value.mode !== "shadow" && value.mode !== "enforce")) {
    throw new Error("opencode-codex-autoreview: expected only mode: shadow | enforce");
  }
  return { mode: value.mode === "enforce" ? "enforce" : "shadow" };
}

function eligible(event: SessionHttpRequest | SessionHttpResponse): boolean {
  return event.kind === "primary" && event.model.providerID === "openai" &&
    event.model.id !== "codex-auto-review" &&
    event.request.url === ENDPOINT && event.request.method === "POST" &&
    !event.request.headers.has("x-codex-guardian") && !event.request.headers.has("api-key");
}

function destroy(state: State): void {
  clearTimeout(state.timer);
  state.valid = false;
  state.controller.abort();
  state.authorization = "";
  state.account = "";
  state.evidence = undefined;
  state.calls.clear();
  state.tools.clear();
  state.parentID = undefined;
}

/** The native adapter deliberately cannot turn asks into allows: see README's binding limitation. */
export class NativeAdapter {
  private readonly sessions = new Map<string, State>();
  private readonly requests = new WeakMap<Request, State>();
  private readonly capturing = new Map<string, symbol>();
  private closed = false;

  constructor(
    private readonly config: Options,
    private readonly reviewer = new Reviewer(),
    private readonly diagnostic: (status: Status) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  private report(status: Status): void {
    // A consumer's diagnostics must not turn an abstention into a failed permission hook.
    try { this.diagnostic(status); } catch { /* intentionally no sensitive exception logging */ }
  }

  invalidate(sessionID: string): void {
    this.capturing.delete(sessionID);
    const state = this.sessions.get(sessionID);
    if (state) destroy(state);
    this.sessions.delete(sessionID);
  }

  close(): void {
    this.closed = true;
    for (const id of this.sessions.keys()) this.invalidate(id);
    this.capturing.clear();
  }

  private expire(state: State, ms: number): void {
    clearTimeout(state.timer);
    state.expires = this.now() + ms;
    state.timer = setTimeout(() => {
      if (this.sessions.get(state.sessionID) === state) this.invalidate(state.sessionID);
    }, ms);
    state.timer.unref();
  }

  private current(sessionID: string): State | undefined {
    for (const [id, state] of this.sessions) if (state.expires <= this.now()) this.invalidate(id);
    const state = this.sessions.get(sessionID);
    return state?.valid ? state : undefined;
  }

  async request(event: SessionHttpRequest): Promise<void> {
    if (this.closed || event.kind !== "primary") return;
    // Invalidate on every primary request, including unsupported transports/models/accounts.
    this.invalidate(event.sessionID);
    if (!eligible(event)) return;
    const authorization = event.request.headers.get("authorization");
    const account = event.request.headers.get("chatgpt-account-id");
    if (!authorization || !/^Bearer [A-Za-z0-9._~-]{1,8192}$/.test(authorization) ||
      !account || !/^[A-Za-z0-9_-]{1,200}$/.test(account)) return;
    if (this.capturing.size >= 16) return;
    const ticket = Symbol();
    this.capturing.set(event.sessionID, ticket);
    try {
      const input: unknown = JSON.parse(await boundedBody(event.request.clone().body, 96 * 1024, AbortSignal.timeout(250)));
      if (!object(input) || input.model !== event.model.id || input.stream !== true || !Array.isArray(input.input) ||
        !input.input.some((item: unknown) => object(item) && item.role === "user") ||
        input.previous_response_id !== undefined || !Array.isArray(input.tools) ||
        input.client_metadata !== undefined && !object(input.client_metadata)) return;
      // Preserve the complete request input; no silent transcript truncation or tail-only authorization.
      const evidence = JSON.parse(canonical({
        provenance: "native-primary-request; roles are provider roles, not proof of human authorship",
        input: input.input, instructions: input.instructions ?? null, tools: input.tools,
      })) as unknown;
      const metadata = object(input.client_metadata) ? { ...input.client_metadata } : {};
      delete metadata.parent_response_id;
      metadata.guardian_credits_requested = "true";
      input.client_metadata = metadata;
      const headers = new Headers(event.request.headers);
      headers.delete("content-length");
      if (this.closed || this.capturing.get(event.sessionID) !== ticket) return;
      event.request = new Request(event.request, { body: JSON.stringify(input), headers });
      this.current(event.sessionID);
      if (this.sessions.size >= 16) this.invalidate(this.sessions.keys().next().value!);
      const state: State = {
        valid: true, sessionID: event.sessionID, model: event.model.id, authorization, account, evidence,
        parentID: undefined, calls: new Map(), tools: new Map(), controller: new AbortController(), expires: 0, timer: undefined,
      };
      this.sessions.set(event.sessionID, state);
      this.requests.set(event.request, state);
      this.expire(state, 120_000);
    } catch {
      this.report("manual");
    } finally {
      if (this.capturing.get(event.sessionID) === ticket) this.capturing.delete(event.sessionID);
    }
  }

  response(event: SessionHttpResponse): void {
    const state = this.requests.get(event.request);
    if (!state || !state.valid || this.closed) return;
    if (!eligible(event) || this.current(event.sessionID) !== state || event.model.id !== state.model ||
      event.request.headers.get("authorization") !== state.authorization || event.request.headers.get("chatgpt-account-id") !== state.account ||
      event.response.status !== 200 || !event.response.body ||
      !event.response.headers.get("content-type")?.startsWith("text/event-stream") ||
      event.response.headers.has("chatgpt-account-id") && event.response.headers.get("chatgpt-account-id") !== state.account) {
      this.invalidate(event.sessionID);
      return;
    }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let parent: Record<string, unknown> | undefined;
    let failed = false;
    const events = new Events(1024 * 1024, (value) => {
      if (!object(value) || value.type === "error" || value.type === "response.failed" || value.type === "response.incomplete") throw new Error("parent");
      const result = completed(value);
      if (result) {
        if (parent || result.model !== state.model || !Array.isArray(result.output)) throw new Error("parent");
        parent = result;
        const calls = new Map<string, Call>();
        for (const item of result.output) {
          if (!object(item) || item.type !== "function_call") continue;
          if (typeof item.call_id !== "string" || typeof item.name !== "string" || typeof item.arguments !== "string" ||
            item.status !== "completed" || calls.has(item.call_id) || calls.size >= 16) throw new Error("call");
          const input: unknown = JSON.parse(item.arguments);
          canonical(input);
          calls.set(item.call_id, { name: item.name, input });
        }
        // The native provider can stop reading at response.completed, without flushing to EOF.
        // This enables advisory/deny-only reviews, never authorization to execute.
        state.calls = calls;
        state.parentID = String(result.id);
        this.expire(state, 60_000);
      }
    });
    const fail = () => { failed = true; if (this.sessions.get(event.sessionID) === state) this.invalidate(event.sessionID); else destroy(state); };
    const body = event.response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        // Never modify native response bytes, including when observation is unsupported or malformed.
        controller.enqueue(chunk);
        if (failed || !state.valid) return;
        try { events.push(decoder.decode(chunk, { stream: true })); } catch { fail(); }
      },
      flush: () => {
        if (failed || !state.valid) return;
        try {
          events.push(decoder.decode());
          events.end();
          if (!parent || !Array.isArray(parent.output)) throw new Error("parent");
        } catch { fail(); }
      },
    }));
    event.response = new Response(body, { status: event.response.status, statusText: event.response.statusText, headers: event.response.headers });
  }

  before(event: BeforeTool): void {
    const state = this.current(event.sessionID);
    state?.tools.delete(event.id);
    const call = state?.calls.get(event.id);
    if (!state || !state.parentID || !call || call.name !== event.tool) return;
    try {
      if (canonical(call.input) !== canonical(event.input)) return;
      state.tools.set(event.id, { event, snapshot: fingerprint({ tool: event.tool, input: event.input, messageID: event.messageID }) });
    } catch { this.report("manual"); }
  }

  after(event: { readonly sessionID: string; readonly id: string }): void {
    const state = this.current(event.sessionID);
    state?.tools.delete(event.id);
    state?.calls.delete(event.id);
  }

  async evaluate(event: PermissionEvaluation): Promise<void> {
    if (this.closed || event.effect !== "ask") return;
    const source = event.source;
    const state = this.current(event.sessionID);
    const bound = source?.type === "tool" ? state?.tools.get(source.id) : undefined;
    if (!state || !state.parentID || !source || !bound || bound.event.messageID !== source.messageID) {
      this.report("manual");
      return;
    }
    try {
      const snapshot = () => fingerprint({
        tool: bound.event.tool, input: bound.event.input, messageID: bound.event.messageID,
      });
      if (snapshot() !== bound.snapshot) { this.report("manual"); return; }
      const permission = () => canonical({ action: event.action, resources: event.resources, metadata: event.metadata ?? null, source: event.source });
      const original = permission();
      const evidence: unknown = {
        execution_binding: "intended tool input only; final executed-action binding not proven; never auto-allow",
        model_context: state.evidence,
        proposed_action: { tool: bound.event.tool, input: bound.event.input, permission: JSON.parse(original) as unknown },
      };
      // Serialize before awaiting; caller-owned mutable objects cannot alter the reviewer request in flight.
      const frozen: unknown = JSON.parse(canonical(evidence));
      if (bytes(canonical(frozen)) > 96 * 1024) { this.report("manual"); return; }
      const transport: TransportContext = { authorization: state.authorization, account: state.account, parentID: state.parentID };
      const result = await this.reviewer.review(transport, frozen, state.controller.signal);
      if (this.current(event.sessionID) !== state || state.tools.get(source.id) !== bound || snapshot() !== bound.snapshot ||
        permission() !== original || event.effect !== "ask") { this.report("manual"); return; }
      if (result.status !== "assessed") { this.report(result.status); return; }
      if (this.config.mode === "shadow") { this.report(`shadow-${result.assessment.outcome}`); return; }
      if (result.assessment.outcome === "deny") {
        event.effect = "deny";
        // Never expose model rationale, command, or transcript in permission UI/logs.
        event.message = "Experimental Codex review denied this action. Switch to shadow mode for manual review.";
        this.report("denied");
      } else {
        this.report(result.assessment.outcome === "allow" ? "approval-unproven" : "manual");
      }
    } catch {
      this.report("unavailable");
    }
  }
}

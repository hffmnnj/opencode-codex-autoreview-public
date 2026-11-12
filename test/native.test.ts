import assert from "node:assert/strict";
import { test } from "node:test";
import { Model, Provider } from "@opencode/plugin";
import { Session } from "@opencode/schema/session";
import { NativeAdapter, options, type Status } from "../src/native.js";
import { Reviewer } from "../src/reviewer.js";
import { ACCOUNT, ACTION, ALLOW, AUTH, bind, deferred, DENY, observe, parentSSE, permission, primary, response, reviewSSE, SESSION, tool } from "./fixtures.js";

test("configuration defaults to shadow and rejects misspelled or unsupported safety options", () => {
  assert.deepEqual(options({}), { mode: "shadow" });
  assert.deepEqual(options({ mode: "enforce" }), { mode: "enforce" });
  assert.throws(() => options({ mode: "automatic" }), /expected only mode/);
  assert.throws(() => options({ allow: true }), /expected only mode/);
});

test("shadow performs a correlated review but preserves effect and existing message without leaking diagnostics", async (t) => {
  const statuses: Status[] = [];
  const requests: Request[] = [];
  const adapter = new NativeAdapter(options({}), new Reviewer(async (request) => { requests.push(request); return response(); }), (status) => statuses.push(status));
  t.after(() => adapter.close());
  await bind(adapter);
  const event = permission();
  const original = structuredClone(event);
  await adapter.evaluate(event);
  assert.deepEqual(event, original);
  assert.equal(requests.length, 1);
  assert.deepEqual(statuses, ["shadow-deny"]);
  assert.equal(JSON.stringify(statuses).includes(AUTH), false);
  assert.equal(JSON.stringify(statuses).includes(ACTION.command), false);
  assert.equal(JSON.stringify(statuses).includes(DENY.rationale), false);
});

test("opt-in enforcement denies only the current permission without exposing model rationale", async (t) => {
  let calls = 0;
  const adapter = new NativeAdapter(options({ mode: "enforce" }), new Reviewer(async () => { calls++; return response(); }));
  t.after(() => adapter.close());
  await bind(adapter);
  const event = permission();
  await adapter.evaluate(event);
  assert.equal(event.effect, "deny");
  assert.equal(event.message, "Experimental Codex review denied this action. Switch to shadow mode for manual review.");
  assert.equal(calls, 1);
  const future = permission();
  adapter.after({ sessionID: SESSION, id: "call_1" });
  await adapter.evaluate(future);
  assert.equal(future.effect, "ask");
  assert.equal(calls, 1);
});

for (const assessment of [ALLOW, { ...ALLOW, risk_level: "high" }, { ...ALLOW, outcome: "abstain" }]) {
  test(`enforcement retains manual approval for ${assessment.outcome}/${assessment.risk_level}: execution binding is unproven`, async (t) => {
    const statuses: Status[] = [];
    let calls = 0;
    const adapter = new NativeAdapter(options({ mode: "enforce" }), new Reviewer(async () => { calls++; return response(reviewSSE(assessment)); }), (status) => statuses.push(status));
    t.after(() => adapter.close());
    await bind(adapter);
    const event = permission();
    await adapter.evaluate(event);
    assert.equal(event.effect, "ask");
    assert.equal(event.message, "original manual message");
    assert.equal(calls, 1);
    assert.deepEqual(statuses, [assessment.outcome === "allow" ? "approval-unproven" : "manual"]);
  });
}

test("configured deny and existing allow are never reviewed or rewritten", async (t) => {
  let calls = 0;
  const adapter = new NativeAdapter(options({ mode: "enforce" }), new Reviewer(async () => { calls++; return response(); }));
  t.after(() => adapter.close());
  await bind(adapter);
  for (const effect of ["deny", "allow"] as const) {
    const event = permission(effect);
    const original = structuredClone(event);
    await adapter.evaluate(event);
    assert.deepEqual(event, original);
  }
  assert.equal(calls, 0);
});

test("eligible primary requests preserve input and request credit metadata without fabricating parents", async (t) => {
  const adapter = new NativeAdapter(options({}));
  t.after(() => adapter.close());
  const event = primary();
  const original: unknown = await event.request.clone().json();
  await adapter.request(event);
  const actual = await event.request.clone().json() as Record<string, unknown>;
  assert.deepEqual(actual, { ...(original as Record<string, unknown>), client_metadata: { existing: "preserve", guardian_credits_requested: "true" } });
  assert.equal(event.request.headers.get("authorization"), AUTH);
  assert.equal(event.request.headers.get("chatgpt-account-id"), ACCOUNT);
});

for (const model of ["gpt-6.1-sol", "gpt-5.6-luna"]) {
  test(`subscription primary model ${model} is eligible without a codex naming assumption`, async (t) => {
    let reviews = 0;
    const adapter = new NativeAdapter(options({}), new Reviewer(async () => { reviews++; return response(); }));
    t.after(() => adapter.close());
    const event = primary();
    const body = await event.request.json() as Record<string, unknown>;
    body.model = model;
    const request = { ...event, model: { ...event.model, id: Model.ID.make(model) }, request: new Request(event.request, { body: JSON.stringify(body) }) };
    await adapter.request(request);
    await observe(adapter, request, parentSSE({ model }));
    adapter.before(tool());
    const ask = permission();
    await adapter.evaluate(ask);
    assert.equal(reviews, 1);
    assert.equal(ask.effect, "ask");
  });
}

test("completed parent is usable before EOF because native providers may stop consuming at completion", async (t) => {
  let reviews = 0;
  const statuses: Status[] = [];
  const adapter = new NativeAdapter(options({}), new Reviewer(async () => { reviews++; return response(); }), (status) => statuses.push(status));
  t.after(() => adapter.close());
  const request = primary();
  await adapter.request(request);
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const event = { ...request, response: new Response(new ReadableStream<Uint8Array>({ start(controller) {
    source = controller;
    controller.enqueue(new TextEncoder().encode(parentSSE()));
  } }), { headers: { "content-type": "text/event-stream" } }) };
  adapter.response(event);
  const reader = event.response.body!.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), parentSSE());
  adapter.before(tool());
  const ask = permission();
  await adapter.evaluate(ask);
  assert.equal(ask.effect, "ask");
  assert.equal(reviews, 1);
  assert.deepEqual(statuses, ["shadow-deny"]);
  source.close();
  assert.equal((await reader.read()).done, true);
});

for (const variant of ["no-auth", "api-key", "wrong-host", "wrong-provider", "reviewer", "auxiliary", "incomplete-context"] as const) {
  test(`unsupported request ${variant} cannot supply review credentials or context`, async (t) => {
    let calls = 0;
    const adapter = new NativeAdapter(options({ mode: "enforce" }), new Reviewer(async () => { calls++; return response(); }));
    t.after(() => adapter.close());
    let event = primary();
    if (variant === "no-auth") event.request.headers.delete("authorization");
    if (variant === "api-key") event.request.headers.set("api-key", "fixture-api-key");
    if (variant === "wrong-host") event.request = new Request("https://attacker.invalid/backend-api/codex/responses", event.request);
    if (variant === "wrong-provider") event = { ...event, model: { ...event.model, providerID: Provider.ID.make("attacker") } };
    if (variant === "reviewer") event.request.headers.set("x-codex-guardian", "reviewer");
    if (variant === "auxiliary") event = { ...event, kind: "title" };
    if (variant === "incomplete-context") {
      const body = await event.request.json() as Record<string, unknown>;
      body.previous_response_id = "resp_previous";
      event.request = new Request(event.request, { body: JSON.stringify(body) });
    }
    const originalBody = await event.request.clone().text();
    await adapter.request(event);
    assert.equal(await event.request.clone().text(), originalBody);
    await observe(adapter, event);
    adapter.before(tool());
    const ask = permission();
    await adapter.evaluate(ask);
    assert.equal(ask.effect, "ask");
    assert.equal(calls, 0);
  });
}

for (const variant of ["missing", "incomplete", "wrong-model", "account-mismatch", "duplicate", "oversized", "foreign-session"] as const) {
  test(`parent evidence ${variant} leaves asks untouched and never calls reviewer`, async (t) => {
    let calls = 0;
    const adapter = new NativeAdapter(options({ mode: "enforce" }), new Reviewer(async () => { calls++; return response(); }));
    t.after(() => adapter.close());
    const request = primary();
    await adapter.request(request);
    let text = parentSSE();
    if (variant === "missing") text = "data: [DONE]\n\n";
    if (variant === "incomplete") text = parentSSE({ status: "incomplete" });
    if (variant === "wrong-model") text = parentSSE({ model: "different-codex" });
    if (variant === "duplicate") text += text;
    if (variant === "oversized") text = `: ${"x".repeat(1024 * 1024)}\n\n${text}`;
    const headers = variant === "account-mismatch" ? { "chatgpt-account-id": "other-account" } : {};
    assert.equal(await observe(adapter, request, text, headers), text);
    const before = tool();
    if (variant === "foreign-session") adapter.before({ ...before, sessionID: Session.ID.make("ses_other") });
    else adapter.before(before);
    const ask = permission();
    await adapter.evaluate(ask);
    assert.equal(ask.effect, "ask");
    assert.equal(calls, 0);
  });
}

test("parent SSE observation preserves byte-exact unicode and split event boundaries", async (t) => {
  const adapter = new NativeAdapter(options({}));
  t.after(() => adapter.close());
  const request = primary();
  await adapter.request(request);
  const text = `: 日本語 🛡️\r\n\r\n${parentSSE()}`;
  assert.equal(await observe(adapter, request, text), text);
});

test("changed action, mismatched call id and missing before hook do not invoke reviewer", async (t) => {
  let calls = 0;
  const adapter = new NativeAdapter(options({ mode: "enforce" }), new Reviewer(async () => { calls++; return response(); }));
  t.after(() => adapter.close());
  const request = primary();
  await adapter.request(request);
  await observe(adapter, request);
  const absent = permission();
  await adapter.evaluate(absent);
  assert.equal(absent.effect, "ask");
  adapter.before({ ...tool(), input: { command: "changed dangerous command" } });
  await adapter.evaluate(permission());
  const before = tool();
  adapter.before(before);
  before.input = { command: "changed again" };
  await adapter.evaluate(permission());
  assert.equal(calls, 0);
});

test("a second unmatched before event cannot reuse an earlier matching call ticket", async (t) => {
  let reviews = 0;
  const adapter = new NativeAdapter(options({ mode: "enforce" }), new Reviewer(async () => { reviews++; return response(); }));
  t.after(() => adapter.close());
  await bind(adapter);
  adapter.before({ ...tool(), input: { command: "different action" } });
  const event = permission();
  await adapter.evaluate(event);
  assert.equal(event.effect, "ask");
  assert.equal(event.message, "original manual message");
  assert.equal(reviews, 0);
});

for (const mutation of ["sparse-array", "array-property", "symbol-key", "accessor"] as const) {
  test(`non-JSON ${mutation} cannot collide with an existing native action fingerprint`, async (t) => {
    let reviews = 0;
    let getterCalls = 0;
    const adapter = new NativeAdapter(options({ mode: "enforce" }), new Reviewer(async () => { reviews++; return response(); }));
    t.after(() => adapter.close());
    const request = primary();
    await adapter.request(request);
    const input = { ...ACTION, options: [] as unknown[] };
    await observe(adapter, request, parentSSE({ output: [
      { type: "function_call", status: "completed", call_id: "call_1", name: "bash", arguments: JSON.stringify(input) },
    ] }));
    adapter.before({ ...tool(), input });
    const valid = permission();
    await adapter.evaluate(valid);
    assert.equal(valid.effect, "deny");
    assert.equal(reviews, 1);

    if (mutation === "sparse-array") input.options = new Array(1);
    if (mutation === "array-property") Object.assign(input.options, { changedAction: true });
    if (mutation === "symbol-key") Object.defineProperty(input, Symbol("changedAction"), { value: true });
    if (mutation === "accessor") Object.defineProperty(input, "changedAction", { enumerable: true, get() { getterCalls++; return true; } });
    const changed = permission();
    await adapter.evaluate(changed);
    assert.equal(changed.effect, "ask");
    assert.equal(reviews, 1);
    assert.equal(getterCalls, 0);
  });
}

for (const mutation of ["action", "permission", "prompt", "model", "account", "after", "effect", "close", "rebind"] as const) {
  test(`in-flight ${mutation} change invalidates review before any permission mutation`, async (t) => {
    const started = deferred<void>();
    const gate = deferred<Response>();
    let signal: AbortSignal | undefined;
    const adapter = new NativeAdapter(options({ mode: "enforce" }), new Reviewer(async (request) => { signal = request.signal; started.resolve(); return await gate.promise; }));
    t.after(() => adapter.close());
    const before = await bind(adapter);
    const event = permission();
    const pending = adapter.evaluate(event);
    await started.promise;
    if (mutation === "action") before.input = { command: "rm unrelated" };
    if (mutation === "permission") event.metadata!.cwd = "/different-workspace";
    if (mutation === "prompt") adapter.invalidate(SESSION);
    if (mutation === "model") await adapter.request(primary({ model: { providerID: Provider.ID.make("openai"), id: Model.ID.make("other-model") } }));
    if (mutation === "account") { const request = primary(); request.request.headers.set("chatgpt-account-id", "new-account"); await adapter.request(request); }
    if (mutation === "after") adapter.after(before);
    if (mutation === "effect") event.effect = "allow";
    if (mutation === "close") adapter.close();
    if (mutation === "rebind") adapter.before(tool());
    gate.resolve(response());
    await pending;
    assert.equal(event.effect, mutation === "effect" ? "allow" : "ask");
    assert.equal(event.message, "original manual message");
    assert.ok(signal);
    assert.equal(signal.aborted, true);
  });
}

test("expiry and unload discard captured context; no future review reuses stale parent", async (t) => {
  let now = 100;
  let calls = 0;
  const adapter = new NativeAdapter(options({ mode: "enforce" }), new Reviewer(async () => { calls++; return response(); }), undefined, () => now);
  t.after(() => adapter.close());
  await bind(adapter);
  now += 60_001;
  const event = permission();
  await adapter.evaluate(event);
  assert.equal(event.effect, "ask");
  adapter.close();
  await bind(adapter);
  await adapter.evaluate(permission());
  assert.equal(calls, 0);
});

test("HTTP failure retains manual ask and original UI message (fail-open regression boundary)", async (t) => {
  let calls = 0;
  const statuses: Status[] = [];
  const adapter = new NativeAdapter(options({ mode: "enforce" }), new Reviewer(async () => { calls++; return response("private server error", 401); }), (status) => statuses.push(status));
  t.after(() => adapter.close());
  await bind(adapter);
  const event = permission();
  await adapter.evaluate(event);
  assert.equal(calls, 1);
  assert.equal(event.effect, "ask");
  assert.equal(event.message, "original manual message");
  assert.deepEqual(statuses, ["unavailable"]);
});

test("signed-zero parent arguments cannot collide with zero tool input", async (t) => {
  let reviews = 0;
  const adapter = new NativeAdapter(options({ mode: "enforce" }), new Reviewer(async () => { reviews++; return response(); }));
  t.after(() => adapter.close());
  const request = primary();
  await adapter.request(request);
  await observe(adapter, request, parentSSE({ output: [
    { type: "function_call", status: "completed", call_id: "call_1", name: "bash", arguments: JSON.stringify({ value: 0 }) },
  ] }));
  adapter.before({ ...tool(), input: { value: 0 } });
  const valid = permission();
  await adapter.evaluate(valid);
  assert.equal(valid.effect, "deny");
  assert.equal(reviews, 1);

  for (const [argumentsJSON, current] of [
    ['{"value":-0}', 0],
    ['{"value":0}', -0],
    ['{"value":-0}', -0],
  ] as const) {
    const next = primary();
    await adapter.request(next);
    await observe(adapter, next, parentSSE({ output: [
      { type: "function_call", status: "completed", call_id: "call_1", name: "bash", arguments: argumentsJSON },
    ] }));
    adapter.before({ ...tool(), input: { value: current } });
    const changed = permission();
    await adapter.evaluate(changed);
    assert.equal(changed.effect, "ask", argumentsJSON);
    assert.equal(changed.message, "original manual message");
    assert.equal(reviews, 1);
  }
});

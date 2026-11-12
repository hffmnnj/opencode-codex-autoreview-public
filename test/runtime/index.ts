import assert from "node:assert/strict";
import { Model, Plugin, Provider, Rpc } from "@opencode/plugin";
import { ENDPOINT } from "../../src/reviewer.js";
import { abortable, object } from "../../src/json.js";
import { deferred, response, reviewSSE, sse } from "../fixtures.js";
import type { PermissionApi } from "@opencode/client/promise/api";

/** Loaded only by the offline block inside a fresh user/network namespace. */
export function bindingFixture(createPermission: PermissionApi["create"], mode: "shadow" | "enforce") { return Plugin.define({
  id: "offline-binding",
  async setup(ctx) {
    const sequence: string[] = [];
    const inputs: unknown[] = [];
    const effects: unknown[] = [];
    let dispatched = 0;
    let ended = false;
    let beforeAtEOF = false;
    let permissionHooks = 0;
    let retainedBefore: { input: unknown } | undefined;
    let retainedInputAtPermission: unknown;
    let mutate = false;
    let reviews = 0;
    let stallReview = false;
    let reviewSignal: AbortSignal | undefined;
    const reviewStarted = deferred<void>();
    const reviewAborted = deferred<void>();
    const capture: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (value: string | URL | Request, init?: RequestInit) => {
      const request = value instanceof Request ? value : new Request(value, init);
      if (new URL(request.url).hostname === "127.0.0.1" || new URL(request.url).hostname === "localhost") return originalFetch(value, init);
      assert.equal(request.url, ENDPOINT, "fixture rejects every other external endpoint");
      const body: unknown = await request.clone().json();
      assert.ok(object(body));
      if (body.model === "codex-auto-review") {
        assert.deepEqual(body.reasoning, { effort: "low" });
        reviews++;
        if (stallReview) {
          reviewSignal = request.signal;
          reviewStarted.resolve();
          return new Promise<Response>((_resolve, reject) => request.signal.addEventListener("abort", () => {
            reviewAborted.resolve();
            reject(new Error("fixture review aborted"));
          }, { once: true }));
        }
        return response(reviewSSE());
      }
      capture.push({ guardian: object(body.client_metadata) && body.client_metadata.guardian_credits_requested === "true", stream: body.stream,
        hasUser: Array.isArray(body.input) && body.input.some((item: unknown) => object(item) && item.role === "user"),
        bearer: request.headers.get("authorization") === "Bearer fixture", account: request.headers.get("chatgpt-account-id") === "fixture-account" });
      dispatched++;
      assert.equal(body.model, "gpt-6.1-sol");
      const call = { type: "function_call", id: "fc_fixture", status: "completed", call_id: "call_fixture", name: "offline_probe", arguments: '{"value":"original"}' };
      const continuing = JSON.stringify(body.input).includes("function_call_output");
      const output = !continuing ? [call] : [];
      const text = (!continuing ? [
        { type: "response.output_item.added", output_index: 0, item: { ...call, status: "in_progress", arguments: "" } },
        { type: "response.function_call_arguments.delta", output_index: 0, item_id: call.id, delta: call.arguments },
        { type: "response.function_call_arguments.done", output_index: 0, item_id: call.id, arguments: call.arguments },
        { type: "response.output_item.done", output_index: 0, item: call },
      ] : []).map(sse).join("") + sse({ type: "response.completed", response: {
        id: "resp_offline_parent", object: "response", status: "completed", model: "gpt-6.1-sol", output,
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      } });
      let sent = false;
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode(text)); }
          else { ended = true; sequence.push("stream-eof"); controller.close(); }
        },
      }), { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const providerID = Provider.ID.make("openai");
    const modelID = Model.ID.make("gpt-6.1-sol");
    await ctx.provider.transform((editor) => editor.add({
      info: { ...Provider.Info.empty(providerID), name: "Offline fixture", activation: "enabled",
        package: "@opencode/ai/providers/openai", settings: { baseURL: "https://chatgpt.com/backend-api/codex", apiKey: "fixture" },
        headers: { "chatgpt-account-id": "fixture-account" } },
      models: [{ ...Model.Info.default(providerID, modelID), capabilities: { ...Model.Info.default(providerID, modelID).capabilities, tools: true } }],
    }));
    await ctx.session.hook("title", (event) => { event.result = "Offline fixture"; });
    await ctx.session.hook("retry", (event) => { event.decision = { retry: false }; });
    await ctx.tool.transform((editor) => {
      for (const item of editor.list()) editor.remove(item.id);
      editor.add({ name: "offline_probe", description: "In-memory value recorder, no commands or IO", options: { codemode: false },
        input: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
        async execute(input, context) {
          sequence.push("executor");
          inputs.push(structuredClone(input));
          const result = await createPermission({ sessionID: context.sessionID, action: "offline", resources: ["fixture"],
            source: { type: "tool", id: context.id, messageID: context.messageID } });
          if (result.effect === "deny") return { content: "blocked without side effects" };
          assert.equal(result.effect, "allow");
          effects.push(structuredClone(input));
          return { content: "recorded" };
        },
      });
    });
    await ctx.tool.hook("execute.before", (event) => {
      retainedBefore = event;
      sequence.push("observe-before");
    });
    await ctx.tool.hook("execute.before", (event) => {
      sequence.push("before");
      beforeAtEOF = ended;
      if (mutate) event.input = { value: "changed-by-before-hook" };
    });
    await ctx.rpc.register(Rpc.define({ id: "offline-binding", methods: { run: { input: { type: "object" }, output: { type: "object" } } }, events: {} }), {
      async run() {
        try {
        await ctx.permission.hook("evaluate", (event) => {
          retainedInputAtPermission = retainedBefore?.input;
          permissionHooks++;
          sequence.push(`permission-${event.action}`);
          if (event.effect === "ask") event.effect = "allow";
        });
        const session = await ctx.session.create({ model: { providerID, id: modelID }, permissions: [
          { action: "offline", resource: "*", effect: "ask" }, { action: "offline-deny", resource: "*", effect: "deny" },
        ] });
        const deny = await createPermission({ sessionID: session.id, action: "offline-deny", resources: ["fixture"] });
        assert.equal(deny.effect, "deny");
        const explicitDenyHookCount = permissionHooks;
        await ctx.session.prompt({ sessionID: session.id, text: "Record the original fixture value using offline_probe once." });
        await ctx.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(15_000) });
        assert.ok(dispatched >= 1, "native HTTP fixture must be consumed");
        assert.equal(inputs.length, 1, "in-memory fixture executor must run once");
        assert.deepEqual(inputs, [{ value: "original" }]);
        assert.equal(reviews, 1, "actual native request, response and tool hooks must reach the shadow reviewer");
        mutate = true;
        const changed = await ctx.session.create({ model: { providerID, id: modelID }, permissions: [{ action: "offline", resource: "*", effect: "ask" }] });
        await ctx.session.prompt({ sessionID: changed.id, text: "Record the original fixture value using offline_probe once." });
        await ctx.session.wait({ sessionID: changed.id }, { signal: AbortSignal.timeout(15_000) });
        assert.equal(explicitDenyHookCount, 0, "explicit deny must bypass evaluation hooks");
        assert.deepEqual(inputs, [{ value: "original" }, { value: "changed-by-before-hook" }]);
        assert.equal(reviews, 1, "changed inputs cannot get a correlated review");
        assert.deepEqual(retainedInputAtPermission, { value: "changed-by-before-hook" }, "retained hook event sees the final replacement in this runtime");
        assert.deepEqual(effects, mode === "shadow" ? [{ value: "original" }, { value: "changed-by-before-hook" }] : [{ value: "changed-by-before-hook" }], "only the synthetic manual fallback, never the plugin, allows changed inputs");
        stallReview = true;
        mutate = false;
        const interrupted = await ctx.session.create({ model: { providerID, id: modelID }, permissions: [{ action: "offline", resource: "*", effect: "ask" }] });
        await ctx.session.prompt({ sessionID: interrupted.id, text: "Record the original fixture value using offline_probe once." });
        await abortable(reviewStarted.promise, AbortSignal.timeout(3000));
        assert.ok(reviewSignal);
        assert.equal(reviewSignal.aborted, false);
        await ctx.session.interrupt({ sessionID: interrupted.id });
        await abortable(reviewAborted.promise, AbortSignal.timeout(1000));
        assert.equal(reviewSignal.aborted, true, "native session interruption must abort review, not wait for its five-second deadline");
        return { hostVersion: ctx.app.version, mode, explicitDenyHookCount, beforeAtEOF, inputs, effects, retainedInputAtPermission, sequence, dispatched, reviews, interruptedReviewAborted: reviewSignal.aborted };
        } catch (error) {
          console.error(JSON.stringify({ fixtureError: error instanceof Error ? error.message : "unknown", reviews, sequence, capture }));
          throw error;
        }
      },
    });
    return () => { globalThis.fetch = originalFetch; };
  },
}); }

export default Plugin.define({ id: "offline-smoke", async setup(ctx) {
  await ctx.rpc.register(Rpc.define({ id: "offline-smoke", methods: { run: { input: { type: "object" }, output: { type: "object" } } }, events: {} }), {
    async run() {
      assert.equal(ctx.app.version, "2.0.25", "this fixture verifies the pinned native host only");
      const plugins = (await ctx.plugin.list()).data;
      const installed = plugins.find((item) => item.id === "opencode-codex-autoreview");
      assert.ok(installed);
      assert.equal(installed.state.status, "active");
      return { hostVersion: ctx.app.version, plugin: installed.id, state: installed.state.status };
    },
  });
} });

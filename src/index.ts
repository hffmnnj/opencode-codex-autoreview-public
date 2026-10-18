import { Plugin } from "@opencode/plugin";
import { NativeAdapter, options } from "./native.js";

export default Plugin.define({
  id: "opencode-codex-autoreview",
  async setup(ctx) {
    const config = options(ctx.options);
    if (ctx.app.version !== "2.0.25") {
      console.warn("[opencode-codex-autoreview] unsupported host version; no hooks installed");
      return;
    }
    const adapter = new NativeAdapter(config, undefined, (status) => console.info("[opencode-codex-autoreview]", status));
    await ctx.session.hook("prompt", (event) => adapter.invalidate(event.sessionID));
    await ctx.session.hook("experimental.ws.handshake", (event) => adapter.invalidate(event.sessionID));
    await ctx.session.hook("http.request", (event) => adapter.request(event));
    await ctx.session.hook("http.response", (event) => adapter.response(event));
    await ctx.tool.hook("execute.before", (event) => adapter.before(event));
    await ctx.tool.hook("execute.after", (event) => adapter.after(event));
    await ctx.permission.hook("evaluate", (event) => adapter.evaluate(event));
    const lifecycle = new AbortController();
    const observing = (async () => {
      for await (const event of ctx.event.subscribe({ signal: lifecycle.signal })) {
        if (event.type === "session.execution.interrupted" || event.type === "session.execution.failed" || event.type === "session.execution.succeeded") {
          adapter.invalidate(event.data.sessionID);
        }
      }
      adapter.close();
    })().catch(() => {
      // Losing lifecycle observation invalidates every ticket, not just the event being read.
      adapter.close();
    });
    return async () => {
      adapter.close();
      lifecycle.abort();
      await observing;
    };
  },
});

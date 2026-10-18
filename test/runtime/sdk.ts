import assert from "node:assert/strict";
import { OpenCode } from "@opencode/sdk";
import { bindingFixture } from "./index.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.OPENCODE_PROBE_ROOT;
assert.ok(root && process.env.HOME === join(root, "home"));
let host: Awaited<ReturnType<typeof OpenCode.create>>;
const mode = process.env.OPENCODE_PROBE_MODE === "enforce" ? "enforce" : "shadow";
host = await OpenCode.create({
  app: { name: "offline-binding", version: "2.0.25" },
  database: { path: join(root, "state", "sdk.db") },
  config: { directory: join(root, "config"), project: false, content: JSON.stringify({ update: "disable",
    plugins: ["*", "-opencode.provider.*", { package: fileURLToPath(new URL("../../..", import.meta.url)), options: { mode } }],
  }) }, models: { fetch: false, snapshot: false }, fs: { filewatcher: false, fff: false },
  plugins: [bindingFixture((...args) => host.permission.create(...args), mode)],
});
const originalInfo = console.info;
const statuses: string[] = [];
try {
  console.info = (...args: unknown[]) => { if (args[0] === "[opencode-codex-autoreview]") statuses.push(String(args[1])); };
  const result = await host.rpc.call({ rpcID: "offline-binding", method: "run", location: { directory: join(root, "workspace") }, input: {} });
  console.info = originalInfo;
  console.log(JSON.stringify({ ...result, statuses }));
} catch (error) { console.error(JSON.stringify({ statuses })); throw error; }
finally { console.info = originalInfo; await host.close(); }

# opencode-codex-autoreview

**Experimental permission advice and optional denial enforcement for OpenCode V2 2.0.25. It does not auto-approve actions.**

This is a real server plugin using native HTTP, tool, and permission hooks. It is not a code-review bot, a permission-dialog clicker, an official OpenAI integration, or a sandbox. The name describes the intended integration; automatic approval remains blocked by the safety limitations below.

## Install locally

Requires Node.js 22+ for development and OpenCode **2.0.25** for loading. Other host versions install no hooks and emit a fixed warning. V1 is unsupported.

```sh
npm ci
npm run typecheck
npm run test
npm run build
```

Add the built package directory to your **project-local** `opencode.json(c)`, preserving your existing configuration and plugin entries:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-codex-autoreview",
      "options": { "mode": "shadow" }
    }
  ]
}
```

Use the directory, not `src/index.ts` or `dist/index.js`: the installed 2.0.25 loader rejects configured file paths. The root `index.js` forwards to the built entry for that loader. Installation alone does not activate anything globally. Check your location's plugin catalog for an `active` entry. Package/update behavior and hooks may change between OpenCode versions.

## Modes

| Mode | Incoming `ask` with reviewer verdict | Result |
| --- | --- | --- |
| `shadow` (default) | allow, deny, or abstain | Leave the permission and UI message unchanged; report a fixed status only. |
| `enforce` (explicit opt-in) | deny | Deny this permission only, with a fixed explanation. |
| `enforce` | allow or abstain | Keep manual approval. An allow verdict reports `approval-unproven`. |
| Either | unavailable, invalid, cancelled, busy, or uncertain | Keep manual approval. |

Existing allows and explicit denies are never reviewed or changed. No mode creates an `always` approval or writes saved permission rules. An enforced deny ends the current attempt; reassess manually and change the mode before a new attempt if appropriate. No mode silently turns itself into auto-approval. Unknown options or misspelled modes reject plugin setup.

## Transport and eligibility

The plugin observes only **primary HTTP** requests using provider ID `openai`, method `POST`, and the exact endpoint:

```text
https://chatgpt.com/backend-api/codex/responses
```

The native request must already contain a Bearer authorization header and `chatgpt-account-id`, without an `api-key` or reviewer marker. The model ID must match the request body and completed parent response; it need not contain `codex`. This permits subscription-backed `gpt-6.1-sol` and `gpt-5.6-luna` traffic when it otherwise qualifies. Merely choosing either model does not establish subscription eligibility. Header shape is not cryptographic proof of OAuth or entitlement.

Eligible parent requests retain their original model, tools, instructions, and input; the plugin requests guardian credits via `client_metadata.guardian_credits_requested` and removes stale `parent_response_id` metadata. It does not invent a parent response ID. A review uses the completed parent's ID, the same account and authorization, model `codex-auto-review`, and the guardian reviewer marker. It requests structured JSON, fixed `reasoning.effort: "low"`, no tools, no storage, and no redirects. A mismatching response model or supplied account header invalidates the review. Reasoning items may accompany exactly one completed assistant assessment; their contents are ignored. An explicit allowlist accepts known lifecycle/message/text/reasoning events only: unknown events, MCP/search/tool activity, and refusals invalidate the whole review even if followed by a clean assessment. Explicit SSE event tags must match the JSON type; untagged data frames remain supported. `[DONE]` may appear once, untagged, only as a terminal marker with no later data/events.

There is **no API-key credential discovery, browser/profile access, token-file reading, automatic retry, delegated reviewer, or regular-model/billable fallback**. A normal API endpoint, another provider, a title/compaction/generate request, reviewer traffic, or WebSocket transport cannot supply context for a review. A WebSocket handshake invalidates existing context. Configure HTTP through your existing supported OpenCode provider setup if you want this experiment; the plugin never changes that setup.

**Live backend acceptance, subscription entitlement, quota, guardian credits, pricing, and free billing remain unverified.** The offline fixtures prove local integration, not acceptance by ChatGPT. This private experimental package is not published to npm.

## Why automatic approval is blocked

The adapter correlates a completed parent function call, tool name, exact JSON input, session, message ID, call ID, account, model, and current permission snapshot. It freezes evidence before awaiting the reviewer and revalidates the live input, permission, state, and execution ticket afterward. New prompts/requests, input replacement, expiry, completion, and unload invalidate old evidence. There is no cached-score authorization path.

That still is not a generic **final executed-action certificate**. OpenCode 2.0.25's permission event exposes an action, resource labels, optional metadata, and call identity, not the final executor arguments or all effects. Arbitrary registered tools can derive effects from private runtime data or perform several permission checks. Input identity alone does not prove all those effects. Native model user roles also do not prove a human authored the context: synthetic, transformed, and quoted input can share those roles. The current adapter does not certify that provenance or bind a response nonce to a final executable action.

The isolated SDK fixture establishes that later `execute.before` replacements reach the actual executor and are visible through the retained hook event. It does **not** establish immutable arbitrary executor effects or human authorization. It also exposed a timing issue: the provider can finish at `response.completed` without flushing the observed stream to EOF. Advisory/deny-only capture now records that terminal event rather than waiting for flush. It never treats that as sufficient authorization to execute.

Enabling safe approval requires a separately designed final-action/provenance contract, or a narrowly certified tool adapter, plus independent review. Removing the deny-only guard is not an implementation shortcut. False denials remain possible; keep the default shadow mode while evaluating usefulness.

## Limits and privacy

- Complete native request context up to **96 KiB**, read within **250 ms**. Unsupported partial contexts such as `previous_response_id` remain manual; nothing is silently truncated.
- Action/context canonicalization accepts dense JSON trees only, including null-prototype objects and JSON `__proto__` data keys. It rejects holes, extra/non-enumerable/symbol properties, accessors without invoking them, proxies, negative zero, cycles, and repeated object references. Negative zero is rejected rather than normalized to positive zero, preserving exact-input correlation. Traversal is limited to depth **40**, **16,384** visited values, and **256 KiB** of serialized UTF-8 output; excessive input retains manual approval rather than expanding a shared graph. Own-key enumeration happens before the key-count check, so these limits are not a constant-memory guarantee for arbitrary caller-owned objects supplied by other trusted plugins.
- At most **16** captured sessions and **16** completed tool calls per parent; parent SSE observation at most **1 MiB**.
- Captured request lifetime **120 seconds**, completed-parent lifetime **60 seconds**. Credentials/context are cleared on invalidation/unload; these are memory cleanup measures, not secure memory erasure guarantees.
- **One** review in flight per plugin instance; busy requests stay manual. Review deadline **5 seconds**, request at most **128 KiB**, response at most **64 KiB**. Timeout/cancellation aborts the underlying request and body reader. Reloads or multiple locations can have separate instances.
- The reviewer receives the complete bounded context, including user input, instructions, tool definitions, and proposed arguments, as explicitly untrusted evidence. Installing the experiment therefore authorizes additional context transmission to that same backend when eligible asks occur, even in shadow mode.
- Diagnostics contain fixed statuses only, never tokens, headers, transcripts, arguments, model reasoning, or rationale. The plugin does not control diagnostics produced by OpenCode or other plugins.

The policy is original and adapted to OpenCode's actual environment. It expressly claims **no Codex sandbox, filesystem boundary, network restriction, or rollback**. Upstream Codex was researched at commit [`8c076942cb70fba8e5c4732c23f1faabc4aed484`](https://github.com/openai/codex/tree/8c076942cb70fba8e5c4732c23f1faabc4aed484); this is not a claim to reproduce its trust boundary or inherit its Auto-review merely by calling a model.

## Development verification

```sh
npm run typecheck
npm run test
npm run build
npm pack --dry-run
caveman-blocks run fail-open-mutation
caveman-blocks run isolated-runtime --binary /path/to/2.0.25/opencode.exe --probe smoke
caveman-blocks run isolated-runtime --binary /path/to/2.0.25/opencode.exe --probe binding --mode shadow
caveman-blocks run isolated-runtime --binary /path/to/2.0.25/opencode.exe --probe binding --mode enforce
```

The Linux runtime probes require `unshare`, user/network namespace support, and `ip`; the SDK probe also requires Bun. They isolate HOME, OpenCode config/database, XDG data/cache/state, and workspace, disable updates, and leave only loopback networking inside a fresh namespace. No credential/account API is called. The native smoke verifies actual directory loading; SDK integration uses **2.0.25** with synthetic HTTP/SSE and an in-memory tool, not a command executor. The SDK is a development-only dependency. Private artifacts under `.verification/` are retained without recursive cleanup. For `caveman-blocks verify isolated-runtime`, put the exact 2.0.25 native binary's directory on PATH as `opencode.exe`; do not use a moving launcher.

See [RESEARCH.md](RESEARCH.md) for pinned public-source findings and [VERIFICATION.md](VERIFICATION.md) for actual evidence and remaining acceptance gaps. Independent review and any separately authorized live probe belong to the coordinator; these offline helpers never spend the live request budget.

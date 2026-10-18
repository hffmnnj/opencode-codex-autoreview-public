# OpenCode Codex Auto-review

## Goal

Add Codex-style review to OpenCode V2's permission gate, using the subscription-backed Codex reviewer transport where feasible. This is a permission reviewer, not a code-review bot and not a replacement for a sandbox.

## Scope and delivery

- Standalone TypeScript plugin named `opencode-codex-autoreview`.
- Repository: private `hffmnnj/opencode-codex-autoreview`; local topic branch `feat/codex-autoreview`.
- Research reference: public Codex commit `8c076942cb70fba8e5c4732c23f1faabc4aed484`.
- Prefer documented V2 `permission.hook("evaluate")`, not an event-stream auto-clicker.
- Preserve existing OpenCode authentication through supported interfaces. Never scrape browser profiles, logs, or credential files to discover tokens.
- No global activation before isolated verification. No automatic fallback to paid API-key models.
- User authorized a private PR and a spec-only bootstrap commit on main, with implementation on the feature branch. The coordinator alone owns all commits/push/PR operations; recovery workers may not mutate Git history or the index.

## Required safety contract

1. Explicit configured deny remains final. An incoming deny must never be promoted.
2. Initial coverage is pending `ask` decisions only. Existing allows remain unchanged unless a later explicit option expands coverage.
3. Default is shadow/advisory mode; enforcement requires explicit configuration.
4. Review an exact, complete action and an attributable user-authorization/context snapshot. If complete trustworthy context cannot be obtained, retain manual approval.
5. A positive model verdict may permit only the current action, never create an `always` approval or mutate saved permission rules.
6. Review errors, missing OAuth, HTTP failures, malformed or oversized output, unsupported tool requests, timeout, cancellation, context overflow, and incomplete action evidence must never become approval.
7. Treat tool results and assistant arguments as untrusted evidence, not proof of user authorization. Preserve provenance when formatting context. Adapt Codex policy's environment assertions to OpenCode's actual environment rather than claiming Codex's sandbox exists.
8. No delegated reviewer agents, nested runs, model tool execution, speculative pre-approvals, or adaptive cached-score fast paths in the initial version.
9. Bound network latency, request/response size, and concurrency; abort underlying I/O when timed out.
10. No auth headers, tokens, command payloads, transcripts, or model reasoning in diagnostics. Minimal status metadata only.
11. Never silently replace subscription transport with billable regular inference. External eligibility and free billing are unproven until a live supported probe establishes them.

## Current delivery boundary

- This release is explicitly **experimental advisory/deny-only**, not functioning automatic approval. Default `shadow` never changes permissions; opt-in `enforce` may only change a current ask to deny. Allow verdicts always remain manual.
- Offline 2.0.25 integration proves explicit-deny hook bypass, tool-hook replacement ordering, real directory loading, and a correlated shadow review. Generic final executor effects and attributable human authorization are not certified by these hooks; see README for the concrete approval blocker. There is no action-bound response nonce approval contract.
- Native HTTP observation must capture terminal `response.completed` without relying on EOF flush; the real provider can stop consuming at that event. This is sufficient only for the advisory/deny-only scope above.
- One tiny synthetic authenticated parent and at most one linked review are separately authorized **after safety checks and independent review**. The coordinator reserves this budget. Recovery workers must not run live authenticated requests; stop any eventual probe on auth/quota/billing errors, execute no commands, and do not retry or fall back.

## Acceptance checks

- Strict TypeScript compilation and package build.
- Focused runtime tests of allow/deny/manual fallback and default-shadow behavior.
- Real transport adapter exercised against controlled HTTP/SSE fixtures; assertions cover exact request purpose and decisions, not source strings.
- Detect a deliberate fail-open production mutation, restore it, and rerun affected checks.
- Invalid/missing authorization, mismatched action, invalid JSON, HTTP/auth failure, incomplete stream, timeout/cancellation, and ambiguous context keep `ask`.
- Explicit denies invoke no reviewer; already allowed actions invoke no reviewer in the initial mode.
- Installation/loading verified against an isolated OpenCode V2 process if safe supported APIs permit it. Do not restart or alter the active server for this check.
- Independent whole-workflow security review after integration. Any live subscription/billing test is separately identified; fixture tests cannot prove entitlement.

## Parallel unrelated repair

Separate owner repairs only the unrelated project's MCP registration and bundled skill under the user's explicit authorization. No native engines, broad configuration changes, or service restart. This work must not modify plugin files.

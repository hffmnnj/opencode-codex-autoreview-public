# Roadmap

## Delivery checkpoint

Private draft PR: [#1](https://github.com/hffmnnj/opencode-codex-autoreview/pull/1), `feat/codex-autoreview` → `main`. The base contains only the authorized spec bootstrap (`fa668cd`); production implementation and offline verification are committed in `cc7c137`. Remote head, draft/open state, base/head branches, private repository, and changed-file inventory were checked. No merge, npm publication, or global activation occurred. Full automatic approval is not delivered.

## Done: implementation and offline evidence

- Original conservative OpenCode-specific reviewer policy and exact-endpoint subscription transport; no credential discovery, retries, delegated agents, or regular-model fallback.
- Default shadow and explicit denial-only enforcement. Reviewed allows always retain manual approval. README/package description explicitly say this is not working auto-approval.
- Exact primary model/account/call correlation, frozen bounded context, current-ticket revalidation, invalidation/expiry, and bounded I/O/concurrency.
- Eligibility no longer assumes `codex` appears in a primary model's ID. Fixtures cover `gpt-6.1-sol` and `gpt-5.6-luna`.
- Reviewer parsing accepts reasoning plus exactly one assistant message, discards reasoning contents, and rejects tool/unknown actionable output or mismatched reviewer model/account.
- Fixed real-runtime EOF timing: completed parent calls are captured at `response.completed`; native provider consumption need not flush the observer.
- Added lifecycle observation to abort in-flight reviews on session interruption/failure/success and on unload; loss of observation closes the adapter.
- Local-directory root entrypoint fixed and verified in the real **2.0.25** native binary, isolated from the active service.
- Exact **2.0.25** SDK development dependency for real native provider/tool/permission integration, inside a no-external-network namespace. Tests exercise shadow review, deny-only enforcement, changed inputs, explicit-deny hook bypass, and interrupted-review cancellation with no command executor.
- Final integration passed 97 behavioral tests, strict typecheck, build, and package dry-run. Independent whole-workflow review and focused correction review are complete for the advisory/deny-only production scope; exact evidence and diagnostic limitations are recorded in `VERIFICATION.md`.
- Named HTTP-failure-auto-allow production mutation detected at the permission-effect assertion in an isolated source copy: green → red (`allow` versus `ask`) → restored green. Production sources were never mutated for this probe.
- README, MIT LICENSE, spec authority/budget clarification, reusable verification blocks, and explicit local `package-lock.json` inclusion. The lock was excluded by a global Git ignore; project-local negation fixes it without Git index changes.
- Public Codex research reference remains pinned to `8c076942cb70fba8e5c4732c23f1faabc4aed484`; no Codex sandbox is claimed.
- Unrelated repair completed separately per coordinator handoff; not retested or modified by the recovery worker.

## Compatibility investigation checkpoint

1. Completed independent whole-workflow review and resolved its two low-severity findings. Separate focused review passed the bare post-DONE SSE and signed-zero corrections; coordinator integration passed 97 tests, build, package, mutation, native smoke and both SDK modes. The own-key enumeration resource qualification is documented. Remaining live-harness review is separate from this production acceptance.
2. The separately developed compatibility helper refuses live admission because its native parent transport cannot yet establish the required redirect/cancellation safeguards. Independent offline review is in progress. **No authenticated live probe has run; the reserved budget remains unused.** Do not bypass this gate or infer entitlement from offline tests.
3. Git delivery is complete at the checkpoint above. The compatibility helper remains local, untracked research outside the draft PR; it is not a production plugin feature.

## Blocked / separate scope

- **Generic automatic approval:** no final executed-action certificate, certified tool implementation/effects binding, or authoritative human-origin context/nonce contract has been established. Do not remove the deny-only guard or claim Codex Auto-review is fully reproduced.
- **Live entitlement and billing:** offline fixtures cannot establish endpoint/schema acceptance, guardian credits, quotas, or no-charge operation.
- **Newer hosts:** during recovery the `opencodev2` wrapper resolved to **2.0.32**, but the coordinator subsequently confirmed the existing server's `/api/info` still reports **2.0.25**. Launcher selection is not the running service version. An accidental isolated example using that wrapper hit a fixture dependency incompatibility; the production plugin correctly declined to install hooks in that isolated 2.0.32 process. Support remains pinned to 2.0.25. Native checks must use the exact native binary, not the moving wrapper; broadening compatibility needs separate scope/review.
- Development dependency audit reported 17 transitive findings during SDK installation; production-only audit reported zero. No unrelated dependency upgrades or audit fixes were applied.

## Follow-up safety fixes before final review

- Applied the coordinator's mini-verifier findings without removing the denial-only guard: preserve CRLF carry through empty decoded chunks; bind explicit SSE tags to JSON types and make DONE terminal; explicitly allowlist inert reviewer event families; reject refusals/actions hidden in known event payloads.
- Replaced lossy/unbounded canonicalization with descriptor-only dense JSON traversal. It never reads accessors, rejects symbols/extra properties/proxies/repeated references, and bounds visited values, depth, key work, and serialized UTF-8 output. Native fingerprint collision regressions exercise the real adapter, not just the helper.
- Fixed reviewer reasoning effort to `low`; standalone request and real SDK fixtures assert the exact contract. Live backend acceptance remains unverified and no retry/fallback was added.
- New regression tests were run against the original production code first: **23 expected behavioral failures**, including wrong deny instead of ask for sparse/extra/symbol input and unsupported MCP/search events accepted as assessments. The small repeated-reference fixture reproduced the missing rejection in milliseconds rather than triggering the reported long exponential expansion.
- Historical fixed-tree worker checkpoint: typecheck, **93/93 tests**, build, pinned-native smoke, shadow/enforce SDK probes including interruption, fail-open mutation, Block lint/verification/sync, and package dry-run passed. Subsequent independent review found two additional edge cases; both were corrected and independently rechecked, followed by the coordinator's final 97-test integration. Exact artifacts are recorded in `VERIFICATION.md`.

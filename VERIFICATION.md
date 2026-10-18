# Verification evidence

Recovery implementation checkpoint: 2026-10-18. These are worker-run checks, **not independent verification**. The active OpenCode service and global configuration were not changed. No credentials/accounts were read, no live authenticated request was made, and the coordinator's live budget is untouched.

## Commands and observable results

| Check | Observed result |
| --- | --- |
| `npm run typecheck` | Passed production and test strict TypeScript configurations, including the runtime fixtures. |
| `npm run test` | **93 passed, 0 failed, 0 skipped** on the final parser/canonicalization-fixed tree. |
| `npm run build` | Passed; built ESM and declarations in `dist/`. |
| `npm pack --dry-run` | Passed; package includes root directory-loader entry, built modules/declarations, README, LICENSE, and verification report. No tests, runtime probes, or private artifacts are packaged. |
| `caveman-blocks lint` | Passed after correcting block metadata. |
| `caveman-blocks verify fail-open-mutation` | Passed: focused baseline green, named fail-open mutant red at `actual: 'allow'` / `expected: 'ask'`, restored green. |
| `PATH=/path/to/2.0.25/bin:$PATH caveman-blocks verify isolated-runtime` | Passed against explicitly pinned `opencode.exe`; block index/stamp updated. `caveman-blocks sync` then reported nothing changed. |
| Native `isolated-runtime --probe smoke` with exact 2.0.25 binary | Passed: actual native plugin catalog reports `opencode-codex-autoreview`, state `active`, host 2.0.25. Evidence: `.verification/runtime/smoke-pjrkgt86/`. |
| SDK `isolated-runtime --probe binding --mode shadow` | Passed again after the parser/canonicalization fixes against exact 2.0.25 SDK: one normal linked review, changed input manual fallback, explicit deny bypass, then a second deliberately stalled review aborted by real session interruption before its five-second deadline. Evidence: `.verification/runtime/binding-14qewukn/`. |
| SDK `isolated-runtime --probe binding --mode enforce` | Passed again after the parser/canonicalization fixes: deny blocked the normal in-memory effect, changed input was not reviewed, only the fixture's explicit manual-fallback hook permitted changed input, and session interruption aborted the stalled reviewer before its five-second deadline. Evidence: `.verification/runtime/binding-s2e_k1ze/`. |
| `npm audit --omit=dev --json` | Reported **0 production vulnerabilities**. SDK installation's complete development tree reported 17 findings (8 low, 4 moderate, 5 high); no automatic fixes. |

The native executable was the pinned OpenCode V2 2.0.25 release binary.

The blocks retain per-run synthetic stdout/stderr and isolated databases/config under ignored `.verification/`. They use `unshare -Urn`, enabling only loopback, whitelist the child environment, isolate HOME/OpenCode config/XDG data/cache/state/DB, and disable updates. The SDK disables model fetching/snapshots. Its fetch fixture permits only loopback or the single scripted endpoint; external networking is also absent at the namespace boundary. In-memory value recording replaces command execution.

## Important runtime discoveries

1. The installed 2.0.25 local-directory loader resolves the root `index` entry instead of relying on this package's `exports`. Adding root `index.js` fixed real native loading. Configured file paths were rejected by this installed version despite newer documentation examples.
2. Explicit configured deny returns deny without calling permission evaluation hooks. A positive fixture case confirms hooks do execute for asks, so the deny assertion is not satisfied by an inert plugin.
3. Later `execute.before` input replacement reaches the executor and is visible via the earlier retained event object. Changed model arguments do not get a correlated plugin review.
4. The provider can terminate its stream consumption at `response.completed` without invoking the response observer's EOF flush. Capturing only in `flush` produced zero reviews in the real SDK fixture. Capturing completed calls at the terminal event produces a real linked review; byte-exact forwarding remains covered by unit tests.
5. Session interruption must cancel the review separately from the five-second timeout. Production now observes terminal execution lifecycle events, invalidates tickets, aborts I/O, and closes this observer on unload. The SDK stalls a real reviewer request, interrupts its session, and requires abort within one second, before the independent five-second review timeout.

## Production-fault detection

`.blocks/fail-open-mutation.py` copies the sources and tests into a fresh retained scratch directory and symlinks the existing dependencies. It changes only the scratch `result.status !== "assessed"` fallback to set `event.effect = "allow"`, then runs the public adapter's HTTP-401 permission regression. The test fails at the intended effect assertion, not compilation/setup. The block restores only that scratch mutation and reruns green. Original production source is untouched.

An initial passing run is retained at `.verification/mutation/fail-open-v1toi7k0/`; the verified block also retains its own fresh baseline/mutant/restored TAP artifacts. This proves detection of that named fault, not exhaustive security.

## Failures diagnosed, not hidden

- Initial network-namespace smoke could not call its private loopback server while `lo` was down. The helper now enables loopback inside the isolated namespace, not external networking.
- Listing plugins alone returned an unactivated catalog. The native smoke now invokes a fixture RPC that requires activation and asserts the loaded package's state.
- Primary model substring eligibility excluded real ChatGPT model names; explicit gpt-model fixtures cover the corrected exact transport-based eligibility.
- Model completions containing reasoning were incorrectly rejected. Realistic reasoning-plus-message fixtures now pass; tool calls, duplicate messages, unknown actionable items, and mismatched model/account still fail closed to manual.
- The first block verification example used the moving `opencodev2` wrapper. By then it selected 2.0.32, whose runtime module versions could not load the 2.0.25 fixture (`Schema.isStartsWith is not a function`). Production logged `unsupported host version; no hooks installed`, as designed. The example now uses `opencode.exe` from an explicitly pinned PATH; 2.0.32 support was not silently added.

## Mini-verifier follow-up fixes and worker checks

The coordinator supplied a scoped independent review of the **prior** JSON/SSE/reviewer stream implementation. The following corrections were made by this worker and are **not yet independently verified**:

1. Empty decoded chunks no longer consume pending CRLF carry. Valid and invalid multiline JSON frames are tested across every UTF-8 byte split, inserted empty chunks, and byte-at-a-time decoding. Invalid joined JSON can no longer turn into two valid events.
2. Reviewer intermediate events use an explicit lifecycle/message/text/reasoning allowlist rather than substring denial. MCP, search, computer, refusal, and future unknown events invalidate a clean later assessment. Actionable/refusal payloads inside otherwise known events also invalidate it. Positive tests preserve legitimate reasoning event families and exactly one assistant assessment.
3. Explicit SSE tags must match JSON `type`; bare data remains valid. Duplicate/conflicting/missing-data tags fail. DONE is untagged and terminal, rejecting duplicates, later data (including empty data frames), tagged markers, and incomplete framing.
4. Canonicalization uses own data-property descriptors and never invokes accessors. Sparse arrays, array extras, symbols, non-enumerable properties, proxies, cycles, and repeated references reject instead of colliding or expanding. Dense normal JSON, null-prototype objects, and JSON `__proto__` keys remain accepted. Depth 40, 16,384 visited values, bounded key work, and 256 KiB serialized UTF-8 cap work/output. Native adapter regressions first establish a real valid review, then confirm malformed mutations retain ask without another review or getter execution.
5. Reviewer requests now explicitly set `reasoning: { effort: "low" }`; the request-contract unit fixture and real SDK fixture assert that exact field. This does not prove backend acceptance and adds no retry or fallback.

Before production edits, the focused regression command selected **23 tests and all 23 failed at the expected behavioral assertions**. Examples included `deny` instead of `ask` for colliding action objects, a getter invocation, unsupported MCP/search events producing an assessment, and split-dependent SSE parsing. The shared-reference counterexample was deliberately small (12 levels): it failed the missing rejection in milliseconds rather than causing the reported long exponential blow-up.

After the fixes, strict typecheck and the initial focused JSON/SSE/reviewer run passed (48/48). Final regression checks then passed **93/93**, build, native pinned-binary smoke verification, both SDK modes including interruption, fail-open mutation verification, Block lint/sync, and package dry-run (15 intended files). The bounded JSON rejection test completed in approximately 11 ms in that final run; this is observed test evidence, not a cross-machine performance guarantee. No live authenticated request or global/Git operation was used.

The coordinator also clarified that the **existing server `/api/info` reports 2.0.25**, despite the launcher selecting 2.0.32. That service version was coordinator-confirmed, not independently queried by this worker. The 2.0.25 target remains correct; launcher selection is not evidence that the running server was upgraded.

## Remaining acceptance gaps

### Independent full-workflow review checkpoint

A separate read-only verifier freshly passed all 93 tests, strict typecheck, a scratch-output build matching `dist/`, package dry-run, Block lint, pinned-native smoke, both network-isolated SDK modes, and the named fail-open mutation. It also exercised the real entrypoint's unsupported-host guard and WebSocket-handshake invalidation through an offline hook harness. It did not read credentials or make external inference requests.

The review was **not unconditional acceptance**: it found two low-severity strict-contract defects, neither permitting an action. A bare SSE `data` field after DONE was ignored rather than rejected, and negative zero collided with positive zero under JSON serialization. Focused corrections and independent regression verification are pending at this checkpoint. The review also qualified resource bounds: `Reflect.ownKeys` enumerates all keys before the width check, so there is no strict constant-resource guarantee for arbitrary caller-owned objects. README now discloses that boundary.

The coordinator separately reran `npm run typecheck && npm run test`: **93 passed, zero failures or skips** before these final edge-case corrections. This is coordinator validation, not a substitute for the independent report.

### Final edge-case correction integration

The two corrections are now applied: the SSE parser recognizes bare `data` as an empty data field, and canonicalization rejects negative zero at every nesting level rather than erasing its sign. Separate workers demonstrated the new regressions failing on the old behavior before their minimal production changes. An additional production Reviewer test establishes valid assessment first, then requires manual fallback for both empty post-DONE field spellings with exactly one request.

The coordinator reran strict typecheck, **97/97 tests with no failures or skips**, build, package dry-run, Block lint, the green/red/green fail-open mutation, pinned-native directory loading, and both network-isolated SDK modes including interruption. All passed. Retained artifacts: `.verification/mutation/fail-open-_6igm_79/`, `.verification/runtime/smoke-1desl7yu/`, `.verification/runtime/binding-7j5e4sde/`, `.verification/runtime/binding-gpu8b44v/`. A fresh production-only `npm audit --omit=dev --json` reported **zero vulnerabilities**.

A separate focused read-only verifier then passed these two production corrections, running **97/97** JSON/SSE/native/Reviewer tests and strict typecheck. Additional production-code diagnostics confirmed both signed-zero mismatch directions, in-flight negative-zero replacement, ordinary finite-number acceptance, all byte splits of terminal empty fields, valid review positive controls, and the no-approval invariant. Its supplemental diagnostic had one overly strict status-count assertion fail (`manual` was emitted twice); permission effect remained ask and no reviewer was invoked. This was disclosed, not counted as a passed diagnostic. The coordinator subsequently retained both signed-zero directions and the rejected negative-zero/negative-zero case in the repository's native regression test. A negative zero anywhere in a captured primary request conservatively disables review for that turn.

- **No generic auto-approval.** Input correlation is not proof of all executor effects or attributable human authorization. There is no established final-action/nonce approval contract. Both the package and README explicitly scope this release as experimental advisory/deny-only.
- **No live backend or billing validation.** Exact endpoint, model availability, request/schema compatibility, guardian credits, entitlement, quotas, and no-charge operation are assumptions pending the separately budgeted probe.
- No guarantee of compatibility with OpenCode versions other than 2.0.25. The moving wrapper selected 2.0.32 during recovery, while the coordinator confirmed the existing server still reports 2.0.25.
- The full offline review and focused independent correction review are complete for the advisory/deny-only production scope. The separately developed live compatibility harness requires its own safety review before it can spend the reserved budget. These offline checks do not establish backend acceptance or generic auto-approval.
- No commits, pushes, PR, deployment, or global activation performed by this worker. Git publication belongs to the coordinator.

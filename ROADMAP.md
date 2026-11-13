# Roadmap

## Current status

`opencode-codex-autoreview` is an experimental OpenCode V2 plugin for OpenCode
2.0.25 that adds a Codex-style reviewer to the permission gate. It defaults to
`shadow` (advisory only); opt-in `enforce` can change an incoming `ask` to a
deny. Allow verdicts always retain manual approval. It does not deliver working
automatic approval, and it is not a code-review bot, a permission-dialog
clicker, or a sandbox.

The reviewer uses the existing subscription authorization and the fixed Codex
endpoint; there is no API-key discovery, browser/profile access, retry,
delegated reviewer, or billable regular-model fallback. Reviewer errors,
unavailable or untrustworthy context, malformed output, unsupported events,
timeouts, cancellation, and uncertain verdicts keep manual approval. Diagnostics
contain fixed statuses only.

See the [README](README.md) for installation, modes, and limits, and
[VERIFICATION.md](VERIFICATION.md) for evidence and remaining gaps.

## Blocked / separate scope

- **Automatic approval:** no final executed-action certificate, tool-effect
  binding, or authoritative human-origin contract exists. OpenCode 2.0.25
  permission hooks expose action and resource metadata plus call identity, not
  final executor arguments or all effects. Do not remove the deny-only guard or
  claim Codex Auto-review is reproduced.
- **Live entitlement and billing:** offline fixtures cannot establish
  endpoint/schema acceptance, guardian credits, quotas, or no-charge operation.
  Live backend acceptance and subscription eligibility remain unverified.
- **Other hosts:** support is pinned to OpenCode 2.0.25. Other versions install
  no hooks and emit a fixed warning. Broadening compatibility needs its own
  design and review.
- **Dependency audit:** development dependencies reported transitive findings;
  the production-only audit reported none. No unrelated upgrades or audit fixes
  were applied.

## Follow-ups

- Design and review a final-action/provenance contract, or a narrowly certified
  tool adapter, before any approval-capable mode.
- Verify live backend acceptance and billing separately with an authorized,
  bounded probe.
- Revisit host compatibility only with a tested native target version.

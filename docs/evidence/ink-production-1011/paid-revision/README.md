# Paid single-scene revision — 2026-10-10 UTC

Implementation baseline: a2551a6ba4b331c84b5e0bb34aaf317a459f1b58. During integration root merged main at 56e1114ddb623ec42fa462f7eebca97d5a46616c. This subagent did not commit, push, merge or deploy.

## Delivered path

`revisionPrepare` reads the owned completed saved project and selected scene, builds a complete single-shot quote without occupying a revision or charging. The paid UI shows the amount in a cancellable confirmation dialog. `revisionSubmit` locks that quote into the root revision ledger, creates one deterministic child project and a child grant with one permitted video scene. It keeps previous images, audio and unaffected clips.

The child uses the existing Motion Production UI and `codeMotionProduction.submit`: immutable shot manifest → fixed slot → existing canvas intent → `chargeCanvasVideoCredits` → existing canvas worker → receipt → adopt. The server-only `inkRevisionVideo` price mode validates the persisted grant and quote; it cannot accept a client-supplied price. Initial production and homepage price modes remain unchanged. Unknown submissions keep the original intent/task and do not automatically resubmit/refund.

Paid revision costs use the versioned official fixed-duration contract at https://evolink.ai/seedance-2-5: 720p image/audio reference $0.296/output-second; current preserved content_filter=false adds 10%; USD→CNY 7.2 and 0.65 CNY/platform-credit; user-requested markup ×2. Five seconds is $1.628 of metered published-rate cost and 37 platform credits after rounding up. These are platform credits, not provider credits. The record explicitly says `published_rate_fixed_units`; it is not an upstream invoice or an observed provider-account debit. Exact supplier billing reconciliation remains a separate verification boundary.

The original provider submit body and completed poll body are archived. The worker verifies the fixed task duration/charged credits/confirmed quote and a successful raw receipt before writing a create-only cost settlement. Missing or inconsistent receipts preserve the task for reconciliation, not a second charge. The existing failure/refund path remains in effect for definitive provider failures.

User's latest free generation limit is enforced at both prepare (reject >2 natural scenes before work) and CAS slot reservation (max two distinct <=5-second video slots; same-slot recovery allowed). This is separate from two free local revisions. New `image_semantic:0` is one fixed grant slot and forbidden on code-only revisions.

## Evidence

- `affected-regression.txt`: 19 affected existing grant/video/revision/clone tests passed.
- `worker-provider-regression.txt`: 28 worker/provider tests passed, including unknown-submission safety.
- `quote-grant-settlement.txt`: new locked paid quote → child grant → strict amount → successful receipt → immutable settlement and restore probe passed; wrong amount and missing receipt blocked.
- `formal-entry.txt`: new paid one-scene production restores with exactly one charge/task; free >2 scenes does zero work, 2 tests passed.
- `terminal-receipt.txt`: successful terminal raw callback and persistence-failure behavior, 1 test passed.
- `browser.txt`: real local Chrome with fake transport, 2 tests passed. Free cancellation/remaining count and paid 37-credit confirmation/cancellation/locked fingerprint were exercised. Corresponding screenshots and JSON are one directory above.
- Free concurrent reservation cap test passed in `/tmp/ink-paid-final-new-tests.log`; that log also contains an earlier fixture-only image-schema failure subsequently corrected and passed in `quote-grant-settlement.txt`.
- Full repository TypeScript check is owned by the root agent. This subagent's overlapping check was explicitly interrupted (exit 130), not claimed as passed.

## Boundaries

No paid model was invoked by this subagent. No deployed/online acceptance was performed. Provider-model generation for the separate authorized coffee probe is owned by root/other agents and is not evidence for this paid revision path.

Paid revisions with an existing video reference are explicitly rejected before submitting or charging, because their full input-duration + potential normalization/upscale cost path is not yet wired into this revision quote. No video references are silently discarded. Existing image and voice/BGM references remain supported, with audio references using the formal exact scene-window mix.

The UI saves the child revision first; the user submits/reviews the actual model prompt and media in the existing Motion Production section, then adopts and exports. It does not silently auto-submit a model merely by saving the partial edit.

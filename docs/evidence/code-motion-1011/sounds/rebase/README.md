# Measured speech adoption and recoverable timeline extension

Base HEAD: `0ad90a8a7b21ffc5d20993657c80c894cd7eadc9`. This records the uncommitted PR1697 integration slice; the parent owns the final commit, sole full typecheck and push. No real paid generation, deployment or rig operation was performed here.

The formal Studio now uses `codeMotion.adoptSoundAndSave`. The old source-only `adoptSound` endpoint remains compatible. Server-side adoption obtains the original succeeded sound request and decoded immutable source; it never accepts a client-supplied duration. A longer speech extends only that scene and its composition duration, shifts later audio placement, and preserves image/speech request identities and source hashes. Pure code uses frame-aligned duration; dialogue/natural model scenes round up to legal whole seconds. Free5/paid30 single-model limits and existing production capability limits remain enforced.

Before changing a grant's fingerprint, the server permanently saves a target-project journal, then CAS-locks the original grant. A pending lock prevents new cost slots. Project save and grant completion can each be resumed with the same journal after a lost response; no second claim, speech purchase or image identity is created. Existing or concurrently reserved video/export slots block extension, as do unrelated storyboard edits. Later image/audio saves are never overwritten by replaying an old adoption snapshot. Successful original sources and journals remain retained on failure.

The browser persists the original adoption request and expected generation before submission. On unknown response or reload it resumes that request without saving stale local content first. Only an explicit server pre-submission rejection clears the pending identity. The UI shows the measured duration and extension before adoption.

Verification:

- `service-transaction.txt`: 7 targeted service cases PASS: formal submit/adopt/save/restore with preserved speech/image slots; interrupted project save; interrupted grant completion; reserved video/export gates; CAS race with a new video; unrelated changes and owner isolation.
- `router.txt`: 1 targeted PASS for the new authenticated saved-generation route and compatibility of the old adoption route.
- `browser-flow.txt`: 2 real Chrome cases PASS, transport mocked and external network blocked: response lost after save→reload→same generation/request, and the full Studio sound generation/adoption/reopen flow. `browser.json` and `restored.png` record the first path. No provider call is represented by these UI tests.
- `preflight-rejections.txt`: the 3 reservation/storyboard rejection cases passed after the explicit non-submission error was added. Its fourth test was subsequently corrected to exercise an actual overlong dialogue instead of only a narration-role mismatch; the corrected result is below.
- `restore-and-limit.txt`: 2 targeted PASS: actual free dialogue overflow fails before journal/project mutation; re-adopting an earlier sound preserves a later saved image change.
- `model-and-timing.txt`: 2 targeted PASS: a4.72-second dialogue in a4-second scene becomes a legal5-second formal video preparation; later source-relative word timing follows an audio shift from10.2 to11.3seconds while preserving its0.2-second in-scene position. Source timing metadata stays source-relative, so it is not moved independently or fabricated.
- `browser-rejection.txt`: 1 additional real Chrome PASS for an explicit pre-submission failure clearing only its local pending identity, while the existing unknown-response case is reused.
- `git diff --check`: PASS. Full TypeScript verification is performed once by the parent after product-code freeze.

The parent's incremental typecheck exposed a control-flow inference issue: the `never` rejection helper was an inferred arrow binding. It is now an explicitly declared `never` function, allowing TypeScript to narrow validated data and definite assignment without assertions. Two test mock return values now retain their literal types. Runtime behavior is unchanged, so the passed runtime probes were not repeated; the parent owns the failed typecheck recheck.

Final integration result: the parent's single `pnpm check` recheck exited0, with original output at `/tmp/pr1697-sound-rebase-types-r2.log`; `git diff --check` also passed. Product code and this evidence document are frozen for the parent’s commit.

Remaining boundaries: free dialogue exceeding5seconds and paid model dialogue exceeding30seconds remain provider-scope conflicts; their original sound is retained and no replacement is bought. A different manual project edit during a pending transaction is reported as a conflict rather than overwritten. This slice does not claim real Qwen billing/provider acceptance or online deployment acceptance; those are separate from the controlled fake-provider formal entry tests.

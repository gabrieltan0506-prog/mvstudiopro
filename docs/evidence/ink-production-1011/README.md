# PR1697 production / revision evidence

Worktree base HEAD: `9a3c808649514b22141889982bea2c268569101a`. This subagent added changes to the shared worktree without committing, pushing, merging or deploying. The parent owns the final integrated HEAD and verification.

## Delivered code

- Production grant binds one account, project and fixed shot budget before providers. Free uses the existing one-per-account / ten-new-accounts-per-day / same-IP contract; paid initial production uses the existing homepage intent, charge, task and refund services.
- Backend selects Mini 480p or 2.5 720p and 4–5-second natural shots; code shots make no video-model calls. Audio references are the exact scene window of the saved final mix. Uploaded originals referenced by composition also work when `scene.imageId` is absent.
- Immutable video manifest, original/parsed provider receipts with hashes, real output SHA/ffprobe adoption, authenticated preview refresh and recovery through the original provider task. Unknown submission does not create another task or trigger automatic refund.
- Code-only partial revision uses a server CAS ledger with two free confirmed submissions per original project, shared by all child versions. Preview/cancel consumes none. Stable content digest plus persisted client request restores ambiguous responses without another allowance. Child exports share the original free claim, and parent audio/video reuse requires exact authoritative snapshot identity.
- Revision confirmation uses an accessible dialog, shows the free allowance after submission, and displays an upgrade message at zero. Paid code-only revision invokes no external paid tool and costs zero.

## Probes and raw evidence

| Path / evidence | What ran |
| --- | --- |
| `audio-reference-probe.json`, `five-second-reference.wav`, `ink-production-audio-real-test.log` | Real FFmpeg/ffprobe: 20-second 440/880 Hz technical mix trimmed to precisely 5 seconds / 240000 sample frames, both components retained, restored without another mix. No model call. |
| `ink-production-export-test.log`, `ink-revision-export-test.log`, `ink-pure-code-grant-test.log` | Real PGlite SQL: concurrent free cap, paid/free export gates, child export retaining one original claim, pure-code first export through actual production queue. |
| `ink-production-video-test.log`, `ink-production-video-audio-r2.log`, `ink-production-reused-image-test.log` | Formal preparation/submission with fake provider/charge: fixed requests, initial paid contract, Mini/2.5 policy and short audio, preserved uploaded image references. |
| `ink-production-worker-unknown-r2.log`, `ink-production-worker-evidence-r2.log`, `ink-production-provider-receipt-test.log` | Actual worker task files and actual provider request builder with fake HTTP: raw/parsed receipts; unknown / missing handle preserves original task and no refund; definitive 400 vs ambiguous 429/500. |
| `ink-revision-service-test.log`, `ink-revision-ownership-test.log`, `ink-revision-reload-test.log`, `ink-revision-official-export-r2.log` | Revision CAS limit, stable request restoration, ownership, and official compiler → submit → queue preserving parent audio and untouched generated video. |
| `ink-revision-dialog-browser-r2.log`, `revision-dialog-browser.json`, `revision-dialog-after-confirm.png` | Real Chromium with fake RPC and blocked external network: cancel makes no request/storage entry, confirm makes one request, remaining-zero upgrade message. |

Earlier failing logs are retained where applicable; targeted reruns correspond to the repaired failure or affected behavior. These probes do not represent paid live provider generation or deployment acceptance. Synthetic tones prove mix/window handling, not natural speech intelligibility or provider lip sync.

## Remaining scope

Paid model-driven partial regeneration and its actual-tool-cost ×2 settlement are **not connected**. Official current Seedance 2.5 rates have been verified by the parent, but ordinary homepage retail prices are not re-labelled as tool cost. Current revision grants deliberately allow code-only export and reject new image/audio/video generation slots. Older legacy exports without a production grant cannot yet become partial revision projects. Formal online acceptance is excluded by the user.

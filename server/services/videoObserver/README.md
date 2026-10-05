# Existing Video Observer adapter

Source: `/Users/tangenjie/Documents/Codex/2026-10-03/task-4/video-observer/SKILL.md`.
`contract.mjs` copies the existing pure `coverage`, `validateAnalysis`, `responseSchema`, and `buildRequest` functions unchanged. Source SHA256: 44a4dc005f56fcf15e6eb89c11e57752d027548759e0e95563e18c21f3919ca0. The declaration file adds types, not a new provider contract.

The website supplies owned GCS media, ffprobe metadata, generation checks before generation, and its existing advisor confirmation/billing/job lifecycle. It saves the full observer analysis separately from the legacy UI projection. Whole original MP4 only, no audio extraction/upload, no automatic generation retry. A monitor role instruction augments the original request. Defaults retained: 12 requested fps, temperature 0.2, maxOutputTokens 16000, responseSchema; no invented thinking setting.

The standalone CLI is not invoked by the website. CLI filesystem paths, source discovery and interactive authorization are not suitable for an authenticated multi-user server. The source is resolved through the existing ownership gate before metadata reads. CountTokens and one generation are separate requests. Verified pricing is not available in this adapter: receipts explicitly retain null cost with usage; no free-cost claim or guessed price. Existing platform credit charges are unchanged.

Verification: 1005-observer-adapter-tests.log (3 affected fake cases), 1005-observer-existing-receipt-replay.json (original 106.176-second receipt: identical request and validation, 2655 AUDIO tokens, no network calls). These are development evidence, not live acceptance. Full website voice confirmation/job/billing/render path with the new adapter remains unverified; no paid call was made for this change.

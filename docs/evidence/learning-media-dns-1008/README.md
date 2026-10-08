# Learning media DNS hotfix — 2026-10-08

Base: PR1684 merge `6ba2832eabb17c405435a4addcbfd34da49b896f`.

## Incident and scope

At 21:34 Beijing the worker `7812595b294778` failed to resolve `ppvod021.zyxsuntech.com`, while website `d892541f602228` resolved it. The parent learning job `qwYg_vfvm3gD6X0y` failed before model reading and screenshots. Existing records remain. There is no evidence attributing this DNS failure to PR1684's screenshot changes or proving a particular Fly cache defect.

The stopped worker was reused after a live empty-job/workflow/media-process check. Its default resolver was healthy after startup; public resolvers were also healthy. This is a transient incident, not a currently reproducible permanent domain outage.

## Change

Only the Fly rig command enters `scripts/start-heavy-worker.sh`. A loopback-only dnsmasq resolves public names through Cloudflare/Google and Fly `.internal`, `.flycast`, unqualified names and reverse lookups through `fdaa::3`. The system resolver therefore covers Node **and native FFmpeg/FFprobe/yt-dlp/HLS child requests**. No fixed CDN addresses, media allowlist bypass, credential changes or automatic learning retry. Website process stays unchanged. Startup validates and starts the resolver before changing resolv.conf and uses exec to preserve signal handling. The runtime package is dnsmasq-base, not its system service/DHCP wrapper.

DNS failures now retain a sanitized classification through FFprobe/audio decoding and candidate failover; signed URLs and headers are not logged.

References: [Fly private DNS](https://docs.fly.io/networking/private-networking), [dnsmasq manual](https://thekelleys.org.uk/dnsmasq/docs/dnsmasq-man.html).

## Actual checks

- Original worker, isolated mount/PID namespaces: injected NXDOMAIN caused ENOTFOUND; the real startup script then resolved both public source/CDN names and the actual Fly website internal name. Host `/etc/resolv.conf` SHA stayed `9320048bc691b0023c8e6823b649a7793b9980a3a4d899192c6b8aa463eda091`.
- Original failed FFprobe request: 8166.074954 sec, video+audio, no stderr. Original failed two-second audio null decode: success, no stderr. Neither creates/retries a learning job.
- User's new page `https://0996zp.com/vod/play/146259/sid/1313635`: authenticated production source resolver, actual CDN `ppvod01.kqgfbs.com`, duration 2918.416717 sec, video+audio, two-second null decode passed. Cloud receipt is in `user-source-probe.json`.
- Four new DNS classification tests passed; three unchanged tests skipped. TypeScript incremental check exited 0. Shell syntax, non-rig bypass and Fly config validation passed (existing long grace-period warning).
- No full test rerun, no Blender compatibility test. PR1684 screenshot evidence reused: 117 targeted mocked tests and type check from `/tmp/matrix-screenshot-review-{execution-report,frames-order,tsc}.log`; this evidence predates the screenshot changes below and does not validate them.

## Screenshot review and limitations

Local same-name HTML: Matrix has one decorative header image and **zero evidence screenshots**; 凡人百世書8 has one decorative header and **93 evidence screenshots**. Attachment byte identity was not independently verified. PR1684 captures from prepared GCS segments on the per-segment response before cleanup, retaining manifests. It does not backfill the existing Matrix report. The failed new job never reached this stage.

User subsequently authorized one first-segment paid probe (00:00–05:03), current frozen Gemini 3.8 Flash request, all returned key-moment screenshots, no GLM/full-film/retry. Raw/parsed JSON and images stay permanent. Results will be appended below. The initial probe incorrectly cut HLS directly; the strict start-time check rejected it (video start 4.183008, duration 298.816667). Zero model calls at this failure. Corrected preparation remuxes source locally, then uses the unchanged production local cutter. This setup error is not a demonstrated production regression. Probe source fetching is bounded to the selected head; it does not certify whole-film downloading or full workflow acceptance.

No production deployment/merge, business data deletion, source credential export or new machine. Actual production UI task, full learning/GLM/template adoption/refresh remain unverified by these isolated probes.

## Latest user-directed hotfix scope and verification waiver

The user explicitly requested no more testing and direct push, later direct merge; the user will test after deployment. The new screenshot/gate/progress changes have NOT been run through tests, type checking, build or production acceptance. Earlier successful DNS-only type checking does not apply to this expanded diff. Existing screenshot mock assertions and numeric boundary assertions were updated to the changed requirements, not executed.

- Each parsed segment immediately enters the production screenshot callback after parsed JSON persistence and before quality gates, regardless of gate outcome.
- Screenshot first attempt plus up to five retries, missing frames only. Partial successes and source indexes persist.
- Before structuring, including structuring-only recovery, final key moments (including merged/swept moments) are checked again. Missing images get another capture round with up to five retries; incomplete or missing key moments block structuring. No paid reread is added by this gate.
- Cached image bytes/SHA are verified. Missing screenshots can reuse retained GCS segment indexes. Failed pre-structuring screenshot verification retains prepared videos for recovery; it never deletes paid JSON. Old tasks without retained video or usable screenshots stop with an explicit message.
- Actual screenshot/upload counts, failure categories, retries, pre-structuring checks and blocking failures feed the existing learning progress channel, job label and progress log.
- Authorized gate numerical tolerance changes 20% to 30%; the 60-second nominal shot cap now rejects above 78 seconds. Frozen digest updated for the authorized acceptance change; generation settings/prompt/schema/segment-cache request identity not intentionally changed. No fresh request was made with the 30% gate.

## Paid probes: what they actually proved

Permanent prefix: `gs://mv-studio-pro-vertex-video-temp/post-prod/1/isolated-probes/learning-dns-paid-1008-1791468750/`.

0.7: HTTP200/STOP, 70 shots/9 key moments; failed the audio-range gate. The probe's `ok:true` only checked response presence and audio usage, NOT gate acceptance. An agent-added script separately invoked the screenshot function and produced five images/HTML. That script bypassed the production callback and those artifacts DO NOT prove automatic workflow screenshots. Cancellation arrived after that script had completed. Evidence remains preserved.

User-authorized 0.65: same first 303-second GCS segment, original request compared with only temperature changed; HTTP200/STOP, 62 shots/10 key moments, existing 20% gate passed. Audio cue advisory 12/13, no retry required. Input197345/output17330 tokens; audio7535. Raw57807 bytes SHA `cacfeca11a0126d1fb5d526996cd83d6fe2bea0911f15ad6adbb004391152313`; parsed41554 bytes SHA `f121b60ef55b4a47d39ed95bbe891400d150cd506685d663bc573929a49fec97`; saved under `retry-065/`. This also called the model directly, not the full workflow. No screenshots or GLM in this retry; no automatic screenshot claim.

Worker7812595b294778 was stopped after a fresh empty queue/workflow/media-process check at14:31:57UTC and completion of uploads. No new machine was created.

# PR1678 native scene animation delivery — incomplete acceptance

Adds opt-in native whitebox GLB/full-frame camera+visibility export, the same Three/Spark player and owned GS video rendering, original-request queries, candidate adoption and local/cloud draft saving. Same-project advisor reads the saved native task and episode identity. Fixes hidden model overlays and worker shutdown during untracked media processes.

Docker pins official Blender 4.5.14 LTS / Linux x64, SHA256 `9ba871ff2ecd36526b77432745980b7e6664ecd0c7ca11c48849073dcfe06da3`. Upgrade compatibility validation explicitly waived by user tonight: **waived / not tested**. No production upgrade or deployment claimed.

Evidence: 3 new animation-export unit cases passed (reused); 2 source-boundary cases passed; current clip/world adoption negative cases passed; new external-process shutdown race/read failure case passed (old 7 skipped). Existing advisor/quad checks reused. Incremental TypeScript logs captured separately, no full-suite repeat.

Worker probe used original 7812595b294778 and an independent /tmp identity, no new machines, no model calls. Blender 3.4 synthetic 48-frame bone export passed. First GS runtime failed because a CommonJS module was provided to the browser; fixed to pinned spark.module.js. Second runtime interrupted by old worker idle stop, not counted as success. Third rendered all 48 PNG frames, then rejected `Only one sort at a time`. Full frame evidence preserved before rejecting; no result adoption.

Exact diagnosed cause: disabling SparkRenderer.autoUpdate did not disable its default view's independent auto-sorting. Final change also sets `view.autoUpdate=false` for service capture; **not reverified tonight**. Next agent must verify this exact path before claiming video output acceptance. Frame manifest and error are in frames.raw.json. No fake successful output or full episode delivered.

Permanent third-probe evidence: `gs://mv-studio-pro-vertex-video-temp/post-prod/1/isolated-probes/ep2-stage-animation-r3-1007-1791394757373/archive-receipt.json`. Raw/normalized request and all 48-frame signatures stored separately, full source and stage evidence also stored by the rendering service. Earlier failure receipt remains under `ep2-stage-animation-1007-1791393373871/`.

Formal pending: deployed original UI save/recovery and advisor query, doctor's five-pose review/adoption, real horse quad binding and contact/motion, existing scene adoption, selected BGM 1-2/2-2/3-1/4-2/5-1, and actual story animation quality. No video model calls. User alone merges PR1678; next morning first check current merge/deployment status.

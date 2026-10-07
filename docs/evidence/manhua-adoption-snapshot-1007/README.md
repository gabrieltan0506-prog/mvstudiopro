# Episode adoption snapshot repair

Base: 69a78c62ae7d31fc7c0b33c8efca3d78dc6e5f4b (merged PR1677).

Native production evidence: “确认写回本集并更新相关资产” rejected with “旧稿备份保存失败，未采用改写。请先导出备份并释放本机存储。” The approved episode editor retained 1571 characters; the previous source remained 4634 characters. No forced adoption or deletion of older backups was performed.

The adoption transaction now saves the same complete serialized original snapshot into the existing immutable IndexedDB store and waits for verified transaction completion before writing the draft/canvas/overlay keys. It checks project scope, persisted state, live production work and concurrent adoption. The original rollback is retained. Manual editing, advisor control actions, template rewriting and batch optimization await the same result before showing success or refreshing assets. Backup-center download/import remains the recovery path; this is a browser snapshot, not proof of a cloud backup. Existing snapshot records are never removed.

Offline evidence:
- Snapshot tests: five passed (quota isolation, delayed persistence, snapshot failure, concurrent asset change, before-commit task guard, partial-write rollback across the five cases).
- Actual OmniCanvas callback: existing affected case passed; newly added live-task-during-backup case passed. Total seven distinct cases. Earlier unchanged ten adoption cases were skipped.
- Host callback was rechecked only after adding the live busy reference; the five unchanged helper cases were reused.
- Existing immutable IndexedDB store and browser storage tests were unchanged from PR1676; no repeated suite execution.
- Typecheck result recorded separately after completion.

No new provider request, charge, rig/render, merge or deployment was performed. Deployment and native adoption/save/restore still require production verification. This PR does not complete the episode animation, real horse skinning, world-camera adoption or BGM mixing.

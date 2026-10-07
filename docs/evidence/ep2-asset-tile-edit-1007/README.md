# Old scene tile image editing

Observed in the original logged-in canvas: Hk5wSHzjfOhqPZKR and 5GXTPLh3U8Ii4-qq failed with “素材尚未登记”. Their sources are existing manhua-scene-tiles objects. The worker rejects unregistered references before deductCreditsAmount and before the image provider call. Both original jobs remain preserved; neither was retried.

Image edit, detext and standardize now reuse the existing repairSceneTileOwnership callback before reference signing and queue creation. That callback verifies each selected old tile's pixels against its owned original sheet, rejects mismatches/conflicting owners, and registers the existing object without replacing its bytes. No ownership rule was relaxed. Original assets remain preserved.

New failure invalidated the previous button-path evidence for this case. Executed only 3 affected callback tests: repair precedes queueing; repair failure creates no job, preserves the source and releases the lock. 25 other cases skipped. The initial test run exposed an outdated fixture missing maskMediaProviderDetails; the actual import was added before the successful run. Final incremental tsc exit 0 reuses /tmp/pr1676-ep2-scene-tsc.tsbuildinfo. Existing unchanged server crop/ownership evidence was not rerun.

Not deployed; formal browser acceptance and actual old scene image edits remain pending. No 3DGS or video model was called by this fix.

# Sound entry and restoration probes

Base HEAD9a3c808649514b22141889982bea2c268569101a; child changes uncommitted pending root integration.

- `router-entry-probe.txt`: actual protected generateSound/list/adoptSound router with provider/service fixtures, authentication/owner binding and grant-failure suppression.
- `studio-browser-probe.txt`: real Studio component, fake transport only: no existing audio→4 narration requests+1 BGM→repeat batch does not generate again→adopt all5→narration at0/5/10/15s and20s BGM→save/reload restores sources and timing. Raw trace: `studio-raw-trace.json`; actual rendered screenshot: `sound-panel-restored.png`. Audio URI in the fixture is a zero-length WAV and is not hearing evidence.
- `timing-replacement-probe.txt`: replacing an analysed BGM source clears only its obsolete timing, preserving original project and allowing valid compile; re-adopting identical source keeps timing.

No paid TTS/Suno production call or formal online acceptance performed by this child. Root owns actual financial/service integration and final verification.

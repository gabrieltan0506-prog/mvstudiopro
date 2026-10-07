/** Executes the production save callback; injected storage is offline evidence, not cloud acceptance. */
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { expect, it, vi } from "vitest";
import { manhuaVfxStateSchema, mergeManhuaVfxState, type ManhuaVfxState } from "@shared/manhuaVfx";

function setup() {
  const source = readFileSync("client/src/pages/OmniCanvas.tsx", "utf8");
  const start = source.indexOf("  const persistManhuaVfxState = useCallback(");
  const end = source.indexOf("\n\n  const backupOperationRef", start);
  if (start < 0 || end < 0) throw new Error("Production save callback not found");
  const env = {
    useCallback: (fn: unknown) => fn,
    user: { id: 7 }, projectScope: { projectId: "project-a" }, vfxScopeKey: "scope-a",
    vfxPersistenceScope: "7:project-a:scope-a", vfxPersistenceEpoch: 1,
    currentVfxSaveReady: { current: true },
    currentVfxScopeRef: { current: "7:project-a:scope-a" },
    manhuaOutboundEpochRef: { current: 1 },
    cloudSyncReady: true, factoryBusy: false, writerBusy: false,
    backupOperationRef: { current: null }, cloudConflictRef: { current: null },
    manhuaVfxByScopeRef: { current: {} }, manhuaVfxStateSchema, mergeManhuaVfxState,
    latestDraftSnapshotRef: { current: { factoryPrefs: {}, blocks: ["latest-block"], edges: ["latest-edge"] } },
    blocksRef: { current: ["latest-block"] }, edges: ["obsolete-edge"],
    persistManhuaDraftLocally: vi.fn(() => ({ writerOk: true, canvasOk: true, prefsOk: true, atOk: true })),
    setManhuaVfxByScope: vi.fn(), syncCloudDraftPayload: vi.fn(async (_snapshot: unknown) => true),
    buildLocalCloudDraftSnapshot: (snapshot: unknown) => snapshot,
  };
  const js = transformSync(source.slice(start, end), { loader: "ts", target: "es2022" }).code;
  const persist = new Function(...Object.keys(env), `${js}\nreturn persistManhuaVfxState;`)(...Object.values(env)) as (state: ManhuaVfxState) => Promise<ManhuaVfxState>;
  const state: ManhuaVfxState = { version: 1, scopeKey: "scope-a", requests: {} };
  return { env, persist, state };
}

it.each(["project", "account", "restore"])("rejects a stale %s callback before any local or cloud write", async change => {
  const { env, persist, state } = setup();
  if (change === "project") env.currentVfxScopeRef.current = "7:project-b:scope-b";
  if (change === "account") env.currentVfxScopeRef.current = "8:project-a:scope-a";
  if (change === "restore") env.manhuaOutboundEpochRef.current++;
  await expect(persist(state)).rejects.toThrow();
  expect(env.persistManhuaDraftLocally).not.toHaveBeenCalled();
  expect(env.syncCloudDraftPayload).not.toHaveBeenCalled();
  expect(env.setManhuaVfxByScope).not.toHaveBeenCalled();
});

it("preserves the latest canvas edges instead of the submitting render's stale edges", async () => {
  const { env, persist, state } = setup();
  await persist(state);
  expect(env.syncCloudDraftPayload.mock.calls[0][0]).toMatchObject({ blocks: ["latest-block"], edges: ["latest-edge"] });
});

it("rejects a project switch while cloud save is in flight without a second write", async () => {
  const { env, persist, state } = setup();
  env.syncCloudDraftPayload.mockImplementationOnce(async () => { env.currentVfxScopeRef.current = "7:project-b:scope-b"; return true; });
  await expect(persist(state)).rejects.toThrow();
  expect(env.syncCloudDraftPayload).toHaveBeenCalledTimes(1);
});

import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { evaluateManhuaAsset3dEligibility } from "@shared/manhuaAsset3d";

// Execute the production callback, rather than a parallel implementation.
const source = ts.createSourceFile("OmniCanvas.tsx", readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback = "";
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "generateManhua3dAsset" && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0].getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
if (!callback) throw Error("Production model callback missing");
const compiled = ts.transpileModule(`const callback = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function setup(status: string, failRead = false) {
  const model = { taskId: "existing-task", status: "reconcile_manual", sourceVersion: "gs://test/uploads/doctor.png", sourceImageUrl: "https://example.test/doctor.png", updatedAt: 1 };
  const task = { ...model, assetRef: "doctor", status, glbGcsUri: status === "succeeded" ? "gs://test/doctor.glb" : undefined };
  const getStatus = vi.fn(async () => { if (failRead) throw Error("read unavailable"); return task; });
  const forbid = vi.fn(() => { throw Error("Unexpected paid creation or confirmation"); });
  const apply = vi.fn(), poll = vi.fn(), receipt = vi.fn();
  const deps = {
    customAssetRefs: [{ id: "doctor", role: "character", reviewStatus: "converted", url: model.sourceImageUrl, gcsUri: model.sourceVersion, model3d: model }],
    evaluateManhuaAsset3dEligibility,
    trpcUtils: { manhua3d: { getStatus: { fetch: getStatus } } },
    applyManhua3dTaskView: apply, pollManhua3dTask: poll,
    toast: { message: vi.fn(), error: vi.fn(), success: vi.fn() },
    window: { confirm: forbid },
    manhua3dOperationGuard: { current: { begin: forbid } },
    setAsset3dBusyIds: forbid,
    retryManhua3dMutation: { mutateAsync: forbid },
    submitManhua3dMutation: { mutateAsync: forbid },
    maskMediaProviderDetails: (s: string) => s,
  };
  const run = new Function(...Object.keys(deps), `${compiled}\nreturn callback;`)(...Object.values(deps));
  return { run, getStatus, forbid, apply, poll, receipt, task, toast: deps.toast };
}

describe("stale manual 3D status recovery (offline production callback)", () => {
  it.each(["running", "succeeded", "reconcile_manual"])("reads the same task and handles %s without another paid submission", async status => {
    const h = setup(status);
    await h.run("doctor", h.receipt);
    expect(h.getStatus).toHaveBeenCalledOnce();
    expect(h.getStatus).toHaveBeenCalledWith({ taskId: "existing-task" });
    expect(h.apply).toHaveBeenCalledOnce();
    expect(h.apply).toHaveBeenCalledWith(h.task);
    expect(h.receipt).toHaveBeenCalledOnce();
    expect(h.receipt).toHaveBeenCalledWith(h.task);
    expect(h.forbid).not.toHaveBeenCalled();
    if (status === "running") expect(h.poll).toHaveBeenCalledWith("existing-task");
    else expect(h.poll).not.toHaveBeenCalled();
  });
  it("failed status reads preserve the task and do not retry creation", async () => {
    const h = setup("running", true);
    await h.run("doctor", h.receipt);
    expect(h.getStatus).toHaveBeenCalledOnce();
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.forbid).not.toHaveBeenCalled();
    expect(h.toast.error).toHaveBeenCalledWith("3D 状态读取失败，原任务保留，不会重新建模");
  });
});

import { describe, expect, it } from "vitest";
import { buildSrcDoc, buildStageSceneConfig, stageCameraRigs, stageSceneSignature, type ManhuaStageCharacter } from "../components/canvas/ManhuaWorldStagePreview";

const actors: ManhuaStageCharacter[] = [
  { id: "actor-a", assetRef: "ref-a", labelZh: "甲", glbUrl: "https://x/a.glb", stagePoint: [0, 0] },
  { id: "actor-b", assetRef: "ref-b", labelZh: "乙", glbUrl: "https://x/b.glb", stagePoint: [0, 2] },
];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}
/** 执行生产 iframe 脚本，用受控加载信号取代网络/WebGL；不冒充真实画面验收。 */
async function harness(characters = actors, failedWorldAttempts = 0, exportFailure?: "render" | "canvas" | "empty") {
  const config = buildStageSceneConfig({ spz500kUrl: "https://x/w.spz" }, characters, stageCameraRigs(characters).establish, "revision-7")!;
  const html = buildSrcDoc(config);
  const script = html.slice(html.indexOf('const CONFIG ='), html.lastIndexOf('</script>'))
    .replaceAll('await import(', 'await loadModule(');
  const messages: Record<string, unknown>[] = [];
  const messageHandlers: Array<(event: { data: Record<string, unknown> }) => void> = [];
  const world = deferred<void>();
  const loading = new Map<string, (value: unknown) => void>();
  const xyz = () => ({ set() {}, setScalar() {} });
  class Object3d {
    position = xyz(); quaternion = xyz(); scale = xyz(); rotation = { x: 0, z: 0 };
    add() {} remove() {} traverse() {} lookAt() {} updateProjectionMatrix() {}
  }
  let splatInstances = 0;
  class Splat extends Object3d {
    initialized: Promise<void>;
    numSplats = 10;
    constructor() {
      super();
      splatInstances += 1;
      this.initialized = splatInstances <= failedWorldAttempts
        ? Promise.reject(new Error("Failed to fetch")) : world.promise;
    }
  }
  const three = {
    Scene: Object3d, Group: Object3d, HemisphereLight: Object3d, DirectionalLight: Object3d,
    Color: Object3d, GridHelper: Object3d,
    PerspectiveCamera: class extends Object3d { up = xyz(); },
    Box3: class { min = { y: 0 }; max = { y: 1 }; setFromObject() { return this; } },
    WebGLRenderer: class {
      domElement = { style: {}, addEventListener() {}, toDataURL() {
        if (exportFailure === "canvas") throw new Error("canvas failed");
        if (exportFailure === "empty") return "data:,";
        return "data:image/png;base64,dGVzdA==";
      } };
      setPixelRatio() {} setSize() {} setAnimationLoop() {}
      render() { if (exportFailure === "render") throw new Error("render failed"); }
    },
  };
  const loadModule = async (name: string) => name === "three" ? three : name.includes("GLTFLoader") ? { GLTFLoader: class { load(url: string, resolve: (v: unknown) => void) { loading.set(url, resolve); } } } : { SplatMesh: Splat };
  const document = { getElementById: () => ({ textContent: "", remove() {} }), body: { appendChild() {} } };
  const window = { innerWidth: 640, innerHeight: 360, devicePixelRatio: 1,
    addEventListener(type: string, handler: (event: { data: Record<string, unknown> }) => void) {
      if (type === "message") messageHandlers.push(handler);
    },
  };
  const run = new Function("loadModule", "document", "window", "parent", `return (async () => {${script}})()`);
  const done = run(loadModule, document, window, { postMessage: (m: Record<string, unknown>) => messages.push(m) });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  return {
    config, messages, world, loading, done, splatInstances: () => splatInstances,
    gltf: () => ({ scene: new Object3d() }),
    exportFrame: (requestId: number) => messageHandlers.forEach((handler) => handler({ data: {
      source: "manhua-world-stage-host", revision: config.revision, type: "export", requestId,
    } })),
  };
}

describe("片场生产脚本必需资产门禁", () => {
  it("相同场景内容的新对象保持同一签名，真实资产或站位变化才换实例", () => {
    const world = { spz500kUrl: "https://x/w.spz", colliderGlbUrl: "https://x/c.glb", metricScaleFactor: 1.2 };
    const initial = stageSceneSignature(world, actors);
    expect(stageSceneSignature({ ...world }, actors.map((actor) => ({ ...actor, stagePoint: [...actor.stagePoint] as [number, number] })))).toBe(initial);
    expect(stageSceneSignature({ ...world, spz500kUrl: "https://x/new.spz" }, actors)).not.toBe(initial);
    expect(stageSceneSignature(world, [{ ...actors[0]!, stagePoint: [1, 0] }, actors[1]!] )).not.toBe(initial);
  });
  it("缺 GLB 的演员仍在预期名单中；不会过滤后冒充完整", () => {
    const config = buildStageSceneConfig({ spz500kUrl: "https://x/w.spz" }, [actors[0]!, { ...actors[1]!, glbUrl: "" }], stageCameraRigs(actors).establish)!;
    expect(config.characters.map(a => a.id)).toEqual(["actor-a", "actor-b"]);
    expect(config.characters[1]?.glbUrl).toBe("");
  });
  it("第二个人加载延迟时不能 ready，世界和两人均完成才携带同一 revision 回执", async () => {
    const h = await harness();
    h.world.resolve();
    h.loading.get("https://x/a.glb")!(h.gltf());
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(h.messages).toEqual([]);
    h.loading.get("https://x/b.glb")!(h.gltf());
    await h.done;
    expect(h.messages).toEqual([{ source: "manhua-world-stage", revision: "revision-7", type: "ready", loaded: ["world", "actor-a", "actor-b"], failed: [] }]);
  });
  it("缺模型的第二人明确失败，不能算成已经加载", async () => {
    const h = await harness([actors[0]!, { ...actors[1]!, glbUrl: "" }]);
    h.world.resolve();
    h.loading.get("https://x/a.glb")!(h.gltf());
    await h.done;
    expect(h.messages[0]).toMatchObject({ type: "ready", loaded: ["world", "actor-a"], failed: [{ id: "actor-b", kind: "actor", message: "缺少可用的人物模型" }] });
  });
  it("已有高斯文件首次断流时只重试读取一次，第二次成功才回 ready", async () => {
    const h = await harness([], 1);
    h.world.resolve();
    await h.done;
    expect(h.splatInstances()).toBe(2);
    expect(h.messages).toEqual([{ source: "manhua-world-stage", revision: "revision-7", type: "ready", loaded: ["world"], failed: [] }]);
  });
  it("两次读取都断流时明确报错，不循环重试或误报 ready", async () => {
    const h = await harness([], 2);
    await h.done;
    expect(h.splatInstances()).toBe(2);
    expect(h.messages).toEqual([{
      source: "manhua-world-stage", revision: "revision-7", type: "error",
      message: "3D 场景加载失败，请稍后重试",
    }]);
  });
  it.each(["render", "canvas", "empty"] as const)("%s 导出失败携带原请求号，场景保持就绪并可再次导出", async (stage) => {
    const h = await harness([], 0, stage);
    h.world.resolve();
    await h.done;
    expect(h.messages[0]).toMatchObject({ type: "ready", loaded: ["world"], failed: [] });
    h.exportFrame(41);
    expect(h.messages.at(-1)).toEqual({
      source: "manhua-world-stage", revision: "revision-7", type: "export_error",
      requestId: 41, message: "视角图导出失败，请重试",
    });
    h.exportFrame(42);
    expect(h.messages.at(-1)).toMatchObject({ type: "export_error", requestId: 42 });
  });
});

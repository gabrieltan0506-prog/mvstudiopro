import { describe, expect, it } from "vitest";
import { buildSrcDoc, buildStageSceneConfig, stageCameraRigs, type ManhuaStageCharacter } from "../components/canvas/ManhuaWorldStagePreview";

const actors: ManhuaStageCharacter[] = [
  { id: "actor-a", assetRef: "ref-a", labelZh: "甲", glbUrl: "https://x/a.glb", stagePoint: [0, 0] },
  { id: "actor-b", assetRef: "ref-b", labelZh: "乙", glbUrl: "https://x/b.glb", stagePoint: [0, 2] },
];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
/** 执行生产 iframe 脚本，用受控加载信号取代网络/WebGL；不冒充真实画面验收。 */
async function harness(characters = actors) {
  const config = buildStageSceneConfig({ spz500kUrl: "https://x/w.spz" }, characters, stageCameraRigs(characters).establish, "revision-7")!;
  const html = buildSrcDoc(config);
  const script = html.slice(html.indexOf('const CONFIG ='), html.lastIndexOf('</script>'))
    .replaceAll('await import(', 'await loadModule(');
  const messages: Record<string, unknown>[] = [];
  const world = deferred<void>();
  const loading = new Map<string, (value: unknown) => void>();
  const xyz = () => ({ set() {}, setScalar() {} });
  class Object3d {
    position = xyz(); quaternion = xyz(); scale = xyz(); rotation = { x: 0, z: 0 };
    add() {} traverse() {} lookAt() {} updateProjectionMatrix() {}
  }
  class Splat extends Object3d { initialized = world.promise; numSplats = 10; }
  const three = {
    Scene: Object3d, Group: Object3d, HemisphereLight: Object3d, DirectionalLight: Object3d,
    Color: Object3d, GridHelper: Object3d,
    PerspectiveCamera: class extends Object3d { up = xyz(); },
    Box3: class { min = { y: 0 }; max = { y: 1 }; setFromObject() { return this; } },
    WebGLRenderer: class { domElement = {}; setPixelRatio() {} setSize() {} setAnimationLoop() {} },
  };
  const loadModule = async (name: string) => name === "three" ? three : name.includes("GLTFLoader") ? { GLTFLoader: class { load(url: string, resolve: (v: unknown) => void) { loading.set(url, resolve); } } } : { SplatMesh: Splat };
  const document = { getElementById: () => ({ textContent: "", remove() {} }), body: { appendChild() {} } };
  const window = { innerWidth: 640, innerHeight: 360, devicePixelRatio: 1, addEventListener() {} };
  const run = new Function("loadModule", "document", "window", "parent", `return (async () => {${script}})()`);
  const done = run(loadModule, document, window, { postMessage: (m: Record<string, unknown>) => messages.push(m) });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  return { config, messages, world, loading, done, gltf: () => ({ scene: new Object3d() }) };
}

describe("片场生产脚本必需资产门禁", () => {
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
});

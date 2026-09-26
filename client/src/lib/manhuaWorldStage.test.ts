import { describe, expect, it } from "vitest";
import { buildSrcDoc, buildStageSceneConfig, dataUrlToBlob, stageCameraRigs, stageSceneSignature, type ManhuaStageCharacter } from "../components/canvas/ManhuaWorldStagePreview";

const actors: ManhuaStageCharacter[] = [
  { id: "actor-a", assetRef: "ref-a", labelZh: "甲", glbUrl: "https://x/a.glb", stagePoint: [0, 0] },
  { id: "actor-b", assetRef: "ref-b", labelZh: "乙", glbUrl: "https://x/b.glb", stagePoint: [0, 2] },
];
const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+l6YQAAAAASUVORK5CYII=";

it("主机拒绝空白或伪造 PNG，不把无图内容送入上传", async () => {
  await expect(dataUrlToBlob("data:image/png;base64,")).rejects.toThrow("invalid_png");
  await expect(dataUrlToBlob("data:image/png;base64,dGVzdA==")).rejects.toThrow("invalid_png");
  expect((await dataUrlToBlob(VALID_PNG)).size).toBeGreaterThan(8);
});
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
  const pointerHandlers = new Map<string, (event: Record<string, unknown>) => void>();
  const world = deferred<void>();
  const loading = new Map<string, (value: unknown) => void>();
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
    setScalar(value: number) { return this.set(value, value, value); }
    distanceTo(other: Vector3) { return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z); }
    clone() { return new Vector3(this.x, this.y, this.z); }
    addScaledVector(other: Vector3, scale: number) { return this.set(this.x + other.x * scale, this.y + other.y * scale, this.z + other.z * scale); }
    toArray() { return [this.x, this.y, this.z]; }
  }
  const xyz = () => new Vector3();
  class Object3d {
    position = xyz(); quaternion = xyz(); scale = xyz(); rotation = { x: 0, z: 0 };
    add() {} remove() {} traverse() {} lookAt(_x: number, _y: number, _z: number) {} updateProjectionMatrix() {}
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
    Scene: Object3d, Group: Object3d, HemisphereLight: Object3d, DirectionalLight: Object3d, Vector3,
    Color: Object3d, GridHelper: Object3d,
    PerspectiveCamera: class extends Object3d {
      up = xyz(); position = new Vector3(); direction = new Vector3(1, 0, 0);
      lookAt(x: number, y: number, z: number) {
        const length = Math.hypot(x - this.position.x, y - this.position.y, z - this.position.z) || 1;
        this.direction.set((x - this.position.x) / length, (y - this.position.y) / length, (z - this.position.z) / length);
      }
      getWorldDirection(target: Vector3) { return target.set(this.direction.x, this.direction.y, this.direction.z); }
    },
    Box3: class { min = { y: 0 }; max = { y: 1 }; setFromObject() { return this; } },
    WebGLRenderer: class {
      domElement = { style: {}, setPointerCapture() {}, addEventListener(type: string, handler: (event: Record<string, unknown>) => void) { pointerHandlers.set(type, handler); }, toDataURL() {
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
    send: (message: Record<string, unknown>) => messageHandlers.forEach((handler) => handler({ data: {
      source: "manhua-world-stage-host", revision: config.revision, ...message,
    } })),
    exportFrame(requestId: number) { this.send({ type: "export", requestId }); },
    pointer: (type: string, event: Record<string, unknown>) => pointerHandlers.get(type)?.(event),
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
  it("拖动后的实际朝向随原请求导出，同机位预设可复位", async () => {
    const h = await harness([], 0);
    h.world.resolve();
    await h.done;
    h.pointer("pointerdown", { pointerType: "mouse", button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    h.pointer("pointermove", { pointerId: 1, clientX: 100, clientY: 0 });
    h.exportFrame(51);
    const dragged = h.messages.at(-1) as { type: string; requestId: number; cameraRig: { position: number[]; target: number[] } };
    expect(dragged.type).toBe("frame");
    expect(dragged.requestId).toBe(51);
    expect(dragged.cameraRig.position).toEqual(h.config.initialCamera.position);
    expect(dragged.cameraRig.target[0]).not.toBeCloseTo(h.config.initialCamera.target[0]);
    h.send({ type: "camera", rig: h.config.initialCamera, cameraKind: "establish" });
    h.exportFrame(52);
    const reset = h.messages.at(-1) as { requestId: number; cameraRig: { target: number[] } };
    expect(reset.requestId).toBe(52);
    reset.cameraRig.target.forEach((value, index) => expect(value).toBeCloseTo(h.config.initialCamera.target[index]!));
  });
});

it("宿主上传开始后切机位仍保持忙碌，旧回执不能放开新请求", async () => {
  const { build } = await import("esbuild");
  const { default: puppeteer } = await import("puppeteer");
  const { default: path } = await import("node:path");
  const built = await build({
    stdin: {
      resolveDir: process.cwd(), loader: "tsx",
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { ManhuaWorldStagePreview } from './client/src/components/canvas/ManhuaWorldStagePreview';
        const f = window.fixture = { calls: [], resolves: [] };
        const onExportStageFrame = (blob, frame) => new Promise(resolve => {
          f.calls.push({ size: blob.size, cameraKind: frame.cameraKind, camera: frame.camera });
          f.resolves.push(resolve);
        });
        createRoot(document.getElementById('root')).render(
          <ManhuaWorldStagePreview sceneLabelZh="测试场景"
            world={{ spz500kUrl: 'https://assets.example/world.spz' }}
            characters={[]} onExportStageFrame={onExportStageFrame} />);
      `,
    },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" },
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (request.url() === "http://localhost:41804/") {
        void request.respond({ status: 200, contentType: "text/html", body: '<!doctype html><div id="root"></div>' });
      } else void request.abort();
    });
    await page.goto("http://localhost:41804/", { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: built.outputFiles[0]!.text });
    await page.waitForSelector('[data-stage-status="error"] iframe');
    const child = page.frames().find((frame) => frame.parentFrame());
    if (!child) throw new Error("测试 iframe 未挂载");
    const revision = await page.$eval("[data-stage-revision]", (el) => el.getAttribute("data-stage-revision"));
    const ready = () => child.evaluate((rev) => parent.postMessage({ source: "manhua-world-stage", revision: rev, type: "ready", loaded: ["world"], failed: [] }, "*"), revision);
    await ready();
    await page.waitForSelector('[data-stage-status="ready"]');
    const rig = { kind: "establish", position: [0, -7, 2.6], target: [0, 0, 1], lens: 28, labelZh: "建立·高位全景" };
    const frame = (requestId: number) => child.evaluate((payload) => parent.postMessage(payload, "*"), {
      source: "manhua-world-stage", revision, type: "frame", requestId,
      cameraKind: "establish", dataUrl: VALID_PNG, cameraRig: rig,
    });
    const exportButton = () => page.evaluate(() => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("视角图"))?.click());
    const busy = () => page.evaluate(() => Boolean(Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("保存中") && b.disabled)));
    await exportButton();
    await frame(1);
    await page.waitForFunction(() => (window as any).fixture.calls.length === 1);
    expect(await busy()).toBe(true);
    await child.evaluate((rev) => parent.postMessage({ source: "manhua-world-stage", revision: rev, type: "error", message: "preview failed" }, "*"), revision);
    await page.waitForSelector('[data-stage-status="error"]');
    await ready();
    await page.waitForSelector('[data-stage-status="ready"]');
    expect(await busy()).toBe(true);
    await page.evaluate(() => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "建立")?.click());
    expect(await busy()).toBe(true);
    await exportButton();
    expect(await page.evaluate(() => (window as any).fixture.calls.length)).toBe(1);
    await page.evaluate(() => (window as any).fixture.resolves[0]());
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((b) => b.textContent?.includes("保存当前视角图") && !b.disabled));
    await exportButton();
    await frame(1);
    expect(await page.evaluate(() => (window as any).fixture.calls.length)).toBe(1);
    expect(await busy()).toBe(true);
    await frame(2);
    await page.waitForFunction(() => (window as any).fixture.calls.length === 2);
    const calls = await page.evaluate(() => (window as any).fixture.calls);
    expect(calls[0].size).toBeGreaterThan(0);
    expect(calls[1].cameraKind).toBe("establish");
    expect(calls[0].camera).toEqual(rig);
    await page.evaluate(() => (window as any).fixture.resolves[1]());
  } finally {
    await browser.close();
  }
}, 30_000);

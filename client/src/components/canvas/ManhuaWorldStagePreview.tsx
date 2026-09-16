/**
 * 角色进场景预览（PR-10）：SparkJS（three.js 高斯渲染）+ three.js 在 iframe 里跑——
 * 仓库没装 three/@sparkjsdev/spark 且本 PR 不加依赖，所以和 ModelViewer 一样走 srcdoc + importmap（jsdelivr）动态加载；
 * 渲染器拉不下来时只显示占位「3D 世界预览需要加载渲染器」，绝不让工作台崩。
 *
 * 坐标：SPZ 按 shared/manhuaWorldStage.marbleToStageTransform 摆正到舞台（Z 上、米）；
 * 人物 GLB（Y 上）绕 X +90° 立起来，按 placeCharacterOnGround 贴地；碰撞网格只做显示开关。
 * 三机位（建立/过肩/单人）来自 threeCameraRigForKeyframe；「导出当前视角 PNG」由 iframe canvas.toDataURL 回传。
 *
 * WL-D02 就绪门禁：每次场景配置（世界/人物/碰撞）生成一个 revision；iframe 汇总必需资产清单（世界高斯 + 每个人物 + 碰撞），
 * await 各自真实成功信号后才报 ready（带 loaded/failed）；缺人物 → partial，列出 actorId，可看不可导出；
 * 主机只收当前 revision 的消息，旧实例迟到的 ready/frame 一律作废；导出回执带 revision + cameraKind，导出前换机位即作废。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ManhuaWorld3dAssets } from "@shared/manhuaWorld3d";
import {
  STAGE_CAMERA_KINDS,
  STAGE_CAMERA_LABEL_ZH,
  marbleToStageTransform,
  placeCharacterOnGround,
  threeCameraRigForKeyframe,
  type StageCameraKind,
  type StageCameraRig,
} from "@shared/manhuaWorldStage";

export type ManhuaStageCharacter = {
  id: string;
  labelZh: string;
  /** 已就绪的人物 GLB（https） */
  glbUrl: string;
  /** 舞台点（米，Z 上） */
  stagePoint: readonly [number, number];
  heightM?: number;
  yawDeg?: number;
};

/** 导出回执：PNG 之外还带机位/人物/实例版本，由上层补世界与镜号后写进 ref.stageFrame */
export type ManhuaStageFrameExport = {
  viewLabelZh: string;
  cameraKind: StageCameraKind;
  /** 本帧里加载成功的人物 id（= 全部预期人物；缺人不放行） */
  actorIds: string[];
  revision: string;
};

export type StageAssetFailure = { id: string; kind: "world" | "collider" | "actor"; message: string };

type Props = {
  sceneLabelZh: string;
  world: ManhuaWorld3dAssets;
  characters: readonly ManhuaStageCharacter[];
  height?: number;
  /** 导出当前视角 PNG（供关键帧参考）；不传则不显示导出按钮 */
  onExportStageFrame?: (blob: Blob, frame: ManhuaStageFrameExport) => void | Promise<void>;
};

const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js";
const THREE_ADDONS_URL = "https://cdn.jsdelivr.net/npm/three@0.178.0/examples/jsm/";
const SPARK_URL = "https://cdn.jsdelivr.net/npm/@sparkjsdev/spark@0.1.10/dist/spark.module.js";

function isHttps(url: string | undefined): url is string {
  try {
    return Boolean(url) && new URL(String(url)).protocol === "https:";
  } catch {
    return false;
  }
}

function escapeForScript(json: string): string {
  return json.replace(/<\//g, "<\\/");
}

export type StageSceneConfig = {
  /** 本次实例版本；iframe 每条消息回带，主机只认当前值 */
  revision: string;
  spzUrl: string;
  colliderUrl?: string;
  transform: { scale: number; quaternionXYZW: readonly number[]; translationStage: readonly number[] };
  characters: Array<{ id: string; glbUrl: string; stagePoint: readonly [number, number]; heightM: number; yawDeg: number }>;
  initialCamera: StageCameraRig;
};

/** 组件外可测的纯函数：世界资产 + 人物 → iframe 场景配置（无 https 主产物则 null） */
export function buildStageSceneConfig(world: ManhuaWorld3dAssets, characters: readonly ManhuaStageCharacter[], initialCamera: StageCameraRig, revision = "0"): StageSceneConfig | null {
  if (!isHttps(world.spz500kUrl)) return null;
  const t = marbleToStageTransform({ metricScaleFactor: world.metricScaleFactor, groundPlaneOffset: world.groundPlaneOffset });
  return {
    revision,
    spzUrl: world.spz500kUrl,
    ...(isHttps(world.colliderGlbUrl) ? { colliderUrl: world.colliderGlbUrl } : {}),
    transform: { scale: t.scale, quaternionXYZW: t.quaternionXYZW, translationStage: t.translationStage },
    characters: characters
      .filter((c) => isHttps(c.glbUrl))
      .map((c) => ({ id: c.id, glbUrl: c.glbUrl, stagePoint: c.stagePoint, heightM: c.heightM && c.heightM > 0 ? c.heightM : 1.7, yawDeg: c.yawDeg ?? 0 })),
    initialCamera,
  };
}

/** 主体 = 第一个人物，过肩对象 = 第二个；没人则以原点为主体 */
export function stageCameraRigs(characters: readonly ManhuaStageCharacter[]): Record<StageCameraKind, StageCameraRig> {
  const subject = characters[0];
  const over = characters[1];
  const subjectStage = [subject?.stagePoint[0] ?? 0, subject?.stagePoint[1] ?? 0, 0] as const;
  const overStage = over ? ([over.stagePoint[0], over.stagePoint[1], 0] as const) : undefined;
  return {
    establish: threeCameraRigForKeyframe({ subjectStage, kind: "establish" }),
    ots: threeCameraRigForKeyframe({ subjectStage, kind: "ots", overStage }),
    single: threeCameraRigForKeyframe({ subjectStage, kind: "single" }),
  };
}

function buildSrcDoc(config: StageSceneConfig): string {
  const payload = escapeForScript(JSON.stringify(config));
  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net blob:; worker-src blob:; connect-src https: blob: data:; img-src https: data: blob:; style-src 'unsafe-inline';">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0b1018;color:#cfe;font:12px system-ui}#msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:12px;pointer-events:none}canvas{display:block}</style>
<script type="importmap">${escapeForScript(JSON.stringify({ imports: { three: THREE_URL, "three/addons/": THREE_ADDONS_URL, "@sparkjsdev/spark": SPARK_URL } }))}</script>
</head><body><div id="msg">正在加载渲染器…</div>
<script type="module">
const CONFIG = ${payload};
const msg = document.getElementById("msg");
const post = (m) => parent.postMessage({ source: "manhua-world-stage", revision: CONFIG.revision, ...m }, "*");
const fail = (text) => { msg.textContent = text; post({ type: "error", message: text }); };
let THREE, GLTFLoader, SplatMesh;
try {
  THREE = await import("three");
  ({ GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js"));
  ({ SplatMesh } = await import("@sparkjsdev/spark"));
} catch (e) {
  fail("3D 世界预览需要加载渲染器（three.js / SparkJS 拉取失败：" + (e && e.message ? e.message : "网络受限") + "）");
}
if (THREE && SplatMesh) {
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1018);
    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / Math.max(1, window.innerHeight), 0.05, 500);
    camera.up.set(0, 0, 1);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0); sun.position.set(3, -5, 8); scene.add(sun);
    const grid = new THREE.GridHelper(20, 20, 0x2a5a6a, 0x1a3a44); grid.rotation.x = Math.PI / 2; scene.add(grid);

    const applyCamera = (rig) => {
      camera.position.set(rig.position[0], rig.position[1], rig.position[2]);
      camera.lookAt(rig.target[0], rig.target[1], rig.target[2]);
      // 35mm 全画幅等效：vfov = 2·atan(12 / lens)
      camera.fov = (2 * Math.atan(12 / Math.max(10, rig.lens)) * 180) / Math.PI;
      camera.updateProjectionMatrix();
    };
    applyCamera(CONFIG.initialCamera);

    const q = CONFIG.transform.quaternionXYZW, t = CONFIG.transform.translationStage, s = CONFIG.transform.scale;
    const splat = new SplatMesh({ url: CONFIG.spzUrl });
    splat.quaternion.set(q[0], q[1], q[2], q[3]);
    splat.scale.setScalar(s);
    splat.position.set(t[0], t[1], t[2]);
    scene.add(splat);

    const loader = new GLTFLoader();
    const loadGltf = (url) => new Promise((resolve, reject) => loader.load(url, resolve, undefined, (e) => reject(new Error(e && e.message ? e.message : "load_failed"))));
    let collider = null;
    let cameraKind = "";
    const required = [];
    // 世界高斯：SparkJS SplatMesh 解码完成信号是 initialized（Promise）；没有这个信号就不能当已加载
    required.push({ id: "world", kind: "world", promise: (async () => {
      if (!splat.initialized || typeof splat.initialized.then !== "function") throw new Error("SplatMesh 没有 initialized 信号");
      await splat.initialized;
      if (splat.numSplats !== undefined && !(splat.numSplats > 0)) throw new Error("高斯数为 0");
    })() });
    if (CONFIG.colliderUrl) {
      required.push({ id: "collider", kind: "collider", promise: loadGltf(CONFIG.colliderUrl).then((gltf) => {
        collider = gltf.scene;
        collider.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ color: 0x22ddaa, wireframe: true, transparent: true, opacity: 0.35 }); });
        collider.quaternion.set(q[0], q[1], q[2], q[3]); collider.scale.setScalar(s); collider.position.set(t[0], t[1], t[2]);
        collider.visible = false;
        scene.add(collider);
      }) });
    }
    for (const ch of CONFIG.characters) {
      required.push({ id: ch.id, kind: "actor", promise: loadGltf(ch.glbUrl).then((gltf) => {
        const root = new THREE.Group();
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const nativeHeight = Math.max(1e-6, box.max.y - box.min.y);
        // Y 上 → 舞台 Z 上：绕 X +90°
        model.rotation.x = Math.PI / 2;
        const scaleK = ch.heightM / nativeHeight;
        root.scale.setScalar(scaleK);
        root.rotation.z = (ch.yawDeg * Math.PI) / 180;
        // 脚贴地：模型 minY 在旋转后成为 z 方向的最低点
        root.position.set(ch.stagePoint[0], ch.stagePoint[1], -box.min.y * scaleK);
        root.add(model);
        scene.add(root);
      }) });
    }

    window.addEventListener("message", (ev) => {
      const m = ev.data || {};
      if (m.source !== "manhua-world-stage-host" || m.revision !== CONFIG.revision) return;
      if (m.type === "camera" && m.rig) { applyCamera(m.rig); cameraKind = String(m.cameraKind || ""); }
      if (m.type === "collider" && collider) collider.visible = Boolean(m.visible);
      if (m.type === "export") {
        renderer.render(scene, camera);
        try { post({ type: "frame", dataUrl: renderer.domElement.toDataURL("image/png"), viewLabelZh: m.viewLabelZh || "", cameraKind: String(m.cameraKind || cameraKind) }); }
        catch (e) { post({ type: "error", message: "导出失败：" + (e && e.message ? e.message : "canvas") }); }
      }
    });
    window.addEventListener("resize", () => { renderer.setSize(window.innerWidth, window.innerHeight); camera.aspect = window.innerWidth / Math.max(1, window.innerHeight); camera.updateProjectionMatrix(); });
    renderer.setAnimationLoop(() => renderer.render(scene, camera));

    // WL-D02：等每个必需资产的真实成功信号，不用固定 sleep；全部结算后才报 ready（带清单）
    let settled = 0;
    msg.textContent = "正在加载 0/" + required.length + "…";
    for (const r of required) r.promise.then(() => { settled += 1; msg.textContent = "正在加载 " + settled + "/" + required.length + "…"; }, () => { settled += 1; });
    const results = await Promise.allSettled(required.map((r) => r.promise));
    const loaded = [], failed = [];
    results.forEach((res, i) => {
      const r = required[i];
      if (res.status === "fulfilled") loaded.push(r.id);
      else failed.push({ id: r.id, kind: r.kind, message: String(res.reason && res.reason.message ? res.reason.message : res.reason || "load_failed").slice(0, 160) });
    });
    if (failed.some((f) => f.kind === "world")) {
      fail("世界高斯（.spz）加载失败：" + failed.find((f) => f.kind === "world").message);
    } else {
      msg.remove();
      post({ type: "ready", loaded, failed });
    }
  } catch (e) {
    fail("3D 世界预览初始化失败：" + (e && e.message ? e.message : "WebGL"));
  }
}
<\/script></body></html>`;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export function ManhuaWorldStagePreview(props: Props) {
  const { sceneLabelZh, world, characters, height = 360, onExportStageFrame } = props;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const revisionCounter = useRef(0);
  const [cameraKind, setCameraKind] = useState<StageCameraKind>("establish");
  const [colliderVisible, setColliderVisible] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "partial" | "error">("loading");
  const [noteZh, setNoteZh] = useState<string>("");
  const [failures, setFailures] = useState<StageAssetFailure[]>([]);
  const [exporting, setExporting] = useState(false);
  const rigs = useMemo(() => stageCameraRigs(characters), [characters]);
  // 世界/人物/碰撞任一变化 = 新实例版本；旧实例的 ready/frame 一律作废
  const config = useMemo(() => {
    revisionCounter.current += 1;
    return buildStageSceneConfig(world, characters, rigs.establish, `r${revisionCounter.current}`);
  }, [world, characters, rigs]);
  const revision = config?.revision ?? "";
  const srcDoc = useMemo(() => (config ? buildSrcDoc(config) : ""), [config]);
  const expectedActorIds = useMemo(() => (config?.characters ?? []).map((c) => c.id), [config]);

  useEffect(() => {
    setStatus("loading");
    setNoteZh("");
    setFailures([]);
    setExporting(false);
  }, [revision]);

  const send = useCallback(
    (message: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage({ source: "manhua-world-stage-host", revision, ...message }, "*");
    },
    [revision],
  );

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const m = (ev.data || {}) as { source?: string; revision?: string; type?: string; message?: string; dataUrl?: string; viewLabelZh?: string; cameraKind?: string; loaded?: string[]; failed?: StageAssetFailure[] };
      if (m.source !== "manhua-world-stage" || ev.source !== iframeRef.current?.contentWindow) return;
      // 旧实例迟到的消息：作废
      if (m.revision !== revision) return;
      if (m.type === "ready") {
        const failed = Array.isArray(m.failed) ? m.failed : [];
        const loaded = new Set(Array.isArray(m.loaded) ? m.loaded : []);
        const missingActors = expectedActorIds.filter((id) => !loaded.has(id));
        setFailures(failed);
        if (missingActors.length || failed.length) {
          setStatus("partial");
          const labels = missingActors.map((id) => characters.find((c) => c.id === id)?.labelZh || id);
          setNoteZh(
            `${missingActors.length ? `缺人物：${labels.join("、")}（${missingActors.join("、")}）；` : ""}${failed.map((f) => `${f.kind === "collider" ? "碰撞网格" : f.id} ${f.message}`).join("；")}。可预览，不能导出为关键帧。`,
          );
        } else {
          setStatus("ready");
          setNoteZh("");
        }
      } else if (m.type === "error") {
        setStatus("error");
        setNoteZh(m.message || "渲染器不可用");
        setExporting(false);
      } else if (m.type === "warn") {
        setNoteZh(m.message || "");
      } else if (m.type === "frame" && m.dataUrl) {
        // 导出前换了机位：这帧不是用户现在要的，作废
        if (m.cameraKind && m.cameraKind !== cameraKind) {
          setExporting(false);
          setNoteZh("导出期间切换了机位，这帧已作废，请重新导出");
          return;
        }
        void (async () => {
          try {
            const blob = await dataUrlToBlob(m.dataUrl!);
            await onExportStageFrame?.(blob, { viewLabelZh: m.viewLabelZh || STAGE_CAMERA_LABEL_ZH[cameraKind], cameraKind, actorIds: expectedActorIds, revision });
          } finally {
            setExporting(false);
          }
        })();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [cameraKind, characters, expectedActorIds, onExportStageFrame, revision]);

  const loaded = status === "ready" || status === "partial";
  useEffect(() => {
    if (loaded) send({ type: "camera", rig: rigs[cameraKind], cameraKind });
  }, [cameraKind, loaded, rigs, send]);
  useEffect(() => {
    if (loaded) send({ type: "collider", visible: colliderVisible });
  }, [colliderVisible, loaded, send]);

  if (!config) {
    return <p className="text-[11px] text-amber-100">这个世界还没有可用的高斯文件（.spz），暂不能进场景。</p>;
  }
  const btn = "rounded border border-cyan-300/30 px-2 py-0.5 text-[11px] text-cyan-50 disabled:opacity-40";
  const btnOn = "rounded border border-cyan-300/70 bg-cyan-500/25 px-2 py-0.5 text-[11px] text-cyan-50";
  return (
    <div className="flex w-full flex-col gap-1" data-manhua-world-stage data-stage-status={status} data-stage-revision={revision}>
      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        <span className="text-white/60">机位</span>
        {STAGE_CAMERA_KINDS.map((k) => (
          <button key={k} type="button" className={cameraKind === k ? btnOn : btn} disabled={!loaded} onClick={() => setCameraKind(k)} title={rigs[k].labelZh}>
            {STAGE_CAMERA_LABEL_ZH[k]}
          </button>
        ))}
        {config.colliderUrl ? (
          <label className="ml-2 flex items-center gap-1 text-white/70">
            <input type="checkbox" checked={colliderVisible} disabled={!loaded} onChange={(e) => setColliderVisible(e.target.checked)} />
            显示碰撞网格
          </label>
        ) : null}
        {onExportStageFrame ? (
          <button
            type="button"
            className={`ml-auto ${btn}`}
            disabled={status !== "ready" || exporting}
            title={status === "partial" ? "有人物/资产没加载成功，不能导出" : undefined}
            onClick={() => {
              setExporting(true);
              send({ type: "export", viewLabelZh: STAGE_CAMERA_LABEL_ZH[cameraKind], cameraKind });
            }}
          >
            {exporting ? "导出中…" : "导出当前视角 PNG"}
          </button>
        ) : null}
      </div>
      <p className="text-[10px] text-white/45">
        {characters.length ? `预期 ${characters.length} 个人物（脚贴地）；` : "本段没有已就绪的人物 GLB，只看场景；"}
        机位规则与白模一致：过肩在第二人身后 0.9/侧 0.45/高 1.55，单人正前 1.6，建立高位全景。
        {rigs.ots.kind === "single" && cameraKind === "ots" ? " 缺过肩对象，过肩退为单人正面。" : ""}
        {status === "loading" ? " 资产加载中（世界高斯 + 每个人物都要真实加载成功才算就绪）。" : ""}
      </p>
      <div className="relative w-full overflow-hidden rounded border border-cyan-300/20 bg-black" style={{ height }}>
        <iframe key={revision} ref={iframeRef} title={`${sceneLabelZh} 3D 世界预览`} srcDoc={srcDoc} sandbox="allow-scripts" className="h-full w-full" style={{ border: 0 }} />
        {status === "error" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-3 text-center text-[11px] text-amber-100" data-stage-placeholder>
            3D 世界预览需要加载渲染器。{noteZh}
          </div>
        ) : null}
      </div>
      {status !== "error" && noteZh ? (
        <p className="text-[10px] text-amber-100" data-stage-note>
          {noteZh}
        </p>
      ) : null}
      {status === "partial" && failures.length ? (
        <ul className="text-[10px] text-amber-100/80" data-stage-failures>
          {failures.map((f) => (
            <li key={`${f.kind}:${f.id}`}>
              {f.kind === "actor" ? "人物" : f.kind === "collider" ? "碰撞" : "世界"} {f.id}：{f.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

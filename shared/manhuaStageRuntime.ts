import type { StageCameraRig } from "./manhuaWorldStage";
const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js";
const THREE_ADDONS_URL = "https://cdn.jsdelivr.net/npm/three@0.178.0/examples/jsm/";
const SPARK_URL = "https://cdn.jsdelivr.net/npm/@sparkjsdev/spark@0.1.10/dist/spark.module.js";

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

export function buildSrcDoc(config: StageSceneConfig, localRuntime?: {origin:string;threeUrl:string;addonsUrl:string;sparkUrl:string;captureOnly?:boolean}): string {
  const payload = escapeForScript(JSON.stringify(config));
  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net blob: ${localRuntime?.origin ?? ''}; worker-src blob:; connect-src https: blob: data: ${localRuntime?.origin ?? ''}; img-src https: data: blob:; style-src 'unsafe-inline';">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0b1018;color:#cfe;font:12px system-ui}#msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:12px;pointer-events:none}canvas{display:block}</style>
<script type="importmap">${escapeForScript(JSON.stringify({ imports: { three: localRuntime?.threeUrl??THREE_URL, "three/addons/": localRuntime?.addonsUrl??THREE_ADDONS_URL, "@sparkjsdev/spark": localRuntime?.sparkUrl??SPARK_URL } }))}</script>
</head><body><div id="msg">正在打开 3D 场景…</div>
<script type="module">
const CONFIG = ${payload};
const CAPTURE_ONLY = ${Boolean(localRuntime?.captureOnly)};
const msg = document.getElementById("msg");
const post = (m) => parent.postMessage({ source: "manhua-world-stage", revision: CONFIG.revision, ...m }, "*");
const fail = (text) => { window.__MANHUA_STAGE_ERROR__=text; msg.textContent = text; post({ type: "error", message: text }); };
let THREE, GLTFLoader, SplatMesh, SparkRenderer;
try {
  THREE = await import("three");
  ({ GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js"));
  ({ SplatMesh, SparkRenderer } = await import("@sparkjsdev/spark"));
} catch (e) {
  fail("3D 场景暂时无法打开，请稍后重试");
}
if (THREE && SplatMesh) {
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1018);
    const sparkRenderer = new SparkRenderer({renderer,autoUpdate:!CAPTURE_ONLY});
    // Spark 0.1.10 构造器强制注册自动排序，须通过方法注销，直接改属性不会移除注册。
    if(CAPTURE_ONLY)sparkRenderer.defaultView.setAutoUpdate(false);
    scene.add(sparkRenderer);
    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / Math.max(1, window.innerHeight), 0.05, 500);
    camera.up.set(0, 0, 1);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0); sun.position.set(3, -5, 8); scene.add(sun);
    const grid = new THREE.GridHelper(20, 20, 0x2a5a6a, 0x1a3a44); grid.rotation.x = Math.PI / 2; scene.add(grid);

    let activeRig = CONFIG.initialCamera;
    let viewDistance = 1;
    const applyCamera = (rig) => {
      activeRig = rig;
      camera.position.set(rig.position[0], rig.position[1], rig.position[2]);
      camera.lookAt(rig.target[0], rig.target[1], rig.target[2]);
      viewDistance = Math.max(0.1, camera.position.distanceTo(new THREE.Vector3(...rig.target)));
      // 35mm 全画幅等效：vfov = 2·atan(12 / lens)
      camera.fov = (2 * Math.atan(12 / Math.max(10, rig.lens)) * 180) / Math.PI;
      camera.updateProjectionMatrix();
    };
    applyCamera(CONFIG.initialCamera);
    // 场景文件由服务端提供；拖动只改变本机预览机位，不为每个像素发送网络请求。
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.style.touchAction = "none";
    let drag = null;
    renderer.domElement.addEventListener("pointerdown", (ev) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const target = camera.position.clone().addScaledVector(dir, viewDistance);
      drag = {
        id: ev.pointerId, x: ev.clientX, y: ev.clientY,
        yaw: Math.atan2(-dir.y, -dir.x), pitch: Math.asin(Math.max(-1, Math.min(1, -dir.z))),
        distance: viewDistance, target,
      };
      renderer.domElement.setPointerCapture(ev.pointerId);
      renderer.domElement.style.cursor = "grabbing";
    });
    renderer.domElement.addEventListener("pointermove", (ev) => {
      if (!drag || drag.id !== ev.pointerId) return;
      const yaw = drag.yaw - (ev.clientX - drag.x) * 0.005;
      const pitch = Math.max(-1.35, Math.min(1.35, drag.pitch + (ev.clientY - drag.y) * 0.005));
      const xy = Math.cos(pitch);
      camera.position.set(
        drag.target.x + Math.cos(yaw) * xy * drag.distance,
        drag.target.y + Math.sin(yaw) * xy * drag.distance,
        drag.target.z + Math.sin(pitch) * drag.distance,
      );
      camera.lookAt(drag.target.x, drag.target.y, drag.target.z);
    });
    const endDrag = (ev) => {
      if (!drag || drag.id !== ev.pointerId) return;
      drag = null;
      renderer.domElement.style.cursor = "grab";
    };
    renderer.domElement.addEventListener("pointerup", endDrag);
    renderer.domElement.addEventListener("pointercancel", endDrag);
    renderer.domElement.addEventListener("lostpointercapture", endDrag);
    renderer.domElement.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const deltaPx = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? window.innerHeight : 1);
      const next = Math.max(0.6, Math.min(80, viewDistance * Math.exp(deltaPx * 0.0015)));
      const direction = camera.getWorldDirection(new THREE.Vector3());
      camera.position.addScaledVector(direction, viewDistance - next);
      viewDistance = next;
      // 拖动期间滚轮改变半径时同步，下一次移动不会弹回原距离。
      if (drag) drag.distance = next;
    }, { passive: false });

    const q = CONFIG.transform.quaternionXYZW, t = CONFIG.transform.translationStage, s = CONFIG.transform.scale;
    // 短暂断流时仅重试读取同一份已生成资产；不重新提交 3D 世界生成任务。
    const loadWorldSplat = async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const url = attempt ? CONFIG.spzUrl + (CONFIG.spzUrl.includes("?") ? "&" : "?") + "stageRetry=1" : CONFIG.spzUrl;
        const candidate = new SplatMesh({ url });
        candidate.quaternion.set(q[0], q[1], q[2], q[3]);
        candidate.scale.setScalar(s);
        candidate.position.set(t[0], t[1], t[2]);
        scene.add(candidate);
        try {
          if (!candidate.initialized || typeof candidate.initialized.then !== "function") throw new Error("SplatMesh 没有 initialized 信号");
          await candidate.initialized;
          if (candidate.numSplats !== undefined && !(candidate.numSplats > 0)) throw new Error("高斯数为 0");
          return;
        } catch (error) {
          scene.remove(candidate);
          try { candidate.dispose?.(); } catch { /* 加载未完成时清理失败，不覆盖原始网络错误。 */ }
          const message = String(error && error.message ? error.message : error);
          if (attempt || !/fetch|network|timeout/i.test(message)) throw error;
          msg.textContent = "场景读取中断，正在重试…";
        }
      }
    };

    const loader = new GLTFLoader();
    // 失败带 code 回传：HTTP 状态取 three HttpError.response.status；fetch 抛 TypeError 即网络失败；其余为模型解析失败
    const tagged = (message, code, status) => Object.assign(new Error(message), { code, ...(typeof status === "number" ? { status } : {}) });
    const loadGltf = (url) => new Promise((resolve, reject) => {
      if (!String(url || "").startsWith("https://")) { reject(tagged("缺少可用的人物模型", "missing_url")); return; }
      loader.load(url, resolve, undefined, (e) => {
        const status = e && e.response && typeof e.response.status === "number" ? e.response.status : undefined;
        const network = !status && Boolean(e) && (e instanceof TypeError || e.name === "TypeError");
        reject(tagged(e && e.message ? e.message : "load_failed", status ? "http" : network ? "network" : "parse", status));
      });
    });
    let collider = null;
    let cameraKind = "";
    let canExport = false;
    const required = [];
    const actorRoots = [];
    let animation = null;
    const renderAnimationFrame = () => {
      if (!animation) return;
      const elapsed=animation.playing ? (performance.now()-animation.startedAt)/1000+animation.offset : animation.offset;
      const index=Math.min(animation.frames.frames.length-1,Math.max(0,Math.floor(elapsed*24)));
      const row=animation.frames.frames[index];
      animation.mixer.setTime(index/24);
      const visible=new Set(row.visibleObjectIds);
      animation.root.traverse(o=>{if(o.userData.previsObjectId)o.visible=visible.has(o.userData.previsObjectId);});
      camera.position.fromArray(row.camera.position);
      camera.quaternion.fromArray(row.camera.quaternionXYZW);
      camera.fov=row.camera.vfovRad*180/Math.PI;
      camera.aspect=animation.frames.width/animation.frames.height;
      camera.updateProjectionMatrix();
      if(index===animation.frames.frames.length-1 && animation.playing){animation.playing=false;animation.offset=index/24;post({type:"animation_finished"});}
    };

    // 世界高斯：SparkJS SplatMesh 解码完成信号是 initialized（Promise）；没有这个信号就不能当已加载
    required.push({ id: "world", kind: "world", promise: loadWorldSplat() });
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
      required.push({ id: ch.id, kind: "actor", promise: (Number.isFinite(ch.stagePoint[0]) && Number.isFinite(ch.stagePoint[1]) ? loadGltf(ch.glbUrl) : Promise.reject(tagged("人物站位未确认", "no_position"))).then((gltf) => {
        const root = new THREE.Group();
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const nativeHeight = box.max.y - box.min.y;
        if (!Number.isFinite(nativeHeight) || nativeHeight <= 1e-6) throw tagged("人物模型为空或高度无效", "parse");
        // Y 上 → 舞台 Z 上：绕 X +90°
        model.rotation.x = Math.PI / 2;
        const scaleK = ch.heightM / nativeHeight;
        root.scale.setScalar(scaleK);
        root.rotation.z = (ch.yawDeg * Math.PI) / 180;
        // 脚贴地：模型 minY 在旋转后成为 z 方向的最低点
        root.position.set(ch.stagePoint[0], ch.stagePoint[1], -box.min.y * scaleK);
        root.add(model);
        scene.add(root); actorRoots.push(root);
      }) });
    }

    const loadAnimation = (glb,frames) => new Promise((resolve,reject)=> {
      loader.parse(glb,"",gltf=> {
        if(!gltf.animations.length){reject(new Error("animation_tracks_missing"));return;}
        if(animation)scene.remove(animation.root);
        const root=new THREE.Group();root.rotation.x=Math.PI/2;root.add(gltf.scene);scene.add(root);
        const mixer=new THREE.AnimationMixer(gltf.scene);
        for(const clip of gltf.animations){const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();}
        for(const root of actorRoots)root.visible=false;
        animation={root,mixer,frames,playing:true,startedAt:performance.now(),offset:0};
        renderAnimationFrame();resolve();
      },reject);
    });
    window.__MANHUA_STAGE__={ready:false,loadAnimation,
      renderFrame:async(timeSec)=>{
        if(!animation || !Number.isFinite(timeSec) || timeSec<0 || timeSec>animation.frames.frames.length/24)throw new Error("invalid_animation_frame");
        animation.playing=false;animation.offset=timeSec;renderAnimationFrame();
        scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
        // Spark's actual camera sort completion, not a fixed number of RAFs.
        await sparkRenderer.defaultView.prepare({scene,camera,update:true});
        drawFrame();
        return renderer.domElement.toDataURL("image/png");
      },state:()=>({animated:Boolean(animation),cameraPosition:camera.position.toArray(),aspect:camera.aspect,
        animationTimeSec:animation?.offset,visibleMeshIds:animation ? (()=>{const ids=[];animation.root.traverse(o=>{if(o.visible&&o.userData.previsObjectId)ids.push(o.userData.previsObjectId);});return ids;})():[]})};
    window.addEventListener("message", (ev) => {
      const m = ev.data || {};
      if (ev.source!==parent || m.source !== "manhua-world-stage-host" || m.revision !== CONFIG.revision) return;
      if(m.type==="animation_load" && m.glb instanceof ArrayBuffer && m.frames){
        loadAnimation(m.glb,m.frames).then(()=>post({type:"animation_started"})).catch(()=>post({type:"animation_error",message:"动画模型解析失败，未重新生成"}));
      }
      if(m.type==="animation_toggle" && animation){
        if(animation.playing)animation.offset=Math.min((animation.frames.frames.length-1)/24,(performance.now()-animation.startedAt)/1000+animation.offset);
        else if(animation.offset>=(animation.frames.frames.length-1)/24)animation.offset=0;
        animation.playing=!animation.playing;animation.startedAt=performance.now();
      }
      if(m.type==="animation_clear"){
        if(animation){scene.remove(animation.root);animation.mixer.stopAllAction();animation=null;}
        for(const root of actorRoots)root.visible=true;
        applyCamera(CONFIG.initialCamera);
      }

      if (m.type === "camera" && m.rig) { applyCamera(m.rig); cameraKind = String(m.cameraKind || ""); }
      if (m.type === "collider" && collider) collider.visible = Boolean(m.visible);
      if (m.type === "export" && canExport && !animation) {
        try {
          renderer.render(scene, camera);
          const dataUrl = renderer.domElement.toDataURL("image/png");
          if (!dataUrl.startsWith("data:image/png;base64,") || dataUrl.length <= "data:image/png;base64,".length) throw new Error("empty_png");
          const direction = camera.getWorldDirection(new THREE.Vector3());
          const target = camera.position.clone().addScaledVector(direction, viewDistance);
          post({
            type: "frame", dataUrl,
            viewLabelZh: m.viewLabelZh || "", cameraKind: String(m.cameraKind || cameraKind), requestId: m.requestId,
            cameraRig: { ...activeRig, position: camera.position.toArray(), target: target.toArray() },
          });
        }
        catch (e) { post({ type: "export_error", requestId: m.requestId, message: "视角图导出失败，请重试" }); }
      }
    });
    window.addEventListener("resize", () => { renderer.setSize(window.innerWidth, window.innerHeight); camera.aspect = window.innerWidth / Math.max(1, window.innerHeight); camera.updateProjectionMatrix(); });
    const drawFrame = () => {
      renderAnimationFrame();
      if(animation){
        const w=window.innerWidth,h=window.innerHeight,a=animation.frames.width/animation.frames.height;
        const rw=Math.min(w,h*a),rh=rw/a;
        renderer.setScissorTest(false);renderer.setViewport(0,0,w,h);renderer.clear();
        renderer.setViewport((w-rw)/2,(h-rh)/2,rw,rh);
      } else renderer.setViewport(0,0,window.innerWidth,window.innerHeight);
      renderer.render(scene,camera);
    };
    if(!CAPTURE_ONLY)renderer.setAnimationLoop(drawFrame);

    // WL-D02：等每个必需资产的真实成功信号，不用固定 sleep；全部结算后才报 ready（带清单）
    let settled = 0;
    msg.textContent = "正在加载 0/" + required.length + "…";
    for (const r of required) r.promise.then(() => { settled += 1; msg.textContent = "正在加载 " + settled + "/" + required.length + "…"; }, () => { settled += 1; });
    const results = await Promise.allSettled(required.map((r) => r.promise));
    const loaded = [], failed = [];
    results.forEach((res, i) => {
      const r = required[i];
      if (res.status === "fulfilled") loaded.push(r.id);
      else failed.push({
        id: r.id, kind: r.kind, message: String(res.reason && res.reason.message ? res.reason.message : res.reason || "load_failed").slice(0, 160),
        ...(res.reason && typeof res.reason.code === "string" ? { code: res.reason.code } : {}),
        ...(res.reason && typeof res.reason.status === "number" ? { status: res.reason.status } : {}),
      });
    });
    if (failed.some((f) => f.kind === "world")) {
      fail("3D 场景加载失败，请稍后重试");
    } else {
      msg.remove();
      window.__MANHUA_STAGE__.ready=true;
      canExport = failed.every((item) => item.kind === "collider");
      post({ type: "ready", loaded, failed });
    }
  } catch (e) {
    fail("3D 场景暂时无法打开，请稍后重试");
  }
}
<\/script></body></html>`;
}

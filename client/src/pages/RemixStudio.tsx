import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Image as ImageIcon,
  LoaderCircle,
  Music2,
  Sparkles,
  Video,
  AlertCircle,
  UploadCloud,
} from "lucide-react";
import BuildBadge from "../components/BuildBadge";

async function fetchJsonish(url: string, init?: RequestInit) {
  const resp = await fetch(url, init);
  const rawText = await resp.text();
  const contentType = resp.headers.get("content-type") || "";
  try {
    const json = JSON.parse(rawText);
    return { ok: resp.ok, status: resp.status, url, contentType, json };
  } catch (error: any) {
    return {
      ok: false,
      status: resp.status,
      url,
      contentType,
      parseError: error?.message || String(error),
      rawText: rawText.slice(0, 4000),
    };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("read file failed"));
    fr.onload = () => resolve(String(fr.result || ""));
    fr.readAsDataURL(file);
  });
}

function normalizeUiError(detail: unknown) {
  const raw = String(detail || "").trim();
  if (!raw) return "";
  if (/Account balance not enough/i.test(raw)) return "可灵视频当前账户余额不足，请先充值后再试。";
  if (/missing imageUrl/i.test(raw)) return "缺少参考图，请先上传图片或使用生图结果。";
  if (/missing_prompt/i.test(raw)) return "缺少提示词，请先填写提示词。";
  if (/upload failed/i.test(raw)) return "参考图上传失败，请重新上传。";
  if (/timeout/i.test(raw)) return "生成等待超时，可稍后重试一次。";
  if (/server_error/i.test(raw)) return "服务端暂时不可用，请稍后再试。";
  return raw;
}

type NodeStage = "idle" | "running" | "done" | "error";

type PanelState = {
  stage: NodeStage;
  taskId?: string;
  assetUrl?: string;
  error?: string;
};

type NodeItem = {
  id: "image" | "video" | "music" | "output";
  title: string;
  en: string;
  x: number;
  y: number;
  icon: React.ComponentType<{ size?: number; color?: string }>;
};

const PAGE_STYLE: React.CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(180deg, #f4f7fb 0%, #eef4ff 100%)",
  padding: 20,
};

const SHELL_STYLE: React.CSSProperties = {
  maxWidth: 1180,
  margin: "0 auto",
};

const PANEL_STYLE: React.CSSProperties = {
  marginTop: 18,
  padding: 20,
  borderRadius: 24,
  border: "1px solid #dbe4f0",
  background: "#ffffff",
  color: "#0f172a",
  boxShadow: "0 18px 50px rgba(15, 23, 42, 0.08)",
};

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  marginTop: 10,
  padding: 12,
  borderRadius: 14,
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  color: "#0f172a",
};

const PRIMARY_BUTTON: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid #111827",
  background: "#111827",
  color: "#ffffff",
  fontWeight: 900,
};

const SECONDARY_BUTTON: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#0f172a",
  fontWeight: 800,
};

const CODE_STYLE: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  background: "#eff6ff",
  borderRadius: 8,
  padding: "2px 6px",
};

const nodeItems: NodeItem[] = [
  { id: "image", title: "图文生图", en: "Kling Image", x: 46, y: 124, icon: ImageIcon },
  { id: "video", title: "图生视频", en: "Kling Video", x: 340, y: 70, icon: Video },
  { id: "music", title: "音乐生成", en: "Music", x: 340, y: 238, icon: Music2 },
  { id: "output", title: "成品输出", en: "Output", x: 660, y: 152, icon: Sparkles },
];

const nodeEdges: Array<[NodeItem["id"], NodeItem["id"]]> = [
  ["image", "video"],
  ["video", "output"],
  ["music", "output"],
];

function nodeTone(stage: NodeStage) {
  if (stage === "done") {
    return {
      border: "#10b981",
      bg: "linear-gradient(135deg, rgba(16,185,129,0.22), rgba(16,185,129,0.06))",
      badgeBg: "#dcfce7",
      badgeText: "#065f46",
      label: "已完成",
      glow: "0 18px 36px rgba(16,185,129,0.16)",
    };
  }
  if (stage === "running") {
    return {
      border: "#f59e0b",
      bg: "linear-gradient(135deg, rgba(245,158,11,0.22), rgba(245,158,11,0.06))",
      badgeBg: "#fef3c7",
      badgeText: "#92400e",
      label: "进行中",
      glow: "0 18px 36px rgba(245,158,11,0.16)",
    };
  }
  if (stage === "error") {
    return {
      border: "#ef4444",
      bg: "linear-gradient(135deg, rgba(239,68,68,0.22), rgba(239,68,68,0.06))",
      badgeBg: "#fee2e2",
      badgeText: "#991b1b",
      label: "异常",
      glow: "0 18px 36px rgba(239,68,68,0.16)",
    };
  }
  return {
    border: "#334155",
    bg: "linear-gradient(135deg, rgba(148,163,184,0.16), rgba(255,255,255,0.02))",
    badgeBg: "#e2e8f0",
    badgeText: "#475569",
    label: "待执行",
    glow: "none",
  };
}

function edgePath(from: NodeItem, to: NodeItem) {
  const x1 = from.x + 214;
  const y1 = from.y + 52;
  const x2 = to.x;
  const y2 = to.y + 52;
  const dx = Math.max(90, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function ResultBanner(props: { stage: NodeStage; error?: string; okText: string; runningText: string }) {
  if (props.stage === "error" && props.error) {
    return (
      <div style={{ marginTop: 12, borderRadius: 14, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", padding: 12 }}>
        <div style={{ fontWeight: 800 }}>执行失败</div>
        <div style={{ marginTop: 4 }}>{normalizeUiError(props.error)}</div>
      </div>
    );
  }
  if (props.stage === "running") {
    return (
      <div style={{ marginTop: 12, borderRadius: 14, border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", padding: 12 }}>
        {props.runningText}
      </div>
    );
  }
  if (props.stage === "done") {
    return (
      <div style={{ marginTop: 12, borderRadius: 14, border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#166534", padding: 12 }}>
        {props.okText}
      </div>
    );
  }
  return null;
}

function WorkflowCanvas(props: {
  imageState: PanelState;
  videoState: PanelState;
  musicState: PanelState;
  refImageUrl: string;
}) {
  const outputState: PanelState = useMemo(() => {
    if (props.videoState.stage === "done") {
      return { stage: "done", assetUrl: props.videoState.assetUrl };
    }
    if (props.videoState.stage === "error") {
      return { stage: "error", error: props.videoState.error };
    }
    if (props.videoState.stage === "running" || props.musicState.stage === "running") {
      return { stage: "running" };
    }
    return { stage: "idle" };
  }, [props.videoState, props.musicState]);

  const states: Record<NodeItem["id"], PanelState> = {
    image: props.imageState,
    video: props.videoState,
    music: props.musicState,
    output: outputState,
  };

  return (
    <div style={PANEL_STYLE}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>Kling Studio 节点工作流</div>
          <div style={{ marginTop: 6, color: "#475569", fontSize: 13 }}>
            把生图、图生视频和音乐合并到同一张画布上，先产出参考图，再推进视频和配乐。
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ borderRadius: 14, background: "#eff6ff", padding: "10px 12px", minWidth: 150 }}>
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>参考图状态</div>
            <div style={{ marginTop: 3, fontSize: 13, fontWeight: 900 }}>{props.refImageUrl ? "已接入画布" : "未设置"}</div>
          </div>
          <div style={{ borderRadius: 14, background: "#eff6ff", padding: "10px 12px", minWidth: 150 }}>
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>视频输出</div>
            <div style={{ marginTop: 3, fontSize: 13, fontWeight: 900 }}>{props.videoState.assetUrl ? "已生成" : "等待执行"}</div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, position: "relative", minHeight: 384, borderRadius: 28, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", background: "radial-gradient(circle at top left, rgba(59,130,246,0.16), transparent 24%), linear-gradient(180deg, #0f172a 0%, #111827 100%)" }}>
        <svg width="100%" height="384" viewBox="0 0 940 384" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
          {nodeEdges.map(([fromId, toId]) => {
            const from = nodeItems.find((item) => item.id === fromId)!;
            const to = nodeItems.find((item) => item.id === toId)!;
            return (
              <path
                key={`${fromId}-${toId}`}
                d={edgePath(from, to)}
                fill="none"
                stroke="rgba(148,163,184,0.46)"
                strokeWidth="3"
                strokeDasharray="8 8"
              />
            );
          })}
        </svg>

        {nodeItems.map((node) => {
          const state = states[node.id];
          const tone = nodeTone(state.stage);
          const Icon = node.icon;
          return (
            <div
              key={node.id}
              style={{
                position: "absolute",
                left: node.x,
                top: node.y,
                width: 214,
                minHeight: 104,
                borderRadius: 26,
                border: `1px solid ${tone.border}`,
                background: tone.bg,
                boxShadow: tone.glow,
                color: "#f8fafc",
                padding: 16,
                backdropFilter: "blur(10px)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 14, display: "grid", placeItems: "center", background: "rgba(15,23,42,0.34)" }}>
                    <Icon size={18} />
                  </div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 900 }}>{node.title}</div>
                    <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "rgba(226,232,240,0.72)", textTransform: "uppercase" }}>{node.en}</div>
                  </div>
                </div>
                <div style={{ borderRadius: 999, background: tone.badgeBg, color: tone.badgeText, padding: "4px 9px", fontSize: 11, fontWeight: 900 }}>
                  {tone.label}
                </div>
              </div>
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
                {state.stage === "done" ? <CheckCircle2 size={15} color="#86efac" /> : null}
                {state.stage === "running" ? <LoaderCircle size={15} color="#fde68a" /> : null}
                {state.stage === "error" ? <AlertCircle size={15} color="#fca5a5" /> : null}
                <div style={{ fontSize: 12, color: "rgba(226,232,240,0.9)" }}>
                  {state.error ? normalizeUiError(state.error) : state.taskId ? `任务：${state.taskId}` : state.assetUrl ? "结果已可预览" : "等待执行"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KlingImagePanel(props: { onUseAsRef: (url: string) => void; onStateChange: (state: PanelState) => void }) {
  const [prompt, setPrompt] = useState("电影级博物馆展陈，柔和博物馆灯光，超高清，构图干净，适合做视频参考图");
  const [size, setSize] = useState("1024x576");
  const [busy, setBusy] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [debug, setDebug] = useState<any>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    stopRef.current = false;
    return () => {
      stopRef.current = true;
    };
  }, []);

  useEffect(() => {
    props.onStateChange({
      stage: busy ? "running" : imageUrl ? "done" : debug?.ok === false ? "error" : "idle",
      taskId,
      assetUrl: imageUrl,
      error: debug?.ok === false ? String(debug?.error || "") : "",
    });
  }, [busy, taskId, imageUrl, debug, props]);

  async function start() {
    if (busy) return;
    setBusy(true);
    setTaskId("");
    setImageUrl("");
    setDebug({ ok: true, message: "clicked: kling-image create" });

    try {
      const created = await fetchJsonish("/api/kling-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, image_size: size, n: 1 }),
      });
      setDebug(created);

      const tid =
        (created as any)?.json?.taskId ||
        (created as any)?.json?.task_id ||
        (created as any)?.json?.raw?.data?.task_id ||
        (created as any)?.json?.data?.task_id ||
        null;
      if (!tid) throw new Error("missing task_id");
      setTaskId(String(tid));

      for (let i = 0; i < 120 && !stopRef.current; i++) {
        const polled = await fetchJsonish(`/api/kling-image?taskId=${encodeURIComponent(String(tid))}`);
        setDebug(polled);
        const status =
          (polled as any)?.json?.task_status ||
          (polled as any)?.json?.raw?.data?.task_status ||
          "";
        const nextUrl =
          (polled as any)?.json?.imageUrl ||
          (polled as any)?.json?.raw?.data?.task_result?.images?.[0]?.url ||
          null;
        if (nextUrl) {
          setImageUrl(String(nextUrl));
          return;
        }
        if (String(status).toLowerCase() === "failed") {
          throw new Error("kling image failed");
        }
        await sleep(2000);
      }
      throw new Error("kling image timeout");
    } catch (error: any) {
      setDebug({ ok: false, error: error?.message || String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={PANEL_STYLE}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>节点一：图文生图</div>
          <div style={{ marginTop: 6, color: "#475569", fontSize: 13 }}>先产出一张质量足够的参考图，再把它送入图生视频节点。</div>
        </div>
        <div style={{ borderRadius: 14, background: "#eff6ff", padding: "10px 12px", color: "#1d4ed8", fontWeight: 800 }}>
          Kling Image
        </div>
      </div>

      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} style={INPUT_STYLE} />

      <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <select value={size} onChange={(e) => setSize(e.target.value)} style={{ ...INPUT_STYLE, width: 220, marginTop: 0 }}>
          <option value="1024x576">1024x576（横屏）</option>
          <option value="576x1024">576x1024（竖屏）</option>
          <option value="1024x1024">1024x1024（方形）</option>
        </select>
        <button onClick={start} disabled={busy} style={{ ...PRIMARY_BUTTON, opacity: busy ? 0.7 : 1 }}>
          {busy ? "生成中…" : "开始生成"}
        </button>
        {taskId ? <span style={{ fontSize: 12, color: "#475569" }}>任务：<code style={CODE_STYLE}>{taskId}</code></span> : null}
      </div>

      <ResultBanner stage={busy ? "running" : imageUrl ? "done" : debug?.ok === false ? "error" : "idle"} error={debug?.error} okText="参考图已生成，可直接设为图生视频输入。" runningText="正在轮询可灵生图任务，请稍候。" />

      {imageUrl ? (
        <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
          <img src={imageUrl} alt="generated" style={{ width: "100%", borderRadius: 18, background: "#0f172a" }} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a href={imageUrl} target="_blank" rel="noreferrer" style={{ ...SECONDARY_BUTTON, textDecoration: "none" }}>
              打开图片
            </a>
            <button onClick={() => props.onUseAsRef(imageUrl)} style={PRIMARY_BUTTON}>
              设为图生视频参考图
            </button>
          </div>
        </div>
      ) : null}

      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>调试输出</summary>
        <pre style={{ whiteSpace: "pre-wrap", marginTop: 8, fontSize: 12 }}>{JSON.stringify(debug, null, 2)}</pre>
      </details>
    </div>
  );
}

function KlingVideoPanel(props: { refImageUrl: string; onRefImageUrlChange: (url: string) => void; onStateChange: (state: PanelState) => void }) {
  const [prompt, setPrompt] = useState("电影级场景，稳定镜头，细节丰富，人物一致性强");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [workflowResult, setWorkflowResult] = useState<any>(null);
  const [debug, setDebug] = useState<any>(null);

  useEffect(() => {
    const errorText =
      workflowResult?.outputs?.videoErrorMessage ||
      workflowResult?.outputs?.renderErrorMessage ||
      (debug?.ok === false ? debug?.error : "");
    props.onStateChange({
      stage:
        workflowResult?.status === "done" || videoUrl
          ? "done"
          : workflowResult?.status === "failed" || errorText
            ? "error"
            : busy || uploading || workflowId
              ? "running"
              : "idle",
      taskId: workflowResult?.workflowId || taskId,
      assetUrl: workflowResult?.outputs?.finalVideoUrl || workflowResult?.outputs?.videoUrl || videoUrl,
      error: errorText ? String(errorText) : "",
    });
  }, [busy, uploading, taskId, workflowId, videoUrl, workflowResult, debug, props]);

  useEffect(() => {
    if (!workflowId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (stopped) return;
      const resp = await fetchJsonish(`/api/jobs?op=workflowStatus&id=${encodeURIComponent(workflowId)}`);
      setDebug(resp);
      const workflow = (resp as any)?.json?.workflow;
      if ((resp as any)?.ok && workflow) {
        setWorkflowResult(workflow);
        const nextUrl = workflow?.outputs?.finalVideoUrl || workflow?.outputs?.videoUrl;
        if (nextUrl) setVideoUrl(String(nextUrl));
        const status = String(workflow?.status || "");
        if (status === "done" || status === "failed") return;
      }
      timer = setTimeout(poll, 2000);
    };

    void poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [workflowId]);

  async function upload(file: File) {
    setUploading(true);
    try {
      const dataUrl = await toDataUrl(file);
      const uploaded = await fetchJsonish("/api/blob-put-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, filename: file.name }),
      });
      setDebug(uploaded);
      const nextUrl = (uploaded as any)?.json?.imageUrl || (uploaded as any)?.imageUrl;
      if (!nextUrl) throw new Error("upload failed");
      props.onRefImageUrlChange(String(nextUrl));
    } finally {
      setUploading(false);
    }
  }

  async function start() {
    if (busy) return;
    if (uploading) {
      setDebug({ ok: false, error: "图片上传中，请稍后再试" });
      return;
    }
    setBusy(true);
    setTaskId("");
    setWorkflowId("");
    setVideoUrl("");
    setWorkflowResult(null);
    setDebug({ ok: true, message: "clicked: workflowTest" });

    try {
      const workflowInputType = props.refImageUrl ? "image" : "script";
      const trimmedPrompt = prompt.trim();
      const payload = props.refImageUrl
        ? { imageUrl: props.refImageUrl, ...(trimmedPrompt ? { prompt: trimmedPrompt } : {}) }
        : { prompt: trimmedPrompt };

      const resp = await fetchJsonish("/api/jobs?op=workflowTest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceType: "remix", inputType: workflowInputType, payload }),
      });
      setDebug(resp);

      const workflow = (resp as any)?.json?.workflow;
      if ((resp as any)?.ok && workflow) {
        setWorkflowResult(workflow);
        setTaskId(String(workflow.workflowId || ""));
        setWorkflowId(String(workflow.workflowId || ""));
        const nextUrl = workflow?.outputs?.finalVideoUrl || workflow?.outputs?.videoUrl;
        if (nextUrl) setVideoUrl(String(nextUrl));
        return;
      }

      throw new Error("workflow start failed");
    } catch (error: any) {
      setDebug({ ok: false, error: error?.message || String(error) });
    } finally {
      setBusy(false);
    }
  }

  const displayVideoUrl = workflowResult?.outputs?.finalVideoUrl || workflowResult?.outputs?.videoUrl || videoUrl;
  const errorText = workflowResult?.outputs?.videoErrorMessage || workflowResult?.outputs?.renderErrorMessage || debug?.error;
  const stage: NodeStage =
    workflowResult?.status === "done" || displayVideoUrl
      ? "done"
      : workflowResult?.status === "failed" || errorText
        ? "error"
        : busy || uploading || workflowId
          ? "running"
          : "idle";

  return (
    <div style={PANEL_STYLE}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>节点二：图生视频</div>
          <div style={{ marginTop: 6, color: "#475569", fontSize: 13 }}>上传参考图或接收上方生图结果，直接推进可灵图生视频工作流。</div>
        </div>
        <div style={{ borderRadius: 14, background: "#eff6ff", padding: "10px 12px", color: "#1d4ed8", fontWeight: 800 }}>
          Kling Video
        </div>
      </div>

      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <label style={{ ...SECONDARY_BUTTON, display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <UploadCloud size={16} />
              上传参考图
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (!file) return;
                  try {
                    await upload(file);
                  } catch (error: any) {
                    setDebug({ ok: false, error: error?.message || String(error) });
                  }
                }}
              />
            </label>
            <span style={{ fontSize: 12, color: "#475569" }}>
              {props.refImageUrl ? <>当前参考图：<code style={CODE_STYLE}>{props.refImageUrl}</code></> : "当前还没有参考图"}
            </span>
          </div>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} style={INPUT_STYLE} />
          <button onClick={start} disabled={busy || uploading} style={{ ...PRIMARY_BUTTON, marginTop: 12, opacity: busy || uploading ? 0.7 : 1 }}>
            {busy ? "生成中…" : uploading ? "上传中…" : "启动工作流"}
          </button>
          {taskId ? <div style={{ marginTop: 10, fontSize: 12, color: "#475569" }}>任务：<code style={CODE_STYLE}>{taskId}</code></div> : null}
          {workflowResult?.workflowId ? <div style={{ marginTop: 6, fontSize: 12, color: "#475569" }}>workflowId：<code style={CODE_STYLE}>{workflowResult.workflowId}</code></div> : null}

          <ResultBanner
            stage={stage}
            error={errorText}
            okText="视频已生成，可直接预览和下载。"
            runningText="工作流正在执行图生视频任务，请稍候。"
          />
        </div>

        <div style={{ borderRadius: 18, border: "1px solid #dbe4f0", background: "#f8fafc", padding: 14 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>当前产出</div>
          {displayVideoUrl ? (
            <div>
              <video controls src={displayVideoUrl} style={{ width: "100%", borderRadius: 14, background: "#0f172a" }} />
              <a href={displayVideoUrl} target="_blank" rel="noreferrer" style={{ ...SECONDARY_BUTTON, display: "inline-block", marginTop: 10, textDecoration: "none" }}>
                下载 MP4
              </a>
            </div>
          ) : props.refImageUrl ? (
            <img src={props.refImageUrl} alt="reference" style={{ width: "100%", borderRadius: 14, background: "#e2e8f0" }} />
          ) : (
            <div style={{ borderRadius: 14, minHeight: 180, display: "grid", placeItems: "center", background: "#e2e8f0", color: "#64748b", fontWeight: 700 }}>
              等待参考图或视频结果
            </div>
          )}
        </div>
      </div>

      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>调试输出</summary>
        <pre style={{ whiteSpace: "pre-wrap", marginTop: 8, fontSize: 12 }}>{JSON.stringify(debug, null, 2)}</pre>
      </details>
    </div>
  );
}

type MusicProvider = "suno" | "udio";

function MusicPanel(props: { onStateChange: (state: PanelState) => void }) {
  const [provider, setProvider] = useState<MusicProvider>("suno");
  const [prompt, setPrompt] = useState("高强度张力的对峙比赛风格，管弦乐背景，钢琴主旋律，BPM110，30秒");
  const [busy, setBusy] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [debug, setDebug] = useState<any>(null);
  const [clipsState, setClipsState] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const stopRef = useRef(false);

  useEffect(() => {
    stopRef.current = false;
    return () => {
      stopRef.current = true;
    };
  }, []);

  function clipsFrom(payload: any) {
    const raw = payload?.json?.raw || payload?.raw || payload?.json || {};
    const data = raw?.data;
    return Array.isArray(data) ? data : [];
  }

  const clips = clipsState.length ? clipsState : clipsFrom(debug);
  const selected = clips.find((item: any) => selectedId && item?.clip_id && String(item.clip_id) === selectedId) || clips[0] || null;

  useEffect(() => {
    props.onStateChange({
      stage: busy ? "running" : selected?.audio_url ? "done" : debug?.ok === false ? "error" : "idle",
      taskId,
      assetUrl: selected?.audio_url || "",
      error: debug?.ok === false ? String(debug?.error || "") : "",
    });
  }, [busy, taskId, selected, debug, props]);

  async function start() {
    if (busy) return;
    setBusy(true);
    setTaskId("");
    setDebug({ ok: true, message: "clicked: music create" });
    setClipsState([]);
    setSelectedId("");

    try {
      const createOp = provider === "suno" ? "aimusicSunoCreate" : "aimusicUdioCreate";
      const taskOp = provider === "suno" ? "aimusicSunoTask" : "aimusicUdioTask";

      const created = await fetchJsonish(`/api/jobs?op=${createOp}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      setDebug(created);

      const raw = (created as any)?.json?.raw || (created as any)?.raw || (created as any)?.json || {};
      const tid = raw?.task_id || raw?.data?.task_id || null;
      if (!tid) throw new Error("missing music task_id");
      setTaskId(String(tid));

      for (let i = 0; i < 120 && !stopRef.current; i++) {
        const polled = await fetchJsonish(`/api/jobs?op=${taskOp}&taskId=${encodeURIComponent(String(tid))}`);
        setDebug(polled);
        const list = clipsFrom(polled);
        if (Array.isArray(list) && list.length) {
          setClipsState(list);
          const firstPlayable = list.find((item: any) => item?.audio_url) || list[0];
          if (!selectedId && firstPlayable?.clip_id) setSelectedId(String(firstPlayable.clip_id));
          const okItem = list.find((item: any) => item?.audio_url && String(item?.state || "").toLowerCase() === "succeeded");
          if (okItem) return;
        }
        await sleep(2500);
      }
      throw new Error("music generation timeout");
    } catch (error: any) {
      setDebug({ ok: false, error: error?.message || String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={PANEL_STYLE}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>节点三：音乐生成</div>
          <div style={{ marginTop: 6, color: "#475569", fontSize: 13 }}>独立生成配乐，后续可以和视频结果一起交给主线做更深的成片整合。</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ borderRadius: 14, background: "#eff6ff", padding: "10px 12px", color: "#1d4ed8", fontWeight: 800 }}>Music</div>
          <select value={provider} onChange={(e) => setProvider(e.target.value as MusicProvider)} style={{ ...INPUT_STYLE, width: 180, marginTop: 0 }}>
            <option value="suno">Suno</option>
            <option value="udio">Udio</option>
          </select>
        </div>
      </div>

      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} style={INPUT_STYLE} />
      <button onClick={start} disabled={busy} style={{ ...PRIMARY_BUTTON, marginTop: 12, opacity: busy ? 0.7 : 1 }}>
        {busy ? "生成中…" : "开始生成"}
      </button>
      {taskId ? <div style={{ marginTop: 10, fontSize: 12, color: "#475569" }}>任务：<code style={CODE_STYLE}>{taskId}</code></div> : null}

      <ResultBanner
        stage={busy ? "running" : selected?.audio_url ? "done" : debug?.ok === false ? "error" : "idle"}
        error={debug?.error}
        okText="音乐已生成，可直接试听和下载。"
        runningText="音乐任务正在轮询，请稍候。"
      />

      {Array.isArray(clips) && clips.length ? (
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>
          <div style={{ display: "grid", gap: 8 }}>
            {clips.map((clip: any) => {
              const active = selectedId && clip?.clip_id && selectedId === String(clip.clip_id);
              return (
                <button
                  key={String(clip?.clip_id || Math.random())}
                  onClick={() => {
                    if (!clip?.audio_url) return;
                    if (clip?.clip_id) setSelectedId(String(clip.clip_id));
                  }}
                  disabled={!clip?.audio_url}
                  style={{
                    textAlign: "left",
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: "1px solid #dbe4f0",
                    background: active ? "#eff6ff" : "#ffffff",
                    color: "#0f172a",
                    cursor: clip?.audio_url ? "pointer" : "not-allowed",
                    opacity: clip?.audio_url ? 1 : 0.6,
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{clip?.title || "未命名片段"}</div>
                  <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>{clip?.state || ""}</div>
                </button>
              );
            })}
          </div>
          <div style={{ borderRadius: 18, border: "1px solid #dbe4f0", background: "#f8fafc", padding: 14 }}>
            {selected?.audio_url ? (
              <>
                <div style={{ fontWeight: 900 }}>{selected?.title || "当前音乐"}</div>
                <audio controls autoPlay src={selected.audio_url} style={{ width: "100%", marginTop: 12 }} />
                <a href={selected.audio_url} target="_blank" rel="noreferrer" style={{ ...SECONDARY_BUTTON, display: "inline-block", marginTop: 12, textDecoration: "none" }}>
                  下载音频
                </a>
              </>
            ) : (
              <div style={{ minHeight: 160, display: "grid", placeItems: "center", color: "#64748b", fontWeight: 700 }}>
                等待可试听的音乐结果
              </div>
            )}
          </div>
        </div>
      ) : null}

      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>调试输出</summary>
        <pre style={{ whiteSpace: "pre-wrap", marginTop: 8, fontSize: 12 }}>{JSON.stringify(debug, null, 2)}</pre>
      </details>
    </div>
  );
}

export default function RemixStudio() {
  const [refImageUrl, setRefImageUrl] = useState("");
  const [imageState, setImageState] = useState<PanelState>({ stage: "idle" });
  const [videoState, setVideoState] = useState<PanelState>({ stage: "idle" });
  const [musicState, setMusicState] = useState<PanelState>({ stage: "idle" });

  return (
    <div style={PAGE_STYLE}>
      <div style={SHELL_STYLE}>
        <BuildBadge />
        <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 34, fontWeight: 900, color: "#0f172a", letterSpacing: "-0.03em" }}>Kling Studio</div>
            <div style={{ marginTop: 6, color: "#475569", fontSize: 14 }}>
              节点工作流已经迁到这里：先生成参考图，再推进可灵图生视频，并补充配乐能力。
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ ...CODE_STYLE, background: "#dbeafe", color: "#1d4ed8" }}>1. 生图</span>
            <ArrowRight size={16} color="#94a3b8" />
            <span style={{ ...CODE_STYLE, background: "#dbeafe", color: "#1d4ed8" }}>2. 图生视频</span>
            <ArrowRight size={16} color="#94a3b8" />
            <span style={{ ...CODE_STYLE, background: "#dbeafe", color: "#1d4ed8" }}>3. 音乐</span>
          </div>
        </div>

        <WorkflowCanvas imageState={imageState} videoState={videoState} musicState={musicState} refImageUrl={refImageUrl} />
        <KlingImagePanel onUseAsRef={setRefImageUrl} onStateChange={setImageState} />
        <KlingVideoPanel refImageUrl={refImageUrl} onRefImageUrlChange={setRefImageUrl} onStateChange={setVideoState} />
        <MusicPanel onStateChange={setMusicState} />
      </div>
    </div>
  );
}

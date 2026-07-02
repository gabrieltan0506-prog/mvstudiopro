import React, { useCallback, useMemo, useRef, useState } from "react";
import Navbar from "@/components/Navbar";
import { ImageUpscaleBar } from "@/components/ImageUpscaleBar";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  type OmniVideoTask,
  createOmniInteraction,
  pollOmniInteractionUntilDone,
  resolveOmniMaterialUrl,
  runGeminiScript,
  runNanoImage,
  runUpscaleImage,
  uploadFileToSignedUrl,
} from "@/lib/omniCanvasApi";
import {
  Clapperboard,
  Eraser,
  Image as ImageIcon,
  LoaderCircle,
  Plus,
  Sparkles,
  Type,
  Upload,
  Video,
  Wand2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

/** 视频引擎：Omni 已接入；Seedance 2.5 预留位（后续同页接入） */
export type OmniCanvasVideoEngine = "omni" | "seedance25";

type NodeKind =
  | "text"
  | "image_gen"
  | "video_gen"
  | "video_matting"
  | "image_edit"
  | "seedance25_reserved";

type NodeStatus = "idle" | "running" | "done" | "error" | "coming_soon";

type CanvasNode = {
  id: string;
  kind: NodeKind;
  title: string;
  subtitle: string;
  x: number;
  y: number;
  color: string;
  icon: React.ComponentType<{ className?: string }>;
  prompt: string;
  aspectRatio: "9:16" | "16:9";
  durationSeconds: 10 | 30;
  resolution: "720p" | "1080p";
  videoTask: OmniVideoTask;
  imageUrl?: string;
  videoUrl?: string;
  gcsUri?: string;
  imagePreview?: string;
  videoPreview?: string;
  upscaleFactor: "x2" | "x4";
  removeBackground: boolean;
  status: NodeStatus;
  outputText?: string;
  outputUrl?: string;
  error?: string;
};

const VIDEO_TASK_OPTIONS: Array<{ id: OmniVideoTask; label: string }> = [
  { id: "text_to_video", label: "Text to Video" },
  { id: "image_to_video", label: "Image to Video" },
  { id: "reference_to_video", label: "Reference to Video" },
  { id: "edit_video", label: "Edit Video" },
  { id: "unspecified", label: "Unspecified" },
];

const MATTING_DEFAULT_PROMPT =
  "Professional video matting: remove the background completely, isolate the main subject with clean edges. Output video suitable for compositing with transparent or green-screen background.";

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function defaultNodes(): CanvasNode[] {
  return [
    {
      id: "text-1",
      kind: "text",
      title: "文字生成",
      subtitle: "Gemini 文本",
      x: 48,
      y: 80,
      color: "from-violet-500/35 to-indigo-500/10",
      icon: Type,
      prompt: "写一段 15 秒竖屏短视频的旁白文案，语气自然、有钩子。",
      aspectRatio: "9:16",
      durationSeconds: 10,
      resolution: "720p",
      videoTask: "text_to_video",
      upscaleFactor: "x2",
      removeBackground: false,
      status: "idle",
    },
    {
      id: "image-1",
      kind: "image_gen",
      title: "图片生成",
      subtitle: "Nano Banana",
      x: 320,
      y: 80,
      color: "from-emerald-500/35 to-teal-500/10",
      icon: ImageIcon,
      prompt: "电影感竖屏封面，主体清晰，留白适合放标题。",
      aspectRatio: "9:16",
      durationSeconds: 10,
      resolution: "720p",
      videoTask: "image_to_video",
      upscaleFactor: "x2",
      removeBackground: false,
      status: "idle",
    },
    {
      id: "video-1",
      kind: "video_gen",
      title: "视频生成",
      subtitle: "Gemini Omni Flash",
      x: 592,
      y: 80,
      color: "from-sky-500/35 to-cyan-500/10",
      icon: Video,
      prompt: "镜头缓慢推进，主体动作自然，电影级光影。",
      aspectRatio: "9:16",
      durationSeconds: 10,
      resolution: "720p",
      videoTask: "text_to_video",
      upscaleFactor: "x2",
      removeBackground: false,
      status: "idle",
    },
    {
      id: "matting-1",
      kind: "video_matting",
      title: "视频抠像",
      subtitle: "Omni · Edit Video",
      x: 864,
      y: 80,
      color: "from-orange-500/35 to-amber-500/10",
      icon: Eraser,
      prompt: MATTING_DEFAULT_PROMPT,
      aspectRatio: "9:16",
      durationSeconds: 10,
      resolution: "720p",
      videoTask: "edit_video",
      upscaleFactor: "x2",
      removeBackground: true,
      status: "idle",
    },
    {
      id: "edit-1",
      kind: "image_edit",
      title: "图片编辑",
      subtitle: "改元素 + 高清放大",
      x: 320,
      y: 320,
      color: "from-pink-500/35 to-fuchsia-500/10",
      icon: Wand2,
      prompt: "保留主体，替换背景为现代简约书房，光线柔和。",
      aspectRatio: "9:16",
      durationSeconds: 10,
      resolution: "720p",
      videoTask: "unspecified",
      upscaleFactor: "x2",
      removeBackground: false,
      status: "idle",
    },
    {
      id: "seedance-reserved",
      kind: "seedance25_reserved",
      title: "Seedance 2.5",
      subtitle: "图生视频 · 预留位",
      x: 592,
      y: 320,
      color: "from-white/10 to-white/5",
      icon: Zap,
      prompt: "",
      aspectRatio: "9:16",
      durationSeconds: 10,
      resolution: "720p",
      videoTask: "image_to_video",
      upscaleFactor: "x2",
      removeBackground: false,
      status: "coming_soon",
    },
  ];
}

const EDGES: Array<[string, string]> = [
  ["text-1", "video-1"],
  ["image-1", "video-1"],
  ["video-1", "matting-1"],
  ["image-1", "edit-1"],
  ["edit-1", "seedance-reserved"],
];

export default function OmniCanvas() {
  const [videoEngine, setVideoEngine] = useState<OmniCanvasVideoEngine>("omni");
  const [nodes, setNodes] = useState<CanvasNode[]>(() => defaultNodes());
  const [selectedId, setSelectedId] = useState<string>("video-1");
  const [uploadBusy, setUploadBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const getSignedUrlMutation = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();

  const selected = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? nodes[0]!,
    [nodes, selectedId],
  );

  const patchNode = useCallback((id: string, patch: Partial<CanvasNode>) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  const uploadMedia = useCallback(
    async (file: File, kind: "image" | "video") => {
      const safeName = file.name.replace(/[^a-z0-9._-]/gi, "-").replace(/-{2,}/g, "-");
      const mime = file.type || (kind === "video" ? "video/mp4" : "image/png");
      setUploadBusy(true);
      try {
        const signed = await getSignedUrlMutation.mutateAsync({
          fileName: file.name,
          mimeType: mime,
          objectName: `canvas/${kind}/${Date.now()}-${safeName}`,
        });
        await uploadFileToSignedUrl({
          file,
          uploadUrl: signed.uploadUrl,
          headers: signed.requiredHeaders,
        });
        if (!signed.gcsUri) throw new Error("上传完成但未返回 GCS 地址");
        const readUrl = await resolveOmniMaterialUrl(signed.gcsUri);
        const preview = kind === "image" ? readUrl : URL.createObjectURL(file);
        patchNode(selectedId, {
          gcsUri: signed.gcsUri,
          imageUrl: kind === "image" ? readUrl : selected.imageUrl,
          videoUrl: kind === "video" ? readUrl : selected.videoUrl,
          imagePreview: kind === "image" ? preview : selected.imagePreview,
          videoPreview: kind === "video" ? preview : selected.videoPreview,
        });
        toast.success(kind === "image" ? "图片已上传" : "视频已上传");
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "上传失败");
      } finally {
        setUploadBusy(false);
      }
    },
    [getSignedUrlMutation, patchNode, selectedId, selected.imageUrl, selected.videoUrl, selected.imagePreview, selected.videoPreview],
  );

  const runNode = useCallback(async () => {
    const node = nodes.find((n) => n.id === selectedId);
    if (!node) return;

    if (node.kind === "seedance25_reserved" || videoEngine === "seedance25") {
      toast.info("Seedance 2.5 即将在本页接入，当前为预留位");
      return;
    }

    patchNode(node.id, { status: "running", error: undefined, outputText: undefined, outputUrl: undefined });

    try {
      if (node.kind === "text") {
        const text = await runGeminiScript(node.prompt);
        patchNode(node.id, { status: "done", outputText: text });
        toast.success("文字生成完成");
        return;
      }

      if (node.kind === "image_gen") {
        const urls = await runNanoImage({
          prompt: node.prompt,
          aspectRatio: node.aspectRatio,
          imageUrl: node.imageUrl,
        });
        patchNode(node.id, { status: "done", outputUrl: urls[0], imagePreview: urls[0] });
        toast.success("图片生成完成");
        return;
      }

      if (node.kind === "image_edit") {
        let url = "";
        if (node.imageUrl) {
          const urls = await runNanoImage({
            prompt: node.prompt,
            aspectRatio: node.aspectRatio,
            imageUrl: node.imageUrl,
            imageSize: "2K",
          });
          url = urls[0] || "";
        } else {
          const urls = await runNanoImage({ prompt: node.prompt, aspectRatio: node.aspectRatio, imageSize: "2K" });
          url = urls[0] || "";
        }
        if (node.upscaleFactor !== "x2" || node.removeBackground) {
          url = await runUpscaleImage({
            imageUrl: url,
            upscaleFactor: node.upscaleFactor,
            prompt: node.removeBackground ? "isolate subject, clean edges, white background" : node.prompt,
          });
        }
        patchNode(node.id, { status: "done", outputUrl: url, imagePreview: url });
        toast.success("图片编辑完成");
        return;
      }

      if (node.kind === "video_gen" || node.kind === "video_matting") {
        if (node.kind === "video_matting" && !node.videoUrl && !node.gcsUri) {
          throw new Error("请先上传要抠像的视频");
        }
        const created = await createOmniInteraction({
          prompt: node.prompt,
          task: node.kind === "video_matting" ? "edit_video" : node.videoTask,
          aspectRatio: node.aspectRatio,
          durationSeconds: node.durationSeconds,
          imageUrl: node.imageUrl,
          videoUrl: node.videoUrl,
          gcsUri: node.gcsUri,
        });
        const result = await pollOmniInteractionUntilDone(created.id);
        const outUrl = String(result.videoUrl || "");
        if (!outUrl) throw new Error("视频任务完成但未返回 URL");
        patchNode(node.id, { status: "done", outputUrl: outUrl, videoPreview: outUrl });
        toast.success(node.kind === "video_matting" ? "视频抠像完成" : "视频生成完成");
        return;
      }

      throw new Error("未知节点类型");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "执行失败";
      patchNode(node.id, { status: "error", error: msg });
      toast.error(msg);
    }
  }, [nodes, patchNode, selectedId, videoEngine]);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  function renderEdge(fromId: string, toId: string) {
    const a = nodeMap.get(fromId);
    const b = nodeMap.get(toId);
    if (!a || !b) return null;
    const x1 = a.x + 128;
    const y1 = a.y + 48;
    const x2 = b.x;
    const y2 = b.y + 48;
    const mx = (x1 + x2) / 2;
    return (
      <path
        key={`${fromId}-${toId}`}
        d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={2}
      />
    );
  }

  function renderNodeCard(node: CanvasNode) {
    const Icon = node.icon;
    const active = node.id === selectedId;
    const isReserved = node.kind === "seedance25_reserved";
    return (
      <button
        key={node.id}
        type="button"
        onClick={() => setSelectedId(node.id)}
        className={`absolute w-64 rounded-2xl border p-4 text-left transition-all ${
          active ? "border-primary/70 ring-2 ring-primary/30" : "border-white/10 hover:border-white/25"
        } ${isReserved ? "opacity-80 border-dashed" : ""} bg-gradient-to-br ${node.color} backdrop-blur-sm`}
        style={{ left: node.x, top: node.y }}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-black/25">
            <Icon className="h-5 w-5 text-white/90" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">{node.title}</div>
            <div className="truncate text-xs text-white/55">{node.subtitle}</div>
          </div>
        </div>
        {node.status === "running" ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-primary">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> 运行中…
          </div>
        ) : null}
        {node.status === "error" ? (
          <div className="mt-3 line-clamp-2 text-xs text-red-300">{node.error}</div>
        ) : null}
        {node.status === "coming_soon" ? (
          <div className="mt-3 rounded-lg border border-dashed border-white/20 bg-black/20 px-2 py-1 text-xs text-white/50">
            即将接入 · 预留节点
          </div>
        ) : null}
        {(node.outputUrl || node.outputText) && node.status === "done" ? (
          <div className="mt-3 text-xs text-emerald-300">✓ 已有输出</div>
        ) : null}
      </button>
    );
  }

  const showVideoSettings =
    selected.kind === "video_gen" || selected.kind === "video_matting" || selected.kind === "seedance25_reserved";
  const needsImageUpload = selected.kind === "image_gen" || selected.kind === "image_edit" || selected.kind === "video_gen";
  const needsVideoUpload = selected.kind === "video_matting";

  return (
    <div className="min-h-dvh bg-transparent text-white">
      <Navbar />
      <main className="px-4 pb-10 pt-24 md:px-6">
        <div className="mx-auto max-w-[1920px]">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
                <Clapperboard className="h-3.5 w-3.5" />
                节点式画布 · Gemini Omni Flash Preview
              </div>
              <h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">Omni 视频创作画布</h1>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-white/65">
                文字 / 图片 / 视频生成、视频抠像、图片编辑与高清放大。模型对齐{" "}
                <a
                  href="https://aistudio.google.com/prompts/new_chat?model=gemini-omni-flash-preview"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  AI Studio · gemini-omni-flash-preview
                </a>
                。
              </p>
            </div>

            {/* 视频引擎切换：Omni 已接入 · Seedance 2.5 预留 */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setVideoEngine("omni")}
                className={`rounded-xl border px-4 py-2 text-sm transition ${
                  videoEngine === "omni"
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-white/15 bg-white/5 text-white/70 hover:border-white/30"
                }`}
              >
                Gemini Omni Flash
              </button>
              <button
                type="button"
                onClick={() => setVideoEngine("seedance25")}
                className={`rounded-xl border px-4 py-2 text-sm transition ${
                  videoEngine === "seedance25"
                    ? "border-amber-400/50 bg-amber-500/10 text-amber-200"
                    : "border-dashed border-white/20 bg-white/[0.03] text-white/45 hover:border-white/35"
                }`}
              >
                Seedance 2.5
                <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">预留</span>
              </button>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            {/* 左侧画布 */}
            <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#070b14]/80">
              <div className="border-b border-white/10 px-4 py-3 text-xs text-white/45">
                节点画布 · 点击节点后在右侧 Run settings 配置并运行
              </div>
              <div className="relative h-[640px] overflow-auto">
                <svg className="pointer-events-none absolute inset-0 h-[640px] w-[1200px]">
                  {EDGES.map(([a, b]) => renderEdge(a, b))}
                </svg>
                <div className="relative h-[640px] w-[1200px]">
                  {nodes.map(renderNodeCard)}

                  {/* Seedance 2.5 扩展预留区（虚线框，后续接入同页） */}
                  <div
                    className="pointer-events-none absolute rounded-[24px] border-2 border-dashed border-amber-400/25 bg-amber-500/[0.03]"
                    style={{ left: 520, top: 280, width: 400, height: 200 }}
                  >
                    <div className="absolute left-4 top-3 text-xs font-medium uppercase tracking-[0.2em] text-amber-200/70">
                      Seedance 2.5 扩展区
                    </div>
                    <div className="absolute bottom-4 left-4 right-4 text-xs leading-5 text-white/40">
                      图生视频 / 多参考 / 更长时长将在此区域与 Omni 节点并列运行。接口占位已保留，接入后无需改路由。
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 右侧 Run settings */}
            <aside className="rounded-[28px] border border-white/10 bg-[#0b1020]/95 p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-white/40">Run settings</div>
                  <div className="mt-1 text-lg font-semibold">{selected.title}</div>
                </div>
                <Button
                  size="sm"
                  className="rounded-xl"
                  disabled={selected.status === "running" || selected.kind === "seedance25_reserved"}
                  onClick={() => void runNode()}
                >
                  {selected.status === "running" ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  运行
                </Button>
              </div>

              {videoEngine === "seedance25" && selected.kind === "video_gen" ? (
                <div className="mb-4 rounded-xl border border-dashed border-amber-400/30 bg-amber-500/5 p-4 text-sm text-amber-100/80">
                  <div className="font-medium text-amber-200">Seedance 2.5 · 即将接入</div>
                  <p className="mt-2 text-xs leading-6 text-amber-100/65">
                    本页已预留引擎切换、画布节点与扩展区。后续将接入图生视频（fal / 官方 API），与 Omni 共用上传与输出预览。
                  </p>
                </div>
              ) : null}

              {selected.kind === "seedance25_reserved" ? (
                <div className="space-y-3 rounded-xl border border-dashed border-white/15 p-4 text-sm text-white/55">
                  <p>此节点为 Seedance 2.5 占位，暂不可运行。</p>
                  <ul className="list-disc space-y-1 pl-4 text-xs leading-6">
                    <li>图生视频（Image → Video）</li>
                    <li>与左侧「图片编辑」输出串联</li>
                    <li>积分与时长策略待产品定稿</li>
                  </ul>
                </div>
              ) : (
                <>
                  <label className="block text-xs text-white/45">Prompt / 指令</label>
                  <textarea
                    value={selected.prompt}
                    onChange={(e) => patchNode(selected.id, { prompt: e.target.value })}
                    rows={5}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-primary/50"
                  />

                  {(needsImageUpload || needsVideoUpload) && (
                    <div className="mt-4 space-y-3">
                      <div className="text-xs uppercase tracking-[0.16em] text-white/40">上传素材</div>
                      {needsImageUpload ? (
                        <div>
                          <input
                            ref={imageInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) void uploadMedia(f, "image");
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full rounded-xl border-white/15 bg-white/5"
                            disabled={uploadBusy}
                            onClick={() => imageInputRef.current?.click()}
                          >
                            <Upload className="mr-2 h-4 w-4" />
                            {uploadBusy ? "上传中…" : "上传图片（PNG / JPG）"}
                          </Button>
                          {selected.imagePreview ? (
                            <img
                              src={selected.imagePreview}
                              alt="uploaded"
                              className="mt-2 max-h-36 w-full rounded-xl border border-white/10 object-contain"
                            />
                          ) : null}
                        </div>
                      ) : null}

                      {needsVideoUpload ? (
                        <div>
                          <input
                            ref={videoInputRef}
                            type="file"
                            accept="video/mp4,video/webm,video/quicktime"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) void uploadMedia(f, "video");
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full rounded-xl border-white/15 bg-white/5"
                            disabled={uploadBusy}
                            onClick={() => videoInputRef.current?.click()}
                          >
                            <Upload className="mr-2 h-4 w-4" />
                            {uploadBusy ? "上传中…" : "上传视频（MP4 / WebM）"}
                          </Button>
                          {selected.videoPreview ? (
                            <video
                              src={selected.videoPreview}
                              controls
                              className="mt-2 max-h-40 w-full rounded-xl border border-white/10"
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )}

                  {showVideoSettings ? (
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-white/45">Aspect ratio</label>
                        <select
                          value={selected.aspectRatio}
                          onChange={(e) =>
                            patchNode(selected.id, { aspectRatio: e.target.value as "9:16" | "16:9" })
                          }
                          className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm"
                        >
                          <option value="9:16">9:16</option>
                          <option value="16:9">16:9</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-white/45">Duration</label>
                        <select
                          value={selected.durationSeconds}
                          onChange={(e) =>
                            patchNode(selected.id, {
                              durationSeconds: Number(e.target.value) as 10 | 30,
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm"
                        >
                          <option value={10}>10s</option>
                          <option value={30}>30s</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-white/45">Resolution</label>
                        <select
                          value={selected.resolution}
                          onChange={(e) =>
                            patchNode(selected.id, {
                              resolution: e.target.value as "720p" | "1080p",
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm"
                        >
                          <option value="720p">720p</option>
                          <option value="1080p">1080p</option>
                        </select>
                      </div>
                      {selected.kind === "video_gen" ? (
                        <div>
                          <label className="text-xs text-white/45">Video task</label>
                          <select
                            value={selected.videoTask}
                            onChange={(e) =>
                              patchNode(selected.id, { videoTask: e.target.value as OmniVideoTask })
                            }
                            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm"
                          >
                            {VIDEO_TASK_OPTIONS.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {selected.kind === "image_edit" ? (
                    <div className="mt-4 space-y-3">
                      <div>
                        <label className="text-xs text-white/45">高清放大</label>
                        <select
                          value={selected.upscaleFactor}
                          onChange={(e) =>
                            patchNode(selected.id, { upscaleFactor: e.target.value as "x2" | "x4" })
                          }
                          className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm"
                        >
                          <option value="x2">x2</option>
                          <option value="x4">x4</option>
                        </select>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-white/70">
                        <input
                          type="checkbox"
                          checked={selected.removeBackground}
                          onChange={(e) => patchNode(selected.id, { removeBackground: e.target.checked })}
                        />
                        去背景 / 抠图主体
                      </label>
                    </div>
                  ) : null}
                </>
              )}

              {/* 输出预览 */}
              {(selected.outputText || selected.outputUrl) && selected.status === "done" ? (
                <div className="mt-5 rounded-xl border border-white/10 bg-black/25 p-3">
                  <div className="text-xs uppercase tracking-[0.16em] text-white/40">Output</div>
                  {selected.outputText ? (
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-white/80">
                      {selected.outputText}
                    </pre>
                  ) : null}
                  {selected.outputUrl && selected.outputUrl.startsWith("data:image") ? (
                    <img src={selected.outputUrl} alt="output" className="mt-2 w-full rounded-lg" />
                  ) : null}
                  {selected.outputUrl && !selected.outputUrl.startsWith("data:image") && selected.kind.includes("video") ? (
                    <video src={selected.outputUrl} controls className="mt-2 w-full rounded-lg" />
                  ) : null}
                  {selected.outputUrl && selected.kind === "image_edit" ? (
                    <>
                      <img src={selected.outputUrl} alt="output" className="mt-2 w-full rounded-lg" />
                      <ImageUpscaleBar imageUrl={selected.outputUrl} baseCreditKey="nbpImage2K" className="mt-2" />
                    </>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-5 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl border-white/15"
                  onClick={() => {
                    const id = makeId("node");
                    setNodes((prev) => [
                      ...prev,
                      {
                        ...selected,
                        id,
                        x: selected.x + 40,
                        y: selected.y + 40,
                        status: "idle" as const,
                        outputText: undefined,
                        outputUrl: undefined,
                        error: undefined,
                      },
                    ]);
                    setSelectedId(id);
                  }}
                >
                  <Plus className="mr-1 h-4 w-4" /> 复制节点
                </Button>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}

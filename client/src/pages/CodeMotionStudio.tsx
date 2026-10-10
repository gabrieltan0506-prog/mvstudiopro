import { retimeCodeMotionPlanScene } from "@shared/codeMotionComposition";
import { INK_FREE_POLICY, inkFreeMessage } from "@shared/inkFree";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  ArrowLeft,
  Download,
  Loader2,
  Plus,
  Sparkles,
  Upload,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { flyDownloadUrl, gcsTransferUrl } from "@/lib/gcsTransfer";
import CodeMotionVideoPptx from "@/components/CodeMotionVideoPptx";
import CodeMotionSpreadsheetPicker from "@/components/code-motion/CodeMotionSpreadsheetPicker";
import type { CodeMotionWorkbook } from "@shared/codeMotionSpreadsheet";
import CodeMotionAudioPanel from "@/components/code-motion/CodeMotionAudioPanel";
import CodeMotionSceneEditor, {
  makeCodeMotionScene,
} from "@/components/code-motion/CodeMotionSceneEditor";
import CodeMotionPreview from "@/components/code-motion/CodeMotionPreview";
import {
  codeMotionBriefSchema,
  codeMotionProjectSchema,
  codeMotionLocalProjectSchema,
  parseCodeMotionTable,
  validateCodeMotionPlan,
  codeMotionSceneDescription,
  type CodeMotionBrief,
  type CodeMotionProject,
  type CodeMotionPlan,
} from "@shared/codeMotion";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

const PlatformHtmlPptPanel = lazy(
  () => import("@/components/PlatformHtmlPptPanel")
);
type Prepared = inferRouterOutputs<AppRouter>["codeMotion"]["prepare"];
const pendingSchema = z
  .object({
    requestId: z.string().uuid(),
    projectId: z.string().uuid(),
    brief: codeMotionBriefSchema,
    confirmPaid: z.boolean(),
    confirmedCredits: z.number().int().nonnegative().optional(),
    failed: z.boolean().optional(),
  })
  .strict();
type Pending = z.infer<typeof pendingSchema>;
const pptDataSchema = z
  .array(
    z
      .object({
        label: z.string().min(1).max(30),
        value: z.number().finite().min(0).max(1e9).nullable(),
      })
      .strict()
  )
  .max(200);
const fresh = (): CodeMotionProject => ({
  id: crypto.randomUUID(),
  brief: {
    title: "我的第一条介绍",
    request: "",
    text: "",
    style: "scenes",
    duration: 30,
    orientation: "landscape",
    images: [],
    data: [],
    unit: "",
    chart: "bar",
    period: "",
    source: "",
  },
  plan: null,
});
const field =
  "mt-2 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300";
const button =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40";
const labels: Record<string, string> = {
  queued: "排队中",
  running: "正在制作",
  succeeded: "视频已生成",
  failed: "本次未完成",
  canceled: "已取消",
  cancelled: "已取消",
};
function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function CodeMotionStudio() {
  const { user } = useAuth();
  const [tableText, setTableText] = useState("");
  const [pptData, setPptData] = useState<CodeMotionBrief["data"] | null>(null);
  const [output, setOutput] = useState<"video" | "ppt">("video"),
    [pptOpened, setPptOpened] = useState(false);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const [project, setProject] = useState<CodeMotionProject>(fresh),
    [generation, setGeneration] = useState("0"),
    [savedJson, setSavedJson] = useState("");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState<Pending | null>(null);
  const [imported, setImported] = useState<{
    name: string;
    text: string;
    message: string;
  } | null>(null);
  const [spreadsheet, setSpreadsheet] = useState<{
    name: string;
    workbook: CodeMotionWorkbook;
  } | null>(null);
  const importFile = trpc.codeMotion.importFile.useMutation();
  const [prepared, setPrepared] = useState<Prepared | null>(null),
    [preview, setPreview] = useState(false),
    [reviewOpen, setReviewOpen] = useState(false);
  const lock = useRef(false),
    active = useRef<string>("");
  const identity = `${user?.id || "guest"}:${project.id}`;
  active.current = identity;
  const utils = trpc.useUtils();
  const quote = trpc.codeMotion.quote.useQuery(undefined, {
    enabled: !!user,
    retry: false,
  });
  const projects = trpc.codeMotion.list.useQuery(undefined, {
    enabled: !!user,
    retry: false,
  });
  const saveMutation = trpc.codeMotion.save.useMutation(),
    submitMutation = trpc.codeMotion.submit.useMutation();
  const ask = trpc.mvAnalysis.askPlatformSkillQa.useMutation(),
    upload = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();
  const history = trpc.codeMotion.history.useQuery(
    { projectId: project.id },
    {
      enabled:
        !!user &&
        generation !== "0" &&
        hydratedKey === `yingke:draft:${user.id}`,
      retry: false,
      refetchInterval: q =>
        q.state.data?.some(
          row => row && ["queued", "running"].includes(row.status)
        )
          ? 4000
          : false,
    }
  );
  const latestProject = useRef(project);
  latestProject.current = project;
  const dirty = savedJson !== JSON.stringify(project);
  const status = trpc.codeMotion.status.useQuery(
    { projectId: project.id },
    {
      enabled:
        !!user &&
        hydratedKey === `yingke:draft:${user.id}` &&
        generation !== "0" &&
        !!project.plan &&
        !dirty,
      retry: false,
      refetchInterval: q =>
        q.state.data && ["queued", "running"].includes(q.state.data.status)
          ? 4000
          : false,
    }
  );
  const key = `yingke:draft:${user?.id || "guest"}`;
  useEffect(() => {
    setHydratedKey(null);
    setPptOpened(false);
    setOutput("video");
    setPrepared(null);
    setPreview(false);
    setPending(null);
    setSpreadsheet(null);
    setImported(null);
    setPptData(null);
    setGeneration("0");
    setSavedJson("");
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const value = JSON.parse(raw);
        if (value.pptData) setPptData(pptDataSchema.parse(value.pptData));
        setProject(codeMotionLocalProjectSchema.parse(value.project));
        setGeneration(
          typeof value.generation === "string" ? value.generation : "0"
        );
        setSavedJson(
          typeof value.savedJson === "string" ? value.savedJson : ""
        );
        if (value.pending) {
          setPending(pendingSchema.parse(value.pending));
        }
      } else setProject(fresh());
    } catch {
      try {
        const raw = localStorage.getItem(key);
        if (raw) localStorage.setItem(`${key}:unreadable:${Date.now()}`, raw);
      } catch {
        setMessage(
          "本机草稿无法读取或备份，已停止写入，请保留本页并检查浏览器存储。"
        );
        return;
      }
      setProject(fresh());
      setMessage(
        "本机草稿无法读取，已保留原始备份；请从已保存作品中打开，没有覆盖云端内容。"
      );
    }
    setHydratedKey(key);
  }, [key]);
  useEffect(() => {
    if (hydratedKey !== key) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ project, generation, savedJson, pending, pptData })
      );
    } catch {
      setMessage(
        "本机草稿保存空间不足。请先保存到云端或下载工程，再继续操作。"
      );
    }
  }, [key, hydratedKey, project, generation, savedJson, pending, pptData]);
  const persistPending = (
    value: Pending | null,
    currentProject = project,
    currentGeneration = generation,
    currentSavedJson = savedJson
  ) => {
    const raw = JSON.stringify({
      project: currentProject,
      generation: currentGeneration,
      savedJson: currentSavedJson,
      pending: value,
      pptData,
    });
    localStorage.setItem(key, raw);
    if (localStorage.getItem(key) !== raw)
      throw new Error("恢复记录没有保存成功，尚未开始整理");
    setPending(value);
  };
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message.replace(/ADVISOR_OPERATION_[A-Z_]+[:：]?\s*/g, "")
          : "操作未完成，请保留本页内容"
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const patchBrief = (patch: Partial<CodeMotionBrief>) => {
    setProject(p => ({ ...p, brief: { ...p.brief, ...patch }, plan: null }));
    setPrepared(null);
    setPreview(false);
    setReviewOpen(false);
  };
  const save = async (value = project) => {
    if (!user) throw new Error("请先登录后保存作品");
    const captured = active.current;
    const receipt = await saveMutation.mutateAsync({
      project: codeMotionProjectSchema.parse(value),
      expectedGeneration: generation,
    });
    if (active.current !== captured)
      throw new Error("已切换作品，保存回执保留在原作品中");
    setProject(receipt.project);
    setGeneration(receipt.generation);
    setSavedJson(JSON.stringify(receipt.project));
    await projects.refetch();
    return receipt;
  };
  const requestPlan = async (original?: Pending) => {
    if (!user) throw new Error("请先登录，查看这次整理需要多少积分");
    const brief = codeMotionBriefSchema.parse(original?.brief || project.brief);
    const q = quote.data;
    if (!original && !q) throw new Error("本次费用还没查到，请稍后再试");
    const request: Pending = original || {
      requestId: crypto.randomUUID(),
      projectId: project.id,
      brief,
      confirmPaid: !!q?.credits,
      ...(q?.credits ? { confirmedCredits: q.credits } : {}),
    };
    if (request.projectId !== project.id)
      throw new Error("请先打开原作品，再取回之前的内容安排");
    const before = !original ? await save() : null;
    persistPending(
      request,
      project,
      before?.generation || generation,
      before ? JSON.stringify(before.project) : savedJson
    );
    const captured = active.current;
    try {
      const response = await ask.mutateAsync({
        question: "请根据本次资料和要求整理视频安排",
        rawQuestion: "请根据本次资料和要求整理视频安排",
        codeMotionContext: request.brief,
        qaModel: "gpt-5.6-terra",
        requestId: request.requestId,
        confirmPaid: request.confirmPaid,
        confirmedCredits: request.confirmedCredits,
      });
      if (active.current !== captured) return;
      const plan = validateCodeMotionPlan(
        request.brief,
        JSON.parse(response.answer)
      );
      const value = { ...project, brief: request.brief, plan };
      setProject(value);
      setPrepared(null);
      setPreview(false);
      persistPending(
        null,
        value,
        before?.generation || generation,
        before ? JSON.stringify(before.project) : savedJson
      );
      setMessage(
        `内容已整理，请逐项查看。${response.creditsCharged ? `本次使用 ${response.creditsCharged} 积分。` : "本次未扣积分。"}`
      );
      await quote.refetch();
    } catch (e) {
      if (active.current !== captured) return;
      const msg = e instanceof Error ? e.message : "";
      if (
        /ADVISOR_OPERATION_FAILED(?!.*REFUND)|PAYMENT_REQUIRED|扣除.*积分.*确认/.test(
          msg
        )
      ) {
        persistPending({ ...request, failed: true });
        await quote.refetch();
      }
      throw e;
    }
  };
  const arrangeManually = () => {
    const brief = codeMotionBriefSchema.parse(project.brief);
    const lines = (brief.text || brief.request)
      .split(/\n+/)
      .map(x => x.trim())
      .filter(Boolean);
    if (!lines.length || lines.length > 12 || lines.length * 2 > brief.duration)
      throw new Error("请按画面分成最多十二段，每段至少留两秒");
    const source =
      brief.style === "data"
        ? [brief.text || brief.request]
        : Array.from(
            { length: Math.max(lines.length, brief.images.length) },
            (_, i) => lines[i] || brief.title
          );
    if (source.length * 2 > brief.duration)
      throw new Error("画面较多，请增加片长，让每个画面至少停留两秒");
    const sceneDuration = Math.floor(brief.duration / source.length);
    const plan: CodeMotionPlan = {
      version: 1,
      summary: "按你提供的段落顺序展示，可在下方直接修改文字、动作和声音时间。",
      ...(brief.audios?.length
        ? {
            audioTimeline: brief.audios.map((audio, i) => ({
              sourceId: audio.id,
              role: i === 0 ? ("narration" as const) : ("bgm" as const),
              at: 0,
              trimStart: 0,
              duration: Math.min(audio.duration, brief.duration),
              volume: i === 0 ? 1 : 0.2,
              fadeIn: 0,
              fadeOut: 0,
            })),
          }
        : {}),
      scenes: source.map((text, i) => ({
        heading: brief.style === "data" ? brief.title : text.slice(0, 48),
        body: brief.style === "data" ? text : text.slice(48),
        ...(!brief.audios?.length &&
        brief.duration <= 60 &&
        quote.data?.speechEnabled
          ? { speech: { text, voice: "female" as const } }
          : {}),
        ...(brief.style === "scenes"
          ? {
              composition: makeCodeMotionScene(
                `scene_${i + 1}`,
                i === source.length - 1
                  ? brief.duration - sceneDuration * i
                  : sceneDuration,
                text,
                brief.images[i]?.id
              ),
            }
          : {}),
        duration:
          i === source.length - 1
            ? brief.duration - sceneDuration * i
            : sceneDuration,
        ...(brief.images[i] ? { imageId: brief.images[i].id } : {}),
      })),
    };
    setProject({ ...project, plan: validateCodeMotionPlan(brief, plan) });
    setPrepared(null);
    setPreview(false);
  };
  const inspect = async () => {
    const captured = active.current;
    await save();
    const value = await utils.codeMotion.prepare.fetch({
      projectId: project.id,
    });
    if (captured !== active.current) return;
    setPrepared(value);
    setPreview(false);
    setReviewOpen(true);
  };
  const fileSelected = async (file: File) => {
    if (!user) throw new Error("请先登录再导入文件");
    const captured = active.current;
    const ext = file.name.split(".").at(-1)?.toLowerCase() || "";
    if (
      ![
        "png",
        "jpg",
        "jpeg",
        "webp",
        "pdf",
        "docx",
        "md",
        "xlsx",
        "csv",
      ].includes(ext) ||
      file.size > 8 * 1024 * 1024 ||
      !file.size
    )
      throw new Error(
        "请选择不超过 8 MB 的 PNG、JPG、WebP、PDF、DOCX、MD、XLSX 或 CSV 文件"
      );
    if (
      ["png", "jpg", "jpeg", "webp"].includes(ext) &&
      project.brief.images.length >= 8
    )
      throw new Error("一条视频最多放八张图片");
    if (
      ["png", "jpg", "jpeg", "webp"].includes(ext) &&
      project.brief.data.length
    )
      throw new Error(
        "图片用于图文介绍，请先保留并移除当前数据，或新建一条图文视频"
      );
    const mime = (
      {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        pdf: "application/pdf",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        md: "text/markdown",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        csv: "text/csv",
      } as Record<string, string>
    )[ext];
    const receipt = await upload.mutateAsync({
      fileName: file.name,
      mimeType: mime,
    });
    const response = await fetch(gcsTransferUrl(receipt.uploadUrl), {
      method: "PUT",
      headers: { "Content-Type": mime, ...receipt.requiredHeaders },
      body: file,
    });
    if (!response.ok) throw new Error("文件上传没有完成，请重新选择");
    const result = await importFile.mutateAsync({
      gcsUri: receipt.gcsUri,
      name: file.name,
      bytes: file.size,
    });
    if (captured !== active.current) return;
    if (result.kind === "spreadsheet") {
      setSpreadsheet({ name: result.name, workbook: result.workbook });
      setMessage(result.message);
    } else if (result.kind === "image") {
      patchBrief({
        images: [...project.brief.images, result.image],
        style: project.brief.style === "scenes" ? "scenes" : "cards",
        data: [],
      });
      setMessage(result.message);
    } else
      setImported({
        name: result.name,
        text: result.text,
        message: result.message,
      });
  };
  const result = status.data?.output as { url?: unknown } | null | undefined;
  const videoUrl =
    status.data?.status === "succeeded" && typeof result?.url === "string"
      ? flyDownloadUrl(result.url)
      : "";
  const editDisabled =
    busy || hydratedKey !== key || !!(pending && !pending.failed);
  return (
    <main className="min-h-screen bg-[#f7f4ed] text-stone-900">
      <header className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-6">
        <a href="/" className="flex items-center gap-2 text-sm text-stone-600">
          <ArrowLeft size={17} />
          回到首页
        </a>
        <div>
          <span className="text-xl font-semibold">映客 INK</span>
          <span className="ml-3 text-sm text-stone-500">让内容动起来</span>
        </div>
        <button
          className={button}
          onClick={() =>
            downloadJson(
              { ...project, pptData },
              `${project.brief.title || "映客 INK"}-工程.json`
            )
          }
        >
          <Download size={15} />
          下载工程
        </button>
      </header>
      <div className="mx-auto max-w-7xl px-5 pb-6">
        <p className="mb-3 text-sm font-medium">这次想做什么？</p>
        <div
          role="group"
          aria-label="选择输出内容"
          className="inline-flex rounded-2xl border border-stone-200 bg-white p-1"
        >
          <button
            type="button"
            aria-pressed={output === "video"}
            className={
              button +
              (output === "video"
                ? " border-orange-700 bg-orange-50 text-orange-900"
                : " border-transparent")
            }
            onClick={() => setOutput("video")}
          >
            MP4 视频
          </button>
          <button
            type="button"
            aria-pressed={output === "ppt"}
            className={
              button +
              (output === "ppt"
                ? " border-orange-700 bg-orange-50 text-orange-900"
                : " border-transparent")
            }
            onClick={() => {
              setPptOpened(true);
              setOutput("ppt");
            }}
          >
            PPT 演示
          </button>
        </div>
        <p className="mt-3 text-xs leading-5 text-stone-500">
          同一份想法与文字可送去做视频或演示文稿。PPTX
          可编辑；分步动画在网页演示中播放。
        </p>
      </div>
      <div className="mx-auto grid max-w-7xl gap-6 px-5 pb-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section className="min-w-0 space-y-6 rounded-3xl border border-stone-200 bg-white p-6 sm:p-8">
          <div>
            <p className="text-xs font-medium text-orange-700">01 / 放入内容</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              你想介绍什么？
            </h1>
            <p className="mt-3 text-sm leading-6 text-stone-500">
              写下想法，放入文字、图片或数据。先整理安排，再确认要做的视频。这里的作品独立保存。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="打开已保存作品"
              disabled={busy || !!pending}
              className="min-w-0 flex-1 rounded-xl border p-2 text-sm"
              value=""
              onChange={e => {
                const id = e.target.value;
                if (!id) return;
                void run(async () => {
                  if (
                    dirty &&
                    !window.confirm(
                      "本页还有未保存内容。打开其他作品前，请确认已保存或下载工程。继续打开？"
                    )
                  )
                    return;
                  const captured = active.current;
                  const saved = await utils.codeMotion.get.fetch({
                    projectId: id,
                  });
                  if (captured !== active.current) return;
                  if (!saved) throw new Error("未找到作品");
                  setPptData(null);
                  setSpreadsheet(null);
                  setImported(null);
                  setProject(saved.project);
                  setGeneration(saved.generation);
                  setSavedJson(JSON.stringify(saved.project));
                  setPrepared(null);
                  setPreview(false);
                });
              }}
            >
              <option value="">打开已保存作品</option>
              {projects.data?.map(p => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <button
              className={button}
              disabled={busy || !!pending}
              onClick={() => {
                if (
                  dirty &&
                  !window.confirm(
                    "新建前请确认已保存或下载当前工程。继续新建？"
                  )
                )
                  return;
                setPptData(null);
                setSpreadsheet(null);
                setImported(null);
                setProject(fresh());
                setGeneration("0");
                setSavedJson("");
                setPrepared(null);
                setPreview(false);
              }}
            >
              <Plus size={16} />
              新建
            </button>
          </div>
          {projects.error && (
            <p role="alert" className="text-sm text-red-700">
              云端作品暂时没有读到，请稍后再试；本页内容保留。
            </p>
          )}
          <fieldset
            disabled={editDisabled}
            className="space-y-5 disabled:opacity-60"
          >
            <label className="block text-sm">
              作品名称
              <input
                className={field}
                maxLength={60}
                value={project.brief.title}
                onChange={e => patchBrief({ title: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              你想怎么做这份作品？
              <textarea
                className={field + " min-h-24"}
                maxLength={2000}
                placeholder="例如：给新开的咖啡店做一条温暖的介绍，先说环境，再介绍招牌饮品。"
                value={project.brief.request}
                onChange={e => patchBrief({ request: e.target.value })}
              />
            </label>
            <div>
              <label className={button + " cursor-pointer"}>
                <Upload size={15} />
                导入图片、文档或表格
                <input
                  aria-label="导入图片、文档或表格"
                  type="file"
                  className="sr-only"
                  accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.md,.xlsx,.csv"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void run(() => fileSelected(f));
                  }}
                />
              </label>
              <p className="mt-2 text-xs leading-5 text-stone-500">
                PNG / JPG / WebP 图片，PDF / DOCX / MD 文档，每个不超过 8
                MB。支持 XLSX / CSV
                表格，读取后选择工作表和列，不计算公式。也可以直接粘贴文字。
              </p>
            </div>
            {spreadsheet && (
              <CodeMotionSpreadsheetPicker
                name={spreadsheet.name}
                output={output}
                workbook={spreadsheet.workbook}
                onClose={() => setSpreadsheet(null)}
                onUse={({ data, source }) => {
                  if (output === "ppt") {
                    setPptData(data);
                    patchBrief({
                      source,
                      style: project.brief.images.length ? "cards" : "data",
                    });
                    setSpreadsheet(null);
                    setMessage(
                      `已为PPT保留全部${data.length}项所选数据，请核对单位与时间。PPT每页可选择不超过8项。`
                    );
                    return;
                  }

                  if (project.brief.images.length) {
                    setMessage(
                      "请先保留并移除当前图片，或新建数据作品，再采用表格；已读表格仍保留。"
                    );
                    return;
                  }
                  patchBrief({ data, source, style: "data" });
                  setSpreadsheet(null);
                  setMessage(
                    "已采用所选原始数据，请填写并核对单位与时间范围；缺失值仍为空。"
                  );
                }}
              />
            )}
            {imported && (
              <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
                <p className="text-sm font-medium">{imported.name}</p>
                <p className="mt-2 text-xs leading-5">
                  {imported.message} 全文 {imported.text.length}{" "}
                  字；请保留这条视频要用的内容，最多 4000 字，未自动截断。
                </p>
                <textarea
                  aria-label="导入文档文字，选用前可编辑"
                  className={field + " min-h-48"}
                  value={imported.text}
                  onChange={e =>
                    setImported({ ...imported, text: e.target.value })
                  }
                />
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className={button}
                    disabled={
                      imported.text.length > 4000 || !imported.text.trim()
                    }
                    onClick={() => {
                      patchBrief({ text: imported.text });
                      setImported(null);
                    }}
                  >
                    用这些文字替换材料
                  </button>
                  <button
                    type="button"
                    className={button}
                    onClick={() => setImported(null)}
                  >
                    暂不使用
                  </button>
                </div>
              </div>
            )}
            <label className="block text-sm">
              想放进作品的文字
              <textarea
                className={field + " min-h-32"}
                maxLength={4000}
                placeholder="粘贴已有文案。自己安排时，每段一行。"
                value={project.brief.text}
                onChange={e => patchBrief({ text: e.target.value })}
              />
            </label>
            {output === "video" && (
              <CodeMotionAudioPanel
                key={`${user?.id || "guest"}:${project.id}`}
                projectId={project.id}
                audios={project.brief.audios || []}
                timeline={
                  project.plan ? project.plan.audioTimeline || [] : undefined
                }
                duration={project.brief.duration}
                disabled={editDisabled || !user}
                onAudios={audios => {
                  setProject(p => ({
                    ...p,
                    brief: { ...p.brief, audios },
                    plan: p.plan
                      ? {
                          ...p.plan,
                          audioTimeline: (p.plan.audioTimeline || []).filter(
                            c => audios.some(a => a.id === c.sourceId)
                          ),
                        }
                      : null,
                  }));
                  setPrepared(null);
                  setPreview(false);
                }}
                onTimeline={audioTimeline => {
                  setProject(p => ({
                    ...p,
                    plan: p.plan ? { ...p.plan, audioTimeline } : null,
                  }));
                  setPrepared(null);
                  setPreview(false);
                }}
                onTranscript={text => {
                  const combined = [latestProject.current.brief.text, text]
                    .filter(Boolean)
                    .join("\n");
                  if (combined.length > 4000) {
                    setImported({
                      name: "录音识别文字",
                      text,
                      message: "识别文字已保留，请选择本作品需要的段落。",
                    });
                    return;
                  }
                  patchBrief({ text: combined });
                }}
              />
            )}
            <div className="grid grid-cols-3 gap-3">
              <label className="text-sm">
                展示方式
                <select
                  className={field}
                  value={project.brief.style}
                  onChange={e => {
                    const style = e.target.value as CodeMotionBrief["style"];
                    if (
                      (!["cards", "scenes"].includes(style) &&
                        project.brief.images.length) ||
                      (style !== "data" && project.brief.data.length)
                    ) {
                      setMessage(
                        "请先移除当前图片或数据，再切换展示方式，避免丢失内容。"
                      );
                      return;
                    }
                    patchBrief({ style });
                  }}
                >
                  <option value="scenes">逐镜创作</option>
                  <option value="words">动态文字</option>
                  <option value="cards">图文介绍</option>
                  <option value="data">数据展示</option>
                </select>
              </label>
              <label className="text-sm">
                片长
                <select
                  className={field}
                  value={project.brief.duration}
                  onChange={e =>
                    patchBrief({ duration: Number(e.target.value) })
                  }
                >
                  {[15, 30, 45, 60, 90, 120, 180].map(n => (
                    <option key={n} value={n}>
                      {n} 秒
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                画面
                <select
                  className={field}
                  value={project.brief.orientation}
                  onChange={e =>
                    patchBrief({
                      orientation: e.target
                        .value as CodeMotionBrief["orientation"],
                    })
                  }
                >
                  <option value="landscape">横屏</option>
                  <option value="portrait">竖屏</option>
                </select>
              </label>
            </div>
            {["cards", "scenes"].includes(project.brief.style) && (
              <div>
                <label className={button + " cursor-pointer"}>
                  <Upload size={15} />
                  加入图片
                  <input
                    aria-label="上传图片"
                    type="file"
                    className="sr-only"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void run(() => fileSelected(f));
                    }}
                  />
                </label>
                <p className="mt-2 text-xs text-stone-500">
                  最多 8 张，每张不超过 8
                  MB。图片只作画面素材，不会变成人物表演。
                </p>
                <ul className="mt-3 space-y-2">
                  {project.brief.images.map(i => (
                    <li
                      key={i.id}
                      className="flex justify-between gap-3 rounded-lg bg-stone-50 p-3 text-sm"
                    >
                      <span className="min-w-0 break-all">{i.name}</span>
                      <button
                        type="button"
                        onClick={() =>
                          patchBrief({
                            images: project.brief.images.filter(
                              x => x.id !== i.id
                            ),
                          })
                        }
                      >
                        移除
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(project.brief.style === "data" || !!pptData) && (
              <div className="space-y-3">
                <p className="text-sm">
                  填写真实数据，视频保持这些数值。可粘贴表格中的两列汇总数据。这是当前快照，不会实时更新。
                </p>
                <label className="block text-sm">
                  粘贴表格
                  <textarea
                    aria-label="粘贴两列表格数据"
                    className={field}
                    value={tableText}
                    onChange={e => setTableText(e.target.value)}
                    placeholder={"项目\t数值\n甲\t12.5\n乙\t20"}
                  />
                </label>
                <button
                  type="button"
                  className={button}
                  onClick={() => {
                    try {
                      patchBrief({ data: parseCodeMotionTable(tableText) });
                      setTableText("");
                    } catch (e) {
                      setMessage(
                        e instanceof Error ? e.message : "表格无法读取"
                      );
                    }
                  }}
                >
                  使用这些数据
                </button>
                <label className="block text-sm">
                  图表形式
                  <select
                    className={field}
                    value={project.brief.chart}
                    onChange={e =>
                      patchBrief({ chart: e.target.value as "bar" | "line" })
                    }
                  >
                    <option value="bar">柱状图 · 比较不同项目</option>
                    <option value="line">折线图 · 按时间看变化</option>
                  </select>
                </label>
                <p className="text-xs text-stone-500">
                  折线图请按时间顺序填写。目前支持零及以上的数值，最多六位小数。缺失数值不会自动当成零。
                </p>
                {project.brief.data.map((row, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      aria-label={`第${index + 1}项名称`}
                      className={field}
                      value={row.label}
                      maxLength={30}
                      onChange={e =>
                        patchBrief({
                          data: project.brief.data.map((r, k) =>
                            k === index ? { ...r, label: e.target.value } : r
                          ),
                        })
                      }
                    />
                    <input
                      aria-label={`第${index + 1}项数值`}
                      className={field}
                      type="number"
                      min={0}
                      max={1e9}
                      value={row.value ?? ""}
                      onChange={e =>
                        patchBrief({
                          data: project.brief.data.map((r, k) =>
                            k === index
                              ? {
                                  ...r,
                                  value:
                                    e.target.value === ""
                                      ? null
                                      : Number(e.target.value),
                                }
                              : r
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        patchBrief({
                          data: project.brief.data.filter(
                            (_, k) => k !== index
                          ),
                        })
                      }
                    >
                      移除
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className={button}
                  disabled={project.brief.data.length >= 12}
                  onClick={() =>
                    patchBrief({
                      data: [...project.brief.data, { label: "", value: null }],
                    })
                  }
                >
                  添加一项
                </button>
                <label className="block text-sm">
                  单位
                  <input
                    className={field}
                    maxLength={12}
                    value={project.brief.unit}
                    onChange={e => patchBrief({ unit: e.target.value })}
                    placeholder="如：人、万元、%"
                  />
                </label>
                <label className="block text-sm">
                  时间范围
                  <input
                    className={field}
                    maxLength={60}
                    value={project.brief.period}
                    onChange={e => patchBrief({ period: e.target.value })}
                    placeholder="例如：2026 年 1—6 月"
                  />
                </label>
                <label className="block text-sm">
                  数据来源
                  <input
                    className={field}
                    maxLength={120}
                    value={project.brief.source}
                    onChange={e => patchBrief({ source: e.target.value })}
                    placeholder="例如：本店销售统计，10 月 10 日导出"
                  />
                </label>
              </div>
            )}
          </fieldset>
          {pptData && (
            <div className="rounded-xl border border-orange-200 p-3 text-sm">
              PPT已选择 {pptData.length}{" "}
              项表格数据（本机保存）；单位与时间使用上方填写值。
              <button
                type="button"
                className="ml-2 underline"
                disabled={editDisabled}
                onClick={() => setPptData(null)}
              >
                移除PPT所选数据
              </button>
            </div>
          )}
          <div
            hidden={output !== "video"}
            className="rounded-2xl bg-orange-50 p-4 text-sm leading-6"
          >
            <p>
              {!user
                ? "登录后查看费用"
                : quote.error
                  ? "费用暂未查到"
                  : quote.data
                    ? quote.data.credits
                      ? `本次整理 ${quote.data.credits} 积分`
                      : "本次免费整理"
                    : "正在查询…"}
            </p>
            {quote.data && (
              <p className="mt-1 text-xs text-stone-600">
                今日还可免费整理 {quote.data.remainingFreeToday} 次。先查看方案，确认后再制作视频。
              </p>
            )}
            {!user ? (
              <a href="/login" className={button + " mt-3"}>
                登录后继续
              </a>
            ) : (
              <button
                className={
                  button + " mt-3 border-orange-700 bg-orange-700 text-white"
                }
                disabled={busy || !quote.data || !!pending}
                onClick={() => void run(() => requestPlan())}
              >
                <Sparkles size={16} />
                {quote.data?.credits
                  ? `确认使用 ${quote.data.credits} 积分，请顾问整理`
                  : "请顾问整理安排"}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              hidden={output !== "video"}
              disabled={editDisabled}
              onClick={() => void run(async () => arrangeManually())}
            >
              自己按段落安排
            </button>
            <button
              className={button}
              disabled={busy || !user}
              onClick={() =>
                void run(async () => {
                  await save();
                  setMessage("已保存到我的作品。");
                })
              }
            >
              保存作品
            </button>
          </div>
          <p className="text-xs text-stone-500">
            {generation === "0"
              ? "尚未保存到云端"
              : dirty
                ? "有新的修改待保存"
                : "当前内容已保存到云端"}
          </p>
          {pending && (
            <div
              role="status"
              className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"
            >
              <p>
                {pending.failed
                  ? "上次整理未完成；重新整理前会再次核对费用。"
                  : "上次整理结果尚未取回。先恢复这一次，避免重复使用额度。"}
              </p>
              <button
                className={button + " mt-3"}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (pending.failed) persistPending(null);
                    else await requestPlan(pending);
                  })
                }
              >
                {pending.failed ? "结束这次整理，保留材料" : "取回这次整理结果"}
              </button>
            </div>
          )}
          {message && (
            <p
              role="status"
              className="whitespace-pre-wrap text-sm leading-6 text-orange-900"
            >
              {message}
            </p>
          )}
          {busy && (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-stone-500"
            >
              <Loader2 size={16} className="animate-spin" />
              正在处理，请保留页面…
            </p>
          )}
        </section>
        <section
          hidden={output !== "video"}
          className="min-w-0 space-y-6 rounded-3xl border border-stone-200 bg-white p-6 sm:p-8"
        >
          <div>
            <p className="text-xs font-medium text-orange-700">02 / 看看安排</p>
            <h2 className="mt-3 text-2xl font-semibold">每个画面，都能改。</h2>
          </div>
          {!project.plan ? (
            <div className="rounded-2xl border border-dashed border-stone-300 p-8 text-sm leading-7 text-stone-500">
              内容安排会显示在这里。可以让顾问整理，也可以自己按段落安排。确认之前不会开始制作视频。
            </div>
          ) : (
            <>
              <p className="text-sm leading-6 text-stone-600">
                {project.plan.summary}
              </p>
              <div className="space-y-4">
                {project.plan.scenes.map((scene, index) => (
                  <fieldset
                    key={index}
                    disabled={editDisabled}
                    className="rounded-2xl border border-stone-200 p-4"
                  >
                    <legend className="px-2 text-xs text-stone-500">
                      第 {index + 1} 个画面
                    </legend>
                    <label className="block text-sm">
                      {scene.composition
                        ? "镜头名称（下方元素决定实际画面）"
                        : "主要文字"}
                      <input
                        className={field}
                        value={scene.heading}
                        maxLength={48}
                        onChange={e => {
                          setProject(p => ({
                            ...p,
                            plan: {
                              ...p.plan!,
                              scenes: p.plan!.scenes.map((s, k) =>
                                k === index
                                  ? { ...s, heading: e.target.value }
                                  : s
                              ),
                            },
                          }));
                          setPrepared(null);
                          setPreview(false);
                        }}
                      />
                    </label>
                    <label className="mt-3 block text-sm">
                      补充说明
                      <textarea
                        className={field}
                        value={scene.body}
                        maxLength={100}
                        onChange={e => {
                          setProject(p => ({
                            ...p,
                            plan: {
                              ...p.plan!,
                              scenes: p.plan!.scenes.map((s, k) =>
                                k === index ? { ...s, body: e.target.value } : s
                              ),
                            },
                          }));
                          setPrepared(null);
                          setPreview(false);
                        }}
                      />
                    </label>
                    {scene.speech &&
                      (!quote.data?.speechEnabled ||
                        !!project.brief.audios?.length ||
                        project.brief.duration > 60) && (
                        <button
                          type="button"
                          className="mt-3 text-sm text-orange-700 underline"
                          onClick={() => {
                            setProject(p => ({
                              ...p,
                              plan: {
                                ...p.plan!,
                                scenes: p.plan!.scenes.map((s, k) => {
                                  if (k !== index) return s;
                                  const { speech, ...rest } = s;
                                  return rest;
                                }),
                              },
                            }));
                            setPrepared(null);
                            setPreview(false);
                          }}
                        >
                          移除本镜合成对白，使用原音或无声
                        </button>
                      )}
                    <label className="mt-3 block text-sm">
                      本镜合成对白（开放后支持60秒内作品）
                      <textarea
                        className={field}
                        maxLength={180}
                        disabled={
                          !quote.data?.speechEnabled ||
                          project.brief.duration > 60 ||
                          !!project.brief.audios?.length
                        }
                        value={scene.speech?.text || ""}
                        onChange={e => {
                          setProject(p => ({
                            ...p,
                            plan: {
                              ...p.plan!,
                              scenes: p.plan!.scenes.map((s, k) =>
                                k === index
                                  ? {
                                      ...s,
                                      speech: {
                                        text: e.target.value,
                                        voice: s.speech?.voice || "female",
                                      },
                                    }
                                  : s
                              ),
                            },
                          }));
                          setPrepared(null);
                          setPreview(false);
                        }}
                      />
                    </label>
                    <label className="mt-2 block text-sm">
                      合成音色
                      <select
                        className={field}
                        disabled={
                          !quote.data?.speechEnabled ||
                          project.brief.duration > 60 ||
                          !!project.brief.audios?.length
                        }
                        value={scene.speech?.voice || "female"}
                        onChange={e => {
                          const voice = e.target.value as "female" | "male";
                          setProject(p => ({
                            ...p,
                            plan: {
                              ...p.plan!,
                              scenes: p.plan!.scenes.map((s, k) =>
                                k === index
                                  ? {
                                      ...s,
                                      speech: {
                                        text: s.speech?.text || "",
                                        voice,
                                      },
                                    }
                                  : s
                              ),
                            },
                          }));
                          setPrepared(null);
                          setPreview(false);
                        }}
                      >
                        <option value="female">标准女声</option>
                        <option value="male">标准男声</option>
                      </select>
                    </label>
                    <p className="mt-2 text-xs text-stone-500">
                      {quote.data?.speechEnabled
                        ? "合成对白限60秒内、合计300字。已有原音时使用原音时间轴。"
                        : "合成配音暂未开放，可上传音频、直接录音或无声导出。"}{" "}
                      照片不自动对口型。
                    </p>
                    <div className="mt-3 flex items-end gap-3">
                      <label className="w-28 text-sm">
                        停留秒数
                        <input
                          type="number"
                          className={field}
                          min={0.5}
                          max={180}
                          step={0.05}
                          value={scene.duration}
                          onChange={e => {
                            const seconds = Number(e.target.value);
                            if (
                              !Number.isFinite(seconds) ||
                              seconds < 0 ||
                              seconds > 180
                            ) {
                              setMessage(
                                "镜头秒数须在0至180之间，已保留原镜头"
                              );
                              return;
                            }
                            setProject(p => ({
                              ...p,
                              plan: {
                                ...p.plan!,
                                scenes: p.plan!.scenes.map((s, k) =>
                                  k === index
                                    ? {
                                        ...s,
                                        duration: Number(e.target.value),
                                        ...(s.composition
                                          ? {
                                              composition:
                                                Number(e.target.value) >= 0.5 &&
                                                Number(e.target.value) <= 180
                                                  ? retimeCodeMotionPlanScene(
                                                      s.composition,
                                                      Number(e.target.value)
                                                    )
                                                  : s.composition,
                                            }
                                          : {}),
                                      }
                                    : s
                                ),
                              },
                            }));
                            setPrepared(null);
                            setPreview(false);
                          }}
                        />
                      </label>
                      {project.brief.style === "cards" && (
                        <label className="min-w-0 flex-1 text-sm">
                          搭配图片
                          <select
                            className={field}
                            value={scene.imageId || ""}
                            onChange={e => {
                              setProject(p => ({
                                ...p,
                                plan: {
                                  ...p.plan!,
                                  scenes: p.plan!.scenes.map((s, k) =>
                                    k === index
                                      ? {
                                          ...s,
                                          imageId: e.target.value || undefined,
                                        }
                                      : s
                                  ),
                                },
                              }));
                              setPrepared(null);
                              setPreview(false);
                            }}
                          >
                            <option value="">只用文字</option>
                            {project.brief.images.map(i => (
                              <option key={i.id} value={i.id}>
                                {i.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                    {scene.composition && (
                      <CodeMotionSceneEditor
                        scene={scene.composition}
                        previousScene={
                          project.plan?.scenes[index - 1]?.composition
                        }
                        images={project.brief.images}
                        onChange={composition => {
                          setProject(p => ({
                            ...p,
                            plan: {
                              ...p.plan!,
                              scenes: p.plan!.scenes.map((s, k) =>
                                k === index ? { ...s, composition } : s
                              ),
                            },
                          }));
                          setPrepared(null);
                          setPreview(false);
                        }}
                      />
                    )}
                    <p className="mt-3 text-xs leading-5 text-stone-500">
                      {scene.direction ||
                        codeMotionSceneDescription(
                          project.brief.style,
                          !!scene.imageId
                        )}
                    </p>
                  </fieldset>
                ))}
              </div>
              <p className="text-sm text-stone-500">
                合计 {project.plan.scenes.reduce((n, s) => n + s.duration, 0)}{" "}
                秒 / 选择 {project.brief.duration} 秒
              </p>
              <button
                className={button + " w-full"}
                disabled={busy || !user || !!pending}
                onClick={() => void run(inspect)}
              >
                保存并查看本次视频内容
              </button>
            </>
          )}
          {reviewOpen && prepared && !dirty && (
            <div className="space-y-4 rounded-2xl border border-orange-200 bg-orange-50 p-5">
              <h3 className="font-semibold">这次要做的视频</h3>
              <p className="text-sm">
                {project.brief.title} · {project.brief.duration} 秒 ·{" "}
                {project.brief.orientation === "portrait" ? "竖屏" : "横屏"} ·
                720p ·{" "}
                {prepared.audios.length
                  ? "使用已选原声"
                  : prepared.spec.inkSpeech
                    ? "按本次对白安排"
                    : "无声"}
              </p>
              <ol className="space-y-3 text-sm">
                {prepared.scenes.map((s, i) => (
                  <li key={i}>
                    <strong>{s.heading}</strong>
                    <span className="ml-2 text-stone-500">{s.duration} 秒</span>
                    <p>{s.body}</p>
                    <p>
                      对白：{s.speech?.text || "本镜无对白"} ·{" "}
                      {s.speech
                        ? s.speech.voice === "male"
                          ? "标准男声"
                          : "标准女声"
                        : "不合成声音"}
                    </p>
                    <p className="text-xs leading-5 text-stone-500">
                      {s.movement}
                    </p>
                    {s.imageId && (
                      <span className="text-xs">
                        图片：
                        {prepared.images.find(im => im.id === s.imageId)?.name}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
              {!!prepared.audios.length && (
                <div className="space-y-2 text-sm">
                  {prepared.spec.codeAudio?.audioTimeline.map((clip, i) => (
                    <p key={i}>
                      {prepared.audios.find(a => a.id === clip.sourceId)?.name}{" "}
                      ·{" "}
                      {clip.role === "bgm"
                        ? "背景音乐"
                        : clip.role === "sfx"
                          ? "音效"
                          : clip.role === "dialogue"
                            ? "对白"
                            : "旁白"}{" "}
                      · 第{clip.at}–
                      {Number((clip.at + clip.duration).toFixed(2))}秒 · 原音从
                      {clip.trimStart}秒开始 · 音量{clip.volume}倍
                    </p>
                  ))}
                  {prepared.audios.map(a => (
                    <audio
                      key={a.id}
                      controls
                      preload="metadata"
                      src={gcsTransferUrl(a.url)}
                      className="max-w-full"
                    />
                  ))}
                </div>
              )}
              {project.brief.style === "data" && (
                <div className="text-sm">
                  {project.brief.data.map(r => (
                    <p key={r.label}>
                      {r.label}：{r.value}
                      {project.brief.unit}
                    </p>
                  ))}
                </div>
              )}
              {prepared.images.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {prepared.images.map(image => (
                    <figure key={image.id}>
                      <img
                        alt={image.name}
                        src={gcsTransferUrl(image.url)}
                        className="aspect-video w-full rounded-lg object-contain"
                      />
                      <figcaption className="mt-1 truncate text-xs">
                        {image.name}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
              <p className="text-sm">
                {INK_FREE_POLICY}
                <br />
                {inkFreeMessage(prepared.freeEligibility)}
                <br />
                本次符合资格的视频导出：0 积分。原图片与材料保留。
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => setPreview(true)}
                >
                  确认内容，播放预览
                </button>
                <button
                  className={button + " bg-stone-900 text-white"}
                  disabled={
                    busy ||
                    !prepared.freeEligibility.eligible ||
                    !!(
                      status.data &&
                      [
                        "queued",
                        "running",
                        "succeeded",
                        "failed",
                        "cancelled",
                        "canceled",
                      ].includes(status.data.status)
                    )
                  }
                  onClick={() =>
                    void run(async () => {
                      await submitMutation.mutateAsync({
                        projectId: project.id,
                        expectedGeneration: prepared.generation,
                        confirmedFingerprint: prepared.fingerprint,
                        confirmedCredits: 0,
                      });
                      setMessage(
                        "已提交视频制作，关闭页面后也可以从已保存作品取回。"
                      );
                      await Promise.all([status.refetch(), history.refetch()]);
                    })
                  }
                >
                  确认内容，导出视频
                </button>
              </div>
            </div>
          )}
          {preview && prepared && !dirty && (
            <CodeMotionPreview
              key={prepared.fingerprint}
              audioSources={prepared.audios.map(a => ({
                id: a.id,
                url: gcsTransferUrl(a.url),
              }))}
              spec={{
                ...prepared.spec,
                cues: prepared.spec.cues.map(c => ({
                  ...c,
                  ...(c.image ? { image: gcsTransferUrl(c.image) } : {}),
                })),
              }}
            />
          )}
          {status.data && (
            <div className="space-y-3 rounded-2xl border border-stone-200 p-5">
              <h3 className="font-semibold">
                {labels[status.data.status] || "正在核对进度"}
              </h3>
              <p className="text-xs text-stone-500">
                这条视频对应已保存的内容。未自动采用到其他作品。
              </p>
              {videoUrl && (
                <>
                  <video
                    controls
                    playsInline
                    src={videoUrl}
                    className="max-h-[520px] w-full rounded-lg bg-black"
                  />
                  <a href={videoUrl} download className={button}>
                    <Download size={15} />
                    下载视频
                  </a>
                  <CodeMotionVideoPptx
                    videoUrl={videoUrl}
                    title={project.brief.title}
                    orientation={project.brief.orientation}
                  />
                </>
              )}
              {status.data.error && (
                <p role="alert" className="text-sm text-red-700">
                  {status.data.error}
                </p>
              )}
              {status.data.status === "failed" && (
                <p className="text-xs text-stone-500">
                  本次没有自动重做。请保留当前内容和任务记录，先检查失败原因。
                </p>
              )}
              <button
                className={button}
                disabled={busy}
                onClick={() => void status.refetch()}
              >
                查看最新进度
              </button>
            </div>
          )}
          {history.data && history.data.length > 0 && (
            <details className="rounded-xl border border-stone-200 p-4">
              <summary className="cursor-pointer text-sm font-medium">
                这份作品最近的视频记录
              </summary>
              <div className="mt-3 space-y-3">
                {history.data.map(row => {
                  if (!row) return null;
                  const output = row.output as { url?: unknown } | null;
                  const params = row.params as
                    | { title?: string; duration?: number }
                    | undefined;
                  const url =
                    row.status === "succeeded" &&
                    typeof output?.url === "string"
                      ? flyDownloadUrl(output.url)
                      : "";
                  return (
                    <div
                      key={row.jobId}
                      className="rounded-lg bg-stone-50 p-3 text-sm"
                    >
                      <p>
                        {params?.title || "视频"} · {params?.duration || ""} 秒
                        · {labels[row.status] || row.status}
                      </p>
                      {url && (
                        <a
                          className="mt-2 inline-block underline underline-offset-4"
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          打开这条视频
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-stone-500">
                最多显示最近 20 条，改稿不会删除原视频。
              </p>
            </details>
          )}
          {history.error && (
            <p role="alert" className="text-sm text-red-700">
              之前的视频记录暂时未读到，原视频保留。
            </p>
          )}
          {status.error && (
            <p role="alert" className="text-sm text-red-700">
              任务进度暂时无法读取，请保留原作品；不要重复提交。
            </p>
          )}
        </section>
        {pptOpened && (
          <section
            hidden={output !== "ppt"}
            className="min-w-0 rounded-3xl border border-slate-700 bg-slate-900 p-4 text-white sm:p-6"
          >
            <p className="mb-4 text-xs leading-6 text-slate-300">
              左侧资料用于当前演示。修改资料或切换作品后，点击“使用上方最新资料与要求”再继续；这里保留先前编辑，不会自动覆盖。演示页面按账号和作品保存在本机，可刷新恢复；暂不随云端视频作品同步，换设备前请下载文件。
            </p>
            <Suspense
              fallback={
                <p className="p-6 text-sm text-stone-500">
                  正在打开演示工作台…
                </p>
              }
            >
              <PlatformHtmlPptPanel
                key={`${user?.id}:${project.id}`}
                draftKey={
                  user ? `yingke:ppt:v1:${user.id}:${project.id}` : undefined
                }
                disabled={!user || busy}
                initialContent={{
                  title: project.brief.title,
                  request: project.brief.request,
                  text: [
                    project.brief.text,
                    ...((pptData ?? project.brief.data).length
                      ? [
                          "以下是用户提供的数据快照，数值不得改写：",
                          `图表：${project.brief.chart === "line" ? "按时间变化的折线" : "类别比较的柱状图"}；单位：${project.brief.unit}；时间：${project.brief.period}；来源：${project.brief.source}`,
                          ...(pptData ?? project.brief.data).map(
                            row =>
                              `${row.label}：${row.value === null ? "未填写，不得按零处理" : row.value}`
                          ),
                        ]
                      : []),
                  ].join("\n"),
                  images: project.brief.images,
                  data: pptData ?? project.brief.data,
                  chart: project.brief.chart,
                  unit: project.brief.unit,
                  period: project.brief.period,
                  source: project.brief.source,
                }}
              />
            </Suspense>
          </section>
        )}
      </div>
    </main>
  );
}

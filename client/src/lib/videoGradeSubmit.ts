/**
 * 单片调色：复用后期 concat 任务（action:"concat"，clips:[该视频]，不传 trims、不带转场），
 * grade 用 montageFinish 的同一份草稿类型与校验；宽高帧率按原片服务端实测，结果是新文件，原片保留不覆盖。
 * 计价沿用后期 concat 现状（本 helper 不新增任何定价/扣费）。
 */
import { montageFinishParams, type MontageGrade } from "@/lib/montageFinish";
import { importWorkflowVideoSource, probeWorkflowVideoSource, type VideoUpscaleSourceMetadata } from "@/lib/videoUpscaleApi";

/** 与后期工坊 submit 的 concat 分支同形（PostProdWorkshopCard / queuePostProd）。 */
export type VideoGradeConcatInput = {
  action: "concat";
  params: { clips: string[]; width: number; height: number; fps: number; grade: MontageGrade };
  scopeKey?: string;
};

export type VideoGradeSubmitInput = {
  /** 成片地址：https 产品/CloudFront 链接或本人 gs://。 */
  videoUrl: string;
  /** 调色草稿；缺省或全中性时不提交（不会出一个“没调色”的新文件）。 */
  grade?: MontageGrade;
  /** 后期任务归属（与 PostProdWorkshopCard submit 的 scopeKey 同义）。 */
  scopeKey?: string;
};

export type VideoGradeSubmitDeps = {
  /** 入队：传 trpc.mvAnalysis.queuePostProd 的 mutateAsync，或 PostProdWorkshopCard 的 submit 包装。 */
  queue: (input: VideoGradeConcatInput) => Promise<{ jobId: string } | string | undefined>;
  /** 测试注入；默认 probeWorkflowVideoSource（服务端实读宽高/帧率/时长）。 */
  probe?: (url: string) => Promise<VideoUpscaleSourceMetadata>;
  /** 测试注入；默认 importWorkflowVideoSource（CloudFront 成品先落本人目录）。 */
  importSource?: (url: string) => Promise<string>;
};

const WAVESPEED_CDN = "https://d2h7xmz5gqybh9.cloudfront.net/";
const even = (n: number) => Math.round(n / 2) * 2;

/** concat 参数（纯函数）：单片、无转场、无 trims；按实测规格；grade 走 montageFinishParams 同一套校验。无调色返回 null。 */
export function buildVideoGradeConcatParams(
  source: string,
  measured: Pick<VideoUpscaleSourceMetadata, "width" | "height" | "fps" | "durationSec" | "durationExactSec">,
  grade: MontageGrade | undefined
): VideoGradeConcatInput["params"] | null {
  const outputSec = measured.durationExactSec ?? measured.durationSec;
  const finished = montageFinishParams(grade ? { grade } : undefined, 1, false, outputSec).grade;
  if (!finished) return null;
  const width = even(measured.width), height = even(measured.height), fps = Math.round(Number(measured.fps));
  if (!(width >= 320 && width <= 3840 && height >= 240 && height <= 2160)) throw new Error("原片尺寸超出后期调色支持范围");
  if (!Number.isFinite(fps) || fps < 12 || fps > 60) throw new Error("读取原片帧率失败，未提交调色");
  return { clips: [source], width, height, fps, grade: finished };
}

/** 单片调色提交：来源转换 → 实测规格 → 入队 concat，返回 jobId。无调色时抛错且不入队。 */
export async function submitVideoGrade(input: VideoGradeSubmitInput, deps: VideoGradeSubmitDeps): Promise<string> {
  if (!input.grade) throw new Error("未设置调色，未提交");
  const url = input.videoUrl.trim();
  if (!/^(?:https:\/\/|gs:\/\/)/.test(url)) throw new Error("请先选择可用的成片");
  // 与 MontagePlanner.ask 同一写法：CloudFront 成品先导入为本人 gs://，其余原样交服务端核验归属
  const source = url.startsWith(WAVESPEED_CDN) ? await (deps.importSource ?? importWorkflowVideoSource)(url) : url;
  const measured = await (deps.probe ?? probeWorkflowVideoSource)(source);
  const params = buildVideoGradeConcatParams(source, measured, input.grade);
  if (!params) throw new Error("未设置调色，未提交");
  const res = await deps.queue({ action: "concat", params, ...(input.scopeKey ? { scopeKey: input.scopeKey } : {}) });
  const jobId = typeof res === "string" ? res : res?.jobId;
  if (!jobId) throw new Error("尚未取得调色任务编号，请查看后期任务列表");
  return jobId;
}

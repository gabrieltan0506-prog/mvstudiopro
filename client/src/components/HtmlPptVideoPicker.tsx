import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { flyDownloadUrl } from "@/lib/gcsTransfer";
import type { HtmlPptPage } from "@shared/htmlPptMaker";

/** 只选择当前账号已有成功成片，选择不提交渲染。 */
export default function HtmlPptVideoPicker({ page, pageIndex, disabled, onChange }: { page: HtmlPptPage; pageIndex: number; disabled: boolean; onChange: (patch: Partial<HtmlPptPage>) => void }) {
  const [projectId, setProjectId] = useState(page.videoSource?.projectId || "");
  useEffect(() => { setProjectId(page.videoSource?.projectId || ""); }, [page.videoSource?.projectId]);
  const projects = trpc.codeMotion.list.useQuery(undefined, { retry: false });
  const history = trpc.codeMotion.history.useQuery({ projectId }, { enabled: Boolean(projectId), retry: false });
  const ready = (history.data || []).filter(row => row?.status === "succeeded" && typeof row.output?.url === "string");
  return <details className="rounded-lg border border-white/15 p-3 text-xs text-white/75"><summary>加入已有动效 MP4（可选）{page.videoSource ? " · 已绑定" : ""}</summary>
    <p className="my-2">复用已有成功成片，免费嵌入 PPTX；当前页文字仍可编辑，视频内部元素保持原样。</p>
    <select aria-label={`第${pageIndex}页动效作品`} disabled={disabled} value={projectId} onChange={event => setProjectId(event.target.value)} className="mr-2 rounded bg-slate-900 p-2"><option value="">选择已有作品</option>{projects.data?.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select>
    <select aria-label={`第${pageIndex}页动效视频`} disabled={disabled || !projectId || history.isFetching} value={page.videoSource?.projectId === projectId ? page.videoSource.jobId : ""} onChange={event => {
      const row = ready.find(item => item?.jobId === event.target.value);
      if (!row || typeof row.output?.url !== "string") { onChange({ videoSource: undefined, videoUrl: undefined }); return; }
      onChange({ videoSource: { projectId, jobId: row.jobId }, videoUrl: flyDownloadUrl(row.output.url) });
    }} className="rounded bg-slate-900 p-2"><option value="">不嵌入视频</option>{ready.map(row => <option key={row!.jobId} value={row!.jobId}>成片 {row!.jobId}</option>)}</select>
    {(projects.error || history.error) && <p role="alert">已有视频暂时无法读取，请稍后重新选择；不会重新生成。</p>}
    {projectId && !history.isFetching && !history.error && !ready.length && <p>这份作品暂无成功成片。</p>}
    {page.videoUrl && <video className="mt-3 max-h-64 w-full" controls preload="metadata" src={page.videoUrl} />}
    {page.videoSource && <button type="button" disabled={disabled} onClick={() => onChange({ videoSource: undefined, videoUrl: undefined })}>移除本页视频</button>}
  </details>;
}

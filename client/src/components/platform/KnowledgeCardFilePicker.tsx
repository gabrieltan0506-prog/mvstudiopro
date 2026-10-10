import { useEffect, useRef, useState } from "react";

const TYPES: Record<string, string> = {
  pdf: "application/pdf", epub: "application/epub+zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
};
export const knowledgeCardFileMime = (file: File) => TYPES[file.name.split(".").pop()?.toLowerCase() || ""] || file.type;
const key = (file: File) => JSON.stringify([file.name, file.size, file.lastModified]);

/** 先汇集混合资料再主动读取，选文件本身不上传、不调用模型。 */
export function KnowledgeCardFilePicker({ disabled, onProcess, onSelectionCountChange }: {
  disabled: boolean;
  onProcess: (files: File[]) => Promise<boolean>;
  onSelectionCountChange?: (count: number) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const unavailable = disabled || busy;
  useEffect(() => { onSelectionCountChange?.(files.length); }, [files.length, onSelectionCountChange]);
  return <div className="w-full rounded-xl border border-white/15 bg-black/20 p-3 text-xs text-[#c9c0e6]">
    <label className={`inline-flex rounded-full border border-white/20 px-3 py-2 ${unavailable ? "opacity-50" : "cursor-pointer hover:border-pink-400"}`}>
      {files.length ? "继续添加文件" : "选择文件（可多选、可混合类型）"}
      <input aria-label="知识卡片资料文件" type="file" className="hidden" multiple
        accept={Object.keys(TYPES).map(ext => `.${ext}`).join(",")} disabled={unavailable}
        onChange={e => {
          const selected = Array.from(e.target.files || []); e.target.value = "";
          if (unavailable || locked.current) return;
          const bad = selected.filter(f => !TYPES[f.name.split(".").pop()?.toLowerCase() || ""] || !f.size);
          if (bad.length) { setError(`未加入本批文件：${bad.map(f => f.name).join("、")}。请选择非空 PDF、Word（DOCX）、PPTX、EPUB 或 PNG/JPG/WebP。`); return; }
          setFiles(old => Array.from(new Map([...old, ...selected].map(f => [key(f), f])).values()));
          setError("");
        }} />
    </label>
    <p className="mt-2 leading-5 text-white/55">PDF、Word（DOCX）、PPTX、EPUB 和图片可放在同一批；可分多次添加。点击「开始精炼」前不上传、不读取、不调用模型。</p>
    {files.length > 0 && <>
      <ul className="my-2 max-h-52 space-y-1 overflow-y-auto" aria-label="待读取文件">
        {files.map(file => <li key={key(file)} className="flex items-center justify-between gap-3 rounded bg-white/5 px-2 py-1.5">
          <span className="min-w-0 break-all">{file.name} <span className="text-white/45">· {(file.size / 1024).toFixed(1)} KB</span></span>
          <button type="button" disabled={unavailable} aria-label={`移除 ${file.name}`} onClick={() => setFiles(old => old.filter(f => key(f) !== key(file)))} className="shrink-0 px-2 py-1 disabled:opacity-40">移除</button>
        </li>)}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={unavailable} className="rounded-full bg-pink-600 px-4 py-2 font-semibold text-white disabled:opacity-50" onClick={async () => {
          if (unavailable || locked.current) return;
          locked.current = true; setBusy(true); setError("");
          try { if (await onProcess([...files])) setFiles([]); }
          catch (e) { setError(e instanceof Error ? e.message : "资料读取失败，已保留文件列表"); }
          finally { locked.current = false; setBusy(false); }
        }}>{busy ? "正在精炼…" : `开始精炼（${files.length} 个文件）`}</button>
        <span className="text-white/45">待选文件仅保留在当前页面，刷新前请先读取。</span>
      </div>
    </>}
    {error && <p role="alert" className="mt-2 text-rose-300">{error}</p>}
  </div>;
}

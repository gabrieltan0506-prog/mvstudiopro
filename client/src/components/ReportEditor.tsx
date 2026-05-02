import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pencil, Trash2, Plus, Wand2, ArrowUp, ArrowDown, Save, Send, Loader2,
  ChevronLeft, FileDown, X, Sparkles, RefreshCw, Type, Maximize2, Minimize2, Table as TableIcon,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import ReportRenderer from "@/components/ReportRenderer";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// Markdown 切块（保留原始字符串，编辑时直接替换）
// ─────────────────────────────────────────────────────────────────────────────

function splitMarkdownIntoChunks(md: string): string[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const chunks: string[] = [];
  let buf: string[] = [];

  const flush = () => {
    if (buf.length) {
      const joined = buf.join("\n").trim();
      if (joined) chunks.push(joined);
      buf = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 空行 → 块边界
    if (!trimmed) {
      flush();
      continue;
    }

    // 标题：每个标题单独成块
    if (/^#{1,6}\s/.test(trimmed)) {
      flush();
      buf = [line];
      flush();
      continue;
    }

    // 分隔线：单独成块
    if (/^(---+|===+|\*\*\*+)$/.test(trimmed)) {
      flush();
      buf = [line];
      flush();
      continue;
    }

    // 表格：从表头开始一直到不再是表格行
    if (/^\|.+\|$/.test(trimmed) && i + 1 < lines.length && /^\|?\s*:?-{2,}.*$/.test(lines[i + 1].trim())) {
      flush();
      buf = [line, lines[i + 1]];
      i++;
      while (i + 1 < lines.length && /^\|.+\|$/.test(lines[i + 1]?.trim() || "")) {
        i++;
        buf.push(lines[i]);
      }
      flush();
      continue;
    }

    buf.push(line);
  }
  flush();
  return chunks;
}

// 块类型识别（用于视觉提示）
function detectBlockKind(chunk: string): "heading" | "table" | "list" | "quote" | "image" | "divider" | "paragraph" {
  const t = chunk.trim();
  if (/^#{1,6}\s/.test(t)) return "heading";
  if (/^\|.+\|$/m.test(t.split("\n")[0]) && /^\|?\s*:?-{2,}/.test(t.split("\n")[1] || "")) return "table";
  if (/^[-*]\s/.test(t) || /^\d+\.\s/.test(t)) return "list";
  if (/^>\s?/.test(t)) return "quote";
  if (/^!\[/.test(t)) return "image";
  if (/^(---+|===+|\*\*\*+)$/.test(t)) return "divider";
  return "paragraph";
}

const BLOCK_KIND_META: Record<string, { label: string; color: string; bg: string }> = {
  heading:   { label: "标题",  color: "#7a5410", bg: "rgba(168,118,27,0.16)" },
  paragraph: { label: "段落",  color: "#3d2c14", bg: "rgba(122,84,16,0.08)" },
  table:     { label: "数据表", color: "#1f7a52", bg: "rgba(31,122,82,0.14)" },
  list:      { label: "列表",  color: "#2160a0", bg: "rgba(33,96,160,0.14)" },
  quote:     { label: "引用",  color: "#a8761b", bg: "rgba(168,118,27,0.18)" },
  image:     { label: "图片",  color: "#7c3aed", bg: "rgba(124,58,237,0.14)" },
  divider:   { label: "分割",  color: "rgba(122,84,16,0.5)", bg: "rgba(122,84,16,0.05)" },
};

// ─────────────────────────────────────────────────────────────────────────────
// 草稿 PDF 水印（DRAFT · 草稿待审核）注入到导出 HTML
// ─────────────────────────────────────────────────────────────────────────────

const DRAFT_WATERMARK_CSS = `
@media all {
  body { position: relative !important; }
  body::before {
    content: "DRAFT · 草稿待审核 · 请勿外发";
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%,-50%) rotate(-32deg);
    font-size: 88px;
    font-weight: 900;
    color: rgba(168,118,27,0.16);
    pointer-events: none;
    z-index: 9999;
    letter-spacing: 0.20em;
    white-space: nowrap;
  }
  body::after {
    content: "";
    position: fixed;
    inset: 0;
    background-image: repeating-linear-gradient(
      -32deg,
      rgba(168,118,27,0.04) 0,
      rgba(168,118,27,0.04) 1px,
      transparent 1px,
      transparent 220px
    );
    pointer-events: none;
    z-index: 9998;
  }
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────────────────────

export interface ReportEditorProps {
  recordId: number;
  initialMarkdown: string;
  title: string;
  status: "awaiting_review" | "completed" | string;
  onClose: () => void;
  onAfterPublish?: () => void;
}

export default function ReportEditor({
  recordId,
  initialMarkdown,
  title,
  status,
  onClose,
  onAfterPublish,
}: ReportEditorProps) {
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [chunks, setChunks] = useState<string[]>(() => splitMarkdownIntoChunks(initialMarkdown));
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(false);

  // chunks 变化时，自动重组 markdown
  useEffect(() => {
    setMarkdown(chunks.join("\n\n"));
  }, [chunks]);

  // ── tRPC：保存草稿 ──────────────────────────────────────────────────────────
  const saveDraftMutation = trpc.deepResearch.saveDraft.useMutation({
    onSuccess: (r) => {
      setAutoSaveStatus("saved");
      setLastSavedAt(r.savedAt);
      dirtyRef.current = false;
      setTimeout(() => setAutoSaveStatus("idle"), 1800);
    },
    onError: (e) => {
      setAutoSaveStatus("error");
      toast.error(e.message || "保存失败");
    },
  });

  // ── tRPC：正式出刊 ──────────────────────────────────────────────────────────
  const publishMutation = trpc.deepResearch.publishDraft.useMutation({
    onSuccess: () => {
      toast.success("✨ 已正式出刊，可下载富图文 PDF");
      onAfterPublish?.();
      onClose();
    },
    onError: (e) => toast.error(e.message || "出刊失败"),
  });

  // ── tRPC：AI 助手 ───────────────────────────────────────────────────────────
  const aiAssistMutation = trpc.deepResearch.aiAssist.useMutation();

  // ── tRPC：PDF 导出（GCS pdf-worker） ────────────────────────────────────────
  const downloadPdfMutation = trpc.mvAnalysis.downloadAnalysisPdf.useMutation({
    onSuccess: (result) => {
      setIsExporting(false);
      if (!result.pdfBase64) {
        toast.error("PDF 生成成功但内容为空，请重试");
        return;
      }
      try {
        const bytes = Uint8Array.from(atob(result.pdfBase64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "application/pdf" });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        const safe = (title || "战报草稿").replace(/[\\/:*?"<>|]/g, "");
        a.download = `战报草稿-${safe.slice(0, 25)}-DRAFT-${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        toast.success("草稿 PDF 已开始下载（带审核水印）");
      } catch {
        toast.error("PDF 下载时出错，请重试");
      }
    },
    onError: (e) => {
      setIsExporting(false);
      toast.error(e.message || "PDF 导出失败");
    },
  });

  // ── 自动保存（每次 chunks 改动 1.5 秒后触发） ───────────────────────────────
  useEffect(() => {
  // 已出刊也自动保存修订（与后端 saveDraft = completed 一致）
    if (markdown === initialMarkdown) return;
    dirtyRef.current = true;
    setAutoSaveStatus("saving");
    const t = setTimeout(() => {
      saveDraftMutation.mutate({ recordId, markdown });
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown]);

  // ── 离开页面前提示未保存 ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // ── 块操作：编辑 / 删除 / 上下移 / 插入新块 ──────────────────────────────────
  const updateChunk = (idx: number, next: string) => {
    setChunks((cs) => cs.map((c, i) => (i === idx ? next : c)));
  };

  const removeChunk = (idx: number) => {
    setChunks((cs) => cs.filter((_, i) => i !== idx));
  };

  const moveChunk = (idx: number, dir: -1 | 1) => {
    setChunks((cs) => {
      const next = [...cs];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return cs;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const insertAfter = (idx: number, content = "新段落 · 双击编辑") => {
    setChunks((cs) => {
      const next = [...cs];
      next.splice(idx + 1, 0, content);
      return next;
    });
    setEditingIdx(idx + 1);
  };

  // ── PDF 导出（草稿带水印） ──────────────────────────────────────────────────
  const handleDownloadDraftPdf = useCallback(() => {
    if (!previewRef.current) return;
    setIsExporting(true);

    // 克隆 documentElement 后剥离不必要内容
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script").forEach((n) => n.remove());
    clone.querySelectorAll("video, audio, iframe").forEach((n) => n.remove());
    clone.querySelectorAll('[data-pdf-exclude="true"]').forEach((n) => n.remove());

    // 替换 body：只保留预览容器
    const cloneBody = clone.querySelector("body");
    if (cloneBody) {
      cloneBody.innerHTML = "";
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "padding: 24px; background: #f7ede0; min-height: 100vh;";
      wrapper.innerHTML = previewRef.current.innerHTML;
      cloneBody.appendChild(wrapper);
    }

    // 注入草稿水印 CSS
    const styleTag = clone.ownerDocument!.createElement("style");
    styleTag.textContent = DRAFT_WATERMARK_CSS;
    clone.querySelector("head")?.appendChild(styleTag);

    const base = document.createElement("base");
    base.href = window.location.origin + "/";
    clone.querySelector("head")?.prepend(base);

    const html = "<!DOCTYPE html>" + clone.outerHTML;
    downloadPdfMutation.mutate({ html });
  }, [downloadPdfMutation]);

  // ── 出刊前最后保存 + 出刊 ───────────────────────────────────────────────────
  const handlePublish = () => {
    if (!confirm("确认正式出刊？出刊后将进入「战略作品快照库」，可下载无水印 PDF。")) return;
    publishMutation.mutate({ recordId, markdown });
  };

  const fullPreview = useMemo(() => markdown, [markdown]);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#f5e9d7 0%,#ede0c9 30%,#e8d8be 70%,#dfcaa9 100%)", fontFamily: "'PingFang SC','HarmonyOS Sans','Source Han Sans',Inter,sans-serif" }}>
      {/* 顶部工具栏 */}
      <div style={{ borderBottom: "1px solid rgba(122,84,16,0.20)", background: "rgba(255,250,240,0.95)", backdropFilter: "blur(14px)", padding: "12px 24px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 8px rgba(122,84,16,0.05)" }}>
        <button onClick={onClose} style={{ color: "#7a5410", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 700 }}>
          <ChevronLeft size={16} />返回作品库
        </button>
        <span style={{ color: "rgba(122,84,16,0.4)" }}>/</span>
        <span style={{ color: "#3d2c14", fontSize: 13, fontWeight: 800, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 99, background: "rgba(217,119,6,0.12)", border: "1px solid rgba(217,119,6,0.35)", color: "#d97706", fontSize: 11, fontWeight: 800 }}>
          <Pencil size={11} />主编审核工作台
        </span>

        {/* 自动保存状态 */}
        <span style={{ marginLeft: 8, fontSize: 11, color: "rgba(61,44,20,0.55)", display: "flex", alignItems: "center", gap: 5, fontWeight: 600 }}>
          {autoSaveStatus === "saving" && <><Loader2 size={11} className="animate-spin" />正在自动保存…</>}
          {autoSaveStatus === "saved" && <>✓ 已自动保存 {lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString("zh-CN").slice(0, 5) : ""}</>}
          {autoSaveStatus === "idle" && lastSavedAt && <>✓ 草稿已保存 {new Date(lastSavedAt).toLocaleTimeString("zh-CN").slice(0, 5)}</>}
          {autoSaveStatus === "error" && <span style={{ color: "#dc2626" }}>⚠ 自动保存失败</span>}
        </span>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={handleDownloadDraftPdf}
            disabled={isExporting}
            title="下载草稿 PDF（带审核水印，禁外发）"
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, background: "rgba(217,119,6,0.10)", border: "1px solid rgba(217,119,6,0.30)", color: isExporting ? "rgba(217,119,6,0.5)" : "#d97706", fontSize: 12, fontWeight: 800, cursor: isExporting ? "not-allowed" : "pointer" }}
          >
            {isExporting ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
            下载草稿 PDF
          </button>
          <button
            onClick={() => saveDraftMutation.mutate({ recordId, markdown })}
            disabled={saveDraftMutation.isPending || autoSaveStatus === "saving"}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, background: "rgba(168,118,27,0.10)", border: "1px solid rgba(168,118,27,0.30)", color: "#7a5410", fontSize: 12, fontWeight: 800, cursor: "pointer" }}
          >
            <Save size={12} />立即保存
          </button>
          <button
            onClick={handlePublish}
            disabled={publishMutation.isPending}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 20px", borderRadius: 10, background: publishMutation.isPending ? "rgba(31,122,82,0.30)" : "linear-gradient(135deg,#1f7a52,#0e5b3b)", border: "1px solid rgba(31,122,82,0.65)", color: "#f0fdf4", fontSize: 12.5, fontWeight: 900, cursor: publishMutation.isPending ? "not-allowed" : "pointer", boxShadow: "0 4px 14px rgba(31,122,82,0.30)" }}
          >
            {publishMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            正式出刊
          </button>
        </div>
      </div>

      {/* 主区：左 块编辑列表 + 右 实时预览（双栏） */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 24, padding: "24px 24px 80px", maxWidth: 1700, margin: "0 auto" }}>
        {/* ── 左栏：块编辑列表 ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ padding: "14px 16px", borderRadius: 12, background: "rgba(255,250,240,0.85)", border: "1px solid rgba(122,84,16,0.18)", fontSize: 12, color: "rgba(61,44,20,0.75)", lineHeight: 1.7, fontWeight: 600 }}>
            <strong style={{ color: "#7a5410" }}>主编工作流</strong> · 鼠标悬停在每个区块上会出现 ⋮ 菜单 · 可调用 AI 助手对该段重写 / 扩写 / 缩写 / 补一张表 · 草稿每 1.5 秒自动保存 · 出刊后才能下载无水印正式版
          </div>

          {chunks.map((chunk, idx) => (
            <BlockCard
              key={`${idx}-${chunk.length}`}
              chunk={chunk}
              idx={idx}
              total={chunks.length}
              isEditing={editingIdx === idx}
              onEditOpen={() => setEditingIdx(idx)}
              onEditClose={() => setEditingIdx(null)}
              onUpdate={(next) => updateChunk(idx, next)}
              onDelete={() => removeChunk(idx)}
              onMoveUp={() => moveChunk(idx, -1)}
              onMoveDown={() => moveChunk(idx, +1)}
              onInsertAfter={() => insertAfter(idx)}
              aiAssistMutation={aiAssistMutation}
              recordId={recordId}
            />
          ))}

          {/* 底部插入按钮 */}
          <button
            onClick={() => insertAfter(chunks.length - 1, "## 新章节\n\n双击编辑章节内容…")}
            style={{ padding: "12px", borderRadius: 12, border: "2px dashed rgba(168,118,27,0.40)", background: "rgba(255,250,240,0.50)", color: "#7a5410", fontSize: 12.5, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            <Plus size={14} />在末尾追加新章节
          </button>
        </div>

        {/* ── 右栏：实时预览（粘性） ── */}
        <div style={{ position: "sticky", top: 90, height: "calc(100vh - 110px)", overflow: "auto", borderRadius: 14, border: "1px solid rgba(122,84,16,0.20)", background: "rgba(255,250,240,0.55)", boxShadow: "0 4px 16px rgba(122,84,16,0.08)" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(122,84,16,0.15)", background: "rgba(255,250,240,0.85)", display: "flex", alignItems: "center", gap: 8, position: "sticky", top: 0, zIndex: 5, backdropFilter: "blur(8px)" }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.10em", color: "#7a5410", textTransform: "uppercase" }}>所见即所得 · 实时预览</span>
            <span style={{ fontSize: 11, color: "rgba(61,44,20,0.55)", marginLeft: "auto", fontWeight: 600 }}>
              {markdown.length.toLocaleString()} 字 · {chunks.length} 个区块
            </span>
          </div>
          <div ref={previewRef} style={{ padding: 16 }}>
            <ReportRenderer markdown={fullPreview} padding="32px 36px" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 单个区块卡：hover 显示 ⋮ 菜单 · 双击进入抽屉编辑
// ─────────────────────────────────────────────────────────────────────────────

function BlockCard({
  chunk, idx, total,
  isEditing, onEditOpen, onEditClose,
  onUpdate, onDelete, onMoveUp, onMoveDown, onInsertAfter,
  aiAssistMutation, recordId,
}: {
  chunk: string;
  idx: number;
  total: number;
  isEditing: boolean;
  onEditOpen: () => void;
  onEditClose: () => void;
  onUpdate: (next: string) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onInsertAfter: () => void;
  aiAssistMutation: ReturnType<typeof trpc.deepResearch.aiAssist.useMutation>;
  recordId: number;
}) {
  const kind = detectBlockKind(chunk);
  const meta = BLOCK_KIND_META[kind] || BLOCK_KIND_META.paragraph;
  const [hover, setHover] = useState(false);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        borderRadius: 12,
        background: hover ? "rgba(255,250,240,0.95)" : "rgba(255,250,240,0.65)",
        border: `1px solid ${hover ? "rgba(168,118,27,0.55)" : "rgba(122,84,16,0.15)"}`,
        boxShadow: hover ? "0 6px 18px rgba(168,118,27,0.18)" : "none",
        transition: "all 0.15s",
      }}
    >
      {/* 顶部小标签条 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid rgba(122,84,16,0.10)" }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.10em", padding: "2px 8px", borderRadius: 4, background: meta.bg, color: meta.color }}>
          #{idx + 1} {meta.label}
        </span>
        {/* 行动按钮（hover 时显示） */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, opacity: hover ? 1 : 0, transition: "opacity 0.15s" }}>
          <IconBtn icon={<ArrowUp size={11} />} title="上移" onClick={onMoveUp} disabled={idx === 0} />
          <IconBtn icon={<ArrowDown size={11} />} title="下移" onClick={onMoveDown} disabled={idx === total - 1} />
          <IconBtn icon={<Pencil size={11} />} title="编辑该段" onClick={onEditOpen} accent />
          <IconBtn icon={<Plus size={11} />} title="在下方插入新段" onClick={onInsertAfter} />
          <IconBtn icon={<Trash2 size={11} />} title="删除该段" onClick={() => { if (confirm("确认删除该段？")) onDelete(); }} danger />
        </div>
      </div>

      {/* 渲染预览（双击进入编辑） */}
      <div onDoubleClick={onEditOpen} style={{ padding: "10px 16px 14px", cursor: "pointer", minHeight: 32 }}>
        <ReportRenderer markdown={chunk} padding="0" className="block-card-preview" noAutoChart />
      </div>

      {/* 抽屉式编辑器 */}
      {isEditing && (
        <BlockDrawerEditor
          chunk={chunk}
          onSave={(next) => { onUpdate(next); onEditClose(); }}
          onClose={onEditClose}
          aiAssistMutation={aiAssistMutation}
          recordId={recordId}
        />
      )}
    </div>
  );
}

function IconBtn({ icon, title, onClick, disabled, accent, danger }: { icon: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; accent?: boolean; danger?: boolean }) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 24, height: 24, borderRadius: 6,
        background: disabled ? "transparent" : danger ? "rgba(220,38,38,0.10)" : accent ? "rgba(168,118,27,0.16)" : "rgba(122,84,16,0.06)",
        border: `1px solid ${disabled ? "transparent" : danger ? "rgba(220,38,38,0.30)" : accent ? "rgba(168,118,27,0.40)" : "rgba(122,84,16,0.20)"}`,
        color: disabled ? "rgba(122,84,16,0.30)" : danger ? "#dc2626" : "#7a5410",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {icon}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 区块编辑抽屉：textarea + AI 助手按钮组
// ─────────────────────────────────────────────────────────────────────────────

function BlockDrawerEditor({
  chunk, onSave, onClose, aiAssistMutation, recordId,
}: {
  chunk: string;
  onSave: (next: string) => void;
  onClose: () => void;
  aiAssistMutation: ReturnType<typeof trpc.deepResearch.aiAssist.useMutation>;
  recordId: number;
}) {
  const [draft, setDraft] = useState(chunk);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiAction, setAiAction] = useState<"rewrite" | "expand" | "shrink" | "addTable" | "freeform" | null>(null);

  const callAi = async (action: "rewrite" | "expand" | "shrink" | "addTable" | "freeform") => {
    setAiAction(action);
    setAiSuggestion(null);
    try {
      const r = await aiAssistMutation.mutateAsync({
        recordId,
        action,
        blockText: draft,
        instruction: action === "freeform" ? aiInstruction : undefined,
      });
      setAiSuggestion(r.suggestion);
    } catch (e: any) {
      toast.error(e.message || "AI 调用失败");
      setAiAction(null);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(28,20,7,0.55)", zIndex: 200, backdropFilter: "blur(4px)", display: "flex", justifyContent: "center", alignItems: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(960px, 100%)", maxHeight: "90vh", overflow: "auto", borderRadius: 18, background: "linear-gradient(180deg,#fffaf0 0%,#f5ecda 100%)", border: "1px solid rgba(168,118,27,0.40)", boxShadow: "0 18px 48px rgba(28,20,7,0.45)", display: "flex", flexDirection: "column" }}
      >
        {/* 头 */}
        <div style={{ padding: "16px 22px", borderBottom: "1px solid rgba(122,84,16,0.18)", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#a8761b,#7a5410)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Pencil size={16} color="#fff7df" />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: "#3d2c14" }}>编辑区块</div>
            <div style={{ fontSize: 11, color: "rgba(61,44,20,0.65)", fontWeight: 600 }}>支持 Markdown 语法 · AI 助手按次扣 5 点</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", width: 30, height: 30, borderRadius: 8, background: "rgba(122,84,16,0.08)", border: "1px solid rgba(122,84,16,0.20)", color: "#7a5410", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={14} />
          </button>
        </div>

        {/* AI 助手按钮组 */}
        <div style={{ padding: "12px 22px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderBottom: "1px solid rgba(122,84,16,0.10)" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: "#7a5410", letterSpacing: "0.05em", marginRight: 4 }}>
            <Sparkles size={11} style={{ display: "inline", marginRight: 4 }} />
            AI 助手
          </span>
          <AiBtn label="重写" icon={<RefreshCw size={11} />} onClick={() => callAi("rewrite")} loading={aiAssistMutation.isPending && aiAction === "rewrite"} />
          <AiBtn label="扩写 1.6×" icon={<Maximize2 size={11} />} onClick={() => callAi("expand")} loading={aiAssistMutation.isPending && aiAction === "expand"} />
          <AiBtn label="缩写 0.6×" icon={<Minimize2 size={11} />} onClick={() => callAi("shrink")} loading={aiAssistMutation.isPending && aiAction === "shrink"} />
          <AiBtn label="补一张表" icon={<TableIcon size={11} />} onClick={() => callAi("addTable")} loading={aiAssistMutation.isPending && aiAction === "addTable"} />
          <input
            placeholder="自定义指令（如：把这段改成更口语化）…"
            value={aiInstruction}
            onChange={(e) => setAiInstruction(e.target.value)}
            style={{ flex: 1, minWidth: 200, padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(122,84,16,0.30)", fontSize: 11.5, background: "#fff", outline: "none" }}
          />
          <AiBtn label="自定义" icon={<Wand2 size={11} />} onClick={() => callAi("freeform")} loading={aiAssistMutation.isPending && aiAction === "freeform"} disabled={!aiInstruction.trim()} primary />
        </div>

        {/* 编辑器主体：textarea */}
        <div style={{ padding: "14px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ fontSize: 11, fontWeight: 800, color: "#7a5410", letterSpacing: "0.05em" }}>
            <Type size={11} style={{ display: "inline", marginRight: 4 }} />Markdown 源码（左下保存生效）
          </label>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            rows={12}
            style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid rgba(122,84,16,0.25)", background: "#fff", color: "#1c1407", fontSize: 13.5, lineHeight: 1.7, fontFamily: "ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace", resize: "vertical", outline: "none", boxSizing: "border-box" }}
          />
        </div>

        {/* AI 建议预览 */}
        {aiSuggestion && (
          <div style={{ padding: "0 22px 16px" }}>
            <div style={{ borderRadius: 12, background: "rgba(31,122,82,0.06)", border: "1px solid rgba(31,122,82,0.30)", padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <Sparkles size={13} color="#1f7a52" />
                <strong style={{ color: "#0e5b3b", fontSize: 12, letterSpacing: "0.05em" }}>AI 建议</strong>
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button
                    onClick={() => { setDraft(aiSuggestion); setAiSuggestion(null); }}
                    style={{ padding: "5px 12px", borderRadius: 6, background: "linear-gradient(135deg,#1f7a52,#0e5b3b)", border: "none", color: "#f0fdf4", fontSize: 11, fontWeight: 800, cursor: "pointer" }}
                  >
                    ✓ 采纳替换
                  </button>
                  <button
                    onClick={() => setAiSuggestion(null)}
                    style={{ padding: "5px 12px", borderRadius: 6, background: "rgba(122,84,16,0.08)", border: "1px solid rgba(122,84,16,0.20)", color: "#7a5410", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                  >
                    取消
                  </button>
                </span>
              </div>
              <div style={{ background: "#fff", borderRadius: 8, padding: 12, fontSize: 12.5, lineHeight: 1.7, color: "#1c1407", maxHeight: 280, overflow: "auto", whiteSpace: "pre-wrap", fontFamily: "ui-monospace, monospace" }}>
                {aiSuggestion}
              </div>
            </div>
          </div>
        )}

        {/* 底部按钮 */}
        <div style={{ padding: "12px 22px 18px", borderTop: "1px solid rgba(122,84,16,0.15)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            onClick={onClose}
            style={{ padding: "9px 18px", borderRadius: 8, background: "rgba(122,84,16,0.08)", border: "1px solid rgba(122,84,16,0.25)", color: "#7a5410", fontSize: 12, fontWeight: 800, cursor: "pointer" }}
          >
            取消
          </button>
          <button
            onClick={() => onSave(draft)}
            style={{ padding: "9px 22px", borderRadius: 8, background: "linear-gradient(135deg,#a8761b,#7a5410)", border: "none", color: "#fff7df", fontSize: 12.5, fontWeight: 900, cursor: "pointer", boxShadow: "0 4px 14px rgba(168,118,27,0.30)" }}
          >
            <Save size={12} style={{ display: "inline", marginRight: 6 }} />
            保存到草稿
          </button>
        </div>
      </div>
    </div>
  );
}

function AiBtn({ label, icon, onClick, loading, disabled, primary }: { label: string; icon: React.ReactNode; onClick: () => void; loading?: boolean; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      style={{
        display: "flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: 6,
        background: loading ? "rgba(168,118,27,0.20)" : primary ? "linear-gradient(135deg,#a8761b,#7a5410)" : "rgba(168,118,27,0.10)",
        border: `1px solid ${primary ? "rgba(168,118,27,0.55)" : "rgba(168,118,27,0.30)"}`,
        color: primary ? "#fff7df" : "#7a5410",
        fontSize: 11.5, fontWeight: 800,
        cursor: loading || disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {loading ? <Loader2 size={11} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

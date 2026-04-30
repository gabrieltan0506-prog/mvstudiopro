/**
 * 企业专属智能体（AaaS）知识库上传组件
 *
 * 设计：
 *   - 原生 HTML5 drag/drop API（不引入 react-dropzone，errors.md 黄线 / reviewer 红线）
 *   - 多文件 + 串行上传（避免并发把单 agent 50 MB 配额一次性挤爆）
 *   - 直接 fetch POST 走 PR-3 建好的 Express 端点 /api/enterprise-agent/:agentId/kb-upload
 *   - 单文件失败不阻塞其余（每个文件独立 try/catch + 独立 toast）
 *
 * 响应式：
 *   - 移动 1 列，触摸热区 ≥ 48pt（min-h-[48pt]），字号 ≥ 14px
 *   - 平板 / 桌面相同布局（拖拽区已经是块状元素）
 *
 * 可复用：父页面（管理后台 / 客户 Playground）传 agentId + onUploaded 即可。
 */

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, FileText, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const KB_MAX_MB = 5;
const KB_MAX_BYTES = KB_MAX_MB * 1024 * 1024;
const KB_ACCEPT = ".pdf,.txt,.docx";

export interface KbUploadResult {
  kbId: number;
  filename: string;
  sizeMb: number;
  charCount: number;
  method: string;
  agentKbUsedMb: number;
  agentKbQuotaMb: number;
}

interface EnterpriseAgentKbUploadProps {
  agentId: number;
  /** 上传成功回调；父级用来 refetch listKnowledge */
  onUploaded?: (result: KbUploadResult) => void;
  /** 当前已用 / 配额 — 用于 UI 提示 */
  usedMb?: number;
  quotaMb?: number;
  /** 是否禁用（agent 已 expired / deleted 时） */
  disabled?: boolean;
}

export default function EnterpriseAgentKbUpload({
  agentId,
  onUploaded,
  usedMb = 0,
  quotaMb = 50,
  disabled = false,
}: EnterpriseAgentKbUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const remainingMb = Math.max(0, quotaMb - usedMb);
  const canUpload = !disabled && uploadingName === null;

  const validateBeforeFetch = (file: File): string | null => {
    if (file.size === 0) return "文件为空";
    if (file.size > KB_MAX_BYTES) {
      return `文件超过 ${KB_MAX_MB} MB 上限（实际 ${(file.size / 1_048_576).toFixed(2)} MB）`;
    }
    const lower = file.name.toLowerCase();
    if (
      !lower.endsWith(".pdf") &&
      !lower.endsWith(".txt") &&
      !lower.endsWith(".docx")
    ) {
      return "仅支持 PDF / TXT / DOCX";
    }
    return null;
  };

  const uploadOne = async (file: File): Promise<void> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/enterprise-agent/${agentId}/kb-upload`, {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg =
        (json as { error?: string })?.error ||
        `上传失败 (HTTP ${res.status})`;
      throw new Error(errMsg);
    }
    const result = json as KbUploadResult;
    onUploaded?.(result);
    toast.success(
      `${result.filename} 上传成功 · ${result.charCount} 字 · 已用 ${result.agentKbUsedMb}/${result.agentKbQuotaMb} MB`,
    );
  };

  const handleFiles = async (files: File[]) => {
    if (!canUpload) return;
    if (files.length === 0) return;

    // 前端先做大小 / 类型校验，错的丢 toast 跳过
    const validated: File[] = [];
    for (const file of files) {
      const err = validateBeforeFetch(file);
      if (err) {
        toast.error(`${file.name}：${err}`);
        continue;
      }
      validated.push(file);
    }
    if (validated.length === 0) return;

    setProgress({ done: 0, total: validated.length });

    for (let i = 0; i < validated.length; i += 1) {
      const file = validated[i];
      setUploadingName(file.name);
      try {
        await uploadOne(file);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`${file.name}：${msg}`);
      } finally {
        setProgress({ done: i + 1, total: validated.length });
      }
    }

    setUploadingName(null);
    setProgress({ done: 0, total: 0 });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          if (!canUpload) return;
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (!canUpload) return;
          handleFiles(Array.from(e.dataTransfer.files));
        }}
        onClick={() => {
          if (!canUpload) return;
          fileInputRef.current?.click();
        }}
        role="button"
        tabIndex={canUpload ? 0 : -1}
        aria-disabled={!canUpload}
        onKeyDown={(e) => {
          if (!canUpload) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className={cn(
          "rounded-xl border-2 border-dashed p-6 sm:p-8 text-center transition-colors min-h-[140px] flex flex-col items-center justify-center gap-2",
          canUpload
            ? "cursor-pointer border-amber-500/40 bg-amber-500/5 hover:border-amber-400 hover:bg-amber-500/10"
            : "cursor-not-allowed border-zinc-700 bg-zinc-900/50 opacity-60",
          isDragging && "border-amber-300 bg-amber-500/15",
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={KB_ACCEPT}
          multiple
          hidden
          onChange={(e) => handleFiles(Array.from(e.target.files ?? []))}
        />
        {uploadingName ? (
          <>
            <Loader2 className="h-7 w-7 text-amber-400 animate-spin" />
            <p className="text-sm sm:text-base text-zinc-100 font-medium break-all">
              正在上传 {uploadingName}
            </p>
            <p className="text-xs sm:text-sm text-zinc-400">
              进度 {progress.done} / {progress.total}
            </p>
          </>
        ) : (
          <>
            <Upload className="h-7 w-7 text-amber-400" />
            <p className="text-sm sm:text-base text-zinc-100 font-medium">
              拖拽文件到这里 或 点击选择
            </p>
            <p className="text-xs sm:text-sm text-zinc-400">
              PDF / TXT / DOCX · 单文件 ≤ {KB_MAX_MB} MB · 剩余配额 {remainingMb} MB
            </p>
          </>
        )}
      </div>

      {/* 配额警告 */}
      {remainingMb < 5 && remainingMb > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs sm:text-sm text-amber-200">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>
            知识库剩余配额不足 5 MB，建议先删除部分已上传文件再继续。
          </p>
        </div>
      )}
      {remainingMb === 0 && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs sm:text-sm text-red-200">
          <FileText className="h-4 w-4 shrink-0 mt-0.5" />
          <p>
            知识库容量已满（{usedMb}/{quotaMb} MB），请先删除部分文件再上传。
          </p>
        </div>
      )}
    </div>
  );
}

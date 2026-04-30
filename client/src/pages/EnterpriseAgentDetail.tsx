/**
 * 企业专属智能体（AaaS）详情 / 操作页
 *
 * 路由：/enterprise-agent/:agentId（与 /my-works/:id 同模式）
 * 后端：trpc.enterpriseAgents.{get,executeQuery,expireAgent,softDeleteAgent,deleteKnowledge}
 *      + Express POST /api/enterprise-agent/:agentId/kb-upload（PR-3）
 *
 * 范围（PR-4 严格）：
 *   - agent 信息卡（agentName / org / tier / status / 配额条）
 *   - 灵魂指令展示（折叠展开）
 *   - 知识库 Tab：列表 + 删除 + 拖拽上传
 *   - 调用历史 Tab：最近 10 次 sessions
 *   - 测试调用 Tab：输入 prompt → executeQuery → 渲染 markdown 结果
 *   - 危险操作：停用（expireAgent）/ 软删除（softDeleteAgent）+ 二次确认 Dialog
 *   - 不在本页：客户 Playground 完整对话框（PR-5）
 *
 * 视觉路线：与 EnterpriseAgentManager.tsx 保持一致（黑底 + 香槟金）
 *
 * 响应式：
 *   - 顶栏移动垂直 / 平板 sm:水平
 *   - 信息卡 grid: 移动 1 列 / 平板 sm:2 列
 *   - Tab 列表 mobile 横向滚动支持（shadcn Tabs 已自带）
 *   - 测试调用 textarea 移动 fontSize 16px 防 iOS auto-zoom
 *   - markdown 输出 pre 横向滚动（防长 URL / code 撑破布局）
 */

import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Loader2,
  ArrowLeft,
  Building2,
  Database,
  PauseCircle,
  Trash2,
  Sparkles,
  Send,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Play,
  FileText,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import EnterpriseAgentKbUpload, {
  type KbUploadResult,
} from "@/components/EnterpriseAgentKbUpload";

// ─── 时间 / 尺寸格式 ───────────────────────────────────────────────────────

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(2)} MB`;
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return null;
  return Math.ceil((d - Date.now()) / 86_400_000);
}

// ─── 主页面 ────────────────────────────────────────────────────────────────

export default function EnterpriseAgentDetail() {
  const params = useParams<{ agentId: string }>();
  const agentId = Number(params.agentId);
  const [, navigate] = useLocation();

  if (!Number.isInteger(agentId) || agentId <= 0) {
    return <InvalidIdState onBack={() => navigate("/enterprise-agent")} />;
  }

  return <DetailInner agentId={agentId} onBack={() => navigate("/enterprise-agent")} />;
}

function InvalidIdState({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <AlertTriangle className="h-12 w-12 text-red-400 mx-auto mb-4" />
        <h2 className="text-lg sm:text-xl font-semibold mb-2">无效的 Agent ID</h2>
        <p className="text-sm text-zinc-400 mb-6">
          URL 里的 agentId 不是有效的正整数。
        </p>
        <Button onClick={onBack} className="bg-amber-500 hover:bg-amber-400 text-zinc-950 min-h-[44px]">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          返回列表
        </Button>
      </div>
    </div>
  );
}

// ─── 内层（拿到合法 agentId 之后） ─────────────────────────────────────────

function DetailInner({ agentId, onBack }: { agentId: number; onBack: () => void }) {
  const detailQuery = trpc.enterpriseAgents.get.useQuery({ agentId });
  const utils = trpc.useUtils();

  const refetchAll = () => {
    detailQuery.refetch();
    utils.enterpriseAgents.list.invalidate();
  };

  if (detailQuery.isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
      </div>
    );
  }

  if (detailQuery.error || !detailQuery.data) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <AlertTriangle className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg sm:text-xl font-semibold mb-2">无法加载 Agent</h2>
          <p className="text-sm text-zinc-400 mb-6">
            {detailQuery.error?.message ?? "未知错误"}
          </p>
          <Button onClick={onBack} className="bg-amber-500 hover:bg-amber-400 text-zinc-950 min-h-[44px]">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            返回列表
          </Button>
        </div>
      </div>
    );
  }

  const { agent, knowledge, recentSessions } = detailQuery.data;
  const isActive = agent.status === "active";
  const trialDays = daysUntil(agent.trialUntil);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10">
        {/* 顶栏：返回 + 标题 + 危险操作 */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6 sm:mb-8">
          <div className="min-w-0 flex-1">
            <Link href="/enterprise-agent">
              <a className="inline-flex items-center gap-1 text-xs sm:text-sm text-zinc-400 hover:text-amber-400 mb-2 min-h-[32px]">
                <ArrowLeft className="h-3.5 w-3.5" />
                返回列表
              </a>
            </Link>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-50 break-words">
              {agent.agentName}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {agent.organizationName && (
                <span className="text-xs sm:text-sm text-zinc-400 flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" />
                  {agent.organizationName}
                </span>
              )}
              <TierBadge tier={agent.tier} />
              <StatusBadge status={agent.status} />
              {agent.tier === "trial" && trialDays !== null && (
                <span
                  className={cn(
                    "text-xs flex items-center gap-1",
                    trialDays <= 3 ? "text-red-300" : trialDays <= 7 ? "text-amber-300" : "text-zinc-400",
                  )}
                >
                  <Clock className="h-3 w-3" />
                  {trialDays > 0 ? `试用剩余 ${trialDays} 天` : "试用已到期"}
                </span>
              )}
            </div>
          </div>
          {isActive && (
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 shrink-0">
              <ExpireButton agentId={agent.id} onSuccess={refetchAll} />
              <SoftDeleteButton agentId={agent.id} onSuccess={refetchAll} />
            </div>
          )}
        </div>

        {/* 配额信息 grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5 mb-6 sm:mb-8">
          <QuotaCard
            label="调用次数（本周期）"
            used={agent.callsThisPeriod}
            quota={agent.callsQuotaPeriod}
            unit="次"
            sub={`周期起：${formatDateTime(agent.quotaPeriodStart)}`}
          />
          <QuotaCard
            label="知识库容量"
            used={agent.knowledgeBaseUsedMb}
            quota={agent.knowledgeBaseQuotaMb}
            unit="MB"
            sub={`已上传 ${knowledge.length} 个文件`}
          />
        </div>

        {/* 灵魂指令 */}
        <SystemCommandCard systemCommand={agent.systemCommand} />

        {/* Tabs：知识库 / 调用历史 / 测试调用 */}
        <Tabs defaultValue="kb" className="w-full">
          <TabsList className="bg-zinc-900 border border-amber-500/20 h-auto flex-wrap">
            <TabsTrigger
              value="kb"
              className="min-h-[44px] data-[state=active]:bg-amber-500 data-[state=active]:text-zinc-950"
            >
              <Database className="h-4 w-4 mr-1.5" />
              知识库 ({knowledge.length})
            </TabsTrigger>
            <TabsTrigger
              value="sessions"
              className="min-h-[44px] data-[state=active]:bg-amber-500 data-[state=active]:text-zinc-950"
            >
              <Clock className="h-4 w-4 mr-1.5" />
              调用历史 ({recentSessions.length})
            </TabsTrigger>
            <TabsTrigger
              value="test"
              className="min-h-[44px] data-[state=active]:bg-amber-500 data-[state=active]:text-zinc-950"
              disabled={!isActive}
            >
              <Play className="h-4 w-4 mr-1.5" />
              测试调用
            </TabsTrigger>
          </TabsList>

          <TabsContent value="kb" className="space-y-4 mt-4 sm:mt-6">
            <EnterpriseAgentKbUpload
              agentId={agent.id}
              usedMb={agent.knowledgeBaseUsedMb}
              quotaMb={agent.knowledgeBaseQuotaMb}
              disabled={!isActive}
              onUploaded={() => refetchAll()}
            />
            <KbList
              agentId={agent.id}
              knowledge={knowledge}
              onChanged={refetchAll}
            />
          </TabsContent>

          <TabsContent value="sessions" className="mt-4 sm:mt-6">
            <SessionsList sessions={recentSessions} />
          </TabsContent>

          <TabsContent value="test" className="mt-4 sm:mt-6">
            <TestQueryPanel
              agentId={agent.id}
              onSuccess={refetchAll}
              disabled={!isActive}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ─── 子组件：tier / status badge ──────────────────────────────────────────

function TierBadge({ tier }: { tier: string }) {
  if (tier === "pro") {
    return (
      <Badge className="bg-amber-500/20 text-amber-200 border border-amber-400/40">
        Pro
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-900/40 text-amber-200/90 border border-amber-700/40">
      Trial
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
        运行中
      </Badge>
    );
  }
  if (status === "expired") {
    return (
      <Badge className="bg-red-500/15 text-red-300 border border-red-500/30">
        已停用
      </Badge>
    );
  }
  return (
    <Badge className="bg-zinc-700/40 text-zinc-300 border border-zinc-600">
      已删除
    </Badge>
  );
}

// ─── 子组件：QuotaCard ─────────────────────────────────────────────────────

function QuotaCard({
  label,
  used,
  quota,
  unit,
  sub,
}: {
  label: string;
  used: number;
  quota: number;
  unit: string;
  sub: string;
}) {
  const pct = Math.min(100, Math.round((used / Math.max(1, quota)) * 100));
  return (
    <div className="rounded-xl border border-amber-500/20 bg-zinc-900/60 p-4 sm:p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs sm:text-sm text-zinc-400">{label}</span>
        <span className="text-sm sm:text-base font-semibold text-amber-300">
          {used} / {quota} {unit}
        </span>
      </div>
      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            pct < 80 ? "bg-amber-500" : "bg-red-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-zinc-500 mt-2">{sub}</p>
    </div>
  );
}

// ─── 子组件：灵魂指令卡（折叠） ────────────────────────────────────────────

function SystemCommandCard({ systemCommand }: { systemCommand: string }) {
  const [expanded, setExpanded] = useState(false);
  const tooLong = systemCommand.length > 600;

  return (
    <div className="rounded-xl border border-amber-500/20 bg-zinc-900/60 p-4 sm:p-5 mb-6 sm:mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm sm:text-base font-semibold text-amber-300 flex items-center gap-1.5">
          <Sparkles className="h-4 w-4" />
          灵魂指令
        </h2>
        {tooLong && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-zinc-400 hover:text-amber-300 inline-flex items-center gap-1 min-h-[32px]"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                折叠
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                展开全文（{systemCommand.length} 字）
              </>
            )}
          </button>
        )}
      </div>
      <pre
        className={cn(
          "text-xs sm:text-sm text-zinc-200 whitespace-pre-wrap font-mono leading-relaxed break-words overflow-x-auto",
          !expanded && tooLong && "max-h-[180px] overflow-hidden",
        )}
      >
        {systemCommand}
      </pre>
    </div>
  );
}

// ─── 子组件：KB 列表 ───────────────────────────────────────────────────────

interface KbItem {
  id: number;
  filename: string;
  gcsKey: string;
  fileSizeBytes: number;
  contentTextHash: string | null;
  extractedTextPreview: string | null;
  uploadedAt: string;
}

function KbList({
  agentId,
  knowledge,
  onChanged,
}: {
  agentId: number;
  knowledge: KbItem[];
  onChanged: () => void;
}) {
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const deleteMutation = trpc.enterpriseAgents.deleteKnowledge.useMutation({
    onSuccess: (data) => {
      toast.success(
        data
          ? `已删除知识库文件，回收 ${data.reclaimedMb} MB`
          : "已删除",
      );
      onChanged();
    },
    onError: (err) => toast.error(err.message),
    onSettled: () => setConfirmId(null),
  });

  if (knowledge.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 sm:p-8 text-center text-sm text-zinc-500">
        <FileText className="h-8 w-8 mx-auto mb-2 text-zinc-600" />
        还没有上传任何文档。拖拽 PDF / TXT / DOCX 到上方区域开始构建知识库。
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {knowledge.map((kb) => (
        <div
          key={kb.id}
          className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 rounded-lg border border-amber-500/15 bg-zinc-900/60 p-3 sm:p-4 hover:border-amber-500/30 transition-colors"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm sm:text-base text-zinc-100 font-medium truncate">
              <FileText className="inline h-4 w-4 mr-1.5 text-amber-400" />
              {kb.filename}
            </p>
            <p className="text-xs text-zinc-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
              <span>{formatBytes(kb.fileSizeBytes)}</span>
              <span>·</span>
              <span>上传于 {formatDateTime(kb.uploadedAt)}</span>
            </p>
            {kb.extractedTextPreview && (
              <p className="text-[11px] sm:text-xs text-zinc-500 mt-1.5 line-clamp-2 italic">
                {kb.extractedTextPreview}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirmId(kb.id)}
            className="min-h-[40px] w-full sm:w-auto text-red-300 hover:bg-red-500/10 hover:text-red-200 border border-red-500/20"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            删除
          </Button>
        </div>
      ))}

      <Dialog
        open={confirmId !== null}
        onOpenChange={(v) => !v && setConfirmId(null)}
      >
        <DialogContent className="bg-zinc-950 border-red-500/30 text-zinc-100 max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-300 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              确认删除该知识库文件？
            </DialogTitle>
            <DialogDescription className="text-zinc-400 text-xs sm:text-sm">
              该文件将从企业隔离存储中清除（GCS 对象 + DB 记录），同步释放配额。
              已发生的调用记录不受影响。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmId(null)}
              disabled={deleteMutation.isPending}
              className="min-h-[44px] text-zinc-300 hover:bg-zinc-800"
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (confirmId !== null) {
                  deleteMutation.mutate({ agentId, kbId: confirmId });
                }
              }}
              disabled={deleteMutation.isPending}
              className="min-h-[44px] bg-red-500 hover:bg-red-400 text-zinc-950 font-semibold"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "确认删除"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── 子组件：调用历史 ────────────────────────────────────────────────────

interface SessionItem {
  id: number;
  userQuery: string;
  durationMs: number | null;
  promptTokens: number | null;
  outputTokens: number | null;
  modelUsed: string | null;
  createdAt: string;
}

function SessionsList({ sessions }: { sessions: SessionItem[] }) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 sm:p-8 text-center text-sm text-zinc-500">
        <Clock className="h-8 w-8 mx-auto mb-2 text-zinc-600" />
        还没有调用记录。在「测试调用」Tab 跑第一次推演。
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((s) => (
        <div
          key={s.id}
          className="rounded-lg border border-amber-500/15 bg-zinc-900/60 p-3 sm:p-4"
        >
          <p className="text-sm sm:text-base text-zinc-100 line-clamp-2 break-words">
            {s.userQuery}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] sm:text-xs text-zinc-500">
            <span>{formatDateTime(s.createdAt)}</span>
            {s.modelUsed && <span>· {s.modelUsed}</span>}
            {s.durationMs !== null && <span>· {(s.durationMs / 1000).toFixed(1)}s</span>}
            {s.promptTokens !== null && <span>· in {s.promptTokens}t</span>}
            {s.outputTokens !== null && <span>· out {s.outputTokens}t</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── 子组件：测试调用面板 ──────────────────────────────────────────────────

function TestQueryPanel({
  agentId,
  onSuccess,
  disabled,
}: {
  agentId: number;
  onSuccess: () => void;
  disabled: boolean;
}) {
  const [userQuery, setUserQuery] = useState("");
  const [lastResult, setLastResult] = useState<string | null>(null);

  const executeMutation = trpc.enterpriseAgents.executeQuery.useMutation({
    onSuccess: (data) => {
      setLastResult(data.markdown);
      toast.success(
        `调用成功 · ${(data.durationMs / 1000).toFixed(1)}s · ${data.outputTokens ?? "?"} tokens`,
      );
      onSuccess();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const handleSubmit = () => {
    const trimmed = userQuery.trim();
    if (!trimmed) {
      toast.error("请输入提问内容");
      return;
    }
    executeMutation.mutate({ agentId, userQuery: trimmed });
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="rounded-xl border border-amber-500/20 bg-zinc-900/60 p-4 sm:p-5">
        <label
          htmlFor="test-query"
          className="block text-sm sm:text-base font-medium text-zinc-200 mb-2"
        >
          提问内容
        </label>
        <Textarea
          id="test-query"
          value={userQuery}
          onChange={(e) => setUserQuery(e.target.value)}
          rows={4}
          maxLength={10_000}
          placeholder="例：客户上周买了 X 产品，今天来投诉售后慢，按知识库 SOP 我应该怎么处理？"
          disabled={disabled || executeMutation.isPending}
          className="text-base sm:text-sm bg-zinc-950 border-zinc-700 focus-visible:border-amber-500"
        />
        <div className="mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
          <p className="text-xs text-zinc-500">
            {userQuery.length} / 10000 字
          </p>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={
              disabled || executeMutation.isPending || userQuery.trim().length === 0
            }
            className="min-h-[44px] w-full sm:w-auto bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold"
          >
            {executeMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                推演中...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-1.5" />
                执行调用
              </>
            )}
          </Button>
        </div>
      </div>

      {lastResult && (
        <div className="rounded-xl border border-amber-500/20 bg-zinc-900/40 p-4 sm:p-5">
          <h3 className="text-sm sm:text-base font-semibold text-amber-300 mb-3">
            推演结果（markdown）
          </h3>
          <ScrollArea className="max-h-[60vh]">
            <pre className="text-xs sm:text-sm text-zinc-200 whitespace-pre-wrap font-mono leading-relaxed break-words">
              {lastResult}
            </pre>
          </ScrollArea>
        </div>
      )}

      {disabled && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs sm:text-sm text-amber-200">
          Agent 当前不在运行状态，无法执行调用。
        </div>
      )}
    </div>
  );
}

// ─── 危险操作按钮：停用 / 软删除 ──────────────────────────────────────────

function ExpireButton({ agentId, onSuccess }: { agentId: number; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const expireMutation = trpc.enterpriseAgents.expireAgent.useMutation({
    onSuccess: () => {
      toast.success("Agent 已停用");
      setOpen(false);
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="min-h-[44px] border-amber-700/40 bg-amber-900/20 text-amber-200 hover:bg-amber-800/30 hover:text-amber-100"
      >
        <PauseCircle className="h-4 w-4 mr-1.5" />
        停用
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-zinc-950 border-amber-500/30 text-zinc-100 max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-amber-300 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              确认停用此 Agent？
            </DialogTitle>
            <DialogDescription className="text-zinc-400 text-xs sm:text-sm">
              停用后将无法再调用，但知识库 / 调用历史保留可查。试用期内已支付的费用不退还。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={expireMutation.isPending}
              className="min-h-[44px] text-zinc-300 hover:bg-zinc-800"
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => expireMutation.mutate({ agentId })}
              disabled={expireMutation.isPending}
              className="min-h-[44px] bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold"
            >
              {expireMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "确认停用"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SoftDeleteButton({
  agentId,
  onSuccess,
}: {
  agentId: number;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const deleteMutation = trpc.enterpriseAgents.softDeleteAgent.useMutation({
    onSuccess: () => {
      toast.success("Agent 已删除");
      setOpen(false);
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="min-h-[44px] border-red-700/40 bg-red-900/20 text-red-200 hover:bg-red-800/30 hover:text-red-100"
      >
        <Trash2 className="h-4 w-4 mr-1.5" />
        删除
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-zinc-950 border-red-500/30 text-zinc-100 max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-300 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              确认删除此 Agent？
            </DialogTitle>
            <DialogDescription className="text-zinc-400 text-xs sm:text-sm">
              删除后此 Agent 不再出现在列表中（默认隐藏），但会保留 90 天审计期供后续恢复。
              试用期内已支付的费用不退还。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={deleteMutation.isPending}
              className="min-h-[44px] text-zinc-300 hover:bg-zinc-800"
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => deleteMutation.mutate({ agentId })}
              disabled={deleteMutation.isPending}
              className="min-h-[44px] bg-red-500 hover:bg-red-400 text-zinc-950 font-semibold"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "确认删除"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

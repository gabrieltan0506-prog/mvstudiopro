import { useState, useRef, useEffect } from "react";
import { useLocation, useParams, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Loader2,
  ArrowLeft,
  Send,
  Building2,
  AlertTriangle,
  Bot,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { marked } from "marked";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  status: "sending" | "success" | "error";
  durationMs?: number;
  promptTokens?: number;
  outputTokens?: number;
  modelUsed?: string;
  errorMessage?: string;
};

export default function EnterpriseAgentPlayground() {
  const params = useParams<{ agentId: string }>();
  const agentId = Number(params.agentId);
  const [, navigate] = useLocation();

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ─── 1. 加载 Agent 信息（验证 owner + status） ─────────────────────────────
  const { data, isLoading, error } = trpc.enterpriseAgents.get.useQuery(
    { agentId },
    {
      retry: false,
      refetchOnWindowFocus: false,
    },
  );

  // 加载最近的 session 记录并转换为对话格式
  useEffect(() => {
    if (data?.recentSessions && messages.length === 0) {
      const historicalMessages: Message[] = [];
      // 从老到新排序以便按顺序追加
      [...data.recentSessions].reverse().forEach((session) => {
        const timestamp = new Date(session.createdAt);
        historicalMessages.push({
          id: `u-${session.id}`,
          role: "user",
          content: session.userQuery,
          timestamp,
          status: "success",
        });
        if (session.responseMarkdown) {
          historicalMessages.push({
            id: `a-${session.id}`,
            role: "assistant",
            content: session.responseMarkdown,
            timestamp,
            status: "success",
            durationMs: session.durationMs ?? undefined,
            promptTokens: session.promptTokens ?? undefined,
            outputTokens: session.outputTokens ?? undefined,
            modelUsed: session.modelUsed ?? undefined,
          });
        }
      });
      setMessages(historicalMessages);
    }
  }, [data?.recentSessions]);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // ─── 2. Mutation ─────────────────────────────────────────────────────────
  const executeMutation = trpc.enterpriseAgents.executeQuery.useMutation({
    onSuccess: (res, variables, context) => {
      // @ts-ignore
      const { tempId } = context as { tempId: string };
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === tempId
            ? {
                ...msg,
                content: res.markdown,
                status: "success",
                durationMs: res.durationMs,
                promptTokens: res.promptTokens ?? undefined,
                outputTokens: res.outputTokens ?? undefined,
              }
            : msg
        )
      );
    },
    onError: (err, variables, context) => {
      toast.error(err.message);
      // @ts-ignore
      const { tempId } = context as { tempId: string };
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === tempId
            ? { ...msg, status: "error", errorMessage: err.message }
            : msg
        )
      );
    },
    onMutate: (variables) => {
      // We will pass tempId via context by mutating a ref or tracking it externally if needed
      // Actually TRPC mutation context is returned from onMutate
      // We'll handle matching via a slightly different way since TRPC useMutation args order
    }
  });

  // Track the pending message IDs
  const pendingIdsRef = useRef<Record<string, string>>({});

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (data?.agent?.status !== "active") {
      toast.error("Agent 已停用或已删除，无法发起对话");
      return;
    }

    const tempId = `temp-${Date.now()}`;
    const userMsg: Message = {
      id: `u-${tempId}`,
      role: "user",
      content: trimmed,
      timestamp: new Date(),
      status: "success",
    };
    const assistantMsg: Message = {
      id: tempId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
      status: "sending",
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");

    // Store mapping for this request
    const reqKey = `${agentId}-${trimmed}`;
    pendingIdsRef.current[reqKey] = tempId;

    executeMutation.mutate(
      { agentId, userQuery: trimmed },
      {
        onSuccess: (res) => {
          const matchedTempId = pendingIdsRef.current[reqKey] || tempId;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === matchedTempId
                ? {
                    ...msg,
                    content: res.markdown,
                    status: "success",
                    durationMs: res.durationMs,
                    promptTokens: res.promptTokens ?? undefined,
                    outputTokens: res.outputTokens ?? undefined,
                  }
                : msg
            )
          );
          delete pendingIdsRef.current[reqKey];
        },
        onError: (err) => {
          const matchedTempId = pendingIdsRef.current[reqKey] || tempId;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === matchedTempId
                ? { ...msg, status: "error", errorMessage: err.message }
                : msg
            )
          );
          delete pendingIdsRef.current[reqKey];
        }
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ─── 渲染 ────────────────────────────────────────────────────────────────
  if (!Number.isInteger(agentId) || agentId <= 0) {
    return <div className="p-8 text-zinc-400">无效的 agentId</div>;
  }
  if (isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-8 text-red-400 flex flex-col items-start gap-4 bg-zinc-950 min-h-dvh">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          {error?.message || "无法加载 Agent 信息"}
        </div>
        <Button variant="outline" onClick={() => navigate("/enterprise-agent")}>
          返回列表
        </Button>
      </div>
    );
  }

  const agent = data.agent;
  const isActive = agent.status === "active";

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 text-zinc-100 font-sans">
      {/* 顶栏 */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-amber-500/20 px-4 sm:px-6 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link href={`/enterprise-agent/${agent.id}`}>
            <a className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </a>
          </Link>
          <div className="flex flex-col">
            <h1 className="text-base sm:text-lg font-bold text-amber-300 flex items-center gap-2">
              <Bot className="h-5 w-5" />
              {agent.agentName}
              <Badge variant="outline" className="ml-2 border-amber-500/30 text-amber-200/80 text-[10px] uppercase tracking-wider py-0 px-1.5 h-5">
                Playground
              </Badge>
            </h1>
            {agent.organizationName && (
              <div className="flex items-center text-xs text-zinc-500 gap-1.5">
                <Building2 className="h-3 w-3" />
                {agent.organizationName}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isActive ? (
            <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">运行中</Badge>
          ) : (
            <Badge className="bg-red-500/15 text-red-300 border border-red-500/30">已停用</Badge>
          )}
        </div>
      </header>

      {/* 聊天记录区 */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6" ref={scrollRef}>
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-20 opacity-60">
              <Bot className="h-12 w-12 text-amber-500 mb-4" />
              <h2 className="text-xl font-bold text-zinc-200 mb-2">开始与您的企业专属 Agent 对话</h2>
              <p className="text-sm text-zinc-400 max-w-md">
                它已掌握您上传的 <strong>{data.knowledge.length}</strong> 份知识库文档，
                并受制于您设定的灵魂指令。
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex gap-4",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {msg.role === "assistant" && (
                  <div className="h-8 w-8 shrink-0 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
                    <Bot className="h-5 w-5 text-amber-400" />
                  </div>
                )}
                
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl p-4 sm:p-5 shadow-sm",
                    msg.role === "user"
                      ? "bg-zinc-800 text-zinc-100 rounded-tr-sm"
                      : "bg-zinc-900/60 border border-amber-500/20 text-zinc-200 rounded-tl-sm"
                  )}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm prose-invert prose-amber max-w-none">
                      {msg.status === "sending" ? (
                        <div className="flex items-center gap-2 text-amber-500/70">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          推演中...
                        </div>
                      ) : msg.status === "error" ? (
                        <div className="text-red-400 flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4" />
                          {msg.errorMessage || "生成失败"}
                        </div>
                      ) : (
                        <>
                          <div dangerouslySetInnerHTML={{ __html: marked.parse(msg.content, { breaks: true, gfm: true }) }} />
                          {msg.durationMs !== undefined && (
                            <div className="mt-4 pt-3 border-t border-amber-500/10 flex items-center gap-4 text-[11px] text-zinc-500 font-mono">
                              <span>{(msg.durationMs / 1000).toFixed(1)}s</span>
                              {msg.promptTokens && msg.outputTokens && (
                                <span>{msg.promptTokens} in / {msg.outputTokens} out</span>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap text-sm sm:text-base">{msg.content}</div>
                  )}
                </div>

                {msg.role === "user" && (
                  <div className="h-8 w-8 shrink-0 rounded-full bg-zinc-700 flex items-center justify-center">
                    <User className="h-5 w-5 text-zinc-300" />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 输入区 */}
      <div className="shrink-0 p-4 sm:p-6 bg-zinc-950 border-t border-amber-500/20">
        <div className="max-w-4xl mx-auto relative flex items-end gap-2 sm:gap-4">
          <div className="flex-1 relative">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isActive ? "输入提问，Shift + Enter 换行" : "Agent 当前不在运行状态，无法执行调用"}
              disabled={!isActive || executeMutation.isPending}
              className="min-h-[56px] sm:min-h-[64px] max-h-48 resize-none bg-zinc-900 border-zinc-700 focus-visible:border-amber-500 rounded-xl pr-14 text-base sm:text-sm py-3 sm:py-4 shadow-inner"
              maxLength={10_000}
            />
            {input.length > 8000 && (
              <span className="absolute right-3 bottom-3 text-[10px] text-amber-500/70 pointer-events-none">
                {input.length}/10k
              </span>
            )}
          </div>
          <Button
            type="button"
            onClick={handleSend}
            disabled={!isActive || executeMutation.isPending || input.trim().length === 0}
            size="icon"
            className="h-14 w-14 sm:h-16 sm:w-16 shrink-0 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 shadow-lg shadow-amber-500/20 transition-all active:scale-95"
          >
            {executeMutation.isPending ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <Send className="h-6 w-6" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// @ts-nocheck
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Shield, DollarSign, Users, FileCheck, TrendingUp, CheckCircle, XCircle, Clock, Loader2, Copy, KeyRound, RefreshCw, Eraser } from "lucide-react";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";

const SUPERVISOR_KEY = "mvs-supervisor-access";
const SUPERVISOR_REAP_TOKEN_KEY = "mvs-supervisor-reap-token";

function checkSupervisorUrl(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("supervisor") === "1") {
    localStorage.setItem(SUPERVISOR_KEY, "1");
    return true;
  }
  return localStorage.getItem(SUPERVISOR_KEY) === "1";
}

export default function AdminPanel() {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const isSupervisorUrl = checkSupervisorUrl();
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [verifications, setVerifications] = useState<any[]>([]);

  // ── 邀请码生成 state ────────────────────────────────────────────
  const [codeCount, setCodeCount] = useState("5");
  const [codeCredits, setCodeCredits] = useState("200");
  const [codeMaxUses, setCodeMaxUses] = useState("1");
  const [codeNote, setCodeNote] = useState("");
  const [codeExpireDays, setCodeExpireDays] = useState("30");
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const [verificationActingUserId, setVerificationActingUserId] = useState<number | null>(null);
  const [supervisorReapToken, setSupervisorReapToken] = useState("");

  const isAdminOrSupervisor = isSupervisorUrl || (isAuthenticated && (user?.role === "admin" || user?.role === "supervisor"));
  const isAdminOnly = isAuthenticated && (user?.role === "admin" || user?.role === "supervisor");

  // ── 所有 hooks 必须在 conditional return 之前 ──
  const myCodesList = trpc.betaCode.listMine.useQuery(undefined, { enabled: isAdminOrSupervisor });
  const { data: stats } = trpc.admin.stats.useQuery(undefined, { enabled: isAdminOnly });
  const { data: creditBreakdown } = trpc.admin.creditBreakdown.useQuery(undefined, { enabled: isAdminOnly });
  const { data: payments, refetch: refetchPayments } = trpc.admin.paymentList.useQuery({ status: "pending" }, { enabled: isAdminOnly });
  const { data: betaQuotas, refetch: refetchBeta } = trpc.admin.betaList.useQuery(undefined, { enabled: isAdminOnly });
  const { data: teams } = trpc.admin.teamList.useQuery(undefined, { enabled: isAdminOnly });

  const { data: runtimeMx, isFetching: runtimeMxFetching, refetch: refetchRuntimeMx } =
    trpc.admin.runtimeMetricsOverview.useQuery(
      { tail: 480 },
      { enabled: isAdminOrSupervisor, refetchInterval: 14000 },
    );

  const reapNeonJobsMutation = trpc.admin.reapStaleNeonJobs.useMutation({
    onSuccess: (data) => {
      toast.success(
        `已清理過期佇列任務：刪除 running ${data.runningCleared} 條、queued ${data.queuedCleared} 條（規則與後台定時 reaper 一致）`,
      );
    },
    onError: (err) => toast.error(err.message || "清理失敗"),
  });

  const generateCodesMutation = trpc.betaCode.generate.useMutation({
    onSuccess: (data) => {
      setGeneratedCodes(data.codes);
      toast.success(`成功生成 ${data.count} 个内测码`);
      myCodesList.refetch();
      setTimeout(() => myCodesList.refetch(), 1200);
    },
    onError: (err) => toast.error(err.message || "生成失败"),
  });

  const reviewPayment = trpc.admin.paymentReview.useMutation({
    onSuccess: () => { toast.success("审核完成"); refetchPayments(); },
    onError: () => toast.error("操作失败"),
  });

  const reviewBeta = trpc.admin.betaGrant.useMutation({
    onSuccess: () => { toast.success("审核完成"); refetchBeta(); },
    onError: () => toast.error("操作失败"),
  });

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 1500);
    });
  }

  const fetchVerifications = async () => {
    if (!isAuthenticated || user?.role !== "admin") return;
    setVerificationLoading(true);
    try {
      const res = await fetch("/api/admin/verifications", { method: "GET", credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "获取失败");
      setVerifications(Array.isArray(data.items) ? data.items : []);
    } catch (error: any) {
      toast.error(error?.message || "获取认证申请失败");
    } finally {
      setVerificationLoading(false);
    }
  };

  const reviewVerification = async (userId: number, action: "approve" | "reject") => {
    setVerificationActingUserId(userId);
    try {
      const res = await fetch(`/api/admin/verifications/${userId}/${action}`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "操作失败");
      toast.success(action === "approve" ? "已通过并发放 +20 积分" : "已拒绝");
      await fetchVerifications();
    } catch (error: any) {
      toast.error(error?.message || "操作失败");
    } finally {
      setVerificationActingUserId(null);
    }
  };

  // ── useEffect 必须在所有 conditional return 之前 ──
  useEffect(() => {
    void fetchVerifications();
  }, [isAuthenticated, user?.role]);

  useEffect(() => {
    try {
      const v = sessionStorage.getItem(SUPERVISOR_REAP_TOKEN_KEY);
      if (v) setSupervisorReapToken(v);
    } catch {
      /* ignore */
    }
  }, []);

  const isSupervisorOnly = isAuthenticated && user?.role === "supervisor";
  const canReapNeonJobs =
    isAdminOnly || (isSupervisorUrl && supervisorReapToken.trim().length > 0);

  // Redirect non-admin / non-supervisor（supervisor URL bypass 例外）
  if (!isSupervisorUrl && isAuthenticated && user?.role !== "admin" && user?.role !== "supervisor") {
    return (
      <div className="min-h-dvh bg-background text-foreground">
        <Navbar />
        <div className="pt-32 text-center container">
          <Shield className="h-16 w-16 text-red-400 mx-auto mb-6" />
          <h1 className="text-3xl font-bold mb-4">无权限访问</h1>
          <p className="text-muted-foreground mb-8">此页面仅限管理员访问</p>
          <Button onClick={() => navigate("/")}>返回首页</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <Navbar />
      <div className="pt-24 pb-16 container max-w-6xl">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold">管理后台</h1>
          </div>
          <p className="text-muted-foreground">用户与活跃、付款审核、财务监控、团队统计、内测与定价</p>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          {[
            { label: "总用户数", value: stats?.totalUsers ?? 0, icon: Users, color: "text-blue-400" },
            { label: "今日新注册", value: stats?.newUsersToday ?? 0, icon: Users, color: "text-cyan-400" },
            { label: "日活 DAU", value: stats?.dau ?? 0, icon: TrendingUp, color: "text-emerald-400" },
            { label: "近7日活跃 WAU", value: stats?.wau7 ?? 0, icon: TrendingUp, color: "text-green-400" },
            { label: "近30日活跃 MAU", value: stats?.mau30 ?? 0, icon: TrendingUp, color: "text-lime-400" },
            { label: "活跃团队", value: stats?.totalTeams ?? 0, icon: TrendingUp, color: "text-primary" },
            { label: "待审 Beta 配额条数", value: stats?.totalBetaQuotas ?? 0, icon: Clock, color: "text-yellow-400" },
            { label: "总收入（占位）", value: `¥0`, icon: DollarSign, color: "text-green-400" },
          ].map(item => (
            <Card key={item.label} className="bg-card/50 border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <item.icon className={`h-5 w-5 ${item.color}`} />
                </div>
                <div className="text-2xl font-bold">{item.value}</div>
                <div className="text-xs text-muted-foreground">{item.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {stats?.usersByRole && Object.keys(stats.usersByRole).length > 0 ? (
          <Card className="mb-8 bg-card/50 border-border/50">
            <CardHeader className="py-3"><CardTitle className="text-sm font-medium">用户角色分布</CardTitle></CardHeader>
            <CardContent className="pt-0 flex flex-wrap gap-3 text-sm">
              {Object.entries(stats.usersByRole).map(([role, n]) => (
                <span key={role} className="rounded-md border border-border/60 px-2 py-1 bg-background/40">
                  <span className="text-muted-foreground">{role}</span>
                  <span className="ml-1 font-semibold">{n}</span>
                </span>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Tabs defaultValue={isSupervisorOnly ? "invite-codes" : "payments"} className="space-y-6">
          <TabsList className="bg-card/50 border border-border/50 flex flex-wrap gap-1">
            {!isSupervisorOnly && <TabsTrigger value="payments">付款审核</TabsTrigger>}
            {!isSupervisorOnly && <TabsTrigger value="finance">财务监控</TabsTrigger>}
            {!isSupervisorOnly && <TabsTrigger value="teams">团队统计</TabsTrigger>}
            {!isSupervisorOnly && <TabsTrigger value="beta">Beta 审核</TabsTrigger>}
            {!isSupervisorOnly && <TabsTrigger value="verifications">身份认证</TabsTrigger>}
            <TabsTrigger value="invite-codes">邀请码</TabsTrigger>
            {isAdminOrSupervisor ? <TabsTrigger value="runtime-metrics">运维打点</TabsTrigger> : null}
            {!isSupervisorOnly && <TabsTrigger value="credit-pricing">定价明细</TabsTrigger>}
          </TabsList>

          {/* Payments Tab */}
          <TabsContent value="payments">
            <Card className="bg-card/50 border-border/50">
              <CardHeader><CardTitle>待审核付款</CardTitle></CardHeader>
              <CardContent>
                {(!payments || payments.length === 0) ? (
                  <div className="text-center py-8 text-muted-foreground">暂无待审核付款</div>
                ) : (
                  <div className="space-y-3">
                    {payments.map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between p-4 rounded-lg bg-background/30">
                        <div className="flex items-center gap-4">
                          {p.screenshotUrl && (
                            <img src={p.screenshotUrl} alt="截图" className="w-12 h-12 rounded object-cover" />
                          )}
                          <div>
                            <div className="text-sm font-medium">用户 #{p.userId} · {p.packageType}</div>
                            <div className="text-xs text-muted-foreground">金额：¥{p.amount} · {new Date(p.createdAt).toLocaleDateString("zh-CN")}</div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 gap-1"
                            disabled={reviewPayment.isPending}
                            onClick={() => reviewPayment.mutate({ id: p.id, status: "approved" })}
                          >
                            <CheckCircle className="h-3.5 w-3.5" /> 通过
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg- text-red-400 border-red-400/30 hover:bg-red-400/10 gap-1"
                            disabled={reviewPayment.isPending}
                            onClick={() => reviewPayment.mutate({ id: p.id, status: "rejected" })}
                          >
                            <XCircle className="h-3.5 w-3.5" /> 拒绝
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Finance Tab */}
          <TabsContent value="finance">
            <Card className="bg-card/50 border-border/50">
              <CardHeader><CardTitle>财务概览</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="p-4 rounded-lg bg-background/30 text-center">
                    <DollarSign className="h-8 w-8 text-green-400 mx-auto mb-2" />
                    <div className="text-2xl font-bold">¥0</div>
                    <div className="text-xs text-muted-foreground">总收入</div>
                  </div>
                  <div className="p-4 rounded-lg bg-background/30 text-center">
                    <TrendingUp className="h-8 w-8 text-blue-400 mx-auto mb-2" />
                    <div className="text-2xl font-bold">0</div>
                    <div className="text-xs text-muted-foreground">专业版用户</div>
                  </div>
                  <div className="p-4 rounded-lg bg-background/30 text-center">
                    <Users className="h-8 w-8 text-purple-400 mx-auto mb-2" />
                    <div className="text-2xl font-bold">0</div>
                    <div className="text-xs text-muted-foreground">企业版用户</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Teams Tab */}
          <TabsContent value="teams">
            <Card className="bg-card/50 border-border/50">
              <CardHeader><CardTitle>团队列表</CardTitle></CardHeader>
              <CardContent>
                {(!teams || teams.length === 0) ? (
                  <div className="text-center py-8 text-muted-foreground">暂无团队</div>
                ) : (
                  <div className="space-y-3">
                    {teams.map((t: any) => (
                      <div key={t.id} className="flex items-center justify-between p-4 rounded-lg bg-background/30">
                        <div>
                          <div className="text-sm font-medium">{t.name}</div>
                          <div className="text-xs text-muted-foreground">创建者：用户 #{t.ownerId} · {new Date(t.createdAt).toLocaleDateString("zh-CN")}</div>
                        </div>
                        <div className="text-sm text-muted-foreground">邀请码：{t.inviteCode}</div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Beta Tab */}
          <TabsContent value="beta">
            <Card className="bg-card/50 border-border/50">
              <CardHeader><CardTitle>Beta 功能申请</CardTitle></CardHeader>
              <CardContent>
                {(!betaQuotas || betaQuotas.length === 0) ? (
                  <div className="text-center py-8 text-muted-foreground">暂无 Beta 申请</div>
                ) : (
                  <div className="space-y-3">
                    {betaQuotas.map((b: any) => (
                      <div key={b.id} className="flex items-center justify-between p-4 rounded-lg bg-background/30">
                        <div>
                          <div className="text-sm font-medium">用户 #{b.userId} · {b.featureType}</div>
                          <div className="text-xs text-muted-foreground">
                            配额：{b.quota} · 状态：{b.status === "approved" ? "已通过" : b.status === "rejected" ? "已拒绝" : "待审核"}
                          </div>
                        </div>
                        {b.status === "pending" && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-700 gap-1"
                              disabled={reviewBeta.isPending}
                              onClick={() => reviewBeta.mutate({ userId: b.userId, totalQuota: b.quota ?? 20 })}
                            >
                              <CheckCircle className="h-3.5 w-3.5" /> 通过
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="bg- text-red-400 border-red-400/30 gap-1"
                              disabled={reviewBeta.isPending}
                              onClick={() => toast.info("已跳过")}
                            >
                              <XCircle className="h-3.5 w-3.5" /> 拒绝
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Identity Verification Tab */}
          <TabsContent value="verifications">
            <Card className="bg-card/50 border-border/50">
              <CardHeader><CardTitle>待确认身份认证</CardTitle></CardHeader>
              <CardContent>
                {verificationLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : verifications.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">暂无待确认认证</div>
                ) : (
                  <div className="space-y-3">
                    {verifications.map((item: any) => (
                      <div key={item.id} className="flex items-center justify-between p-4 rounded-lg bg-background/30">
                        <div>
                          <div className="text-sm font-medium">
                            用户 #{item.id} · {item.email || "无邮箱"} · {item.roleTag}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            微信：{item.contactWechat || "-"} · 电话：{item.contactPhone || "-"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            当前积分：{item.credits}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 gap-1"
                            disabled={verificationActingUserId === item.id}
                            onClick={() => reviewVerification(item.id, "approve")}
                          >
                            <CheckCircle className="h-3.5 w-3.5" /> 通过
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-400 border-red-400/30 hover:bg-red-400/10 gap-1"
                            disabled={verificationActingUserId === item.id}
                            onClick={() => reviewVerification(item.id, "reject")}
                          >
                            <XCircle className="h-3.5 w-3.5" /> 拒绝
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 單進程緩存指標 · 不重啟不累積 */}
          <TabsContent value="runtime-metrics" className="space-y-4">
            <Card className="bg-card/50 border-amber-500/25 border">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Eraser className="h-5 w-5 text-amber-400" />
                  異步佇列殭屍清理（Neon jobs）
                </CardTitle>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="gap-1.5"
                  disabled={!canReapNeonJobs || reapNeonJobsMutation.isPending}
                  onClick={() =>
                    reapNeonJobsMutation.mutate(
                      isAdminOnly ? undefined : { supervisorToken: supervisorReapToken.trim() },
                    )
                  }
                >
                  {reapNeonJobsMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Eraser className="h-3.5 w-3.5" />
                  )}
                  一鍵清理過期任務
                </Button>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                {isSupervisorUrl && !isAdminOnly ? (
                  <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-1.5">
                    <label className="text-[11px] text-amber-200/90 font-medium block">
                      Supervisor 密钥（與生成邀請碼相同 <span className="font-mono">SUPERVISOR_SECRET</span>，免登入）
                    </label>
                    <input
                      type="password"
                      autoComplete="off"
                      placeholder="貼上後再點「一鍵清理」"
                      value={supervisorReapToken}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSupervisorReapToken(v);
                        try {
                          sessionStorage.setItem(SUPERVISOR_REAP_TOKEN_KEY, v);
                        } catch {
                          /* ignore */
                        }
                      }}
                      className="w-full max-w-md bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground font-mono"
                    />
                  </div>
                ) : null}
                <p>
                  對資料庫 <span className="font-mono text-foreground/80">jobs</span> 表執行與伺服器定時 reaper
                  <strong className="text-foreground/90"> 相同條件 </strong>的 <strong className="text-foreground/90">DELETE</strong>
                  ：久未認領的 <span className="font-mono">queued</span>、以及 <span className="font-mono">running</span> 但{" "}
                  <span className="font-mono">updatedAt</span> 長時間未更新的列（有進度的長任務不會誤刪）。
                  戰略深研狀態不在此表，不受此按鈕影響。此按鈕為<strong className="text-foreground/90"> 手動強制 </strong>
                  執行，即使已設定 <span className="font-mono">DISABLE_JOBS_STALE_REAPER</span> 關閉自動掃描也會刪除符合條件的列。
                </p>
                {!isAdminOnly ? (
                  <p className="text-amber-200/90">請使用已登入的 Admin / Supervisor 帳號操作。</p>
                ) : null}
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/50">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-lg">運維打點（本進程）</CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={runtimeMxFetching}
                  onClick={() => void refetchRuntimeMx()}
                >
                  {runtimeMxFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  刷新
                </Button>
              </CardHeader>
              <CardContent className="space-y-3 text-xs text-muted-foreground">
                <p>
                  · 資料僅保存在當前 Node 進程記憶體，<span className="text-foreground/90 font-medium">部署重啟即清空</span>。
                  <br />· 聚合含：趨勢報表 generator（visual.report）、生圖管線 GPT54 / 合成成功次數等。
                </p>
                {runtimeMx?.meta ? (
                  <div className="rounded-md border border-border/50 bg-background/40 px-3 py-2 font-mono text-[11px] text-foreground/80">
                    procStartISO={runtimeMx.meta.procStartIso} · buffer={runtimeMx.meta.totalRows}/{runtimeMx.meta.cap} rows
                    {runtimeMx.meta.dropped ? ` · dropped=${runtimeMx.meta.dropped}` : ""}
                  </div>
                ) : null}
                {runtimeMx?.rollup ? (
                  <div className="rounded-lg border border-border/40 bg-black/35 p-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-cyan-300/90">
                      rollup（全缓冲）
                    </div>
                    <pre className="max-h-[14rem] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-emerald-100/95">
                      {JSON.stringify(runtimeMx.rollup, null, 2)}
                    </pre>
                  </div>
                ) : null}
                <div className="rounded-lg border border-border/40 bg-black/35 p-3">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-200/85">
                    recent（時間正序尾部）
                  </div>
                  {runtimeMx?.recent?.length ? (
                    <pre className="max-h-[22rem] overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-sky-50/92">
                      {JSON.stringify(runtimeMx.recent, null, 2)}
                    </pre>
                  ) : (
                    <div className="text-muted-foreground">尚无打点；跑一次「趋势报表生成器」或平台生图后即会出现。</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Invite Codes Tab */}
          <TabsContent value="invite-codes" className="space-y-6">
            {/* 生成表单 */}
            <Card className="bg-card/50 border-border/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-primary" />
                  生成内测邀请码
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 产品包快捷预设（点一下自动填积分 + 备注） */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { id: "trial", title: "💰 单次体验包", price: "560",   credits: "800",   desc: "适合测试水温。可执行 1 次深潜。",   color: "#8cefff" },
                    { id: "biz",   title: "💼 主力商务包", price: "2,800", credits: "4000",  desc: "锚定企业日常需求。可执行 5 次。",   color: "#ffdd44" },
                    { id: "org",   title: "👑 机构大户包", price: "8,400", credits: "12000", desc: "针对矩阵号。可执行 15 次。",        color: "#ff7fd5" },
                  ].map((pkg) => {
                    const isActive = codeCredits === pkg.credits;
                    return (
                      <button
                        type="button"
                        key={pkg.id}
                        onClick={() => { setCodeCredits(pkg.credits); setCodeNote(pkg.title); }}
                        className={`p-4 rounded-xl border text-left transition cursor-pointer ${
                          isActive ? "border-white/30 bg-white/[0.07] shadow-[0_0_0_1px_rgba(255,255,255,0.08)]" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                        }`}
                      >
                        <div style={{ color: pkg.color }} className="text-sm font-bold mb-1">{pkg.title}</div>
                        <div className="text-xl font-black text-white">¥{pkg.price} <span className="text-[10px] text-gray-400">/ {pkg.credits} 分</span></div>
                        <div className="text-[10px] text-gray-500 mt-2 leading-relaxed">{pkg.desc}</div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground -mt-1">
                  · 点击产品包自动填入「Credits」与「备注」 · 也可手动调整下面字段。
                </p>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">生成数量</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={codeCount}
                      onChange={(e) => setCodeCount(e.target.value)}
                      className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Credits / 每码</label>
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={codeCredits}
                      onChange={(e) => setCodeCredits(e.target.value)}
                      className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">最大兑换次数</label>
                    <input
                      type="number"
                      min={1}
                      value={codeMaxUses}
                      onChange={(e) => setCodeMaxUses(e.target.value)}
                      className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">有效天数</label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={codeExpireDays}
                      onChange={(e) => setCodeExpireDays(e.target.value)}
                      className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">备注（选填）</label>
                  <input
                    type="text"
                    maxLength={120}
                    placeholder="例：内测第一批 / 合作伙伴专属"
                    value={codeNote}
                    onChange={(e) => setCodeNote(e.target.value)}
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground"
                  />
                </div>
                <Button
                  className="w-full gap-2"
                  disabled={generateCodesMutation.isPending}
                  onClick={() =>
                    generateCodesMutation.mutate({
                      count: Math.max(1, Math.min(100, parseInt(codeCount) || 1)),
                      credits: Math.max(1, parseInt(codeCredits) || 200),
                      maxUses: Math.max(1, parseInt(codeMaxUses) || 1),
                      note: codeNote.trim() || undefined,
                      expiresInDays: Math.max(1, parseInt(codeExpireDays) || 30),
                    })
                  }
                >
                  {generateCodesMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  生成邀请码
                </Button>

                {/* 刚生成的码 */}
                {generatedCodes.length > 0 && (
                  <div className="mt-4 rounded-xl border border-green-500/30 bg-green-500/5 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-green-400">
                        ✓ 已生成 {generatedCodes.length} 个邀请码（点击单个复制）
                      </p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(generatedCodes.join("\n"));
                          toast.success("已复制全部邀请码");
                        }}
                        className="text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors"
                      >
                        复制全部
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {generatedCodes.map((code) => (
                        <button
                          key={code}
                          onClick={() => copyCode(code)}
                          className="flex items-center justify-between bg-background border border-border rounded-lg px-4 py-2.5 font-mono text-base font-bold text-foreground hover:border-primary/60 transition-colors"
                        >
                          <span className="tracking-widest">{code}</span>
                          {copiedCode === code ? (
                            <CheckCircle className="h-4 w-4 text-green-400 ml-2 shrink-0" />
                          ) : (
                            <Copy className="h-4 w-4 text-muted-foreground ml-2 shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 历史码列表 */}
            <Card className="bg-card/50 border-border/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>已生成的邀请码</CardTitle>
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => myCodesList.refetch()}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    刷新
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {myCodesList.isPending ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
                ) : !myCodesList.data || myCodesList.data.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">暂无邀请码</div>
                ) : (
                  <div className="space-y-2">
                    {myCodesList.data.map((row: any) => (
                      <div key={row.id} className="flex items-center justify-between bg-background/30 rounded-lg px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-sm text-foreground">{row.code}</span>
                            <span className="text-xs text-muted-foreground">{row.credits} Credits</span>
                            {row.note && <span className="text-xs text-muted-foreground truncate">· {row.note}</span>}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            已用 {row.usedCount}/{row.maxUses === -1 ? "∞" : row.maxUses}
                            {row.expiresAt ? ` · 有效至 ${new Date(row.expiresAt).toLocaleDateString("zh-CN")}` : " · 永不过期"}
                          </div>
                        </div>
                        <button
                          onClick={() => copyCode(row.code)}
                          className="ml-3 p-1.5 rounded hover:bg-white/5 transition-colors"
                        >
                          {copiedCode === row.code ? (
                            <CheckCircle className="h-4 w-4 text-green-400" />
                          ) : (
                            <Copy className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="credit-pricing" className="space-y-4">
            <Card className="bg-card/50 border-border/50">
              <CardHeader>
                <CardTitle>产品包定价（对外口径）</CardTitle>
                <p className="text-sm text-muted-foreground">
                  以 <strong>积分加值包</strong> 为准展示 Credits 与套餐标价；不在此给出「积分⇄人民币」折算。实际扣费由服务端 <code className="text-xs">CREDIT_COSTS</code> 执行。
                </p>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {creditBreakdown?.packages && creditBreakdown.packages.length > 0 ? (
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-border/60 text-left text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">类别</th>
                        <th className="py-2 pr-3 font-medium">名称</th>
                        <th className="py-2 pr-3 font-medium">Credits</th>
                        <th className="py-2 pr-3 font-medium">标价（¥）</th>
                        <th className="py-2 pr-3 font-medium">摘要 / 包含</th>
                      </tr>
                    </thead>
                    <tbody>
                      {creditBreakdown.packages.map((row, i) => (
                          <tr key={i} className="border-b border-border/30 hover:bg-background/20">
                            <td className="py-2 pr-3 align-top whitespace-nowrap">{row.category}</td>
                            <td className="py-2 pr-3 align-top font-medium">{row.name}</td>
                            <td className="py-2 pr-3 align-top font-mono">{row.credits ?? "—"}</td>
                            <td className="py-2 pr-3 align-top">
                              {row.priceCny != null ? (
                                <span>¥{Number.isInteger(row.priceCny) ? row.priceCny : row.priceCny.toFixed(1)}</span>
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </td>
                            <td className="py-2 align-top text-xs text-muted-foreground max-w-md">
                              <div>{row.summary}</div>
                              {row.bullets?.length ? (
                                <ul className="list-disc pl-4 mt-1 space-y-0.5">
                                  {row.bullets.map((b) => (
                                    <li key={b}>{b}</li>
                                  ))}
                                </ul>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">加载中或暂无数据</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

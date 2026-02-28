// @ts-nocheck
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Shield, DollarSign, Users, FileCheck, TrendingUp, CheckCircle, XCircle, Clock, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";

export default function AdminPanel() {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [verifications, setVerifications] = useState<any[]>([]);
  const [verificationActingUserId, setVerificationActingUserId] = useState<number | null>(null);

  // Redirect non-admin
  if (isAuthenticated && user?.role !== "admin") {
    return (
      <div className="min-h-screen bg-background text-foreground">
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

  const { data: stats } = trpc.admin.stats.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin" });
  const { data: payments, refetch: refetchPayments } = trpc.admin.paymentList.useQuery({ status: "pending" }, { enabled: isAuthenticated && user?.role === "admin" });
  const { data: betaQuotas, refetch: refetchBeta } = trpc.admin.betaList.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin" });
  const { data: teams } = trpc.admin.teamList.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin" });

  const reviewPayment = trpc.admin.paymentReview.useMutation({
    onSuccess: () => { toast.success("审核完成"); refetchPayments(); },
    onError: () => toast.error("操作失败"),
  });

  const reviewBeta = trpc.admin.betaGrant.useMutation({
    onSuccess: () => { toast.success("审核完成"); refetchBeta(); },
    onError: () => toast.error("操作失败"),
  });

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

  useEffect(() => {
    void fetchVerifications();
  }, [isAuthenticated, user?.role]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <div className="pt-24 pb-16 container max-w-6xl">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold">管理后台</h1>
          </div>
          <p className="text-muted-foreground">付款审核、财务监控、团队统计、Beta 功能审核</p>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: "总用户数", value: stats?.totalUsers ?? 0, icon: Users, color: "text-blue-400" },
            { label: "总收入", value: `¥0`, icon: DollarSign, color: "text-green-400" },
            { label: "待审核付款", value: stats?.totalBetaQuotas ?? 0, icon: Clock, color: "text-yellow-400" },
            { label: "活跃团队", value: stats?.teams ?? 0, icon: TrendingUp, color: "text-primary" },
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

        <Tabs defaultValue="payments" className="space-y-6">
          <TabsList className="bg-card/50 border border-border/50">
            <TabsTrigger value="payments">付款审核</TabsTrigger>
            <TabsTrigger value="finance">财务监控</TabsTrigger>
            <TabsTrigger value="teams">团队统计</TabsTrigger>
            <TabsTrigger value="beta">Beta 审核</TabsTrigger>
            <TabsTrigger value="verifications">身份认证</TabsTrigger>
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
        </Tabs>
      </div>
    </div>
  );
}

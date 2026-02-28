// @ts-nocheck
import Navbar from "@/components/Navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useEffect } from "react";
import { Loader2, Receipt, ExternalLink, CreditCard, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

export default function PaymentHistory() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { data: payments, isLoading } = trpc.stripe.getInvoices.useQuery(undefined, { enabled: isAuthenticated });
  const { data: status } = trpc.stripe.getSubscription.useQuery(undefined, { enabled: isAuthenticated });

  useEffect(() => {
    document.title = "支付记录 - MV Studio Pro";
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="pt-24 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="pt-24 pb-16 container max-w-2xl text-center">
          <Receipt className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-3">查看支付记录</h1>
          <p className="text-muted-foreground mb-6">请先登录以查看您的支付历史</p>
          <Button onClick={() => { window.location.href = getLoginUrl(); }}>登录</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <div className="pt-24 pb-16 container max-w-4xl">
        <div className="flex items-center gap-3 mb-8">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">支付记录</h1>
            <p className="text-sm text-muted-foreground">查看您的所有交易历史</p>
          </div>
        </div>

        {/* Current Plan */}
        {status && (
          <Card className="bg-card/50 border-border/50 mb-8">
            <CardContent className="p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
                  <CreditCard className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <div className="font-medium">当前套餐：<span className="text-primary capitalize">{status.plan === "free" ? "入门版" : status.plan === "pro" ? "专业版" : "企业版"}</span></div>
                  <div className="text-sm text-muted-foreground">Credits 余额：{status.credits}</div>
                </div>
              </div>
              {status.cancelAtPeriodEnd && (
                <Badge variant="outline" className="text-amber-400 border-amber-400/30">将在周期结束后取消</Badge>
              )}
            </CardContent>
          </Card>
        )}

        {/* Payment List */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : !payments || payments.length === 0 ? (
          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-12 text-center">
              <Receipt className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-medium mb-2">暂无支付记录</h3>
              <p className="text-sm text-muted-foreground mb-4">您还没有进行过任何支付</p>
              <Link href="/pricing">
                <Button variant="outline">查看套餐</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {payments.map((payment: any) => (
              <Card key={payment.id} className="bg-card/50 border-border/50">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      payment.status === "succeeded" ? "bg-emerald-500/20" : "bg-amber-500/20"
                    }`}>
                      <Receipt className={`h-5 w-5 ${payment.status === "succeeded" ? "text-emerald-400" : "text-amber-400"}`} />
                    </div>
                    <div>
                      <div className="font-medium text-sm">{payment.description || "MV Studio Pro 付款"}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(payment.created).toLocaleString("zh-CN")}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="font-medium">${(payment.amount / 100).toFixed(2)} {payment.currency.toUpperCase()}</div>
                      <Badge variant="outline" className={`text-xs ${
                        payment.status === "succeeded" ? "text-emerald-400 border-emerald-400/30" : "text-amber-400 border-amber-400/30"
                      }`}>
                        {payment.status === "succeeded" ? "成功" : payment.status === "pending" ? "处理中" : payment.status}
                      </Badge>
                    </div>
                    {payment.receiptUrl && (
                      <a href={payment.receiptUrl} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="icon"><ExternalLink className="h-4 w-4" /></Button>
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

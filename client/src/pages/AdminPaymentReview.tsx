
import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { X, CheckSquare, Square, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface PendingPayment {
  id: number;
  userId: number;
  packageType: string;
  amount: string;
  paymentMethod: string | null;
  screenshotUrl: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
}

export default function AdminPaymentReview() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated, loading } = useAuth();

  const [selectedPayment, setSelectedPayment] = useState<PendingPayment | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedPayments, setSelectedPayments] = useState<Set<number>>(new Set());
  const [showBatchRejectModal, setShowBatchRejectModal] = useState(false);
  const [batchRejectionReason, setBatchRejectionReason] = useState("");

  const { data: pendingPayments, refetch } = trpc.paymentSubmission.getPendingPayments.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
  });

  const approveMutation = trpc.paymentSubmission.approvePayment.useMutation({
    onSuccess: () => {
      toast.success("付款已通过审核");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const rejectMutation = trpc.paymentSubmission.rejectPayment.useMutation({
    onSuccess: () => {
      toast.success("付款已拒绝");
      setSelectedPayment(null);
      setRejectionReason("");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const batchApproveMutation = trpc.paymentSubmission.batchApprovePayments.useMutation({
    onSuccess: () => {
      toast.success(`已批量通过 ${selectedPayments.size} 个付款`);
      setSelectedPayments(new Set());
      refetch();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const batchRejectMutation = trpc.paymentSubmission.batchRejectPayments.useMutation({
    onSuccess: () => {
      toast.success(`已批量拒绝 ${selectedPayments.size} 个付款`);
      setSelectedPayments(new Set());
      setShowBatchRejectModal(false);
      setBatchRejectionReason("");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  useEffect(() => {
    if (!loading && (!isAuthenticated || user?.role !== "admin")) {
      navigate("/");
    }
  }, [isAuthenticated, user, loading, navigate]);

  const handleApprove = (paymentId: number) => {
    setIsSubmitting(true);
    approveMutation.mutate({ paymentId }, {
      onSettled: () => setIsSubmitting(false),
    });
  };

  const handleReject = (payment: PendingPayment) => {
    setSelectedPayment(payment);
  };

  const handleSubmitRejection = () => {
    if (!selectedPayment || !rejectionReason.trim()) {
      toast.error("请输入拒绝原因");
      return;
    }

    setIsSubmitting(true);
    rejectMutation.mutate(
      {
        paymentId: selectedPayment.id,
        rejectionReason: rejectionReason.trim(),
      },
      {
        onSettled: () => setIsSubmitting(false),
      }
    );
  };

  const togglePaymentSelection = (paymentId: number) => {
    const newSelected = new Set(selectedPayments);
    if (newSelected.has(paymentId)) {
      newSelected.delete(paymentId);
    } else {
      newSelected.add(paymentId);
    }
    setSelectedPayments(newSelected);
  };

  const handleSelectAll = () => {
    if (pendingPayments && selectedPayments.size === pendingPayments.length) {
      setSelectedPayments(new Set());
    } else {
      setSelectedPayments(new Set(pendingPayments?.map((p) => p.id) || []));
    }
  };

  const handleBatchApprove = () => {
    if (selectedPayments.size === 0) {
      toast.error("请选择至少一个付款");
      return;
    }
    if (window.confirm(`确定要通过 ${selectedPayments.size} 个付款吗？`)) {
        batchApproveMutation.mutate({ paymentIds: Array.from(selectedPayments) });
    }
  };

  const handleBatchReject = () => {
    if (selectedPayments.size === 0) {
      toast.error("请选择至少一个付款");
      return;
    }
    setShowBatchRejectModal(true);
  };

  const handleSubmitBatchRejection = () => {
    if (!batchRejectionReason.trim()) {
      toast.error("请输入拒绝原因");
      return;
    }

    batchRejectMutation.mutate({
      paymentIds: Array.from(selectedPayments),
      rejectionReason: batchRejectionReason.trim(),
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        <p className="text-gray-400 ml-2">加载中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      <div className="overflow-y-auto pb-10">
        <div className="px-6 pt-8 pb-6 flex flex-row items-center justify-between">
          <div className="flex-1">
            <h1 className="text-3xl font-bold mb-2">付款截屏审核</h1>
            <p className="text-base text-gray-400">
              待审核付款：{pendingPayments?.length || 0} 个
            </p>
          </div>
          <button onClick={() => window.history.back()} className="p-2">
            <X className="h-7 w-7 text-[#F7F4EF]" />
          </button>
        </div>

        {pendingPayments && pendingPayments.length > 0 && (
          <div className="px-6 pb-4 flex flex-row items-center gap-3">
            <button
              onClick={handleSelectAll}
              className="flex flex-row items-center bg-white/5 px-4 py-2 rounded-full border border-white/10"
            >
              {selectedPayments.size === pendingPayments.length ? (
                <CheckSquare className="h-5 w-5 text-blue-500" />
              ) : (
                <Square className="h-5 w-5 text-blue-500" />
              )}
              <span className="text-[#F7F4EF] ml-2">
                {selectedPayments.size === pendingPayments.length ? "取消全选" : "全选"}
              </span>
            </button>

            {selectedPayments.size > 0 && (
              <>
                <button
                  onClick={handleBatchApprove}
                  className="flex flex-row items-center bg-green-600 px-4 py-2 rounded-full"
                >
                  <CheckCircle className="h-5 w-5 text-white" />
                  <span className="text-white ml-2 font-semibold">
                    批量通过 ({selectedPayments.size})
                  </span>
                </button>

                <button
                  onClick={handleBatchReject}
                  className="flex flex-row items-center bg-red-600 px-4 py-2 rounded-full"
                >
                  <XCircle className="h-5 w-5 text-white" />
                  <span className="text-white ml-2 font-semibold">
                    批量拒绝 ({selectedPayments.size})
                  </span>
                </button>
              </>
            )}
          </div>
        )}

        <div className="px-6 grid gap-4">
          {!pendingPayments || pendingPayments.length === 0 ? (
            <div className="py-20">
              <p className="text-center text-gray-400">暂无待审核付款</p>
            </div>
          ) : (
            pendingPayments.map((payment) => (
              <div
                key={payment.id}
                className="bg-white/5 rounded-2xl p-6 border border-white/10"
              >
                <div className="flex flex-row items-center justify-between mb-4">
                  <button
                    onClick={() => togglePaymentSelection(payment.id)}
                    className="flex flex-row items-center"
                  >
                    {selectedPayments.has(payment.id) ? (
                        <CheckSquare className="h-6 w-6 text-blue-500" />
                    ) : (
                        <Square className="h-6 w-6 text-blue-500" />
                    )}
                    <span className="text-sm text-gray-400 ml-2">选择</span>
                  </button>

                  <p className="text-sm text-gray-400">
                    提交时间：{new Date(payment.createdAt).toLocaleString("zh-TW")}
                  </p>
                </div>

                <div className="mb-4">
                  <p className="text-lg font-bold text-[#F7F4EF] mb-2">
                    套餐类型：{payment.packageType}
                  </p>
                  <p className="text-base text-[#F7F4EF] mb-1">
                    付款金额：${payment.amount}
                  </p>
                  {payment.paymentMethod && (
                    <p className="text-base text-gray-400">
                      付款方式：{payment.paymentMethod}
                    </p>
                  )}
                  <p className="text-sm text-gray-400">
                    用户 ID：{payment.userId}
                  </p>
                </div>

                <div className="mb-4">
                  <p className="text-base font-semibold text-[#F7F4EF] mb-2">
                    付款截屏：
                  </p>
                  <img
                    src={payment.screenshotUrl}
                    alt="Payment Screenshot"
                    className="w-full h-auto max-h-[300px] rounded-xl object-contain bg-black"
                  />
                </div>

                <div className="flex flex-row gap-3">
                  <button
                    onClick={() => handleApprove(payment.id)}
                    disabled={isSubmitting}
                    className="flex-1 bg-green-600 rounded-full py-3 text-white font-semibold disabled:opacity-50"
                  >
                    {isSubmitting ? "处理中..." : "通过"}
                  </button>

                  <button
                    onClick={() => handleReject(payment)}
                    disabled={isSubmitting}
                    className="flex-1 bg-red-600 rounded-full py-3 text-white font-semibold disabled:opacity-50"
                  >
                    拒绝
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {selectedPayment && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-6 z-50">
          <div className="bg-[#0A0A0C] border border-white/10 rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-[#F7F4EF] mb-4">拒绝原因</h2>

            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="请输入拒绝原因..."
              rows={4}
              className="bg-[#1C1C1E] text-[#F7F4EF] rounded-xl p-4 mb-4 w-full border border-white/10 placeholder-gray-500"
            />

            <div className="flex flex-row gap-3">
              <button
                onClick={() => {
                  setSelectedPayment(null);
                  setRejectionReason("");
                }}
                className="flex-1 bg-white/10 rounded-full py-3 text-[#F7F4EF] font-semibold"
              >
                取消
              </button>

              <button
                onClick={handleSubmitRejection}
                disabled={isSubmitting || !rejectionReason.trim()}
                className="flex-1 bg-red-600 rounded-full py-3 text-white font-semibold disabled:opacity-50"
              >
                {isSubmitting ? "提交中..." : "确定拒绝"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBatchRejectModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center px-6 z-50">
          <div className="bg-[#0A0A0C] border border-white/10 rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-[#F7F4EF] mb-4">
              批量拒绝原因（{selectedPayments.size} 个付款）
            </h2>

            <textarea
              value={batchRejectionReason}
              onChange={(e) => setBatchRejectionReason(e.target.value)}
              placeholder="请输入统一拒绝原因..."
              rows={4}
              className="bg-[#1C1C1E] text-[#F7F4EF] rounded-xl p-4 mb-4 w-full border border-white/10 placeholder-gray-500"
            />

            <div className="flex flex-row gap-3">
              <button
                onClick={() => {
                  setShowBatchRejectModal(false);
                  setBatchRejectionReason("");
                }}
                className="flex-1 bg-white/10 rounded-full py-3 text-[#F7F4EF] font-semibold"
              >
                取消
              </button>

              <button
                onClick={handleSubmitBatchRejection}
                disabled={batchRejectMutation.isPending || !batchRejectionReason.trim()}
                className="flex-1 bg-red-600 rounded-full py-3 text-white font-semibold disabled:opacity-50"
              >
                {batchRejectMutation.isPending ? "提交中..." : "确定拒绝"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

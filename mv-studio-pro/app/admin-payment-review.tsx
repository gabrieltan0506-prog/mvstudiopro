import { View, Text, ScrollView, TouchableOpacity, TextInput, Modal, Image, Alert } from "react-native";
import { useState, useEffect } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

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

export default function AdminPaymentReviewScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user, isAuthenticated, loading } = useAuth();

  const [selectedPayment, setSelectedPayment] = useState<PendingPayment | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedPayments, setSelectedPayments] = useState<Set<number>>(new Set());
  const [showBatchRejectModal, setShowBatchRejectModal] = useState(false);
  const [batchRejectionReason, setBatchRejectionReason] = useState("");

  // Fetch pending payments
  const { data: pendingPayments, refetch } = trpc.paymentSubmission.getPendingPayments.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
  });

  // Approve payment mutation
  const approveMutation = trpc.paymentSubmission.approvePayment.useMutation({
    onSuccess: () => {
      Alert.alert("成功", "付款已通过审核");
      refetch();
    },
    onError: (error) => {
      Alert.alert("错误", error.message);
    },
  });

  // Reject payment mutation
  const rejectMutation = trpc.paymentSubmission.rejectPayment.useMutation({
    onSuccess: () => {
      Alert.alert("成功", "付款已拒绝");
      setSelectedPayment(null);
      setRejectionReason("");
      refetch();
    },
    onError: (error) => {
      Alert.alert("错误", error.message);
    },
  });

  // Batch approve mutation
  const batchApproveMutation = trpc.paymentSubmission.batchApprovePayments.useMutation({
    onSuccess: () => {
      Alert.alert("成功", `已批量通过 ${selectedPayments.size} 个付款`);
      setSelectedPayments(new Set());
      refetch();
    },
    onError: (error) => {
      Alert.alert("错误", error.message);
    },
  });

  // Batch reject mutation
  const batchRejectMutation = trpc.paymentSubmission.batchRejectPayments.useMutation({
    onSuccess: () => {
      Alert.alert("成功", `已批量拒绝 ${selectedPayments.size} 个付款`);
      setSelectedPayments(new Set());
      setShowBatchRejectModal(false);
      setBatchRejectionReason("");
      refetch();
    },
    onError: (error) => {
      Alert.alert("错误", error.message);
    },
  });

  // Check if user is admin
  useEffect(() => {
    if (!loading && (!isAuthenticated || user?.role !== "admin")) {
      router.replace("/");
    }
  }, [isAuthenticated, user, loading]);

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
      Alert.alert("错误", "请输入拒绝原因");
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
    if (selectedPayments.size === pendingPayments?.length) {
      setSelectedPayments(new Set());
    } else {
      setSelectedPayments(new Set(pendingPayments?.map((p) => p.id) || []));
    }
  };

  const handleBatchApprove = () => {
    if (selectedPayments.size === 0) {
      Alert.alert("错误", "请选择至少一个付款");
      return;
    }

    Alert.alert(
      "确认批量通过",
      `确定要通过 ${selectedPayments.size} 个付款吗？`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "确定",
          onPress: () => {
            batchApproveMutation.mutate({ paymentIds: Array.from(selectedPayments) });
          },
        },
      ]
    );
  };

  const handleBatchReject = () => {
    if (selectedPayments.size === 0) {
      Alert.alert("错误", "请选择至少一个付款");
      return;
    }
    setShowBatchRejectModal(true);
  };

  const handleSubmitBatchRejection = () => {
    if (!batchRejectionReason.trim()) {
      Alert.alert("错误", "请输入拒绝原因");
      return;
    }

    batchRejectMutation.mutate({
      paymentIds: Array.from(selectedPayments),
      rejectionReason: batchRejectionReason.trim(),
    });
  };

  if (loading) {
    return (
      <ScreenContainer className="items-center justify-center">
        <Text className="text-muted">加载中...</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View className="px-6 pt-8 pb-6 flex-row items-center justify-between">
          <View className="flex-1">
            <Text className="text-3xl font-bold text-foreground mb-2">付款截屏审核</Text>
            <Text className="text-base text-muted">
              待审核付款：{pendingPayments?.length || 0} 个
            </Text>
          </View>
          <TouchableOpacity onPress={() => router.back()} className="p-2">
            <MaterialIcons name="close" size={28} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* Batch Actions Toolbar */}
        {pendingPayments && pendingPayments.length > 0 && (
          <View className="px-6 pb-4 flex-row items-center gap-3">
            <TouchableOpacity
              onPress={handleSelectAll}
              className="flex-row items-center bg-surface px-4 py-2 rounded-full border border-border"
            >
              <MaterialIcons
                name={selectedPayments.size === pendingPayments.length ? "check-box" : "check-box-outline-blank"}
                size={20}
                color={colors.primary}
              />
              <Text className="text-foreground ml-2">
                {selectedPayments.size === pendingPayments.length ? "取消全选" : "全选"}
              </Text>
            </TouchableOpacity>

            {selectedPayments.size > 0 && (
              <>
                <TouchableOpacity
                  onPress={handleBatchApprove}
                  className="flex-row items-center bg-success px-4 py-2 rounded-full"
                >
                  <MaterialIcons name="check-circle" size={20} color="#fff" />
                  <Text className="text-white ml-2 font-semibold">
                    批量通过 ({selectedPayments.size})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleBatchReject}
                  className="flex-row items-center bg-error px-4 py-2 rounded-full"
                >
                  <MaterialIcons name="cancel" size={20} color="#fff" />
                  <Text className="text-white ml-2 font-semibold">
                    批量拒绝 ({selectedPayments.size})
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* Pending Payments List */}
        <View className="px-6 gap-4">
          {!pendingPayments || pendingPayments.length === 0 ? (
            <View className="py-20">
              <Text className="text-center text-muted">暂无待审核付款</Text>
            </View>
          ) : (
            pendingPayments.map((payment) => (
              <View
                key={payment.id}
                className="bg-surface rounded-2xl p-6 border border-border"
              >
                {/* Header with Checkbox */}
                <View className="flex-row items-center justify-between mb-4">
                  <TouchableOpacity
                    onPress={() => togglePaymentSelection(payment.id)}
                    className="flex-row items-center"
                  >
                    <MaterialIcons
                      name={selectedPayments.has(payment.id) ? "check-box" : "check-box-outline-blank"}
                      size={24}
                      color={colors.primary}
                    />
                    <Text className="text-sm text-muted ml-2">选择</Text>
                  </TouchableOpacity>

                  <Text className="text-sm text-muted">
                    提交时间：{new Date(payment.createdAt).toLocaleString("zh-TW")}
                  </Text>
                </View>

                {/* Payment Info */}
                <View className="mb-4">
                  <Text className="text-lg font-bold text-foreground mb-2">
                    套餐类型：{payment.packageType}
                  </Text>
                  <Text className="text-base text-foreground mb-1">
                    付款金额：${payment.amount}
                  </Text>
                  {payment.paymentMethod && (
                    <Text className="text-base text-muted">
                      付款方式：{payment.paymentMethod}
                    </Text>
                  )}
                  <Text className="text-sm text-muted">
                    用户 ID：{payment.userId}
                  </Text>
                </View>

                {/* Payment Screenshot */}
                <View className="mb-4">
                  <Text className="text-base font-semibold text-foreground mb-2">
                    付款截屏：
                  </Text>
                  <Image
                    source={{ uri: payment.screenshotUrl }}
                    style={{ width: "100%", height: 300, borderRadius: 12 }}
                    resizeMode="contain"
                  />
                </View>

                {/* Action Buttons */}
                <View className="flex-row gap-3">
                  <TouchableOpacity
                    onPress={() => handleApprove(payment.id)}
                    disabled={isSubmitting}
                    className="flex-1 bg-success rounded-full py-3"
                  >
                    <Text className="text-center text-white font-semibold">
                      {isSubmitting ? "处理中..." : "通过"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => handleReject(payment)}
                    disabled={isSubmitting}
                    className="flex-1 bg-error rounded-full py-3"
                  >
                    <Text className="text-center text-white font-semibold">拒绝</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Rejection Reason Modal */}
      <Modal
        visible={selectedPayment !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPayment(null)}
      >
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View className="bg-surface rounded-2xl p-6 w-full max-w-md">
            <Text className="text-xl font-bold text-foreground mb-4">拒绝原因</Text>

            <TextInput
              value={rejectionReason}
              onChangeText={setRejectionReason}
              placeholder="请输入拒绝原因..."
              multiline
              numberOfLines={4}
              className="bg-background text-foreground rounded-xl p-4 mb-4 border border-border"
              placeholderTextColor={colors.muted}
            />

            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => {
                  setSelectedPayment(null);
                  setRejectionReason("");
                }}
                className="flex-1 bg-border rounded-full py-3"
              >
                <Text className="text-center text-foreground font-semibold">取消</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleSubmitRejection}
                disabled={isSubmitting || !rejectionReason.trim()}
                className="flex-1 bg-error rounded-full py-3"
              >
                <Text className="text-center text-white font-semibold">
                  {isSubmitting ? "提交中..." : "确定拒绝"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Batch Rejection Reason Modal */}
      <Modal
        visible={showBatchRejectModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowBatchRejectModal(false)}
      >
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View className="bg-surface rounded-2xl p-6 w-full max-w-md">
            <Text className="text-xl font-bold text-foreground mb-4">
              批量拒绝原因（{selectedPayments.size} 个付款）
            </Text>

            <TextInput
              value={batchRejectionReason}
              onChangeText={setBatchRejectionReason}
              placeholder="请输入统一拒绝原因..."
              multiline
              numberOfLines={4}
              className="bg-background text-foreground rounded-xl p-4 mb-4 border border-border"
              placeholderTextColor={colors.muted}
            />

            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => {
                  setShowBatchRejectModal(false);
                  setBatchRejectionReason("");
                }}
                className="flex-1 bg-border rounded-full py-3"
              >
                <Text className="text-center text-foreground font-semibold">取消</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleSubmitBatchRejection}
                disabled={batchRejectMutation.isPending || !batchRejectionReason.trim()}
                className="flex-1 bg-error rounded-full py-3"
              >
                <Text className="text-center text-white font-semibold">
                  {batchRejectMutation.isPending ? "提交中..." : "确定拒绝"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator } from "react-native";
import { useState, useEffect } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

interface StoryboardScene {
  sceneNumber: number;
  timestamp: string;
  duration: string;
  description: string;
  cameraMovement: string;
  mood: string;
  visualElements: string[];
}

interface StoryboardData {
  title: string;
  musicInfo: {
    bpm: number;
    emotion: string;
    style: string;
    key: string;
  };
  scenes: StoryboardScene[];
  summary: string;
}

interface PendingStoryboard {
  id: number;
  userId: number;
  lyrics: string;
  sceneCount: number;
  storyboard: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
}

export default function AdminReviewScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user, isAuthenticated, loading } = useAuth();

  const [selectedStoryboard, setSelectedStoryboard] = useState<PendingStoryboard | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Batch review states
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [batchRejectionReason, setBatchRejectionReason] = useState("");
  const [showBatchRejectModal, setShowBatchRejectModal] = useState(false);

  // ✅ All tRPC queries and mutations at the top level
  const pendingStoryboardsQuery = trpc.storyboard.getPendingReviews.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
    refetchOnMount: true,
  });
  const approveStoryboardMutation = trpc.storyboard.approveStoryboard.useMutation();
  const rejectStoryboardMutation = trpc.storyboard.rejectStoryboard.useMutation();
  const batchApproveStoryboardsMutation = trpc.storyboard.batchApproveStoryboards.useMutation();
  const batchRejectStoryboardsMutation = trpc.storyboard.batchRejectStoryboards.useMutation();

  useEffect(() => {
    // Wait for auth check to complete before redirecting
    if (!loading && !isAuthenticated) {
      console.log("[AdminReview] Not authenticated, redirecting to login...");
      router.replace("/login");
      return;
    }

    // Check if user is admin
    if (!loading && isAuthenticated && user?.role !== "admin") {
      console.log("[AdminReview] User is not admin, redirecting to home...");
      Alert.alert("权限不足", "您没有权限访问此页面");
      router.replace("/");
    }
  }, [loading, isAuthenticated, user, router]);

  // Show loading while checking authentication
  if (loading) {
    return (
      <ScreenContainer className="items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text className="text-muted mt-4">检查登录状态...</Text>
      </ScreenContainer>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return null;
  }

  // Redirect to home if not admin
  if (user?.role !== "admin") {
    return null;
  }

  const handleApprove = async (storyboardId: number) => {
    setIsSubmitting(true);
    try {
      await approveStoryboardMutation.mutateAsync({ storyboardId });
      Alert.alert("成功", "分镜脚本已通过审核");
      // Refetch pending storyboards
      pendingStoryboardsQuery.refetch();
      setSelectedStoryboard(null);
    } catch (error) {
      console.error("Error approving storyboard:", error);
      Alert.alert("错误", "审核通过失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async (storyboardId: number) => {
    if (!rejectionReason.trim()) {
      Alert.alert("提示", "请输入拒绝原因");
      return;
    }

    setIsSubmitting(true);
    try {
      await rejectStoryboardMutation.mutateAsync({
        storyboardId,
        rejectionReason: rejectionReason.trim(),
      });
      Alert.alert("成功", "分镜脚本已拒绝");
      // Refetch pending storyboards
      pendingStoryboardsQuery.refetch();
      setSelectedStoryboard(null);
      setRejectionReason("");
    } catch (error) {
      console.error("Error rejecting storyboard:", error);
      Alert.alert("错误", "审核拒绝失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  const parseStoryboard = (storyboardJson: string): StoryboardData | null => {
    try {
      return JSON.parse(storyboardJson);
    } catch (error) {
      console.error("Error parsing storyboard JSON:", error);
      return null;
    }
  };

  // Batch review handlers
  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((selectedId) => selectedId !== id) : [...prev, id]
    );
  };

  const handleToggleSelectAll = () => {
    if (!pendingStoryboardsQuery.data) return;
    if (selectedIds.length === pendingStoryboardsQuery.data.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(pendingStoryboardsQuery.data.map((item) => item.id));
    }
  };

  const handleBatchApprove = async () => {
    if (selectedIds.length === 0) {
      Alert.alert("提示", "请选择至少一个分镜脚本");
      return;
    }

    setIsSubmitting(true);
    try {
      await batchApproveStoryboardsMutation.mutateAsync({ storyboardIds: selectedIds });
      Alert.alert("成功", `已批量通过 ${selectedIds.length} 个分镜脚本`);
      // Refetch pending storyboards
      pendingStoryboardsQuery.refetch();
      setSelectedIds([]);
    } catch (error) {
      console.error("Error batch approving storyboards:", error);
      Alert.alert("错误", "批量审核通过失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBatchReject = async () => {
    if (selectedIds.length === 0) {
      Alert.alert("提示", "请选择至少一个分镜脚本");
      return;
    }

    if (!batchRejectionReason.trim()) {
      Alert.alert("提示", "请输入拒绝原因");
      return;
    }

    setIsSubmitting(true);
    try {
      await batchRejectStoryboardsMutation.mutateAsync({
        storyboardIds: selectedIds,
        rejectionReason: batchRejectionReason.trim(),
      });
      Alert.alert("成功", `已批量拒绝 ${selectedIds.length} 个分镜脚本`);
      // Refetch pending storyboards
      pendingStoryboardsQuery.refetch();
      setSelectedIds([]);
      setBatchRejectionReason("");
      setShowBatchRejectModal(false);
    } catch (error) {
      console.error("Error batch rejecting storyboards:", error);
      Alert.alert("错误", "批量审核拒绝失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenContainer>
      <ScrollView className="flex-1 bg-background">
        {/* Header */}
        <View className="px-6 pt-6 pb-4 border-b border-border">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-3xl font-bold text-foreground mb-2">分镜审核后台</Text>
              <Text className="text-base text-muted">
                待审核数量：{pendingStoryboardsQuery.data?.length ?? 0}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => router.back()}
              className="w-12 h-12 items-center justify-center rounded-full bg-surface"
            >
              <MaterialIcons name="close" size={24} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Batch Actions Toolbar */}
        {!pendingStoryboardsQuery.isLoading &&
          pendingStoryboardsQuery.data &&
          pendingStoryboardsQuery.data.length > 0 && (
            <View className="px-6 py-4 bg-surface border-b border-border">
              <View className="flex-row items-center justify-between mb-3">
                <TouchableOpacity
                  onPress={handleToggleSelectAll}
                  className="flex-row items-center"
                >
                  <View
                    className="w-6 h-6 rounded border-2 items-center justify-center mr-2"
                    style={{
                      borderColor: colors.primary,
                      backgroundColor:
                        selectedIds.length === pendingStoryboardsQuery.data.length
                          ? colors.primary
                          : "transparent",
                    }}
                  >
                    {selectedIds.length === pendingStoryboardsQuery.data.length && (
                      <MaterialIcons name="check" size={16} color="#FFF" />
                    )}
                  </View>
                  <Text className="text-foreground font-semibold">
                    全选 ({selectedIds.length}/{pendingStoryboardsQuery.data.length})
                  </Text>
                </TouchableOpacity>

                {selectedIds.length > 0 && (
                  <Text className="text-muted text-sm">已选择 {selectedIds.length} 个</Text>
                )}
              </View>

              {selectedIds.length > 0 && (
                <View className="flex-row gap-3">
                  <TouchableOpacity
                    onPress={handleBatchApprove}
                    disabled={isSubmitting}
                    className="flex-1 rounded-xl py-3 px-4"
                    style={{ backgroundColor: colors.success, opacity: isSubmitting ? 0.5 : 1 }}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Text className="text-white font-semibold text-center">
                        批量通过 ({selectedIds.length})
                      </Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setShowBatchRejectModal(true)}
                    disabled={isSubmitting}
                    className="flex-1 rounded-xl py-3 px-4"
                    style={{ backgroundColor: colors.error, opacity: isSubmitting ? 0.5 : 1 }}
                  >
                    <Text className="text-white font-semibold text-center">
                      批量拒绝 ({selectedIds.length})
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

        {/* Loading State */}
        {pendingStoryboardsQuery.isLoading && (
          <View className="items-center justify-center py-12">
            <ActivityIndicator size="large" color={colors.primary} />
            <Text className="text-muted mt-4">加载待审核列表...</Text>
          </View>
        )}

        {/* Empty State */}
        {!pendingStoryboardsQuery.isLoading &&
          pendingStoryboardsQuery.data &&
          pendingStoryboardsQuery.data.length === 0 && (
            <View className="items-center justify-center py-12">
              <MaterialIcons name="check-circle" size={64} color={colors.success} />
              <Text className="text-foreground text-lg font-semibold mt-4">没有待审核的分镜脚本</Text>
              <Text className="text-muted mt-2">所有分镜脚本都已处理完毕</Text>
            </View>
          )}

        {/* Pending Storyboards List */}
        {!pendingStoryboardsQuery.isLoading &&
          pendingStoryboardsQuery.data &&
          pendingStoryboardsQuery.data.length > 0 && (
            <View className="px-6 py-4">
              {pendingStoryboardsQuery.data.map((item) => {
                const storyboardData = parseStoryboard(item.storyboard);
                const isExpanded = selectedStoryboard?.id === item.id;

                return (
                  <View key={item.id} className="bg-surface rounded-2xl p-6 border border-border mb-4">
                    {/* Header */}
                    <View className="flex-row items-center justify-between mb-4">
                      {/* Checkbox */}
                      <TouchableOpacity
                        onPress={() => handleToggleSelect(item.id)}
                        className="mr-3"
                      >
                        <View
                          className="w-6 h-6 rounded border-2 items-center justify-center"
                          style={{
                            borderColor: colors.primary,
                            backgroundColor: selectedIds.includes(item.id)
                              ? colors.primary
                              : "transparent",
                          }}
                        >
                          {selectedIds.includes(item.id) && (
                            <MaterialIcons name="check" size={16} color="#FFF" />
                          )}
                        </View>
                      </TouchableOpacity>

                      <View className="flex-1">
                        <Text className="text-lg font-bold text-foreground mb-1">
                          ID: {item.id} | 用户 ID: {item.userId}
                        </Text>
                        <Text className="text-muted text-sm">
                          提交时间：{new Date(item.createdAt).toLocaleString("zh-TW")}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() =>
                          setSelectedStoryboard(isExpanded ? null : item)
                        }
                        className="w-10 h-10 items-center justify-center rounded-full bg-primary/10"
                      >
                        <MaterialIcons
                          name={isExpanded ? "expand-less" : "expand-more"}
                          size={24}
                          color={colors.primary}
                        />
                      </TouchableOpacity>
                    </View>

                    {/* Lyrics Preview */}
                    <View className="bg-background rounded-lg p-4 mb-4">
                      <Text className="text-muted text-sm mb-2">歌词内容：</Text>
                      <Text className="text-foreground" numberOfLines={isExpanded ? undefined : 3}>
                        {item.lyrics}
                      </Text>
                    </View>

                    {/* Storyboard Details (Expanded) */}
                    {isExpanded && storyboardData && (
                      <View>
                        {/* Music Info */}
                        <View className="bg-background rounded-lg p-4 mb-4">
                          <Text className="text-muted text-sm mb-2">音乐信息：</Text>
                          <Text className="text-foreground font-bold mb-2">{storyboardData.title}</Text>
                          <View className="flex-row flex-wrap gap-2">
                            <View className="bg-primary/10 px-3 py-1 rounded-full">
                              <Text className="text-primary text-sm">BPM: {storyboardData.musicInfo.bpm}</Text>
                            </View>
                            <View className="bg-primary/10 px-3 py-1 rounded-full">
                              <Text className="text-primary text-sm">{storyboardData.musicInfo.emotion}</Text>
                            </View>
                            <View className="bg-primary/10 px-3 py-1 rounded-full">
                              <Text className="text-primary text-sm">{storyboardData.musicInfo.style}</Text>
                            </View>
                          </View>
                        </View>

                        {/* Scenes */}
                        <View className="mb-4">
                          <Text className="text-muted text-sm mb-2">分镜场景（共 {storyboardData.scenes.length} 个）：</Text>
                          {storyboardData.scenes.slice(0, 3).map((scene) => (
                            <View key={scene.sceneNumber} className="bg-background rounded-lg p-4 mb-2">
                              <Text className="text-foreground font-semibold mb-1">
                                场景 {scene.sceneNumber} - {scene.timestamp}
                              </Text>
                              <Text className="text-foreground text-sm">{scene.description}</Text>
                            </View>
                          ))}
                          {storyboardData.scenes.length > 3 && (
                            <Text className="text-muted text-sm text-center">
                              ... 还有 {storyboardData.scenes.length - 3} 个场景
                            </Text>
                          )}
                        </View>

                        {/* Rejection Reason Input */}
                        <View className="mb-4">
                          <Text className="text-muted text-sm mb-2">拒绝原因（如需拒绝）：</Text>
                          <TextInput
                            value={rejectionReason}
                            onChangeText={setRejectionReason}
                            placeholder="请输入拒绝原因..."
                            placeholderTextColor={colors.muted}
                            multiline
                            numberOfLines={3}
                            textAlignVertical="top"
                            className="bg-background rounded-lg p-4 text-foreground"
                            style={{
                              borderWidth: 1,
                              borderColor: colors.border,
                              fontSize: 14,
                              lineHeight: 20,
                            }}
                          />
                        </View>

                        {/* Action Buttons */}
                        <View className="flex-row gap-3">
                          <TouchableOpacity
                            onPress={() => handleReject(item.id)}
                            disabled={isSubmitting}
                            className="flex-1 rounded-xl py-3 px-6"
                            style={{ backgroundColor: colors.error, opacity: isSubmitting ? 0.5 : 1 }}
                          >
                            {isSubmitting ? (
                              <ActivityIndicator size="small" color="#FFF" />
                            ) : (
                              <Text className="text-white font-semibold text-center">拒绝</Text>
                            )}
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleApprove(item.id)}
                            disabled={isSubmitting}
                            className="flex-1 rounded-xl py-3 px-6"
                            style={{ backgroundColor: colors.success, opacity: isSubmitting ? 0.5 : 1 }}
                          >
                            {isSubmitting ? (
                              <ActivityIndicator size="small" color="#FFF" />
                            ) : (
                              <Text className="text-white font-semibold text-center">通过</Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

        {/* Batch Reject Modal */}
        {showBatchRejectModal && (
          <View
            className="absolute inset-0 items-center justify-center"
            style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
          >
            <View className="bg-surface rounded-2xl p-6 mx-6 w-full max-w-md">
              <Text className="text-xl font-bold text-foreground mb-4">批量拒绝分镜脚本</Text>
              <Text className="text-muted mb-4">
                您将拒绝 {selectedIds.length} 个分镜脚本，请输入统一的拒绝原因：
              </Text>
              <TextInput
                value={batchRejectionReason}
                onChangeText={setBatchRejectionReason}
                placeholder="请输入拒绝原因..."
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                className="bg-background rounded-lg p-4 text-foreground mb-4"
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  fontSize: 14,
                  lineHeight: 20,
                  minHeight: 100,
                }}
              />
              <View className="flex-row gap-3">
                <TouchableOpacity
                  onPress={() => {
                    setShowBatchRejectModal(false);
                    setBatchRejectionReason("");
                  }}
                  className="flex-1 bg-muted/20 rounded-xl py-3 px-6"
                >
                  <Text className="text-foreground font-semibold text-center">取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleBatchReject}
                  disabled={isSubmitting}
                  className="flex-1 rounded-xl py-3 px-6"
                  style={{ backgroundColor: colors.error, opacity: isSubmitting ? 0.5 : 1 }}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Text className="text-white font-semibold text-center">确认拒绝</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { X, Check, Loader2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// Assuming Dialog components from shadcn/ui
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

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
  status: string;
  createdAt: Date;
}

export default function AdminReview() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated, loading } = useAuth();

  const [selectedStoryboard, setSelectedStoryboard] = useState<PendingStoryboard | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Batch review states
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [batchRejectionReason, setBatchRejectionReason] = useState("");
  const [showBatchRejectModal, setShowBatchRejectModal] = useState(false);

  const pendingStoryboardsQuery = trpc.storyboard.getPendingReviews.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
    refetchOnMount: true,
  });
  const approveStoryboardMutation = trpc.storyboard.approveStoryboard.useMutation();
  const rejectStoryboardMutation = trpc.storyboard.rejectStoryboard.useMutation();
  const batchApproveStoryboardsMutation = trpc.storyboard.batchApproveStoryboards.useMutation();
  const batchRejectStoryboardsMutation = trpc.storyboard.batchRejectStoryboards.useMutation();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      console.log("[AdminReview] Not authenticated, redirecting to login...");
      navigate("/login");
      return;
    }

    if (!loading && isAuthenticated && user?.role !== "admin") {
      console.log("[AdminReview] User is not admin, redirecting to home...");
      toast.error("您没有权限访问此页面");
      navigate("/");
    }
  }, [loading, isAuthenticated, user, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0C] flex flex-col items-center justify-center text-[#F7F4EF]">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="text-white/50 mt-4">检查登录状态...</p>
      </div>
    );
  }

  if (!isAuthenticated || user?.role !== "admin") {
    return null;
  }

  const handleApprove = async (storyboardId: number) => {
    setIsSubmitting(true);
    try {
      await approveStoryboardMutation.mutateAsync({ storyboardId });
      toast.success("分镜脚本已通过审核");
      pendingStoryboardsQuery.refetch();
      setSelectedStoryboard(null);
    } catch (error) {
      console.error("AlertCircle approving storyboard:", error);
      toast.error("审核通过失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async (storyboardId: number) => {
    if (!rejectionReason.trim()) {
      toast.warning("请输入拒绝原因");
      return;
    }

    setIsSubmitting(true);
    try {
      await rejectStoryboardMutation.mutateAsync({
        storyboardId,
        rejectionReason: rejectionReason.trim(),
      });
      toast.success("分镜脚本已拒绝");
      pendingStoryboardsQuery.refetch();
      setSelectedStoryboard(null);
      setRejectionReason("");
    } catch (error) {
      console.error("AlertCircle rejecting storyboard:", error);
      toast.error("审核拒绝失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  const parseStoryboard = (storyboardJson: string): StoryboardData | null => {
    try {
      return JSON.parse(storyboardJson);
    } catch (error) {
      console.error("AlertCircle parsing storyboard JSON:", error);
      return null;
    }
  };

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
      toast.warning("请选择至少一个分镜脚本");
      return;
    }

    setIsSubmitting(true);
    try {
      await batchApproveStoryboardsMutation.mutateAsync({ storyboardIds: selectedIds });
      toast.success(`已批量通过 ${selectedIds.length} 个分镜脚本`);
      pendingStoryboardsQuery.refetch();
      setSelectedIds([]);
    } catch (error) {
      console.error("AlertCircle batch approving storyboards:", error);
      toast.error("批量审核通过失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBatchReject = async () => {
    if (selectedIds.length === 0) {
      toast.warning("请选择至少一个分镜脚本");
      return;
    }

    if (!batchRejectionReason.trim()) {
      toast.warning("请输入拒绝原因");
      return;
    }

    setIsSubmitting(true);
    try {
      await batchRejectStoryboardsMutation.mutateAsync({
        storyboardIds: selectedIds,
        rejectionReason: batchRejectionReason.trim(),
      });
      toast.success(`已批量拒绝 ${selectedIds.length} 个分镜脚本`);
      pendingStoryboardsQuery.refetch();
      setSelectedIds([]);
      setBatchRejectionReason("");
      setShowBatchRejectModal(false);
    } catch (error) {
      console.error("AlertCircle batch rejecting storyboards:", error);
      toast.error("批量审核拒绝失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isAllSelected = pendingStoryboardsQuery.data && selectedIds.length === pendingStoryboardsQuery.data.length;

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      <div className="flex-1">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-white/10">
          <div className="flex flex-row items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">分镜审核后台</h1>
              <p className="text-base text-white/50">
                待审核数量：{pendingStoryboardsQuery.data?.length ?? 0}
              </p>
            </div>
            <button
              onClick={() => window.history.back()}
              className="w-12 h-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            >
              <X size={24} className="text-white" />
            </button>
          </div>
        </div>

        {/* Batch Actions Toolbar */}
        {!pendingStoryboardsQuery.isPending &&
          pendingStoryboardsQuery.data &&
          pendingStoryboardsQuery.data.length > 0 && (
            <div className="px-6 py-4 bg-white/5 border-b border-white/10">
              <div className="flex flex-row items-center justify-between mb-3">
                <label className="flex flex-row items-center cursor-pointer">
                  <Checkbox
                    checked={isAllSelected}
                    onCheckedChange={handleToggleSelectAll}
                    className="mr-2"
                  />
                  <span className="font-semibold">
                    全选 ({selectedIds.length}/{pendingStoryboardsQuery.data.length})
                  </span>
                </label>

                {selectedIds.length > 0 && (
                  <span className="text-white/50 text-sm">已选择 {selectedIds.length} 个</span>
                )}
              </div>

              {selectedIds.length > 0 && (
                <div className="flex flex-row gap-3">
                  <Button
                    onClick={handleBatchApprove}
                    disabled={isSubmitting}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      `批量通过 (${selectedIds.length})`
                    )}
                  </Button>
                  <Button
                    onClick={() => setShowBatchRejectModal(true)}
                    disabled={isSubmitting}
                    variant="destructive"
                    className="flex-1 disabled:opacity-50"
                  >
                    批量拒绝 ({selectedIds.length})
                  </Button>
                </div>
              )}
            </div>
          )}

        {/* Main Content */}
        <div className="p-6">
          {pendingStoryboardsQuery.isPending ? (
            <div className="flex justify-center items-center p-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : pendingStoryboardsQuery.isError ? (
            <div className="text-center text-red-500 py-10">
              <p>加载待审核列表失败: {pendingStoryboardsQuery.error.message}</p>
            </div>
          ) : !pendingStoryboardsQuery.data || pendingStoryboardsQuery.data.length === 0 ? (
            <div className="text-center text-white/50 py-20">
              <p className="text-lg">🎉 全部审核完成！</p>
              <p>目前没有待审核的分镜脚本。</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {pendingStoryboardsQuery.data.map((item) => {
                const storyboardData = parseStoryboard(item.storyboard);
                return (
                  <div
                    key={item.id}
                    className="border border-white/10 rounded-lg bg-white/5 p-4 flex flex-col justify-between transition-all hover:border-primary/50"
                  >
                    <div className="flex-grow">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center">
                           <Checkbox
                              checked={selectedIds.includes(item.id)}
                              onCheckedChange={() => handleToggleSelect(item.id)}
                              className="mr-3"
                            />
                          <h3 className="font-bold text-lg truncate flex-1 pr-2" title={storyboardData?.title}>
                            {storyboardData?.title ?? "无标题"}
                          </h3>
                        </div>
                      </div>
                      <p className="text-sm text-white/50 mb-1">用户 ID: {item.userId}</p>
                      <p className="text-sm text-white/50 mb-1">场景数: {item.sceneCount}</p>
                      <p className="text-sm text-white/50 mb-3">提交于: {new Date(item.createdAt).toLocaleString()}</p>
                      <div className="mb-3 p-2 bg-black/20 rounded-md max-h-24 overflow-y-auto">
                         <p className="text-xs text-white/70 whitespace-pre-wrap font-mono">{item.lyrics}</p>
                      </div>
                    </div>
                    <Button
                      onClick={() => setSelectedStoryboard(item)}
                      className="w-full bg-primary/20 text-primary hover:bg-primary/30"
                    >
                      查看详情
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Details Modal */}
      <Dialog open={!!selectedStoryboard} onOpenChange={() => setSelectedStoryboard(null)}>
        <DialogContent className="max-w-4xl w-full bg-[#1A1A1C] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">{parseStoryboard(selectedStoryboard?.storyboard || '')?.title ?? "分镜详情"}</DialogTitle>
            <DialogDescription className="text-white/50">
              审核ID: {selectedStoryboard?.id} | 用户ID: {selectedStoryboard?.userId}
            </DialogDescription>
          </DialogHeader>
          {selectedStoryboard && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-h-[70vh] overflow-y-auto p-1 pr-4">
              {/* Left Column: Music2 & Music Info */}
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold text-lg mb-2 border-b border-white/10 pb-1">歌词</h4>
                  <div className="bg-black/30 p-3 rounded-md max-h-48 overflow-y-auto">
                    <p className="text-sm whitespace-pre-wrap font-mono">{selectedStoryboard.lyrics}</p>
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold text-lg mb-2 border-b border-white/10 pb-1">音乐信息</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <p><span className="font-semibold">BPM:</span> {parseStoryboard(selectedStoryboard.storyboard)?.musicInfo.bpm}</p>
                    <p><span className="font-semibold">调性:</span> {parseStoryboard(selectedStoryboard.storyboard)?.musicInfo.key}</p>
                    <p><span className="font-semibold">风格:</span> {parseStoryboard(selectedStoryboard.storyboard)?.musicInfo.style}</p>
                    <p><span className="font-semibold">情绪:</span> {parseStoryboard(selectedStoryboard.storyboard)?.musicInfo.emotion}</p>
                  </div>
                </div>
                 <div>
                  <h4 className="font-semibold text-lg mb-2 border-b border-white/10 pb-1">摘要</h4>
                  <div className="bg-black/30 p-3 rounded-md max-h-48 overflow-y-auto">
                    <p className="text-sm">{parseStoryboard(selectedStoryboard.storyboard)?.summary}</p>
                  </div>
                </div>
              </div>

              {/* Right Column: Scenes */}
              <div className="space-y-4">
                <h4 className="font-semibold text-lg mb-2 border-b border-white/10 pb-1">场景列表</h4>
                <div className="space-y-3">
                  {parseStoryboard(selectedStoryboard.storyboard)?.scenes.map((scene) => (
                    <div key={scene.sceneNumber} className="bg-black/30 p-3 rounded-md text-sm">
                      <p className="font-bold">场景 #{scene.sceneNumber} ({scene.timestamp} - {scene.duration})</p>
                      <p><span className="font-semibold">描述:</span> {scene.description}</p>
                      <p><span className="font-semibold">镜头:</span> {scene.cameraMovement}</p>
                      <p><span className="font-semibold">氛围:</span> {scene.mood}</p>
                      <p><span className="font-semibold">视觉元素:</span> {scene.visualElements.join(', ')}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Rejection Reason Input */}
               <div className="col-span-1 md:col-span-2">
                  <h4 className="font-semibold text-lg mb-2 border-b border-white/10 pb-1">审核操作</h4>
                  <Textarea
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="如果拒绝，请填写原因..."
                    className="bg-black/30 border-white/20 rounded-md w-full min-h-[100px]"
                    rows={4}
                  />
                </div>
            </div>
          )}
          <DialogFooter className="mt-4 gap-2 md:gap-0">
            <Button
              variant="outline"
              onClick={() => setSelectedStoryboard(null)}
              className="border-white/20 hover:bg-white/10"
            >
              关闭
            </Button>
            <div className="flex-grow" />
            <Button
              variant="destructive"
              onClick={() => handleReject(selectedStoryboard!.id)}
              disabled={isSubmitting || !rejectionReason.trim()}
              className="disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "拒绝"}
            </Button>
            <Button
              onClick={() => handleApprove(selectedStoryboard!.id)}
              disabled={isSubmitting}
              className="bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "通过"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Reject Modal */}
      <Dialog open={showBatchRejectModal} onOpenChange={setShowBatchRejectModal}>
        <DialogContent className="bg-[#1A1A1C] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle>批量拒绝审核</DialogTitle>
            <DialogDescription>
              您将拒绝 {selectedIds.length} 个分镜脚本。请输入拒绝原因，此原因将应用于所有选中的项目。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={batchRejectionReason}
            onChange={(e) => setBatchRejectionReason(e.target.value)}
            placeholder="输入批量拒绝的原因..."
            className="bg-black/30 border-white/20 rounded-md w-full min-h-[120px] mt-4"
            rows={5}
          />
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowBatchRejectModal(false)} className="border-white/20 hover:bg-white/10">取消</Button>
            <Button
              variant="destructive"
              onClick={handleBatchReject}
              disabled={isSubmitting || !batchRejectionReason.trim()}
              className="disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : `确认拒绝 ${selectedIds.length} 项`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

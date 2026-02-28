// @ts-nocheck
import Navbar from "@/components/Navbar";
import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useLocation, Link, useSearch } from "wouter";
// MaterialIcons replaced with lucide-react icons
// Image replaced with img tag
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

// ─── 状态标签颜色 ──────────────────────────────
const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "待审核", color: "#FF9F0A", bg: "rgba(255,159,10,0.15)" },
  scoring: { label: "评分中", color: "#5AC8FA", bg: "rgba(90,200,250,0.15)" },
  scored: { label: "已评分", color: "#30D158", bg: "rgba(48,209,88,0.15)" },
  failed: { label: "失败", color: "#FF453A", bg: "rgba(255,69,58,0.15)" },
};

const PLATFORM_NAMES: Record<string, string> = {
  douyin: "抖音",
  weixin_channels: "视频号",
  xiaohongshu: "小红书",
  bilibili: "B站",
};

type FilterStatus = "all" | "pending" | "scoring" | "scored" | "failed";

export default function AdminVideoReview() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<any>(null);
  const [adjustScore, setAdjustScore] = useState("");
  const [adjustNotes, setAdjustNotes] = useState("");
  const [flagNotes, setFlagNotes] = useState("");
  const [showScoreModal, setShowScoreModal] = useState(false);
  const [showFlagModal, setShowFlagModal] = useState(false);

  const videosQuery = trpc.showcase.adminGetAllVideos.useQuery(
    { status: filterStatus, limit: 50, offset: 0 },
    { enabled: isAuthenticated && user?.role === "admin" }
  );

  const adjustMutation = trpc.showcase.adminAdjustScore.useMutation({
    onSuccess: (data) => {
      if (true) alert(data.message);
      else toast(data.message);
      setShowScoreModal(false);
      setAdjustScore("");
      setAdjustNotes("");
      videosQuery.refetch();
    },
    onError: (err) => {
      if (true) alert(err.message);
      else toast(err.message);
    },
  });

  const flagMutation = trpc.showcase.adminFlagVideo.useMutation({
    onSuccess: () => {
      if (true) alert("操作成功");
      else toast("操作成功");
      setShowFlagModal(false);
      setFlagNotes("");
      videosQuery.refetch();
    },
    onError: (err) => {
      if (true) alert(err.message);
      else toast(err.message);
    },
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await videosQuery.refetch();
    setRefreshing(false);
  }, [videosQuery]);

  // ─── 权限检查 ──────────────────────────────
  if (!isAuthenticated || user?.role !== "admin") {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div>
          <span>⚡</span> /* TODO: replace MaterialIcons lock */
          <span>无权限访问</span>
          <span>此页面仅限管理员使用</span>
          <button onClick={() => window.history.back()}>
            <span>返回</span>
          </button>
        </div>
      </div>
    );
  }

  const videos = videosQuery.data?.videos || [];
  const total = videosQuery.data?.total || 0;

  const FILTERS: { id: FilterStatus; label: string }[] = [
    { id: "all", label: `全部 (${total})` },
    { id: "pending", label: "待审核" },
    { id: "scoring", label: "评分中" },
    { id: "scored", label: "已评分" },
    { id: "failed", label: "失败" },
  ];

  const renderVideoCard = ({ item }: { item: any }) => {
    const status = STATUS_MAP[item.scoreStatus] || STATUS_MAP.pending;
    return (
      <div>
      <Navbar />
        {/* 顶部：缩略图 + 基本信息 */}
        <div>
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl } contentFit="cover" />
          ) : (
            <div>
              <span>⚡</span> /* TODO: replace MaterialIcons videocam */
            </div>
          )}
          <div>
            <span>{item.title}</span>
            <div>
              <span>⚡</span> /* TODO: replace MaterialIcons person */
              <span>{item.user?.name || item.user?.email || `用户 #${item.userId}`}</span>
            </div>
            <div>
              <span>⚡</span> /* TODO: replace MaterialIcons schedule */
              <span>{new Date(item.createdAt).toLocaleString("zh-CN")}</span>
            </div>
          </div>
          <div>
            <span>{status.label}</span>
          </div>
        </div>

        {/* 评分信息 */}
        {item.viralScore != null && (
          <div>
            <div>
              <span>{item.viralScore}</span>
              <span>分</span>
            </div>
            <div>
              <span>Credits 奖励</span>
              <span>
                {item.creditsRewarded > 0 ? `+${item.creditsRewarded}` : "无"}
              </span>
            </div>
            <div>
              <span>展示状态</span>
              <span>
                {item.showcaseStatus === "showcased" ? "展厅展示" : item.showcaseStatus === "rejected" ? "已拒绝" : "未展示"}
              </span>
            </div>
          </div>
        )}

        {/* 平台链接 */}
        {item.platformLinks && item.platformLinks.length > 0 && (
          <div>
            {item.platformLinks.map((link: any, idx: number) => (
              <div key={idx}>
                <span>
                  {PLATFORM_NAMES[link.platform] || link.platform}
                </span>
                {link.playCount != null && (
                  <span>播放 {(link.playCount / 10000).toFixed(1)}万</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 管理员备注 */}
        {item.adminNotes && (
          <div>
            <span>⚡</span> /* TODO: replace MaterialIcons notes */
            <span>{item.adminNotes}</span>
          </div>
        )}

        {/* 操作按钮 */}
        <div>
          <button
            onClick={() => {
              setSelectedVideo(item);
              setAdjustScore(String(item.viralScore || ""));
              setShowScoreModal(true);
            }}
          >
            <span>⚡</span> /* TODO: replace MaterialIcons edit */
            <span>调整评分</span>
          </button>

          <button
            onClick={() => {
              setSelectedVideo(item);
              setShowFlagModal(true);
            }}
          >
            <span>⚡</span> /* TODO: replace MaterialIcons flag */
            <span>标记/处理</span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* 顶部导航 */}
      <div>
        <button onClick={() => window.history.back()}>
          <span>⚡</span> /* TODO: replace MaterialIcons arrow-back */
        </button>
        <span>视频审核面板</span>
        <div style={{ width: 40 }} />
      </div>

      {/* 统计摘要 */}
      <div>
        <div>
          <span>{total}</span>
          <span>总视频</span>
        </div>
        <div>
          <span>
            {videos.filter((v: any) => v.scoreStatus === "pending").length}
          </span>
          <span>待审核</span>
        </div>
        <div>
          <span>
            {videos.filter((v: any) => v.scoreStatus === "scored").length}
          </span>
          <span>已评分</span>
        </div>
        <div>
          <span>
            {videos.filter((v: any) => v.scoreStatus === "failed").length}
          </span>
          <span>失败</span>
        </div>
      </div>

      {/* 筛选器 */}
      <div  className="overflow-y-auto">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilterStatus(f.id)}
          >
            <span>
              {f.label}
            </span>
          </button>
        ))}
      </div>

      {/* 视频列表 */}
      {videosQuery.isPending ? (
        <div>
          <div className="flex justify-center"><span className="animate-spin">⏳</span></div>
          <span>加载中...</span>
        </div>
      ) : (
        <div
          data={videos}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderVideoCard}
          refreshControl={}
          ItemSeparatorComponent={() => <div style={{ height: 12 }} />}
          ListEmptyComponent={
            <div>
              <span>⚡</span> /* TODO: replace MaterialIcons inbox */
              <span>暂无视频</span>
            </div>
          }
        />
      )}

      {/* 评分调整 Modal */}
      <div /* TODO: Convert to Dialog */ style={{ display: showScoreModal ? 'flex' : 'none' }} onClick={() => setShowScoreModal(false)}>
        <div>
          <div>
            <span>调整评分</span>
            <span>
              {selectedVideo?.title} (当前: {selectedVideo?.viralScore ?? "未评分"})
            </span>

            <span>新评分 (0-100)</span>
            <input
              value={adjustScore}
              onChange={(e) => setAdjustScore(e.target.value)}
              placeholder="输入新评分" maxLength={3}
            />

            <span>备注（选填）</span>
            <input
              value={adjustNotes}
              onChange={(e) => setAdjustNotes(e.target.value)}
              placeholder="调整原因"
            />

            {/* 奖励预览 */}
            {adjustScore && (
              <div>
                <span>
                  评分 {adjustScore} 分 → Credits 奖励:{" "}
                  {Number(adjustScore) >= 90 ? "80" : Number(adjustScore) >= 80 ? "30" : "0"}
                </span>
              </div>
            )}

            <div>
              <button
                onClick={() => setShowScoreModal(false)}
              >
                <span>取消</span>
              </button>
              <button
                onClick={() => {
                  if (!adjustScore || isNaN(Number(adjustScore))) return;
                  adjustMutation.mutate({
                    videoId: selectedVideo.id,
                    newScore: Number(adjustScore),
                    notes: adjustNotes || undefined,
                  });
                }}
                disabled={adjustMutation.isPending}
              >
                {adjustMutation.isPending ? (
                  <div className="flex justify-center"><span className="animate-spin">⏳</span></div>
                ) : (
                  <span>确认调整</span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 标记/处理 Modal */}
      <div /* TODO: Convert to Dialog */ style={{ display: showFlagModal ? 'flex' : 'none' }} onClick={() => setShowFlagModal(false)}>
        <div>
          <div>
            <span>标记 / 处理视频</span>
            <span>{selectedVideo?.title}</span>

            <span>备注（选填）</span>
            <input
              value={flagNotes}
              onChange={(e) => setFlagNotes(e.target.value)}
              placeholder="处理原因"
            />

            <div>
              <button
                onClick={() => flagMutation.mutate({ videoId: selectedVideo.id, action: "flag", notes: flagNotes || undefined })}
              >
                <span>⚡</span> /* TODO: replace MaterialIcons flag */
                <span>标记异常</span>
              </button>

              <button
                onClick={() => flagMutation.mutate({ videoId: selectedVideo.id, action: "unflag", notes: flagNotes || undefined })}
              >
                <span>⚡</span> /* TODO: replace MaterialIcons check-circle */
                <span>解除标记</span>
              </button>

              <button
                onClick={() => flagMutation.mutate({ videoId: selectedVideo.id, action: "reject", notes: flagNotes || undefined })}
              >
                <span>⚡</span> /* TODO: replace MaterialIcons block */
                <span>拒绝展示</span>
              </button>
            </div>

            <button
              onClick={() => setShowFlagModal(false)}
            >
              <span>关闭</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


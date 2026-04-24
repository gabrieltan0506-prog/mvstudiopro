import React, { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Download, Trash2, Clock, Star, Loader2, Image as ImageIcon,
  Music, Video, Layers, Box, Sparkles, FileText, ChevronLeft, ChevronRight,
} from "lucide-react";
import { FavoriteButton } from "@/components/CreationManager";
import { formatDateGMT8 } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = {
  idol_image: "偶像圖片",
  idol_3d: "3D 模型",
  music: "音樂",
  video: "視頻",
  storyboard: "分鏡/腳本",
  kling_video: "Kling 視頻",
  kling_lipsync: "Kling 對嘴",
  kling_motion: "Kling 動作",
  kling_image: "Kling 圖片",
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  idol_image: ImageIcon,
  idol_3d: Box,
  music: Music,
  video: Video,
  storyboard: Layers,
  kling_video: Video,
  kling_lipsync: Video,
  kling_motion: Video,
  kling_image: ImageIcon,
};

const FILTER_TABS = [
  { label: "全部", value: "" },
  { label: "圖片", value: "idol_image" },
  { label: "腳本/分鏡", value: "storyboard" },
  { label: "視頻", value: "kling_video" },
  { label: "音樂", value: "music" },
];

export default function MyWorks() {
  const { user, isAuthenticated, loading } = useAuth({ autoFetch: true, redirectOnUnauthenticated: true, redirectPath: "/login" });
  const [activeType, setActiveType] = useState<string>("");
  const [page, setPage] = useState(1);
  const [showFavOnly, setShowFavOnly] = useState(false);

  const creationsQuery = trpc.creations.list.useQuery(
    { type: activeType as any || undefined, page, pageSize: 16 },
    { enabled: !showFavOnly && isAuthenticated }
  );
  const favoritesQuery = trpc.creations.listFavorites.useQuery(
    { type: activeType as any || undefined, page, pageSize: 16 },
    { enabled: showFavOnly && isAuthenticated }
  );
  const deleteMutation = trpc.creations.delete.useMutation();
  const utils = trpc.useUtils();

  const qData = showFavOnly ? favoritesQuery.data : creationsQuery.data;
  const isLoading = showFavOnly ? favoritesQuery.isLoading : creationsQuery.isLoading;
  const items = showFavOnly
    ? ((qData as any)?.items?.map((f: any) => ({ ...f.creation, favoriteId: f.favoriteId })) ?? [])
    : ((qData as any)?.items ?? []);
  const totalPages = (qData as any)?.totalPages ?? 1;

  const handleDelete = async (id: number) => {
    if (!confirm("確定要刪除此作品嗎？")) return;
    try {
      await deleteMutation.mutateAsync({ id });
      toast.success("已刪除");
      utils.creations.list.invalidate();
      utils.creations.listFavorites.invalidate();
    } catch (err: any) {
      toast.error(err?.message || "刪除失敗");
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#06040f] flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#06040f] text-white">
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-white/8 bg-[rgba(6,4,15,0.85)] backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/" className="text-white/50 hover:text-white transition">
              <ChevronLeft className="h-5 w-5" />
            </a>
            <div>
              <h1 className="text-lg font-black">我的作品</h1>
              <p className="text-xs text-white/40">圖片與腳本永久保存，視頻請及時下載</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowFavOnly(false); setPage(1); }}
              className={`px-3 py-1.5 text-xs rounded-full font-semibold transition ${!showFavOnly ? "bg-purple-600 text-white" : "bg-white/8 text-white/60 hover:text-white"}`}
            >
              全部作品
            </button>
            <button
              onClick={() => { setShowFavOnly(true); setPage(1); }}
              className={`px-3 py-1.5 text-xs rounded-full font-semibold flex items-center gap-1 transition ${showFavOnly ? "bg-red-600 text-white" : "bg-white/8 text-white/60 hover:text-white"}`}
            >
              <Star className="h-3 w-3" /> 收藏
            </button>
          </div>
        </div>

        {/* Type filter tabs */}
        <div className="max-w-6xl mx-auto px-4 pb-3 flex gap-2 overflow-x-auto no-scrollbar">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => { setActiveType(tab.value); setPage(1); }}
              className={`flex-shrink-0 px-4 py-1.5 text-xs rounded-full font-semibold transition ${activeType === tab.value ? "bg-white/15 text-white border border-white/20" : "text-white/50 hover:text-white"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Video reminder banner */}
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/8 px-5 py-4 text-sm text-amber-300">
          <Download className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <span className="font-semibold">重要提醒：</span>
            視頻文件有過期時限，請盡快下載保存到本地。
            圖片、腳本與分析快照已永久保存在本頁面。
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-16">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-purple-400" />
            <p className="text-sm text-white/40 mt-3">載入中...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20">
            <Sparkles className="h-12 w-12 mx-auto opacity-20 mb-4" />
            <p className="text-white/40">{showFavOnly ? "暫無收藏作品" : "暫無生成記錄，去創作第一個作品吧！"}</p>
            <a href="/" className="mt-4 inline-block px-5 py-2.5 rounded-full bg-purple-600 text-white text-sm font-semibold hover:bg-purple-500 transition">
              開始創作
            </a>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {items.map((item: any) => {
                const Icon = TYPE_ICONS[item.type] || Sparkles;
                const isVideo = item.type?.includes("video") || item.type?.includes("kling");
                const isAnalysis = item.metadata && (() => { try { const m = JSON.parse(item.metadata ?? "{}"); return m?.isSnapshot; } catch { return false; } })();
                const isExpiringSoon = item.expiresAt && new Date(item.expiresAt).getTime() - Date.now() < 2 * 24 * 60 * 60 * 1000;
                const scriptPreview = (() => {
                  try { const m = JSON.parse(item.metadata ?? "{}"); return m?.script || m?.summary || null; } catch { return null; }
                })();

                return (
                  <div
                    key={item.id}
                    className={`bg-white/[0.04] rounded-2xl overflow-hidden border transition group ${
                      isExpiringSoon ? "border-amber-600/40" : isVideo ? "border-blue-600/30" : "border-white/8 hover:border-white/16"
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="aspect-square bg-black/30 relative overflow-hidden">
                      {item.thumbnailUrl || item.outputUrl ? (
                        isVideo ? (
                          <video
                            src={item.outputUrl}
                            className="w-full h-full object-cover"
                            muted
                            playsInline
                            onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
                            onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                          />
                        ) : (
                          <img
                            src={item.thumbnailUrl || item.outputUrl}
                            alt={item.title || ""}
                            className="w-full h-full object-cover"
                          />
                        )
                      ) : isAnalysis ? (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-purple-900/40 to-blue-900/30">
                          <FileText className="h-8 w-8 text-purple-400 opacity-60" />
                          <span className="text-xs text-white/40 text-center px-2">{item.quality}</span>
                        </div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Icon className="h-8 w-8 text-white/20" />
                        </div>
                      )}

                      {/* Hover actions */}
                      <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
                        {item.outputUrl && (
                          <a href={item.outputUrl} target="_blank" rel="noopener noreferrer"
                            className="p-2 bg-blue-600 rounded-full text-white hover:bg-blue-500">
                            <Download className="h-4 w-4" />
                          </a>
                        )}
                        <FavoriteButton creationId={item.id} size="md" />
                        <button onClick={() => handleDelete(item.id)}
                          className="p-2 bg-red-600/80 rounded-full text-white hover:bg-red-500">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      {/* Badges */}
                      {isVideo && (
                        <div className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-blue-600/90 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                          <Download className="h-2.5 w-2.5" /><span>請下載</span>
                        </div>
                      )}
                      {isExpiringSoon && (
                        <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-amber-600 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                          <Clock className="h-2.5 w-2.5" /><span>即將過期</span>
                        </div>
                      )}
                      {isAnalysis && (
                        <div className="absolute bottom-1.5 left-1.5 bg-purple-600/80 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                          分析快照
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="p-2.5">
                      <p className="text-xs font-semibold text-white truncate">{item.title || TYPE_LABELS[item.type] || item.type}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] text-white/35">{item.quality || TYPE_LABELS[item.type] || item.type}</span>
                        {item.creditsUsed > 0 && (
                          <span className="text-[10px] text-yellow-500/80">{item.creditsUsed} cr</span>
                        )}
                      </div>
                      {/* GMT+8 creation time */}
                      <p className="text-[10px] text-white/25 mt-1">{formatDateGMT8(item.createdAt)}</p>
                      {scriptPreview && (
                        <p className="text-[10px] text-white/30 mt-0.5 line-clamp-2 leading-snug">{scriptPreview}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-8">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="flex items-center gap-1 px-4 py-2 text-sm bg-white/8 text-white/60 rounded-full disabled:opacity-40 hover:bg-white/12 transition"
                >
                  <ChevronLeft className="h-4 w-4" /> 上一頁
                </button>
                <span className="text-sm text-white/40">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  className="flex items-center gap-1 px-4 py-2 text-sm bg-white/8 text-white/60 rounded-full disabled:opacity-40 hover:bg-white/12 transition"
                >
                  下一頁 <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

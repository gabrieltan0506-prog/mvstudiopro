/**
 * CreationManager - 通用的生成記錄、收藏管理和到期提醒組件
 * 
 * 可嵌入任何生成頁面，提供：
 * - 收藏/取消收藏按鈕
 * - 到期提醒 Banner
 * - 生成歷史記錄列表
 */

import React, { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Heart, HeartOff, Download, Trash2, Clock, AlertTriangle,
  ChevronDown, ChevronUp, Star, Loader2, Image as ImageIcon,
  Music, Video, Layers, Box, Sparkles,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────

type CreationType =
  | "idol_image" | "idol_3d" | "music" | "video" | "storyboard"
  | "kling_video" | "kling_lipsync" | "kling_motion" | "kling_image";

const TYPE_LABELS: Record<CreationType, string> = {
  idol_image: "偶像圖片",
  idol_3d: "3D 模型",
  music: "音樂",
  video: "視頻",
  storyboard: "分鏡圖",
  kling_video: "可靈視頻",
  kling_lipsync: "口型同步",
  kling_motion: "動作遷移",
  kling_image: "可靈圖片",
};

const TYPE_ICONS: Record<CreationType, React.ElementType> = {
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

// ─── Favorite Button ────────────────────────────────

export function FavoriteButton({ creationId, size = "sm" }: { creationId: number; size?: "sm" | "md" }) {
  const { data: favData } = trpc.creations.isFavorited.useQuery({ creationId });
  const addFav = trpc.creations.addFavorite.useMutation();
  const removeFav = trpc.creations.removeFavorite.useMutation();
  const utils = trpc.useUtils();
  const [loading, setLoading] = useState(false);

  const isFavorited = favData?.favorited ?? false;

  const handleToggle = async () => {
    setLoading(true);
    try {
      if (isFavorited) {
        await removeFav.mutateAsync({ creationId });
        toast.success("已取消收藏");
      } else {
        await addFav.mutateAsync({ creationId });
        toast.success("已加入收藏");
      }
      utils.creations.isFavorited.invalidate({ creationId });
      utils.creations.listFavorites.invalidate();
      utils.creations.batchCheckFavorites.invalidate();
    } catch (err: any) {
      toast.error(err?.message || "操作失敗");
    } finally {
      setLoading(false);
    }
  };

  const iconSize = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const btnSize = size === "sm" ? "p-1.5" : "p-2";

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className={`${btnSize} rounded-full transition-colors ${
        isFavorited
          ? "text-red-400 hover:text-red-300 bg-red-900/30"
          : "text-gray-400 hover:text-red-400 hover:bg-red-900/20"
      }`}
      title={isFavorited ? "取消收藏" : "加入收藏"}
    >
      {loading ? (
        <Loader2 className={`${iconSize} animate-spin`} />
      ) : isFavorited ? (
        <Heart className={`${iconSize} fill-current`} />
      ) : (
        <Heart className={iconSize} />
      )}
    </button>
  );
}

// ─── Batch Favorite Checker ─────────────────────────

export function useBatchFavorites(creationIds: number[]) {
  const stableIds = useMemo(() => creationIds, [JSON.stringify(creationIds)]);
  const { data } = trpc.creations.batchCheckFavorites.useQuery(
    { creationIds: stableIds },
    { enabled: stableIds.length > 0 }
  );
  return data?.favorites ?? {};
}

// ─── Expiry Warning Banner ──────────────────────────

export function ExpiryWarningBanner() {
  const { data } = trpc.creations.getExpiringItems.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000, // 5 minutes
  });
  const [expanded, setExpanded] = useState(false);

  if (!data || data.count === 0) return null;

  const urgentItems = data.items.filter((item: any) => item.daysUntilExpiry <= 2);
  const warningItems = data.items.filter((item: any) => item.daysUntilExpiry > 2);

  return (
    <div className="bg-amber-900/30 border border-amber-700/50 rounded-xl p-4 mb-6">
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-3">
          <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-amber-300">
              {urgentItems.length > 0
                ? `${urgentItems.length} 個作品即將過期！`
                : `${data.count} 個作品將在近期過期`}
            </h3>
            <p className="text-xs text-amber-400/70 mt-1">
              免費用戶作品保留 10 天，初級會員 3 個月，高級會員 6 個月。請及時下載或升級方案。
            </p>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-amber-400 hover:text-amber-300 p-1"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
          {data.items.map((item: any) => {
            const Icon = TYPE_ICONS[item.type as CreationType] || Sparkles;
            const isUrgent = item.daysUntilExpiry <= 2;
            return (
              <div
                key={item.id}
                className={`flex items-center justify-between p-2 rounded-lg ${
                  isUrgent ? "bg-red-900/30 border border-red-800/40" : "bg-gray-800/50"
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Icon className={`h-4 w-4 ${isUrgent ? "text-red-400" : "text-amber-400"}`} />
                  <span className="text-sm text-gray-300 truncate max-w-[200px]">
                    {item.title || TYPE_LABELS[item.type as CreationType] || item.type}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`text-xs font-medium ${isUrgent ? "text-red-400" : "text-amber-400"}`}>
                    {item.daysUntilExpiry <= 0 ? "今天過期" : `${item.daysUntilExpiry} 天後過期`}
                  </span>
                  {item.outputUrl && (
                    <a
                      href={item.outputUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Creation History Panel ─────────────────────────

export function CreationHistoryPanel({
  type,
  title = "生成歷史",
}: {
  type?: CreationType;
  title?: string;
}) {
  const [page, setPage] = useState(1);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const creationsQuery = trpc.creations.list.useQuery(
    { type, page, pageSize: 12 },
    { enabled: !showFavoritesOnly }
  );
  const favoritesQuery = trpc.creations.listFavorites.useQuery(
    { type, page, pageSize: 12 },
    { enabled: showFavoritesOnly }
  );

  const deleteMutation = trpc.creations.delete.useMutation();
  const utils = trpc.useUtils();

  const data = showFavoritesOnly ? favoritesQuery.data : creationsQuery.data;
  const isLoading = showFavoritesOnly ? favoritesQuery.isLoading : creationsQuery.isLoading;

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

  const items = showFavoritesOnly
    ? (data as any)?.items?.map((f: any) => ({ ...f.creation, favoriteId: f.favoriteId })) ?? []
    : (data as any)?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-white">{title}</h3>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => { setShowFavoritesOnly(false); setPage(1); }}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              !showFavoritesOnly ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            全部
          </button>
          <button
            onClick={() => { setShowFavoritesOnly(true); setPage(1); }}
            className={`px-3 py-1 text-xs rounded-full transition-colors flex items-center space-x-1 ${
              showFavoritesOnly ? "bg-red-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            <Star className="h-3 w-3" />
            <span>收藏</span>
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-500" />
          <p className="text-sm text-gray-500 mt-2">載入中...</p>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Sparkles className="h-8 w-8 mx-auto opacity-30" />
          <p className="text-sm mt-2">{showFavoritesOnly ? "暫無收藏" : "暫無生成記錄"}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {items.map((item: any) => {
              const Icon = TYPE_ICONS[item.type as CreationType] || Sparkles;
              const isExpiringSoon = item.expiresAt && new Date(item.expiresAt).getTime() - Date.now() < 2 * 24 * 60 * 60 * 1000;
              return (
                <div
                  key={item.id}
                  className={`bg-gray-800/80 rounded-lg overflow-hidden border ${
                    isExpiringSoon ? "border-amber-700/60" : "border-gray-700/40"
                  } hover:border-gray-600 transition-colors group`}
                >
                  {/* Thumbnail */}
                  <div className="aspect-square bg-gray-900 relative">
                    {item.thumbnailUrl || item.outputUrl ? (
                      item.type?.includes("video") || item.type === "kling_lipsync" || item.type === "kling_motion" ? (
                        <video
                          src={item.outputUrl}
                          className="w-full h-full object-cover"
                          muted
                          onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
                          onMouseLeave={(e) => { (e.target as HTMLVideoElement).pause(); (e.target as HTMLVideoElement).currentTime = 0; }}
                        />
                      ) : (
                        <img
                          src={item.thumbnailUrl || item.outputUrl}
                          alt={item.title || ""}
                          className="w-full h-full object-cover"
                        />
                      )
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Icon className="h-8 w-8 text-gray-600" />
                      </div>
                    )}

                    {/* Overlay actions */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2">
                      {item.outputUrl && (
                        <a
                          href={item.outputUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 bg-blue-600 rounded-full text-white hover:bg-blue-700"
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      )}
                      <FavoriteButton creationId={item.id} size="md" />
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="p-2 bg-red-600 rounded-full text-white hover:bg-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Expiry badge */}
                    {isExpiringSoon && (
                      <div className="absolute top-1 left-1 bg-amber-600 text-white text-[10px] px-1.5 py-0.5 rounded-full flex items-center space-x-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        <span>即將過期</span>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-2">
                    <p className="text-xs text-gray-300 truncate">{item.title || TYPE_LABELS[item.type as CreationType]}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-gray-500">
                        {item.quality || item.type}
                      </span>
                      {item.creditsUsed > 0 && (
                        <span className="text-[10px] text-yellow-500">{item.creditsUsed} credits</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {(data as any)?.totalPages > 1 && (
            <div className="flex items-center justify-center space-x-2 pt-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-sm bg-gray-800 text-gray-300 rounded-md disabled:opacity-50"
              >
                上一頁
              </button>
              <span className="text-sm text-gray-500">
                {page} / {(data as any)?.totalPages}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= ((data as any)?.totalPages ?? 1)}
                className="px-3 py-1 text-sm bg-gray-800 text-gray-300 rounded-md disabled:opacity-50"
              >
                下一頁
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

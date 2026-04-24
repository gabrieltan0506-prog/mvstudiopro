import React from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { formatDateGMT8 } from "@/lib/utils";
import { Image as ImageIcon, Video, Layers, Music, Box, FolderOpen, ArrowRight } from "lucide-react";

const TYPE_ICONS: Record<string, React.ElementType> = {
  idol_image: ImageIcon,
  kling_image: ImageIcon,
  idol_3d: Box,
  music: Music,
  video: Video,
  kling_video: Video,
  kling_lipsync: Video,
  kling_motion: Video,
  storyboard: Layers,
};

const TYPE_LABELS: Record<string, string> = {
  idol_image: "圖片",
  kling_image: "圖片",
  idol_3d: "3D",
  music: "音樂",
  video: "視頻",
  kling_video: "視頻",
  kling_lipsync: "對嘴",
  kling_motion: "動作",
  storyboard: "腳本",
};

export default function HomeMyWorks() {
  const { isAuthenticated, loading } = useAuth({ autoFetch: true });
  const creationsQuery = trpc.creations.list.useQuery(
    { page: 1, pageSize: 8, type: undefined },
    { enabled: !!isAuthenticated, staleTime: 30_000, retry: false }
  );

  if (loading || !isAuthenticated) return null;

  const items = creationsQuery.data?.items ?? [];
  const total = creationsQuery.data?.total ?? 0;

  return (
    <section style={{ padding: "60px 0 20px", maxWidth: 1100, margin: "0 auto", paddingLeft: 24, paddingRight: 24 }}>
      {/* 標題列 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <FolderOpen size={22} color="#a78bfa" />
          <span style={{ fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: 1 }}>我的作品</span>
          {total > 0 && (
            <span style={{ fontSize: 12, color: "rgba(167,139,250,0.8)", background: "rgba(139,92,246,0.15)", borderRadius: 99, padding: "2px 10px" }}>
              共 {total} 件
            </span>
          )}
        </div>
        <a
          href="/my-works"
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "#a78bfa", textDecoration: "none", fontWeight: 600, opacity: 0.85 }}
        >
          查看全部 <ArrowRight size={14} />
        </a>
      </div>

      {/* 作品格 */}
      {creationsQuery.isLoading ? (
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, textAlign: "center", padding: "40px 0" }}>載入中…</div>
      ) : items.length === 0 ? (
        <div style={{
          border: "1.5px dashed rgba(139,92,246,0.25)", borderRadius: 16, padding: "48px 20px",
          textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 14,
        }}>
          還沒有作品，去生成第一件吧！
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 14 }}>
          {items.map((item: any) => {
            const Icon = TYPE_ICONS[item.type] ?? FolderOpen;
            const label = TYPE_LABELS[item.type] ?? item.type;
            const isVideo = item.type?.includes("video") || item.type?.includes("lipsync") || item.type?.includes("motion");
            const thumb = item.thumbnailUrl || item.outputUrl;
            return (
              <div
                key={item.id}
                style={{
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 12, overflow: "hidden", position: "relative", cursor: "default",
                  transition: "border-color 0.2s",
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(139,92,246,0.4)")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)")}
              >
                {/* 縮圖 */}
                <div style={{ width: "100%", aspectRatio: "1/1", background: "rgba(0,0,0,0.3)", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {thumb ? (
                    <img src={thumb} alt={item.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <Icon size={36} color="rgba(167,139,250,0.4)" />
                  )}
                  {isVideo && (
                    <div style={{ position: "absolute", top: 6, right: 6, background: "rgba(239,68,68,0.85)", borderRadius: 4, padding: "2px 6px", fontSize: 10, color: "#fff", fontWeight: 700 }}>
                      請下載
                    </div>
                  )}
                  <div style={{ position: "absolute", bottom: 5, left: 6, background: "rgba(0,0,0,0.6)", borderRadius: 4, padding: "2px 7px", fontSize: 10, color: "rgba(255,255,255,0.85)" }}>
                    {label}
                  </div>
                </div>
                {/* 資訊 */}
                <div style={{ padding: "8px 10px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.title || "未命名"}
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 3 }}>
                    {formatDateGMT8(item.createdAt, { showTime: false })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {total > 8 && (
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <a href="/my-works" style={{ fontSize: 13, color: "#a78bfa", textDecoration: "none", fontWeight: 600 }}>
            查看全部 {total} 件作品 →
          </a>
        </div>
      )}
    </section>
  );
}

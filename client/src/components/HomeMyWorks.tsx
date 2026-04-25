import React from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { formatDateGMT8 } from "@/lib/utils";
import { Image as ImageIcon, Video, Layers, Music, Box, FolderOpen, ArrowRight, FileText, BarChart2 } from "lucide-react";

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
  idol_image: "图片",
  kling_image: "图片",
  idol_3d: "3D",
  music: "音乐",
  video: "视频",
  kling_video: "视频",
  kling_lipsync: "对嘴",
  kling_motion: "动作",
  storyboard: "脚本",
};

const SNAPSHOT_GRADIENTS: Record<string, string> = {
  growth_camp: "linear-gradient(135deg, #3b1f6e 0%, #1a0a35 100%)",
  platform: "linear-gradient(135deg, #0c3460 0%, #071528 100%)",
};

const SNAPSHOT_LABELS: Record<string, string> = {
  growth_camp: "成长营分析",
  platform: "平台趋势分析",
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
      {/* 标题列 */}
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
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, textAlign: "center", padding: "40px 0" }}>载入中…</div>
      ) : items.length === 0 ? (
        <div style={{
          border: "1.5px dashed rgba(139,92,246,0.25)", borderRadius: 16, padding: "48px 20px",
          textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 14,
        }}>
          还没有作品，去生成第一件吧！
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 14 }}>
          {items.map((item: any) => {
            const isSnapshot = item.metadata?.isSnapshot === true;
            const analysisType: string = item.metadata?.analysisType ?? "growth_camp";
            const summary: string = item.metadata?.summary ?? "";
            const snapshotLabel = SNAPSHOT_LABELS[analysisType] ?? "分析快照";
            const snapshotGrad = SNAPSHOT_GRADIENTS[analysisType] ?? SNAPSHOT_GRADIENTS.growth_camp;

            const Icon = TYPE_ICONS[item.type] ?? FolderOpen;
            const label = TYPE_LABELS[item.type] ?? item.type;
            const isVideo = item.type?.includes("video") || item.type?.includes("lipsync") || item.type?.includes("motion");
            const thumb = item.thumbnailUrl || item.outputUrl;
            const href = isSnapshot ? `/my-works/${item.id}` : undefined;

            const cardContent = (
              <div
                style={{
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 12, overflow: "hidden", position: "relative",
                  cursor: isSnapshot ? "pointer" : "default",
                  transition: "border-color 0.2s, transform 0.15s",
                  textDecoration: "none",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = "rgba(139,92,246,0.5)";
                  if (isSnapshot) e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {isSnapshot ? (
                  /* ── 分析快照卡片 ── */
                  <div style={{ width: "100%", aspectRatio: "1/1", background: snapshotGrad, position: "relative", padding: "14px 12px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(255,255,255,0.12)", borderRadius: 6, padding: "2px 7px", fontSize: 9, color: "rgba(255,255,255,0.75)", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 8 }}>
                        {analysisType === "platform"
                          ? <BarChart2 size={9} />
                          : <FileText size={9} />}
                        {snapshotLabel}
                      </div>
                      {summary && (
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical" as const }}>
                          {summary.slice(0, 120)}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
                      点击查看完整报告 →
                    </div>
                  </div>
                ) : (
                  /* ── 一般创作缩图 ── */
                  <div style={{ width: "100%", aspectRatio: "1/1", background: "rgba(0,0,0,0.3)", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {thumb ? (
                      <img src={thumb} alt={item.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <Icon size={36} color="rgba(167,139,250,0.4)" />
                    )}
                    {isVideo && (
                      <div style={{ position: "absolute", top: 6, right: 6, background: "rgba(239,68,68,0.85)", borderRadius: 4, padding: "2px 6px", fontSize: 10, color: "#fff", fontWeight: 700 }}>
                        请下载
                      </div>
                    )}
                    <div style={{ position: "absolute", bottom: 5, left: 6, background: "rgba(0,0,0,0.6)", borderRadius: 4, padding: "2px 7px", fontSize: 10, color: "rgba(255,255,255,0.85)" }}>
                      {label}
                    </div>
                  </div>
                )}
                {/* 资讯 */}
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

            return isSnapshot
              ? <a key={item.id} href={href} style={{ textDecoration: "none", display: "block" }}>{cardContent}</a>
              : <div key={item.id}>{cardContent}</div>;
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

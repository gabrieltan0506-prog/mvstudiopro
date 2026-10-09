import React, { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { copyText } from "@/lib/copyText";
import { formatDateGMT8 } from "@/lib/utils";
import { toast } from "sonner";
import { Image as ImageIcon, Video, Layers, Music, Box, FolderOpen, ArrowRight, FileText, BarChart2, Copy, Check, ExternalLink } from "lucide-react";

const TYPE_ICONS: Record<string, React.ElementType> = {
  idol_image: ImageIcon,
  kling_image: ImageIcon,
  photo_upscale_image: ImageIcon,
  photo_restore_image: ImageIcon,
  photo_animation_video: Video,
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
  photo_upscale_image: "高清放大",
  photo_restore_image: "老照片修复",
  photo_animation_video: "照片动画",
  idol_3d: "3D",
  music: "音乐",
  video: "视频",
  kling_video: "视频",
  kling_lipsync: "对嘴",
  kling_motion: "动作",
  storyboard: "脚本",
  platform_session_bundle: "平台全案",
  advanced_decision_report: "战略全景",
  platform_topic_frame: "平台封面",
  deep_research_report: "深潜研报",
};

const SNAPSHOT_GRADIENTS: Record<string, string> = {
  growth_camp: "linear-gradient(135deg, var(--hp-peach), var(--hp-card))",
  platform: "linear-gradient(135deg, var(--hp-blush), var(--hp-card))",
};

const SNAPSHOT_LABELS: Record<string, string> = {
  growth_camp: "成长营分析",
  platform: "平台趋势分析",
  platform_session_bundle: "平台全案作品包",
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
          <span style={{ fontSize: 20, fontWeight: 800, color: "var(--hp-ink)", letterSpacing: 1 }}>我的作品</span>
          {total > 0 && (
            <span style={{ fontSize: 12, color: "var(--hp-accent)", background: "var(--hp-card)", borderRadius: 99, padding: "2px 10px" }}>
              共 {total} 件
            </span>
          )}
        </div>
        <a
          href="/my-works"
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--hp-accent)", textDecoration: "none", fontWeight: 600, opacity: 0.85 }}
        >
          查看全部 <ArrowRight size={14} />
        </a>
      </div>

      {/* 作品格 */}
      {creationsQuery.isLoading ? (
        <div style={{ color: "var(--hp-muted)", fontSize: 14, textAlign: "center", padding: "40px 0" }}>载入中…</div>
      ) : items.length === 0 ? (
        <div style={{
          border: "1.5px dashed var(--hp-line)", borderRadius: 16, padding: "48px 20px",
          textAlign: "center", color: "var(--hp-muted)", fontSize: 14,
        }}>
          还没有作品，去生成第一件吧！
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((item: any) => {
            const isBundle =
              item.type === "platform_session_bundle" || item.metadata?.isPlatformSessionBundle === true;
            const isSnapshot = item.metadata?.isSnapshot === true || isBundle;
            const analysisType: string = isBundle
              ? "platform_session_bundle"
              : (item.metadata?.analysisType ?? "growth_camp");
            const summary: string = item.metadata?.summary ?? "";
            const snapshotLabel =
              SNAPSHOT_LABELS[analysisType] ??
              (isBundle ? "平台全案作品包" : "分析快照");
            const snapshotGrad =
              SNAPSHOT_GRADIENTS[analysisType === "platform_session_bundle" ? "platform" : analysisType] ??
              SNAPSHOT_GRADIENTS.growth_camp;
            const Icon = TYPE_ICONS[item.type] ?? FolderOpen;
            const label = TYPE_LABELS[item.type] ?? item.type;
            const isVideo = item.type?.includes("video") || item.type?.includes("lipsync") || item.type?.includes("motion");
            const thumb = item.thumbnailUrl || item.outputUrl;
            const viewUrl = `/my-works/${item.id}`;
            const fullUrl = typeof window !== "undefined" ? `${window.location.origin}${viewUrl}` : viewUrl;

            if (isSnapshot) {
              return <SnapshotCard key={item.id} item={item} analysisType={analysisType} summary={summary} snapshotLabel={snapshotLabel} snapshotGrad={snapshotGrad} viewUrl={viewUrl} fullUrl={fullUrl} />;
            }

            return (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--hp-card)", border: "1px solid var(--hp-line)", borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ width: 44, height: 44, borderRadius: 8, background: "var(--hp-card)", flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {thumb
                    ? <img src={thumb} alt={item.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <Icon size={22} color="rgba(167,139,250,0.5)" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--hp-accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title || "未命名"}</div>
                  <div style={{ fontSize: 11, color: "var(--hp-muted)", marginTop: 2 }}>{label} · {formatDateGMT8(item.createdAt, { showTime: false })}</div>
                </div>
                {isVideo && <div style={{ fontSize: 10, background: "var(--hp-card)", color: "var(--hp-danger)", border: "1px solid var(--hp-line)", borderRadius: 4, padding: "2px 7px", flexShrink: 0 }}>请下载</div>}
              </div>
            );
          })}
        </div>
      )}

      {items.length === 0 && !creationsQuery.isLoading && (
        <div style={{ textAlign: "center", padding: "32px 0", color: "var(--hp-muted)", fontSize: 13 }}>
          暂无作品记录，开始分析后会自动保存在这里
        </div>
      )}

      {total > 8 && (
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <a href="/my-works" style={{ fontSize: 13, color: "var(--hp-accent)", textDecoration: "none", fontWeight: 600 }}>
            查看全部 {total} 件作品 →
          </a>
        </div>
      )}
    </section>
  );
}

// ── 分析快照横向卡片 ──────────────────────────────────────────
function SnapshotCard({ item, analysisType, summary, snapshotLabel, snapshotGrad, viewUrl, fullUrl }: {
  item: any; analysisType: string; summary: string; snapshotLabel: string;
  snapshotGrad: string; viewUrl: string; fullUrl: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (await copyText(fullUrl)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("链接复制没成功", { description: fullUrl });
    }
  };

  // Extract a clean 1-2 sentence brief from summary
  const brief = summary
    ? summary.replace(/#+\s*/g, "").split(/[。\n]/)[0]?.trim().slice(0, 100) ?? ""
    : "";

  return (
    <a href={viewUrl} style={{ textDecoration: "none", display: "block" }}>
      <div
        style={{
          background: snapshotGrad,
          border: "1px solid var(--hp-line)",
          borderRadius: 12,
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          transition: "border-color 0.2s, transform 0.15s",
          cursor: "pointer",
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(167,139,250,0.45)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; e.currentTarget.style.transform = "none"; }}
      >
        {/* 顶部：标签 + 日期 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--hp-card)", borderRadius: 6, padding: "3px 9px", fontSize: 10, color: "var(--hp-accent)", fontWeight: 700, letterSpacing: "0.06em" }}>
            {analysisType === "platform" ? <BarChart2 size={10} /> : <FileText size={10} />}
            {snapshotLabel}
          </div>
          <span style={{ fontSize: 11, color: "var(--hp-muted)" }}>{formatDateGMT8(item.createdAt, { showTime: false })}</span>
        </div>

        {/* 标题 */}
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--hp-ink)", lineHeight: 1.4 }}>
          {item.title || snapshotLabel}
        </div>

        {/* 简介摘要 */}
        {brief && (
          <div style={{ fontSize: 12, color: "var(--hp-muted)", lineHeight: 1.6 }}>
            {brief}…
          </div>
        )}

        {/* URL + 操作 */}
        <div
          style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--hp-card)", borderRadius: 7, padding: "7px 10px", marginTop: 2 }}
          onClick={e => e.preventDefault()}
        >
          <span style={{ flex: 1, fontSize: 11, color: "var(--hp-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace" }}>
            {fullUrl}
          </span>
          <button
            onClick={handleCopy}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 5, border: "1px solid var(--hp-line)", background: copied ? "var(--hp-accent-soft)" : "var(--hp-card)", color: copied ? "var(--hp-success)" : "var(--hp-muted)", fontSize: 11, cursor: "pointer", transition: "all 0.2s", flexShrink: 0 }}
          >
            {copied ? <><Check size={11} /> 已复制</> : <><Copy size={11} /> 复制链接</>}
          </button>
          <a
            href={viewUrl}
            style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 8px", borderRadius: 5, border: "1px solid var(--hp-line)", background: "var(--hp-card)", color: "var(--hp-accent)", fontSize: 11, textDecoration: "none", flexShrink: 0 }}
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink size={11} /> 查看报告
          </a>
        </div>
      </div>
    </a>
  );
}

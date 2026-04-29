/**
 * 战略 PDF 模板选择器（带封面 + 内文页缩略预览）
 *
 * v4：5 套活泼模板，颜色与 server/services/pdfTemplate.ts buildPalette 严格保持一致；
 * 每张卡片由「封面侧」+「内文一页侧」并排组成，所见即所得。
 */
import React from "react";

export type PdfStyleKey =
  | "spring-mint"
  | "neon-tech"
  | "sunset-coral"
  | "ocean-fresh"
  | "business-bright";

type Palette = {
  // 内文页配色
  bg: string;
  textMain: string;
  textMuted: string;
  primary: string;     // H1
  accent: string;      // H3 / 强调
  rule: string;
  tableHeadBg: string;
  tableHeadText: string;
  // 封面配色
  coverBg: string;       // 纯色兜底
  coverGradient: string; // CSS gradient（与 pdfTemplate.ts 对齐）
  coverGold: string;
  coverTextLight: boolean; // 浅底封面 → 用深字
};

const PALETTES: Record<PdfStyleKey, Palette> = {
  // ① 春日薄荷：薄荷绿 + 樱桃粉
  "spring-mint": {
    bg: "#FFFFFF",
    textMain: "#0F172A",
    textMuted: "#64748B",
    primary: "#10B981",
    accent: "#FB7185",
    rule: "#D1FAE5",
    tableHeadBg: "#10B981",
    tableHeadText: "#FFFFFF",
    coverBg: "#ECFDF5",
    coverGradient: `
      radial-gradient(70% 50% at 18% 18%, rgba(110,231,183,0.55) 0%, rgba(110,231,183,0) 70%),
      radial-gradient(60% 45% at 85% 25%, rgba(251,113,133,0.40) 0%, rgba(251,113,133,0) 70%),
      radial-gradient(80% 60% at 80% 90%, rgba(52,211,153,0.40) 0%, rgba(52,211,153,0) 75%),
      radial-gradient(60% 45% at 15% 95%, rgba(254,205,211,0.55) 0%, rgba(254,205,211,0) 75%),
      linear-gradient(180deg, #ECFDF5 0%, #FCE7F3 60%, #FFE4E6 100%)
    `,
    coverGold: "#FB7185",
    coverTextLight: true,
  },
  // ② 霓虹科技：电光青 + 霓虹紫（深底）
  "neon-tech": {
    bg: "#FAFBFF",
    textMain: "#1E1B4B",
    textMuted: "#6B7280",
    primary: "#7C3AED",
    accent: "#06B6D4",
    rule: "#E9D5FF",
    tableHeadBg: "#5B21B6",
    tableHeadText: "#E0F2FE",
    coverBg: "#1E1B4B",
    coverGradient: `
      radial-gradient(70% 50% at 100% 0%, rgba(6,182,212,0.45) 0%, rgba(6,182,212,0) 60%),
      radial-gradient(80% 60% at -10% 110%, rgba(168,85,247,0.40) 0%, rgba(168,85,247,0) 65%),
      radial-gradient(45% 35% at 50% 50%, rgba(124,58,237,0.30) 0%, rgba(124,58,237,0) 70%),
      linear-gradient(155deg, #1E1B4B 0%, #312E81 50%, #1E1B4B 100%)
    `,
    coverGold: "#06B6D4",
    coverTextLight: false,
  },
  // ③ 日落珊瑚：珊瑚橘 + 紫罗兰
  "sunset-coral": {
    bg: "#FFFAF5",
    textMain: "#3C1361",
    textMuted: "#7C5C8B",
    primary: "#8B5CF6",
    accent: "#FB923C",
    rule: "#FED7AA",
    tableHeadBg: "#7C3AED",
    tableHeadText: "#FFFFFF",
    coverBg: "#FFEDD5",
    coverGradient: `
      radial-gradient(70% 50% at 25% 20%, rgba(251,146,60,0.55) 0%, rgba(251,146,60,0) 70%),
      radial-gradient(65% 45% at 78% 75%, rgba(139,92,246,0.50) 0%, rgba(139,92,246,0) 70%),
      radial-gradient(60% 45% at 50% 100%, rgba(244,114,182,0.50) 0%, rgba(244,114,182,0) 70%),
      linear-gradient(180deg, #FFEDD5 0%, #FCE7F3 60%, #EDE9FE 100%)
    `,
    coverGold: "#8B5CF6",
    coverTextLight: true,
  },
  // ④ 海蓝清爽：海蓝 + 柠檬黄
  "ocean-fresh": {
    bg: "#F8FAFF",
    textMain: "#0C1A3D",
    textMuted: "#475569",
    primary: "#2563EB",
    accent: "#FACC15",
    rule: "#DBEAFE",
    tableHeadBg: "#2563EB",
    tableHeadText: "#FFFFFF",
    coverBg: "#DBEAFE",
    coverGradient: `
      radial-gradient(70% 50% at 100% 0%, rgba(37,99,235,0.32) 0%, rgba(37,99,235,0) 60%),
      radial-gradient(60% 45% at 12% 92%, rgba(56,189,248,0.36) 0%, rgba(56,189,248,0) 70%),
      radial-gradient(35% 28% at 78% 35%, rgba(250,204,21,0.45) 0%, rgba(250,204,21,0) 75%),
      linear-gradient(180deg, #DBEAFE 0%, #E0F2FE 100%)
    `,
    coverGold: "#FACC15",
    coverTextLight: true,
  },
  // ⑤ 高端商务亮：海军蓝 + 香槟金（B 端正式挡板，保留）
  "business-bright": {
    bg: "#F8FAFC",
    textMain: "#0F1B2D",
    textMuted: "#55657A",
    primary: "#1F3A5F",
    accent: "#C9A858",
    rule: "#D8E1EC",
    tableHeadBg: "#1F3A5F",
    tableHeadText: "#FFFFFF",
    coverBg: "#EAF0F6",
    coverGradient: `
      radial-gradient(70% 50% at 100% 0%, rgba(31,58,95,0.18) 0%, rgba(31,58,95,0) 60%),
      radial-gradient(80% 60% at -10% 110%, rgba(31,58,95,0.22) 0%, rgba(31,58,95,0) 65%),
      radial-gradient(35% 28% at 12% 25%, rgba(201,168,88,0.30) 0%, rgba(201,168,88,0) 75%),
      linear-gradient(180deg, #F8FAFC 0%, #EAF0F6 100%)
    `,
    coverGold: "#C9A858",
    coverTextLight: true,
  },
};

const META: Record<PdfStyleKey, { label: string; sub: string; tag: string; eyebrow: string }> = {
  "spring-mint":     { label: "春日薄荷",   sub: "薄荷绿 · 樱桃粉",   tag: "SPRING MINT",      eyebrow: "FRESH STRATEGY" },
  "neon-tech":       { label: "霓虹科技",   sub: "电光青 · 霓虹紫",   tag: "NEON TECH",        eyebrow: "TECH ADVISORY" },
  "sunset-coral":    { label: "日落珊瑚",   sub: "珊瑚橘 · 紫罗兰",   tag: "SUNSET CORAL",     eyebrow: "CREATIVE BRIEF" },
  "ocean-fresh":     { label: "海蓝清爽",   sub: "海蓝 · 柠檬黄",     tag: "OCEAN FRESH",      eyebrow: "OCEAN PLAN" },
  "business-bright": { label: "高端商务亮", sub: "海军蓝 · 香槟金",   tag: "EXECUTIVE BRIGHT", eyebrow: "BUSINESS PLAN" },
};

const ORDER: PdfStyleKey[] = ["spring-mint", "neon-tech", "sunset-coral", "ocean-fresh", "business-bright"];

// ─── 单张缩略卡（封面 + 内文一页并排） ─────────────────────────────────────────
function ThumbCard({ style, selected, onSelect }: { style: PdfStyleKey; selected: boolean; onSelect: () => void }) {
  const p = PALETTES[style];
  const m = META[style];

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        width: 320,
        flexShrink: 0,
        padding: 0,
        borderRadius: 14,
        border: selected ? `2px solid ${p.accent}` : "2px solid rgba(168,118,27,0.20)",
        outline: selected ? `4px solid ${p.accent}30` : "none",
        background: "#fff",
        cursor: "pointer",
        overflow: "hidden",
        boxShadow: selected ? "0 10px 30px rgba(0,0,0,0.16)" : "0 4px 14px rgba(0,0,0,0.06)",
        transition: "all 0.18s ease",
        textAlign: "left",
      }}
    >
      {/* 上：左封面 + 右内文 一页 */}
      <div style={{ display: "flex", height: 200 }}>
        {/* 封面侧 */}
        <div
          style={{
            width: "42%",
            background: p.coverGradient,
            backgroundColor: p.coverBg,
            color: p.coverTextLight ? p.textMain : "#FFF",
            position: "relative",
            padding: "12px 10px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            borderRight: `1px solid ${p.rule}`,
          }}
        >
          <div style={{ fontSize: 7, letterSpacing: "0.18em", fontWeight: 800, opacity: 0.78 }}>
            ✓ INTELLIGENCE BUREAU
          </div>
          <div>
            <div style={{ fontSize: 7, letterSpacing: "0.30em", color: p.coverGold, fontWeight: 800, marginBottom: 4 }}>
              {m.eyebrow}
            </div>
            <div
              style={{
                fontFamily: "Georgia, 'Noto Serif CJK SC', serif",
                fontSize: 14,
                fontWeight: 900,
                lineHeight: 1.05,
                color: p.coverGold,
                textTransform: "uppercase",
                letterSpacing: "0.02em",
                marginBottom: 4,
              }}
            >
              EXCLUSIVE
            </div>
            <div
              style={{
                fontFamily: "Georgia, 'Noto Serif CJK SC', serif",
                fontSize: 9,
                fontWeight: 800,
                lineHeight: 1.3,
                color: p.coverTextLight ? p.textMain : "#FFF",
              }}
            >
              战略情报报告
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 6,
                lineHeight: 1.4,
                color: p.coverTextLight ? p.textMuted : "rgba(255,255,255,0.78)",
                borderLeft: `1.5px solid ${p.coverGold}`,
                paddingLeft: 4,
              }}
            >
              跨境市场全景研报。
            </div>
          </div>
          <div style={{ fontSize: 6, fontWeight: 800, letterSpacing: "0.18em", color: "#A52A2A" }}>
            CONFIDENTIAL
          </div>
        </div>

        {/* 内文侧 */}
        <div style={{ width: "58%", background: p.bg, padding: "10px 10px 8px", overflow: "hidden" }}>
          {/* H1 */}
          <div
            style={{
              fontSize: 9,
              fontWeight: 900,
              color: p.primary,
              padding: "5px 6px",
              borderLeft: `2.5px solid ${p.primary}`,
              marginBottom: 6,
              background: `linear-gradient(90deg, ${p.primary}14 0%, transparent 80%)`,
            }}
          >
            一、行业格局
          </div>
          {/* 正文 */}
          <div style={{ fontSize: 6, lineHeight: 1.45, color: p.textMain, marginBottom: 5 }}>
            2026 年市场进入分化期，头部品牌通过数据与渠道形成壁垒，新入局者需借力跨境基础设施。
          </div>
          {/* H3 */}
          <div
            style={{
              fontSize: 7,
              fontWeight: 800,
              color: p.primary,
              borderLeft: `1.5px solid ${p.accent}`,
              paddingLeft: 5,
              marginBottom: 4,
            }}
          >
            1.1 关键玩家
          </div>
          {/* 迷你表格 */}
          <div style={{ border: `1px solid ${p.rule}`, borderRadius: 2, overflow: "hidden", fontSize: 5.5 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr 0.8fr",
                background: p.tableHeadBg,
                color: p.tableHeadText,
                fontWeight: 800,
                padding: "3px 5px",
                letterSpacing: "0.06em",
              }}
            >
              <div>玩家</div>
              <div>份额</div>
              <div style={{ textAlign: "right" }}>YoY</div>
            </div>
            {[
              { n: "巨头 A", s: "32.4%", y: "+12%", pos: true },
              { n: "巨头 B", s: "18.1%", y: "-3%", pos: false },
              { n: "黑马 C", s: "9.7%", y: "+45%", pos: true },
            ].map((r, i) => (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1fr 0.8fr",
                  padding: "3px 5px",
                  background: i % 2 ? "rgba(0,0,0,0.025)" : "transparent",
                  color: p.textMain,
                  borderTop: i ? `1px solid ${p.rule}` : "none",
                }}
              >
                <div>{r.n}</div>
                <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.s}</div>
                <div
                  style={{
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    color: r.pos ? "#15803d" : "#b91c1c",
                    fontWeight: 700,
                  }}
                >
                  {r.y}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 下：模板名 + 副标题 + 选中标记 */}
      <div
        style={{
          padding: "10px 14px",
          borderTop: `1px solid ${p.rule}`,
          background: "#FFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 900, color: "#1c1407" }}>{m.label}</div>
          <div style={{ fontSize: 11, color: "rgba(28,20,7,0.55)", marginTop: 2 }}>{m.sub}</div>
        </div>
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.10em",
            fontWeight: 800,
            padding: "4px 10px",
            borderRadius: 999,
            background: selected ? p.accent : `${p.accent}22`,
            color: selected ? "#FFF" : p.primary,
            transition: "all 0.18s",
          }}
        >
          {selected ? "✓ 已选" : m.tag}
        </div>
      </div>
    </button>
  );
}

// ─── 多卡选择器：横向滑动 ───────────────────────────────────────────────────
export function TemplatePicker({
  value,
  onChange,
  compact,
}: {
  value: PdfStyleKey;
  onChange: (next: PdfStyleKey) => void;
  /** 紧凑模式：用于卡片层（只显示当前选中 + 切换按钮） */
  compact?: boolean;
}) {
  if (compact) {
    const m = META[value];
    const p = PALETTES[value];
    const next = ORDER[(ORDER.indexOf(value) + 1) % ORDER.length];
    return (
      <button
        type="button"
        onClick={() => onChange(next)}
        title={`点击切换模板（当前：${m.label}，下一个：${META[next].label}）`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          borderRadius: 8,
          border: `1px solid ${p.accent}55`,
          background: `${p.accent}14`,
          color: p.primary,
          fontSize: 11,
          fontWeight: 800,
          cursor: "pointer",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 2, background: p.coverGold }} />
        {m.label}
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, color: "rgba(61,44,20,0.65)", fontWeight: 700, letterSpacing: "0.02em" }}>
        选择 PDF 模板（点击预览卡选中）
      </div>
      <div
        style={{
          display: "flex",
          gap: 14,
          overflowX: "auto",
          paddingBottom: 8,
          scrollbarWidth: "thin",
        }}
      >
        {ORDER.map((k) => (
          <ThumbCard key={k} style={k} selected={k === value} onSelect={() => onChange(k)} />
        ))}
      </div>
    </div>
  );
}

export const PDF_STYLE_KEYS = ORDER;

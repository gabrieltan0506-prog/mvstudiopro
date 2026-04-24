import React from "react";
import { Link } from "wouter";
import { CREDIT_COSTS, CREDIT_PACKS, CREDIT_TO_CNY } from "@shared/plans";

const PACK_ORDER = ["trial199", "small", "medium", "large", "mega"] as const;

export default function HomePricing() {
  return (
    <section
      style={{
        maxWidth: 1240,
        margin: "0 auto",
        padding: "48px 20px 24px",
      }}
    >
      <h2
        style={{
          color: "white",
          fontSize: 28,
          fontWeight: 900,
          marginBottom: 8,
        }}
      >
        Credits 定价
        <span style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.45)", marginLeft: 10 }}>
          1 Credit ≈ ¥{CREDIT_TO_CNY.toFixed(2)}
        </span>
      </h2>
      <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 14, marginBottom: 24, maxWidth: 720 }}>
        成长营、平台趋势、节点工作流等功能按次扣积分；充值包支持扫码购买，详见套餐页。
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 14,
          marginBottom: 28,
        }}
      >
        {[
          { k: "商业成长营 · GROWTH", v: CREDIT_COSTS.growthCampGrowth },
          { k: "商业成长营 · REMIX", v: CREDIT_COSTS.growthCampRemix },
          { k: "平台趋势 · 主分析", v: CREDIT_COSTS.platformTrend },
          { k: "平台趋势 · 每次追问", v: CREDIT_COSTS.platformTrendFollowUp },
          { k: "节点 · 故事板", v: CREDIT_COSTS.workflowStoryboard },
          { k: "节点 · 场景视频 (Veo)", v: CREDIT_COSTS.workflowSceneVideo },
        ].map((row) => (
          <div
            key={row.k}
            style={{
              borderRadius: 16,
              padding: "14px 16px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>{row.k}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#ff9b75" }}>{row.v} cr</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>≈ ¥{(row.v * CREDIT_TO_CNY).toFixed(0)}</div>
          </div>
        ))}
      </div>

      <h3 style={{ color: "white", fontSize: 18, fontWeight: 800, marginBottom: 14 }}>积分加值包</h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 16,
        }}
      >
        {PACK_ORDER.map((id) => {
          const p = CREDIT_PACKS[id];
          const priceLabel = Number.isInteger(p.price) ? p.price : Number(p.price).toFixed(1);
          return (
            <div
              key={id}
              style={{
                borderRadius: 20,
                padding: "20px 18px",
                background:
                  id === "large"
                    ? "linear-gradient(145deg, rgba(139,92,246,0.18), rgba(10,12,24,0.95))"
                    : id === "trial199"
                      ? "linear-gradient(145deg, rgba(16,185,129,0.12), rgba(10,12,24,0.92))"
                    : "rgba(255,255,255,0.04)",
                border:
                  id === "large"
                    ? "1px solid rgba(167,139,250,0.35)"
                    : id === "trial199"
                      ? "1px solid rgba(52,211,153,0.35)"
                    : "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>{p.labelCn}</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: "white", margin: "8px 0" }}>
                ¥{priceLabel}
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#a78bfa" }}>{p.credits} Credits</div>
              {p.discount ? (
                <div style={{ fontSize: 12, color: "#4ade80", marginTop: 6 }}>{p.discount}</div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 24, textAlign: "center" }}>
        <Link
          href="/pricing"
          style={{
            display: "inline-block",
            padding: "12px 28px",
            borderRadius: 999,
            background: "linear-gradient(90deg, #8b5cf6, #ec4899)",
            color: "white",
            fontWeight: 800,
            textDecoration: "none",
            fontSize: 15,
          }}
        >
          查看完整套餐与充值说明
        </Link>
      </div>
    </section>
  );
}

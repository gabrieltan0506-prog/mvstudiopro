import React from "react";
import { Link } from "wouter";
import { CREDIT_PACKS } from "@shared/plans";

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
        积分包定价
        <span style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.45)", marginLeft: 10 }}>
          对外以积分加值包为准
        </span>
      </h2>
      <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 14, marginBottom: 24, maxWidth: 760 }}>
        不再展示单功能逐项标价；创作所需 Credits 以您购买的积分包为准，在功能使用时从余额扣减。充值与周期优惠详见套餐页。
      </p>
      <p style={{ color: "rgba(253,224,71,0.88)", fontSize: 13, marginBottom: 24, maxWidth: 760, lineHeight: 1.65, padding: "12px 14px", borderRadius: 14, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)" }}>
        <strong style={{ color: "#fde68a" }}>试用与公平使用：</strong>
        ¥19.9 试用包及免费、未订阅等体验账户，为防止多邮箱重复领取试用资源，<strong style={{ color: "white" }}>生成的图片与视频可能带有平台水印</strong>；正式积分包与会员档位可按规则减少或去除水印，以实际导出为准。
      </p>

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
          前往充值与周期优惠
        </Link>
      </div>
    </section>
  );
}

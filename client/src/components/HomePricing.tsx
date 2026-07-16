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
        padding: "36px 20px 16px",
      }}
    >
      <h2
        style={{
          color: "white",
          fontSize: 24,
          fontWeight: 900,
          marginBottom: 8,
        }}
      >
        积分包
      </h2>
      <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 14, marginBottom: 20, maxWidth: 640 }}>
        按积分包充值，使用时从余额扣减。试用与体验账号导出可能带水印。
      </p>
      <h3 style={{ color: "white", fontSize: 16, fontWeight: 800, marginBottom: 12 }}>加值包</h3>
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

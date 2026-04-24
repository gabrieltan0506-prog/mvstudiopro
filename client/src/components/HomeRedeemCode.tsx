import React, { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

export default function HomeRedeemCode() {
  const { isAuthenticated, loading, refresh } = useAuth({ autoFetch: true });
  const utils = trpc.useUtils();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");
  const redeemMut = trpc.betaCode.redeem.useMutation();

  if (loading || !isAuthenticated) return null;

  async function handleRedeem() {
    if (!code.trim()) return;
    setStatus("loading");
    try {
      const r = await redeemMut.mutateAsync({ code: code.trim() });
      setMsg(r.message || "兌換成功！");
      setStatus("ok");
      setCode("");
      // 重新抓用戶資料，讓積分即時更新
      await utils.auth.me.invalidate();
      refresh?.();
    } catch (e: any) {
      setMsg(e.message || "兌換失敗，請確認邀請碼是否正確");
      setStatus("err");
    }
  }

  return (
    <section style={{ maxWidth: 600, margin: "0 auto 40px", padding: "0 24px", paddingTop: 8 }}>
      <div style={{
        background: "rgba(255,107,53,0.08)", border: "1px solid rgba(255,107,53,0.25)",
        borderRadius: 16, padding: "20px 24px",
      }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#ff6b35", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
          🎁 兌換邀請碼
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder="輸入邀請碼（如 ABCD-EFGH-IJKL）"
            value={code}
            onChange={e => { setCode(e.target.value.toUpperCase()); setStatus("idle"); }}
            onKeyDown={e => e.key === "Enter" && handleRedeem()}
            style={{
              flex: 1, background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 8, padding: "10px 14px", color: "#fff", fontSize: 14,
              fontFamily: "monospace", outline: "none", letterSpacing: 1,
            }}
          />
          <button
            onClick={handleRedeem}
            disabled={status === "loading" || !code.trim()}
            style={{
              background: "#ff6b35", border: "none", borderRadius: 8,
              padding: "10px 20px", color: "#fff", fontWeight: 700, fontSize: 14,
              cursor: status === "loading" || !code.trim() ? "not-allowed" : "pointer",
              opacity: status === "loading" || !code.trim() ? 0.6 : 1, whiteSpace: "nowrap",
            }}
          >
            {status === "loading" ? "兌換中…" : "兌換"}
          </button>
        </div>
        {msg && (
          <div style={{ marginTop: 10, fontSize: 13, color: status === "ok" ? "#4ade80" : "#f87171", fontWeight: 600 }}>
            {status === "ok" ? "✅ " : "❌ "}{msg}
          </div>
        )}
      </div>
    </section>
  );
}

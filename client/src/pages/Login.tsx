import React, { useState } from "react";
import { login } from "../lib/auth";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const j = await login(email, password);
      if (!j?.ok) {
        setMsg(j?.error || "登录失败");
        return;
      }
      window.location.href = "/";
    } catch (e: any) {
      setMsg(e?.message || "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "60px auto", padding: 20, color: "white" }}>
      <h1 style={{ fontSize: 28, fontWeight: 900, marginBottom: 20 }}>登录</h1>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="邮箱"
          style={{ padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.16)", background: "#111", color: "white" }}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码"
          style={{ padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.16)", background: "#111", color: "white" }}
        />
        <button
          type="submit"
          disabled={busy}
          style={{ padding: "12px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 900 }}
        >
          {busy ? "登录中…" : "登录"}
        </button>
      </form>
      {msg ? <div style={{ marginTop: 12, color: "#ffb4b4" }}>{msg}</div> : null}
    </div>
  );
}

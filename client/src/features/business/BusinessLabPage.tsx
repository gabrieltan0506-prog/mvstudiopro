import { useState } from "react";

type VideoAnalysisResult = {
  strengths: string[];
  weakness: string[];
  optimization: string[];
  commercialDirection: string[];
};

export default function BusinessLabPage() {
  const [report, setReport] = useState<VideoAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    try {
      setLoading(true);
      setError("");
      const r = await fetch("/api/business?op=analyze");
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "analyze_failed");
      setReport(j.result);
    } catch (e: any) {
      setError(e?.message || "analyze_failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <h1>商业创作营</h1>
      <p>分析视频优缺点、优化建议与商业方向。</p>

      <button type="button" onClick={run} disabled={loading}>
        {loading ? "分析中..." : "分析视频"}
      </button>

      {error ? <div style={{ marginTop: 16, color: "crimson" }}>{error}</div> : null}

      {report ? (
        <div style={{ marginTop: 24, display: "grid", gap: 20 }}>
          <section>
            <h3>优点</h3>
            <ul>{report.strengths.map((x) => <li key={x}>{x}</li>)}</ul>
          </section>

          <section>
            <h3>缺点</h3>
            <ul>{report.weakness.map((x) => <li key={x}>{x}</li>)}</ul>
          </section>

          <section>
            <h3>优化建议</h3>
            <ul>{report.optimization.map((x) => <li key={x}>{x}</li>)}</ul>
          </section>

          <section>
            <h3>商业方向</h3>
            <ul>{report.commercialDirection.map((x) => <li key={x}>{x}</li>)}</ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}

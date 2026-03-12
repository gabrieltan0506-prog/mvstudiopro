import { useState } from "react";

interface BusinessAnalysis {
  strengths: string[];
  weakness: string[];
  optimization: string[];
  commercialDirection: string[];
}

interface BusinessReport {
  summary: string;
  score: number;
  advice: string;
}

interface AnalyzeResponse {
  ok: boolean;
  result: BusinessAnalysis;
  report: BusinessReport;
}

export default function Business() {
  const [report, setReport] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/business?op=analyze");
      const payload = (await response.json()) as AnalyzeResponse & { error?: string };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "business_analyze_failed");
      }

      setReport(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "business_analyze_failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background px-6 py-12 text-foreground">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="space-y-3">
          <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">
            Business Lab
          </p>
          <h1 className="text-4xl font-semibold">商业创作营</h1>
          <p className="max-w-2xl text-base text-muted-foreground">
            快速查看内容优劣势、商业方向和优化建议，给创作决策一个轻量起点。
          </p>
        </div>

        <button
          className="rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background disabled:opacity-60"
          disabled={loading}
          onClick={run}
        >
          {loading ? "分析中..." : "分析视频"}
        </button>

        {error ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {report ? (
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-3xl border bg-card p-6">
              <h2 className="mb-3 text-lg font-semibold">优点</h2>
              <pre className="whitespace-pre-wrap text-sm text-muted-foreground">
                {JSON.stringify(report.result.strengths, null, 2)}
              </pre>
            </section>

            <section className="rounded-3xl border bg-card p-6">
              <h2 className="mb-3 text-lg font-semibold">缺点</h2>
              <pre className="whitespace-pre-wrap text-sm text-muted-foreground">
                {JSON.stringify(report.result.weakness, null, 2)}
              </pre>
            </section>

            <section className="rounded-3xl border bg-card p-6">
              <h2 className="mb-3 text-lg font-semibold">优化建议</h2>
              <pre className="whitespace-pre-wrap text-sm text-muted-foreground">
                {JSON.stringify(report.result.optimization, null, 2)}
              </pre>
            </section>

            <section className="rounded-3xl border bg-card p-6">
              <h2 className="mb-3 text-lg font-semibold">商业方向</h2>
              <pre className="whitespace-pre-wrap text-sm text-muted-foreground">
                {JSON.stringify(report.result.commercialDirection, null, 2)}
              </pre>
            </section>

            <section className="rounded-3xl border bg-card p-6 md:col-span-2">
              <h2 className="mb-3 text-lg font-semibold">总结报告</h2>
              <p className="text-sm text-muted-foreground">{report.report.summary}</p>
              <p className="mt-3 text-sm text-muted-foreground">评分：{report.report.score}</p>
              <p className="mt-2 text-sm text-muted-foreground">建议：{report.report.advice}</p>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

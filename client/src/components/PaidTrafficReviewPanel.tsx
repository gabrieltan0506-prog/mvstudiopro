import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ClipboardList, LineChart as LineChartIcon, Loader2, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  kuaishou: "快手",
  bilibili: "B站",
};

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function fmtCny(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `¥${Math.round(n).toLocaleString("zh-CN")}`;
}
function fmtCny1(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `¥${(Math.round(n * 10) / 10).toLocaleString("zh-CN")}`;
}

interface ReviewRow {
  id: number;
  platform: string | null;
  campaignName: string | null;
  spend: string;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: string;
  notes: string | null;
  measuredAt: string | Date | null;
  createdAt: string | Date;
}

const EMPTY_FORM = {
  campaignName: "",
  spend: "",
  impressions: "",
  clicks: "",
  conversions: "",
  revenue: "",
};

export interface PaidTrafficReviewPanelProps {
  /** 来自「回本自测」的盈亏平衡 CPA（元/转化），用于对照实测 CPA */
  breakevenCpa?: number;
  /** 当前主战场平台 key（写入记录时带上） */
  platformKey?: string;
}

export function PaidTrafficReviewPanel({ breakevenCpa, platformKey }: PaidTrafficReviewPanelProps) {
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const listQuery = trpc.paidTrafficReviews.list.useQuery(
    { limit: 100 },
    { enabled: isAuthenticated },
  );

  const createMutation = trpc.paidTrafficReviews.create.useMutation({
    onSuccess: () => {
      void utils.paidTrafficReviews.list.invalidate();
      setForm({ ...EMPTY_FORM });
      toast.success("已记录本次投放，ROI 曲线已更新");
    },
    onError: (err) => toast.error(err.message || "记录失败"),
  });

  const deleteMutation = trpc.paidTrafficReviews.delete.useMutation({
    onSuccess: () => void utils.paidTrafficReviews.list.invalidate(),
    onError: (err) => toast.error(err.message || "删除失败"),
  });

  const rows = (listQuery.data ?? []) as ReviewRow[];

  const enriched = useMemo(() => {
    // 列表是 createdAt desc；画曲线时按时间升序
    const asc = [...rows].reverse();
    return asc.map((r, idx) => {
      const spend = toNum(r.spend);
      const revenue = toNum(r.revenue);
      const conv = toNum(r.conversions);
      const clicks = toNum(r.clicks);
      const imp = toNum(r.impressions);
      const cpa = conv > 0 ? spend / conv : null;
      const cpc = clicks > 0 ? spend / clicks : null;
      const ctr = imp > 0 ? (clicks / imp) * 100 : null;
      const cvr = clicks > 0 ? (conv / clicks) * 100 : null;
      const roas = spend > 0 ? revenue / spend : null;
      const roi = spend > 0 ? ((revenue - spend) / spend) * 100 : null;
      return { ...r, idx: idx + 1, spend, revenue, conv, clicks, imp, cpa, cpc, ctr, cvr, roas, roi };
    });
  }, [rows]);

  const totals = useMemo(() => {
    const spend = enriched.reduce((s, r) => s + r.spend, 0);
    const revenue = enriched.reduce((s, r) => s + r.revenue, 0);
    const conv = enriched.reduce((s, r) => s + r.conv, 0);
    const cpa = conv > 0 ? spend / conv : null;
    const roas = spend > 0 ? revenue / spend : null;
    const roi = spend > 0 ? ((revenue - spend) / spend) * 100 : null;
    return { spend, revenue, conv, cpa, roas, roi };
  }, [enriched]);

  const chartData = useMemo(
    () =>
      enriched.map((r) => ({
        name: `#${r.idx}`,
        ROAS: r.roas != null ? Math.round(r.roas * 100) / 100 : null,
        CPA: r.cpa != null ? Math.round(r.cpa) : null,
      })),
    [enriched],
  );

  const beCpa = Number.isFinite(breakevenCpa) && (breakevenCpa ?? 0) > 0 ? (breakevenCpa as number) : null;

  // 实测 CPA 与盈亏线对照结论
  const verdict = useMemo(() => {
    if (beCpa == null || totals.cpa == null) return null;
    if (totals.cpa <= beCpa)
      return { tone: "go" as const, text: `实测 CPA ${fmtCny(totals.cpa)} ≤ 盈亏线 ${fmtCny(beCpa)}，整体回得了本，可加大放量。` };
    if (totals.cpa <= beCpa * 1.2)
      return { tone: "caution" as const, text: `实测 CPA ${fmtCny(totals.cpa)} 略高于盈亏线 ${fmtCny(beCpa)}，临界，需优化转化或出价。` };
    return { tone: "stop" as const, text: `实测 CPA ${fmtCny(totals.cpa)} 已高于盈亏线 ${fmtCny(beCpa)}，当前在亏损投放，建议止损调整。` };
  }, [beCpa, totals.cpa]);

  const canSubmit = toNum(form.spend) > 0 && !createMutation.isPending;

  const handleSubmit = () => {
    if (!isAuthenticated) {
      toast.error("请先登录再记录投放数据");
      return;
    }
    if (toNum(form.spend) <= 0) {
      toast.error("请填写本次花费（元）");
      return;
    }
    createMutation.mutate({
      platform: platformKey,
      campaignName: form.campaignName.trim() || undefined,
      spend: toNum(form.spend),
      impressions: Math.round(toNum(form.impressions)),
      clicks: Math.round(toNum(form.clicks)),
      conversions: Math.round(toNum(form.conversions)),
      revenue: toNum(form.revenue),
    });
  };

  const setField = (k: keyof typeof EMPTY_FORM, raw: string) => {
    const cleaned = k === "campaignName" ? raw.slice(0, 60) : raw.replace(/[^\d.]/g, "").slice(0, 10);
    setForm((f) => ({ ...f, [k]: cleaned }));
  };

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-teal-500/40 bg-[linear-gradient(180deg,rgba(20,184,166,0.13)_0%,rgba(17,24,39,0.97)_26%)] shadow-[0_10px_36px_rgba(20,184,166,0.14)]">
      <div className="h-1 w-full bg-gradient-to-r from-teal-400 via-emerald-400 to-cyan-400" aria-hidden />
      <div className="flex flex-wrap items-center gap-2.5 border-b border-teal-500/25 bg-teal-500/10 px-3.5 py-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500/25 text-teal-100 shadow-sm">
          <ClipboardList size={18} strokeWidth={2.25} aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold leading-tight text-teal-50 md:text-lg">投后复盘 · 实测回本追踪</h2>
          <p className="text-[11px] font-medium text-teal-200/75">回填真实花费/曝光/点击/转化 → 算真实 CPA、ROI 曲线，对照盈亏线</p>
        </div>
        {beCpa != null ? (
          <span className="ml-auto rounded-md border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-50">
            盈亏线 CPA {fmtCny(beCpa)}
          </span>
        ) : null}
      </div>

      {/* 回填表单 */}
      <div className="border-b border-teal-500/15 bg-black/20 px-3 py-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { k: "campaignName" as const, label: "投放名/选题", unit: "", ph: "如：早八通勤妆", num: false },
            { k: "spend" as const, label: "花费", unit: "¥", ph: "0", num: true },
            { k: "impressions" as const, label: "曝光", unit: "", ph: "0", num: true },
            { k: "clicks" as const, label: "点击", unit: "", ph: "0", num: true },
            { k: "conversions" as const, label: "转化/成交", unit: "单", ph: "0", num: true },
            { k: "revenue" as const, label: "营收", unit: "¥", ph: "0", num: true },
          ].map((f) => (
            <label key={f.k} className="flex flex-col rounded-lg border border-teal-400/25 bg-[#0B0F19]/70 px-2 py-1.5">
              <span className="text-[10px] font-semibold text-teal-200/80">{f.label}</span>
              <span className="flex items-baseline gap-0.5">
                {f.unit === "¥" ? <span className="text-[11px] font-bold text-teal-300/70">¥</span> : null}
                <input
                  type="text"
                  inputMode={f.num ? "decimal" : "text"}
                  value={form[f.k]}
                  onChange={(e) => setField(f.k, e.target.value)}
                  placeholder={f.ph}
                  className="w-full bg-transparent text-sm font-black tabular-nums text-white outline-none placeholder:text-white/25"
                  aria-label={f.label}
                />
                {f.unit && f.unit !== "¥" ? <span className="text-[10px] font-bold text-teal-300/70">{f.unit}</span> : null}
              </span>
            </label>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-teal-400/50 bg-teal-500/25 px-3 py-1.5 text-sm font-bold text-teal-50 transition hover:bg-teal-500/35 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createMutation.isPending ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Plus size={15} aria-hidden />}
            记录本次投放
          </button>
          {!isAuthenticated ? <span className="text-[11px] text-teal-200/70">登录后即可保存并生成 ROI 曲线</span> : null}
        </div>
      </div>

      {/* 汇总 + 结论 */}
      {enriched.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 px-3 pt-3 sm:grid-cols-4 lg:grid-cols-6">
          {[
            { k: "总花费", v: fmtCny(totals.spend), cls: "text-rose-50" },
            { k: "总营收", v: fmtCny(totals.revenue), cls: "text-emerald-50" },
            { k: "总成交", v: `${totals.conv}`, cls: "text-sky-50" },
            { k: "实测CPA", v: totals.cpa != null ? fmtCny(totals.cpa) : "—", cls: "text-amber-50" },
            { k: "整体ROAS", v: totals.roas != null ? `${totals.roas.toFixed(2)}x` : "—", cls: "text-cyan-50" },
            { k: "整体ROI", v: totals.roi != null ? `${totals.roi >= 0 ? "+" : ""}${totals.roi.toFixed(0)}%` : "—", cls: totals.roi != null && totals.roi >= 0 ? "text-emerald-50" : "text-rose-50" },
          ].map((s) => (
            <div key={s.k} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5">
              <p className="text-[10px] font-medium text-gray-300/80">{s.k}</p>
              <p className={`text-base font-black tabular-nums ${s.cls}`}>{s.v}</p>
            </div>
          ))}
        </div>
      ) : null}

      {verdict ? (
        <p
          className={`mx-3 mt-3 rounded-lg border-l-4 px-2.5 py-2 text-[12px] font-semibold leading-snug ${
            verdict.tone === "go"
              ? "border-emerald-400/70 bg-emerald-950/40 text-emerald-50"
              : verdict.tone === "stop"
                ? "border-rose-400/70 bg-rose-950/40 text-rose-50"
                : "border-amber-400/70 bg-amber-950/40 text-amber-50"
          }`}
        >
          {verdict.text}
        </p>
      ) : null}

      {/* ROI 曲线 */}
      {chartData.length >= 1 ? (
        <div className="px-3 pt-3">
          <h3 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-cyan-100">
            <LineChartIcon size={15} className="text-cyan-300" aria-hidden />
            ROI 曲线（ROAS 走势 + 实测 CPA 对照盈亏线）
          </h3>
          <div className="h-[220px] w-full rounded-lg border border-cyan-500/20 bg-[#0B0F19]/70 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fill: "#9CA3AF", fontSize: 11 }} axisLine={{ stroke: "#374151" }} tickLine={false} />
                <YAxis yAxisId="roas" tick={{ fill: "#67e8f9", fontSize: 11 }} axisLine={false} tickLine={false} width={34} />
                <YAxis yAxisId="cpa" orientation="right" tick={{ fill: "#fcd34d", fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
                <Tooltip
                  contentStyle={{ background: "#0B0F19", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#e5e7eb" }}
                  formatter={(val: number | string, name) =>
                    name === "ROAS" ? [`${val}x`, "ROAS"] : [fmtCny(Number(val)), "实测CPA"]
                  }
                />
                {beCpa != null ? (
                  <ReferenceLine
                    yAxisId="cpa"
                    y={beCpa}
                    stroke="#f43f5e"
                    strokeDasharray="5 4"
                    label={{ value: `盈亏线 ${fmtCny(beCpa)}`, fill: "#fda4af", fontSize: 10, position: "insideTopRight" }}
                  />
                ) : null}
                <ReferenceLine yAxisId="roas" y={1} stroke="#475569" strokeDasharray="2 3" />
                <Line yAxisId="roas" type="monotone" dataKey="ROAS" stroke="#22d3ee" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                <Line yAxisId="cpa" type="monotone" dataKey="CPA" stroke="#fbbf24" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      {/* 明细列表 */}
      <div className="px-3 pb-3 pt-3">
        {listQuery.isLoading ? (
          <p className="py-4 text-center text-[12px] text-teal-200/60">
            <Loader2 size={14} className="mr-1 inline animate-spin" aria-hidden />
            加载复盘记录…
          </p>
        ) : enriched.length === 0 ? (
          <p className="rounded-lg border border-dashed border-teal-400/25 bg-black/20 py-4 text-center text-[12px] text-teal-100/60">
            还没有复盘记录。投放后回填上方数据，即可看到真实 CPA 与 ROI 曲线。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-[11px] text-teal-200/70">
                  <th className="px-1.5 py-1 font-semibold">#</th>
                  <th className="px-1.5 py-1 font-semibold">投放/选题</th>
                  <th className="px-1.5 py-1 text-right font-semibold">花费</th>
                  <th className="px-1.5 py-1 text-right font-semibold">营收</th>
                  <th className="px-1.5 py-1 text-right font-semibold">成交</th>
                  <th className="px-1.5 py-1 text-right font-semibold">CPA</th>
                  <th className="px-1.5 py-1 text-right font-semibold">CPC</th>
                  <th className="px-1.5 py-1 text-right font-semibold">转化率</th>
                  <th className="px-1.5 py-1 text-right font-semibold">ROAS</th>
                  <th className="px-1.5 py-1 text-right font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {[...enriched].reverse().map((r) => {
                  const cpaOver = beCpa != null && r.cpa != null && r.cpa > beCpa;
                  return (
                    <tr key={r.id} className="border-t border-white/5 text-gray-100">
                      <td className="px-1.5 py-1.5 tabular-nums text-gray-400">{r.idx}</td>
                      <td className="px-1.5 py-1.5">
                        <span className="line-clamp-1">{r.campaignName || (r.platform ? PLATFORM_LABELS[r.platform] ?? r.platform : "—")}</span>
                      </td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums">{fmtCny(r.spend)}</td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums text-emerald-100">{fmtCny(r.revenue)}</td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums">{r.conv}</td>
                      <td className={`px-1.5 py-1.5 text-right font-bold tabular-nums ${cpaOver ? "text-rose-300" : "text-amber-100"}`}>
                        {r.cpa != null ? fmtCny(r.cpa) : "—"}
                      </td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums text-gray-300">{r.cpc != null ? fmtCny1(r.cpc) : "—"}</td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums text-gray-300">{r.cvr != null ? `${r.cvr.toFixed(1)}%` : "—"}</td>
                      <td className={`px-1.5 py-1.5 text-right font-bold tabular-nums ${r.roas != null && r.roas >= 1 ? "text-cyan-200" : "text-rose-300"}`}>
                        {r.roas != null ? `${r.roas.toFixed(2)}x` : "—"}
                      </td>
                      <td className="px-1.5 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => deleteMutation.mutate({ id: r.id })}
                          disabled={deleteMutation.isPending}
                          className="rounded p-1 text-rose-300/70 transition hover:bg-rose-500/15 hover:text-rose-200 disabled:opacity-50"
                          aria-label="删除记录"
                        >
                          <Trash2 size={13} aria-hidden />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mx-3 mb-3 rounded-lg border-l-4 border-teal-400/70 bg-gradient-to-r from-teal-950/55 to-teal-950/20 px-2.5 py-2 text-[11px] leading-relaxed text-teal-50/90">
        <span className="font-semibold text-teal-200">说明：</span>
        CPA=花费÷成交、CPC=花费÷点击、转化率=成交÷点击、ROAS=营收÷花费。盈亏线来自上方「回本自测」；实测 CPA 低于盈亏线即回得了本。数据为你手动回填，仅本人可见。
      </p>
    </section>
  );
}

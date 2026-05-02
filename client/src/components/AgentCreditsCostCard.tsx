import { Coins } from "lucide-react";
import { AGENT_SCENARIO_CREDITS, CNY_PER_CREDIT_REFERENCE, estimateCnyFromCredits } from "@/lib/agentPricing";

export type AgentCreditsScenario = keyof typeof AGENT_SCENARIO_CREDITS;

const SCENARIO_TITLE: Record<AgentCreditsScenario, string> = {
  platform_ip_matrix: "多平台 IP 矩阵深潜",
  competitor_radar: "竞品 / 赛道雷达深潜",
};

/**
 * Agent 场景页用：标明本次派发扣除的积分及说明（与后端扣费一致）。
 */
export default function AgentCreditsCostCard({ scenario }: { scenario: AgentCreditsScenario }) {
  const credits = AGENT_SCENARIO_CREDITS[scenario];
  const rmb = estimateCnyFromCredits(credits);
  const title = SCENARIO_TITLE[scenario];

  return (
    <div
      style={{
        marginBottom: 22,
        padding: "14px 18px",
        borderRadius: 12,
        background: "linear-gradient(135deg, rgba(168,118,27,0.14), rgba(122,84,16,0.08))",
        border: "1px solid rgba(168,118,27,0.42)",
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          flexShrink: 0,
          width: 40,
          height: 40,
          borderRadius: 10,
          background: "rgba(0,0,0,0.25)",
          border: "1px solid rgba(168,118,27,0.35)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Coins size={20} color="#d6a861" strokeWidth={2.2} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#d6a861", letterSpacing: "0.04em", marginBottom: 6 }}>{title} · 积分说明</div>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "rgba(245,235,210,0.95)", lineHeight: 1.5 }}>
          派发时将扣除 <span style={{ color: "#f5c842" }}>{credits}</span> 点积分
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "rgba(160,140,90,0.82)", lineHeight: 1.65 }}>
          参考约 <span style={{ color: "rgba(245,235,210,0.88)", fontWeight: 700 }}>¥{rmb}</span>（按约 {CNY_PER_CREDIT_REFERENCE} 元/点估算，以账户展示为准）。
        </p>
        <p style={{ margin: "8px 0 0", fontSize: 11, color: "rgba(160,140,90,0.68)", lineHeight: 1.7 }}>
          扣款在任务派发时完成；若因平台算力/系统故障等原因未成功交付，已扣积分会<strong style={{ color: "rgba(245,235,210,0.82)" }}>退还至账户余额</strong>
          （积分形式，<strong style={{ color: "rgba(245,235,210,0.82)" }}>不进行法币退款</strong>）。主动取消等情形以派发前确认与产品规则为准。
        </p>
      </div>
    </div>
  );
}

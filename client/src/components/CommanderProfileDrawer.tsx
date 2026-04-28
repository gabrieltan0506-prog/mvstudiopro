import { useEffect, useState } from "react";
import { Loader2, Save, X, ShieldCheck, ScrollText, Pencil } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface CommanderProfileDrawerProps {
  /** 是否打开 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

/**
 * 指挥官档案侧抽屉：
 * - 一次性设定 a 战略边界 + d 核心资产（+ c 输出格式偏好 + 备注）
 * - 所有 Agent 场景自动注入此档案
 */
export default function CommanderProfileDrawer({ open, onClose }: CommanderProfileDrawerProps) {
  const profileQuery = trpc.agent.getCommanderProfile.useQuery(undefined, { enabled: open, retry: false });
  const saveMutation = trpc.agent.saveCommanderProfile.useMutation({
    onSuccess: () => { toast.success("指挥官档案已保存，所有场景自动生效"); profileQuery.refetch(); onClose(); },
    onError: (e) => toast.error("保存失败：" + e.message),
  });

  const [strategicBoundary, setStrategicBoundary] = useState("");
  const [coreAssets, setCoreAssets] = useState("");
  const [outputFormat, setOutputFormat] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (profileQuery.data) {
      setStrategicBoundary(profileQuery.data.strategicBoundary || "");
      setCoreAssets(profileQuery.data.coreAssets || "");
      setOutputFormat(profileQuery.data.outputFormatPreferences || "");
      setNotes(profileQuery.data.notes || "");
    }
  }, [profileQuery.data]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(640px, 100vw)",
          background: "#0c0a08",
          borderLeft: "1px solid rgba(168,118,27,0.30)",
          color: "rgba(245,235,210,0.92)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-12px 0 40px rgba(0,0,0,0.55)",
        }}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(168,118,27,0.20)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ShieldCheck size={20} color="#d6a861" />
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: "#d6a861", letterSpacing: "0.05em" }}>指挥官档案</h2>
              <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(160,140,90,0.65)" }}>
                一次设定 · 所有 Agent 场景自动注入到 prompt
              </p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(245,235,210,0.55)", padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* 内容 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          {profileQuery.isLoading ? (
            <p style={{ color: "rgba(160,140,90,0.65)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
              <Loader2 size={14} className="animate-spin" /> 正在加载档案…
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              {/* a · 战略边界 */}
              <FieldBlock
                title="a · 战略边界"
                icon={<ShieldCheck size={14} />}
                hint="您专攻的领域 + 必须排除的领域。Agent 检索时会主动过滤越界内容。"
                placeholder={"例：聚焦心血管医学 + 抗衰研究 + 古典艺术史 + 医学 IP 商业化\n排除：纯娱乐八卦 / 骨科牙科 / 加密货币"}
                value={strategicBoundary}
                onChange={setStrategicBoundary}
                rows={5}
                maxLen={4000}
              />

              {/* d · 核心资产 */}
              <FieldBlock
                title="d · 核心资产（差异化护城河）"
                icon={<Pencil size={14} />}
                hint="您的硬学历、独门经验、跨界能力。Agent 会基于此推演专属跨界融合公式。"
                placeholder={"例：哈佛大学心血管专科医师，深谙中西方医学体系\n同时具备深厚的中国历史与西方古典艺术底蕴\n拥有 12 年高净值客户健康管理经验"}
                value={coreAssets}
                onChange={setCoreAssets}
                rows={6}
                maxLen={4000}
              />

              {/* c · 输出格式偏好（可选） */}
              <FieldBlock
                title="c · 输出格式偏好（可选）"
                icon={<ScrollText size={14} />}
                hint="可选 · 留空则使用系统默认「卡布奇诺黑金 Markdown」模板。"
                placeholder={"例：表格优先 / 大纲式 / 每章末附 30 字执行卡片..."}
                value={outputFormat}
                onChange={setOutputFormat}
                rows={3}
                maxLen={2000}
              />

              {/* 长期目标 / 备注 */}
              <FieldBlock
                title="长期目标 / 备注（可选）"
                hint="任何您希望 Agent 长期记住的偏好或目标"
                placeholder={"例：长期目标是建立医学美学私域社群（5 万付费会员）..."}
                value={notes}
                onChange={setNotes}
                rows={3}
                maxLen={2000}
              />

              {profileQuery.data?.updatedAt && (
                <p style={{ fontSize: 11, color: "rgba(160,140,90,0.55)", textAlign: "right", margin: 0 }}>
                  最近更新：{new Date(profileQuery.data.updatedAt).toLocaleString("zh-CN")}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "18px 24px", borderTop: "1px solid rgba(168,118,27,0.20)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 11, color: "rgba(160,140,90,0.65)" }}>
            档案 a/d 是 Agent 的专属护城河，建议至少填一项
          </span>
          <button
            onClick={() => saveMutation.mutate({
              strategicBoundary: strategicBoundary.trim() || undefined,
              coreAssets: coreAssets.trim() || undefined,
              outputFormatPreferences: outputFormat.trim() || undefined,
              notes: notes.trim() || undefined,
            })}
            disabled={saveMutation.isPending}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 22px", borderRadius: 10, background: "linear-gradient(135deg,#a8761b,#7a5410)", border: "1px solid rgba(168,118,27,0.55)", color: "#fff7df", fontWeight: 900, fontSize: 13, cursor: saveMutation.isPending ? "not-allowed" : "pointer", opacity: saveMutation.isPending ? 0.6 : 1 }}
          >
            {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            保存档案
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldBlock({ title, icon, hint, placeholder, value, onChange, rows = 4, maxLen = 4000 }: {
  title: string;
  icon?: React.ReactNode;
  hint?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  maxLen?: number;
}) {
  return (
    <div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 800, color: "#d6a861", marginBottom: 6 }}>
        {icon}{title}
      </label>
      {hint && <p style={{ margin: "0 0 8px", fontSize: 11, color: "rgba(160,140,90,0.65)", lineHeight: 1.6 }}>{hint}</p>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, maxLen))}
        placeholder={placeholder}
        rows={rows}
        style={{
          width: "100%",
          padding: "11px 14px",
          borderRadius: 10,
          background: "rgba(0,0,0,0.30)",
          border: "1px solid rgba(168,118,27,0.30)",
          color: "rgba(245,235,210,0.92)",
          fontSize: 13,
          lineHeight: 1.7,
          outline: "none",
          resize: "vertical",
          fontFamily: "inherit",
          boxSizing: "border-box",
        }}
      />
      <p style={{ margin: "4px 0 0", fontSize: 10, color: "rgba(160,140,90,0.45)", fontFamily: "monospace", textAlign: "right" }}>{value.length}/{maxLen}</p>
    </div>
  );
}

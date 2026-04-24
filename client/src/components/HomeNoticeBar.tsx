import React from "react";

/**
 * 首頂說明：試用包 / 未訂閱帳戶的水印與公平使用（防多郵箱濫用）
 */
export default function HomeNoticeBar() {
  return (
    <div
      style={{
        maxWidth: 1240,
        margin: "0 auto",
        padding: "12px 20px 0",
      }}
    >
      <div
        style={{
          borderRadius: 16,
          padding: "14px 18px",
          background: "rgba(15,23,42,0.85)",
          border: "1px solid rgba(251,191,36,0.35)",
          color: "rgba(255,255,255,0.88)",
          fontSize: 13,
          lineHeight: 1.65,
        }}
      >
        <span style={{ color: "#fcd34d", fontWeight: 800, marginRight: 8 }}>公平使用</span>
        ¥19.9 试用包及<strong style={{ color: "white" }}>免费 / 未订阅</strong>
        等体验账户，为防止利用不同邮箱重复领取试用资源，平台对<strong style={{ color: "white" }}>生成的图片与视频</strong>
        可能添加<strong style={{ color: "white" }}>可见水印</strong>（以实际导出为准）。购买正式积分包、升级会员或达到产品规则要求后，可按档位
        <strong style={{ color: "white" }}>减少或去除水印</strong>。
      </div>
    </div>
  );
}

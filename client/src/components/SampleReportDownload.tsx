import React from "react";

// ─── 水印层 ────────────────────────────────────────────────────────────────
const WATERMARK_TEXT = "试读版 · 仅供参考 · MV Studio Pro";

function WatermarkLayer() {
  const rows = 8;
  const cols = 6;
  const items: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const offset = r % 2 === 0 ? 0 : 8;
      items.push(
        <span
          key={`${r}-${c}`}
          style={{
            display: "inline-block",
            width: `${100 / cols}%`,
            marginLeft: r % 2 === 1 && c === 0 ? `${offset}%` : undefined,
            textAlign: "center",
            color: "#c8a000",
            opacity: 0.10,
            fontSize: 13,
            fontWeight: 600,
            transform: "rotate(-35deg)",
            whiteSpace: "nowrap",
            userSelect: "none",
          }}
        >
          {WATERMARK_TEXT}
        </span>
      );
    }
  }
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9999,
        display: "flex",
        flexWrap: "wrap",
        alignContent: "space-around",
        padding: "40px 20px",
      }}
    >
      {items}
    </div>
  );
}

// ─── 公共样式 ──────────────────────────────────────────────────────────────
const PAGE: React.CSSProperties = {
  width: 794,
  minHeight: 1123,
  background: "#050300",
  color: "#fff",
  padding: 60,
  boxSizing: "border-box",
  fontFamily: "'Noto Serif SC', 'SimSun', serif",
  position: "relative",
  pageBreakAfter: "always",
  breakAfter: "page",
};

const GOLD = "#c8a000";
const GOLD_DIM = "rgba(180,130,0,0.3)";
const GOLD_BG = "rgba(180,130,0,0.05)";

const TABLE_STYLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
  marginTop: 16,
};

const TH: React.CSSProperties = {
  background: "#1a1500",
  color: GOLD,
  border: `1px solid ${GOLD_DIM}`,
  padding: "8px 12px",
  textAlign: "left",
  fontWeight: 700,
};

const TD: React.CSSProperties = {
  border: `1px solid ${GOLD_DIM}`,
  padding: "7px 12px",
  fontSize: 12,
};

const BLUR_OVERLAY: React.CSSProperties = {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  height: 260,
  background: "linear-gradient(to bottom, transparent 0%, #050300 75%)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  zIndex: 2,
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  paddingBottom: 32,
};

// ─── 半月刊 HTML ────────────────────────────────────────────────────────────
function BiweeklyPages() {
  return (
    <>
      {/* 封面页 */}
      <div style={PAGE}>
        <WatermarkLayer />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 1003,
            textAlign: "center",
            gap: 24,
          }}
        >
          <div style={{ fontSize: 13, color: GOLD, letterSpacing: 4, fontFamily: "sans-serif" }}>
            MV Studio Pro 战略智库
          </div>
          <div style={{ fontSize: 12, color: "rgba(200,160,0,0.6)", letterSpacing: 2, fontFamily: "sans-serif" }}>
            第 8 期 · 2026年4月28日
          </div>
          <div
            style={{
              width: "100%",
              height: 1,
              background: `linear-gradient(to right, transparent, ${GOLD}, transparent)`,
              margin: "8px 0",
            }}
          />
          <div
            style={{
              fontSize: 38,
              fontWeight: 900,
              lineHeight: 1.35,
              color: "#fff",
              letterSpacing: 2,
            }}
          >
            《医美赛道2026：<br />
            流量红利终结后的<br />
            精准破局手册》
          </div>
          <div
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.55)",
              letterSpacing: 1,
              lineHeight: 1.8,
            }}
          >
            全平台数据解析 × 头部玩家变现拆解 × 差异化人设定位公式
          </div>
          <div
            style={{
              width: "100%",
              height: 1,
              background: `linear-gradient(to right, transparent, ${GOLD}, transparent)`,
              margin: "8px 0",
            }}
          />
          <div
            style={{
              fontSize: 12,
              color: GOLD_DIM,
              border: `1px solid ${GOLD_DIM}`,
              padding: "6px 20px",
              letterSpacing: 2,
              fontFamily: "sans-serif",
            }}
          >
            试读版 · 完整版共 47 页
          </div>
        </div>
      </div>

      {/* 数据页 */}
      <div style={PAGE}>
        <WatermarkLayer />
        <div style={{ fontSize: 10, color: "rgba(200,160,0,0.5)", letterSpacing: 3, marginBottom: 8, fontFamily: "sans-serif" }}>
          MV STUDIO PRO 战略智库 · 第8期 · 医美赛道
        </div>
        <h2 style={{ fontSize: 22, color: GOLD, fontWeight: 800, marginBottom: 4 }}>
          一、行业全景扫描
        </h2>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", lineHeight: 1.8, marginBottom: 20 }}>
          中国医美市场历经三年高速扩张，2026年预计突破4,280亿元。监管趋严、平台分化、AI工具普及，三重力量重塑竞争格局——流量红利消退后，精准定位与私域运营成为决胜关键。
        </p>

        <h3 style={{ fontSize: 15, color: "#fff", fontWeight: 700, marginBottom: 8 }}>
          市场规模五年趋势
        </h3>
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              <th style={TH}>年份</th>
              <th style={TH}>市场规模</th>
              <th style={TH}>YoY增速</th>
              <th style={TH}>关键驱动事件</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["2022", "1,891亿元", "+18.2%", "轻医美普及，水光针爆发"],
              ["2023", "2,274亿元", "+20.3%", "小红书医美笔记月均破5000万"],
              ["2024", "2,851亿元", "+25.4%", "抖音医美官方认证开放，直播GMV翻倍"],
              ["2025E", "3,512亿元", "+23.2%", "AI肤质检测+私域闭环成主流"],
              ["2026F", "4,280亿元", "+21.9%", "合规化监管重塑竞争格局"],
            ].map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : GOLD_BG }}>
                {row.map((cell, j) => (
                  <td key={j} style={{ ...TD, color: j === 0 ? GOLD : "rgba(255,255,255,0.85)", fontWeight: j === 0 ? 700 : 400 }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={{ fontSize: 15, color: "#fff", fontWeight: 700, margin: "28px 0 8px" }}>
          四平台医美账号数据对比（2025Q4）
        </h3>
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              {["平台", "月活创作者", "头部粉丝均值", "平均CPM", "主要变现路径", "客单价区间"].map(h => (
                <th key={h} style={{ ...TH, fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["小红书", "42万+", "28.6万", "¥85", "种草引流+私信咨询", "¥3,000-18,000"],
              ["抖音", "63万+", "51.2万", "¥62", "直播带货+橱窗", "¥580-3,600"],
              ["B站", "8.7万", "18.4万", "¥120", "知识付费+品牌合作", "¥398-2,800"],
              ["快手", "29万+", "38.1万", "¥41", "直播连麦+私域社群", "¥299-1,800"],
            ].map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : GOLD_BG }}>
                {row.map((cell, j) => (
                  <td key={j} style={{ ...TD, fontSize: 11, color: j === 0 ? GOLD : "rgba(255,255,255,0.82)", fontWeight: j === 0 ? 700 : 400 }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <div
          style={{
            display: "flex",
            gap: 16,
            marginTop: 28,
            flexWrap: "wrap",
          }}
        >
          {[
            ["赛道总规模(2026F)", "¥4,280亿"],
            ["年增速CAGR", "+22.3%"],
            ["头部集中度CR10", "34.7%"],
            ["小红书医美月均笔记", "7,200万篇"],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{
                flex: "1 1 160px",
                background: "#111",
                border: `1px solid ${GOLD_DIM}`,
                borderRadius: 6,
                padding: "14px 16px",
              }}
            >
              <div style={{ fontSize: 10, color: "rgba(200,160,0,0.6)", marginBottom: 6, fontFamily: "sans-serif" }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: GOLD }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 差异化方案页 */}
      <div style={{ ...PAGE, position: "relative", overflow: "hidden" }}>
        <WatermarkLayer />
        <div style={{ fontSize: 10, color: "rgba(200,160,0,0.5)", letterSpacing: 3, marginBottom: 8, fontFamily: "sans-serif" }}>
          MV STUDIO PRO 战略智库 · 第8期 · 医美赛道
        </div>
        <h2 style={{ fontSize: 22, color: GOLD, fontWeight: 800, marginBottom: 4 }}>
          四、差异化破局方案
        </h2>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", lineHeight: 1.8, marginBottom: 20 }}>
          基于全平台数据扫描与头部账号拆解，我们识别出12个尚未饱和的蓝海机会矩阵。以下展示前3个典型方向，完整版包含定位公式、内容模板与30天冲刺方案。
        </p>

        <h3 style={{ fontSize: 15, color: "#fff", fontWeight: 700, marginBottom: 8 }}>
          蓝海机会矩阵（节选）
        </h3>
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              {["机会方向", "竞争密度", "变现天花板", "推荐平台", "核心差异化标签"].map(h => (
                <th key={h} style={TH}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["熟龄抗衰科普", "低", "¥28万/月", "小红书+B站", "#40+逆龄 #科学护肤"],
              ["男性医美启蒙", "极低", "¥19万/月", "抖音+快手", "#直男变帅 #无痛变化"],
              ["术前术后真实记录", "中", "¥35万/月", "小红书", "#真实不滤镜 #恢复日记"],
            ].map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : GOLD_BG }}>
                {row.map((cell, j) => (
                  <td key={j} style={{ ...TD, color: j === 0 ? GOLD : "rgba(255,255,255,0.82)", fontWeight: j === 0 ? 700 : 400 }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {/* 模糊遮罩 */}
        <div style={{ ...BLUR_OVERLAY }}>
          <div
            style={{
              textAlign: "center",
              padding: "18px 32px",
              border: `1px solid ${GOLD_DIM}`,
              background: "rgba(5,3,0,0.85)",
              borderRadius: 8,
            }}
          >
            <div style={{ fontSize: 13, color: GOLD, fontWeight: 700, marginBottom: 6 }}>
              🔒 完整版内容已解锁
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.7 }}>
              完整版包含 12 个蓝海机会分析 + 30天冲刺手册 + 90天里程碑目标
            </div>
          </div>
        </div>

        {/* 填充模糊区内容（被遮罩） */}
        <div style={{ marginTop: 8, filter: "blur(6px)" }}>
          <table style={TABLE_STYLE}>
            <tbody>
              {["产后修复医美科普", "新生儿父母教育类医美", "医美避坑指南系列", "海外医美对比测评", "素人逆袭改造记录", "医美机构幕后探秘", "中医+现代医美融合", "学生党平价轻医美", "企业高管形象管理", "医美从业者职场成长"].map((item, i) => (
                <tr key={i}>
                  <td style={{ ...TD, color: "rgba(255,255,255,0.6)" }}>{item}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ─── 季度定制 HTML ─────────────────────────────────────────────────────────
function QuarterlyPages() {
  return (
    <>
      {/* 封面页 */}
      <div style={PAGE}>
        <WatermarkLayer />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 1003,
            textAlign: "center",
            gap: 24,
          }}
        >
          <div style={{ fontSize: 13, color: GOLD, letterSpacing: 4, fontFamily: "sans-serif" }}>
            MV Studio Pro 战略智库
          </div>
          <div style={{ fontSize: 12, color: "rgba(200,160,0,0.6)", letterSpacing: 2, fontFamily: "sans-serif" }}>
            尊享季度私人订制 · 2026年4月28日
          </div>
          <div
            style={{
              width: "100%",
              height: 1,
              background: `linear-gradient(to right, transparent, ${GOLD}, transparent)`,
              margin: "8px 0",
            }}
          />
          <div
            style={{
              fontSize: 36,
              fontWeight: 900,
              lineHeight: 1.4,
              color: "#fff",
              letterSpacing: 2,
            }}
          >
            《你的专属战略升级方案》
          </div>
          <div
            style={{
              fontSize: 16,
              color: GOLD,
              fontWeight: 600,
              letterSpacing: 3,
            }}
          >
            个人IP孵化 × 知识付费赛道
          </div>
          <div
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.5)",
              lineHeight: 1.8,
              maxWidth: 480,
            }}
          >
            基于你的账号数据、变现路径与竞品矩阵，本报告为你量身定制90天增长战役路线图。
          </div>
          <div
            style={{
              width: "100%",
              height: 1,
              background: `linear-gradient(to right, transparent, ${GOLD}, transparent)`,
              margin: "8px 0",
            }}
          />
          <div
            style={{
              fontSize: 12,
              color: GOLD_DIM,
              border: `1px solid ${GOLD_DIM}`,
              padding: "6px 20px",
              letterSpacing: 2,
              fontFamily: "sans-serif",
            }}
          >
            试读版 · 完整版共 52 页 · 专属定制
          </div>
        </div>
      </div>

      {/* 竞争力雷达页 */}
      <div style={PAGE}>
        <WatermarkLayer />
        <div style={{ fontSize: 10, color: "rgba(200,160,0,0.5)", letterSpacing: 3, marginBottom: 8, fontFamily: "sans-serif" }}>
          MV STUDIO PRO 尊享季度私人订制 · 知识博主IP孵化
        </div>
        <h2 style={{ fontSize: 22, color: GOLD, fontWeight: 800, marginBottom: 4 }}>
          二、竞争力雷达分析
        </h2>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", lineHeight: 1.8, marginBottom: 20 }}>
          对标知识付费赛道头部账号（粉丝量50万+），从六个维度解码你与行业标杆的差距，并给出可量化的提升路径。
        </p>

        <h3 style={{ fontSize: 15, color: "#fff", fontWeight: 700, marginBottom: 8 }}>
          六维度竞争力评分对比
        </h3>
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              {["能力维度", "行业头部均值", "新锐均值", "差距说明"].map(h => (
                <th key={h} style={TH}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["内容生产力", "9.2/10", "5.8/10", "头部日更1.4条/持续3年以上"],
              ["选题命中率", "8.7/10", "4.3/10", "头部选题爆率达38%，新锐约9%"],
              ["私域转化率", "7.9/10", "3.1/10", "头部私域粉丝转化率14.6%"],
              ["商业变现效率", "9.4/10", "2.8/10", "头部CPF(每粉价值)达¥18.7"],
              ["粉丝粘性", "8.8/10", "4.6/10", "头部7日回访率71%"],
              ["跨平台协同", "8.1/10", "2.4/10", "头部双平台协同涨粉效率提升3.2x"],
            ].map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : GOLD_BG }}>
                {row.map((cell, j) => (
                  <td key={j} style={{ ...TD, color: j === 0 ? GOLD : j === 1 ? "#4ade80" : j === 2 ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.55)", fontWeight: j === 0 ? 700 : 400, fontSize: j === 3 ? 11 : 13 }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={{ fontSize: 15, color: "#fff", fontWeight: 700, margin: "28px 0 8px" }}>
          四平台协同矩阵（2025年算法解码）
        </h3>
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              {["平台", "月活用户", "最佳内容形式", "最佳发布时段", "首推变现路径", "知识付费客单价"].map(h => (
                <th key={h} style={{ ...TH, fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["小红书", "3.2亿", "图文干货+短视频", "晚20:00-22:00", "1v1付费咨询", "¥299-1,980"],
              ["抖音", "7.8亿", "60-180s竖屏干货", "晚19:00-21:30", "直播知识付费", "¥99-680"],
              ["B站", "3.6亿", "10-25min横屏深度", "周末14:00-17:00", "专栏+课程", "¥198-2,580"],
              ["快手", "4.1亿", "直播为主+短视频辅", "晚20:30-23:00", "直播粉丝团", "¥68-398"],
            ].map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : GOLD_BG }}>
                {row.map((cell, j) => (
                  <td key={j} style={{ ...TD, fontSize: 11, color: j === 0 ? GOLD : "rgba(255,255,255,0.82)", fontWeight: j === 0 ? 700 : 400 }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 里程碑页 */}
      <div style={{ ...PAGE, position: "relative", overflow: "hidden" }}>
        <WatermarkLayer />
        <div style={{ fontSize: 10, color: "rgba(200,160,0,0.5)", letterSpacing: 3, marginBottom: 8, fontFamily: "sans-serif" }}>
          MV STUDIO PRO 尊享季度私人订制 · 知识博主IP孵化
        </div>
        <h2 style={{ fontSize: 22, color: GOLD, fontWeight: 800, marginBottom: 4 }}>
          五、90天战术里程碑
        </h2>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", lineHeight: 1.8, marginBottom: 20 }}>
          10大战术里程碑，每个节点均包含可执行的行动清单与量化验收指标，帮助你在90天内完成从0到1的商业化突破。
        </p>

        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              {["编号", "战术目标", "完成时限", "预期量化效果"].map(h => (
                <th key={h} style={TH}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["T1", "锁定1个细分垂类，完成竞品TOP20账号数据采集", "第1-2周", "输出竞品分析报告，找到3个差异化方向"],
              ["T2", "完成人设标签系统搭建，确定「核心标签×3+辅助标签×5」组合", "第3-4周", "主页关键词覆盖率提升40%，精准粉比率从12%→28%"],
              ["T3", "发布10条「爆款模板内容」，测试选题命中率", "第5-6周", "10条中至少3条互动率超2%，单条最高播放破5万"],
            ].map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : GOLD_BG }}>
                {row.map((cell, j) => (
                  <td key={j} style={{ ...TD, color: j === 0 ? GOLD : "rgba(255,255,255,0.82)", fontWeight: j === 0 ? 700 : 400, fontSize: j === 1 ? 12 : 13 }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            {/* 模糊行 */}
            {["T4", "T5", "T6", "T7", "T8", "T9", "T10"].map((t, i) => (
              <tr key={t} style={{ filter: "blur(5px)", background: i % 2 === 0 ? "transparent" : GOLD_BG }}>
                <td style={{ ...TD, color: GOLD }}>{t}</td>
                <td style={TD}>████████████████</td>
                <td style={TD}>第{(i + 4) * 2 - 1}-{(i + 4) * 2}周</td>
                <td style={{ ...TD, fontSize: 11 }}>████████████████</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 模糊遮罩 */}
        <div style={{ ...BLUR_OVERLAY }}>
          <div
            style={{
              textAlign: "center",
              padding: "18px 32px",
              border: `1px solid ${GOLD_DIM}`,
              background: "rgba(5,3,0,0.85)",
              borderRadius: 8,
            }}
          >
            <div style={{ fontSize: 13, color: GOLD, fontWeight: 700, marginBottom: 6 }}>
              🔒 订阅后解锁完整版
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.7 }}>
              完整版包含 T4–T10 全部里程碑 + 每周行动清单 + 专属1v1咨询
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── 打印函数 ──────────────────────────────────────────────────────────────
function injectPrintStyles() {
  const id = "sample-print-style";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    @media print {
      body > *:not(#pdf-print-root) { display: none !important; }
      #pdf-print-root { display: block !important; position: static !important; }
      @page { margin: 0; size: A4; }
    }
  `;
  document.head.appendChild(style);
}

function renderAndPrint(content: string) {
  injectPrintStyles();
  const root = document.createElement("div");
  root.id = "pdf-print-root";
  root.style.cssText = "display:none;position:fixed;inset:0;z-index:99999;background:#050300;overflow:auto;";
  root.innerHTML = content;
  document.body.appendChild(root);

  requestAnimationFrame(() => {
    root.style.display = "block";
    setTimeout(() => {
      window.print();
      setTimeout(() => {
        root.remove();
      }, 500);
    }, 300);
  });
}

// 将 React 元素序列化为 HTML 字符串（简单的 renderToStaticMarkup 替代）
// 由于无法在客户端直接用 renderToStaticMarkup，我们使用 DOM 挂载后截取
function printReactContent(pages: React.ReactNode, title: string) {
  // 创建临时容器，ReactDOM.render 已过时，使用临时 div + innerHTML 复制
  const tempContainer = document.createElement("div");
  tempContainer.style.cssText = "position:fixed;left:-9999px;top:0;width:794px;";
  document.body.appendChild(tempContainer);

  // 动态 import react-dom/client 来渲染
  import("react-dom/client").then(({ createRoot }) => {
    const tempRoot = createRoot(tempContainer);
    tempRoot.render(React.createElement("div", null, pages));

    // 等待渲染完成
    setTimeout(() => {
      const html = tempContainer.innerHTML;
      tempRoot.unmount();
      tempContainer.remove();
      renderAndPrint(`
        <div style="font-family:'Noto Serif SC',SimSun,serif;background:#050300;min-height:100vh;">
          <div style="padding:0;">${html}</div>
        </div>
      `);
    }, 200);
  });
}

// ─── 主组件 ────────────────────────────────────────────────────────────────
export default function SampleReportDownload() {
  function downloadBiweekly() {
    printReactContent(React.createElement(BiweeklyPages), "战略半月刊第8期样本");
  }

  function downloadQuarterly() {
    printReactContent(React.createElement(QuarterlyPages), "尊享季度私人订制样本");
  }

  return (
    <section
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "80px 24px",
      }}
    >
      {/* 标题区 */}
      <div style={{ textAlign: "center", marginBottom: 56 }}>
        <div
          style={{
            display: "inline-block",
            fontSize: 11,
            letterSpacing: 4,
            color: "#c8a000",
            background: "rgba(200,160,0,0.08)",
            border: "1px solid rgba(200,160,0,0.2)",
            padding: "4px 16px",
            marginBottom: 20,
            fontFamily: "sans-serif",
          }}
        >
          免费试读
        </div>
        <h2
          style={{
            fontSize: 32,
            fontWeight: 800,
            color: "#fff",
            margin: "0 0 12px",
            lineHeight: 1.3,
          }}
        >
          下载样本报告，感受
          <span style={{ color: "#c8a000" }}>战略级</span>
          内容质感
        </h2>
        <p
          style={{
            fontSize: 15,
            color: "rgba(255,255,255,0.5)",
            maxWidth: 520,
            margin: "0 auto",
            lineHeight: 1.7,
          }}
        >
          两份真实样本，带水印试读。完整版订阅后解锁全部内容与专属定制服务。
        </p>
      </div>

      {/* 卡片区 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 28,
        }}
      >
        {/* 半月刊卡片 */}
        <div
          style={{
            background: "linear-gradient(135deg, #0e0c00 0%, #1a1500 100%)",
            border: "1px solid rgba(200,160,0,0.25)",
            borderRadius: 12,
            padding: "32px 28px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 8,
                background: "rgba(200,160,0,0.12)",
                border: "1px solid rgba(200,160,0,0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
              }}
            >
              📊
            </div>
            <div>
              <div style={{ fontSize: 11, color: "rgba(200,160,0,0.6)", letterSpacing: 2, fontFamily: "sans-serif" }}>
                BIWEEKLY · 第8期
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>
                战略半月刊（样本）
              </div>
            </div>
          </div>

          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.7 }}>
            主题：<span style={{ color: "rgba(200,160,0,0.85)" }}>医美/皮肤科赛道 2026 精准破局手册</span>
            <br />
            含：市场规模趋势、四平台数据对比、蓝海机会矩阵（节选）
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontSize: 12,
              color: "rgba(255,255,255,0.4)",
            }}
          >
            <div>✓ 五年市场规模趋势数据</div>
            <div>✓ 四平台医美账号横向对比</div>
            <div>✓ 蓝海机会矩阵前3名（完整版12个）</div>
            <div style={{ color: "rgba(200,160,0,0.4)" }}>🔒 差异化定位公式（订阅解锁）</div>
          </div>

          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "sans-serif" }}>
            共 47 页 · 出刊：2026年4月28日
          </div>

          <button
            onClick={downloadBiweekly}
            style={{
              marginTop: 4,
              padding: "13px 0",
              background: "linear-gradient(90deg, #c8a000, #f0c800)",
              border: "none",
              borderRadius: 8,
              color: "#0a0800",
              fontWeight: 800,
              fontSize: 14,
              cursor: "pointer",
              letterSpacing: 1,
              transition: "opacity 0.2s",
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "0.88")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
          >
            ↓ 下载试读版
          </button>
        </div>

        {/* 季度定制卡片 */}
        <div
          style={{
            background: "linear-gradient(135deg, #08000e 0%, #130020 100%)",
            border: "1px solid rgba(180,100,255,0.2)",
            borderRadius: 12,
            padding: "32px 28px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 14,
              right: 14,
              fontSize: 10,
              color: "#c8a000",
              background: "rgba(200,160,0,0.1)",
              border: "1px solid rgba(200,160,0,0.25)",
              padding: "2px 10px",
              borderRadius: 20,
              fontFamily: "sans-serif",
              letterSpacing: 1,
            }}
          >
            专属定制
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 8,
                background: "rgba(180,100,255,0.12)",
                border: "1px solid rgba(180,100,255,0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
              }}
            >
              🎯
            </div>
            <div>
              <div style={{ fontSize: 11, color: "rgba(180,100,255,0.6)", letterSpacing: 2, fontFamily: "sans-serif" }}>
                QUARTERLY · 专属定制
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>
                尊享季度私人订制（样本）
              </div>
            </div>
          </div>

          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.7 }}>
            主题：<span style={{ color: "rgba(180,100,255,0.85)" }}>知识博主 × 个人IP孵化专属路线图</span>
            <br />
            含：竞争力雷达评分、四平台协同矩阵、90天里程碑（节选）
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontSize: 12,
              color: "rgba(255,255,255,0.4)",
            }}
          >
            <div>✓ 六维度竞争力雷达对标分析</div>
            <div>✓ 四平台2025年算法解码与协同矩阵</div>
            <div>✓ 90天战术里程碑前3条（完整10条）</div>
            <div style={{ color: "rgba(200,160,0,0.4)" }}>🔒 专属1v1咨询通道（订阅解锁）</div>
          </div>

          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "sans-serif" }}>
            共 52 页 · 出刊：2026年4月28日
          </div>

          <button
            onClick={downloadQuarterly}
            style={{
              marginTop: 4,
              padding: "13px 0",
              background: "linear-gradient(90deg, #7c3aed, #a855f7)",
              border: "none",
              borderRadius: 8,
              color: "#fff",
              fontWeight: 800,
              fontSize: 14,
              cursor: "pointer",
              letterSpacing: 1,
              transition: "opacity 0.2s",
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "0.88")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
          >
            ↓ 下载试读版
          </button>
        </div>
      </div>

      {/* 底部说明 */}
      <div
        style={{
          textAlign: "center",
          marginTop: 32,
          fontSize: 12,
          color: "rgba(255,255,255,0.25)",
          lineHeight: 1.8,
        }}
      >
        试读版带水印，仅供参考。订阅后可下载完整无水印版本及历史期刊档案库。
        <br />
        如浏览器弹出打印对话框，请选择"另存为PDF"即可保存到本地。
      </div>
    </section>
  );
}

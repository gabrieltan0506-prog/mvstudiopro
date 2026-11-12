/** 测试夹具：审稿改稿用的虚构正文、审稿与修改稿（不含任何真实模型输出）。 */
export const REVISE_ORIGINAL =
  "第三集 账册\n\n" +
  "沈昭跪在殿前，手里攥着那封密信。" +
  "侍郎把账册摔在她脚边，说明日早朝前交不出真账，沈家满门流放。" +
  "她想起父亲临行前交给她的那枚玉佩，背面刻着一个户字。".repeat(1) +
  "她起身去户部库房，库房卯时换了锁，钥匙在御史台。".repeat(30);
export const REVISE_REVIEW = {
  scores: { 紧凑度: 3, 逻辑: 2, 精彩度: 3, 反转: 2, 情绪高潮: 3, 冲突: 4, 伏笔: 3 },
  issues: [
    { dimension: "逻辑", quote: "钥匙在御史台", problem: "主角如何得知钥匙下落没有交代", fix: "补一句信息来源" },
    { dimension: "紧凑度", quote: "她起身去户部库房", problem: "同一动作重复多次", fix: "合并为一场" },
    { dimension: "伏笔", quote: "背面刻着一个户字", problem: "玉佩之后没有推进", fix: "让玉佩在库房前派上用场" },
  ],
  keep: ["侍郎摔账册的开场"],
  verdict: "需改：先补信息来源，再合并重复场。",
};
export const REVISE_REVISED = {
  title: "账册",
  text: "沈昭跪在殿前，侍郎把账册摔在她脚边。".repeat(80),
  changes: [{ issue: "钥匙在御史台", what: "补上小顺子带回的消息" }],
};

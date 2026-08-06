/**
 * 剧本导入文本归一化：全角空格 → 半角、繁体 → 简体。
 *
 * 外部剧本（编剧手写 / 其他工具产出）常繁简混排、标题里夹全角空格
 * （如「第01集　血落殘玉」），不处理会在三处静默失配：场景命中统计、
 * 角色漂移检测、可拍表说话人锁脸——因为这些环节全靠字符串精确匹配。
 *
 * 用 opencc-js 的 `t2cn` 子包（仅繁→简字符字典，约 68KB），不用主包
 * `opencc-js`（含全部方向字典，约 1.1MB）：shared/ 会被前端一起打包，
 * 这里没必要把没用到的方向也塞进客户端体积。
 */
import { Converter } from "opencc-js/t2cn";

const traditionalToSimplified = Converter({ from: "t", to: "cn" });

/** 全角空格（U+3000）→ 半角空格；不动其他空白字符 */
export function normalizeFullwidthSpace(text: string): string {
  return String(text || "").replace(/\u3000/g, " ");
}

/**
 * 导入即归一化：整份文本转半角空格 + 简体。
 *
 * 只在「新导入」这一步整体转换——此时还没有任何已保存的资产名/id 依赖
 * 这份文本的原始字形，不存在历史 key 漂移风险。转完之后 pack 里存的就是
 * 归一化后的文本，后续解析、标题匹配、对白抓取全部在同一套字符集上跑。
 */
export function normalizeManhuaImportText(raw: string): string {
  return traditionalToSimplified(normalizeFullwidthSpace(String(raw || "")));
}

/**
 * 仅用于比较，不用于存储：把两个字符串都转到同一套字符集再比对，
 * 避免「已保存的旧资产名（可能未归一化）」与「新解析出的名字」因为
 * 繁简或全半角空格不同而判定为不匹配。绝不能拿这个函数的返回值去覆盖
 * 已保存的资产名——那会让旧数据的 id/key 对不上。
 */
export function normalizeForManhuaNameMatch(text: string): string {
  return traditionalToSimplified(normalizeFullwidthSpace(String(text || ""))).trim();
}

import { describe, it, expect } from "vitest";
import { readManhuaTimedStoryboard } from "./manhuaTimedStoryboard";
import { parseWorkbenchShotsFromText } from "./manhuaScriptWorkbench";
import { evaluateWriterPackAssetAndDensity } from "./manhuaWriterAssetCanon";
import { createManhuaAudioFromShots } from "./manhuaAudioFromShots";
const header =
  "|镜号|约时码|景别|角度|运镜|灯光|构图|主体动作|音频|转场/卡点|时长建议|\n|---|---|---|---|---|---|---|---|---|---|---|";
const row = (
  id: string,
  start: string,
  duration: string,
  audio = "无对白＋脚步"
) =>
  `|${id}|${start}|中景|平视腰肩机位|横移跟拍|冷青晨雾|街巷|甲背娘挪步|${audio}|冷开场|${duration}|`;
const sample =
  header +
  "\n" +
  row("01", "0:00", "4s", "娘：「慢点。」＋咳喘") +
  "\n" +
  row("02", "0:04", "3s");
describe("真实11列反推表匿名回归", () => {
  it("起始时码加明确秒长进入生产reader及工作台，不把景别当动作", () => {
    const parsed = readManhuaTimedStoryboard(sample);
    expect(parsed.recognized).toBe(true);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      index: 1,
      startSec: 0,
      endSec: 4,
      cameraZh: "中景；平视腰肩机位；横移跟拍；街巷",
      actionZh: "甲背娘挪步；灯光：冷青晨雾；转场/卡点：冷开场",
      dialogueZh: "娘：「慢点。」",
      soundZh: "咳喘",
    });
    const shots = parseWorkbenchShotsFromText(sample);
    expect(shots).toHaveLength(2);
    expect(shots.map(s => s.durationSec)).toEqual([4, 3]);
    expect(shots[0].actionZh).toBe("甲背娘挪步；灯光：冷青晨雾；转场/卡点：冷开场");
    expect(shots[0].dialogueZh).not.toContain("咳喘");
  });
  it("21镜匿名连续表总长86秒；不合并行、不补默认秒数", () => {
    const durations = [4, 3, ...Array(18).fill(4), 7];
    let start = 0;
    const lines = durations.map((d, i) => {
      const clock = `${Math.floor(start / 60)}:${String(start % 60).padStart(2, "0")}`;
      start += d;
      return row(String(i + 1).padStart(2, "0"), clock, `${d}s`);
    });
    const parsed = readManhuaTimedStoryboard(header + "\n" + lines.join("\n"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(21);
    expect(parsed.rows.at(-1)?.endSec).toBe(86);
  });
  it.each([
    ["范围时长", sample.replace("4s", "3–4s"), "无精确时长"],
    ["缺时长列", sample.replace("|时长建议|", "|备注|"), "缺"],
    ["秒位越界", sample.replace("0:04", "0:64"), "秒位无效"],
    ["时间间隙", sample.replace("0:04", "0:05"), "不连续"],
    ["列数缺失", sample.replace("|冷开场|4s|", "|4s|"), "列数"],
    [
      "不明确对白",
      sample.replace("娘：「慢点。」＋咳喘", "娘：慢点＋咳喘"),
      "音频",
    ],
    [
      "自相矛盾音频",
      sample.replace("娘：「慢点。」＋咳喘", "无对白＋娘：「慢点。」"),
      "音频",
    ],
    [
      "音效标签混对白",
      sample.replace("娘：「慢点。」＋咳喘", "音效：咳喘＋娘：「慢点。」"),
      "音频",
    ],
    [
      "无对白却含说话人",
      sample.replace("娘：「慢点。」＋咳喘", "无对白＋娘：慢点"),
      "音频",
    ],
  ])("%s明确拒绝", (_label, raw, error) => {
    const parsed = readManhuaTimedStoryboard(raw);
    expect(parsed.recognized).toBe(true);
    expect(parsed.errors.join("\n")).toContain(error);
    expect(
      evaluateWriterPackAssetAndDensity({
        episodes: [{ index: 1, body: raw }],
        segmentCountMode: "actual",
      }).errors.join("\n")
    ).toContain(error);
  });
  it("引号内加号保持台词，多个说话人不串为音效", () => {
    const raw = sample.replace(
      "娘：「慢点。」＋咳喘",
      "娘：「甲＋乙。」＋甲：「知道了。」＋脚步"
    );
    const parsed = readManhuaTimedStoryboard(raw);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0].dialogueZh).toBe(
      "娘：「甲＋乙。」\n甲：「知道了。」"
    );
    expect(parsed.rows[0].soundZh).toBe("脚步");
  });
});

it("相邻明确说话人无需加号也逐句保留，后置音效独立", () => {
  const parsed = readManhuaTimedStoryboard(
    sample.replace(
      "娘：「慢点。」＋咳喘",
      "母亲：「先走……」女孩：「马上到了。」＋咳声、脚步"
    )
  );
  expect(parsed.errors).toEqual([]);
  expect(parsed.rows[0].dialogueZh).toBe(
    "母亲：「先走……」\n女孩：「马上到了。」"
  );
  expect(parsed.rows[0].soundZh).toBe("咳声、脚步");
});
it("明确无对白后的引号拟声归入音效，不虚构说话人", () => {
  const parsed = readManhuaTimedStoryboard(
    sample.replace("娘：「慢点。」＋咳喘", "无对白＋「咯」一声、众声俱寂")
  );
  expect(parsed.errors).toEqual([]);
  expect(parsed.rows[0].dialogueZh).toBe("无");
  expect(parsed.rows[0].soundZh).toBe("「咯」一声、众声俱寂");
});

it("真实模型起止时码与对白括注进入原镜，表演说明不进入 TTS", () => {
  const raw = sample.replace("|01|0:00|", "|01|0:00–0:04|").replace("|02|0:04|", "|02|0:04–0:07|")
    .replace("娘：「慢点。」＋咳喘", "娘：「慢点。」（约2秒，气声偏低）＋音效：咳喘");
  const parsed = readManhuaTimedStoryboard(raw);
  expect(parsed.errors).toEqual([]);
  expect(parsed.rows.map(r => [r.startSec, r.endSec])).toEqual([[0, 4], [4, 7]]);
  expect(parsed.rows[0]).toMatchObject({dialogueZh:"娘：「慢点。」",soundZh:"音效：咳喘"});
  expect(parsed.rows[0].actionZh).toContain("对白表演：娘：约2秒，气声偏低");
  const audio = createManhuaAudioFromShots(parseWorkbenchShotsFromText(raw), 7);
  expect(audio.cues.filter(c => c.kind === "dialogue").map(c => c.textZh)).toEqual(["慢点。"]);
});

it.each([
  [sample.replace("0:00", "0:00–0:05"), "不一致"],
  [sample.replace("0:00", "0:00–0:64"), "秒位无效"],
  [sample.replace("娘：「慢点。」＋咳喘", "娘：「慢点。」（甲：快走）＋咳喘"), "音频"],
  [sample.replace("娘：「慢点。」＋咳喘", "娘：「慢点。」（她说“快走”）＋咳喘"), "音频"],
  [sample.replace("娘：「慢点。」＋咳喘", "娘：「慢点。」（气声)＋咳喘"), "音频"],
])("矛盾时码及不明确括注仍拒绝：%s", (raw, error) => {
  expect(readManhuaTimedStoryboard(raw).errors.join("；")).toContain(error);
});

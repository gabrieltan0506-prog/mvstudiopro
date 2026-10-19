import { describe, expect, it } from "vitest";
import {
  applyDigitalHumanCinema,
  assertDigitalHumanCinemaApplied,
  compileDigitalHumanCinema,
  digitalHumanCinemaSchema,
} from "./digitalHumanCinema";
import {
  newDigitalHumanDraft,
  digitalHumanDraftSchema,
  prepareDigitalHumanVideo,
  prepareDigitalHumanOmniVideo,
  digitalHumanFilmTarget,
} from "./digitalHumanStudio";
import {
  addDigitalHumanSegment,
  switchDigitalHumanSegment,
} from "./digitalHumanProject";
const id = "00000000-0000-4000-8000-000000000001",
  next = "00000000-0000-4000-8000-000000000002",
  audioId = "00000000-0000-4000-8000-000000000003";
function ready() {
  const d = newDigitalHumanDraft("7", id);
  d.script = "讲清楚每个决定";
  d.voiceId = "test-voice";
  d.portrait = { source: "gs://test-only/person.png", name: "人物" };
  d.scene = { source: "gs://test-only/scene.png", name: "场景" };
  d.audios = [
    {
      request: {
        billingRequestId: audioId,
        input: d.script,
        voice: d.voiceId,
        speakerId: "test",
        speakerZh: "本人",
        voiceStateZh: "",
      },
      status: "succeeded",
      source: "gs://test-only/audio.wav",
      durationSec: 12,
    },
  ];
  d.approvedAudioRequestId = audioId;
  return d;
}
describe("Cinema导演设置进入真实数字人合同", () => {
  it("旧稿不新增门禁；采用保留手写文字且重采用不堆叠", () => {
    const d = ready();
    expect(prepareDigitalHumanVideo(d, next).prompt).toContain(d.script);
    const c = digitalHumanCinemaSchema.parse({ movement: "缓推" });
    const a = applyDigitalHumanCinema("原始对白要求", c);
    const b = applyDigitalHumanCinema(a, { ...c, movement: "拉远" });
    expect(b).toContain("原始对白要求");
    expect(b).not.toContain("缓推");
    expect(b.match(/【Cinema导演设置】/g)).toHaveLength(1);
    expect(() => applyDigitalHumanCinema("【Cinema导演设置】半段", c)).toThrow(
      "标记"
    );
    expect(() => applyDigitalHumanCinema("长".repeat(20000), c)).toThrow(
      "超过"
    );
  });
  it("未采用和改选后阻断两种新生成；采用后真实prompt和导演修订号变化", () => {
    const d = ready();
    const old = digitalHumanFilmTarget(d).revision;
    d.cinema = digitalHumanCinemaSchema.parse({
      movement: "缓推",
      lighting: "窗边柔光",
    });
    expect(() => prepareDigitalHumanVideo(d, next)).toThrow("采用");
    d.direction = applyDigitalHumanCinema(d.direction, d.cinema);
    expect(prepareDigitalHumanVideo(d, next).prompt).toContain("运镜：缓推");
    expect(digitalHumanFilmTarget(d).revision).not.toBe(old);
    d.cinema.movement = "拉远";
    expect(() => assertDigitalHumanCinemaApplied(d)).toThrow("采用");
    expect(() => digitalHumanFilmTarget(d)).toThrow("采用");
  });
  it("口播只编译表演与节奏，沿用照片完整音轨并禁止错入口", () => {
    const d = ready();
    d.cinema = digitalHumanCinemaSchema.parse({
      mode: "talking",
      movement: "360度环绕",
      lighting: "剪影",
      expression: "沉稳专注",
    });
    d.direction = applyDigitalHumanCinema("原话完整", d.cinema);
    expect(compileDigitalHumanCinema(d.cinema)).not.toContain("360度");
    const row = prepareDigitalHumanOmniVideo(d, next);
    expect(row.prompt).toContain("沉稳专注");
    expect(row.performanceImage).toEqual(d.portrait);
    expect(row.audioSource).toBe(d.audios[0].source);
    expect(() => prepareDigitalHumanVideo(d, next)).toThrow("模式");
    d.cinema.expression = "坚定有力";
    expect(() => prepareDigitalHumanOmniVideo(d, next)).toThrow("采用");
  });
  it("JSON云稿合同和分段切换保留设置及采用文本，不污染下一段", () => {
    let d = ready();
    d.cinema = digitalHumanCinemaSchema.parse({ palette: "暖金" });
    d.direction = applyDigitalHumanCinema(d.direction, d.cinema);
    const original = d.direction;
    d = addDigitalHumanSegment(d, next);
    expect(d.cinema).toBeUndefined();
    d = digitalHumanDraftSchema.parse(JSON.parse(JSON.stringify(d)));
    d = switchDigitalHumanSegment(d, id);
    expect(d.cinema?.palette).toBe("暖金");
    expect(d.direction).toBe(original);
    expect(() => assertDigitalHumanCinemaApplied(d)).not.toThrow();
  });
});

it("静帧排除运动与剪辑，自定义色板和灯光进入实际采用文字且容量严格校验",()=>{
 const cinema=digitalHumanCinemaSchema.parse({mode:"image",movement:"缓推",tempo:"密集跳切",customPalette:["#123456"],customLights:[{direction:"左侧",color:"#ffffff",brightness:60,softness:80}]});
 const prompt=applyDigitalHumanCinema("人物原文",cinema);
 expect(prompt).toContain("人物原文");expect(prompt).toContain("#123456");expect(prompt).toContain("左侧");expect(prompt).toContain("60%");expect(prompt).not.toContain("缓推");expect(prompt).not.toContain("密集跳切");
 expect(()=>digitalHumanCinemaSchema.parse({...cinema,customLights:Array(5).fill(cinema.customLights[0])})).toThrow();
 expect(()=>digitalHumanCinemaSchema.parse({...cinema,customPalette:["javascript:bad"]})).toThrow();
});

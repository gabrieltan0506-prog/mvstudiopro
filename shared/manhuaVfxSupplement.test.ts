import { it, expect } from "vitest";
import { extractManhuaShotVfx, upsertManhuaShotVfx } from "./manhuaVfxSupplement";
import { mergeManhuaDerivedClipPrompt } from "./manhuaClipUserSupplement";
it("特效采用、存储恢复和重编译不丢用户内容，同镜替换保留他镜", () => {
  const first=upsertManhuaShotVfx("原系统稿\n【用户补充】\n保持衣服颜色",1,"手掌形成全息地图，照亮指尖");
  const second=upsertManhuaShotVfx(first,2,"轮胎接地后扬尘");
  const restored=JSON.parse(JSON.stringify({prompt:second}));
  const recompiled=mergeManhuaDerivedClipPrompt("更新后的系统秒轴",restored.prompt);
  const replaced=upsertManhuaShotVfx(recompiled,1,"全息地图收拢，手指离开后熄灭");
  for(const content of ["更新后的系统秒轴","保持衣服颜色","轮胎接地后扬尘","手指离开后熄灭"]) expect(replaced).toContain(content);
  expect(extractManhuaShotVfx(replaced,1)).toBe("全息地图收拢，手指离开后熄灭");
  expect(replaced).not.toContain("照亮指尖");expect(replaced.match(/【镜头特效：1】/g)).toHaveLength(1);
});
it("区块破损和保留标记拒绝写入，不吞人工文字",()=>{
 expect(()=>upsertManhuaShotVfx("【用户补充】\n【镜头特效：1】原内容",1,"新特效")).toThrow("不完整");
 expect(()=>upsertManhuaShotVfx("原稿",1,"【用户补充】覆盖")).toThrow("内部区块");
 expect(()=>upsertManhuaShotVfx("原稿",0,"新特效")).toThrow("有效镜头");
});

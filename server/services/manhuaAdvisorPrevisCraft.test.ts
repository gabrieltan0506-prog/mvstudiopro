import { expect, it } from "vitest";
import { buildAdvisorPrevisCraftBlock } from "./manhuaAdvisorPrevisCraft";
import { createManhuaPrevisStudio } from "../../shared/manhuaPrevis";
import { makeAdvisorPrevisTarget } from "../../shared/manhuaAdvisorPrevisEdit";
import { listManhuaDirectionCards } from "../../shared/manhuaDirectionCanonLibrary";
import { MANHUA_CAMERA_MOVE_BANK } from "../../shared/manhuaCameraMoveBank";
import { listPathCameraRecipes } from "../../shared/manhuaPathCameraRecipeBank";
import { listNarrativeLighting } from "../../shared/manhuaNarrativeLightingBank";
it("采用真实导演卡版本与运镜代码目录，不向生产泄漏内部人名", () => {
  const card = listManhuaDirectionCards()[0];
  const target = { ...makeAdvisorPrevisTarget("clip", createManhuaPrevisStudio(5)), directionCardId: card.id, directionCardVersion: card.version };
  const text = buildAdvisorPrevisCraftBlock(target);
  expect(text).toContain("当前导演包：");
  expect(text).toContain("红蓝双轨一镜");
  expect(text).toContain("接触前5帧");
  if (card.internal?.personName) expect(text).not.toContain(card.internal.personName);
  expect(buildAdvisorPrevisCraftBlock({ ...target, directionCardVersion: "旧版本" })).toContain("禁止擅自套用新版");
});

it("未指定导演包时自动提供已批准库，用户不必知道包名", () => {
  const text = buildAdvisorPrevisCraftBlock({});
  expect(text).toContain("自动从下列已批准导演包");
  expect(text).toContain("情感与空间因果先于醒目技术");
  expect(text).toContain("红蓝双轨一镜");
  expect(text).toContain("不让用户提供包名或配方名");
});

it("顾问读取实际摄影、路径和灯光库，并区分不同产物的能力", () => {
  const text = buildAdvisorPrevisCraftBlock({});
  for (const entry of [...MANHUA_CAMERA_MOVE_BANK, ...listPathCameraRecipes(), ...listNarrativeLighting()]) {
    expect(text).toContain(entry.nameZh);
    expect(text).toContain(entry.whenToUseZh);
  }
  expect(text).toContain("FOV是视场角，不等于POV/FPV");
  expect(text).toContain("摇镜是原地转向");
  expect(text).toContain("unsupportedZh");
  expect(text).toContain("演员微表情与喜怒哀乐");
  expect(text).toContain("场景氛围优化");
  expect(text).toContain("说话人与听者各自反应");
  expect(text).toContain("不套人的咬肌或手指动作");
  expect(text).toContain("无面部动画的白模");
  expect(buildAdvisorPrevisCraftBlock({}, "world")).toContain("textPrompt只写静态场景");
  expect(buildAdvisorPrevisCraftBlock({}, "general")).toContain("不自行改音轨、段长或提交生产");
});

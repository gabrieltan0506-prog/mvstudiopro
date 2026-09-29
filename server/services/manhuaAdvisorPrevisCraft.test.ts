import { expect, it } from "vitest";
import { buildAdvisorPrevisCraftBlock } from "./manhuaAdvisorPrevisCraft";
import { createManhuaPrevisStudio } from "../../shared/manhuaPrevis";
import { makeAdvisorPrevisTarget } from "../../shared/manhuaAdvisorPrevisEdit";
import { listManhuaDirectionCards } from "../../shared/manhuaDirectionCanonLibrary";
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

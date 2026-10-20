import { expect, it } from "vitest";
import { MANHUA_CAMERA_MOVE_BANK } from "./manhuaCameraMoveBank";
import { MANHUA_OVERSEAS_FILMS as films, MANHUA_OVERSEAS_METHODS as methods, MANHUA_OVERSEAS_CATEGORIES as categories, prepareOverseasAdvisorQuestion, buildManhuaOverseasReference } from "./manhuaOverseasKnowledge";
import { buildManhuaCraftReference } from "./manhuaCraftKnowledge";

it("32部来源、六类去重方法、时间窗和现有运镜ID形成闭环", () => {
  expect(films).toHaveLength(32);
  const all = [...films, ...methods];
  expect(new Set(all.map(row => row.id)).size).toBe(all.length);
  expect(new Set(methods.map(row => row.category))).toEqual(new Set(categories));
  for (const film of films) {
    expect(film.evidence.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(new URL(film.evidence.sourceUrl).hostname).toBe("static.wavespeed.ai");
    expect(film.evidence.fromSec).toBeGreaterThanOrEqual(0);
    expect(film.evidence.toSec).toBeGreaterThan(film.evidence.fromSec);
    expect(film.evidence.toSec).toBeLessThanOrEqual(film.evidence.durationSec);
    expect(film.methodIds.length).toBeGreaterThan(0);
    for (const id of film.methodIds) expect(methods.find(row => row.id === id)?.filmIds).toContain(film.id);
  }
  for (const item of methods) {
    expect(item.filmIds.length).toBeGreaterThan(0);
    for (const id of item.filmIds) expect(films.some(row => row.id === id)).toBe(true);
    for (const id of item.cameraMoveIds || []) expect(MANHUA_CAMERA_MOVE_BANK.some(row => row.id === id)).toBe(true);
  }
});
it("显式后排ID不会被泛词或限额截掉，带入原文与校正边界", () => {
  for (const film of films) {
    const reference = buildManhuaCraftReference(prepareOverseasAdvisorQuestion(film.id));
    expect(reference).toContain(film.adaptationZh);
    expect(reference).toContain(film.cautionZh);
    expect(reference).toContain(film.evidence.sourceSha256);
  }
  expect(buildManhuaCraftReference("运镜 overseas-film-32")).toContain("近空桶底");
  const many = films.slice(20).map(row => row.id).join(" ");
  const ref = buildManhuaOverseasReference(many);
  for (const film of films.slice(20)) expect(ref).toContain(film.adaptationZh);
});
it("未知编号明确缺失，不替换相邻条目；普通问题不强灌素材", () => {
  expect(() => prepareOverseasAdvisorQuestion("overseas-film-99")).toThrow("未找到");
  const ref = buildManhuaOverseasReference("运镜 overseas-film-99");
  expect(ref).toContain('"missing":["overseas-film-99"]');
  expect(ref).toContain('"selected":[]');
  expect(buildManhuaOverseasReference("天气预报")).toBe("");
  expect(buildManhuaOverseasReference("灯光氛围")).toContain("奇幻光照到邻近物");
  expect(buildManhuaOverseasReference("声音剪辑")).toContain("未人工试听");
});
it("泛问出海能发现全部目录，镜面具体问题能命中对应方法", () => {
  const overview = buildManhuaCraftReference("漫剧出海有什么内容");
  for (const row of [...films, ...methods]) expect(overview).toContain(row.titleZh);
  expect(buildManhuaCraftReference("镜面特效怎么做")).toContain("镜像从同步到自主");
});

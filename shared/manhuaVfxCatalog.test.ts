import { describe, expect, it } from "vitest";
import { MANHUA_VFX_CATEGORIES, MANHUA_VFX_CATALOG, findManhuaVfxPreset, searchManhuaVfxPresets, formatManhuaVfxDirection } from "./manhuaVfxCatalog";

describe("分类特效文字配方",()=>{
 it("20类至少5条，稳定编号与名称唯一，每条有完整机制与边界",()=>{
  expect(MANHUA_VFX_CATEGORIES).toHaveLength(20);expect(MANHUA_VFX_CATALOG).toHaveLength(106);
  expect(new Set(MANHUA_VFX_CATALOG.map(p=>p.id)).size).toBe(106);expect(new Set(MANHUA_VFX_CATALOG.map(p=>p.nameZh)).size).toBe(106);
  for(const c of MANHUA_VFX_CATEGORIES)expect(MANHUA_VFX_CATALOG.filter(p=>p.categoryId===c.id).length).toBeGreaterThanOrEqual(5);
  for(const p of MANHUA_VFX_CATALOG){expect(p.id).toMatch(/^vfx-[a-z-]+$/);for(const k of ['sourceZh','trajectoryZh','contactZh','resultZh','integrationZh','boundaryZh'] as const)expect(p[k].trim(), `${p.id}.${k}`).not.toBe('');for(const label of ['来源：','轨迹：','接触：','结果：','受光：','遮挡：','残留：','适用边界：'])expect(p.descriptionZh).toContain(label);}
 });
 it("搜索中文、分类及多词，未知编号/分类不猜测",()=>{
  const hits=searchManhuaVfxPresets('轮胎','impact');expect(hits.length).toBeGreaterThan(0);expect(hits.every(p=>p.categoryId==='impact')).toBe(true);
  expect(searchManhuaVfxPresets('冻结 主体','time')).toHaveLength(1);expect(searchManhuaVfxPresets('', 'missing')).toEqual([]);
  expect(findManhuaVfxPreset('missing')).toBeUndefined();expect(()=>formatManhuaVfxDirection('missing')).toThrow('未识别');
 });
 it("编译非空并逐字保留自定义意图，不注入电影或角色名，不冒充白模支持",()=>{
  const custom='  第2秒由左手触发\n仅作用于门，保留原角色。  ';
  for(const p of MANHUA_VFX_CATALOG){const plain=formatManhuaVfxDirection(p.id);expect(plain).toContain(p.descriptionZh);expect(plain).toContain("未给出的条件标为待补");expect(plain).toContain("主观感知与客观事实必须区分");expect(plain).not.toMatch(/速度与激情|复仇者联盟|美国队长|星际迷航|黑客帝国|Matrix|白模已支持/);expect(formatManhuaVfxDirection(p.id,custom)).toContain(`\n${custom}`);}
  expect(findManhuaVfxPreset('vfx-time-frozen-camera')?.boundaryZh).toContain('普通环绕不等于');
 });
});

/**
 * 已落盘到 client/public 的示范图 id（有 jpg 才进 UI）。
 * 由 `pnpm run manhua:scene-prop-daily`（COPY_PUBLIC=1）或
 * `pnpm exec tsx scripts/sync-manhua-demo-public-ready.mts` 刷新。
 * 未生成的目录槽禁止在资产墙 / 示范条展示「待生成」占位。
 */

export const MANHUA_DEMO_PUBLIC_READY_IDS: ReadonlySet<string> = new Set([
  "demo_scene_ancient_jianghu_inn",
  "demo_scene_ancient_palace",
  "demo_scene_ancient_palace_gate_empty",
  "demo_scene_ancient_street",
  "demo_scene_ancient_wedding_hall",
  "demo_scene_intrigue_court",
  "demo_scene_intrigue_court_aisle_low",
  "demo_scene_intrigue_court_empty_front",
  "demo_scene_intrigue_court_side_pillars",
  "demo_scene_intrigue_study",
  "demo_scene_novel_manor_yard",
  "demo_scene_revenge_border_farm",
  "demo_scene_revenge_rain_alley",
  "demo_scene_romance_penthouse_night",
  "demo_scene_xianxia_cave",
  "demo_scene_xianxia_sect",
  "demo_scene_xuanhuan_demon_palace",
  "demo_scene_xuanhuan_spirit_field",
  "demo_prop_ancient_bridal_fan",
  "demo_prop_ancient_hairpin",
  "demo_prop_ancient_jade",
  "demo_prop_ancient_phoenix_crown",
  "demo_prop_intrigue_hu_tablet",
  "demo_prop_intrigue_seal",
  "demo_prop_intrigue_secret_letter",
  "demo_prop_novel_system_panel",
  "demo_prop_revenge_contract",
  "demo_prop_romance_ring_box",
  "demo_prop_xianxia_pill",
  "demo_prop_xianxia_sword",
  "demo_prop_xuanhuan_token",
]);

export function isManhuaDemoAssetPublicReady(id: string | undefined | null): boolean {
  const key = String(id || "").trim();
  return Boolean(key && MANHUA_DEMO_PUBLIC_READY_IDS.has(key));
}

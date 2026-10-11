# Main merge: six new VFX kinds without approved prices

Baseline: 56e1114ddb623ec42fa462f7eebca97d5a46616c. Fix prepared 2026-10-10 20:43 UTC; root owns commit/push and repository-wide TypeScript verification.

Cross-file source review: `shared/manhuaVfx.ts` has 25 supported effects after main merge, whereas `shared/manhuaVfxPricing.ts` and its originating commit `374942ea` only established 19 approved per-item prices. `docs/evidence/advisor-craft-1010/1697-特效标价与工作机验证.md` explicitly documents those 19 prices and that billing is disabled. No authorized category/default price for the six additional effects was found.

The six additions (`mirror_corridor`, `floating_paper`, `cup_fracture`, `fruit_stall_fracture`, `city_fold`, `prop_scene`) therefore have explicit null prices, meaning unpriced, not free. Quotes containing any one of them fail with a clear unsupported-price message, even when mixed with approved higher-priced effects. All 19 original prices, maximum-layer-price selection, 15-second units and half-price tail behavior stay intact.

The actual editor displays “待确认标价” in the picker and “此方案含未核价特效，暂不提供报价” for affected compositions. Advisor inspect returns null prices and no total quote. Existing 3D imports, rendering behavior and billingEnabled=false remain intact.

Evidence: `unit.txt` — 20 pricing tests passed. `browser.txt` — real local Chrome with fake transport passed original advisor/workshop flow plus the new unpriced picker/total/advisor assertions. No paid provider call, render or deployment occurred. This is development verification, not online acceptance.

import type { ManhuaVfxEnvironmentOption } from "@shared/manhuaVfxEnvironment";
import type { ManhuaVfxEffect } from "@shared/manhuaVfx";
import { deriveManhuaVfxChoreographySpec, MANHUA_VFX_WORLD_RENDER_DEFAULTS, type ManhuaVfxChoreography } from "@shared/manhuaVfxChoreography";
import type { VfxSceneOption } from "./ManhuaVfxEffectParameters";

const fieldClass = "mt-1 w-full rounded border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-white";
type World = NonNullable<ManhuaVfxEffect["world"]>;
export function ManhuaVfxChoreographyEditor({ world, scene, environments = [], onChange }: {
  world: World; scene?: VfxSceneOption; environments?: ManhuaVfxEnvironmentOption[]; onChange: (world: World) => void;
}) {
  const plan = world.choreography;
  const patchPlan = (choreography: ManhuaVfxChoreography | undefined) => onChange({ ...world, choreography });
  let issue = "";
  if (plan) {
    try {
      if (!scene?.spec) throw new Error("所选历史场景缺少角色配置，请先查询原场景任务");
      deriveManhuaVfxChoreographySpec(scene.spec, plan);
    } catch (error) { issue = error instanceof Error ? error.message : "请核对穿行路线"; }
  }
  return <div className="space-y-3 rounded border border-white/15 p-3">
    <p className="text-white">角色穿行与受光</p>
    <p>角色身份来自所选三维版本。人形和四足沿各自骨架步态行进；秒位对应源动画。穿行路线或物理受光提交前检查全部活动帧的保守净空，靠近碎片时停止并保留问题帧，不自动改变原动作。</p>
    {!scene?.spec ? <p className="text-amber-200">先选择有完整历史配置的场景。</p> : <div className="space-y-2">
      {scene.spec.actors.map(actor => {
        const route = plan?.routes.find(row => row.actorId === actor.id);
        return <div key={actor.id} className="rounded border border-white/10 p-2">
          <label className="flex items-center gap-2"><input type="checkbox" aria-label={`穿行角色-${actor.id}`} checked={Boolean(route)} onChange={event => {
            if (!event.target.checked) {
              const routes = plan!.routes.filter(row => row.actorId !== actor.id);
              patchPlan(routes.length ? { ...plan!, routes } : undefined); return;
            }
            const points = actor.motionRoute ?? [
              { timeSec: 0, position: actor.start, facingDeg: actor.facingDeg },
              { timeSec: scene.spec!.durationSec - 1 / 24, position: actor.end, facingDeg: actor.facingDeg },
            ];
            patchPlan({ clearanceMeters: plan?.clearanceMeters ?? .08, routes: [...(plan?.routes ?? []), { actorId: actor.id, points: structuredClone(points) }] });
          }} />{actor.nameZh} · {actor.shape === "horse" ? "四足" : "人形"} · {actor.id}</label>
          {route ? <div className="mt-2 space-y-2">{route.points.map((point, index) => <div key={index} className="grid grid-cols-5 gap-1">
            {(["timeSec", "x", "y", "facingDeg"] as const).map(key => <label key={key}>{({ timeSec: "源秒位", x: "地面X", y: "地面Y", facingDeg: "朝向°" })[key]}<input className={fieldClass} aria-label={`${actor.id}-路线-${index}-${key}`} type="number" step={key === "timeSec" ? 1 / 24 : .1}
              value={key === "x" ? point.position[0] : key === "y" ? point.position[1] : point[key]}
              min={key === "timeSec" ? 0 : key === "facingDeg" ? -180 : -12} max={key === "timeSec" ? scene.spec!.durationSec - 1 / 24 : key === "facingDeg" ? 180 : 12}
              onChange={event => {
                let value = Number(event.target.value);
                if (key === "timeSec") value = Math.round(value * 24) / 24;
                patchPlan({ ...plan!, routes: plan!.routes.map(row => row.actorId !== actor.id ? row : { ...row, points: row.points.map((old, i) => i !== index ? old : key === "x" || key === "y" ? { ...old, position: key === "x" ? [value, old.position[1]] : [old.position[0], value] } : { ...old, [key]: value }) }) });
              }} /></label>)}
            <button type="button" disabled={route.points.length <= 2} onClick={() => patchPlan({ ...plan!, routes: plan!.routes.map(row => row.actorId !== actor.id ? row : { ...row, points: row.points.filter((_, i) => i !== index) }) })}>删除点</button>
          </div>)}<button type="button" disabled={route.points.length >= 12} onClick={() => {
            const points = [...route.points], first = points[0], next = points[1];
            points.splice(1, 0, { timeSec: Math.round((first.timeSec + next.timeSec) * 12) / 24, position: [(first.position[0] + next.position[0]) / 2, (first.position[1] + next.position[1]) / 2], facingDeg: first.facingDeg });
            patchPlan({ ...plan!, routes: plan!.routes.map(row => row.actorId === actor.id ? { ...row, points } : row) });
          }}>插入途经点</button></div> : null}
        </div>;
      })}
      {plan ? <label>穿行角色之间及角色与碎片最小净空（米）<input className={fieldClass} aria-label="world-clearance" type="number" min={.01} max={.5} step={.01} value={plan.clearanceMeters} onChange={event => patchPlan({ ...plan, clearanceMeters: Number(event.target.value) })} /></label> : null}
      {issue ? <p role="alert" className="text-amber-200">{issue}</p> : null}
    </div>}
    <label>正式场景外观<select className={fieldClass} aria-label="world-environment" value={world.environment?.worldTaskId || ""} onChange={event => {
      const selected = environments.find(item => item.worldTaskId === event.target.value);
      onChange({ ...world, environment: selected ? { worldTaskId: selected.worldTaskId, sceneRef: selected.sceneRef, sourceVersion: selected.sourceVersion } : undefined,
        ...(selected ? { render: { ...(world.render ?? MANHUA_VFX_WORLD_RENDER_DEFAULTS), quality: "beauty", exportLayers: false } } : {}) });
    }}><option value="">沿用源预演场景</option>{environments.map(item => <option key={item.worldTaskId} value={item.worldTaskId}>{item.label}</option>)}</select></label>
    {world.environment ? <p>使用本作品已完成的3DGS场景和碰撞面，同一相机下渲染完整人物与碎片；环境反射来自该场景，环境接收阴影的精度受碰撞面限制，需实际审片。此模式输出完整场景视频，分层下载仅用于原三维场景模式。</p> : !environments.length ? <p>当前没有同时具备已归档3DGS、碰撞面及尺度信息的已确认场景。现有图片和旧版本不会自动代用。</p> : null}
    <label className="flex gap-2"><input type="checkbox" disabled={Boolean(world.environment)} checked={Boolean(world.render)} onChange={event => onChange({ ...world, render: event.target.checked ? { ...MANHUA_VFX_WORLD_RENDER_DEFAULTS, exportLayers: false } : undefined })} />恢复源材质并启用物理受光</label>
    {world.render ? <div className="space-y-2"><p>{world.environment ? "使用全部已绑定的完整人物材质、阴影贴图与逐帧环境反射；环境阴影精度取决于场景碰撞面。" : "使用资产实际保存的材质；没有贴图的资产仍是原资产外观。精细画质重新读取已绑定的完整模型并使用光线追踪，耗时更长；超过网格预算会明确停止。"}</p>
      <label>画质<select className={fieldClass} aria-label="world-quality" disabled={Boolean(world.environment)} value={world.render.quality} onChange={event => onChange({ ...world, render: { ...world.render!, quality: event.target.value as "preview" | "beauty", exportLayers: event.target.value === "beauty" && world.render!.exportLayers } })}><option value="preview">快速受光预览</option><option value="beauty">精细受光</option></select></label>
      <label className="flex gap-2"><input type="checkbox" aria-label="world-export-layers" disabled={world.render.quality !== "beauty" || Boolean(world.environment)} checked={world.render.exportLayers} onChange={event => onChange({ ...world, render: { ...world.render!, exportLayers: event.target.checked } })} />输出并重组同场分层（精细受光）</label>
      {world.render.exportLayers ? <p>包含底层、遮挡后的透明碎片、人物遮罩、深度与相互受光差值；重组核对后输出视频，可下载分层。更换人物、相机或底层后须重渲，不能直接叠到改写后的画面。分层上限512MiB。</p> : null}
      <div className="grid grid-cols-2 gap-2">{([{ key: "samples", label: "采样", min: 16, max: 64, step: 1 }, { key: "exposure", label: "曝光", min: -2, max: 2, step: .1 }, { key: "keyEnergy", label: "主光强度", min: 100, max: 3000, step: 50 }, { key: "fillRatio", label: "辅光比例", min: 0, max: 1, step: .05 }] as const).map(field => <label key={field.key}>{field.label}<input className={fieldClass} type="number" aria-label={`world-${field.key}`} min={field.min} max={field.max} step={field.step} value={world.render![field.key]} onChange={event => onChange({ ...world, render: { ...world.render!, [field.key]: Number(event.target.value) } })} /></label>)}</div>
    </div> : null}
  </div>;
}

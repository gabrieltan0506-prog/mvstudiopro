import {
  CINEMA_PALETTE_COLORS,
  CINEMA_OPTIONS,
  type CinemaKey,
  type DigitalHumanCinema,
} from "@shared/digitalHumanCinema";

const groups: { title: string; keys: CinemaKey[] }[] = [
  { title: "影片设定", keys: ["genre", "era", "tempo"] },
  { title: "摄影机", keys: ["camera", "lens", "aperture", "movement"] },
  { title: "色彩", keys: ["palette"] },
  { title: "灯光", keys: ["lighting"] },
  { title: "人物表演", keys: ["expression", "gestures"] },
];
export function CinemaDirectorControls({
  value,
  onChange,
}: {
  value: DigitalHumanCinema;
  onChange(patch: Partial<DigitalHumanCinema>): void;
}) {
  const allowed = (key: CinemaKey) =>
    value.mode === "talking"
      ? ["tempo", "expression", "gestures"].includes(key)
      : value.mode !== "image" || !["tempo", "movement"].includes(key);
  return (
    <div className="dh-cinema-cards">
      {groups.map(group => {
        const keys = group.keys.filter(allowed);
        if (!keys.length) return null;
        return (
          <details key={group.title} className="dh-cinema-card">
            <summary>
              <strong>{group.title}</strong>
              <small>{keys.map(key => value[key]).join(" · ")}</small>
            </summary>
            {keys.map(key => (
              <label key={key}>
                {CINEMA_OPTIONS[key].label}
                <select
                  aria-label={`Cinema${CINEMA_OPTIONS[key].label}`}
                  value={value[key]}
                  onChange={e => onChange({ [key]: e.target.value })}
                >
                  {CINEMA_OPTIONS[key].values.map(option => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
            ))}
            {group.title === "影片设定" && value.mode !== "talking" && (
              <small>
                年代影响拍摄质感，不改变故事发生年代。节奏描述镜头剪辑。
              </small>
            )}
            {group.title === "色彩" && (
              <div aria-label="自定义色板">
                <div className="dh-cinema-swatches" aria-label="当前配色示意">
                  {(value.customPalette.length
                    ? value.customPalette
                    : (CINEMA_PALETTE_COLORS[value.palette] ?? [])
                  ).map((color, i) => (
                    <span
                      key={i}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
                <small>配色示意；保留原有场景与人物。</small>
                <p>自定义色板 · 最多六色</p>
                <div className="flex flex-wrap gap-2">
                  {value.customPalette.map((color, i) => (
                    <span key={i}>
                      <input
                        type="color"
                        aria-label={`色板颜色${i + 1}`}
                        value={color}
                        onChange={e =>
                          onChange({
                            customPalette: value.customPalette.map((v, n) =>
                              n === i ? e.target.value : v
                            ),
                          })
                        }
                      />
                      <button
                        type="button"
                        aria-label={`移除颜色${i + 1}`}
                        onClick={() =>
                          onChange({
                            customPalette: value.customPalette.filter(
                              (_, n) => n !== i
                            ),
                          })
                        }
                      >
                        移除
                      </button>
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={value.customPalette.length >= 6}
                  onClick={() =>
                    onChange({
                      customPalette: [...value.customPalette, "#4a90e2"],
                    })
                  }
                >
                  添加颜色
                </button>
              </div>
            )}
            {group.title === "灯光" && (
              <div aria-label="自定义灯光">
                <p>自定义灯光 · 最多四盏</p>
                {value.customLights.map((light, i) => {
                  const patch = (p: Partial<typeof light>) =>
                    onChange({
                      customLights: value.customLights.map((v, n) =>
                        n === i ? { ...v, ...p } : v
                      ),
                    });
                  return (
                    <fieldset key={i}>
                      <legend>灯光{i + 1}</legend>
                      <label>
                        方向
                        <select
                          aria-label={`灯光${i + 1}方向`}
                          value={light.direction}
                          onChange={e =>
                            patch({
                              direction: e.target
                                .value as typeof light.direction,
                            })
                          }
                        >
                          {["上方", "正面", "右侧", "左侧", "背面", "下方"].map(
                            d => (
                              <option key={d}>{d}</option>
                            )
                          )}
                        </select>
                      </label>
                      <label>
                        颜色
                        <input
                          type="color"
                          value={light.color}
                          onChange={e => patch({ color: e.target.value })}
                        />
                      </label>
                      <label>
                        亮度 {light.brightness}%
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={light.brightness}
                          onChange={e =>
                            patch({ brightness: Number(e.target.value) })
                          }
                        />
                      </label>
                      <label>
                        柔和度 {light.softness}%
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={light.softness}
                          onChange={e =>
                            patch({ softness: Number(e.target.value) })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          onChange({
                            customLights: value.customLights.filter(
                              (_, n) => n !== i
                            ),
                          })
                        }
                      >
                        移除灯光{i + 1}
                      </button>
                    </fieldset>
                  );
                })}
                <button
                  type="button"
                  disabled={value.customLights.length >= 4}
                  onClick={() =>
                    onChange({
                      customLights: [
                        ...value.customLights,
                        {
                          direction: "正面",
                          color: "#ffffff",
                          brightness: 50,
                          softness: 50,
                        },
                      ],
                    })
                  }
                >
                  添加灯光
                </button>
                <small>这些数值描述导演意图；实际光照需审看片子。</small>
              </div>
            )}
          </details>
        );
      })}
    </div>
  );
}

/**
 * 剪辑台 · 交付包编辑（成色 / 字幕 / 配音），与成片坞同源 state。
 */
import {
  MANHUA_DELIVERY_LOCALE_LABEL_ZH,
  type ManhuaDeliveryLocale,
  type ManhuaDeliveryPackage,
  summarizeManhuaDeliveryPackageProgress,
} from "@shared/manhuaDeliveryPackage";
import {
  MANHUA_CINE_VOCAB_LOCALE_LABEL_ZH,
  type ManhuaCineVocabLocale,
} from "@shared/manhuaCineVocabBank";
import { Palette, Mic2, Subtitles } from "lucide-react";

const LOCALES = Object.keys(MANHUA_DELIVERY_LOCALE_LABEL_ZH) as ManhuaDeliveryLocale[];

type Props = {
  deliveryPackage: ManhuaDeliveryPackage;
  onChange: (next: ManhuaDeliveryPackage) => void;
  cineVocabLocale?: ManhuaCineVocabLocale;
  onCineVocabLocaleChange?: (locale: ManhuaCineVocabLocale) => void;
};

export default function ManhuaDeliveryEditSection({
  deliveryPackage,
  onChange,
  cineVocabLocale = "zh",
  onCineVocabLocaleChange,
}: Props) {
  const progress = summarizeManhuaDeliveryPackageProgress(deliveryPackage);
  const patch = (partial: Partial<ManhuaDeliveryPackage>) => {
    onChange({
      ...deliveryPackage,
      ...partial,
      updatedAtIso: new Date().toISOString(),
    });
  };

  return (
    <div
      data-manhua-edit-section="delivery"
      className="rounded-lg border border-violet-400/25 bg-violet-500/[0.06] p-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-white/80">
          <Palette className="h-3.5 w-3.5 text-violet-200/90" />
          交付包 · 成色 / 字幕 / 配音
          <span className="font-normal text-white/40">{progress.labelZh}</span>
        </div>
        {onCineVocabLocaleChange ? (
          <label className="flex items-center gap-1 text-[9px] text-white/45">
            可拍词语言
            <select
              value={cineVocabLocale}
              onChange={(e) =>
                onCineVocabLocaleChange(e.target.value as ManhuaCineVocabLocale)
              }
              className="rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-[9px] text-white/80"
            >
              {(Object.keys(MANHUA_CINE_VOCAB_LOCALE_LABEL_ZH) as ManhuaCineVocabLocale[]).map(
                (loc) => (
                  <option key={loc} value={loc}>
                    {MANHUA_CINE_VOCAB_LOCALE_LABEL_ZH[loc]}
                  </option>
                ),
              )}
            </select>
          </label>
        ) : null}
      </div>

      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-[9px] text-white/45">成色意图</span>
          <input
            value={deliveryPackage.color.lookIntentZh}
            onChange={(e) =>
              patch({ color: { ...deliveryPackage.color, lookIntentZh: e.target.value } })
            }
            className="w-full rounded border border-white/12 bg-black/35 px-2 py-1 text-[10px] text-white/85"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[9px] text-white/45">工作/交付色域</span>
          <input
            value={deliveryPackage.color.workingSpaceHint}
            onChange={(e) =>
              patch({ color: { ...deliveryPackage.color, workingSpaceHint: e.target.value } })
            }
            className="w-full rounded border border-white/12 bg-black/35 px-2 py-1 text-[10px] text-white/85"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[9px] text-white/45">保真色</span>
          <input
            value={deliveryPackage.color.heroColorLocksZh}
            onChange={(e) =>
              patch({ color: { ...deliveryPackage.color, heroColorLocksZh: e.target.value } })
            }
            className="w-full rounded border border-white/12 bg-black/35 px-2 py-1 text-[10px] text-white/85"
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-white/10 pt-2">
        <div className="flex items-center gap-1 text-[9px] font-semibold text-white/60">
          <Subtitles className="h-3 w-3" />
          字幕
        </div>
        <label className="flex items-center gap-1 text-[9px] text-white/55">
          <input
            type="checkbox"
            checked={deliveryPackage.subtitle.needSubtitles}
            onChange={(e) =>
              patch({
                subtitle: { ...deliveryPackage.subtitle, needSubtitles: e.target.checked },
              })
            }
          />
          需要字幕轴
        </label>
        <label className="flex items-center gap-1 text-[9px] text-white/55">
          <input
            type="checkbox"
            checked={deliveryPackage.subtitle.needSdh}
            onChange={(e) =>
              patch({ subtitle: { ...deliveryPackage.subtitle, needSdh: e.target.checked } })
            }
          />
          听障轴
        </label>
        <label className="flex items-center gap-1 text-[9px] text-white/55">
          <input
            type="checkbox"
            checked={deliveryPackage.subtitle.burnInForbidden}
            onChange={(e) =>
              patch({
                subtitle: { ...deliveryPackage.subtitle, burnInForbidden: e.target.checked },
              })
            }
          />
          禁止烧进成片
        </label>
        <label className="flex items-center gap-1 text-[9px] text-white/45">
          语言
          <select
            value={deliveryPackage.subtitle.locale}
            onChange={(e) =>
              patch({
                subtitle: {
                  ...deliveryPackage.subtitle,
                  locale: e.target.value as ManhuaDeliveryLocale,
                },
              })
            }
            className="rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-[9px] text-white/80"
          >
            {LOCALES.map((loc) => (
              <option key={loc} value={loc}>
                {MANHUA_DELIVERY_LOCALE_LABEL_ZH[loc]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-white/10 pt-2">
        <div className="flex items-center gap-1 text-[9px] font-semibold text-white/60">
          <Mic2 className="h-3 w-3" />
          配音
        </div>
        <label className="flex items-center gap-1 text-[9px] text-white/55">
          <input
            type="checkbox"
            checked={deliveryPackage.dubbing.needDubbing}
            onChange={(e) =>
              patch({ dubbing: { ...deliveryPackage.dubbing, needDubbing: e.target.checked } })
            }
          />
          需要配音
        </label>
        <label className="flex items-center gap-1 text-[9px] text-white/55">
          <input
            type="checkbox"
            checked={deliveryPackage.dubbing.needMeStem}
            onChange={(e) =>
              patch({ dubbing: { ...deliveryPackage.dubbing, needMeStem: e.target.checked } })
            }
          />
          M&amp;E 分轨
        </label>
        <label className="block min-w-[12rem] flex-1 space-y-0.5">
          <span className="text-[9px] text-white/45">响度 / 人声</span>
          <input
            value={deliveryPackage.dubbing.loudnessTargetHint}
            onChange={(e) =>
              patch({
                dubbing: { ...deliveryPackage.dubbing, loudnessTargetHint: e.target.value },
              })
            }
            className="w-full rounded border border-white/12 bg-black/35 px-2 py-1 text-[10px] text-white/85"
          />
        </label>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { MapPin, Mic, RotateCcw } from "lucide-react";
import VoiceInputButton from "@/components/VoiceInputButton";
import { useAmbientScene } from "@/components/AmbientSceneProvider";
import { CHINA_PROVINCES, findProvinceById } from "@/lib/chinaLocationCatalog";
import type { ManualLocationStored } from "@/lib/locationOverride";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props = {
  /** 首页窄条 */
  compact?: boolean;
};

export function AmbientLocationPicker({ compact = false }: Props) {
  const {
    locationSource,
    manualLocation,
    applyManualLocation,
    revertToDeviceLocation,
    applyLocationFromSpeechOrText,
  } = useAmbientScene();

  const defaultPid = !manualLocation?.provinceId.startsWith("geo:")
    ? manualLocation?.provinceId ?? "sh"
    : "sh";

  const [provinceId, setProvinceId] = useState(defaultPid);
  const [cityName, setCityName] = useState(() => {
    const p = findProvinceById(defaultPid);
    if (
      manualLocation &&
      !manualLocation.provinceId.startsWith("geo:") &&
      manualLocation.provinceId === defaultPid
    ) {
      return manualLocation.cityName;
    }
    return p?.cities[0]?.name ?? "";
  });

  const province = findProvinceById(provinceId) ?? CHINA_PROVINCES[0]!;

  useEffect(() => {
    if (!manualLocation || manualLocation.provinceId.startsWith("geo:")) return;
    setProvinceId(manualLocation.provinceId);
    setCityName(manualLocation.cityName);
  }, [manualLocation]);

  useEffect(() => {
    const p = findProvinceById(provinceId);
    if (!p?.cities.length) return;
    setCityName((prev) => (p.cities.some((c) => c.name === prev) ? prev : p.cities[0]!.name));
  }, [provinceId]);

  const applySelection = () => {
    const p = findProvinceById(provinceId);
    const c = p?.cities.find((x) => x.name === cityName);
    if (!p || !c) {
      toast.error("请选择有效的省与市／区");
      return;
    }
    const spec: ManualLocationStored = {
      v: 1,
      provinceId: p.id,
      provinceName: p.name,
      cityName: c.name,
      lat: c.lat,
      lon: c.lon,
    };
    applyManualLocation(spec);
    toast.success("已切换手动位置", { description: `${p.name} — ${c.name}` });
  };

  const onVoice = async (text: string) => {
    const r = await applyLocationFromSpeechOrText(text);
    if (r.ok) toast.success("已按语音定位", { description: r.message });
    else toast.message("语音识别未匹配到城市", { description: r.message });
  };

  const triggerClass = compact
    ? "h-8 min-w-[6.8rem] border-white/25 bg-black/35 text-xs text-white/90"
    : "min-w-[9rem] border-white/25 bg-slate-950/65 text-sm text-white/90";

  const geoHint =
    manualLocation?.provinceId.startsWith("geo:") && locationSource === "manual"
      ? `语音/在线查询：${manualLocation.cityName}（${manualLocation.provinceName}）`
      : null;

  const micSize = compact ? 22 : 26;
  const micWrapClass = compact
    ? "h-11 w-11 shrink-0 rounded-2xl"
    : "h-12 w-12 shrink-0 rounded-2xl";

  return (
    <div
      className={
        compact
          ? "pointer-events-auto flex max-w-full flex-col gap-2 rounded-xl border border-white/15 bg-black/30 p-2.5 backdrop-blur-sm"
          : "pointer-events-auto flex flex-col gap-3 rounded-2xl border border-white/15 bg-slate-950/45 p-4 backdrop-blur-md"
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-white/75">
          <MapPin className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          <span className={compact ? "text-[11px] font-semibold" : "text-xs font-bold"}>
            天气／路况位置
          </span>
          <span className="rounded-md bg-emerald-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-100">
            可全语音
          </span>
          <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100/90">
            {locationSource === "manual" ? "手动" : "设备"}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 border-white/25 bg-transparent text-xs text-white/85 hover:bg-white/10"
          onClick={() => {
            revertToDeviceLocation();
            toast.message("已恢复设备定位");
          }}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          设备GPS
        </Button>
      </div>

      {/* 全语音优先：不必碰下拉即可口述省—市—区 */}
      <div
        className={`rounded-xl border border-emerald-500/25 ${compact ? "bg-emerald-950/20 p-2" : "bg-emerald-950/25 p-3"}`}
      >
        <div className="flex items-center gap-1.5 text-emerald-100/95">
          <Mic className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          <span className={compact ? "text-[11px] font-bold" : "text-xs font-bold"}>全语音输入</span>
        </div>
        <p className={`mt-1.5 text-white/55 ${compact ? "text-[10px] leading-snug" : "text-[11px] leading-relaxed"}`}>
          <strong className="text-white/70">人不在当地也能查。</strong>
          例如您身在上海，可念「广东省深圳市的天气和路况」「想查深圳即时新闻」「帮我看看郑州市那边交通」——仪表板会
          <strong className="text-emerald-200/90">按您说的城市</strong>
          更新天气、路况与要闻（与本机 GPS 无关；点「设备 GPS」恢复跟身定位）。
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <VoiceInputButton
            size={micSize}
            className={`${micWrapClass} border-emerald-400/50 bg-emerald-950/40 text-emerald-100 shadow-[0_0_20px_rgba(52,211,153,0.15)]`}
            onTranscript={(t) => {
              void onVoice(t);
            }}
          />
          <span className={`max-w-[16rem] text-white/40 ${compact ? "text-[10px]" : "text-[11px]"}`}>
            录音结束即识别；目录未收的地名会走在线地理搜索补全。
          </span>
        </div>
      </div>

      {geoHint ? (
        <p className="text-[11px] leading-snug text-cyan-100/85">{geoHint}</p>
      ) : (
        <p className="text-[11px] leading-snug text-white/40">
          以下为<strong className="text-white/55">可选</strong>下拉；与语音二选一或互相校验即可。
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={provinceId} onValueChange={setProvinceId}>
          <SelectTrigger className={triggerClass}>
            <SelectValue placeholder="省／直辖市" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {CHINA_PROVINCES.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={cityName} onValueChange={setCityName}>
          <SelectTrigger className={triggerClass}>
            <SelectValue placeholder="市／区县" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {province.cities.map((c) => (
              <SelectItem key={`${province.id}-${c.name}`} value={c.name}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          size="sm"
          className="h-8 bg-violet-600 text-xs text-white hover:bg-violet-500"
          onClick={applySelection}
        >
          应用所选
        </Button>
      </div>
    </div>
  );
}

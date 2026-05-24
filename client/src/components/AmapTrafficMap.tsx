import { useEffect, useId, useRef, useState } from "react";
import AMapLoader from "@amap/amap-jsapi-loader";
import { cn } from "@/lib/utils";
import { wgs84ToGcj02 } from "@/lib/wgs84ToGcj02";

const JS_KEY = String(import.meta.env.VITE_AMAP_JS_KEY || "").trim();
const SECURITY_CODE = String(import.meta.env.VITE_AMAP_JS_SECURITY_CODE || "").trim();

type AmapTrafficMapProps = {
  lat: number;
  lon: number;
  className?: string;
  zoom?: number;
};

/**
 * 高德 JS API 2.0 · 实时路况瓦片图层（绿/黄/红路段着色，约 3 分钟自动刷新）。
 * 需前端配置 VITE_AMAP_JS_KEY + VITE_AMAP_JS_SECURITY_CODE（Web 端 JS API，与服务端 Web 服务 Key 不同）。
 */
export function AmapTrafficMap({ lat, lon, className, zoom = 14 }: AmapTrafficMapProps) {
  const reactId = useId().replace(/:/g, "");
  const containerId = `amap-traffic-${reactId}`;
  const mapRef = useRef<{ destroy: () => void; setCenter: (c: [number, number]) => void } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    if (!JS_KEY) return;
    if (!SECURITY_CODE) {
      setLoadErr("缺少 VITE_AMAP_JS_SECURITY_CODE（安全密钥）");
      return;
    }

    let cancelled = false;
    window._AMapSecurityConfig = { securityJsCode: SECURITY_CODE };
    const gcj = wgs84ToGcj02(lat, lon);
    const center: [number, number] = [gcj.lon, gcj.lat];

    AMapLoader.load({
      key: JS_KEY,
      version: "2.0",
    })
      .then((AMap) => {
        if (cancelled) return;
        const map = new AMap.Map(containerId, {
          zoom,
          center,
          viewMode: "3D",
          pitch: 40,
          mapStyle: "amap://styles/dark",
        });
        const traffic = new AMap.TileLayer.Traffic({
          autoRefresh: true,
          interval: 180,
          zIndex: 10,
          zooms: [7, 20],
        });
        map.add(traffic);
        mapRef.current = map;
        setLoadErr(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : "地图加载失败");
        }
      });

    return () => {
      cancelled = true;
      mapRef.current?.destroy();
      mapRef.current = null;
    };
  }, [containerId, lat, lon, zoom]);

  useEffect(() => {
    if (!mapRef.current) return;
    const gcj = wgs84ToGcj02(lat, lon);
    mapRef.current.setCenter([gcj.lon, gcj.lat]);
  }, [lat, lon]);

  if (!JS_KEY) {
    return (
      <p className="mt-3 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white/45">
        未配置 VITE_AMAP_JS_KEY，仅显示文字路况
      </p>
    );
  }

  if (loadErr) {
    return <p className="mt-3 text-xs text-rose-300/90">{loadErr}</p>;
  }

  return (
    <div className={cn("relative mt-3 overflow-hidden rounded-xl border border-white/10", className)}>
      <div id={containerId} className="h-[220px] w-full bg-slate-900" aria-label="高德实时路况地图" />
      <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-2 rounded-md bg-black/55 px-2 py-1 text-[10px] text-white/75">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
          畅通
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-300" />
          缓行
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
          拥堵
        </span>
      </div>
    </div>
  );
}

export function hasAmapJsApiKey(): boolean {
  return Boolean(JS_KEY && SECURITY_CODE);
}

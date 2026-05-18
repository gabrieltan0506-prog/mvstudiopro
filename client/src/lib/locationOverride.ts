/** 浏览器端持久化：手动城市（绕过 VPN 对 IP 的影响，与设备 GPS 二选一） */

export const LOCATION_OVERRIDE_STORAGE_KEY = "mv_ambient_location_v1";

export type LocationSourceMode = "device" | "manual";

export type ManualLocationStored = {
  v: 1;
  provinceId: string;
  provinceName: string;
  cityName: string;
  lat: number;
  lon: number;
};

export function loadManualLocation(): ManualLocationStored | null {
  try {
    const raw = localStorage.getItem(LOCATION_OVERRIDE_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<ManualLocationStored>;
    if (o?.v !== 1) return null;
    if (typeof o.provinceId !== "string" || typeof o.provinceName !== "string" || typeof o.cityName !== "string")
      return null;
    if (typeof o.lat !== "number" || typeof o.lon !== "number") return null;
    if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) return null;
    return {
      v: 1,
      provinceId: o.provinceId,
      provinceName: o.provinceName,
      cityName: o.cityName,
      lat: o.lat,
      lon: o.lon,
    };
  } catch {
    return null;
  }
}

export function saveManualLocation(s: ManualLocationStored) {
  try {
    localStorage.setItem(LOCATION_OVERRIDE_STORAGE_KEY, JSON.stringify(s));
  } catch {
    /**/
  }
}

export function clearManualLocation() {
  try {
    localStorage.removeItem(LOCATION_OVERRIDE_STORAGE_KEY);
  } catch {
    /**/
  }
}

/** 与 hybridDashboardEngine 一致：高德路况仅支持大陆定位。 */
function isPingtanFujianApprox(lat: number, lon: number): boolean {
  return lat >= 25.12 && lat <= 25.68 && lon >= 119.52 && lon <= 119.99;
}

function isRoughlyTaiwanIsland(lat: number, lon: number): boolean {
  if (isPingtanFujianApprox(lat, lon)) return false;
  return lat >= 21.85 && lat <= 25.55 && lon >= 119.25 && lon <= 122.15;
}

function isRoughlyHongKong(lat: number, lon: number): boolean {
  return lat >= 22.12 && lat <= 22.58 && lon >= 113.78 && lon <= 114.42;
}

function isRoughlyMacau(lat: number, lon: number): boolean {
  return lat >= 22.04 && lat <= 22.24 && lon >= 113.52 && lon <= 113.65;
}

export function isRoughlyMainlandChina(lat: number, lon: number): boolean {
  if (!(lat >= 18 && lat <= 54 && lon >= 73 && lon <= 135)) return false;
  if (isRoughlyTaiwanIsland(lat, lon)) return false;
  if (isRoughlyHongKong(lat, lon)) return false;
  if (isRoughlyMacau(lat, lon)) return false;
  return true;
}

/** 只识别GCS对象域名，不接受控制台、伪装子域或任意代理目标。 */
export function isGcsTransferUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      (u.hostname === "storage.googleapis.com" ||
        /^[a-z0-9][a-z0-9._-]*\.storage\.googleapis\.com$/.test(u.hostname))
    );
  } catch {
    return false;
  }
}

import type { CookieOptions, Request } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");

  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}

/**
 * Extract parent domain for cookie sharing across subdomains.
 * 
 * Examples:
 * - "3000-xxx.manuspre.computer" -> ".manuspre.computer" (dev sandbox)
 * - "www.mvstudiopro.com" -> ".mvstudiopro.com" (production with www)
 * - "mvstudiopro.com" -> undefined (production without www, 2-part domain)
 * - "localhost" -> undefined
 */
function getParentDomain(hostname: string): string | undefined {
  // Don't set domain for localhost or IP addresses
  if (LOCAL_HOSTS.has(hostname) || isIpAddress(hostname)) {
    return undefined;
  }

  // Split hostname into parts
  const parts = hostname.split(".");

  // For 2-part domains like "mvstudiopro.com", don't set domain
  // (the cookie will automatically be scoped to the exact hostname)
  if (parts.length < 3) {
    return undefined;
  }

  // For 3+ part domains like "www.mvstudiopro.com" or "3000-xxx.manuspre.computer"
  // Return parent domain with leading dot to share across subdomains
  // e.g., ".mvstudiopro.com" or ".manuspre.computer"
  return "." + parts.slice(-2).join(".");
}

export function getSessionCookieOptions(
  req: Request,
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  const hostname = req.hostname;
  const domain = getParentDomain(hostname);

  return {
    domain,
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req),
  };
}

import { useEffect } from "react";
import { Loader2 } from "lucide-react";

type LegacyPathRedirectProps = {
  targetPath: string;
  hash?: string;
};

/** 旧成长营路径 → 短路径 /platform 或 /canvas（保留 query）。 */
export function LegacyPathRedirect({ targetPath, hash }: LegacyPathRedirectProps) {
  useEffect(() => {
    const search = window.location.search || "";
    const fragment = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
    window.location.replace(`${targetPath}${search}${fragment}`);
  }, [targetPath, hash]);

  return (
    <div className="min-h-dvh bg-background flex items-center justify-center">
      <Loader2 className="h-8 w-8 text-primary animate-spin" />
    </div>
  );
}

export function GrowthCampToPlatformRedirect() {
  return <LegacyPathRedirect targetPath="/platform" hash="#platform-custom-workspace" />;
}

export function GrowthCampPlatformToPlatformRedirect() {
  return <LegacyPathRedirect targetPath="/platform" />;
}

import { useEffect, useRef, useState } from "react";
import { withLongJobsFlyDirect } from "@/lib/longJobsFlyOrigin";
import { watchManhuaTemplateCatalog } from "@/lib/manhuaTemplateCatalogEvents";

export function useManhuaTemplateCatalogEvents(enabled: boolean, onChange: () => Promise<unknown>) {
  const latest = useRef(onChange);
  latest.current = onChange;
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled) { setConnected(null); return; }
    return watchManhuaTemplateCatalog(withLongJobsFlyDirect("/api/manhua-templates/events"), async () => {
      const result = await latest.current();
      // React Query refetch 默认不会 throw，不能把失败记为目录已同步。
      if (result && typeof result === "object" && "isError" in result && result.isError) throw new Error("模板目录刷新失败");
    }, setConnected);
  }, [enabled]);
  return connected;
}

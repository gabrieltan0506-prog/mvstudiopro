export function fetchGrowthStatus(
  baseUrl: string,
  outputPath: string,
  options?: {
    timeoutMs?: number;
    fetchImpl?: (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{
      ok: boolean;
      status?: number;
      statusText?: string;
      json(): Promise<unknown>;
    }>;
  },
): Promise<void>;

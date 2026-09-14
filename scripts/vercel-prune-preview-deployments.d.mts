export function executePrune(options?: { apply?: boolean; signal?: AbortSignal; root?: string }): Promise<{
  candidates: number; attempted: number; deleted: number; skipped: number;
  remaining: number; dryRun: boolean; receipt: string;
}>;

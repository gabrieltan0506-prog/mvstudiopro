export function readGrowthJsonItemsStream(
  file: string,
  options: { gzip: boolean; onItem: (key: string, value: unknown) => void },
): Promise<{ fields: Record<string, unknown>; itemCount: number; hasItems: boolean }>;
export function normalizeLedgerLabels(value: unknown): string[];
export type GrowthHistoryLedgerMergeEntry = {
  bucket?: string;
  industryLabels?: string[];
  ageLabels?: string[];
  contentLabels?: string[];
  firstSeenAt: string;
  lastSeenAt: string;
};
export function mergeHistoryLedgerEntries<T extends GrowthHistoryLedgerMergeEntry>(
  local: Record<string, T>,
  remote: Record<string, T>,
): Record<string, T>;

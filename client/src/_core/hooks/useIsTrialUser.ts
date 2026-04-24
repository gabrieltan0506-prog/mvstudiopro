import { trpc } from "@/lib/trpc";

/**
 * 判斷當前用戶是否為試用包
 * 試用包需要對生成圖片加水印、禁止右鍵另存
 */
export function useIsTrialUser(): boolean {
  const { data } = trpc.usage.getUsageStats.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  return (data as any)?.isTrial === true;
}

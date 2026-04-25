import { trpc } from "@/lib/trpc";

/**
 * 判断当前用户是否为试用包
 * 试用包需要对生成图片加水印、禁止右键另存
 */
export function useIsTrialUser(): boolean {
  const { data } = trpc.usage.getUsageStats.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  return (data as any)?.isTrial === true;
}

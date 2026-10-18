import { useState } from "react";
import { trpc } from "@/lib/trpc";

/** 所有快照、素材副本和回填都在服务端；下载JSON不是恢复前置条件。 */
export function DigitalHumanBackupPanel({
  disabled,
  create,
  restore,
}: {
  disabled: boolean;
  create: () => Promise<void>;
  restore: (id: string) => Promise<void>;
}) {
  const list = trpc.digitalHuman.listBackups.useQuery(undefined, {
    retry: false,
    refetchInterval: 60_000,
  });
  const advance = trpc.digitalHuman.advanceBackup.useMutation();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const run = async (work: () => Promise<unknown>) => {
    if (working || disabled) return;
    setWorking(true);
    setError("");
    try {
      await work();
      await list.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "云备份暂不可用，原稿保留");
    } finally {
      setWorking(false);
    }
  };
  return (
    <details className="dh-card" aria-label="云端备份与回填">
      <summary>云端备份与回填</summary>
      <p>
        云端每十分钟保留制作稿并分批备份已有素材。回填会先备份当前版本，保留原任务编号，不重新生成媒体。
      </p>
      <button
        type="button"
        disabled={disabled || working}
        onClick={() => void run(create)}
      >
        立即云备份
      </button>
      {(error || list.error) && (
        <p role="alert">{error || list.error?.message}</p>
      )}
      {list.isLoading && <p role="status">正在读取云备份</p>}
      {list.data?.map(item => (
        <div key={item.id}>
          <span>
            {new Date(item.createdAt).toLocaleString()} · {item.title} ·{" "}
            {item.status === "complete"
              ? "完整备份"
              : `备份中 ${item.savedAssets}/${item.assetCount}`}
          </span>
          {item.error && <p role="status">{item.error}</p>}
          {item.status === "pending" ? (
            <button
              type="button"
              disabled={disabled || working}
              onClick={() =>
                void run(() => advance.mutateAsync({ id: item.id }))
              }
            >
              继续此备份
            </button>
          ) : (
            <button
              type="button"
              disabled={disabled || working}
              onClick={() => {
                if (
                  window.confirm(
                    "回填此云端版本？系统会先完整备份当前稿件及素材，不会重新生成媒体。"
                  )
                )
                  void run(() => restore(item.id));
              }}
            >
              回填此版本
            </button>
          )}
        </div>
      ))}
    </details>
  );
}

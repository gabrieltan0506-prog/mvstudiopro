import { useMemo, useRef } from "react";

/** 写入后立即可读；顾问和任务幂等检查不等待 React 下一次渲染。写入失败不更新缓存。 */
export function useDigitalHumanStorage(
  data: Record<string, string>,
  save: (
    update: (current: Record<string, string>) => Record<string, string>
  ) => void
): Storage {
  const latest = useRef({ data, save });
  latest.current = { data, save };
  return useMemo(() => {
    const update = (
      fn: (value: Record<string, string>) => Record<string, string>
    ) => {
      let written = latest.current.data;
      latest.current.save(current => {
        written = fn(current);
        return written;
      });
      latest.current.data = written;
    };
    return {
      get length() {
        return Object.keys(latest.current.data).length;
      },
      key: (i: number) => Object.keys(latest.current.data)[i] ?? null,
      getItem: (key: string) => latest.current.data[key] ?? null,
      setItem: (key: string, value: string) => {
        if (latest.current.data[key] !== value)
          update(current => ({ ...current, [key]: value }));
      },
      removeItem: (key: string) =>
        update(current => {
          const next = { ...current };
          delete next[key];
          return next;
        }),
      clear: () => update(() => ({})),
    };
  }, []);
}

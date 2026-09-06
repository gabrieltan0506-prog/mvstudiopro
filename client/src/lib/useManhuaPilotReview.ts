import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  assertManhuaPilotSubmissionAllowed,
  manhuaPilotScopeKey,
  type ManhuaPilotReviewState,
  type ManhuaPilotScope,
  type ManhuaPilotSubmission,
} from "@shared/manhuaPilotReview";
import {
  fingerprintManhuaPilotProject,
  loadManhuaPilotReview,
  submitManhuaPilotDecision,
} from "./manhuaPilotReviewClient";

/** 服务端任务为审批真源；旧本机批准不迁入、不删除，也不再参与放行。 */
export function useManhuaPilotReview(input: {
  userId: string;
  confirmedAt?: string;
  pack: unknown;
  episodeIndex: number;
  videoModel: string;
}) {
  const sourceKey = useMemo(
    () => JSON.stringify([input.userId, input.confirmedAt || "", input.pack]),
    [input.userId, input.confirmedAt, input.pack]
  );
  const [fingerprint, setFingerprint] = useState({
    sourceKey: "",
    version: "",
    error: "",
  });
  const [view, setView] = useState<{
    key: string;
    review: ManhuaPilotReviewState | null;
    error: string;
    busy: boolean;
  }>({
    key: "",
    review: null,
    error: "",
    busy: false,
  });
  const [refreshIndex, setRefreshIndex] = useState(0);
  const latestSource = useRef(sourceKey);
  latestSource.current = sourceKey;
  const reviewBusyRef = useRef(new Set<string>());
  const readEpoch = useRef(0);
  const refresh = useCallback(() => setRefreshIndex(value => value + 1), []);

  useEffect(() => {
    let disposed = false;
    if (!input.userId || !input.confirmedAt || !input.pack) return;
    void fingerprintManhuaPilotProject(input.confirmedAt, input.pack)
      .then(version => {
        if (!disposed) setFingerprint({ sourceKey, version, error: "" });
      })
      .catch(() => {
        if (!disposed)
          setFingerprint({
            sourceKey,
            version: "",
            error: "无法确认当前剧本版本，暂不能生成试片",
          });
      });
    return () => {
      disposed = true;
    };
  }, [sourceKey, input.userId, input.confirmedAt, input.pack]);

  const version =
    fingerprint.sourceKey === sourceKey ? fingerprint.version : "";
  const scope = useMemo<ManhuaPilotScope | null>(
    () =>
      version
        ? {
            projectVersion: version,
            episodeIndex: input.episodeIndex,
            videoModel: input.videoModel,
          }
        : null,
    [version, input.episodeIndex, input.videoModel]
  );
  const key = scope ? manhuaPilotScopeKey(input.userId, scope) : "";
  const latestKey = useRef(key);
  latestKey.current = key;
  const review = view.key === key ? view.review : null;

  useEffect(() => {
    if (!scope || !key) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      if (reviewBusyRef.current.has(key)) {
        timer = setTimeout(read, 6000);
        return;
      }
      const epoch = ++readEpoch.current;
      try {
        const next = await loadManhuaPilotReview(scope);
        if (disposed || epoch !== readEpoch.current) return;
        setView({ key, review: next, error: "", busy: false });
        if (next.status === "submitting") timer = setTimeout(read, 6000);
      } catch {
        if (!disposed && epoch === readEpoch.current)
          setView({
            key,
            review: null,
            error: "审核状态读取失败，请刷新审核状态；不会自动重新生成",
            busy: false,
          });
      }
    };
    setView({ key, review: null, error: "", busy: true });
    void read();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [key, scope, refreshIndex]);

  const decide = useCallback(
    async (decision: "approve" | "reject", taskId: string) => {
      if (
        !scope ||
        !key ||
        key !== latestKey.current ||
        reviewBusyRef.current.has(key) ||
        review?.status !== "generated" ||
        review.taskId !== taskId
      ) {
        throw new Error("待审片已改变，请刷新并重新查看当前视频");
      }
      reviewBusyRef.current.add(key);
      ++readEpoch.current;
      setView(previous => ({ ...previous, busy: true, error: "" }));
      try {
        const next = await submitManhuaPilotDecision({
          ...scope,
          taskId,
          decision,
        });
        if (latestKey.current === key)
          setView({ key, review: next, error: "", busy: false });
      } catch {
        if (latestKey.current === key) {
          setView({
            key,
            review: null,
            error: "审核保存结果尚未确认，未解锁；请刷新审核状态，不要重新出片",
            busy: false,
          });
        }
        throw new Error("审核结果尚未确认，请刷新审核状态");
      } finally {
        reviewBusyRef.current.delete(key);
      }
      if (latestKey.current !== key)
        throw new Error("审核已保存到原项目；当前项目已切换，请查看当前待审片");
    },
    [scope, key, review]
  );

  const authorize = useCallback(
    async (request: {
      episodeIndex: number;
      segmentIndex: number;
      videoModel: string;
      pilotRun: boolean;
      durationSec: number;
    }): Promise<ManhuaPilotSubmission> => {
      if (!version || !input.userId || latestSource.current !== sourceKey)
        throw new Error("请先确认当前剧本并等待审核记录加载");
      const requestedScope = {
        projectVersion: version,
        episodeIndex: request.episodeIndex,
        videoModel: request.videoModel,
      };
      const latest = await loadManhuaPilotReview(requestedScope);
      if (latestSource.current !== sourceKey)
        throw new Error("项目已切换，本次生成已停止");
      const submission: ManhuaPilotSubmission = {
        projectVersion: version,
        episodeIndex: request.episodeIndex,
        segmentIndex: request.segmentIndex,
        intent: request.pilotRun ? "pilot" : "full",
      };
      assertManhuaPilotSubmissionAllowed(
        latest,
        submission,
        request.durationSec
      );
      return submission;
    },
    [version, input.userId, sourceKey]
  );

  return {
    key,
    review,
    refresh,
    decide,
    authorize,
    busy: !key || view.key !== key || view.busy,
    error:
      fingerprint.sourceKey === sourceKey && fingerprint.error
        ? fingerprint.error
        : !input.userId || !input.confirmedAt || !input.pack
          ? "请先登录并确认剧本，再生成试片"
          : view.key === key
            ? view.error
            : "",
  };
}

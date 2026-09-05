import { describe, expect, it } from "vitest";
import {
  beginManhuaSubtitlePoll,
  beginManhuaSubtitleSubmit,
  createManhuaSubtitleTaskGate,
  finishManhuaSubtitlePoll,
  finishManhuaSubtitleSubmit,
  isManhuaSubtitleTaskBusy,
  toManhuaSubtitlePublicError,
} from "./manhuaSubtitleTaskGate";

describe("manhuaSubtitleTaskGate", () => {
  it("acquires the submit lock synchronously and rejects a second click", () => {
    const first = beginManhuaSubtitleSubmit(createManhuaSubtitleTaskGate());
    const second = beginManhuaSubtitleSubmit(first.state);
    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    expect(isManhuaSubtitleTaskBusy(second.state)).toBe(true);
  });

  it("keeps busy while another episode poll is still active", () => {
    const submitting = beginManhuaSubtitleSubmit(createManhuaSubtitleTaskGate()).state;
    const episode1 = beginManhuaSubtitlePoll(submitting, "pp-e01");
    const episode2 = beginManhuaSubtitlePoll(episode1.state, "pp-e02");
    const duplicate = beginManhuaSubtitlePoll(episode2.state, "pp-e02");
    expect(duplicate.acquired).toBe(false);
    expect(beginManhuaSubtitleSubmit(duplicate.state).acquired).toBe(false);

    const submitted = finishManhuaSubtitleSubmit(duplicate.state);
    const episode1Done = finishManhuaSubtitlePoll(submitted, "pp-e01");
    expect(episode1Done.pollingJobIds).toEqual(["pp-e02"]);
    expect(isManhuaSubtitleTaskBusy(episode1Done)).toBe(true);

    const allDone = finishManhuaSubtitlePoll(episode1Done, "pp-e02");
    expect(isManhuaSubtitleTaskBusy(allDone)).toBe(false);
  });

  it("maps known states and never exposes arbitrary job or network details", () => {
    expect(toManhuaSubtitlePublicError(new Error("timeout after 600000ms"), "poll")).toContain(
      "超时",
    );
    expect(toManhuaSubtitlePublicError(new Error("素材地址无法核对: gs://secret/path"), "submit"))
      .toBe("当前成片来源无法核对，请重新选择仍可播放的成片版本。");
    const unknown = toManhuaSubtitlePublicError(
      new Error("upstream token=secret request-id=abc gs://private/object"),
      "job",
    );
    expect(unknown).toBe("字幕烧录未完成，原片与任务记录已保留。");
    expect(unknown).not.toMatch(/secret|request-id|gs:\/\//i);
  });
});

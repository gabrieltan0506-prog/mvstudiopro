/** 段缓存哑存储层：对象名与入参校验（网络读写为薄封装，由 runner 集成测试覆盖行为）。 */
import { describe, expect, it } from "vitest";
import {
  NATIVE_DEEP_READ_SEGMENT_CACHE_PREFIX,
  nativeDeepReadSegmentCacheObjectName,
} from "./manhuaNativeDeepReadSegmentCache";

describe("段缓存对象名", () => {
  it("与占位/卡片同一 id 生成器，路径形如 segment-cache/tpl_native_<key>_epNNN_segK.json", () => {
    const name = nativeDeepReadSegmentCacheObjectName("36a7c84f485b", 10, 0);
    expect(name).toBe(
      `${NATIVE_DEEP_READ_SEGMENT_CACHE_PREFIX}tpl_native_36a7c84f485b_ep010_seg0.json`,
    );
  });

  it("segmentIndex 越界（<0 或 >31）直接抛，不走网络", () => {
    expect(() => nativeDeepReadSegmentCacheObjectName("36a7c84f485b", 1, -1)).toThrow("非法");
    expect(() => nativeDeepReadSegmentCacheObjectName("36a7c84f485b", 1, 32)).toThrow("非法");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WAVESPEED_TRIPO_H31_IMAGE_TO_3D_PATH,
  WAVESPEED_TRIPO_H31_MULTIVIEW_TO_3D_PATH,
  buildWavespeedTripo3dBody,
  buildWavespeedTripo3dMultiviewBody,
  submitWavespeedTripo3dMultiview,
  pollWavespeedTripo3dOnce,
  submitWavespeedTripo3d,
} from "./wavespeedTripo3d.js";

describe("wavespeedTripo3d", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("按官方 H3.1 image-to-3d 契约提交，并在关闭纹理时同步关闭 PBR", async () => {
    vi.stubEnv("WAVESPEED_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { id: "pred-test-1", status: "created" },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(
      buildWavespeedTripo3dBody({
        image: "https://assets.test/black-horse.png",
        texture: false,
        pbr: true,
        geometryQuality: "detailed",
      })
    ).toEqual({
      image: "https://assets.test/black-horse.png",
      texture_alignment: "original_image",
      orientation: "align_image",
      texture: false,
      pbr: false,
      texture_quality: "standard",
      geometry_quality: "detailed",
      auto_size: false,
      quad: false,
    });

    await expect(
      submitWavespeedTripo3d({
        image: "https://assets.test/black-horse.png",
      })
    ).resolves.toEqual({ predictionId: "pred-test-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.wavespeed.ai${WAVESPEED_TRIPO_H31_IMAGE_TO_3D_PATH}`
    );
  });

  it("完成时优先选择 GLB 输出而不是预览文件", async () => {
    vi.stubEnv("WAVESPEED_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              id: "pred-test-2",
              status: "completed",
              outputs: [
                "https://result.test/preview.png",
                "https://result.test/model.glb?token=test",
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    await expect(pollWavespeedTripo3dOnce("pred-test-2")).resolves.toEqual({
      state: "completed",
      sourceGlbUrl: "https://result.test/model.glb?token=test",
    });
  });

  it("查询返回 404 时转人工对账，不把已提交任务当作失败重建", async () => {
    vi.stubEnv("WAVESPEED_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("missing", { status: 404 }))
    );

    await expect(pollWavespeedTripo3dOnce("pred-test-3")).resolves.toEqual({
      state: "reconcile",
      error: "三维资产任务状态无法确认（HTTP 404）",
    });
  });

  it("多视角：2–4 张 https、顺序原样、去掉 image 字段、其余选项与单图同契约；提交走 multiview-to-3d 路径", async () => {
    vi.stubEnv("WAVESPEED_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "pred-mv-1", status: "created" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const images = [
      "https://assets.test/front.png",
      "https://assets.test/left.png",
      "https://assets.test/back.png",
      "https://assets.test/right.png",
    ];
    expect(buildWavespeedTripo3dMultiviewBody({ images, geometryQuality: "detailed" })).toEqual({
      images,
      texture_alignment: "original_image",
      orientation: "align_image",
      texture: true,
      pbr: true,
      texture_quality: "standard",
      geometry_quality: "detailed",
      auto_size: false,
      quad: false,
    });
    expect(() => buildWavespeedTripo3dMultiviewBody({ images: images.slice(0, 1) })).toThrow("2_to_4");
    expect(() => buildWavespeedTripo3dMultiviewBody({ images: [...images, images[0]!] })).toThrow("2_to_4");
    expect(() => buildWavespeedTripo3dMultiviewBody({ images: ["http://x/a.png", images[1]!] })).toThrow("https");
    await expect(submitWavespeedTripo3dMultiview({ images: images.slice(0, 2) })).resolves.toEqual({ predictionId: "pred-mv-1" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`https://api.wavespeed.ai${WAVESPEED_TRIPO_H31_MULTIVIEW_TO_3D_PATH}`);
    const sent = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(sent.images).toEqual(images.slice(0, 2));
    expect(sent.image).toBeUndefined();
  });
});

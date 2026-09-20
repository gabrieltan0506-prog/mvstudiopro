import { afterEach, expect, it, vi } from "vitest";
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
}));
import {
  probeVideoDurationSec,
  startVideoUpscale,
  VideoUpscaleSubmitError,
} from "./videoUpscaleApi";
import { parsePhotoVideoMetadata } from "../../../server/services/photoMediaInput";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it.each([0.2, 10.08, 10.51, 15.072])(
  "旧画布/工坊probe与API计费契约一致 %s",
  async duration => {
    vi.useFakeTimers();
    const video = {
      duration,
      onloadedmetadata: null as null | (() => void),
      onerror: null,
      src: "",
      preload: "",
      crossOrigin: "",
    };
    vi.stubGlobal("document", { createElement: () => video });
    vi.stubGlobal("window", { setTimeout });
    const result = probeVideoDurationSec("https://example.com/a.mp4");
    video.onloadedmetadata?.();
    const measured = parsePhotoVideoMetadata(
      JSON.stringify({
        format: { duration },
        streams: [{ codec_type: "video", width: 1280, height: 720 }],
      })
    );
    expect(await result).toBe(measured.durationSec);
  }
);
it.each([400, 401, 402, 403, 409, 502, 503])(
  "提交错误保留HTTP状态，仅明确拒绝可重试 %s",
  async status => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status,
        json: async () => ({ ok: false, error: "拒绝" }),
      }))
    );
    const e = await startVideoUpscale({
      videoUrl: "https://example.com/a.mp4",
      target: "2k",
      durationSec: 10,
    }).catch(e => e);
    expect(e).toBeInstanceOf(VideoUpscaleSubmitError);
    expect(e.httpStatus).toBe(status);
    expect(e.definitelyNotStarted).toBe(status < 500);
  }
);
it("代理错误页和网络中断不能认作明确未提交", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => {
        throw new Error("HTML");
      },
    }))
  );
  const input = {
    videoUrl: "https://example.com/a.mp4",
    target: "2k" as const,
    durationSec: 10,
  };
  expect(
    (await startVideoUpscale(input).catch(e => e)).definitelyNotStarted
  ).toBe(false);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("失联");
    })
  );
  await expect(startVideoUpscale(input)).rejects.toThrow("失联");
});

it.each([[854,480,"480p"],[480,854,"480p"],[1280,720,"720p"],[720,1280,"720p"],[1920,1080,"1080p"],[2560,1440,"2k"]])("超分探测真实宽高与服务端分档一致 %s×%s",async(width,height,resolution)=>{
 const {probeVideoUpscaleSource}=await import("./videoUpscaleApi");
 const video={videoWidth:width,videoHeight:height,duration:12.4,onloadedmetadata:null as null|(()=>void),onerror:null,src:"",preload:"",crossOrigin:"",removeAttribute:vi.fn(),load:vi.fn()};
 vi.stubGlobal("document",{createElement:()=>video});
 const promise=probeVideoUpscaleSource("https://example.com/measured.mp4");video.onloadedmetadata?.();
 const result=await promise;expect(result).toMatchObject({width,height,sourceResolution:resolution,sourceUrl:"https://example.com/measured.mp4",durationSec:12});
 expect(result?.sourceResolution).toBe(parsePhotoVideoMetadata(JSON.stringify({streams:[{codec_type:"video",width,height}],format:{duration:12.4}})).sourceResolution);
 expect(video.removeAttribute).toHaveBeenCalledWith("src");
});
it("尺寸缺失/媒体超时不能默认720p，缺省请求也不伪造sourceResolution",async()=>{
 const {probeVideoUpscaleSource}=await import("./videoUpscaleApi");vi.useFakeTimers();
 const video={videoWidth:0,videoHeight:0,duration:10,onloadedmetadata:null as null|(()=>void),onerror:null,src:"",preload:"",crossOrigin:"",removeAttribute:vi.fn(),load:vi.fn()};vi.stubGlobal("document",{createElement:()=>video});
 const invalid=probeVideoUpscaleSource("https://example.com/unknown.mp4");video.onloadedmetadata?.();expect(await invalid).toBeNull();
 const timeout=probeVideoUpscaleSource("https://example.com/timeout.mp4");await vi.advanceTimersByTimeAsync(15000);expect(await timeout).toBeNull();
 const fetcher=vi.fn(async()=>({ok:true,json:async()=>({ok:true,taskId:"test",status:"queued",creditsUsed:1})}));vi.stubGlobal("fetch",fetcher);
 await startVideoUpscale({videoUrl:"https://example.com/a.mp4",target:"2k",durationSec:10});
 expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string,{body:string}])[1].body)).not.toHaveProperty("sourceResolution");
});

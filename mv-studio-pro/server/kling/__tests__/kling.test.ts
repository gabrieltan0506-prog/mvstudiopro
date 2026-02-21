import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock environment variables
vi.stubEnv("KLING_ACCESS_KEY_1", "test_ak_1");
vi.stubEnv("KLING_SECRET_KEY_1", "test_sk_1");
vi.stubEnv("KLING_REGION_1", "global");
vi.stubEnv("KLING_ACCESS_KEY_2", "test_ak_2");
vi.stubEnv("KLING_SECRET_KEY_2", "test_sk_2");
vi.stubEnv("KLING_REGION_2", "cn");

import {
  configureKlingClient,
  getKlingClient,
  parseKeysFromEnv,
} from "../client";
import {
  buildT2VRequest,
  buildI2VRequest,
  buildStoryboardRequest,
  buildAllInOneRequest,
} from "../omni-video";
import {
  buildMotionControlRequest,
  validateMotionControlInputs,
} from "../motion-control";
import {
  buildLipSyncWithAudio,
} from "../lip-sync";
import {
  estimateOmniVideoCost,
  estimateMotionControlCost,
  estimateLipSyncCost,
} from "../types";

// ─── Client Tests ──────────────────────────────────

describe("Kling Client", () => {
  it("should parse API keys from environment variables", () => {
    const keys = parseKeysFromEnv();
    expect(keys.length).toBe(2);
    expect(keys[0].accessKey).toBe("test_ak_1");
    expect(keys[0].secretKey).toBe("test_sk_1");
    expect(keys[0].region).toBe("global");
    expect(keys[1].accessKey).toBe("test_ak_2");
    expect(keys[1].secretKey).toBe("test_sk_2");
    expect(keys[1].region).toBe("cn");
  });

  it("should configure client with multiple keys", () => {
    const keys = parseKeysFromEnv();
    configureKlingClient(keys, "global");
    const client = getKlingClient();
    const stats = client.getKeyStats();
    expect(stats.length).toBe(2);
    expect(stats[0].region).toBe("global");
    expect(stats[1].region).toBe("cn");
  });
});

// ─── Omni Video Request Builder Tests ──────────────

describe("Omni Video Request Builders", () => {
  it("should build T2V request correctly", () => {
    const req = buildT2VRequest({
      prompt: "A beautiful sunset over the ocean",
      mode: "pro",
      aspectRatio: "16:9",
      duration: "10",
    });
    expect(req.model_name).toBe("kling-v3-omni");
    expect(req.prompt).toBe("A beautiful sunset over the ocean");
    expect(req.mode).toBe("pro");
    expect(req.aspect_ratio).toBe("16:9");
    expect(req.duration).toBe("10");
  });

  it("should build T2V request with negative prompt", () => {
    const req = buildT2VRequest({
      prompt: "A cat playing piano",
      negativePrompt: "blurry, low quality",
      mode: "std",
      aspectRatio: "9:16",
      duration: "5",
    });
    expect(req.negative_prompt).toBe("blurry, low quality");
  });

  it("should build I2V request with image reference", () => {
    const req = buildI2VRequest({
      prompt: "The character walks forward",
      imageUrl: "https://example.com/image.jpg",
      imageType: "first_frame",
      mode: "pro",
      aspectRatio: "16:9",
      duration: "10",
    });
    expect(req.model_name).toBe("kling-v3-omni");
    expect(req.image_list).toBeDefined();
    expect(req.image_list!.length).toBe(1);
    expect(req.image_list![0].image_url).toBe("https://example.com/image.jpg");
    expect(req.image_list![0].type).toBe("first_frame");
  });

  it("should build storyboard request with multi_shot", () => {
    const req = buildStoryboardRequest({
      shots: [
        { prompt: "Scene 1: A girl walks into a cafe", duration: "5" },
        { prompt: "Scene 2: She orders a coffee", duration: "5" },
        { prompt: "Scene 3: She sits by the window", duration: "5" },
      ],
      mode: "pro",
      aspectRatio: "16:9",
    });
    expect(req.model_name).toBe("kling-v3-omni");
    expect(req.multi_shot).toBe(true);
    expect(req.multi_prompt).toBeDefined();
    expect(req.multi_prompt!.length).toBe(3);
    expect(req.multi_prompt![0].prompt).toBe("Scene 1: A girl walks into a cafe");
    expect(req.multi_prompt![0].duration).toBe("5");
  });

  it("should build all-in-one request with elements and images", () => {
    const req = buildAllInOneRequest({
      prompt: "<<<element_1>>> dances on stage with <<<image_1>>> as background",
      elementIds: [12345],
      imageUrls: [{ url: "https://example.com/bg.jpg" }],
      mode: "pro",
      aspectRatio: "16:9",
      duration: "10",
    });
    expect(req.model_name).toBe("kling-v3-omni");
    expect(req.element_list).toBeDefined();
    expect(req.element_list!.length).toBe(1);
    expect(req.element_list![0].element_id).toBe(12345);
    expect(req.image_list).toBeDefined();
    expect(req.image_list!.length).toBe(1);
  });
});

// ─── Motion Control Request Builder Tests ──────────

describe("Motion Control Request Builders", () => {
  it("should build motion control request correctly", () => {
    const req = buildMotionControlRequest({
      imageUrl: "https://example.com/character.jpg",
      videoUrl: "https://example.com/dance.mp4",
      orientation: "video",
      mode: "pro",
    });
    expect(req.image_url).toBe("https://example.com/character.jpg");
    expect(req.video_url).toBe("https://example.com/dance.mp4");
    expect(req.character_orientation).toBe("video");
    expect(req.mode).toBe("pro");
  });

  it("should include optional prompt and sound settings", () => {
    const req = buildMotionControlRequest({
      imageUrl: "https://example.com/character.jpg",
      videoUrl: "https://example.com/dance.mp4",
      orientation: "image",
      mode: "std",
      prompt: "cinematic lighting",
      keepOriginalSound: false,
    });
    expect(req.prompt).toBe("cinematic lighting");
    expect(req.keep_original_sound).toBe("no");
  });

  it("should validate motion control inputs within limits", () => {
    const result = validateMotionControlInputs({
      orientation: "video",
      estimatedDurationSec: 25,
    });
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("should reject too-long image orientation videos", () => {
    const result = validateMotionControlInputs({
      orientation: "image",
      estimatedDurationSec: 15,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ─── Lip-Sync Request Builder Tests ────────────────

describe("Lip-Sync Request Builders", () => {
  it("should build lip-sync request with audio", () => {
    const req = buildLipSyncWithAudio({
      sessionId: "session_123",
      faceId: "face_456",
      audioUrl: "https://example.com/audio.mp3",
      soundVolume: 1.5,
      originalAudioVolume: 0.5,
    });
    expect(req.session_id).toBe("session_123");
    expect(req.face_choose).toBeDefined();
    expect(req.face_choose.length).toBe(1);
    expect(req.face_choose[0].face_id).toBe("face_456");
    expect(req.face_choose[0].sound_file).toBe("https://example.com/audio.mp3");
    expect(req.face_choose[0].sound_volume).toBe(1.5);
    expect(req.face_choose[0].original_audio_volume).toBe(0.5);
  });

  it("should set default volumes", () => {
    const req = buildLipSyncWithAudio({
      sessionId: "session_123",
      faceId: "face_456",
      audioUrl: "https://example.com/audio.mp3",
    });
    expect(req.face_choose[0].sound_volume).toBe(1);
    expect(req.face_choose[0].original_audio_volume).toBe(0);
  });
});

// ─── Cost Estimation Tests ─────────────────────────

describe("Cost Estimation", () => {
  it("should estimate Omni Video cost correctly - std T2V no audio", () => {
    const cost = estimateOmniVideoCost({
      mode: "std",
      duration: 10,
      hasVideoInput: false,
      hasAudio: false,
    });
    expect(cost.units).toBeCloseTo(6.0, 1);
    expect(cost.usd).toBeCloseTo(0.84, 2);
  });

  it("should estimate Omni Video cost correctly - pro I2V with audio", () => {
    const cost = estimateOmniVideoCost({
      mode: "pro",
      duration: 15,
      hasVideoInput: true,
      hasAudio: true,
    });
    // Pro + video + audio = 1.4 units/sec * 15 = 21 units
    expect(cost.units).toBeCloseTo(21.0, 1);
    expect(cost.usd).toBeCloseTo(2.94, 2);
  });

  it("should estimate Motion Control cost correctly", () => {
    const cost = estimateMotionControlCost({
      mode: "pro",
      duration: 10,
    });
    // Pro = 0.8 units/sec * 10 = 8 units
    expect(cost.units).toBeCloseTo(8.0, 1);
    expect(cost.usd).toBeCloseTo(1.12, 2);
  });

  it("should estimate Lip-Sync cost correctly", () => {
    const cost = estimateLipSyncCost({
      durationSec: 15,
    });
    // Face recognition = 0.05 + ceil(15/5) * 0.5 = 0.05 + 1.5 = 1.55
    expect(cost.units).toBeCloseTo(1.55, 2);
    expect(cost.usd).toBeCloseTo(0.217, 2);
  });

  it("should estimate Lip-Sync cost for short video", () => {
    const cost = estimateLipSyncCost({
      durationSec: 5,
    });
    // Face recognition = 0.05 + ceil(5/5) * 0.5 = 0.05 + 0.5 = 0.55
    expect(cost.units).toBeCloseTo(0.55, 2);
    expect(cost.usd).toBeCloseTo(0.077, 2);
  });
});

/**
 * 漫剧成片坞：配乐 + 同源 Final Render。
 * 供 Fly jobs worker 异步执行；前端经 Vercel→Fly 短请求入队后轮询 GET /api/jobs/:id。
 */
import { put } from "@vercel/blob";
import { renderWorkflowFinalVideo } from "../vercel-api-core/render.js";
import {
  MANHUA_ASSEMBLE_MUSIC_DURATION_SEC,
  buildManhuaAssemblePlan,
  buildManhuaSunoPrompt,
  type ManhuaAssembleClipInput,
  type ManhuaAssembleSceneVideo,
} from "../../shared/manhuaFinalAssemble.js";

function s(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url: string, init: RequestInit) {
  const r = await fetch(url, init);
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { ok: r.ok, status: r.status, json, rawText: text.slice(0, 4000) };
}

function getPublicAssetBaseUrl() {
  return s(process.env.OAUTH_SERVER_URL).trim() || "https://mvstudiopro.com";
}

function buildBlobMediaUrlFromPath(pathname: string) {
  const normalized = s(pathname).replace(/^\/+/, "").trim();
  if (!normalized) return "";
  return `${getPublicAssetBaseUrl()}/api/jobs?op=blobMedia&blobPath=${encodeURIComponent(normalized)}`;
}

async function uploadWorkflowAudioToBlob(sourceUrl: string, filenameBase = "manhua-music") {
  const target = s(sourceUrl).trim();
  if (!target) throw new Error("missing_audio_url");
  const token = s(process.env.MVSP_READ_WRITE_TOKEN).trim();
  if (!token) throw new Error("missing_env_MVSP_READ_WRITE_TOKEN");

  const resp = await fetch(target, {
    redirect: "follow",
    headers: { "User-Agent": "mvstudiopro/1.0 (+manhua-assemble-audio)" },
  });
  if (!resp.ok) throw new Error(`audio_fetch_failed:${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (!buffer.length) throw new Error("empty_audio");
  if (buffer.length > 30 * 1024 * 1024) throw new Error("audio_too_large");

  const contentType = s(resp.headers.get("content-type")).trim() || "audio/mpeg";
  const ext = /audio\/wav/i.test(contentType)
    ? "wav"
    : /audio\/ogg/i.test(contentType)
      ? "ogg"
      : "mp3";
  const safeName = filenameBase.replace(/[^a-zA-Z0-9_-]+/g, "-") || "manhua-music";
  const blob = await put(`music/${Date.now()}-${safeName}.${ext}`, buffer, {
    access: "public",
    token,
    contentType,
  });
  return buildBlobMediaUrlFromPath(s(blob.pathname).trim());
}

function normalizeNuroPollJson(json: any): any {
  if (!json || typeof json !== "object") return json;
  if (Array.isArray(json.data) && json.data.length) return json;
  const status = json.status ?? json.state;
  const audio = s(json.audio_url || json.audioUrl).trim();
  const tid = s(json.task_id || json.taskId).trim();
  if (!audio && !s(status).trim() && !tid) return json;
  return {
    ...json,
    data: [
      {
        ...json,
        id: tid || 0,
        clip_id: tid || 0,
        state: status,
        status,
        audio_url: audio || json.audio_url || json.audioUrl,
      },
    ],
  };
}

function extractMusicUrlFromPayload(payload: any): string {
  const candidates: string[] = [];
  const seen = new Set<any>();
  const visit = (value: any) => {
    if (!value || seen.has(value)) return;
    if (typeof value !== "object") return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const key of [
      "audio_url",
      "audioUrl",
      "music_url",
      "musicUrl",
      "stream_url",
      "streamUrl",
      "download_url",
      "downloadUrl",
      "url",
    ]) {
      const normalized = s(value[key]).trim();
      if (normalized) candidates.push(normalized);
    }
    Object.values(value).forEach(visit);
  };
  visit(payload);
  return candidates.find((c) => /^https?:\/\//i.test(c)) || "";
}

function normalizeMusicProvider(value: unknown): "suno" | "udio" {
  return s(value).trim().toLowerCase() === "udio" ? "udio" : "suno";
}

function deriveMusicError(status: string, payload: any) {
  const source = payload?.data || payload?.result || payload || {};
  return (
    s(source?.error_message).trim() ||
    s(source?.errorMessage).trim() ||
    s(source?.message).trim() ||
    s(source?.error).trim() ||
    status
  );
}

export type ManhuaAssembleFinalInput = {
  clips?: ManhuaAssembleClipInput[];
  sceneVideos?: ManhuaAssembleSceneVideo[];
  episodeIndexes?: number[];
  musicUrl?: string;
  musicPrompt?: string;
  topic?: string;
  seriesTitle?: string;
  logline?: string;
  musicDuration?: number;
  musicProvider?: string;
  musicVolume?: number;
  musicFadeInSec?: number;
  musicFadeOutSec?: number;
  transition?: string;
  resolution?: string;
};

export type ManhuaAssembleFinalResult = {
  finalVideoUrl: string;
  musicUrl?: string;
  musicPrompt?: string;
  musicProvider?: string;
  sceneCount: number;
  episodeIndexes: number[];
  skippedEpisodes: Array<{ episodeIndex: number; reason: string; title?: string }>;
};

export async function runManhuaAssembleFinal(
  raw: ManhuaAssembleFinalInput,
): Promise<ManhuaAssembleFinalResult> {
  let sceneVideos: ManhuaAssembleSceneVideo[] = [];
  let skippedEpisodes: ManhuaAssembleFinalResult["skippedEpisodes"] = [];

  if (Array.isArray(raw.sceneVideos) && raw.sceneVideos.length) {
    sceneVideos = raw.sceneVideos
      .map((row, i) => ({
        sceneIndex: Math.max(1, Math.floor(Number(row?.sceneIndex) || i + 1)),
        url: s(row?.url).trim(),
        duration: s(row?.duration).trim() || "15s",
        stillImageUrl: s(row?.stillImageUrl).trim() || undefined,
        stillDuration: s(row?.stillDuration).trim() || undefined,
      }))
      .filter((row) => Boolean(row.url));
  } else {
    const clipsRaw = Array.isArray(raw.clips) ? raw.clips : [];
    const clips: ManhuaAssembleClipInput[] = clipsRaw.map((row) => ({
      episodeIndex: Math.floor(Number(row?.episodeIndex) || 0),
      episodeTitle: s(row?.episodeTitle).trim() || undefined,
      clipUrl: s(row?.clipUrl || (row as { url?: string })?.url).trim() || undefined,
      keyartUrl: s(row?.keyartUrl || row?.stillImageUrl).trim() || undefined,
      durationSec: Number(row?.durationSec) || undefined,
    }));
    const episodeIndexes = Array.isArray(raw.episodeIndexes)
      ? raw.episodeIndexes.map((n) => Math.floor(Number(n) || 0)).filter((n) => n >= 1)
      : undefined;
    const plan = buildManhuaAssemblePlan(clips, { episodeIndexes });
    sceneVideos = plan.sceneVideos;
    skippedEpisodes = plan.skippedEpisodes;
  }

  if (!sceneVideos.length) {
    const err = new Error("至少需要一集成片才能合成长片");
    (err as Error & { code?: string }).code = "manhua_assemble_no_clips";
    throw err;
  }

  let musicUrl = s(raw.musicUrl).trim();
  let musicPrompt = s(raw.musicPrompt).trim();
  let musicProviderUsed: "suno" | "udio" | "" = "";

  if (!musicUrl) {
    const AIM_BASE = (s(process.env.AIMUSIC_BASE_URL) || "https://api.aimusicapi.ai").replace(
      /\/+$/,
      "",
    );
    const AIM_KEY = s(process.env.AIMUSIC_API_KEY || process.env.AIMUSICAPI_KEY).trim();
    if (!AIM_KEY) throw new Error("AIMUSIC_API_KEY is required");

    if (!musicPrompt) {
      musicPrompt = buildManhuaSunoPrompt({
        topic: s(raw.topic),
        seriesTitle: s(raw.seriesTitle),
        logline: s(raw.logline),
      });
    }

    const musicDuration = Math.max(
      30,
      Math.min(240, Math.floor(Number(raw.musicDuration) || MANHUA_ASSEMBLE_MUSIC_DURATION_SEC)),
    );
    const preferredProvider = normalizeMusicProvider(raw.musicProvider || "suno");
    const providerOrder: Array<"suno" | "udio"> =
      preferredProvider === "udio" ? ["udio", "suno"] : ["suno", "udio"];
    const providerErrors: Array<{ provider: string; error: string }> = [];

    for (const provider of providerOrder) {
      const createUrl =
        provider === "udio" ? `${AIM_BASE}/api/v1/nuro/create` : `${AIM_BASE}/api/v1/sonic/create`;
      const taskUrlBase =
        provider === "udio" ? `${AIM_BASE}/api/v1/nuro/task/` : `${AIM_BASE}/api/v1/sonic/task/`;
      const nuroDuration = Math.max(30, Math.min(120, musicDuration));
      const createBody =
        provider === "udio"
          ? {
              type: "bgm",
              version: "v2.0",
              description: musicPrompt.slice(0, 200),
              duration: nuroDuration,
            }
          : {
              task_type: "create_music",
              custom_mode: false,
              mv: "sonic-v5-5",
              gpt_description_prompt: musicPrompt,
            };

      const created = await fetchJson(createUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AIM_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(createBody),
      });
      if (!created.ok) {
        providerErrors.push({ provider, error: "music_create_failed" });
        continue;
      }
      const taskId = s(
        created.json?.data?.task_id ||
          created.json?.task_id ||
          created.json?.taskId ||
          created.json?.data?.id ||
          created.json?.id,
      ).trim();
      if (!taskId) {
        providerErrors.push({ provider, error: "missing_music_task_id" });
        continue;
      }

      let candidateUrl = "";
      let failed = false;
      let rawTask: any = null;
      for (let i = 0; i < 40; i += 1) {
        await sleep(3000);
        const polled = await fetchJson(`${taskUrlBase}${encodeURIComponent(taskId)}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${AIM_KEY}`, Accept: "application/json" },
        });
        let pollJson: any = polled.json ?? polled.rawText;
        if (provider === "udio") pollJson = normalizeNuroPollJson(pollJson);
        rawTask = pollJson;
        const status = s(
          pollJson?.status ||
            pollJson?.state ||
            pollJson?.data?.[0]?.status ||
            pollJson?.data?.[0]?.state ||
            "",
        ).toLowerCase();
        candidateUrl = extractMusicUrlFromPayload(pollJson);
        if (candidateUrl) break;
        if (status === "failed" || status === "error" || status === "cancelled") {
          providerErrors.push({
            provider,
            error: deriveMusicError(status, rawTask) || status,
          });
          failed = true;
          break;
        }
      }
      if (failed) continue;
      if (!candidateUrl) {
        providerErrors.push({ provider, error: "music_task_timeout_or_missing_music_url" });
        continue;
      }
      try {
        musicUrl = await uploadWorkflowAudioToBlob(candidateUrl, "manhua-music");
        musicProviderUsed = provider;
        break;
      } catch (error: any) {
        providerErrors.push({
          provider,
          error: error?.message || String(error) || "music download failed",
        });
      }
    }

    if (!musicUrl) {
      const err = new Error(
        `Music create request failed · ${providerErrors.map((e) => `${e.provider}:${e.error}`).join("; ")}`,
      );
      (err as Error & { code?: string }).code = "music_create_failed";
      throw err;
    }
  }

  const musicVolume = Number.isFinite(Number(raw.musicVolume))
    ? Math.max(0, Number(raw.musicVolume))
    : 0.35;
  const musicFadeInSec = Number.isFinite(Number(raw.musicFadeInSec))
    ? Math.max(0, Number(raw.musicFadeInSec))
    : 1;
  const musicFadeOutSec = Number.isFinite(Number(raw.musicFadeOutSec))
    ? Math.max(0, Number(raw.musicFadeOutSec))
    : 2;

  const finalVideoUrl = await renderWorkflowFinalVideo({
    sceneVideos: sceneVideos.map((sv) => ({
      sceneIndex: sv.sceneIndex,
      url: sv.url,
      duration: sv.duration,
      stillImageUrl: sv.stillImageUrl,
      stillDuration: sv.stillDuration,
    })),
    musicUrl: musicUrl || undefined,
    musicVolume,
    musicFadeInSec,
    musicFadeOutSec,
    transition: s(raw.transition).trim() || "fade",
    resolution: s(raw.resolution).trim() || "9:16",
  });

  return {
    finalVideoUrl,
    musicUrl: musicUrl || undefined,
    musicPrompt: musicPrompt || undefined,
    musicProvider: musicProviderUsed || undefined,
    sceneCount: sceneVideos.length,
    episodeIndexes: sceneVideos.map((sv) => sv.sceneIndex),
    skippedEpisodes,
  };
}

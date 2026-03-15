import path from "node:path";
import { promises as fs } from "node:fs";
import { put } from "@vercel/blob";
import type { RenderWorkflowInput } from "./renderTypes.js";
import {
  downloadFileToPath,
  makeTempDir,
  parseDurationSeconds,
  resolutionToSize,
  runFfmpeg,
} from "./renderUtils.js";

async function uploadFileToPublicBlob(filePath: string, fileName: string, contentType: string) {
  const token = String(process.env.MVSP_READ_WRITE_TOKEN || "").trim();
  if (!token) throw new Error("missing_env_MVSP_READ_WRITE_TOKEN");
  const buf = await fs.readFile(filePath);
  const blob = await put(`renders/${Date.now()}-${fileName}`, buf, {
    access: "public",
    token,
    contentType,
  });
  return blob.url;
}

export async function renderWorkflowFinalVideo(input: RenderWorkflowInput) {
  const tmpDir = await makeTempDir();
  const transition = String(input.transition || "cut").trim().toLowerCase();
  const size = resolutionToSize(input.resolution);
  const sceneFiles: string[] = [];
  const durations = input.sceneVideos.flatMap((x) => {
    const base = [parseDurationSeconds(x?.duration, 8)];
    if (String(x?.stillImageUrl || "").trim()) {
      base.push(parseDurationSeconds(x?.stillDuration, 1.5));
    }
    return base;
  });

  for (let i = 0; i < input.sceneVideos.length; i += 1) {
    const url = String(input.sceneVideos[i]?.url || "").trim();
    if (!url) throw new Error(`missing_scene_video_url_${i + 1}`);
    const filePath = path.join(tmpDir, `scene-${String(i + 1).padStart(2, "0")}.mp4`);
    await downloadFileToPath(url, filePath);
    sceneFiles.push(filePath);

    const stillImageUrl = String(input.sceneVideos[i]?.stillImageUrl || "").trim();
    if (stillImageUrl) {
      const stillPath = path.join(tmpDir, `scene-${String(i + 1).padStart(2, "0")}-still.jpg`);
      const stillVideoPath = path.join(tmpDir, `scene-${String(i + 1).padStart(2, "0")}-still.mp4`);
      const stillDuration = parseDurationSeconds(input.sceneVideos[i]?.stillDuration, 1.5);
      await downloadFileToPath(stillImageUrl, stillPath);
      await runFfmpeg([
        "-y",
        "-loop",
        "1",
        "-t",
        String(stillDuration),
        "-i",
        stillPath,
        "-vf",
        `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-movflags",
        "+faststart",
        "-an",
        stillVideoPath,
      ]);
      sceneFiles.push(stillVideoPath);
    }
  }

  const mergedPath = path.join(tmpDir, "merged.mp4");
  const finalPath = path.join(tmpDir, "final.mp4");

  if (sceneFiles.length === 1) {
    await runFfmpeg([
      "-y",
      "-i",
      sceneFiles[0],
      "-vf",
      `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-movflags",
      "+faststart",
      "-an",
      mergedPath,
    ]);
  } else if (transition === "fade") {
    const args: string[] = ["-y"];
    for (const file of sceneFiles) args.push("-i", file);

    const filters: string[] = [];
    for (let i = 0; i < sceneFiles.length; i += 1) {
      filters.push(
        `[${i}:v]scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,setpts=PTS-STARTPTS[v${i}]`,
      );
    }

    let prev = "v0";
    let timeline = durations[0];
    for (let i = 1; i < sceneFiles.length; i += 1) {
      const out = `vx${i}`;
      const offset = Math.max(0, timeline - 1);
      filters.push(`[${prev}][v${i}]xfade=transition=fade:duration=1:offset=${offset}[${out}]`);
      prev = out;
      timeline += Math.max(1, durations[i] - 1);
    }

    await runFfmpeg([
      ...args,
      "-filter_complex",
      filters.join(";"),
      "-map",
      `[${prev}]`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-movflags",
      "+faststart",
      "-an",
      mergedPath,
    ]);
  } else {
    const concatList = path.join(tmpDir, "concat.txt");
    await fs.writeFile(
      concatList,
      sceneFiles.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n"),
    );
    await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatList,
      "-vf",
      `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-movflags",
      "+faststart",
      "-an",
      mergedPath,
    ]);
  }

  const musicUrl = String(input.musicUrl || "").trim();
  const voiceUrl = String(input.voiceUrl || "").trim();
  const musicVolume = Number.isFinite(Number(input.musicVolume)) ? Math.max(0, Number(input.musicVolume)) : 0.35;
  const voiceVolume = Number.isFinite(Number(input.voiceVolume)) ? Math.max(0, Number(input.voiceVolume)) : 1;
  const musicFadeInSec = Number.isFinite(Number(input.musicFadeInSec)) ? Math.max(0, Number(input.musicFadeInSec)) : 0;
  const musicFadeOutSec = Number.isFinite(Number(input.musicFadeOutSec)) ? Math.max(0, Number(input.musicFadeOutSec)) : 0;
  const sceneVoiceUrls = input.sceneVideos
    .filter((scene) => scene.includeVoice !== false)
    .map((scene) => String(scene?.voiceUrl || "").trim())
    .filter(Boolean);
  let effectiveVoiceUrl = voiceUrl;

  if (!effectiveVoiceUrl && sceneVoiceUrls.length) {
    const concatVoiceList = path.join(tmpDir, "voice-concat.txt");
    const voiceFiles: string[] = [];
    for (let i = 0; i < sceneVoiceUrls.length; i += 1) {
      const voiceSourcePath = path.join(tmpDir, `voice-${String(i + 1).padStart(2, "0")}-src`);
      const voicePath = path.join(tmpDir, `voice-${String(i + 1).padStart(2, "0")}.mp3`);
      await downloadFileToPath(sceneVoiceUrls[i], voiceSourcePath);
      // Normalize each scene voice track first. Some providers return WAV/PCM
      // payloads even when the URL or upstream metadata looks like MP3.
      await runFfmpeg([
        "-y",
        "-i",
        voiceSourcePath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "24000",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        voicePath,
      ]);
      voiceFiles.push(voicePath);
    }
    await fs.writeFile(
      concatVoiceList,
      voiceFiles.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n"),
    );
    const mergedVoicePath = path.join(tmpDir, "voice-merged.mp3");
    await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatVoiceList,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "24000",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      mergedVoicePath,
    ]);
    effectiveVoiceUrl = await uploadFileToPublicBlob(mergedVoicePath, "scene-voice-track.mp3", "audio/mpeg");
  }

  if (!musicUrl && !effectiveVoiceUrl) {
    return uploadFileToPublicBlob(mergedPath, "rendered-video.mp4", "video/mp4");
  }

  const cmd = ["-y", "-i", mergedPath];

  if (musicUrl) {
    const musicPath = path.join(tmpDir, "music.mp3");
    await downloadFileToPath(musicUrl, musicPath);
    const musicStartSec = Number.isFinite(Number(input.musicStartSec)) ? Math.max(0, Number(input.musicStartSec)) : 0;
    const musicEndSec = Number.isFinite(Number(input.musicEndSec)) ? Math.max(0, Number(input.musicEndSec)) : 0;
    if (musicStartSec > 0 || musicEndSec > 0) {
      const trimmedMusicPath = path.join(tmpDir, "music-trim.mp3");
      const trimArgs = ["-y"];
      if (musicStartSec > 0) trimArgs.push("-ss", String(musicStartSec));
      trimArgs.push("-i", musicPath);
      if (musicEndSec > 0 && musicEndSec > musicStartSec) {
        trimArgs.push("-t", String(musicEndSec - musicStartSec));
      }
      trimArgs.push("-c:a", "mp3", trimmedMusicPath);
      await runFfmpeg(trimArgs);
      cmd.push("-i", trimmedMusicPath);
    } else {
      cmd.push("-i", musicPath);
    }
  }

  if (effectiveVoiceUrl) {
    const voicePath = path.join(tmpDir, "voice.mp3");
    await downloadFileToPath(effectiveVoiceUrl, voicePath);
    cmd.push("-i", voicePath);
  }

  if (musicUrl && effectiveVoiceUrl) {
    const musicFilters = [`volume=${musicVolume}`];
    if (musicFadeInSec > 0) musicFilters.push(`afade=t=in:st=0:d=${musicFadeInSec}`);
    if (musicFadeOutSec > 0) {
      const fadeOutStart = Math.max(0, durations.reduce((sum, value) => sum + value, 0) - musicFadeOutSec);
      musicFilters.push(`afade=t=out:st=${fadeOutStart}:d=${musicFadeOutSec}`);
    }
    cmd.push(
      "-filter_complex",
      `[1:a]${musicFilters.join(",")}[m];[2:a]volume=${voiceVolume}[v];[m][v]amix=inputs=2:duration=longest[aout]`,
      "-map",
      "0:v",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      finalPath,
    );
  } else if (musicUrl) {
    const musicFilters = [`volume=${musicVolume}`];
    if (musicFadeInSec > 0) musicFilters.push(`afade=t=in:st=0:d=${musicFadeInSec}`);
    if (musicFadeOutSec > 0) {
      const fadeOutStart = Math.max(0, durations.reduce((sum, value) => sum + value, 0) - musicFadeOutSec);
      musicFilters.push(`afade=t=out:st=${fadeOutStart}:d=${musicFadeOutSec}`);
    }
    cmd.push(
      "-filter_complex",
      `[1:a]${musicFilters.join(",")}[aout]`,
      "-map",
      "0:v",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      finalPath,
    );
  } else {
    cmd.push(
      "-filter_complex",
      `[1:a]volume=${voiceVolume}[aout]`,
      "-map",
      "0:v",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      finalPath,
    );
  }

  await runFfmpeg(cmd);

  return uploadFileToPublicBlob(finalPath, "rendered-video.mp4", "video/mp4");
}

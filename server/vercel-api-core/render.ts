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

async function uploadVideoFileToPublicBlob(filePath: string, fileName = "final-video.mp4") {
  const token = String(process.env.MVSP_READ_WRITE_TOKEN || "").trim();
  if (!token) throw new Error("missing_env_MVSP_READ_WRITE_TOKEN");
  const buf = await fs.readFile(filePath);
  const blob = await put(`renders/${Date.now()}-${fileName}`, buf, {
    access: "public",
    token,
    contentType: "video/mp4",
  });
  return blob.url;
}

export async function renderWorkflowFinalVideo(input: RenderWorkflowInput) {
  const tmpDir = await makeTempDir();
  const transition = String(input.transition || "cut").trim().toLowerCase();
  const size = resolutionToSize(input.resolution);
  const sceneFiles: string[] = [];
  const durations = input.sceneVideos.map((x) => parseDurationSeconds(x?.duration, 8));

  for (let i = 0; i < input.sceneVideos.length; i += 1) {
    const url = String(input.sceneVideos[i]?.url || "").trim();
    if (!url) throw new Error(`missing_scene_video_url_${i + 1}`);
    const filePath = path.join(tmpDir, `scene-${String(i + 1).padStart(2, "0")}.mp4`);
    await downloadFileToPath(url, filePath);
    sceneFiles.push(filePath);
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

  if (!musicUrl && !voiceUrl) {
    return uploadVideoFileToPublicBlob(mergedPath, "rendered-video.mp4");
  }

  const cmd = ["-y", "-i", mergedPath];

  if (musicUrl) {
    const musicPath = path.join(tmpDir, "music.mp3");
    await downloadFileToPath(musicUrl, musicPath);
    cmd.push("-i", musicPath);
  }

  if (voiceUrl) {
    const voicePath = path.join(tmpDir, "voice.mp3");
    await downloadFileToPath(voiceUrl, voicePath);
    cmd.push("-i", voicePath);
  }

  if (musicUrl && voiceUrl) {
    cmd.push(
      "-filter_complex",
      "[1:a]volume=0.35[m];[2:a]volume=1.0[v];[m][v]amix=inputs=2:duration=longest[aout]",
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
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      finalPath,
    );
  }

  await runFfmpeg(cmd);

  return uploadVideoFileToPublicBlob(finalPath, "rendered-video.mp4");
}

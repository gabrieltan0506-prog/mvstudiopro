/**
 * Generate 5 visual style preview images using Kling API
 * Usage: node scripts/generate-style-previews.mjs
 */

import jwt from "jsonwebtoken";

// Kling API configuration
const KLING_ACCESS_KEY = process.env.KLING_ACCESS_KEY;
const KLING_SECRET_KEY = process.env.KLING_SECRET_KEY;

if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
  console.error("Missing KLING_ACCESS_KEY or KLING_SECRET_KEY");
  process.exit(1);
}

function generateJWT() {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: KLING_ACCESS_KEY,
    exp: now + 1800,
    nbf: now - 5,
    iat: now,
  };
  return jwt.sign(payload, KLING_SECRET_KEY, {
    algorithm: "HS256",
    header: { alg: "HS256", typ: "JWT" },
  });
}

const BASE_URL = "https://api.klingai.com";

async function createImageTask(prompt, aspectRatio = "16:9") {
  const token = generateJWT();
  const response = await fetch(`${BASE_URL}/v1/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model_name: "kling-v2-1",
      prompt,
      resolution: "1k",
      aspect_ratio: aspectRatio,
      n: 1,
    }),
  });

  const result = await response.json();
  if (result.code !== 0) {
    throw new Error(`Kling API error: ${result.message}`);
  }
  return result.data.task_id;
}

async function getImageTask(taskId) {
  const token = generateJWT();
  const response = await fetch(`${BASE_URL}/v1/images/generations/${taskId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const result = await response.json();
  if (result.code !== 0) {
    throw new Error(`Kling API error: ${result.message}`);
  }
  return result.data;
}

async function waitForTask(taskId, maxWait = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const task = await getImageTask(taskId);
    console.log(`  Task ${taskId}: ${task.task_status}`);
    if (task.task_status === "succeed" && task.task_result?.images?.length > 0) {
      return task.task_result.images[0].url;
    }
    if (task.task_status === "failed") {
      throw new Error(`Task failed: ${task.task_status_msg}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Timeout waiting for task");
}

const STYLES = [
  {
    name: "cinematic",
    prompt:
      "Cinematic film storyboard frame, a lone figure in a long coat standing on a rain-soaked neon-lit city street at night, dramatic anamorphic lens flare, shallow depth of field, moody blue and amber color grading, 2.39:1 widescreen composition, film grain texture, professional cinematography, Blade Runner aesthetic, atmospheric fog",
  },
  {
    name: "anime",
    prompt:
      "Vibrant anime-style storyboard frame, a young character with flowing blue hair standing on a rooftop overlooking a fantastical city at sunset, cherry blossom petals floating in wind, vivid saturated colors, cel-shading, dynamic composition, Studio Ghibli meets Makoto Shinkai style, soft glowing light effects, detailed background art, Japanese animation aesthetic",
  },
  {
    name: "documentary",
    prompt:
      "Documentary-style storyboard frame, handheld camera perspective of a craftsman working in a traditional workshop, natural window lighting, shallow depth of field, warm earthy tones, authentic and raw feeling, slight motion blur, 16mm film grain, intimate close-up composition, National Geographic photography style, real life moment captured",
  },
  {
    name: "realistic",
    prompt:
      "Photorealistic storyboard frame, a woman walking through a sunlit European cobblestone street, golden hour lighting casting long shadows, ultra-sharp details, natural skin tones, architectural details in background, professional DSLR quality, clean composition with rule of thirds, warm natural color palette, lifestyle photography aesthetic",
  },
  {
    name: "scifi",
    prompt:
      "Sci-fi storyboard frame, a futuristic astronaut standing before a massive alien structure on a distant planet, holographic displays floating in air, cyan and purple neon lighting, volumetric fog, epic scale composition, hard sci-fi aesthetic, metallic textures, concept art quality, Ridley Scott meets Denis Villeneuve style, dramatic perspective",
  },
];

async function main() {
  console.log("Starting Kling image generation for 5 visual styles...\n");

  const tasks = [];

  // Create all tasks in parallel
  for (const style of STYLES) {
    console.log(`Creating task for: ${style.name}`);
    try {
      const taskId = await createImageTask(style.prompt);
      console.log(`  Task ID: ${taskId}`);
      tasks.push({ name: style.name, taskId });
    } catch (err) {
      console.error(`  Failed to create task for ${style.name}:`, err.message);
    }
  }

  console.log(`\nCreated ${tasks.length} tasks. Waiting for results...\n`);

  // Wait for all tasks
  const results = [];
  for (const task of tasks) {
    console.log(`Waiting for: ${task.name}`);
    try {
      const url = await waitForTask(task.taskId);
      console.log(`  Done! URL: ${url}`);
      results.push({ name: task.name, url });
    } catch (err) {
      console.error(`  Failed: ${err.message}`);
    }
  }

  console.log("\n=== RESULTS ===");
  for (const r of results) {
    console.log(`${r.name}: ${r.url}`);
  }

  // Output as JSON for easy parsing
  console.log("\n=== JSON ===");
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);

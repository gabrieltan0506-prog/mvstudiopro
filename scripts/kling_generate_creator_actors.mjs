import fs from "fs";

const BASE = "https://www.mvstudiopro.com/api/kling-image";
const path = "client/src/data/home_seed_assets_zh.json";
const data = JSON.parse(fs.readFileSync(path, "utf8"));

function normalize(list) {
  return (list || []).map((item) => {
    if (typeof item === "string") return { prompt: item, imageUrl: "" };
    return {
      prompt: item?.prompt || "",
      imageUrl: item?.imageUrl || "",
      ...item
    };
  });
}

async function create(prompt) {
  const r = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      image_size: "1024x576",
      n: 1
    })
  });
  const j = await r.json();
  if (!j?.ok && !j?.status) {
    console.log("create failed raw:", j);
  }
  return j?.raw?.data?.task_id || j?.taskId || j?.task_id || null;
}

async function poll(taskId) {
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`${BASE}?taskId=${encodeURIComponent(taskId)}`);
    const j = await r.json();

    const imageUrl =
      j?.imageUrl ||
      j?.raw?.data?.task_result?.images?.[0]?.url ||
      j?.raw?.data?.images?.[0]?.url ||
      null;

    if (imageUrl) return imageUrl;

    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  return null;
}

async function run() {
  data.creatorActors = normalize(data.creatorActors);

  for (const item of data.creatorActors) {
    if (!item.prompt) {
      console.log("skip empty prompt");
      continue;
    }
    if (item.imageUrl) {
      console.log("skip existing:", item.prompt);
      continue;
    }

    console.log("generate:", item.prompt);

    const taskId = await create(item.prompt);
    if (!taskId) {
      console.log("create failed:", item.prompt);
      continue;
    }

    const imageUrl = await poll(taskId);
    if (!imageUrl) {
      console.log("poll timeout:", item.prompt);
      continue;
    }

    item.imageUrl = imageUrl;
    item.model = "Kling Image 3.0";
    item.generatedAt = new Date().toISOString();

    fs.writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
    console.log("done:", item.prompt);
  }

  fs.writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  console.log("creatorActors generation done");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

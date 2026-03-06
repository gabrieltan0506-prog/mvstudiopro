import fs from "fs";

const BASE = "https://mvstudiopro.com/api/kling-image";
const path = "client/src/data/home_seed_assets_zh.json";
const data = JSON.parse(fs.readFileSync(path, "utf8"));

function normalizeList(list) {
  return (list || []).map((item) => {
    if (typeof item === "string") {
      return { prompt: item, imageUrl: "" };
    }
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
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt,
      aspect_ratio: "16:9",
      model_name: "kling-v2-1"
    })
  });

  const j = await r.json();
  return j?.taskId || j?.task_id || null;
}

async function poll(id) {
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`${BASE}?taskId=${encodeURIComponent(id)}`);
    const j = await r.json();

    if (j?.imageUrl) return j.imageUrl;

    await new Promise((r) => setTimeout(r, 4000));
  }
  return null;
}

async function run() {
  data.creatorActors = normalizeList(data.creatorActors);

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

    const id = await create(item.prompt);

    if (!id) {
      console.log("create failed:", item.prompt);
      continue;
    }

    const url = await poll(id);

    if (url) {
      item.imageUrl = url;
      item.model = "Kling Image 3.0";
      item.generatedAt = new Date().toISOString();
      fs.writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
      console.log("done:", item.prompt);
    } else {
      console.log("poll timeout:", item.prompt);
    }
  }

  fs.writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  console.log("kling images generated");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

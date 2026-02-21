import * as jose from "jose";
import * as fs from "fs";

const KLING_AK = process.env.KLING_IMAGE_ACCESS_KEY!;
const KLING_SK = process.env.KLING_IMAGE_SECRET_KEY!;
const BASE_URL = "https://api-beijing.klingai.com";

async function getKlingToken() {
  const now = Math.floor(Date.now() / 1000);
  const secret = new TextEncoder().encode(KLING_SK);
  return await new jose.SignJWT({
    iss: KLING_AK,
    exp: now + 1800,
    nbf: now - 5,
    iat: now,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(secret);
}

async function submitImageTask() {
  const token = await getKlingToken();
  const response = await fetch(`${BASE_URL}/v1/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_name: "kling-v1",
      prompt: "A virtual idol anime girl with blue hair and glowing eyes, standing on a futuristic stage with neon lights, cinematic lighting, ultra detailed, 8k",
      negative_prompt: "blurry, low quality, deformed",
      aspect_ratio: "9:16",
      n: 1,
    }),
  });
  const data = await response.json();
  console.log("Submit response:", JSON.stringify(data, null, 2));
  return data.data?.task_id;
}

async function pollResult(taskId: string) {
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    const token = await getKlingToken();
    const response = await fetch(`${BASE_URL}/v1/images/generations/${taskId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();
    const status = data.data?.task_status;
    console.log(`[${i + 1}/${maxAttempts}] Status: ${status}`);

    if (status === "succeed") {
      const images = data.data?.task_result?.images || [];
      console.log("\n✓ Image generated successfully!");
      console.log("Images:", JSON.stringify(images, null, 2));

      // Download the image
      if (images.length > 0 && images[0].url) {
        const imgUrl = images[0].url;
        console.log("\nDownloading image from:", imgUrl);
        const imgResponse = await fetch(imgUrl);
        const buffer = Buffer.from(await imgResponse.arrayBuffer());
        const outputPath = "/home/ubuntu/kling-generated-image.png";
        fs.writeFileSync(outputPath, buffer);
        console.log(`✓ Image saved to: ${outputPath}`);
      }
      return data.data;
    }

    if (status === "failed") {
      console.log("\n✗ Generation failed:", JSON.stringify(data.data, null, 2));
      return null;
    }

    // Wait 3 seconds before next poll
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log("\n✗ Timeout: task did not complete in time");
  return null;
}

async function main() {
  console.log("=== Generating Image with Kling API ===\n");
  const taskId = await submitImageTask();
  if (!taskId) {
    console.error("Failed to submit task");
    return;
  }
  console.log(`\nTask ID: ${taskId}\nPolling for result...\n`);
  await pollResult(taskId);
}

main().catch(console.error);

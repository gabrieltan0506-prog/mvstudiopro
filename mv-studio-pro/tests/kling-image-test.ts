import * as jose from "jose";

const KLING_AK = process.env.KLING_IMAGE_ACCESS_KEY!;
const KLING_SK = process.env.KLING_IMAGE_SECRET_KEY!;

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

async function testKlingImage() {
  console.log("=== Testing Kling Image API ===");
  const token = await getKlingToken();

  const response = await fetch("https://api-beijing.klingai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_name: "kling-v1",
      prompt: "a cute cat sitting on a table",
      aspect_ratio: "1:1",
      n: 1,
    }),
  });

  const data = await response.json();
  console.log("Status:", response.status);
  console.log("Response:", JSON.stringify(data, null, 2));

  if (data.code === 0) {
    console.log("\n✓ Kling Image API works! Task ID:", data.data?.task_id);
  } else {
    console.log("\n✗ Kling Image API failed:", data.message);
  }
}

testKlingImage().catch(console.error);

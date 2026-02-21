import * as jose from "jose";

const KLING_AK = process.env.KLING_ACCESS_KEY!;
const KLING_SK = process.env.KLING_SECRET_KEY!;

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

async function testKlingVideo() {
  console.log("=== Testing Kling Video API (Text-to-Video) ===");
  const token = await getKlingToken();

  // Use China endpoint since account is on CN site
  const response = await fetch("https://api-beijing.klingai.com/v1/videos/text2video", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_name: "kling-v1",
      prompt: "A cat walking slowly on a table",
      duration: "5",
      mode: "std",
    }),
  });

  const data = await response.json();
  console.log("Status:", response.status);
  console.log("Response:", JSON.stringify(data, null, 2));

  if (data.code === 0) {
    console.log("\n✓ Kling Video API works! Task ID:", data.data?.task_id);
  } else {
    console.log("\n✗ Kling Video API failed:", data.message);
  }
}

testKlingVideo().catch(console.error);

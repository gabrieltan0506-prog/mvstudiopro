import * as jose from "jose";

const KLING_AK = process.env.KLING_ACCESS_KEY!;
const KLING_SK = process.env.KLING_SECRET_KEY!;
const COMET_KEY = process.env.COMET_API_KEY!;

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

// ============ 1. Test Kling: Text-to-Image (cheapest operation) ============
async function testKlingImage() {
  console.log("\n=== Testing Kling API: Text-to-Image ===");
  const token = await getKlingToken();

  const response = await fetch("https://api.klingai.com/v1/images/generations", {
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
  return response.status === 200;
}

// ============ 2. Test Suno via CometAPI: Generate Music ============
async function testSunoMusic() {
  console.log("\n=== Testing Suno (CometAPI): Generate Music ===");

  const response = await fetch("https://api.cometapi.com/suno/submit/music", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${COMET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: "A gentle piano melody with soft strings, peaceful and calming",
      mv: "chirp-v4-0",
      instrumental: true,
      title: "Test BGM",
    }),
  });

  const data = await response.json();
  console.log("Status:", response.status);
  console.log("Response:", JSON.stringify(data, null, 2));
  return response.status === 200;
}

// ============ 3. Test CometAPI: List Models ============
async function testCometModels() {
  console.log("\n=== Testing CometAPI: List Models ===");

  const response = await fetch("https://api.cometapi.com/v1/models", {
    headers: {
      Authorization: `Bearer ${COMET_KEY}`,
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();
  console.log("Status:", response.status);
  // Only print first 5 models to keep output manageable
  if (data.data) {
    const sunoModels = data.data.filter((m: any) => 
      m.id?.toLowerCase().includes("suno") || 
      m.id?.toLowerCase().includes("seedance") ||
      m.id?.toLowerCase().includes("bytedance")
    );
    console.log("Suno/Seedance related models:", JSON.stringify(sunoModels.map((m: any) => m.id), null, 2));
  }
  return response.status === 200;
}

// ============ Run all tests ============
async function main() {
  console.log("Starting API functional tests...\n");
  
  const results: Record<string, boolean> = {};

  try {
    results["Kling Image"] = await testKlingImage();
  } catch (e: any) {
    console.error("Kling Image test failed:", e.message);
    results["Kling Image"] = false;
  }

  try {
    results["Suno Music"] = await testSunoMusic();
  } catch (e: any) {
    console.error("Suno Music test failed:", e.message);
    results["Suno Music"] = false;
  }

  try {
    results["CometAPI Models"] = await testCometModels();
  } catch (e: any) {
    console.error("CometAPI Models test failed:", e.message);
    results["CometAPI Models"] = false;
  }

  console.log("\n=== Test Results Summary ===");
  for (const [name, passed] of Object.entries(results)) {
    console.log(`${passed ? "✓" : "✗"} ${name}`);
  }
}

main().catch(console.error);

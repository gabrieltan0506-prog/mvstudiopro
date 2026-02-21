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

// ============ 1. Test Kling: Text-to-Image (try both endpoints) ============
async function testKlingImage() {
  console.log("\n=== Testing Kling API: Text-to-Image ===");
  const token = await getKlingToken();

  // Try China endpoint first (since account was created on CN site)
  const endpoints = [
    "https://api-beijing.klingai.com",
    "https://api.klingai.com",
  ];

  for (const base of endpoints) {
    console.log(`Trying endpoint: ${base}`);
    const response = await fetch(`${base}/v1/images/generations`, {
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

    if (response.status === 200 || (data.code === 0)) {
      console.log(`✓ Kling works with endpoint: ${base}`);
      return true;
    }
  }
  return false;
}

// ============ 2. Test Suno via CometAPI ============
async function testSunoMusic() {
  console.log("\n=== Testing Suno (CometAPI): Generate Music ===");

  // Use the correct CometAPI Suno endpoint format
  const response = await fetch("https://api.cometapi.com/suno/submit/music", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${COMET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: "A gentle piano melody with soft strings, peaceful and calming",
      mv: "chirp-v4",
      instrumental: true,
      title: "Test BGM",
    }),
  });

  const data = await response.json();
  console.log("Status:", response.status);
  console.log("Response:", JSON.stringify(data, null, 2));

  if (response.status !== 200) {
    // Try alternative format
    console.log("\nTrying alternative Suno format...");
    const response2 = await fetch("https://api.cometapi.com/suno/submit/music", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${COMET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "A gentle piano melody with soft strings, peaceful and calming",
        mv: "chirp-v3-5",
        instrumental: true,
        title: "Test BGM",
      }),
    });
    const data2 = await response2.json();
    console.log("Status:", response2.status);
    console.log("Response:", JSON.stringify(data2, null, 2));

    if (response2.status !== 200) {
      // Try with no mv field
      console.log("\nTrying without mv field...");
      const response3 = await fetch("https://api.cometapi.com/suno/submit/music", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${COMET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: "A gentle piano melody with soft strings, peaceful and calming",
          instrumental: true,
          title: "Test BGM",
        }),
      });
      const data3 = await response3.json();
      console.log("Status:", response3.status);
      console.log("Response:", JSON.stringify(data3, null, 2));
      return response3.status === 200;
    }
    return response2.status === 200;
  }
  return true;
}

// ============ 3. Test GPT 5.1 via CometAPI ============
async function testGPT51() {
  console.log("\n=== Testing GPT 5.1 (CometAPI) ===");

  const response = await fetch("https://api.cometapi.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${COMET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.1",
      messages: [
        { role: "user", content: "Say hello in one word." },
      ],
      max_tokens: 10,
    }),
  });

  const data = await response.json();
  console.log("Status:", response.status);
  console.log("Response:", JSON.stringify(data, null, 2));

  if (response.status !== 200) {
    // Try gpt-4o as fallback check
    console.log("\nTrying gpt-4o as fallback...");
    const response2 = await fetch("https://api.cometapi.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${COMET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "user", content: "Say hello in one word." },
        ],
        max_tokens: 10,
      }),
    });
    const data2 = await response2.json();
    console.log("Status:", response2.status);
    console.log("Response:", JSON.stringify(data2, null, 2));
  }

  return response.status === 200;
}

// ============ Run all tests ============
async function main() {
  console.log("Starting API functional tests v2...\n");

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
    results["GPT 5.1"] = await testGPT51();
  } catch (e: any) {
    console.error("GPT 5.1 test failed:", e.message);
    results["GPT 5.1"] = false;
  }

  console.log("\n========== FINAL RESULTS ==========");
  for (const [name, passed] of Object.entries(results)) {
    console.log(`${passed ? "✓ PASS" : "✗ FAIL"} ${name}`);
  }
}

main().catch(console.error);

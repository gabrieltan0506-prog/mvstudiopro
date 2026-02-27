import crypto from "crypto";

import {
  buildT2VRequest,
  configureKlingClient,
  createOmniVideoTask,
} from "./server/kling/index.ts";
import { getKlingCnConfig } from "./server/config/klingCn.ts";

const PROMPT = "A woman in red evening dress walks indoors, gradually transforms into ski outfit with reflective goggles, opens the door into heavy snowstorm";

function base64UrlEncode(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function generateKlingJwt(accessKey, secretKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: accessKey,
    exp: now + 1800,
    nbf: now - 5,
    iat: now,
  };

  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(signingInput)
    .digest();

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

let lastHttpStatus = null;
let lastResponseBody = "";

const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const response = await originalFetch(input, init);
  lastHttpStatus = response.status;
  try {
    lastResponseBody = await response.clone().text();
  } catch {
    lastResponseBody = "";
  }
  return response;
};

async function main() {
  const { accessKey, secretKey } = getKlingCnConfig();
  const jwt = generateKlingJwt(accessKey, secretKey);

  configureKlingClient(
    [
      {
        id: "run-kling-video-jwt",
        apiKey: jwt,
        region: "cn",
        purpose: "video",
        enabled: true,
      },
    ],
    "cn"
  );

  const request = buildT2VRequest({
    prompt: PROMPT,
    duration: "8",
    aspectRatio: "16:9",
  });

  let taskId = null;

  try {
    const result = await createOmniVideoTask(request, "cn");
    taskId = result?.task_id ?? null;
  } catch (error) {
    const bodyPreview = (lastResponseBody || String(error?.message || error || ""))
      .slice(0, 1000);
    console.log("HTTP status:", lastHttpStatus ?? "unknown");
    console.log("Returned task_id:", taskId ?? "null");
    console.log("Full response body (truncated to 1000 chars):", bodyPreview);
    process.exitCode = 1;
    return;
  }

  const bodyPreview = (lastResponseBody || "").slice(0, 1000);
  console.log("HTTP status:", lastHttpStatus ?? "unknown");
  console.log("Returned task_id:", taskId ?? "null");
  console.log("Full response body (truncated to 1000 chars):", bodyPreview || "<empty>");
}

main();

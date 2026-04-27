import { createSign } from "crypto";

/**
 * 调用 Gemma 4 31B IT (Vertex AI us-central1)
 * 使用 generateContent 接口，与 Gemini 接口统一
 */
export async function callGemma4(prompt: string): Promise<string> {
  const raw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
  if (!raw) throw new Error("missing_GOOGLE_APPLICATION_CREDENTIALS_JSON");

  // 优先直接解析（env var 是合法 JSON 时）；
  // 若 private_key 含真实换行（Fly secrets 注入方式），则用正则修复后再解析
  let sa: any;
  try {
    sa = JSON.parse(raw);
  } catch {
    const fixed = raw.replace(
      /"private_key"\s*:\s*"([\s\S]*?)"/m,
      (_m: string, k: string) => `"private_key": ${JSON.stringify(String(k))}`,
    );
    sa = JSON.parse(fixed);
  }

  const now = Math.floor(Date.now() / 1000);
  const hdr = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const pay = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })).toString("base64url");

  const sign = createSign("RSA-SHA256");
  sign.update(`${hdr}.${pay}`);
  const sig = sign.sign(sa.private_key).toString("base64url");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${hdr}.${pay}.${sig}`,
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });

  const { access_token } = await tokenRes.json() as { access_token: string };
  const projectId = String(process.env.VERTEX_PROJECT_ID || sa.project_id || "").trim();
  const endpoint = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemma-4-31b-it:generateContent`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${access_token}` },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
    }),
    signal: AbortSignal.timeout(90_000),
  });

  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemma4 ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return String(json?.candidates?.[0]?.content?.parts?.[0]?.text || "");
}

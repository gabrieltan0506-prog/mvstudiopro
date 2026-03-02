import fetch from "node-fetch";

/**
 * 取得 Vertex AI OAuth2 Access Token（使用 GOOGLE_APPLICATION_CREDENTIALS_JSON）
 */
export async function getVertexAccessToken() {
  const raw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
  if (!raw) throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS_JSON");

  const sa = JSON.parse(raw);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  })).toString("base64url");

  const unsignedToken = `${header}.${payload}`;
  const signer = require("crypto").createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();
  const privateKey = sa.private_key;
  const signature = signer.sign(privateKey).toString("base64url");
  const assertion = `${unsignedToken}.${signature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }).toString()
  });

  const json = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !json.access_token) {
    throw new Error("Vertex access token failed: " + JSON.stringify(json));
  }
  return json.access_token;
}

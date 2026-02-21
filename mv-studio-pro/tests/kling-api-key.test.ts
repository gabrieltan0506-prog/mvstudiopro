import { describe, it, expect } from "vitest";
import * as jose from "jose";

describe("Kling API Key Validation", () => {
  it("should have KLING_ACCESS_KEY set", () => {
    const ak = process.env.KLING_ACCESS_KEY;
    expect(ak).toBeDefined();
    expect(ak!.length).toBeGreaterThan(10);
  });

  it("should have KLING_SECRET_KEY set", () => {
    const sk = process.env.KLING_SECRET_KEY;
    expect(sk).toBeDefined();
    expect(sk!.length).toBeGreaterThan(10);
  });

  it("should generate valid JWT and call Kling API successfully", async () => {
    const ak = process.env.KLING_ACCESS_KEY!;
    const sk = process.env.KLING_SECRET_KEY!;

    // Generate JWT token (same as server/kling/client.ts)
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "HS256", typ: "JWT" };
    const payload = {
      iss: ak,
      exp: now + 1800,
      nbf: now - 5,
      iat: now,
    };

    const secret = new TextEncoder().encode(sk);
    const token = await new jose.SignJWT(payload)
      .setProtectedHeader(header)
      .sign(secret);

    expect(token).toBeDefined();
    expect(token.split(".")).toHaveLength(3);

    // Call a lightweight endpoint to verify the key works
    const response = await fetch(
      "https://api.klingai.com/v1/models",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    // 200 = success, 401 = invalid key
    // Even a 404 is fine - it means auth passed but endpoint doesn't exist
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  }, 15000);
});

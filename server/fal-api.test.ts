import { describe, it, expect } from "vitest";

describe("fal.ai API Key validation", () => {
  it("should have FAL_API_KEY set", () => {
    expect(process.env.FAL_API_KEY).toBeDefined();
    expect(process.env.FAL_API_KEY!.length).toBeGreaterThan(10);
  });

  it("should be able to reach fal.ai API", async () => {
    const response = await fetch("https://queue.fal.run/fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d", {
      method: "POST",
      headers: {
        "Authorization": `Key ${process.env.FAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input_image_url: "https://v3b.fal.media/files/b/0a865ab1/omYcawLUo4RZbO8J6ZgZR.png"
      }),
    });
    // 200 = queued successfully, 422 = validation error (but auth passed)
    // 401/403 = bad key
    expect([200, 422]).toContain(response.status);
  }, 15000);
});

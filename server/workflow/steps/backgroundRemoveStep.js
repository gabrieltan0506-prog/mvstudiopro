import { fal } from "@fal-ai/client";
async function backgroundRemoveStep(input) {
  const imageUrl = String(input.imageUrl || "").trim();
  if (!imageUrl) throw new Error("imageUrl is required");
  const key = String(process.env.FAL_API_KEY || process.env.FAL_KEY || "").trim();
  if (!key) {
    return { characterPngUrl: imageUrl };
  }
  fal.config({ credentials: key });
  const result = await fal.subscribe("fal-ai/transparent-background", {
    input: { image_url: imageUrl },
    logs: false
  });
  const characterPngUrl = String(result?.data?.image?.url || "").trim() || String(result?.image?.url || "").trim() || String(result?.data?.url || "").trim() || imageUrl;
  return { characterPngUrl };
}
export {
  backgroundRemoveStep
};

import { fal } from "@fal-ai/client";

// ─── Configure fal.ai ───────────────────────────
const FAL_KEY = process.env.FAL_API_KEY;

if (FAL_KEY) {
  fal.config({ credentials: FAL_KEY });
}

// ─── Types ──────────────────────────────────────
interface FalFile {
  url: string;
  file_size?: number;
  file_name?: string;
  content_type?: string;
}

interface FalModelUrls {
  glb?: FalFile;
  fbx?: FalFile;
  obj?: FalFile;
  mtl?: FalFile;
  texture?: FalFile;
  usdz?: FalFile;
}

interface Hunyuan3DOutput {
  model_glb?: FalFile;
  material_mtl?: FalFile;
  texture?: FalFile;
  thumbnail?: FalFile;
  model_urls: FalModelUrls;
}

export interface Generate3DOptions {
  inputImageUrl: string;
  mode: "rapid" | "pro";
  enablePbr?: boolean;
  enableGeometry?: boolean;
}

export interface Generate3DResult {
  thumbnailUrl: string | null;
  modelGlbUrl: string | null;
  modelObjUrl: string | null;
  modelFbxUrl: string | null;
  modelUsdzUrl: string | null;
  textureUrl: string | null;
}

// ─── Helpers ────────────────────────────────────
export function isHunyuan3DAvailable(): boolean {
  return !!process.env.FAL_API_KEY;
}

const MODEL_IDS = {
  rapid: "fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d",
  pro: "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d",
} as const;

// ─── Main Function ──────────────────────────────
export async function generate3DModel(opts: Generate3DOptions): Promise<Generate3DResult> {
  if (!process.env.FAL_API_KEY) {
    throw new Error("FAL_API_KEY is not configured. Cannot generate 3D models.");
  }

  const modelId = MODEL_IDS[opts.mode];

  const input: Record<string, unknown> = {
    input_image_url: opts.inputImageUrl,
  };
  if (opts.enablePbr) input.enable_pbr = true;
  if (opts.enableGeometry) input.enable_geometry = true;

  console.log(`[Hunyuan3D] Starting ${opts.mode} generation for image: ${opts.inputImageUrl.substring(0, 80)}...`);

  const result = await fal.subscribe(modelId, {
    input,
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === "IN_PROGRESS") {
        const logs = (update as any).logs;
        if (logs && Array.isArray(logs)) {
          logs.map((log: any) => log.message).forEach((msg: string) => {
            console.log(`[Hunyuan3D] ${msg}`);
          });
        }
      }
    },
  });

  const data = result.data as Hunyuan3DOutput;

  console.log(`[Hunyuan3D] Generation complete. Request ID: ${result.requestId}`);

  return {
    thumbnailUrl: data.thumbnail?.url ?? null,
    modelGlbUrl: data.model_urls?.glb?.url ?? data.model_glb?.url ?? null,
    modelObjUrl: data.model_urls?.obj?.url ?? null,
    modelFbxUrl: data.model_urls?.fbx?.url ?? null,
    modelUsdzUrl: data.model_urls?.usdz?.url ?? null,
    textureUrl: data.model_urls?.texture?.url ?? data.texture?.url ?? null,
  };
}

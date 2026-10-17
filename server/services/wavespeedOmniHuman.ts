import { createHash, randomUUID } from "node:crypto";
import {
  DIGITAL_HUMAN_OMNI_MODEL,
  digitalHumanOmniInputSchema,
  type DigitalHumanOmniInput,
} from "../../shared/digitalHumanOmni";
import { SubmitRejectedError, SubmitUnknownError } from "./submitOutcomeErrors";

const ORIGIN = "https://api.wavespeed.ai";
type Evidence = { objectName: string; bytes: number; sha256: string };
export type OmniProviderContext = { userId: number; requestId: string };
export type OmniProviderDeps = {
  key(): Promise<string>;
  fetch: typeof fetch;
  persist(objectName: string, buffer: Buffer): Promise<void>;
};
const realDeps: OmniProviderDeps = {
  async key() {
    return (await import("./wavespeedVideoUpscale")).getWavespeedApiKey();
  },
  fetch: (...args) => fetch(...args),
  async persist(objectName, buffer) {
    const { uploadBufferToGcs } = await import("./gcs");
    await uploadBufferToGcs({
      objectName,
      buffer,
      contentType: "application/json",
      signal: AbortSignal.timeout(120_000),
    });
  },
};

function providerInput(input: DigitalHumanOmniInput) {
  const value = digitalHumanOmniInputSchema.parse(input);
  for (const source of [value.image, value.audio]) {
    const url = new URL(source);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new SubmitRejectedError("素材尚未转换为可读取地址");
  }
  return value;
}

/** 凭证只进入服务端请求头；原始响应先永久保存，再解析并另存解析结果。 */
async function request(
  context: OmniProviderContext,
  operation: string,
  path: string,
  body: unknown | undefined,
  deps: OmniProviderDeps
) {
  if (
    !Number.isSafeInteger(context.userId) ||
    context.userId <= 0 ||
    !/^[a-zA-Z0-9_-]{8,160}$/.test(context.requestId)
  )
    throw new SubmitRejectedError("请求身份无效");
  const key = await deps.key();
  if (!key) throw new SubmitRejectedError("音频驱动视频通道未配置");
  const response = await deps.fetch(`${ORIGIN}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  const raw = Buffer.from(await response.text());
  const prefix = `digital-human-evidence/${context.userId}/${context.requestId}/${operation}-${randomUUID()}`;
  const save = async (suffix: string, buffer: Buffer): Promise<Evidence> => {
    const objectName = `${prefix}.${suffix}.json`;
    await deps.persist(objectName, buffer);
    const receipt = {
      objectName,
      bytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
    };
    await deps.persist(
      `${prefix}.${suffix}.receipt.json`,
      Buffer.from(
        JSON.stringify({
          operation,
          requestId: context.requestId,
          model: DIGITAL_HUMAN_OMNI_MODEL,
          httpStatus: response.status,
          ...receipt,
        })
      )
    );
    return receipt;
  };
  const rawReceipt = await save("raw", raw);
  const json = JSON.parse(raw.toString("utf8"));
  const parsedReceipt = await save("parsed", Buffer.from(JSON.stringify(json)));
  return {
    response,
    json,
    evidence: { raw: rawReceipt, parsed: parsedReceipt },
  };
}

export async function quoteWavespeedOmniHuman(
  context: OmniProviderContext,
  input: DigitalHumanOmniInput,
  deps: OmniProviderDeps = realDeps
) {
  const result = await request(
    context,
    "quote",
    "/api/v3/model/price",
    { model: DIGITAL_HUMAN_OMNI_MODEL, inputs: providerInput(input) },
    deps
  );
  const data = result.json?.data;
  if (
    !result.response.ok ||
    result.json?.code !== 200 ||
    !data ||
    typeof data.price !== "number" ||
    !Number.isFinite(data.price) ||
    data.price < 0 ||
    typeof data.discounted_price !== "number" ||
    !Number.isFinite(data.discounted_price) ||
    data.discounted_price < 0
  ) {
    throw new Error("本次素材报价未能确认，请稍后重新核价");
  }
  return {
    priceUsd: data.price as number,
    discountedPriceUsd: data.discounted_price as number,
    evidence: result.evidence,
  };
}

export async function submitWavespeedOmniHuman(
  context: OmniProviderContext,
  input: DigitalHumanOmniInput,
  deps: OmniProviderDeps = realDeps
) {
  const body = providerInput(input);
  try {
    const result = await request(
      context,
      "submit",
      `/api/v3/${DIGITAL_HUMAN_OMNI_MODEL}`,
      body,
      deps
    );
    const id = result.json?.data?.id;
    if (
      !result.response.ok ||
      result.json?.code !== 200 ||
      typeof id !== "string" ||
      !id.trim()
    ) {
      if (
        [400, 401, 403, 404, 413, 415, 422].includes(result.response.status) &&
        !id
      )
        throw new SubmitRejectedError("视频提交被明确拒绝");
      throw new SubmitUnknownError("视频提交结果尚未确认，请核对原任务");
    }
    return { predictionId: id, evidence: result.evidence };
  } catch (error) {
    if (
      error instanceof SubmitRejectedError ||
      error instanceof SubmitUnknownError
    )
      throw error;
    throw new SubmitUnknownError("视频提交回执尚未确认，禁止重复提交");
  }
}

export async function pollWavespeedOmniHuman(
  context: OmniProviderContext,
  predictionId: string,
  deps: OmniProviderDeps = realDeps
): Promise<
  | { state: "running"; status: string }
  | { state: "failed"; error: string }
  | { state: "completed"; sourceUrl: string }
> {
  try {
    const { response, json } = await request(
      context,
      "poll",
      `/api/v3/predictions/${encodeURIComponent(predictionId)}/result`,
      undefined,
      deps
    );
    if (!response.ok || json?.code !== 200 || json?.data?.id !== predictionId)
      return { state: "running", status: "query_unconfirmed" };
    const data = json.data;
    if (["failed", "cancelled", "canceled", "timeout"].includes(data.status))
      return { state: "failed", error: "音频驱动视频任务未成功，原任务已保留" };
    if (data.status === "completed") {
      const source = data.outputs?.[0];
      if (typeof source !== "string")
        return { state: "running", status: "output_unconfirmed" };
      const url = new URL(source);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        (url.port && url.port !== "443") ||
        !(
          url.hostname === "d2h7xmz5gqybh9.cloudfront.net" ||
          url.hostname === "wavespeed.ai" ||
          url.hostname.endsWith(".wavespeed.ai")
        )
      )
        return { state: "running", status: "output_url_unconfirmed" };
      return { state: "completed", sourceUrl: source };
    }
    return {
      state: "running",
      status: [
        "created",
        "pending",
        "processing",
        "running",
        "queued",
      ].includes(data.status)
        ? data.status
        : "query_unconfirmed",
    };
  } catch {
    return { state: "running", status: "query_unconfirmed" };
  }
}

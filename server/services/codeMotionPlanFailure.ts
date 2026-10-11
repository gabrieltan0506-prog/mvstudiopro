import { ZodError } from "zod";

export type CodeMotionPlanFailure = {
  stage: "request" | "json" | "schema" | "content";
  code: string;
  detailZh: string;
};
/** 只记录分类、字段路径和边界，不记录原始提示词、素材、模型正文或服务凭证。 */
export function classifyCodeMotionPlanFailure(
  error: unknown,
  stage: CodeMotionPlanFailure["stage"]
): CodeMotionPlanFailure {
  if (error instanceof ZodError) {
    const fields = error.issues.slice(0, 4).map(issue => {
      const location =
        issue.path
          .map(part =>
            typeof part === "number"
              ? `[${part}]`
              : String(part)
                  .replace(/[^A-Za-z0-9_]/g, "")
                  .slice(0, 40)
          )
          .join(".") || "方案";
      const code = issue.code;
      const reason =
        code === "unrecognized_keys"
          ? "包含未支持字段"
          : code === "too_big"
            ? "超过允许范围"
            : code === "too_small"
              ? "低于允许范围"
              : code === "invalid_value"
                ? "选项不受支持"
                : code === "invalid_type"
                  ? "类型不正确或缺少必填项"
                  : code === "custom"
                    ? "未通过画面与时间轴检查"
                    : "格式不符合要求";
      return `${location}：${reason}`;
    });
    return {
      stage: "schema",
      code: "invalid_plan",
      detailZh: `顾问已返回方案，但${fields.join("；")}`,
    };
  }
  if (stage === "json" || error instanceof SyntaxError)
    return {
      stage: "json",
      code: "invalid_json",
      detailZh: "顾问返回的方案不是完整有效的JSON，未采用该结果",
    };
  const message = error instanceof Error ? error.message : "";
  if (stage === "content" || stage === "schema") {
    // 以下来自本站校验器，只允许已知中文规则说明，不透传任意上游正文。
    const safe =
      /^(方案输出不完整|方案缺少实际对白或已上传音源|方案使用了尚未开放的合成配音|场景方案缺少实际画面与动作，不能用纯文字代替|安排的总时长须在15至180秒范围内|安排的总时长与本次选择不一致，请重新调整|方案用了未选择的图片，原材料保留|方案遗漏了已选择的图片，请补齐或移除不用的图片|数据展示使用同一张图，请把说明合在一个画面中|逐镜创作缺少实际画面编排，请补齐后再预览|镜头编排时长与画面安排不一致|请切换逐镜创作后使用元素编排，避免内容被忽略)$/.test(
        message
      );
    return {
      stage,
      code: "invalid_content",
      detailZh: safe
        ? message
        : "顾问方案的素材绑定、声音或时间轴未通过校验，未采用该结果",
    };
  }
  const status = Number((error as { status?: number })?.status);
  if (/timeout|timed out|超时|aborted/i.test(message))
    return {
      stage: "request",
      code: "timeout",
      detailZh: "顾问模型请求超时，未取得可用方案",
    };
  if (status === 429)
    return {
      stage: "request",
      code: "rate_limit",
      detailZh: "顾问模型通道限流，未取得可用方案",
    };
  if (status === 401 || status === 403 || /未配置/.test(message))
    return {
      stage: "request",
      code: "configuration",
      detailZh: "顾问模型通道配置或授权异常，请联系管理员处理",
    };
  return {
    stage: "request",
    code: "provider_error",
    detailZh: "顾问模型调用失败，未取得可用方案",
  };
}
export class CodeMotionPlanError extends Error {
  constructor(readonly failures: CodeMotionPlanFailure[]) {
    super(
      `本次内容安排失败：${failures.at(-1)?.detailZh || "未取得可用方案"}。原材料保留。`
    );
    this.name = "CodeMotionPlanError";
  }
}
export function codeMotionPlanFailureMessage(
  error: unknown
): string | undefined {
  return error instanceof CodeMotionPlanError ? error.message : undefined;
}

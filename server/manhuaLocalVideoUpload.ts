import express, {
  Router,
  type Request,
  type ErrorRequestHandler,
} from "express";
import { z } from "zod";
import { sdk } from "./_core/sdk";
import { resolveSiteOwnerOnlyAllowed } from "./services/access-policy";
import {
  LocalVideoUploadError,
  manhuaLocalVideoUploadService,
} from "./services/manhuaLocalVideoUploadService";
import {
  MANHUA_LOCAL_VIDEO_CHUNK_BYTES,
  MANHUA_LOCAL_VIDEO_MAX_BYTES,
} from "../shared/manhuaLocalVideoUpload";

const PREFIX = "/api/manhua/local-video-uploads";
const createSchema = z
  .object({
    fileName: z.string().min(1).max(255),
    bytes: z.number().int().positive().max(MANHUA_LOCAL_VIDEO_MAX_BYTES),
  })
  .strict();
/** 自定义头不允许跨站表单伪造；生产仅接受正式站点或当前服务的同源请求。 */
export function isManhuaLocalUploadSameOrigin(req: Request) {
  if (req.get("x-manhua-upload") !== "1") return false;
  const fetchSite = req.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const raw = req.get("origin") || req.get("referer");
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (
      url.username ||
      url.password ||
      !["http:", "https:"].includes(url.protocol)
    )
      return false;
    const expected = new URL(`${req.protocol}://${req.get("host")}`).origin;
    return (
      url.origin === expected ||
      ["https://mvstudiopro.com", "https://www.mvstudiopro.com"].includes(
        url.origin
      )
    );
  } catch {
    return false;
  }
}
export function createManhuaLocalVideoUploadRouter(
  deps: {
    authenticate?: (
      req: Request
    ) => Promise<{ id: number; openId?: string | null }>;
    isOwner?: (user: { openId?: string | null }) => boolean;
    service?: typeof manhuaLocalVideoUploadService;
  } = {}
) {
  const router = Router();
  const service = deps.service ?? manhuaLocalVideoUploadService;
  router.use(PREFIX, async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      // 必须早于 JSON/raw 解析；未经鉴权的媒体请求不能占用上传内存与磁盘。
      const user = await (
        deps.authenticate ??
        (r => sdk.authenticateRequest(r, { silentMissing: true }))
      )(req);
      if (!(deps.isOwner ?? resolveSiteOwnerOnlyAllowed)(user)) {
        res
          .status(403)
          .json({ error: "此操作仅限站点拥有者", code: "FORBIDDEN" });
        return;
      }
      if (!isManhuaLocalUploadSameOrigin(req)) {
        res
          .status(403)
          .json({ error: "请从当前站点上传视频", code: "CSRF_REJECTED" });
        return;
      }
      res.locals.localVideoUserId = user.id;
      next();
    } catch (error) {
      const status =
        Number((error as { statusCode?: number })?.statusCode) === 503
          ? 503
          : 401;
      res.status(status).json({
        error: status === 503 ? "账号服务暂不可用" : "请先登录",
        code: status === 503 ? "AUTH_UNAVAILABLE" : "UNAUTHENTICATED",
      });
    }
  });
  router.post(
    PREFIX,
    express.json({ limit: "2kb", type: "application/json", inflate: false }),
    async (req, res, next) => {
      try {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success)
          throw new LocalVideoUploadError(
            400,
            "INVALID_INPUT",
            "视频文件名或大小无效"
          );
        res.status(201).json(
          await service.create({
            ...parsed.data,
            userId: res.locals.localVideoUserId,
          })
        );
      } catch (error) {
        next(error);
      }
    }
  );
  router.get(`${PREFIX}/:id`, async (req, res, next) => {
    try {
      res.json(
        await service.status({
          userId: res.locals.localVideoUserId,
          uploadId: req.params.id,
        })
      );
    } catch (error) {
      next(error);
    }
  });
  router.put(
    `${PREFIX}/:id`,
    (req, res, next) => {
      if (!req.is("application/octet-stream")) {
        next(
          new LocalVideoUploadError(
            415,
            "INVALID_CONTENT_TYPE",
            "请按视频分块格式上传"
          )
        );
        return;
      }
      // 有界请求超时；请求中断或解析失败时，尚未进入写盘服务。
      req.setTimeout(60_000, () => req.destroy());
      next();
    },
    express.raw({
      limit: MANHUA_LOCAL_VIDEO_CHUNK_BYTES,
      type: "application/octet-stream",
      inflate: false,
    }),
    async (req, res, next) => {
      try {
        if (
          typeof req.query.offset !== "string" ||
          !/^(0|[1-9][0-9]*)$/.test(req.query.offset)
        )
          throw new LocalVideoUploadError(
            400,
            "INVALID_OFFSET",
            "上传偏移无效"
          );
        res.json(
          await service.append({
            userId: res.locals.localVideoUserId,
            uploadId: req.params.id,
            offset: Number(req.query.offset),
            chunk: req.body,
          })
        );
      } catch (error) {
        next(error);
      }
    }
  );
  router.post(`${PREFIX}/:id/complete`, async (req, res, next) => {
    try {
      res.json(
        await service.complete({
          userId: res.locals.localVideoUserId,
          uploadId: req.params.id,
        })
      );
    } catch (error) {
      next(error);
    }
  });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof LocalVideoUploadError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    const status = Number(error?.status);
    if ([400, 413, 415].includes(status)) {
      res
        .status(status)
        .json({ error: "上传内容格式或大小无效", code: "INVALID_BODY" });
      return;
    }
    // 底层错误可能包含磁盘路径，只返回业务信息。
    res.status(500).json({
      error: "视频上传暂不可用，请查询当前进度后重试",
      code: "UPLOAD_FAILED",
    });
  };
  router.use(PREFIX, errors);
  return router;
}
export default createManhuaLocalVideoUploadRouter();

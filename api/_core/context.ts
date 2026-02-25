import type { Request, Response } from "express";

export type ApiContext = {
  requestId: string;
  nowIso: string;
};

export function createContext(req: Request, _res: Response): ApiContext {
  const requestId =
    (typeof req.headers["x-request-id"] === "string" && req.headers["x-request-id"]) ||
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return {
    requestId,
    nowIso: new Date().toISOString(),
  };
}

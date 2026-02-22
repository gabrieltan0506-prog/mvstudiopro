import express from "express";
import cookieParser from "cookie-parser";

export function createApp() {
  const app = express();

  app.use(cookieParser());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  app.get("/api/health", (_req, res) => {
    res.status(200).send("ok");
  });

  return app;
}

export default function handler(req, res) {
  const url = req.url || "";

  if (url.startsWith("/api/health")) {
    return res.status(200).send("ok");
  }

  if (url.startsWith("/api/diag")) {
    return res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString()
    });
  }

  if (url.startsWith("/api/jobs")) {
    return res.status(200).json({
      status: "ok",
      message: "jobs endpoint reachable"
    });
  }

  return res.status(200).send("ok");
}
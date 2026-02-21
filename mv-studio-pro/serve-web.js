const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 5000;
const DIST_DIR = path.join(__dirname, "dist");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".webm": "video/webm",
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

function tryServeFile(res, filePath) {
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": getMimeType(filePath),
      "Access-Control-Allow-Origin": "*",
    });
    res.end(content);
    return true;
  }
  return false;
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  
  // Remove trailing slash except for root
  if (urlPath !== "/" && urlPath.endsWith("/")) {
    urlPath = urlPath.slice(0, -1);
  }

  const filePath = path.join(DIST_DIR, urlPath);

  // 1. Try exact file
  if (tryServeFile(res, filePath)) return;

  // 2. Try with .html extension
  if (tryServeFile(res, filePath + ".html")) return;

  // 3. Try index.html in directory
  if (tryServeFile(res, path.join(filePath, "index.html"))) return;

  // 4. Fallback to root index.html (SPA routing)
  if (tryServeFile(res, path.join(DIST_DIR, "index.html"))) return;

  // 5. 404
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`MV Studio Pro Web running at http://0.0.0.0:${PORT}`);
});

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

function safeJoin(baseDir, decodedPath) {
  // prevent path traversal
  const rel = decodedPath.replace(/\\/g, "/");
  if (rel.includes("\0")) return null;
  const cleaned = rel.replace(/^\/+/, "");
  if (cleaned.split("/").some((p) => p === "..")) return null;
  const full = path.resolve(baseDir, cleaned);
  const base = path.resolve(baseDir);
  if (!full.startsWith(base + path.sep) && full !== base) return null;
  return full;
}

function contentTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".map") return "application/json; charset=utf-8";
  if (ext === ".woff2") return "font/woff2";
  if (ext === ".woff") return "font/woff";
  if (ext === ".ttf") return "font/ttf";
  if (ext === ".otf") return "font/otf";
  if (ext === ".eot") return "application/vnd.ms-fontobject";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

async function serveStaticFile(req, res, filePath) {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return false;

    // basic caching
    const etag = `"${stat.size}-${stat.mtimeMs}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "public, max-age=300");

    const ct = contentTypeForFile(filePath);
    res.setHeader("Content-Type", ct);
    res.setHeader("Accept-Ranges", "bytes");

    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304);
      res.end();
      return true;
    }

    // Support Range for videos
    const range = req.headers?.range;
    if (range) {
      const m = /^bytes=(\d+)-(\d+)?$/.exec(range);
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : stat.size - 1;
        if (start <= end && start < stat.size) {
          res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${stat.size}`,
            "Content-Length": end - start + 1,
          });
          fs.createReadStream(filePath, { start, end }).pipe(res);
          return true;
        }
      }
    }

    res.writeHead(200, { "Content-Length": stat.size });
    fs.createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}

module.exports = { safeJoin, contentTypeForFile, serveStaticFile };



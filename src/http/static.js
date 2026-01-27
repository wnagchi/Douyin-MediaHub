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

function getCacheControl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  // HTML 文件：不缓存，需要验证最新版本
  if (ext === ".html") {
    return "no-cache, must-revalidate";
  }
  
  // JS/CSS 文件：长期缓存（假设带版本号/哈希）
  if (ext === ".js" || ext === ".css") {
    return "public, max-age=31536000, immutable";
  }
  
  // 字体文件：长期缓存
  if ([".woff2", ".woff", ".ttf", ".otf", ".eot"].includes(ext)) {
    return "public, max-age=31536000, immutable";
  }
  
  // 图片文件：中期缓存（30天）
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico"].includes(ext)) {
    return "public, max-age=2592000";
  }
  
  // 视频文件：短期缓存（1天）
  if ([".mp4", ".webm", ".mov"].includes(ext)) {
    return "public, max-age=86400";
  }
  
  // Source map：中期缓存
  if (ext === ".map") {
    return "public, max-age=2592000";
  }
  
  // 其他文件：默认1小时
  return "public, max-age=3600";
}

async function serveStaticFile(req, res, filePath) {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return false;

    // 生成 ETag（基于文件大小和修改时间）
    const etag = `"${stat.size}-${stat.mtimeMs}"`;
    res.setHeader("ETag", etag);
    
    // 根据文件类型设置缓存策略
    const cacheControl = getCacheControl(filePath);
    res.setHeader("Cache-Control", cacheControl);
    
    // 设置 Last-Modified 头
    const lastModified = new Date(stat.mtime).toUTCString();
    res.setHeader("Last-Modified", lastModified);

    const ct = contentTypeForFile(filePath);
    res.setHeader("Content-Type", ct);
    res.setHeader("Accept-Ranges", "bytes");

    // 检查 If-None-Match (ETag 验证)
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304);
      res.end();
      return true;
    }
    
    // 检查 If-Modified-Since (时间验证)
    const ifModifiedSince = req.headers["if-modified-since"];
    if (ifModifiedSince) {
      const reqTime = new Date(ifModifiedSince).getTime();
      const fileTime = stat.mtimeMs;
      if (reqTime >= fileTime) {
        res.writeHead(304);
        res.end();
        return true;
      }
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



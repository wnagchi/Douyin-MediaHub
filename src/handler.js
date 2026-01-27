const path = require("path");
const fsp = require("fs/promises");
const { URL } = require("url");

const { send, sendJson } = require("./http/respond");
const { safeJoin, serveStaticFile } = require("./http/static");
const { cacheManager } = require("./http/cache");
const { inspectMp4 } = require("./media");
const { dirExists } = require("./utils/fs");
const { createThumbGenerator, ensureThumbForImage } = require("./thumbs");
const { createVideoThumbGenerator, ensureVideoThumb } = require("./videoThumbs");
const { ThumbCacheManager } = require("./cache/thumbCache");

async function readJsonBody(req, { limitBytes = 256 * 1024 } = {}) {
  const chunks = [];
  let size = 0;
  await new Promise((resolve, reject) => {
    req.on("data", (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error("Body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", resolve);
    req.on("error", reject);
  });
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function createHandler({ publicDir, mediaStore, indexer, rootDir }) {
  const thumbGenerator = createThumbGenerator({ rootDir });
  const videoThumbGenerator = createVideoThumbGenerator({ rootDir });
  const thumbCacheManager = new ThumbCacheManager({ rootDir });
  
  return async function handler(req, res) {
    const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(u.pathname);

    if (req.method === "GET" && pathname === "/api/resources") {
      const mediaDirs = mediaStore.getMediaDirs();
      const existing = await mediaStore.listExistingDirs();

      if (!existing.length) {
        return sendJson(res, 200, {
          ok: false,
          code: "NO_MEDIA_DIR",
          error: "未找到 media 目录，请在页面里配置资源目录（绝对路径）。",
          mediaDirs: mediaDirs.map((d) => d.path),
          defaultMediaDirs: mediaStore.getDefaultDirs().map((d) => d.path),
        });
      }

      try {
        const pageParam = Number.parseInt(u.searchParams.get("page") || "1", 10);
        const sizeParam = Number.parseInt(u.searchParams.get("pageSize") || "30", 10);
        const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
        const pageSize = Math.min(200, Math.max(1, Number.isFinite(sizeParam) && sizeParam > 0 ? sizeParam : 30));
        const typeFilter = (u.searchParams.get("type") || "").trim();
        const dirFilter = (u.searchParams.get("dirId") || "").trim();
        const qFilter = (u.searchParams.get("q") || "").trim();
        const tagFilter = (u.searchParams.get("tag") || "").trim();
        // author：当 query string 中显式出现 author= 时，即使为空字符串也视为过滤条件（用于“未知发布者”）
        const hasAuthorParam = u.searchParams.has("author");
        const authorFilter = hasAuthorParam ? String(u.searchParams.get("author") || "") : "";
        const sort = (u.searchParams.get("sort") || "").trim() || "publish";

        const dirsWithStatus = await Promise.all(
          mediaDirs.map(async (d) => ({
            ...d,
            exists: await dirExists(d.path),
          }))
        );

        // 走 SQLite 索引：不再每次请求全量扫描目录
        const result = indexer.queryResources({
          page,
          pageSize,
          type: typeFilter,
          dirId: dirFilter,
          q: qFilter,
          tag: tagFilter,
          author: hasAuthorParam ? authorFilter : undefined,
          sort,
        });

        const responseData = {
          ok: true,
          dirs: dirsWithStatus,
          groups: result.groups || [],
          pagination: result.pagination,
        };

        // 设置缓存策略：有筛选条件时缓存1分钟，否则5分钟
        const hasFilters = qFilter || typeFilter || dirFilter || tagFilter || hasAuthorParam;
        const maxAge = hasFilters ? 60 : 300;
        
        const etag = cacheManager.generateETag(responseData);
        if (cacheManager.shouldReturn304(req, etag)) {
          res.writeHead(304);
          res.end();
          return;
        }

        cacheManager.setCacheHeaders(res, {
          maxAge,
          etag,
          lastModified: new Date(),
        });

        return sendJson(res, 200, responseData);
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String(e?.message || e) });
      }
    }

    if (req.method === "GET" && pathname === "/api/authors") {
      const mediaDirs = mediaStore.getMediaDirs();
      const existing = await mediaStore.listExistingDirs();

      if (!existing.length) {
        return sendJson(res, 200, {
          ok: false,
          code: "NO_MEDIA_DIR",
          error: "未找到 media 目录，请在页面里配置资源目录（绝对路径）。",
          mediaDirs: mediaDirs.map((d) => d.path),
          defaultMediaDirs: mediaStore.getDefaultDirs().map((d) => d.path),
        });
      }

      try {
        const pageParam = Number.parseInt(u.searchParams.get("page") || "1", 10);
        const sizeParam = Number.parseInt(u.searchParams.get("pageSize") || "200", 10);
        const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
        const pageSize = Math.min(500, Math.max(1, Number.isFinite(sizeParam) && sizeParam > 0 ? sizeParam : 200));
        const q = (u.searchParams.get("q") || "").trim();
        const dirFilter = (u.searchParams.get("dirId") || "").trim();
        const typeFilter = (u.searchParams.get("type") || "").trim();
        const tagFilter = (u.searchParams.get("tag") || "").trim();
        const dirsWithStatus = await Promise.all(
          mediaDirs.map(async (d) => ({
            ...d,
            exists: await dirExists(d.path),
          }))
        );
        const r = indexer.queryAuthors({ page, pageSize, q, dirId: dirFilter, type: typeFilter, tag: tagFilter });
        
        const responseData = { ...r, dirs: dirsWithStatus };
        
        // 作者数据缓存10分钟
        const etag = cacheManager.generateETag(responseData);
        if (cacheManager.shouldReturn304(req, etag)) {
          res.writeHead(304);
          res.end();
          return;
        }

        cacheManager.setCacheHeaders(res, {
          maxAge: 600, // 10分钟
          etag,
          lastModified: new Date(),
        });

        return sendJson(res, 200, responseData);
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String(e?.message || e) });
      }
    }

    if (req.method === "GET" && pathname === "/api/tags") {
      try {
        const q = (u.searchParams.get("q") || "").trim();
        const dirFilter = (u.searchParams.get("dirId") || "").trim();
        const limitParam = Number.parseInt(u.searchParams.get("limit") || "200", 10);
        const limit = Number.isFinite(limitParam) ? limitParam : 200;
        const r = indexer.queryTags({ q, limit, dirId: dirFilter });
        
        // 标签数据变化较少，缓存10分钟
        const etag = cacheManager.generateETag(r);
        if (cacheManager.shouldReturn304(req, etag)) {
          res.writeHead(304);
          res.end();
          return;
        }

        cacheManager.setCacheHeaders(res, {
          maxAge: 600, // 10分钟
          etag,
          lastModified: new Date(),
        });

        return sendJson(res, 200, r);
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String(e?.message || e) });
      }
    }

    // 钩子 API：外部触发一次增量更新检查
    if ((req.method === "POST" || req.method === "GET") && pathname === "/api/reindex") {
      // 可选鉴权：设置 HOOK_TOKEN 后，需提供 ?token=xxx 或 header x-hook-token
      const token = (process.env.HOOK_TOKEN || "").toString().trim();
      if (token) {
        const provided =
          (u.searchParams.get("token") || "").toString().trim() ||
          (req.headers["x-hook-token"] || "").toString().trim();
        if (provided !== token) return sendJson(res, 403, { ok: false, error: "forbidden" });
      }
      const force = (u.searchParams.get("force") || "").toString().trim() === "1";
      const stream = (u.searchParams.get("stream") || "").toString().trim() === "1";

      // 如果请求流式进度，使用 SSE
      if (stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });

        // 发送 SSE 消息的辅助函数
        const sendSSE = (data) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        try {
          console.log(
            `[hook] /api/reindex (stream) invoked method=${req.method} force=${force ? "1" : "0"} ` +
              `ip=${req.socket?.remoteAddress || "-"} ua=${String(req.headers["user-agent"] || "-")}`
          );

          const r = await indexer.updateCheck({
            force,
            onProgress: (progress) => {
              sendSSE({ type: 'progress', data: progress });
            },
          });

          console.log(
            `[hook] /api/reindex (stream) done ok=${Boolean(r && r.ok)} ` +
              `scannedDirs=${r?.scannedDirs ?? "-"} skippedDirs=${r?.skippedDirs ?? "-"} ` +
              `added=${r?.added ?? "-"} updated=${r?.updated ?? "-"} deleted=${r?.deleted ?? "-"} ` +
              `durationMs=${r?.durationMs ?? "-"}`
          );

          sendSSE({ type: 'complete', data: r });
          res.end();
        } catch (e) {
          console.warn(`[hook] /api/reindex (stream) failed: ${String(e?.message || e)}`);
          sendSSE({ type: 'error', data: { error: String(e?.message || e) } });
          res.end();
        }
        return;
      }

      // 非流式请求，保持原有逻辑
      try {
        // eslint-disable-next-line no-console
        console.log(
          `[hook] /api/reindex invoked method=${req.method} force=${force ? "1" : "0"} ` +
            `ip=${req.socket?.remoteAddress || "-"} ua=${String(req.headers["user-agent"] || "-")}`
        );
        const r = await indexer.updateCheck({ force });
        // eslint-disable-next-line no-console
        console.log(
          `[hook] /api/reindex done ok=${Boolean(r && r.ok)} ` +
            `scannedDirs=${r?.scannedDirs ?? "-"} skippedDirs=${r?.skippedDirs ?? "-"} ` +
            `added=${r?.added ?? "-"} updated=${r?.updated ?? "-"} deleted=${r?.deleted ?? "-"} ` +
            `durationMs=${r?.durationMs ?? "-"}`
        );
        return sendJson(res, 200, r);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[hook] /api/reindex failed: ${String(e?.message || e)}`);
        return sendJson(res, 500, { ok: false, error: String(e?.message || e) });
      }
    }

    if (pathname === "/api/config") {
      if (req.method === "GET") {
        const responseData = {
          ok: true,
          mediaDirs: mediaStore.getMediaDirs().map((d) => d.path),
          defaultMediaDirs: mediaStore.getDefaultDirs().map((d) => d.path),
          fromEnv: Boolean(process.env.MEDIA_DIR || process.env.MEDIA_DIRS),
        };

        // 配置数据缓存较长时间（1小时），直到修改
        const etag = cacheManager.generateETag(responseData);
        if (cacheManager.shouldReturn304(req, etag)) {
          res.writeHead(304);
          res.end();
          return;
        }

        cacheManager.setCacheHeaders(res, {
          maxAge: 3600, // 1小时
          etag,
          lastModified: new Date(),
        });

        return sendJson(res, 200, responseData);
      }

      if (req.method === "POST") {
        try {
          const chunks = [];
          let size = 0;
          await new Promise((resolve, reject) => {
            req.on("data", (c) => {
              size += c.length;
              if (size > 64 * 1024) {
                reject(new Error("Body too large"));
                return;
              }
              chunks.push(c);
            });
            req.on("end", resolve);
            req.on("error", reject);
          });
          const raw = Buffer.concat(chunks).toString("utf8");
          const j = raw ? JSON.parse(raw) : {};
          let mediaDirs = j?.mediaDirs;
          if (!Array.isArray(mediaDirs)) {
            // backward compat
            const one = (j?.mediaDir || "").toString().trim();
            mediaDirs = one ? [one] : [];
          }
          if (!mediaDirs.length) {
            return sendJson(res, 400, { ok: false, error: "mediaDirs 不能为空" });
          }

          const validation = await mediaStore.validateAbsoluteDirs(mediaDirs);
          if (!validation.ok) return sendJson(res, 400, { ok: false, error: validation.error });

          mediaStore.setMediaDirs(validation.dirs);
          if (!process.env.MEDIA_DIR && !process.env.MEDIA_DIRS) await mediaStore.saveConfigToDisk();

          // 目录变化后，后台触发一次强制更新（避免下次进入还得等）
          indexer.updateCheck({ force: true }).catch(() => {});

          return sendJson(res, 200, {
            ok: true,
            mediaDirs: mediaStore.getMediaDirs().map((d) => d.path),
            defaultMediaDirs: [mediaStore.defaultMediaDir],
            persisted: !process.env.MEDIA_DIR && !process.env.MEDIA_DIRS,
          });
        } catch (e) {
          return sendJson(res, 400, { ok: false, error: String(e?.message || e) });
        }
      }

      return sendJson(res, 405, { ok: false, error: "Method not allowed" });
    }

    if (req.method === "GET" && pathname === "/api/inspect") {
      const name = u.searchParams.get("name") || "";
      const dirId = u.searchParams.get("dir") || "";
      if (!name) return sendJson(res, 400, { ok: false, error: "missing name" });
      const mediaDirs = mediaStore.getMediaDirs();
      const dir = mediaDirs.find((d) => d.id === dirId) || mediaDirs[0];
      if (!dir) return sendJson(res, 400, { ok: false, error: "no media dir" });
      const filePath = safeJoin(dir.path, name);
      if (!filePath) return sendJson(res, 400, { ok: false, error: "bad path" });
      try {
        const ext = path.extname(filePath).toLowerCase();
        if (ext !== ".mp4") {
          return sendJson(res, 200, { ok: true, name, dirId: dir.id, note: "not mp4" });
        }
        const info = await inspectMp4(filePath);
        return sendJson(res, 200, { ok: true, name, dirId: dir.id, info });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String(e?.message || e) });
      }
    }

    if (req.method === "POST" && pathname === "/api/delete") {
      try {
        const j = await readJsonBody(req, { limitBytes: 1024 * 1024 });
        const items = Array.isArray(j?.items) ? j.items : [];
        if (!items.length) return sendJson(res, 400, { ok: false, error: "items 不能为空" });
        if (items.length > 2000) return sendJson(res, 400, { ok: false, error: "items 过多" });

        const dirs = mediaStore.getMediaDirs();
        const results = [];
        let deleted = 0;
        let failed = 0;

        for (const it of items) {
          const dirId = (it?.dirId || "").toString().trim();
          const filename = (it?.filename || "").toString();
          if (!dirId || !filename) {
            failed++;
            results.push({ ok: false, dirId, filename, error: "missing dirId/filename" });
            continue;
          }
          const dir = dirs.find((d) => d.id === dirId);
          if (!dir) {
            failed++;
            results.push({ ok: false, dirId, filename, error: "dir not found" });
            continue;
          }
          const filePath = safeJoin(dir.path, filename);
          if (!filePath) {
            failed++;
            results.push({ ok: false, dirId, filename, error: "bad path" });
            continue;
          }

          try {
            const st = await fsp.stat(filePath);
            if (!st.isFile()) {
              failed++;
              results.push({ ok: false, dirId, filename, error: "not a file" });
              continue;
            }
          } catch (e) {
            // 文件不存在：视为已删除（幂等）
            if (e && e.code === "ENOENT") {
              results.push({ ok: true, dirId, filename, deleted: false, skipped: "not found" });
              continue;
            }
            failed++;
            results.push({ ok: false, dirId, filename, error: String(e?.message || e) });
            continue;
          }

          try {
            await fsp.unlink(filePath);
            deleted++;
            results.push({ ok: true, dirId, filename, deleted: true });
          } catch (e) {
            if (e && e.code === "ENOENT") {
              results.push({ ok: true, dirId, filename, deleted: false, skipped: "not found" });
            } else {
              failed++;
              results.push({ ok: false, dirId, filename, error: String(e?.message || e) });
            }
          }

          // Best-effort: 清理缩略图缓存（不依赖文件类型，删不到就忽略）
          try {
            await fsp.unlink(thumbGenerator.getThumbPath({ dirId, filename })).catch(() => {});
          } catch {}
          try {
            await fsp.unlink(videoThumbGenerator.getThumbPath({ dirId, filename })).catch(() => {});
          } catch {}
        }

        let reindex = null;
        try {
          reindex = await indexer.updateCheck({ force: true });
        } catch (e) {
          reindex = { ok: false, error: String(e?.message || e) };
        }

        return sendJson(res, 200, { ok: true, deleted, failed, results, reindex });
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: String(e?.message || e) });
      }
    }

    if (req.method === "GET" && pathname.startsWith("/thumb/")) {
      const rel = pathname.slice("/thumb/".length); // dirId/filename
      const slash = rel.indexOf("/");
      if (slash === -1) return send(res, 400, "Bad path");
      const dirId = rel.slice(0, slash);
      const fileRel = rel.slice(slash + 1);
      const dir = mediaStore.getMediaDirs().find((d) => d.id === dirId);
      if (!dir) return send(res, 404, "Dir not found");
      const sourcePath = safeJoin(dir.path, fileRel);
      if (!sourcePath) return send(res, 400, "Bad path");

      // Try to serve existing thumb
      const thumbPath = thumbGenerator.getThumbPath({ dirId, filename: fileRel });
      const ok = await serveStaticFile(req, res, thumbPath);
      if (ok) return;

      // Fallback: generate on-demand if thumb doesn't exist
      try {
        const result = await ensureThumbForImage({
          rootDir,
          absSourcePath: sourcePath,
          dirId,
          filename: fileRel,
        });
        if (result.ok && result.path) {
          const served = await serveStaticFile(req, res, result.path);
          if (served) return;
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[thumbs] On-demand generation failed for ${dirId}/${fileRel}: ${String(e?.message || e)}`);
      }

      // If thumb generation failed or file doesn't exist, fallback to original image
      const fallbackOk = await serveStaticFile(req, res, sourcePath);
      return fallbackOk ? undefined : send(res, 404, "Not found");
    }

    if (req.method === "GET" && pathname.startsWith("/vthumb/")) {
      const rel = pathname.slice("/vthumb/".length); // dirId/filename
      const slash = rel.indexOf("/");
      if (slash === -1) return send(res, 400, "Bad path");
      const dirId = rel.slice(0, slash);
      const fileRel = rel.slice(slash + 1);
      const dir = mediaStore.getMediaDirs().find((d) => d.id === dirId);
      if (!dir) return send(res, 404, "Dir not found");
      const sourcePath = safeJoin(dir.path, fileRel);
      if (!sourcePath) return send(res, 400, "Bad path");

      // Try to serve existing thumb
      const thumbPath = videoThumbGenerator.getThumbPath({ dirId, filename: fileRel });
      const ok = await serveStaticFile(req, res, thumbPath);
      if (ok) return;

      // Fallback: generate on-demand if thumb doesn't exist
      try {
        const result = await ensureVideoThumb({
          rootDir,
          absVideoPath: sourcePath,
          dirId,
          filename: fileRel,
        });
        if (result.ok && result.path) {
          const served = await serveStaticFile(req, res, result.path);
          if (served) return;
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[vthumbs] On-demand generation failed for ${dirId}/${fileRel}: ${String(e?.message || e)}`);
      }

      // If thumb generation failed, return 404 (don't fallback to video file)
      return send(res, 404, "Video thumb not found");
    }

    // 缓存管理 API
    if (req.method === "GET" && pathname === "/api/cache/stats") {
      try {
        const stats = await thumbCacheManager.getStats();
        
        // 添加数据库统计
        const dbPath = path.join(rootDir, "data", "index.sqlite");
        let dbSize = 0;
        try {
          const dbStat = await fsp.stat(dbPath);
          dbSize = dbStat.size;
        } catch {
          // 数据库文件不存在
        }

        const response = {
          ok: true,
          thumbs: {
            count: stats.thumbs.count,
            size: stats.thumbs.size,
            sizeFormatted: ThumbCacheManager.formatSize(stats.thumbs.size),
            path: stats.thumbs.path,
            oldestAccess: stats.thumbs.oldestAccess,
            newestAccess: stats.thumbs.newestAccess,
          },
          vthumbs: {
            count: stats.vthumbs.count,
            size: stats.vthumbs.size,
            sizeFormatted: ThumbCacheManager.formatSize(stats.vthumbs.size),
            path: stats.vthumbs.path,
            oldestAccess: stats.vthumbs.oldestAccess,
            newestAccess: stats.vthumbs.newestAccess,
          },
          database: {
            size: dbSize,
            sizeFormatted: ThumbCacheManager.formatSize(dbSize),
            path: dbPath,
          },
          total: stats.total + dbSize,
          totalFormatted: ThumbCacheManager.formatSize(stats.total + dbSize),
        };

        // 设置缓存头（统计信息缓存30秒）
        cacheManager.setCacheHeaders(res, {
          maxAge: 30,
          etag: cacheManager.generateETag(response),
        });

        return sendJson(res, 200, response);
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String(e?.message || e) });
      }
    }

    if (req.method === "POST" && pathname === "/api/cache/clear/thumbs") {
      try {
        const result = await thumbCacheManager.clearAll();
        return sendJson(res, 200, {
          ok: true,
          deleted: result.total.deleted,
          freedSize: result.total.freedSize,
          freedSizeFormatted: ThumbCacheManager.formatSize(result.total.freedSize),
          details: {
            thumbs: {
              deleted: result.thumbs.deleted,
              freedSize: result.thumbs.freedSize,
              freedSizeFormatted: ThumbCacheManager.formatSize(result.thumbs.freedSize),
            },
            vthumbs: {
              deleted: result.vthumbs.deleted,
              freedSize: result.vthumbs.freedSize,
              freedSizeFormatted: ThumbCacheManager.formatSize(result.vthumbs.freedSize),
            },
          },
        });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String(e?.message || e) });
      }
    }

    if (req.method === "POST" && pathname === "/api/cache/cleanup") {
      try {
        const body = await readJsonBody(req, { limitBytes: 1024 });
        const maxAgeMs = body.maxAgeMs || 30 * 24 * 60 * 60 * 1000; // 默认30天
        const result = await thumbCacheManager.cleanup({ maxAge: maxAgeMs });
        
        return sendJson(res, 200, {
          ok: true,
          deleted: result.total.deleted,
          freedSize: result.total.freedSize,
          freedSizeFormatted: ThumbCacheManager.formatSize(result.total.freedSize),
          details: {
            thumbs: {
              deleted: result.thumbs.deleted,
              freedSize: result.thumbs.freedSize,
              freedSizeFormatted: ThumbCacheManager.formatSize(result.thumbs.freedSize),
            },
            vthumbs: {
              deleted: result.vthumbs.deleted,
              freedSize: result.vthumbs.freedSize,
              freedSizeFormatted: ThumbCacheManager.formatSize(result.vthumbs.freedSize),
            },
          },
        });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String(e?.message || e) });
      }
    }

    if (req.method === "GET" && pathname.startsWith("/media/")) {
      const rel = pathname.slice("/media/".length); // dirId/filename
      const slash = rel.indexOf("/");
      if (slash === -1) return send(res, 400, "Bad path");
      const dirId = rel.slice(0, slash);
      const fileRel = rel.slice(slash + 1);
      const dir = mediaStore.getMediaDirs().find((d) => d.id === dirId);
      if (!dir) return send(res, 404, "Dir not found");
      const filePath = safeJoin(dir.path, fileRel);
      if (!filePath) return send(res, 400, "Bad path");
      const ok = await serveStaticFile(req, res, filePath);
      return ok ? undefined : send(res, 404, "Not found");
    }

    // public static
    let publicPathname = pathname;
    if (publicPathname === "/") publicPathname = "/index.html";
    const filePath = safeJoin(publicDir, publicPathname);
    if (!filePath) return send(res, 400, "Bad path");
    const ok = await serveStaticFile(req, res, filePath);
    if (ok) return;

    send(res, 404, "Not found");
  };
}

module.exports = { createHandler };



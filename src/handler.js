const path = require("path");
const { URL } = require("url");

const { send, sendJson } = require("./http/respond");
const { safeJoin, serveStaticFile } = require("./http/static");
const { scanMedia, inspectMp4 } = require("./media");
const { dirExists } = require("./utils/fs");

function createHandler({ publicDir, mediaStore }) {
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
        const pageSize = Math.min(
          200,
          Math.max(1, Number.isFinite(sizeParam) && sizeParam > 0 ? sizeParam : 30)
        );
        const typeFilter = (u.searchParams.get("type") || "").trim();
        const dirFilter = (u.searchParams.get("dirId") || "").trim();
        const qFilter = (u.searchParams.get("q") || "").trim().toLowerCase();

        const groups = await scanMedia(mediaDirs);
        const dirsWithStatus = await Promise.all(
          mediaDirs.map(async (d) => ({
            ...d,
            exists: await dirExists(d.path),
          }))
        );

        let filtered = groups;

        if (typeFilter) {
          filtered = filtered.filter(
            (g) => g.groupType === typeFilter || (Array.isArray(g.types) && g.types.includes(typeFilter))
          );
        }

        if (dirFilter) {
          filtered = filtered
            .map((g) => {
              const items = (g.items || []).filter((it) => it.dirId === dirFilter);
              return { ...g, items };
            })
            .filter((g) => (g.items || []).length > 0);
        }

        if (qFilter) {
          filtered = filtered.filter((g) => {
            const hay = `${g.author || ""} ${g.theme || ""} ${g.groupType || ""} ${(g.types || []).join(" ")} ${
              g.timeText || ""
            }`.toLowerCase();
            return hay.includes(qFilter);
          });
        }

        const total = filtered.length;
        const totalItems = filtered.reduce((acc, g) => acc + (g.items?.length || 0), 0);
        const totalPages = total ? Math.max(1, Math.ceil(total / pageSize)) : 1;
        const safePage = Math.min(Math.max(1, page), totalPages);
        const start = (safePage - 1) * pageSize;
        const groupsPage = filtered.slice(start, start + pageSize);
        const hasMore = safePage < totalPages;

        return sendJson(res, 200, {
          ok: true,
          dirs: dirsWithStatus,
          groups: groupsPage,
          pagination: {
            page: safePage,
            pageSize,
            total,
            totalPages,
            hasMore,
            totalItems,
          },
        });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String(e?.message || e) });
      }
    }

    if (pathname === "/api/config") {
      if (req.method === "GET") {
        return sendJson(res, 200, {
          ok: true,
          mediaDirs: mediaStore.getMediaDirs().map((d) => d.path),
          defaultMediaDirs: mediaStore.getDefaultDirs().map((d) => d.path),
          fromEnv: Boolean(process.env.MEDIA_DIR || process.env.MEDIA_DIRS),
        });
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



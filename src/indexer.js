const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const { parseMediaFilename } = require("./media");
const { extractHashtags, normalizeTagInput, stripHashtags } = require("./tags");
const { dirExists } = require("./utils/fs");
const { createThumbGenerator } = require("./thumbs");
const { createVideoThumbGenerator } = require("./videoThumbs");

async function listFilesRecursive(rootAbs) {
  // Return relative paths (POSIX style: forward slashes) of all files under rootAbs.
  // Skip dot-files and dot-directories at any level.
  const out = [];
  /** @type {{abs:string, rel:string}[]} */
  const stack = [{ abs: rootAbs, rel: "" }];
  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try {
      entries = await fsp.readdir(cur.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const name = e?.name || "";
      if (!name || name.startsWith(".")) continue;
      const absChild = path.join(cur.abs, name);
      const relChild = cur.rel ? `${cur.rel}/${name}` : name;
      if (e.isDirectory()) {
        stack.push({ abs: absChild, rel: relChild });
        continue;
      }
      if (e.isFile()) out.push(relChild);
    }
  }
  return out;
}

function sha1Hex(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

function toSafeLike(s) {
  // basic LIKE escape for % and _
  return String(s).replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function normalizeType(type) {
  const t = String(type || "").trim();
  return t;
}

function nowMs() {
  return Date.now();
}

function createIndexer({ rootDir, mediaStore }) {
  const dataDir = path.join(rootDir, "data");
  const dbPath = process.env.INDEX_DB_PATH
    ? path.resolve(process.env.INDEX_DB_PATH)
    : path.join(dataDir, "index.sqlite");
  const useDirMtimeOptimization = String(process.env.INDEX_DIR_MTIME_OPT || "0").trim() === "1";

  /** @type {DatabaseSync | null} */
  let db = null;
  /** @type {Promise<any> | null} */
  let running = null;

  // Create thumb generators
  const thumbGenerator = createThumbGenerator({ rootDir });
  const videoThumbGenerator = createVideoThumbGenerator({ rootDir });

  function initDb() {
    if (db) return db;
    if (!fs.existsSync(path.dirname(dbPath))) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    db = new DatabaseSync(dbPath);
    db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;

CREATE TABLE IF NOT EXISTS meta(
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS dir_state(
  dirId TEXT PRIMARY KEY,
  dirPath TEXT NOT NULL,
  dirMtimeMs REAL,
  scannedAtMs INTEGER
);

CREATE TABLE IF NOT EXISTS media_items(
  dirId TEXT NOT NULL,
  filename TEXT NOT NULL,
  ext TEXT,
  kind TEXT,
  timeText TEXT,
  iso TEXT,
  timestampMs INTEGER,
  author TEXT,
  theme TEXT,
  typeText TEXT,
  seq INTEGER,
  mtimeMs REAL,
  size INTEGER,
  seenRun INTEGER,
  PRIMARY KEY(dirId, filename)
);

CREATE TABLE IF NOT EXISTS media_item_types(
  dirId TEXT NOT NULL,
  filename TEXT NOT NULL,
  type TEXT NOT NULL,
  PRIMARY KEY(dirId, filename, type)
);

CREATE TABLE IF NOT EXISTS media_item_tags(
  dirId TEXT NOT NULL,
  filename TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY(dirId, filename, tag)
);

CREATE INDEX IF NOT EXISTS idx_items_group ON media_items(timestampMs DESC, timeText, author, theme);
CREATE INDEX IF NOT EXISTS idx_items_author ON media_items(author);
CREATE INDEX IF NOT EXISTS idx_items_theme ON media_items(theme);
CREATE INDEX IF NOT EXISTS idx_items_timetext ON media_items(timeText);
CREATE INDEX IF NOT EXISTS idx_types_type ON media_item_types(type);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON media_item_tags(tag);
    `);

    // 轻量迁移：老库可能没有 createdAtMs/updatedAtMs（SQLite 允许 ADD COLUMN）
    try {
      db.exec(`ALTER TABLE media_items ADD COLUMN createdAtMs INTEGER`);
    } catch {}
    try {
      db.exec(`ALTER TABLE media_items ADD COLUMN updatedAtMs INTEGER`);
    } catch {}
    // 迁移后再建索引（避免老库缺列时 CREATE INDEX 直接失败）
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_items_created ON media_items(createdAtMs DESC)`);
    } catch {}
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_items_updated ON media_items(updatedAtMs DESC)`);
    } catch {}
    // 老数据无法恢复“首次入库时间”，这里用当前时间作为基线，后续新增会有真实 createdAtMs
    const baseline = nowMs();
    try {
      db.prepare(
        `UPDATE media_items
         SET createdAtMs = COALESCE(createdAtMs, :b),
             updatedAtMs = COALESCE(updatedAtMs, :b)
         WHERE createdAtMs IS NULL OR updatedAtMs IS NULL`
      ).run({ b: baseline });
    } catch {}

    return db;
  }

  async function updateCheck({ force = false } = {}) {
    if (running) {
      return { ok: false, running: true };
    }
    running = (async () => {
      const start = nowMs();
      initDb();

      const dirs = await mediaStore.listExistingDirs();
      if (!dirs.length) {
        return { ok: true, scannedDirs: 0, skippedDirs: 0, added: 0, updated: 0, deleted: 0, durationMs: nowMs() - start };
      }

      // 清理：如果用户修改了 config.json（移除了某些 mediaDir），旧的 dirId 数据会残留在 DB，
      // UI 仍可能引用这些条目，导致 /media|/thumb|/vthumb 请求出现 “Dir not found”。
      // 这里将不在当前配置中的 dirId 的索引数据直接删除。
      try {
        const keepIds = dirs.map((d) => d.id).filter(Boolean);
        if (keepIds.length) {
          const ph = keepIds.map(() => "?").join(",");
          db.prepare(`DELETE FROM media_items WHERE dirId NOT IN (${ph})`).run(...keepIds);
          db.prepare(`DELETE FROM media_item_types WHERE dirId NOT IN (${ph})`).run(...keepIds);
          db.prepare(`DELETE FROM media_item_tags WHERE dirId NOT IN (${ph})`).run(...keepIds);
          db.prepare(`DELETE FROM dir_state WHERE dirId NOT IN (${ph})`).run(...keepIds);
        }
      } catch {
        // best-effort cleanup
      }

      const scanRun = start; // stable run id

      const upsertDir = db.prepare(
        `INSERT INTO dir_state(dirId, dirPath, dirMtimeMs, scannedAtMs)
         VALUES(?, ?, ?, ?)
         ON CONFLICT(dirId) DO UPDATE SET dirPath=excluded.dirPath, dirMtimeMs=excluded.dirMtimeMs, scannedAtMs=excluded.scannedAtMs`
      );
      const getDir = db.prepare(`SELECT dirMtimeMs FROM dir_state WHERE dirId=?`);

      const upsertItem = db.prepare(
        `INSERT INTO media_items(
            dirId, filename, ext, kind, timeText, iso, timestampMs, author, theme, typeText, seq,
            createdAtMs, updatedAtMs,
            mtimeMs, size, seenRun
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(dirId, filename) DO UPDATE SET
            ext=excluded.ext,
            kind=excluded.kind,
            timeText=excluded.timeText,
            iso=excluded.iso,
            timestampMs=excluded.timestampMs,
            author=excluded.author,
            theme=excluded.theme,
            typeText=excluded.typeText,
            seq=excluded.seq,
            createdAtMs=COALESCE(media_items.createdAtMs, excluded.createdAtMs),
            updatedAtMs=excluded.updatedAtMs,
            mtimeMs=excluded.mtimeMs,
            size=excluded.size,
            seenRun=excluded.seenRun`
      );
      const getItemStat = db.prepare(`SELECT mtimeMs, size FROM media_items WHERE dirId=? AND filename=?`);
      const markSeen = db.prepare(`UPDATE media_items SET seenRun=? WHERE dirId=? AND filename=?`);
      const deleteUnseenForDir = db.prepare(`DELETE FROM media_items WHERE dirId=? AND (seenRun IS NULL OR seenRun<>?)`);
      const deleteTypesForFile = db.prepare(`DELETE FROM media_item_types WHERE dirId=? AND filename=?`);
      const insertType = db.prepare(`INSERT OR IGNORE INTO media_item_types(dirId, filename, type) VALUES(?, ?, ?)`);
      const deleteTagsForFile = db.prepare(`DELETE FROM media_item_tags WHERE dirId=? AND filename=?`);
      const insertTag = db.prepare(`INSERT OR IGNORE INTO media_item_tags(dirId, filename, tag) VALUES(?, ?, ?)`);

      let scannedDirs = 0;
      let skippedDirs = 0;
      let added = 0;
      let updated = 0;
      let deleted = 0;

      for (const dir of dirs) {
        if (!(await dirExists(dir.path))) continue;
        let st;
        try {
          st = await fsp.stat(dir.path);
        } catch {
          continue;
        }
        const prev = getDir.get(dir.id);
        const dirMtimeMs = st?.mtimeMs ?? null;
        // 递归扫描时：目录 mtime 无法可靠反映子目录/文件变化（尤其是深层新增/删除），
        // 因此默认禁用该优化，保证能发现子文件夹里的变更。
        const shouldScan = force || !useDirMtimeOptimization || !prev || prev.dirMtimeMs !== dirMtimeMs;
        if (!shouldScan) {
          skippedDirs++;
          continue;
        }

        scannedDirs++;
        // scan this dir (recursive)
        const files = await listFilesRecursive(dir.path);

        // Mark seenRun for parsed files; leave others untouched
        for (const relPath of files) {
          const baseName = path.basename(relPath);
          const p = parseMediaFilename(baseName);
          if (!p) continue;
          const filePath = path.join(dir.path, relPath);
          let fst;
          try {
            fst = await fsp.stat(filePath);
          } catch {
            continue;
          }

          const prevStat = getItemStat.get(dir.id, relPath);
          const hasPrev = Boolean(prevStat);
          const changed = !hasPrev || prevStat.mtimeMs !== fst.mtimeMs || prevStat.size !== fst.size;

          // Even if unchanged, update seenRun so delete step won't remove it.
          // NOTE: force=1 的意义除了“强制扫描目录”，还用于回填新增的派生字段（如 tags）。
          // 因此：文件未变化但 force=true 时，也要重建 types/tags（但不要生成缩略图，避免全量耗时）。
          if (!changed) {
            markSeen.run(scanRun, dir.id, relPath);
            if (!force) continue;

            // refresh types (force backfill)
            deleteTypesForFile.run(dir.id, relPath);
            for (const t of p.declaredTypes || []) {
              const tt = normalizeType(t);
              if (!tt) continue;
              insertType.run(dir.id, relPath, tt);
            }

            // refresh tags (force backfill)
            deleteTagsForFile.run(dir.id, relPath);
            const themeText = String(p.theme || "");
            const tags = extractHashtags(themeText, { max: 80 });
            for (const t of tags) {
              const nt = normalizeTagInput(t);
              if (!nt) continue;
              insertTag.run(dir.id, relPath, nt);
            }
            continue;
          }

          if (!hasPrev) added++;
          else updated++;

          // upsert item
          upsertItem.run(
            dir.id,
            relPath,
            p.ext,
            p.kind,
            p.timeText,
            p.iso,
            p.timestampMs,
            p.author,
            p.theme,
            p.typeText,
            p.seq,
            scanRun,
            scanRun,
            fst.mtimeMs,
            fst.size,
            scanRun
          );

          // refresh types
          deleteTypesForFile.run(dir.id, relPath);
          for (const t of p.declaredTypes || []) {
            const tt = normalizeType(t);
            if (!tt) continue;
            insertType.run(dir.id, relPath, tt);
          }

          // refresh tags (from theme/描述中的 #标签)
          deleteTagsForFile.run(dir.id, relPath);
          const themeText = String(p.theme || "");
          const tags = extractHashtags(themeText, { max: 80 });
          for (const t of tags) {
            const nt = normalizeTagInput(t);
            if (!nt) continue;
            insertTag.run(dir.id, relPath, nt);
          }

          // Generate thumbnail for images
          if (p.kind === "image") {
            thumbGenerator.generateThumb({ absSourcePath: filePath, dirId: dir.id, filename: relPath }).catch((e) => {
              // eslint-disable-next-line no-console
              console.warn(`[thumbs] Failed to generate thumb for ${dir.id}/${relPath}: ${String(e?.message || e)}`);
            });
          }

          // Generate thumbnail for videos
          if (p.kind === "video") {
            videoThumbGenerator.generateThumb({ absVideoPath: filePath, dirId: dir.id, filename: relPath }).catch((e) => {
              // eslint-disable-next-line no-console
              console.warn(`[vthumbs] Failed to generate thumb for ${dir.id}/${relPath}: ${String(e?.message || e)}`);
            });
          }
        }

        // delete files that disappeared in this dir (only parsed ones are tracked)
        const before = db.prepare(`SELECT changes() AS c`);
        deleteUnseenForDir.run(dir.id, scanRun);
        const removed = before.get().c || 0;
        if (removed) deleted += removed;
        // also cleanup orphaned types
        db.exec(
          `DELETE FROM media_item_types
           WHERE NOT EXISTS (
             SELECT 1 FROM media_items mi
             WHERE mi.dirId = media_item_types.dirId AND mi.filename = media_item_types.filename
           )`
        );
        // also cleanup orphaned tags
        db.exec(
          `DELETE FROM media_item_tags
           WHERE NOT EXISTS (
             SELECT 1 FROM media_items mi
             WHERE mi.dirId = media_item_tags.dirId AND mi.filename = media_item_tags.filename
           )`
        );

        upsertDir.run(dir.id, dir.path, dirMtimeMs, nowMs());
      }

      return {
        ok: true,
        dbPath,
        scannedDirs,
        skippedDirs,
        added,
        updated,
        deleted,
        durationMs: nowMs() - start,
      };
    })();

    try {
      return await running;
    } finally {
      running = null;
    }
  }

  function queryResources({ page = 1, pageSize = 30, type = "", dirId = "", q = "", sort = "publish", tag = "", author } = {}) {
    initDb();
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeSize = Math.min(200, Math.max(1, Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 30));

    const typeFilter = normalizeType(type);
    const dirFilter = String(dirId || "").trim();
    const qFilter = String(q || "").trim().toLowerCase();
    const tagFilterRaw = String(tag || "").trim();
    const tagFilter = tagFilterRaw ? normalizeTagInput(tagFilterRaw) : "";
    // author 为空字符串也可能是有效过滤（“未知发布者”），因此仅当 author !== undefined 时启用该过滤
    const authorFilter = author !== undefined ? String(author ?? "") : "";

    const where = [];
    const params = {};

    if (dirFilter) {
      where.push(`mi.dirId = :dirId`);
      params.dirId = dirFilter;
    }

    if (author !== undefined) {
      where.push(`COALESCE(mi.author,'') = :author`);
      params.author = authorFilter;
    }

    if (qFilter) {
      // SQLite 要求 ESCAPE 只能是单字符；这里用反斜杠作为转义符
      where.push(
        `LOWER(COALESCE(mi.author,'') || ' ' || COALESCE(mi.theme,'') || ' ' || COALESCE(mi.timeText,'') || ' ' || COALESCE(mi.typeText,'')) LIKE :q ESCAPE '\\'`
      );
      params.q = `%${toSafeLike(qFilter)}%`;
    }

    if (typeFilter) {
      where.push(
        `EXISTS (SELECT 1 FROM media_item_types mit WHERE mit.dirId=mi.dirId AND mit.filename=mi.filename AND mit.type=:type)`
      );
      params.type = typeFilter;
    }

    if (tagFilter) {
      where.push(
        `EXISTS (SELECT 1 FROM media_item_tags mit2 WHERE mit2.dirId=mi.dirId AND mit2.filename=mi.filename AND mit2.tag=:tag)`
      );
      params.tag = tagFilter;
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalGroupsRow = db
      .prepare(
        `SELECT COUNT(*) AS c FROM (
           SELECT 1
           FROM media_items mi
           ${whereSql}
           GROUP BY mi.timeText, mi.author, mi.theme
         )`
      )
      .get(params);
    const total = totalGroupsRow?.c || 0;

    const totalItemsRow = db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM media_items mi
         ${whereSql}`
      )
      .get(params);
    const totalItems = totalItemsRow?.c || 0;

    const totalPages = total ? Math.max(1, Math.ceil(total / safeSize)) : 1;
    const pageClamped = Math.min(Math.max(1, safePage), totalPages);
    const offset = (pageClamped - 1) * safeSize;

    const orderBy =
      sort === "ingest"
        ? `ORDER BY MAX(COALESCE(mi.createdAtMs, 0)) DESC, MAX(COALESCE(mi.timestampMs, 0)) DESC, mi.timeText DESC`
        : `ORDER BY MAX(COALESCE(mi.timestampMs, 0)) DESC, mi.timeText DESC`;

    const groupRows = db
      .prepare(
        `SELECT
           mi.timeText AS timeText,
           mi.author AS author,
           mi.theme AS theme,
           MAX(COALESCE(mi.timestampMs, 0)) AS timestampMs,
           MAX(COALESCE(mi.createdAtMs, 0)) AS createdAtMs,
           GROUP_CONCAT(DISTINCT COALESCE(mi.typeText,'')) AS typeTextList,
           GROUP_CONCAT(DISTINCT COALESCE(mit.tag,'')) AS tagList
         FROM media_items mi
         LEFT JOIN media_item_tags mit
           ON mit.dirId = mi.dirId AND mit.filename = mi.filename
         ${whereSql}
         GROUP BY mi.timeText, mi.author, mi.theme
         ${orderBy}
         LIMIT :limit OFFSET :offset`
      )
      .all({ ...params, limit: safeSize, offset });

    const itemStmt = db.prepare(
      `SELECT filename, dirId, ext, kind, seq, typeText
       FROM media_items
       WHERE timeText=? AND author=? AND theme=? ${dirFilter ? "AND dirId=?" : ""}
       ORDER BY COALESCE(seq, 1000000000) ASC, filename ASC`
    );

    const groups = groupRows.map((r) => {
      const timeText = r.timeText || "";
      const author = r.author || "";
      const theme = r.theme || "";
      const key = `${timeText}|${author}|${theme}`;
      const id = sha1Hex(key);

      const items = dirFilter
        ? itemStmt.all(timeText, author, theme, dirFilter)
        : itemStmt.all(timeText, author, theme);

      const typesSet = new Set();
      for (const it of items) {
        const t = String(it.typeText || "").trim();
        if (!t) continue;
        // typeText may contain '+', treat them as types
        for (const p of t.split("+").map((x) => x.trim()).filter(Boolean)) typesSet.add(p);
      }
      const types = Array.from(typesSet);
      const groupType = types.length > 1 ? "混合" : types[0] || "未知";

      const tags = String(r.tagList || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const uniqTags = Array.from(new Set(tags));
      const themeText = stripHashtags(theme);

      return {
        id,
        timeText,
        timestampMs: Number(r.timestampMs) || null,
        ingestAtMs: Number(r.createdAtMs) || null,
        author,
        theme,
        themeText,
        groupType,
        types,
        tags: uniqTags,
        items: items.map((it) => {
          const item = {
            filename: it.filename,
            dirId: it.dirId,
            url: `/media/${encodeURIComponent(it.dirId)}/${encodeURIComponent(it.filename)}`,
            ext: it.ext,
            kind: it.kind,
            seq: it.seq == null ? null : Number(it.seq),
          };
          // Add thumbUrl for images
          if (it.kind === "image") {
            item.thumbUrl = `/thumb/${encodeURIComponent(it.dirId)}/${encodeURIComponent(it.filename)}`;
          }
          // Add thumbUrl for videos
          if (it.kind === "video") {
            item.thumbUrl = `/vthumb/${encodeURIComponent(it.dirId)}/${encodeURIComponent(it.filename)}`;
          }
          return item;
        }),
      };
    });

    return {
      ok: true,
      groups,
      pagination: {
        page: pageClamped,
        pageSize: safeSize,
        total,
        totalPages,
        hasMore: pageClamped < totalPages,
        totalItems,
      },
    };
  }

  function queryAuthors({ page = 1, pageSize = 200, q = "", dirId = "", type = "", tag = "" } = {}) {
    initDb();
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeSize = Math.min(500, Math.max(1, Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 200));

    const dirFilter = String(dirId || "").trim();
    const typeFilter = normalizeType(type);
    const tagFilterRaw = String(tag || "").trim();
    const tagFilter = tagFilterRaw ? normalizeTagInput(tagFilterRaw) : "";
    const qFilter = String(q || "").trim().toLowerCase();

    const where = [];
    const params = {};

    if (dirFilter) {
      where.push(`mi.dirId = :dirId`);
      params.dirId = dirFilter;
    }

    if (typeFilter) {
      where.push(
        `EXISTS (SELECT 1 FROM media_item_types mit WHERE mit.dirId=mi.dirId AND mit.filename=mi.filename AND mit.type=:type)`
      );
      params.type = typeFilter;
    }

    if (tagFilter) {
      where.push(
        `EXISTS (SELECT 1 FROM media_item_tags mit2 WHERE mit2.dirId=mi.dirId AND mit2.filename=mi.filename AND mit2.tag=:tag)`
      );
      params.tag = tagFilter;
    }

    // authors 列表的 q：只匹配发布者字段（更符合“按发布者查看”，也更便宜）
    if (qFilter) {
      // SQLite 要求 ESCAPE 只能是单字符；这里用反斜杠作为转义符
      where.push(`LOWER(COALESCE(mi.author,'')) LIKE :q ESCAPE '\\'`);
      params.q = `%${toSafeLike(qFilter)}%`;
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS c FROM (
           SELECT 1
           FROM media_items mi
           ${whereSql}
           GROUP BY COALESCE(mi.author,'')
         )`
      )
      .get(params);
    const total = totalRow?.c || 0;
    const totalPages = total ? Math.max(1, Math.ceil(total / safeSize)) : 1;
    const pageClamped = Math.min(Math.max(1, safePage), totalPages);
    const offset = (pageClamped - 1) * safeSize;

    /** @type {any[]} */
    let rows = [];
    try {
      // 带“最新条目”字段：用于移动端发布者卡片封面
      // 注：使用 window function（ROW_NUMBER）。如果用户机器上的 SQLite 版本过老，会自动降级到统计版查询。
      rows = db
        .prepare(
          `WITH filtered AS (
             SELECT
               mi.*,
               COALESCE(mi.author,'') AS authorKey
             FROM media_items mi
             ${whereSql}
           ),
           agg AS (
             SELECT
               authorKey,
               COUNT(DISTINCT (COALESCE(timeText,'') || '|' || COALESCE(author,'') || '|' || COALESCE(theme,''))) AS groupCount,
               COUNT(*) AS itemCount,
               MAX(COALESCE(timestampMs, 0)) AS latestTimestampMs
             FROM filtered
             GROUP BY authorKey
           ),
           latest AS (
             SELECT
               authorKey,
               dirId,
               filename,
               kind,
               ext,
               timeText,
               COALESCE(timestampMs, 0) AS timestampMs
             FROM (
               SELECT
                 authorKey,
                 dirId,
                 filename,
                 kind,
                 ext,
                 timeText,
                 timestampMs,
                 ROW_NUMBER() OVER (
                   PARTITION BY authorKey
                   ORDER BY COALESCE(timestampMs, 0) DESC, COALESCE(timeText,'') DESC, filename DESC
                 ) AS rn
               FROM filtered
             )
             WHERE rn = 1
           )
           SELECT
             agg.authorKey AS author,
             agg.groupCount,
             agg.itemCount,
             agg.latestTimestampMs,
             latest.dirId AS latestDirId,
             latest.filename AS latestFilename,
             latest.kind AS latestKind,
             latest.ext AS latestExt,
             latest.timeText AS latestTimeText,
             latest.timestampMs AS latestItemTimestampMs
           FROM agg
           LEFT JOIN latest
             ON latest.authorKey = agg.authorKey
           ORDER BY agg.groupCount DESC, agg.itemCount DESC, agg.latestTimestampMs DESC, agg.authorKey ASC
           LIMIT :limit OFFSET :offset`
        )
        .all({ ...params, limit: safeSize, offset });
    } catch {
      // 降级：仅统计（保持旧行为，避免接口整体不可用）
      rows = db
        .prepare(
          `SELECT
             COALESCE(mi.author,'') AS author,
             COUNT(DISTINCT (COALESCE(mi.timeText,'') || '|' || COALESCE(mi.author,'') || '|' || COALESCE(mi.theme,''))) AS groupCount,
             COUNT(*) AS itemCount,
             MAX(COALESCE(mi.timestampMs, 0)) AS latestTimestampMs
           FROM media_items mi
           ${whereSql}
           GROUP BY COALESCE(mi.author,'')
           ORDER BY groupCount DESC, itemCount DESC, latestTimestampMs DESC, author ASC
           LIMIT :limit OFFSET :offset`
        )
        .all({ ...params, limit: safeSize, offset });
    }

    return {
      ok: true,
      authors: rows.map((r) => ({
        author: String(r.author ?? ""),
        groupCount: Number(r.groupCount) || 0,
        itemCount: Number(r.itemCount) || 0,
        latestTimestampMs: Number(r.latestTimestampMs) || 0,
        latestItem:
          r.latestDirId && r.latestFilename
            ? (() => {
                const dirId = String(r.latestDirId);
                const filename = String(r.latestFilename);
                const kind = String(r.latestKind || "");
                const item = {
                  dirId,
                  filename,
                  url: `/media/${encodeURIComponent(dirId)}/${encodeURIComponent(filename)}`,
                  kind: kind || "file",
                  // best-effort: 供前端展示
                  timeText: r.latestTimeText == null ? undefined : String(r.latestTimeText),
                  timestampMs: r.latestItemTimestampMs == null ? undefined : Number(r.latestItemTimestampMs) || 0,
                };
                if (kind === "image") {
                  item.thumbUrl = `/thumb/${encodeURIComponent(dirId)}/${encodeURIComponent(filename)}`;
                }
                if (kind === "video") {
                  item.thumbUrl = `/vthumb/${encodeURIComponent(dirId)}/${encodeURIComponent(filename)}`;
                }
                return item;
              })()
            : undefined,
      })),
      pagination: {
        page: pageClamped,
        pageSize: safeSize,
        total,
        totalPages,
        hasMore: pageClamped < totalPages,
      },
    };
  }

  function queryTags({ q = "", limit = 200, dirId = "" } = {}) {
    initDb();
    const qFilter = String(q || "").trim();
    const dirFilter = String(dirId || "").trim();
    const safeLimit = Math.min(1000, Math.max(1, Number.isFinite(limit) ? limit : 200));

    const where = [];
    const params = {};

    if (dirFilter) {
      where.push(`mi.dirId = :dirId`);
      params.dirId = dirFilter;
    }
    if (qFilter) {
      // tags are stored normalized to lower-case
      // SQLite 要求 ESCAPE 只能是单字符；这里用反斜杠作为转义符
      where.push(`mit.tag LIKE :q ESCAPE '\\'`);
      params.q = `%${toSafeLike(normalizeTagInput(qFilter))}%`;
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = db
      .prepare(
        `SELECT
           mit.tag AS tag,
           COUNT(DISTINCT (COALESCE(mi.timeText,'') || '|' || COALESCE(mi.author,'') || '|' || COALESCE(mi.theme,''))) AS groupCount,
           COUNT(*) AS itemCount,
           MAX(COALESCE(mi.timestampMs, 0)) AS latestTimestampMs
         FROM media_item_tags mit
         JOIN media_items mi
           ON mi.dirId = mit.dirId AND mi.filename = mit.filename
         ${whereSql}
         GROUP BY mit.tag
         ORDER BY groupCount DESC, itemCount DESC, mit.tag ASC
         LIMIT :limit`
      )
      .all({ ...params, limit: safeLimit });

    return {
      ok: true,
      tags: rows.map((r) => ({
        tag: r.tag,
        groupCount: Number(r.groupCount) || 0,
        itemCount: Number(r.itemCount) || 0,
        latestTimestampMs: Number(r.latestTimestampMs) || 0,
      })),
    };
  }

  return {
    get dbPath() {
      return dbPath;
    },
    initDb,
    updateCheck,
    queryResources,
    queryAuthors,
    queryTags,
  };
}

module.exports = { createIndexer };


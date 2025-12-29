const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const { parseMediaFilename } = require("./media");
const { dirExists } = require("./utils/fs");

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

  /** @type {DatabaseSync | null} */
  let db = null;
  /** @type {Promise<any> | null} */
  let running = null;

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

CREATE INDEX IF NOT EXISTS idx_items_group ON media_items(timestampMs DESC, timeText, author, theme);
CREATE INDEX IF NOT EXISTS idx_items_author ON media_items(author);
CREATE INDEX IF NOT EXISTS idx_items_theme ON media_items(theme);
CREATE INDEX IF NOT EXISTS idx_items_timetext ON media_items(timeText);
CREATE INDEX IF NOT EXISTS idx_types_type ON media_item_types(type);
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
        const shouldScan = force || !prev || prev.dirMtimeMs !== dirMtimeMs;
        if (!shouldScan) {
          skippedDirs++;
          continue;
        }

        scannedDirs++;
        // scan this dir
        let entries = [];
        try {
          entries = await fsp.readdir(dir.path, { withFileTypes: true });
        } catch {
          continue;
        }
        const files = entries
          .filter((d) => d.isFile())
          .map((d) => d.name)
          .filter((name) => name && !name.startsWith("."));

        // Mark seenRun for parsed files; leave others untouched
        for (const name of files) {
          const p = parseMediaFilename(name);
          if (!p) continue;
          const filePath = path.join(dir.path, name);
          let fst;
          try {
            fst = await fsp.stat(filePath);
          } catch {
            continue;
          }

          const prevStat = getItemStat.get(dir.id, name);
          const hasPrev = Boolean(prevStat);
          const changed = !hasPrev || prevStat.mtimeMs !== fst.mtimeMs || prevStat.size !== fst.size;

          // Even if unchanged, update seenRun so delete step won't remove it.
          if (!changed) {
            markSeen.run(scanRun, dir.id, name);
            continue;
          }

          if (!hasPrev) added++;
          else updated++;

          // upsert item
          upsertItem.run(
            dir.id,
            name,
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
          deleteTypesForFile.run(dir.id, name);
          for (const t of p.declaredTypes || []) {
            const tt = normalizeType(t);
            if (!tt) continue;
            insertType.run(dir.id, name, tt);
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

  function queryResources({ page = 1, pageSize = 30, type = "", dirId = "", q = "", sort = "publish" } = {}) {
    initDb();
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeSize = Math.min(200, Math.max(1, Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 30));

    const typeFilter = normalizeType(type);
    const dirFilter = String(dirId || "").trim();
    const qFilter = String(q || "").trim().toLowerCase();

    const where = [];
    const params = {};

    if (dirFilter) {
      where.push(`mi.dirId = :dirId`);
      params.dirId = dirFilter;
    }

    if (qFilter) {
      where.push(
        `LOWER(COALESCE(mi.author,'') || ' ' || COALESCE(mi.theme,'') || ' ' || COALESCE(mi.timeText,'') || ' ' || COALESCE(mi.typeText,'')) LIKE :q ESCAPE '\\\\'`
      );
      params.q = `%${toSafeLike(qFilter)}%`;
    }

    if (typeFilter) {
      where.push(
        `EXISTS (SELECT 1 FROM media_item_types mit WHERE mit.dirId=mi.dirId AND mit.filename=mi.filename AND mit.type=:type)`
      );
      params.type = typeFilter;
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
           GROUP_CONCAT(DISTINCT COALESCE(mi.typeText,'')) AS typeTextList
         FROM media_items mi
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

      return {
        id,
        timeText,
        timestampMs: Number(r.timestampMs) || null,
        ingestAtMs: Number(r.createdAtMs) || null,
        author,
        theme,
        groupType,
        types,
        items: items.map((it) => ({
          filename: it.filename,
          dirId: it.dirId,
          url: `/media/${encodeURIComponent(it.dirId)}/${encodeURIComponent(it.filename)}`,
          ext: it.ext,
          kind: it.kind,
          seq: it.seq == null ? null : Number(it.seq),
        })),
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

  return {
    get dbPath() {
      return dbPath;
    },
    initDb,
    updateCheck,
    queryResources,
  };
}

module.exports = { createIndexer };


const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const { fileExists, dirExists } = require("../utils/fs");

function normalizeDirs(input) {
  const uniq = new Map();
  for (const raw of input || []) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const abs = path.isAbsolute(trimmed) ? path.resolve(trimmed) : null;
    if (!abs) continue;
    const id = crypto.createHash("sha1").update(abs).digest("hex").slice(0, 12);
    const label = path.basename(abs) || abs;
    uniq.set(id, { id, path: abs, label });
  }
  return Array.from(uniq.values());
}

function createMediaDirStore({ rootDir, configPath }) {
  const defaultMediaDir = path.join(rootDir, "media");
  let mediaDirs = [];

  function getDefaultDirs() {
    const candidates = [];
    try {
      if (fs.existsSync(defaultMediaDir)) {
        const st = fs.statSync(defaultMediaDir);
        if (st.isDirectory()) candidates.push(defaultMediaDir);
      }
    } catch {
      // ignore
    }

    // If default "media" doesn't exist, auto-detect folders like "media111" at project root
    if (!candidates.length) {
      try {
        const entries = fs.readdirSync(rootDir, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          const name = e.name || "";
          if (!name) continue;
          if (name.toLowerCase().startsWith("media")) {
            candidates.push(path.join(rootDir, name));
          }
        }
        candidates.sort((a, b) => a.localeCompare(b));
      } catch {
        // ignore
      }
    }

    if (!candidates.length) candidates.push(defaultMediaDir);
    return normalizeDirs(candidates);
  }

  function setMediaDirs(dirs) {
    mediaDirs = normalizeDirs(dirs);
    if (!mediaDirs.length) mediaDirs = getDefaultDirs();
  }

  function getMediaDirs() {
    return mediaDirs.slice();
  }

  async function loadConfigFromDiskOrEnv() {
    // env override: allow single dir via MEDIA_DIR or multiple via MEDIA_DIRS (split by ;)
    if (process.env.MEDIA_DIRS) {
      const parts = process.env.MEDIA_DIRS.split(";").map((s) => s.trim()).filter(Boolean);
      setMediaDirs(parts);
      return { fromEnv: true };
    }
    if (process.env.MEDIA_DIR) {
      setMediaDirs([process.env.MEDIA_DIR]);
      return { fromEnv: true };
    }

    if (!(await fileExists(configPath))) return { fromEnv: false };
    try {
      const raw = await fsp.readFile(configPath, "utf8");
      const j = JSON.parse(raw);
      if (j && Array.isArray(j.mediaDirs) && j.mediaDirs.length) {
        setMediaDirs(j.mediaDirs);
        return { fromEnv: false };
      }
      // backward compat
      if (j && typeof j.mediaDir === "string" && j.mediaDir.trim()) {
        setMediaDirs([j.mediaDir.trim()]);
        return { fromEnv: false };
      }
    } catch {
      // ignore bad config
    }

    return { fromEnv: false };
  }

  async function saveConfigToDisk() {
    const data = {
      mediaDirs: mediaDirs.map((d) => d.path),
      updatedAt: new Date().toISOString(),
    };
    await fsp.writeFile(configPath, JSON.stringify(data, null, 2), "utf8");
  }

  async function listExistingDirs() {
    const existing = [];
    for (const d of mediaDirs) {
      if (await dirExists(d.path)) existing.push(d);
    }
    return existing;
  }

  async function validateAbsoluteDirs(inputDirs) {
    const normalized = [];
    for (const p of inputDirs) {
      const mediaDir = (p || "").toString().trim();
      if (!mediaDir) continue;
      if (!path.isAbsolute(mediaDir)) {
        return {
          ok: false,
          error: "请使用绝对路径（例如 D:\\\\xxx 或 /home/xxx）",
        };
      }
      const candidate = path.resolve(mediaDir);
      if (!(await dirExists(candidate))) {
        return {
          ok: false,
          error: `路径不存在或不是目录：${candidate}`,
        };
      }
      normalized.push(candidate);
    }
    if (!normalized.length) return { ok: false, error: "没有任何可用目录" };
    return { ok: true, dirs: normalized };
  }

  return {
    // state
    getMediaDirs,
    setMediaDirs,
    getDefaultDirs,
    defaultMediaDir,

    // io
    loadConfigFromDiskOrEnv,
    saveConfigToDisk,

    // helpers
    listExistingDirs,
    validateAbsoluteDirs,
  };
}

module.exports = { createMediaDirStore, normalizeDirs };



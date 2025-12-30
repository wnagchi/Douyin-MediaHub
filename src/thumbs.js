const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

let sharp = null;
try {
  sharp = require("sharp");
} catch (e) {
  // sharp not installed, will handle gracefully
}

function sha1Hex(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

function getThumbConfig() {
  return {
    width: Number.parseInt(process.env.THUMB_WIDTH || "360", 10) || 360,
    format: (process.env.THUMB_FORMAT || "webp").toLowerCase(),
    quality: Number.parseInt(process.env.THUMB_QUALITY || "75", 10) || 75,
    concurrency: Number.parseInt(process.env.THUMB_CONCURRENCY || "3", 10) || 3,
  };
}

function getThumbPath({ rootDir, dirId, filename, width, format }) {
  const dataDir = path.join(rootDir, "data");
  const thumbsDir = path.join(dataDir, "thumbs");
  const key = `${dirId}|${filename}|${width}|${format}`;
  const hash = sha1Hex(key);
  const ext = format === "webp" ? "webp" : format === "jpeg" || format === "jpg" ? "jpg" : "png";
  return path.join(thumbsDir, `${hash}.${ext}`);
}

async function ensureThumbDir(rootDir) {
  const dataDir = path.join(rootDir, "data");
  const thumbsDir = path.join(dataDir, "thumbs");
  await fsp.mkdir(thumbsDir, { recursive: true });
  return thumbsDir;
}

async function ensureThumbForImage({ rootDir, absSourcePath, dirId, filename }) {
  if (!sharp) {
    return { ok: false, error: "sharp not available" };
  }

  if (!absSourcePath || !fs.existsSync(absSourcePath)) {
    return { ok: false, error: "source file not found" };
  }

  const config = getThumbConfig();
  const thumbPath = getThumbPath({ rootDir, dirId, filename, width: config.width, format: config.format });

  // Check if thumb already exists and is newer than source
  try {
    const thumbStat = await fsp.stat(thumbPath);
    const sourceStat = await fsp.stat(absSourcePath);
    if (thumbStat.mtimeMs >= sourceStat.mtimeMs) {
      return { ok: true, path: thumbPath, cached: true };
    }
  } catch {
    // thumb doesn't exist, will generate
  }

  try {
    await ensureThumbDir(rootDir);

    const pipeline = sharp(absSourcePath);
    const metadata = await pipeline.metadata();

    // Skip if not an image
    if (!metadata.width || !metadata.height) {
      return { ok: false, error: "not an image" };
    }

    // Calculate height to maintain aspect ratio
    const aspectRatio = metadata.height / metadata.width;
    const targetHeight = Math.round(config.width * aspectRatio);

    let outputPipeline = pipeline.resize(config.width, targetHeight, {
      fit: "inside",
      withoutEnlargement: true,
    });

    if (config.format === "webp") {
      outputPipeline = outputPipeline.webp({ quality: config.quality });
    } else if (config.format === "jpeg" || config.format === "jpg") {
      outputPipeline = outputPipeline.jpeg({ quality: config.quality });
    } else {
      outputPipeline = outputPipeline.png({ quality: config.quality });
    }

    await outputPipeline.toFile(thumbPath);

    return { ok: true, path: thumbPath, cached: false };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Simple promise pool for concurrency control
class PromisePool {
  constructor(concurrency) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  async add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.running >= this.concurrency || this.queue.length === 0) {
      return;
    }

    this.running++;
    const { fn, resolve, reject } = this.queue.shift();

    Promise.resolve(fn())
      .then(resolve)
      .catch(reject)
      .finally(() => {
        this.running--;
        this.process();
      });
  }
}

function createThumbGenerator({ rootDir }) {
  const config = getThumbConfig();
  const pool = new PromisePool(config.concurrency);

  return {
    async generateThumb({ absSourcePath, dirId, filename }) {
      return pool.add(() => ensureThumbForImage({ rootDir, absSourcePath, dirId, filename }));
    },
    getThumbPath({ dirId, filename }) {
      const config = getThumbConfig();
      return getThumbPath({ rootDir, dirId, filename, width: config.width, format: config.format });
    },
  };
}

module.exports = {
  getThumbPath,
  ensureThumbForImage,
  createThumbGenerator,
  getThumbConfig,
};

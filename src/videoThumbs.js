const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

let ffmpegPath = null;
let sharp = null;

try {
  ffmpegPath = require("ffmpeg-static");
} catch (e) {
  // ffmpeg-static not installed, will handle gracefully
}

try {
  sharp = require("sharp");
} catch (e) {
  // sharp not installed, will handle gracefully
}

function sha1Hex(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

function getVideoThumbConfig() {
  return {
    timeSec: Number.parseFloat(process.env.VTHUMB_TIME_SEC || "0.5", 10) || 0.5,
    width: Number.parseInt(process.env.VTHUMB_WIDTH || "360", 10) || 360,
    format: (process.env.VTHUMB_FORMAT || "jpg").toLowerCase(),
    quality: Number.parseInt(process.env.VTHUMB_QUALITY || "85", 10) || 85,
    concurrency: Number.parseInt(process.env.VTHUMB_CONCURRENCY || "2", 10) || 2,
  };
}

function getVideoThumbPath({ rootDir, dirId, filename, timeSec, width, format }) {
  const dataDir = path.join(rootDir, "data");
  const vthumbsDir = path.join(dataDir, "vthumbs");
  const key = `${dirId}|${filename}|${timeSec}|${width}|${format}`;
  const hash = sha1Hex(key);
  const ext = format === "jpg" || format === "jpeg" ? "jpg" : format === "png" ? "png" : "jpg";
  return path.join(vthumbsDir, `${hash}.${ext}`);
}

async function ensureVideoThumbDir(rootDir) {
  const dataDir = path.join(rootDir, "data");
  const vthumbsDir = path.join(dataDir, "vthumbs");
  await fsp.mkdir(vthumbsDir, { recursive: true });
  return vthumbsDir;
}

function extractFrameWithFfmpeg({ ffmpegPath, videoPath, timeSec, outputPath }) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
      reject(new Error("ffmpeg not available"));
      return;
    }

    const args = [
      "-ss",
      String(timeSec),
      "-i",
      videoPath,
      "-vframes",
      "1",
      "-vf",
      "scale=iw:-1",
      "-q:v",
      "2",
      "-y",
      outputPath,
    ];

    const proc = spawn(ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve();
      } else {
        reject(new Error(`ffmpeg failed with code ${code}: ${stderr.slice(-500)}`));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

async function ensureVideoThumb({ rootDir, absVideoPath, dirId, filename }) {
  if (!ffmpegPath) {
    return { ok: false, error: "ffmpeg not available" };
  }

  if (!sharp) {
    return { ok: false, error: "sharp not available" };
  }

  if (!absVideoPath || !fs.existsSync(absVideoPath)) {
    return { ok: false, error: "source file not found" };
  }

  const config = getVideoThumbConfig();
  const thumbPath = getVideoThumbPath({
    rootDir,
    dirId,
    filename,
    timeSec: config.timeSec,
    width: config.width,
    format: config.format,
  });

  // Check if thumb already exists and is newer than source
  try {
    const thumbStat = await fsp.stat(thumbPath);
    const sourceStat = await fsp.stat(absVideoPath);
    if (thumbStat.mtimeMs >= sourceStat.mtimeMs) {
      return { ok: true, path: thumbPath, cached: true };
    }
  } catch {
    // thumb doesn't exist, will generate
  }

  try {
    await ensureVideoThumbDir(rootDir);

    // Step 1: Extract frame using ffmpeg to a temp file
    const tempExtractedPath = thumbPath + ".tmp.jpg";
    await extractFrameWithFfmpeg({
      ffmpegPath,
      videoPath: absVideoPath,
      timeSec: config.timeSec,
      outputPath: tempExtractedPath,
    });

    // Step 2: Process with sharp (resize, format conversion, quality)
    const metadata = await sharp(tempExtractedPath).metadata();
    if (!metadata.width || !metadata.height) {
      await fsp.unlink(tempExtractedPath).catch(() => {});
      return { ok: false, error: "extracted frame is not valid" };
    }

    const aspectRatio = metadata.height / metadata.width;
    const targetHeight = Math.round(config.width * aspectRatio);

    let pipeline = sharp(tempExtractedPath).resize(config.width, targetHeight, {
      fit: "inside",
      withoutEnlargement: true,
    });

    if (config.format === "jpg" || config.format === "jpeg") {
      pipeline = pipeline.jpeg({ quality: config.quality });
    } else if (config.format === "png") {
      pipeline = pipeline.png({ quality: config.quality });
    } else {
      pipeline = pipeline.jpeg({ quality: config.quality });
    }

    await pipeline.toFile(thumbPath);

    // Clean up temp file
    await fsp.unlink(tempExtractedPath).catch(() => {});

    return { ok: true, path: thumbPath, cached: false };
  } catch (e) {
    // Clean up temp file on error
    const tempPath = thumbPath + ".tmp.jpg";
    await fsp.unlink(tempPath).catch(() => {});
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

function createVideoThumbGenerator({ rootDir }) {
  const config = getVideoThumbConfig();
  const pool = new PromisePool(config.concurrency);

  return {
    async generateThumb({ absVideoPath, dirId, filename }) {
      return pool.add(() => ensureVideoThumb({ rootDir, absVideoPath, dirId, filename }));
    },
    getThumbPath({ dirId, filename }) {
      const config = getVideoThumbConfig();
      return getVideoThumbPath({
        rootDir,
        dirId,
        filename,
        timeSec: config.timeSec,
        width: config.width,
        format: config.format,
      });
    },
  };
}

module.exports = {
  getVideoThumbPath,
  ensureVideoThumb,
  createVideoThumbGenerator,
  getVideoThumbConfig,
};

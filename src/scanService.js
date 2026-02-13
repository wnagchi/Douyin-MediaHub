const fsp = require("fs/promises");
const path = require("path");

function nowMs() {
  return Date.now();
}

function defaultSchedule() {
  return {
    enabled: false,
    timeOfDay: "02:00",
    intervalHours: 24,
    timezone: "local",
    lastRunAt: null,
    nextRunAt: null,
  };
}

function parseTimeOfDay(timeOfDay) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(timeOfDay || ""));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, min };
}

function computeNextRun(schedule, baseMs = nowMs()) {
  if (!schedule || !schedule.enabled) return null;
  const intervalHours = Number(schedule.intervalHours) || 24;
  const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000;
  const last = Number(schedule.lastRunAt) || 0;
  const nextByInterval = last ? last + intervalMs : null;

  let nextByTime = null;
  const parsed = parseTimeOfDay(schedule.timeOfDay);
  if (parsed) {
    const d = new Date(baseMs);
    const candidate = new Date(d);
    candidate.setHours(parsed.h, parsed.min, 0, 0);
    if (candidate.getTime() <= baseMs) {
      candidate.setDate(candidate.getDate() + 1);
    }
    nextByTime = candidate.getTime();
  }

  let next = nextByTime ?? nextByInterval ?? baseMs + intervalMs;
  if (nextByInterval && nextByInterval > next) next = nextByInterval;
  if (next <= baseMs + 1000) next = baseMs + 5 * 60 * 1000;
  return next;
}

function createTypeStats() {
  return {
    video: 0,
    live: 0,
    album: 0,
    other: 0,
  };
}

function classifyType({ declaredTypes, kind }) {
  const types = Array.isArray(declaredTypes) ? declaredTypes : [];
  if (types.includes("实况")) return "live";
  if (types.includes("图集")) return "album";
  if (types.includes("视频")) return "video";
  if (kind === "video") return "video";
  return "other";
}

function bumpType(stats, info) {
  const key = classifyType(info);
  if (stats[key] == null) stats[key] = 0;
  stats[key] += 1;
}

function createScanService({ rootDir, indexer }) {
  const dataDir = path.join(rootDir, "data");
  const schedulePath = path.join(dataDir, "scan-schedule.json");
  const logsPath = path.join(dataDir, "scan-logs.jsonl");
  let timer = null;
  let scheduleCache = null;

  async function ensureDataDir() {
    await fsp.mkdir(dataDir, { recursive: true });
  }

  async function readSchedule() {
    if (scheduleCache) return scheduleCache;
    try {
      const raw = await fsp.readFile(schedulePath, "utf8");
      scheduleCache = { ...defaultSchedule(), ...(raw ? JSON.parse(raw) : {}) };
    } catch {
      scheduleCache = defaultSchedule();
    }
    scheduleCache.nextRunAt = computeNextRun(scheduleCache, nowMs());
    return scheduleCache;
  }

  async function writeSchedule(next) {
    await ensureDataDir();
    scheduleCache = { ...defaultSchedule(), ...(next || {}) };
    scheduleCache.nextRunAt = computeNextRun(scheduleCache, nowMs());
    await fsp.writeFile(schedulePath, JSON.stringify(scheduleCache, null, 2), "utf8");
    return scheduleCache;
  }

  async function updateSchedule(partial) {
    const current = await readSchedule();
    const next = { ...current, ...(partial || {}) };
    return writeSchedule(next);
  }

  async function appendLog(entry) {
    await ensureDataDir();
    const line = JSON.stringify(entry);
    await fsp.appendFile(logsPath, `${line}\n`, "utf8");
  }

  async function listLogs(limit = 50) {
    try {
      const raw = await fsp.readFile(logsPath, "utf8");
      const lines = raw.trim().split(/\r?\n/).filter(Boolean);
      const tail = lines.slice(-Math.max(1, Math.min(200, Number(limit) || 50)));
      return tail.map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  async function runScan({ trigger = "manual", force = false, forceScan = null, rebuildDerived = null, onProgress } = {}) {
    const startedAt = nowMs();
    let result = null;
    let error = null;

    try {
      result = await indexer.updateCheck({ force, forceScan, rebuildDerived, onProgress, typeStats: { createTypeStats, bumpType } });
    } catch (e) {
      error = String(e?.message || e);
      result = { ok: false, error };
    }

    if (result && result.running) {
      return result;
    }

    const endedAt = nowMs();
    const log = {
      id: `${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
      trigger,
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      ok: Boolean(result && result.ok),
      error: result?.error || error || null,
      result: {
        scannedDirs: result?.scannedDirs ?? 0,
        skippedDirs: result?.skippedDirs ?? 0,
        added: result?.added ?? 0,
        updated: result?.updated ?? 0,
        deleted: result?.deleted ?? 0,
        durationMs: result?.durationMs ?? null,
        typeStats: result?.typeStats ?? null,
        metrics: result?.metrics ?? null,
      },
    };

    await appendLog(log);

    const schedule = await readSchedule();
    if (schedule.enabled) {
      schedule.lastRunAt = endedAt;
      schedule.nextRunAt = computeNextRun(schedule, endedAt);
      await writeSchedule(schedule);
      scheduleNext();
    }

    return { ...(result || {}), logId: log.id };
  }

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function scheduleNext() {
    clearTimer();
    if (!scheduleCache || !scheduleCache.enabled) return;
    const next = scheduleCache.nextRunAt || computeNextRun(scheduleCache, nowMs());
    if (!next) return;
    const delay = Math.max(1000, next - nowMs());
    timer = setTimeout(async () => {
      const schedule = await readSchedule();
      if (!schedule.enabled) return;
      const runResult = await runScan({ trigger: "auto", force: false });
      if (runResult?.running) {
        schedule.lastRunAt = schedule.lastRunAt || nowMs();
        schedule.nextRunAt = nowMs() + 10 * 60 * 1000;
        await writeSchedule(schedule);
      }
      scheduleNext();
    }, delay);
  }

  async function startScheduler() {
    const schedule = await readSchedule();
    if (schedule.enabled) {
      schedule.nextRunAt = computeNextRun(schedule, nowMs());
      await writeSchedule(schedule);
      scheduleNext();
    }
  }

  return {
    readSchedule,
    updateSchedule,
    listLogs,
    runScan,
    startScheduler,
  };
}

module.exports = { createScanService };

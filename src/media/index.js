const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

function extToKind(ext) {
  const e = ext.toLowerCase();
  if ([".mp4", ".webm", ".mov", ".m4v"].includes(e)) return "video";
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(e))
    return "image";
  return "file";
}

function parseTimeToIso(timeText) {
  // e.g. "2025-12-07 16.29.19"
  const m =
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2})\.(\d{2})\.(\d{2})$/.exec(timeText);
  if (!m) return null;
  const [, date, hh, mm, ss] = m;
  return `${date}T${hh}:${mm}:${ss}`;
}

function parseMediaFilename(filename) {
  const ext = path.extname(filename);
  const base = filename.slice(0, -ext.length);

  // Expected:
  // "YYYY-MM-DD HH.MM.SS-类型-发布人-主题(_序号)"
  // NOTE: date contains "-", so we must not split from the beginning by '-'.
  const timeTextRaw = base.slice(0, 19);
  const sep = base[19];
  if (sep !== "-") return null;
  const rest = base.slice(20);
  const parts = rest.split("-");
  if (parts.length < 3) return null;

  const typeRaw = parts[0];
  const authorRaw = parts[1];
  const themeAndSeqRaw = parts.slice(2).join("-"); // theme may contain '-'

  const timeText = timeTextRaw.trim();
  const typeText = (typeRaw || "").trim();
  const author = (authorRaw || "").trim();

  const themeSeq = /^(.*?)(?:_(\d+))?$/.exec(themeAndSeqRaw);
  const theme = (themeSeq?.[1] ?? themeAndSeqRaw).trim();
  const seq = themeSeq?.[2] ? Number(themeSeq[2]) : null;

  const iso = parseTimeToIso(timeText);
  const timestampMs = iso ? new Date(iso).getTime() : null;

  const declaredTypes = typeText
    .split("+")
    .map((t) => t.trim())
    .filter(Boolean);

  return {
    filename,
    ext,
    kind: extToKind(ext),
    timeText,
    iso,
    timestampMs,
    typeText,
    declaredTypes,
    author,
    theme,
    seq,
  };
}

function indexOfAscii(buf, ascii) {
  return buf.indexOf(Buffer.from(ascii, "ascii"));
}

function sniffMp4CodecsFromBuffers(buffers) {
  const hay = Buffer.concat(buffers);
  const hits = [];
  const tokens = [
    { token: "hvc1", label: "H.265/HEVC (hvc1)" },
    { token: "hev1", label: "H.265/HEVC (hev1)" },
    { token: "avc1", label: "H.264/AVC (avc1)" },
    { token: "av01", label: "AV1 (av01)" },
    { token: "vp09", label: "VP9 (vp09)" },
    { token: "mp4a", label: "AAC/MP4A (mp4a)" },
    { token: "ac-3", label: "Dolby AC-3 (ac-3)" },
    { token: "ec-3", label: "Dolby E-AC-3 (ec-3)" },
  ];

  for (const t of tokens) {
    if (indexOfAscii(hay, t.token) !== -1) hits.push(t.label);
  }
  return Array.from(new Set(hits));
}

async function inspectMp4(filePath) {
  const stat = await fsp.stat(filePath);
  const size = stat.size;
  const fd = await fsp.open(filePath, "r");
  try {
    const headSize = Math.min(2 * 1024 * 1024, size);
    const tailSize = Math.min(2 * 1024 * 1024, size);
    const head = Buffer.alloc(headSize);
    const tail = Buffer.alloc(tailSize);

    await fd.read(head, 0, headSize, 0);
    if (size > tailSize) {
      await fd.read(tail, 0, tailSize, size - tailSize);
    } else {
      head.copy(tail, 0, 0, tailSize);
    }

    const headMoov = indexOfAscii(head, "moov");
    const tailMoov = indexOfAscii(tail, "moov");

    const codecs = sniffMp4CodecsFromBuffers([head, tail]);
    let videoCodecHint = "未知";
    if (codecs.some((c) => c.includes("H.265/HEVC"))) videoCodecHint = "H.265/HEVC";
    else if (codecs.some((c) => c.includes("H.264/AVC"))) videoCodecHint = "H.264/AVC";
    else if (codecs.some((c) => c.includes("AV1"))) videoCodecHint = "AV1";
    else if (codecs.some((c) => c.includes("VP9"))) videoCodecHint = "VP9";

    return {
      size,
      mtimeMs: stat.mtimeMs,
      moov: {
        inHead: headMoov !== -1,
        inTail: tailMoov !== -1,
        // If moov is in head: likely fast-start
        likelyFastStart: headMoov !== -1,
      },
      codecHints: codecs,
      videoCodecHint,
    };
  } finally {
    await fd.close();
  }
}

async function scanMedia(mediaDirs) {
  const parsed = [];

  for (const dir of mediaDirs) {
    // recursive scan
    /** @type {{abs:string, rel:string}[]} */
    const stack = [{ abs: dir.path, rel: "" }];
    while (stack.length) {
      const cur = stack.pop();
      let entries = [];
      try {
        entries = await fsp.readdir(cur.abs, { withFileTypes: true });
      } catch (e) {
        if (e && e.code === "ENOENT") continue;
        continue;
      }

      for (const ent of entries) {
        const name = ent?.name || "";
        if (!name || name.startsWith(".")) continue;
        const absChild = path.join(cur.abs, name);
        const relChild = cur.rel ? `${cur.rel}/${name}` : name;
        if (ent.isDirectory()) {
          stack.push({ abs: absChild, rel: relChild });
          continue;
        }
        if (!ent.isFile()) continue;

        const p = parseMediaFilename(path.basename(relChild));
      if (!p) continue;
        parsed.push({ ...p, filename: relChild, dirId: dir.id, dirLabel: dir.label });
      }
    }
  }

  const groupsMap = new Map();

  for (const item of parsed) {
    const key = `${item.timeText}|${item.author}|${item.theme}`;
    const id = crypto.createHash("sha1").update(key).digest("hex");

    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        id,
        key,
        timeText: item.timeText,
        iso: item.iso,
        timestampMs: item.timestampMs,
        author: item.author,
        theme: item.theme,
        types: new Set(),
        items: [],
      });
    }

    const g = groupsMap.get(key);
    for (const t of item.declaredTypes) g.types.add(t);
    const mediaItem = {
      filename: item.filename,
      dirId: item.dirId,
      dirLabel: item.dirLabel,
      url: `/media/${encodeURIComponent(item.dirId)}/${encodeURIComponent(item.filename)}`,
      ext: item.ext,
      kind: item.kind,
      seq: item.seq,
      declaredType: item.typeText,
    };
    // Add thumbUrl for images
    if (item.kind === "image") {
      mediaItem.thumbUrl = `/thumb/${encodeURIComponent(item.dirId)}/${encodeURIComponent(item.filename)}`;
    }
    // Add thumbUrl for videos
    if (item.kind === "video") {
      mediaItem.thumbUrl = `/vthumb/${encodeURIComponent(item.dirId)}/${encodeURIComponent(item.filename)}`;
    }
    g.items.push(mediaItem);
  }

  const groups = Array.from(groupsMap.values()).map((g) => {
    const typeList = Array.from(g.types);
    const groupType = typeList.length > 1 ? "混合" : typeList[0] || "未知";
    const items = g.items
      .slice()
      .sort(
        (a, b) =>
          (a.seq ?? 1e9) - (b.seq ?? 1e9) || a.filename.localeCompare(b.filename)
      );
    return {
      id: g.id,
      timeText: g.timeText,
      iso: g.iso,
      timestampMs: g.timestampMs,
      author: g.author,
      theme: g.theme,
      groupType,
      types: typeList,
      items,
    };
  });

  groups.sort((a, b) => {
    const ta = a.timestampMs ?? 0;
    const tb = b.timestampMs ?? 0;
    return tb - ta || (b.timeText || "").localeCompare(a.timeText || "");
  });

  return groups;
}

module.exports = {
  parseMediaFilename,
  scanMedia,
  inspectMp4,
};



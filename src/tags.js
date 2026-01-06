function normalizeText(s) {
  return String(s || "")
    .replaceAll("＃", "#")
    .normalize("NFKC");
}

/**
 * Extract hashtag-like tokens from text.
 * Examples:
 * - "宝宝在吗？ #自拍 #穿搭" -> ["自拍", "穿搭"]
 * - "foo#bar #baz" -> ["bar", "baz"] (only '#...' segments)
 */
function extractHashtags(text, { max = 50 } = {}) {
  const norm = normalizeText(text);
  const re = /#([^\s#]+)/gu;
  /** @type {string[]} */
  const tags = [];
  const seen = new Set();

  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(norm)) && tags.length < max) {
    let t = String(m[1] || "").trim();
    // trim common trailing punctuations/symbols
    t = t.replace(/[，。,\.!?！？:：;；、\)\]\}）】」』"'“”‘’]+$/gu, "");
    // trim common leading brackets/quotes
    t = t.replace(/^[\(\[\{（【「『"'“”‘’]+/gu, "");
    t = t.trim();
    if (!t) continue;

    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(t);
  }
  return tags;
}

function stripHashtags(text) {
  const norm = normalizeText(text);
  return norm
    .replace(/(?:^|\s)#[^\s#]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTagInput(tag) {
  let t = normalizeText(tag).trim();
  if (t.startsWith("#")) t = t.slice(1);
  t = t.trim();
  t = t.replace(/[，。,\.!?！？:：;；、]+$/gu, "").trim();
  return t.toLowerCase();
}

module.exports = {
  extractHashtags,
  stripHashtags,
  normalizeTagInput,
};


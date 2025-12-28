import { $, $$ } from "./js/dom.js";
import { escHtml } from "./js/escape.js";
import { clamp } from "./js/math.js";
import {
  fetchResources,
  fetchConfig,
  saveConfigMediaDirs,
  inspectMedia,
} from "./js/api.js";

const GROUP_BATCH = 30; // 每次渲染的分组数量（避免一次性塞进大量 DOM）
const THUMB_ROOT_MARGIN = "240px 0px"; // 缩略图提前加载的距离

function fmtGroupTitle(g) {
  const theme = g.theme || "(无主题)";
  return theme;
}

function typeClass(t) {
  if (t === "视频") return "video";
  if (t === "图集") return "photo";
  if (t === "实况") return "live";
  if (t === "混合") return "mix";
  return "";
}

function typeLabel(g) {
  // groupType computed by backend
  return g.groupType || (g.types && g.types[0]) || "未知";
}

function typeTags(g) {
  const list = Array.isArray(g.types) ? g.types.slice() : [];
  const computed = typeLabel(g);
  const tags =
    computed === "混合"
      ? ["混合", ...list]
      : list.length ? list : [computed];
  const uniq = Array.from(new Set(tags.filter(Boolean)));
  return uniq;
}

function isMatch(group, q) {
  if (!q) return true;
  const hay = `${group.author} ${group.theme} ${group.groupType} ${(group.types || []).join(" ")} ${group.timeText}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}

function makeThumb(item, groupIdx, itemIdx) {
  const isVideo = item.kind === "video";
  const badgeText = item.seq != null ? `_${item.seq}` : (isVideo ? "mp4" : "img");
  const play = isVideo ? `<div class="play" aria-hidden="true">▶</div>` : `<div style="width:30px"></div>`;

  const mediaEl = isVideo
    ? `<video preload="none" muted playsinline data-src="${escHtml(item.url)}"></video>`
    : `<img loading="lazy" src="${escHtml(item.url)}" alt=""/>`;

  return `
    <div class="thumb" role="button" tabindex="0"
      data-g="${groupIdx}" data-i="${itemIdx}"
      title="${escHtml(item.filename)}">
      ${mediaEl}
      <div class="overlay">
        <span class="badge">${escHtml(badgeText)}</span>
        ${play}
      </div>
    </div>
  `;
}

function renderCard(group, groupIdx) {
  const title = fmtGroupTitle(group);
  const type = typeLabel(group);
  const tags = typeTags(group);
  const pillAuthor = group.author ? `<span class="pill"><strong>发布人</strong> ${escHtml(group.author)}</span>` : "";
  const pillTime = group.timeText ? `<span class="pill"><strong>时间</strong> ${escHtml(group.timeText)}</span>` : "";

  const tagHtml = tags
    .map((t) => `<span class="tag ${typeClass(t)}">${escHtml(t)}</span>`)
    .join("");

  const items = Array.isArray(group.items) ? group.items : [];
  const previewCount = Math.min(items.length, 4);
  const thumbs = items.slice(0, previewCount).map((it, idx) => makeThumb(it, groupIdx, idx)).join("");
  const more = items.length > previewCount
    ? `<div class="thumb" role="button" tabindex="0" data-g="${groupIdx}" data-i="${previewCount}"
         title="查看更多">
        <div style="width:100%;height:100%;display:grid;place-items:center;background:rgba(0,0,0,.25)">
          <div style="text-align:center">
            <div style="font-weight:800;font-size:20px">+${items.length - previewCount}</div>
            <div style="color:rgba(255,255,255,.66);font-size:12px;margin-top:4px">更多</div>
          </div>
        </div>
      </div>`
    : "";

  return `
    <article class="card" data-type="${escHtml(type)}">
      <div class="cardInner">
        <div class="cardTop">
          <div>
            <div class="cardTitle">${escHtml(title)}</div>
            <div class="cardSub">
              ${pillAuthor}
              ${pillTime}
              <span class="pill"><strong>条目</strong> ${items.length}</span>
            </div>
          </div>
          <div class="tagRow" aria-label="类型标签">${tagHtml}</div>
        </div>

        <div class="thumbs" data-group="${groupIdx}">
          ${thumbs}
          ${more}
        </div>
      </div>
    </article>
  `;
}

let state = {
  groups: [],
  filtered: [],
  activeType: "全部",
  activeDirId: "all",
  q: "",
  renderLimit: GROUP_BATCH,
  _filterKey: "",
  _moreObserver: null,
  _thumbObserver: null,
  modal: { open: false, groupIdx: 0, itemIdx: 0 },
  feedMode: false,
  setup: {
    needed: false,
    mediaDirs: [],
    defaultMediaDirs: [],
    fromEnv: false,
  },
  dirs: [],
};

function selectedDirId() {
  return state.activeDirId || "all";
}

function applyFilters() {
  const q = state.q.trim();
  let arr = state.groups.slice();

  if (state.activeType && state.activeType !== "全部") {
    arr = arr.filter((g) => (g.groupType || "") === state.activeType || (g.types || []).includes(state.activeType));
  }
  if (q) arr = arr.filter((g) => isMatch(g, q));

  const dirId = selectedDirId();
  if (dirId !== "all") {
    arr = arr
      .map((g) => {
        const items = (g.items || []).filter((it) => it.dirId === dirId);
        return { ...g, items };
      })
      .filter((g) => (g.items || []).length > 0);
  }

  state.filtered = arr;
}

function renderDirSelect() {
  const sel = $("#dirSelect");
  if (!sel) return;
  const dirs = Array.isArray(state.dirs) ? state.dirs : [];
  const cur = selectedDirId();

  const options = [
    { id: "all", label: "全部目录" },
    ...dirs.map((d) => ({ id: d.id, label: d.label || d.path || d.id })),
  ];

  sel.innerHTML = options
    .map((o) => `<option value="${escHtml(o.id)}"${o.id === cur ? " selected" : ""}>${escHtml(o.label)}</option>`)
    .join("");
}

function currentFilterKey() {
  return `${state.activeType}|${selectedDirId()}|${(state.q || "").trim()}`;
}

function ensureObservers() {
  // Infinite scroll observer
  if (!state._moreObserver) {
    state._moreObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          // 触底：加载更多
          loadMoreGroups();
        }
      },
      { root: null, rootMargin: "600px 0px", threshold: 0.01 }
    );
  }

  // Thumb video lazy observer
  if (!state._thumbObserver) {
    const unloadOffscreen = window.matchMedia && window.matchMedia("(max-width: 520px)").matches;
    state._thumbObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target;
          if (!(v instanceof HTMLVideoElement)) continue;
          if (e.isIntersecting) {
            if (!v.src) {
              const src = v.dataset.src;
              if (!src) continue;
              v.preload = "metadata";
              v.src = src;
              // best-effort
              try { v.load(); } catch {}
            }
          } else {
            // 退出视口：暂停；移动端可选卸载节省内存
            try { v.pause(); } catch {}
            if (unloadOffscreen && v.src) {
              v.removeAttribute("src");
              try { v.load(); } catch {}
            }
          }
        }
      },
      { root: null, rootMargin: THUMB_ROOT_MARGIN, threshold: 0.01 }
    );
  }
}

function observeThumbVideos() {
  ensureObservers();
  // 只观察当前已渲染区域的缩略图 video
  $$("#grid video[data-src]").forEach((v) => state._thumbObserver.observe(v));
}

function observeMoreSentinel(hasMore) {
  ensureObservers();
  if (!hasMore) return;
  const s = $("#sentinel");
  if (s) state._moreObserver.observe(s);
}

function loadMoreGroups() {
  const max = state.filtered.length;
  if (state.renderLimit >= max) return;
  state.renderLimit = Math.min(state.renderLimit + GROUP_BATCH, max);
  render();
}

function render() {
  applyFilters();

  const grid = $("#grid");
  const meta = $("#meta");

  if (state.setup.needed) {
    const hint = state.setup.fromEnv
      ? "当前 mediaDir 由环境变量 MEDIA_DIR 指定（页面内无法持久化保存）。"
      : "保存后会写入项目根目录 config.json，后续启动自动生效。";

    meta.textContent = "未检测到 media 目录：请先配置资源目录（绝对路径）";
    const current = (state.setup.mediaDirs || []).join("\n");
    const defaultVal = (state.setup.defaultMediaDirs || []).join("\n");
    grid.innerHTML = `
      <section class="setupCard">
        <div class="setupTitle">需要配置资源目录</div>
        <div class="setupDesc">
          服务端未找到任何可用资源目录，所以暂时无法列出资源。请在下方输入<strong>绝对路径</strong>，支持多个目录（每行一个）。<br/>
          ${escHtml(hint)}
        </div>
        <div class="setupRow">
          <textarea id="mediaDirsInput" class="setupInput" rows="4"
            placeholder="例如：&#10;D:\\\\code\\\\ai\\\\test_http_server\\\\media&#10;D:\\\\another_media"
          >${escHtml(current || localStorage.getItem("mediaDirs") || "")}</textarea>
          <button id="saveMediaDirs" class="btn">保存并刷新</button>
          <button id="useDefaultMediaDirs" class="btn ghost">使用默认</button>
        </div>
        <div class="setupSmall">
          current (lines): ${escHtml(current ? String(current.split("\n").filter(Boolean).length) : "0")}<br/>
          default: ${escHtml(defaultVal || "-")}
        </div>
      </section>
    `;
    return;
  }

  // filters change -> reset pagination
  const fk = currentFilterKey();
  if (fk !== state._filterKey) {
    state._filterKey = fk;
    state.renderLimit = Math.min(GROUP_BATCH, state.filtered.length || 0);
  }

  renderDirSelect();

  const totalGroups = state.groups.length;
  const showGroups = state.filtered.length;
  const totalItems = state.groups.reduce((acc, g) => acc + (g.items?.length || 0), 0);
  const showItems = state.filtered.reduce((acc, g) => acc + (g.items?.length || 0), 0);
  const shownGroups = Math.min(state.renderLimit, showGroups);
  const hasMore = shownGroups < showGroups;

  meta.textContent = `groups: ${shownGroups}/${showGroups} (all ${totalGroups})  |  items: ${showItems}/${totalItems}  |  filter: ${state.activeType}  |  q: ${state.q || "-"}`;

  const cards = state.filtered
    .slice(0, shownGroups)
    .map((g, idx) => renderCard(g, idx))
    .join("");

  const footer = `
    <div class="listFooter">
      ${hasMore ? `<button id="loadMore" class="btn">加载更多（${shownGroups}/${showGroups}）</button>` : `<div class="endHint">已到底</div>`}
      <div id="sentinel" class="sentinel" aria-hidden="true"></div>
    </div>
  `;

  grid.innerHTML = cards + footer;
  observeMoreSentinel(hasMore);
  observeThumbVideos();
}

async function load() {
  $("#meta").textContent = "加载中…";
  const j = await fetchResources();
  if (!j.ok) {
    if (j.code === "NO_MEDIA_DIR") {
      state.setup.needed = true;
      state.setup.mediaDirs = j.mediaDirs || [];
      state.setup.defaultMediaDirs = j.defaultMediaDirs || [];
      state.setup.fromEnv = false;
      try {
        const cfg = await fetchConfig();
        if (cfg.ok) state.setup.fromEnv = Boolean(cfg.fromEnv);
      } catch {
        // ignore
      }
      state.groups = [];
      state.filtered = [];
      render();
      return;
    }
    throw new Error(j.error || "API error");
  }
  state.setup.needed = false;
  state.dirs = j.dirs || [];
  state.groups = j.groups || [];
  state.filtered = state.groups.slice();
  render();
}

function setActiveChip(type) {
  state.activeType = type;
  $$("#filters .chip").forEach((b) => b.classList.toggle("active", b.dataset.type === type));
  render();
}

function openModal(groupIdx, itemIdx) {
  const modal = $("#modal");
  modal.classList.remove("hidden");
  modal.classList.toggle("feed", Boolean(state.feedMode));
  state.modal = { open: true, groupIdx, itemIdx };
  renderModal();
}

function closeModal() {
  $("#modal").classList.add("hidden");
  $("#modal").classList.remove("feed");
  state.modal.open = false;
  state.feedMode = false;
  $("#modalBody").innerHTML = "";
}

function renderModal() {
  const { groupIdx } = state.modal;
  const group = state.filtered[groupIdx];
  if (!group) return closeModal();
  const items = group.items || [];

  state.modal.itemIdx = clamp(state.modal.itemIdx, 0, Math.max(0, items.length - 1));
  const item = items[state.modal.itemIdx];
  if (!item) return closeModal();

  const title = `${group.timeText || ""} · ${group.author || ""} · ${group.theme || ""}`.replace(/\s+·\s+$/, "");
  $("#modalTitle").textContent = title || item.filename;

  const hint = `${state.modal.itemIdx + 1}/${items.length}  |  ${item.filename}`;
  $("#modalHint").textContent = hint;

  const download = $("#download");
  download.href = item.url;
  download.download = item.filename;

  const body = $("#modalBody");
  body.innerHTML = "";

  if (item.kind === "video") {
    const v = document.createElement("video");
    v.src = item.url;
    v.controls = true;
    v.autoplay = true;
    v.playsInline = true;
    v.preload = "metadata";
    body.appendChild(v);

    const warn = document.createElement("div");
    warn.className = "warnBox";
    warn.style.display = "none";
    warn.innerHTML =
      "该视频在浏览器里<strong>有声音但没画面</strong>时，通常是<strong>视频编码不被支持</strong>（常见：<code>H.265/HEVC</code>）。<br/>" +
      "建议：1) 点击右下角<strong>下载</strong>后用 VLC/系统播放器打开；2) 在 Win10/Edge/Chrome 安装 HEVC 扩展；3) 转码为 H.264(AVC) 再放。";
    body.appendChild(warn);

    const showWarn = (extra) => {
      warn.style.display = "";
      if (extra) {
        $("#modalHint").textContent = `${$("#modalHint").textContent}  |  ${extra}`;
      }
    };

    // Best-effort inspect (no dependencies): show codec hints + moov location
    (async () => {
      try {
        const j = await inspectMedia({ dirId: item.dirId || "", filename: item.filename });
        if (!j.ok || !j.info) return;
        const info = j.info;
        const codecLine = info.videoCodecHint ? `codec=${info.videoCodecHint}` : "";
        const moovLine = info.moov?.likelyFastStart ? "faststart=是" : "faststart=否(可能需下载完/不利于流式播放)";
        const hints = Array.isArray(info.codecHints) && info.codecHints.length ? `hints=${info.codecHints.join(", ")}` : "";
        const extra = [codecLine, moovLine, hints].filter(Boolean).join("  |  ");
        if (extra) $("#modalHint").textContent = `${$("#modalHint").textContent}  |  ${extra}`;
      } catch {
        // ignore
      }
    })();

    v.addEventListener("error", () => {
      const code = v.error?.code;
      // 1: aborted, 2: network, 3: decode, 4: src not supported
      const reason =
        code === 3
          ? "解码失败(MEDIA_ERR_DECODE)"
          : code === 4
            ? "源不支持(MEDIA_ERR_SRC_NOT_SUPPORTED)"
            : code === 2
              ? "网络错误(MEDIA_ERR_NETWORK)"
              : code === 1
                ? "播放中止(MEDIA_ERR_ABORTED)"
                : "未知错误";
      showWarn(reason);
    });

    v.addEventListener("loadedmetadata", () => {
      // If only audio track, videoWidth can be 0
      if (v.videoWidth === 0 && Number.isFinite(v.duration) && v.duration > 0) {
        showWarn("检测到 videoWidth=0（可能是音频-only 或视频轨无法解码）");
      }
    });
  } else if (item.kind === "image") {
    const img = document.createElement("img");
    img.src = item.url;
    img.alt = item.filename;
    body.appendChild(img);
  } else {
    const a = document.createElement("a");
    a.href = item.url;
    a.textContent = `打开文件：${item.filename}`;
    a.className = "btn";
    body.appendChild(a);
  }

  // Feed overlay (Douyin-like): show group info + swipe hint
  if (state.feedMode) {
    const overlay = document.createElement("div");
    overlay.className = "feedOverlay";
    const title = `${group.author || ""}  ${group.theme || ""}`.trim() || group.theme || item.filename;
    const sub = `${group.timeText || ""} | ${group.groupType || ""} | ${state.modal.itemIdx + 1}/${items.length} | 上滑下一组 / 下滑上一组`;
    overlay.innerHTML = `
      <div class="feedTitle">${escHtml(title)}</div>
      <div class="feedSub">${escHtml(sub)}</div>
    `;
    body.appendChild(overlay);
  }
}

function modalStep(delta) {
  if (!state.modal.open) return;
  state.modal.itemIdx += delta;
  renderModal();
}

function groupStep(delta) {
  if (!state.modal.open) return;
  const next = clamp(state.modal.groupIdx + delta, 0, Math.max(0, state.filtered.length - 1));
  if (next === state.modal.groupIdx) {
    $("#modalHint").textContent = `${$("#modalHint").textContent}  |  已到边界`;
    return;
  }
  state.modal.groupIdx = next;
  // reset to first item of that group (prefer video if present)
  const g = state.filtered[next];
  const items = g?.items || [];
  const firstVideoIdx = items.findIndex((it) => it.kind === "video");
  state.modal.itemIdx = firstVideoIdx >= 0 ? firstVideoIdx : 0;
  renderModal();
}

function bind() {
  $("#feed").addEventListener("click", () => {
    if (!state.filtered.length) return;
    state.feedMode = true;
    openModal(0, 0);
  });

  $("#dirSelect").addEventListener("change", (e) => {
    state.activeDirId = e.target.value || "all";
    render();
  });

  let qTimer = 0;
  $("#q").addEventListener("input", (e) => {
    state.q = e.target.value || "";
    clearTimeout(qTimer);
    qTimer = setTimeout(() => render(), 160);
  });

  $("#clearQ").addEventListener("click", () => {
    state.q = "";
    $("#q").value = "";
    render();
  });

  $("#filters").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    setActiveChip(btn.dataset.type);
  });

  $("#refresh").addEventListener("click", () => load().catch(showError));

  $("#grid").addEventListener("click", (e) => {
    const loadMoreBtn = e.target.closest("#loadMore");
    if (loadMoreBtn) {
      loadMoreGroups();
      return;
    }

    const saveBtn = e.target.closest("#saveMediaDirs");
    if (saveBtn) {
      const input = $("#mediaDirsInput");
      const text = (input?.value || "").trim();
      const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (!lines.length) return showError(new Error("请输入至少一个绝对路径（每行一个）"));
      $("#meta").textContent = "保存中…";
      saveConfigMediaDirs(lines)
        .then((j) => {
          if (!j.ok) throw new Error(j.error || "保存失败");
          localStorage.setItem("mediaDirs", lines.join("\n"));
          return load();
        })
        .catch(showError);
      return;
    }

    const useDefaultBtn = e.target.closest("#useDefaultMediaDirs");
    if (useDefaultBtn) {
      const val = (state.setup.defaultMediaDirs || []).join("\n");
      if (!val) return showError(new Error("默认目录为空"));
      const input = $("#mediaDirsInput");
      if (input) input.value = val;
      return;
    }

    const t = e.target.closest(".thumb");
    if (!t) return;
    const gi = Number(t.dataset.g);
    const ii = Number(t.dataset.i);
    if (Number.isFinite(gi) && Number.isFinite(ii)) {
      state.feedMode = false;
      openModal(gi, ii);
    }
  });

  $("#grid").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target.closest(".thumb");
    if (!t) return;
    e.preventDefault();
    const gi = Number(t.dataset.g);
    const ii = Number(t.dataset.i);
    if (Number.isFinite(gi) && Number.isFinite(ii)) openModal(gi, ii);
  });

  $("#modal").addEventListener("click", (e) => {
    if (e.target?.dataset?.close) closeModal();
  });

  $("#close").addEventListener("click", closeModal);
  $("#prev").addEventListener("click", () => modalStep(-1));
  $("#next").addEventListener("click", () => modalStep(+1));

  // Wheel (desktop) for feed mode: scroll down -> next group, scroll up -> prev group
  let wheelLock = 0;
  $("#modal").addEventListener(
    "wheel",
    (e) => {
      if (!state.modal.open || !state.feedMode) return;
      const now = Date.now();
      if (now - wheelLock < 350) return;
      const dy = e.deltaY;
      if (Math.abs(dy) < 30) return;
      e.preventDefault();
      wheelLock = now;
      groupStep(dy > 0 ? +1 : -1);
    },
    { passive: false }
  );

  // Touch swipe for feed mode
  let touchStartY = 0;
  let touchStartX = 0;
  let touching = false;
  const SWIPE = 60;

  $("#modal").addEventListener(
    "touchstart",
    (e) => {
      if (!state.modal.open || !state.feedMode) return;
      const t = e.touches?.[0];
      if (!t) return;
      touching = true;
      touchStartY = t.clientY;
      touchStartX = t.clientX;
    },
    { passive: true }
  );

  $("#modal").addEventListener(
    "touchend",
    (e) => {
      if (!touching || !state.modal.open || !state.feedMode) return;
      touching = false;
      const t = e.changedTouches?.[0];
      if (!t) return;
      const dy = t.clientY - touchStartY;
      const dx = t.clientX - touchStartX;
      if (Math.abs(dy) < SWIPE || Math.abs(dy) < Math.abs(dx)) return;
      // swipe up -> next group
      groupStep(dy < 0 ? +1 : -1);
    },
    { passive: true }
  );

  document.addEventListener("keydown", (e) => {
    if (!state.modal.open) return;
    if (e.key === "Escape") return closeModal();
    if (e.key === "ArrowLeft") return modalStep(-1);
    if (e.key === "ArrowRight") return modalStep(+1);
    if (e.key === "ArrowUp" && state.feedMode) return groupStep(-1);
    if (e.key === "ArrowDown" && state.feedMode) return groupStep(+1);
  });
}

function showError(err) {
  console.error(err);
  $("#meta").textContent = `加载失败：${String(err?.message || err)}`;
}

bind();
load().catch(showError);



const http = require("http");
const os = require("os");
const path = require("path");

const { createMediaDirStore } = require("./config/mediaDirs");
const { createHandler } = require("./handler");
const { createIndexer } = require("./indexer");
const { scanMedia } = require("./media");

function isPrivateIPv4(ip) {
  if (!ip) return false;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m) {
    const n = Number(m[1]);
    return n >= 16 && n <= 31;
  }
  return false;
}

function ipPrivateScore(ip) {
  if (!ip) return 0;
  if (ip.startsWith("192.168.")) return 300;
  if (ip.startsWith("10.")) return 200;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return 100;
  }
  return 0;
}

function isProbablyVirtualInterface(name) {
  if (!name) return false;
  // Windows 常见虚拟/隧道/抓包接口名称
  return /vEthernet|Default Switch|Hyper-V|WSL|Docker|VMware|VirtualBox|TAP|TUN|Loopback|Bluetooth|Npcap|Meta/i.test(
    name
  );
}

function ifacePreferenceScore(name) {
  if (!name) return 0;
  // 物理网卡/无线网卡通常包含这些关键词
  if (/(wi-?fi|wlan|wireless|无线)/i.test(name)) return 60;
  if (/(ethernet|以太网)/i.test(name)) return 50;
  return 0;
}

function getLanIPv4() {
  // 允许用户手动指定（兜底）
  const forced = (process.env.LAN_HOST || process.env.LAN_IP || "").toString().trim();
  if (forced) return forced;

  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const info of nets[name] || []) {
      if (!info) continue;
      // Node 在不同版本里 family 可能是 'IPv4' 或 4
      const isV4 = info.family === "IPv4" || info.family === 4;
      if (!isV4) continue;
      if (info.internal) continue;
      if (!info.address) continue;
      candidates.push({ name, address: info.address });
    }
  }

  // 优先：私网地址 + 物理网卡名称，排除明显虚拟网卡
  const scored = candidates
    .map((c) => {
      const base = ipPrivateScore(c.address);
      const pref = ifacePreferenceScore(c.name);
      const penalty = isProbablyVirtualInterface(c.name) ? -1000 : 0;
      return { ...c, score: base + pref + penalty };
    })
    .filter((c) => isPrivateIPv4(c.address))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.address || candidates[0]?.address || "";
}

function getArgPort(argv) {
  const args = Array.isArray(argv) ? argv : process.argv;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a) continue;
    if (a === "--port" && args[i + 1]) {
      const n = Number(args[i + 1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const m = /^--port=(\d+)$/.exec(a);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

async function main({ rootDir = __dirname ? path.resolve(__dirname, "..") : process.cwd() } = {}) {
  const root = rootDir;
  const distDir = path.join(root, "dist");
  const configPath = path.join(root, "config.json");
  const argPort = getArgPort(process.argv);
  const port = Number(argPort || process.env.PORT || 3000);

  const mediaStore = createMediaDirStore({ rootDir: root, configPath });
  const indexer = createIndexer({ rootDir: root, mediaStore });

  await mediaStore.loadConfigFromDiskOrEnv();
  if (!mediaStore.getMediaDirs().length) {
    mediaStore.setMediaDirs(mediaStore.getDefaultDirs().map((d) => d.path));
  }

  if (process.argv.includes("--scan")) {
    const existing = await mediaStore.listExistingDirs();
    if (!existing.length) {
      process.stdout.write(
        JSON.stringify(
          {
            ok: false,
            code: "NO_MEDIA_DIR",
            mediaDirs: mediaStore.getMediaDirs().map((d) => d.path),
            defaultMediaDirs: mediaStore.getDefaultDirs().map((d) => d.path),
          },
          null,
          2
        )
      );
      return;
    }

    // 兼容原行为：scan 输出仍然基于全量扫描（不依赖 db）
    const groups = await scanMedia(mediaStore.getMediaDirs());
    const summary = {
      ok: true,
      groupCount: groups.length,
      itemCount: groups.reduce((acc, g) => acc + g.items.length, 0),
      sample: groups.slice(0, 3),
    };
    process.stdout.write(JSON.stringify(summary, null, 2));
    return;
  }

  // A：启动时做一次“增量更新检查”，后续请求直接走 db 查询（大多数情况下很快）
  try {
    await indexer.updateCheck({ force: false });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[indexer] startup updateCheck failed:", String(e?.message || e));
  }

  const handler = createHandler({ publicDir: distDir, mediaStore, indexer, rootDir: root });
  const server = http.createServer((req, res) => {
    handler(req, res).catch((e) => {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Internal Error: ${String(e?.message || e)}`);
    });
  });

  server.listen(port, "0.0.0.0", () => {
    // eslint-disable-next-line no-console
    console.log(`Server running at http://localhost:${port}`);
    console.log(`- UI: http://localhost:${port}/`);
    console.log(`- API: http://localhost:${port}/api/resources`);

    const lan = getLanIPv4();
    if (lan) {
      console.log(`- LAN: http://${lan}:${port}/`);
      console.log(`- LAN API: http://${lan}:${port}/api/resources`);
    }
  });
}

module.exports = { main };



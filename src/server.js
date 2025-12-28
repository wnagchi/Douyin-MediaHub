const http = require("http");
const path = require("path");

const { createMediaDirStore } = require("./config/mediaDirs");
const { createHandler } = require("./handler");
const { scanMedia } = require("./media");

async function main({ rootDir = __dirname ? path.resolve(__dirname, "..") : process.cwd() } = {}) {
  const root = rootDir;
  const distDir = path.join(root, "dist");
  const configPath = path.join(root, "config.json");
  const port = Number(process.env.PORT || 3000);

  const mediaStore = createMediaDirStore({ rootDir: root, configPath });

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

  const handler = createHandler({ publicDir: distDir, mediaStore });
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
  });
}

module.exports = { main };



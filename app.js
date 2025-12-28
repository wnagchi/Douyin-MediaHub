const path = require("path");
const { main } = require("./src/server");

main({ rootDir: path.resolve(__dirname) }).catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exitCode = 1;
});


// lint-staged config. tsc must run as a project check: TypeScript 6 refuses to
// load tsconfig.json when file names are passed (TS5112), so the tsc task
// ignores the staged-file list.
const path = require("path");

const q = (files) => files.map((f) => JSON.stringify(f)).join(" ");
// check-esm guards the k6 runtime code in src/ only (see bin/testing/check-esm.js).
const inSrc = (files) => files.filter((f) => path.relative(__dirname, f).startsWith(`src${path.sep}`));

module.exports = {
  "*.ts": (files) => [
    ...(inSrc(files).length ? [`node bin/testing/check-esm.js --files ${q(inSrc(files))}`] : []),
    "tsc --noEmit",
  ],
  "*": (files) => `node bin/testing/detect-secrets.js --files ${q(files)}`,
};

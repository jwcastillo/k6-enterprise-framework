// lint-staged config. tsc must run as a project check: TypeScript 6 refuses to
// load tsconfig.json when file names are passed (TS5112), so the tsc task
// ignores the staged-file list.
const q = (files) => files.map((f) => JSON.stringify(f)).join(" ");

module.exports = {
  "*.ts": (files) => [`node bin/testing/check-esm.js --files ${q(files)}`, "tsc --noEmit"],
  "*": (files) => `node bin/testing/detect-secrets.js --files ${q(files)}`,
};

// TypeScript 6 refuses `tsc <files>` when a tsconfig.json is present (TS5112), so the
// type check runs on the whole project; the function form stops lint-staged appending files.
module.exports = {
  "*.ts": ["node bin/testing/check-esm.js --files", () => "tsc --noEmit --skipLibCheck"],
  "*": ["node bin/testing/detect-secrets.js --files"],
};

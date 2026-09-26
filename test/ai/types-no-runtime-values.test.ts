/**
 * Declaration files are never emitted, so a runtime value exported from a
 * .d.ts file type-checks and works under vitest but is undefined (or the
 * import fails) after compilation. src/types/*.d.ts must hold types only.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const TYPES_DIR = path.resolve(__dirname, "../../src/types");

describe("src/types declaration files", () => {
  it("export no runtime values", () => {
    const offenders: string[] = [];
    for (const name of fs.readdirSync(TYPES_DIR).filter((n) => n.endsWith(".d.ts"))) {
      const src = fs.readFileSync(path.join(TYPES_DIR, name), "utf-8");
      for (const m of src.matchAll(/^export\s+(?:const|let|var|function|class|enum)\s+\w+/gm)) {
        offenders.push(`${name}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

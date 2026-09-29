/**
 * Regresion de la trampa de `set -e` en bin/run-test.sh.
 *
 * Con `set -euo pipefail`, `VAR=$(cmd)` seguido de `rc=$?` en la linea siguiente
 * nunca llega a leer el codigo: si cmd falla, el script muere en la asignacion y
 * el manejo de error de abajo no corre. El patron seguro es
 * `VAR=$(cmd) && rc=0 || rc=$?`. Este test falla si vuelve a aparecer la forma rota.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPT = join(__dirname, "..", "..", "bin", "run-test.sh");

function unguardedCaptures(source: string): string[] {
  const lines = source.split("\n");
  const hits: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!/^\s*(local\s+)?[A-Za-z_][A-Za-z0-9_]*=\$\?\s*$/.test(lines[i])) continue;
    let j = i - 1;
    while (j >= 0 && lines[j].trim() === "") j--;
    // La linea anterior cierra una sustitucion de comando: `...)` o `... 2>&1)`.
    if (j >= 0 && /\)\s*$/.test(lines[j]) && !/\|\|/.test(lines[j])) {
      hits.push(`${i + 1}: ${lines[i].trim()}`);
    }
  }
  return hits;
}

describe("bin/run-test.sh — trampa de set -e", () => {
  it("ninguna captura de $? queda despues de una sustitucion de comando sin proteger", () => {
    expect(unguardedCaptures(readFileSync(SCRIPT, "utf8"))).toEqual([]);
  });

  it("detecta la forma rota (mutacion)", () => {
    const broken = 'set -euo pipefail\nOUT=$(false 2>&1)\nRC=$?\n';
    expect(unguardedCaptures(broken)).toEqual(["3: RC=$?"]);
  });
});

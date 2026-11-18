/**
 * M3-06 / G6-06 — garde : aucune devise écrite en dur (« DH », « MAD ») dans tout le client.
 * Les montants passent par money() / currencySymbol() (utils/money.ts), qui lisent la devise
 * de la société ; un code ISO de logique passe par BASE_CURRENCY (api/currencies.api.ts).
 * Les commentaires sont ignorés. Seule exception : la définition de BASE_CURRENCY.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DIRS = [fileURLToPath(new URL('../..', import.meta.url))]; // client/src
/** Exceptions justifiées : fichier relatif à client/src → motif de la ligne autorisée. */
const ALLOWED: Record<string, RegExp> = {
  'api/currencies.api.ts': /export const BASE_CURRENCY = 'MAD';/, // code ISO de la devise de base, source unique
};
const HARD = /(?<![A-Za-z0-9_])(DH|MAD)(?![A-Za-z0-9_])/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.(tsx?|jsx?)$/.test(e.name) && !e.name.endsWith('.test.ts') ? [join(dir, e.name)] : []);
}

describe('Garde : devise en dur (M3-06, G6-06)', () => {
  it('aucun « DH » ni « MAD » en dur dans le client', () => {
    const hits: string[] = [];
    for (const f of DIRS.flatMap(files)) {
      let inBlock = false;
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const t = line.trim();
        if (inBlock) { if (t.includes('*/')) inBlock = false; return; }
        if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return; }
        if (t.startsWith('//') || t.startsWith('*')) return;
        const code = line.replace(/\/\/.*$/, '').replace(/\{\s*\/\*.*?\*\/\s*\}/g, '');
        const rel = f.slice(DIRS[0].length).replace(/^\//, '');
        if (HARD.test(code) && !ALLOWED[rel]?.test(line)) hits.push(`${rel}:${i + 1}: ${t.slice(0, 100)}`);
      });
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });
});

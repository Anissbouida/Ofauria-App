/**
 * M3-06 — garde : aucune devise écrite en dur (« DH », « MAD ») dans le module Production.
 * Les montants passent par money() / currencySymbol() (utils/money.ts), qui lisent la devise
 * de la société. Les commentaires sont ignorés. Étendre DIRS au fil des modules convertis.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DIRS = [fileURLToPath(new URL('.', import.meta.url))];
const HARD = /(?<![A-Za-z0-9_])(DH|MAD)(?![A-Za-z0-9_])/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.(tsx?|jsx?)$/.test(e.name) && !e.name.endsWith('.test.ts') ? [join(dir, e.name)] : []);
}

describe('Garde : devise en dur (M3-06)', () => {
  it('aucun « DH » ni « MAD » en dur dans le module Production', () => {
    const hits: string[] = [];
    for (const f of DIRS.flatMap(files)) {
      let inBlock = false;
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const t = line.trim();
        if (inBlock) { if (t.includes('*/')) inBlock = false; return; }
        if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return; }
        if (t.startsWith('//') || t.startsWith('*')) return;
        const code = line.replace(/\/\/.*$/, '').replace(/\{\s*\/\*.*?\*\/\s*\}/g, '');
        if (HARD.test(code)) hits.push(`${f.split('/features/')[1]}:${i + 1}: ${t.slice(0, 100)}`);
      });
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });
});

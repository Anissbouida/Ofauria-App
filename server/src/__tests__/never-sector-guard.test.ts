/**
 * C-07 — garde « le code ne lit jamais le secteur » (règle 2 ter.7.1 du plan).
 * Le code lit une option (featureOn / hasFeature), une politique (resolvePolicy) ou un attribut
 * du type d'ordre ; jamais le code du secteur. Ce test parcourt server/src, client/src et
 * shared/src et échoue sur toute comparaison à un code de secteur.
 * Liste d'exceptions vide au départ : chaque ajout se justifie par écrit ici.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const ROOT = resolve(__dirname, '../../..');
const DIRS = ['server/src', 'client/src', 'shared/src'];
/** Fichiers de configuration autorisés à nommer un secteur (données, pas décisions). */
const ALLOWED: Record<string, string> = {};

const CODES = 'boulangerie|generique|negoce|process|discret|atelier';
const PATTERNS: RegExp[] = [
  new RegExp(`(===|!==|==|!=)\\s*['"\`](${CODES})['"\`]`),
  new RegExp(`['"\`](${CODES})['"\`]\\s*(===|!==|==|!=)`),
  new RegExp(`case\\s+['"\`](${CODES})['"\`]\\s*:`),
  new RegExp(`\\.includes\\(\\s*['"\`](${CODES})['"\`]\\s*\\)`),
  // « fabrication » est aussi un usage de nomenclature (recipes.usage) : visé seulement avec « sector ».
  /sector\w*\s*(===|!==|==|!=)\s*['"`]fabrication['"`]|['"`]fabrication['"`]\s*(===|!==)\s*\w*sector/i,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('Garde : jamais le code du secteur (C-07)', () => {
  it('aucune comparaison à un code de secteur dans le code', () => {
    const hits: string[] = [];
    for (const d of DIRS) {
      for (const file of walk(join(ROOT, d))) {
        const rel = relative(ROOT, file);
        if (ALLOWED[rel]) continue;
        readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
          if (PATTERNS.some(re => re.test(line))) hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
        });
      }
    }
    expect(hits, `Lire une option, une politique ou le type d'ordre plutôt que le secteur :\n${hits.join('\n')}`).toEqual([]);
  });

  it('le motif attrape bien une comparaison (contrôle du garde lui-même)', () => {
    const sample = ["if (sector.code === 'boulangerie') {", "case 'negoce':", "if (packs.includes('process'))", "if (sectorCode !== 'fabrication')"];
    expect(sample.every(l => PATTERNS.some(re => re.test(l)))).toBe(true);
    expect(PATTERNS.some(re => re.test("if (opts.usage !== 'fabrication')"))).toBe(false);
  });
});

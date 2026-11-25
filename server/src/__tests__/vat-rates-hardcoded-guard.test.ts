/**
 * Plan d'action compta, étape 4 (audit C-02) — garde « taux de TVA en dur » côté serveur.
 * Les taux légaux viennent du pack pays daté (`countryParam('fiscalite.vat_rates', date)`) et le
 * compte d'un taux de la table unique du générateur d'écritures (`tvaAccountForRate`). Ignorés :
 * commentaires, tests, scripts de reprise. Chaque exception se justifie ici.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const SRC = resolve(__dirname, '..');
/** Tableau littéral d'au moins deux taux de TVA (7, 10, 14, 20). */
const RATE_LIST = /\[\s*(?:7|10|14|20)\s*(?:,\s*(?:7|10|14|20)\s*)+\]/;
/** Comptes de TVA par taux (sous-comptes 4455x / 3455x). */
const VAT_ACCOUNT = /['"](?:4455[1-4]|3455[2-5])['"]/;

/** Fichier (relatif à server/src) → motif de la ligne autorisée. */
const ALLOWED_RATE_LIST: Record<string, RegExp> = {
  // Valeur intégrée de repli quand la base est indisponible ; la valeur en vigueur vient de la table datée.
  'services/country-pack.ts': /'fiscalite\.vat_rates': \[10, 20\]/,
};
const ALLOWED_VAT_ACCOUNT: Record<string, RegExp> = {
  // La table taux → compte est celle du générateur.
  'services/journal-generator.service.ts': /./,
  // Escompte d'effets : TVA sur commissions bancaires, au taux normal, sans lien avec le taux d'une pièce.
  'repositories/bill-portfolio.repository.ts': /34552/,
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'scripts' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}

function scan(pattern: RegExp, allowed: Record<string, RegExp>): string[] {
  const hits: string[] = [];
  for (const f of walk(SRC)) {
    const rel = relative(SRC, f);
    let inBlock = false;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const t = line.trim();
      if (inBlock) { if (t.includes('*/')) inBlock = false; return; }
      if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return; }
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('--')) return;
      const code = line.replace(/\s\/\/.*$/, '');
      if (pattern.test(code) && !allowed[rel]?.test(line)) hits.push(`${rel}:${i + 1}: ${t.slice(0, 110)}`);
    });
  }
  return hits;
}

describe('Garde : taux de TVA en dur côté serveur (plan compta, étape 4)', () => {
  it('aucune liste littérale de taux de TVA hors de la valeur de repli du pack pays', () => {
    const hits = scan(RATE_LIST, ALLOWED_RATE_LIST);
    expect(hits, hits.join('\n')).toEqual([]);
  });
  it('aucun compte de TVA par taux écrit hors de la table du générateur d\'écritures', () => {
    const hits = scan(VAT_ACCOUNT, ALLOWED_VAT_ACCOUNT);
    expect(hits, hits.join('\n')).toEqual([]);
  });
});

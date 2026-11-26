/**
 * G6-06 — garde « devise en dur » côté serveur (pendant de client/src/features/production/
 * no-hardcoded-currency.test.ts). Documents, tickets, messages d'erreur et e-mails prennent la
 * devise de la société : currencySymbol() / baseCurrencyCode() (services/currency.ts), en SQL
 * fn_base_currency() (mig 592), dans un catalogue le signe générique « ¤ » (withCurrency).
 * Ignorés : commentaires (//, *, -- SQL), tests, scripts ponctuels de reprise (scripts/, sorties console).
 * Chaque exception se justifie ici.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const SRC = resolve(__dirname, '..');
const HARD = /(?<![A-Za-z0-9_])(DH|MAD)(?![A-Za-z0-9_])/;
/** Fichier (relatif à server/src) → motif de la ligne autorisée. */
const ALLOWED: Record<string, RegExp> = {
  // Table des mots de chaque devise, indexée par code ISO (montant en lettres).
  'services/invoice-pdf.service.ts': /^\s*MAD: \['dirhams', 'centimes'\]/,
  // Montant en lettres des documents RH : mots de chaque devise, indexés par code ISO.
  'services/hr-documents-pdf.service.ts': /MAD: \['dirham', 'centime'\]/,
  // Lecture de relevés bancaires : retire le suffixe de devise écrit par la banque.
  'services/bank-statement-import.service.ts': /\(MAD\|DH\|DHS\|EUR\|€\)/,
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

describe('Garde : devise en dur côté serveur (G6-06)', () => {
  it('aucun « DH » ni « MAD » en dur dans server/src', () => {
    const hits: string[] = [];
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f);
      let inBlock = false;
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const t = line.trim();
        if (inBlock) { if (t.includes('*/')) inBlock = false; return; }
        if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return; }
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('--')) return;
        const code = line.replace(/\s\/\/.*$/, '').replace(/\s--\s.*$/, '');
        if (HARD.test(code) && !ALLOWED[rel]?.test(line)) hits.push(`${rel}:${i + 1}: ${t.slice(0, 110)}`);
      });
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });
});

/**
 * G3-07 (plan d'action 2026-11) — garde : pas de nouveau SQL hors de la couche de données.
 *
 * Les requêtes SQL appartiennent aux dépôts de données (src/repositories/). À la date de
 * cette tâche, des contrôleurs et des fichiers de routes en contiennent encore : leur
 * nombre par fichier est inscrit dans fixtures/sql-outside-repositories.json.
 * Ce nombre ne peut que DIMINUER :
 *  - un fichier qui gagne une requête, ou un nouveau fichier qui en contient, fait
 *    échouer le test : la requête va dans un dépôt de données ;
 *  - un fichier qui en perd doit voir son compteur baissé (ou sa ligne retirée), pour
 *    que le gain soit acquis.
 * Régénérer après un nettoyage :
 *   SQL_GUARD_WRITE=1 npx vitest run src/__tests__/sql-outside-repositories-guard.test.ts
 *
 * Analogie Oracle : c'est la règle « pas de SQL dans les triggers d'écran Forms, tout
 * passe par les packages » — vérifiée ici à chaque intégration continue.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/sql-outside-repositories.json', import.meta.url));
/** Appel SQL direct : db.query(, client.query(, pool.query(, db.getClient(. */
const SQL_CALL = /\b(?:db|client|pool)\.query\(|\bdb\.getClient\(/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : name.endsWith('.ts') ? [full] : [];
  });
}

function scan(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const folder of ['controllers', 'routes']) {
    for (const file of walk(path.join(SRC, folder)).sort()) {
      const n = (readFileSync(file, 'utf8').match(SQL_CALL) ?? []).length;
      if (n > 0) out[path.relative(SRC, file)] = n;
    }
  }
  return out;
}

describe('Garde : SQL hors de la couche de données (G3-07)', () => {
  const actual = scan();
  if (process.env.SQL_GUARD_WRITE === '1') writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`);
  const allowed: Record<string, number> = JSON.parse(readFileSync(FIXTURE, 'utf8'));

  it('l\'analyse voit bien les fichiers', () => {
    expect(Object.keys(actual).length).toBeGreaterThan(10);
  });

  it('aucune nouvelle requête SQL dans un contrôleur ou un fichier de routes', () => {
    const grown = Object.entries(actual)
      .filter(([file, n]) => n > (allowed[file] ?? 0))
      .map(([file, n]) => `${file} : ${n} requête(s), ${allowed[file] ?? 0} tolérée(s)`);
    expect(grown, `Requête(s) SQL ajoutée(s) hors de src/repositories/ — à déplacer dans un dépôt de données :\n${grown.join('\n')}`).toEqual([]);
  });

  it('la liste des exceptions est à jour (elle ne peut que rétrécir)', () => {
    const stale = Object.entries(allowed)
      .filter(([file, n]) => (actual[file] ?? 0) < n)
      .map(([file, n]) => `${file} : ${actual[file] ?? 0} requête(s) restante(s), ${n} inscrite(s)`);
    expect(stale, `Compteur(s) à baisser dans fixtures/sql-outside-repositories.json :\n${stale.join('\n')}`).toEqual([]);
  });
});

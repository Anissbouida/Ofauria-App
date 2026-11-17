/**
 * G3-05 (plan d'action 2026-11) — numérotation des migrations.
 *
 * Le lanceur (src/config/migrate.ts) refuse déjà, à l'exécution, un nouveau numéro en
 * double. Ce test le signale plus tôt, sans base de données :
 *  - chaque fichier s'appelle NNN_nom_en_minuscules.sql ;
 *  - aucun numéro n'est partagé, hors les six doublons historiques déjà en production
 *    (liste close, identique à celle du lanceur) ;
 *  - la liste des doublons historiques ne contient que des doublons réels.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));
const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
const LEGACY = ['051', '264', '265', '426', '427', '428'];

describe('Numérotation des migrations (G3-05)', () => {
  it('le dossier est bien lu', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it('chaque fichier s\'appelle NNN_nom.sql', () => {
    const bad = files.filter(f => !/^\d{3}_[a-z0-9_]+\.sql$/.test(f));
    expect(bad, `Nom(s) de migration non conforme(s) :\n${bad.join('\n')}`).toEqual([]);
  });

  it('aucun nouveau numéro en double', () => {
    const byPrefix = new Map<string, string[]>();
    for (const f of files) {
      const p = f.slice(0, 3);
      byPrefix.set(p, [...(byPrefix.get(p) ?? []), f]);
    }
    const dupes = [...byPrefix.entries()].filter(([, g]) => g.length > 1);
    const added = dupes.filter(([p]) => !LEGACY.includes(p)).map(([p, g]) => `${p} : ${g.join(', ')}`);
    expect(added, `Numéro(s) de migration en double — renuméroter la plus récente :\n${added.join('\n')}`).toEqual([]);
    // La liste des doublons tolérés reste exacte et identique à celle du lanceur.
    expect(dupes.map(([p]) => p).sort()).toEqual(LEGACY);
    const runner = readFileSync(fileURLToPath(new URL('../config/migrate.ts', import.meta.url)), 'utf8');
    for (const p of LEGACY) expect(runner).toContain(`'${p}'`);
  });
});

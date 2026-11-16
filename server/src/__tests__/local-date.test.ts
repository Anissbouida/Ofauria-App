/**
 * G0-28 — date civile d'une colonne DATE, sans passer par UTC.
 * node-pg rend la date à minuit heure locale ; à l'est de Greenwich, toISOString() la
 * reculait d'un jour. Vérifié sur Africa/Casablanca, Europe/Paris et Asia/Tokyo.
 * (Selon la version des données de fuseaux de Node, Casablanca vaut UTC+0 ou UTC+1 :
 * le défaut est démontré sur Paris, le résultat attendu vérifié partout.)
 */
import { describe, it, expect, afterAll } from 'vitest';
import { localIsoDate } from '../utils/local-date.js';

describe('localIsoDate (G0-28)', () => {
  const previous = process.env.TZ;
  afterAll(() => { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; });

  it.each(['Africa/Casablanca', 'Europe/Paris', 'Asia/Tokyo', 'America/New_York'])(
    'fuseau %s : minuit local du 15 mars reste le 15 mars', (tz) => {
      process.env.TZ = tz;
      expect(localIsoDate(new Date(2027, 2, 15))).toBe('2027-03-15');      // ce que node-pg rend pour DATE '2027-03-15'
      expect(localIsoDate(new Date(2027, 0, 1))).toBe('2027-01-01');       // pas de glissement d'année
      expect(localIsoDate(new Date(2027, 11, 31))).toBe('2027-12-31');
    });

  it('le défaut corrigé : à l\'est de Greenwich, toISOString() rendait la veille', () => {
    process.env.TZ = 'Europe/Paris';
    const dueOn = new Date(2027, 2, 15);
    expect(dueOn.toISOString().slice(0, 10)).toBe('2027-03-14');
    expect(localIsoDate(dueOn)).toBe('2027-03-15');
  });

  it('une chaîne est rendue telle quelle (date seule)', () => {
    expect(localIsoDate('2027-03-15')).toBe('2027-03-15');
    expect(localIsoDate('2027-03-15T00:00:00.000Z')).toBe('2027-03-15');
  });
});

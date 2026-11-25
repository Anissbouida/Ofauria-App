/**
 * Plan d'action compta, étape 3 (audit C-02) : la TVA d'un ticket est écrite UNE LIGNE PAR TAUX
 * (et non plus au taux moyen), le total reste celui de l'en-tête du ticket.
 */
import { describe, it, expect, beforeAll } from 'vitest';

type Fake = { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ tax_rate: string; tva: string }> }> };
const clientWith = (rows: Array<{ tax_rate: string; tva: string }>): Fake => ({ query: async () => ({ rows }) });

describe('saleTvaLines : TVA collectée d\'un ticket par taux', () => {
  let saleTvaLines: typeof import('../services/journal-generator.service.js').saleTvaLines;
  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/kalum_test';
    ({ saleTvaLines } = await import('../services/journal-generator.service.js'));
  });
  const sum = (l: Array<{ credit: number }>) => Math.round(l.reduce((t, x) => t + x.credit, 0) * 100) / 100;

  it('ticket à 20 % et 10 % : une ligne par taux, sur le compte de chaque taux', async () => {
    const lines = await saleTvaLines(clientWith([{ tax_rate: '10', tva: '10.00' }, { tax_rate: '20', tva: '40.00' }]) as never, 's1', 50, 250);
    expect(lines).toHaveLength(2);
    expect(lines.find(l => l.account_code === '44551')?.credit).toBe(40);
    expect(lines.find(l => l.account_code === '44553')?.credit).toBe(10);
    expect(sum(lines)).toBe(50);
    expect(lines.every(l => l.debit === 0)).toBe(true);
  });

  it('le centime d\'écart avec l\'en-tête est porté par le taux le plus élevé, le total reste celui de l\'en-tête', async () => {
    const lines = await saleTvaLines(clientWith([{ tax_rate: '10', tva: '3.33' }, { tax_rate: '20', tva: '6.66' }]) as never, 's1', 10, 50);
    expect(sum(lines)).toBe(10);
    expect(lines.find(l => l.account_code === '44551')?.credit).toBe(6.67);
    expect(lines.find(l => l.account_code === '44553')?.credit).toBe(3.33);
  });

  it('détail qui s\'écarte de plus de 5 centimes de l\'en-tête : retombe sur le taux moyen, total inchangé', async () => {
    const lines = await saleTvaLines(clientWith([{ tax_rate: '20', tva: '5.00' }]) as never, 's1', 20, 100);
    expect(lines).toHaveLength(1);
    expect(lines[0].credit).toBe(20);
    expect(lines[0].account_code).toBe('44551');
  });

  it('ticket sans détail par taux : une seule ligne au taux moyen', async () => {
    const lines = await saleTvaLines(clientWith([]) as never, 's1', 10, 100);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ account_code: '44553', credit: 10 });
  });

  it('un taux sans compte propre reste visible : compte générique 4455, jamais perdu', async () => {
    const lines = await saleTvaLines(clientWith([{ tax_rate: '5.5', tva: '5.50' }]) as never, 's1', 5.5, 100);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ account_code: '4455', credit: 5.5 });
  });
});

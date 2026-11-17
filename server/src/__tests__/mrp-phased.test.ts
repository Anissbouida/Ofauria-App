/**
 * G5-04 — calcul des besoins phasé (services/mrp-phased.ts, planPhased).
 * Scénario à deux niveaux avec délais : un produit P (fabriqué le jour même) demandé à
 * J+5 (10 pièces) contient 0,5 d'une base B (fabriquée la veille), qui contient 2 kg
 * d'un ingrédient I (acheté 3 jours avant, par sacs de 5 kg). Les propositions tombent
 * aux bonnes dates ; un besoin dans le délai est signalé en retard ; une réception
 * prévue trop tôt doit être retardée, une réception sans besoin annulée.
 */
import { describe, it, expect } from 'vitest';

process.env.JWT_SECRET ||= 'test-secret-0123456789abcdef0123456789abcdef';

const days = Array.from({ length: 8 }, (_, i) => `2031-05-0${i + 1}`);
const item = (over: Record<string, unknown>) => ({ onHand: 0, safety: 0, leadDays: 0, lotMin: 0, lotMultiple: 0, bom: [], unit: 'u', ...over });

describe('Calcul des besoins phasé (G5-04)', async () => {
  const { planPhased, lotSize } = await import('../services/mrp-phased.js');
  const base = () => ({
    days,
    items: [
      item({ key: 'p:P', kind: 'product', id: 'P', name: 'Produit P', bom: [{ child: 'b:B', qty: 0.5 }] }),
      item({ key: 'b:B', kind: 'base', id: 'B', name: 'Base B', leadDays: 1, bom: [{ child: 'i:I', qty: 2 }] }),
      item({ key: 'i:I', kind: 'ingredient', id: 'I', name: 'Ingrédient I', leadDays: 3, lotMultiple: 5 }),
    ] as never,
    demand: { 'p:P': { '2031-05-06': 10 } } as Record<string, Record<string, number>>,
    receipts: [] as { key: string; date: string; qty: number; ref: string }[],
  });

  it('règle de lot : minimum puis multiple', () => {
    expect(lotSize(3, 0, 5)).toBe(5);
    expect(lotSize(3, 8, 5)).toBe(10);
    expect(lotSize(12, 0, 0)).toBe(12);
  });

  it('les propositions tombent aux bonnes dates, niveau par niveau', () => {
    const r = planPhased(base());
    const by = Object.fromEntries(r.proposals.map(p => [p.key, p]));
    expect(by['p:P']).toMatchObject({ qty: 10, needDate: '2031-05-06', releaseDate: '2031-05-06', late: false });
    expect(by['b:B']).toMatchObject({ qty: 5, needDate: '2031-05-06', releaseDate: '2031-05-05', late: false });
    // B lancée le 05 → besoin de 10 kg d'I le 05, commandé 3 jours avant, par sacs de 5.
    expect(by['i:I']).toMatchObject({ qty: 10, needDate: '2031-05-05', releaseDate: '2031-05-02', late: false });
    const iRow = r.items.find(i => i.key === 'i:I')!;
    expect(iRow.days.find(d => d.date === '2031-05-05')).toMatchObject({ gross: 10, planned: 10, projected: 0 });
  });

  it('besoin dans le délai : lancement au premier jour, signalé en retard', () => {
    const inp = base();
    inp.demand = { 'p:P': { '2031-05-02': 10 } };
    const i = planPhased(inp).proposals.find(p => p.key === 'i:I')!;
    expect(i).toMatchObject({ releaseDate: '2031-05-01', late: true });
  });

  it('le stock et les réceptions prévues sont défalqués', () => {
    const inp = base();
    (inp.items as Array<{ key: string; onHand: number }>).find(x => x.key === 'b:B')!.onHand = 2;
    const r = planPhased(inp);
    expect(r.proposals.find(p => p.key === 'b:B')!.qty).toBe(3);
    expect(r.proposals.find(p => p.key === 'i:I')!.qty).toBe(10); // 6 kg arrondis à 10
  });

  it('messages d\'action : retarder une réception trop tôt, annuler une réception sans besoin', () => {
    const inp = base();
    inp.receipts = [{ key: 'i:I', date: '2031-05-01', qty: 10, ref: 'BC-1' }, { key: 'i:I', date: '2031-05-07', qty: 5, ref: 'BC-2' }];
    const r = planPhased(inp);
    const m = Object.fromEntries(r.messages.map(x => [x.ref, x]));
    expect(m['BC-1']).toMatchObject({ action: 'retarder', newDate: '2031-05-05' });
    expect(m['BC-2']).toMatchObject({ action: 'annuler' });
    // La réception couvre le besoin : plus de proposition d'achat.
    expect(r.proposals.find(p => p.key === 'i:I')).toBeUndefined();
  });
});

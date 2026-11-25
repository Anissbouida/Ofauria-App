import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/module-parameters.service.js', () => ({ getParameter: vi.fn() }));
vi.mock('../config/database.js', () => ({ db: { query: vi.fn() } }));
import { getParameter } from '../services/module-parameters.service.js';
import { demandSource, demandTerms, productionFlow, lowStockAlertsEnabled, salesChannel, channelHomeRoute, asRhythm, RHYTHM_PRESETS, stockOrganization } from '../services/operating-rules.js';

describe('Réglages du modèle opérationnel (mig 692)', () => {
  beforeEach(() => vi.mocked(getParameter).mockReset());

  it('sans réglage : comportement d’avant (prévision + commandes, parcours inchangé, alertes actives)', async () => {
    vi.mocked(getParameter).mockResolvedValue(undefined as never);
    expect(await demandSource()).toBe('both');
    expect(await demandTerms()).toEqual({ forecast: true, orders: true });
    expect(await productionFlow()).toEqual({ recipe_required: false, material_issue_required: true, quality_before_transfer: true, transfer_reception: true });
    expect(await lowStockAlertsEnabled()).toBe(true);
  });

  it('déclenchement à la commande : la prévision est exclue ; sur stock : les commandes', async () => {
    vi.mocked(getParameter).mockResolvedValue({ mode: 'orders' } as never);
    expect(await demandTerms()).toEqual({ forecast: false, orders: true });
    vi.mocked(getParameter).mockResolvedValue({ mode: 'forecast' } as never);
    expect(await demandTerms()).toEqual({ forecast: true, orders: false });
    vi.mocked(getParameter).mockResolvedValue({ mode: 'inconnu' } as never);
    expect(await demandSource()).toBe('both');
  });

  it('parcours et alertes suivent les valeurs enregistrées', async () => {
    vi.mocked(getParameter).mockResolvedValue({ recipe_required: true, material_issue_required: false, quality_before_transfer: false, transfer_reception: false } as never);
    expect(await productionFlow()).toEqual({ recipe_required: true, material_issue_required: false, quality_before_transfer: false, transfer_reception: false });
    vi.mocked(getParameter).mockResolvedValue({ enabled: false } as never);
    expect(await lowStockAlertsEnabled()).toBe(false);
  });

  it('canal de vente : accueil imposé (caisse, ventes, commandes) ou celui du secteur', async () => {
    vi.mocked(getParameter).mockResolvedValue({ channel: 'retail' } as never);
    expect(channelHomeRoute(await salesChannel())).toBe('/pos');
    expect(channelHomeRoute('wholesale')).toBe('/sales');
    expect(channelHomeRoute('direct')).toBe('/orders');
    vi.mocked(getParameter).mockResolvedValue(undefined as never);
    expect(await salesChannel()).toBe('multi');
    expect(channelHomeRoute('multi')).toBeNull();
  });

  it('rythme et organisation du stock : valeurs reconnues, défauts neutres', async () => {
    expect(asRhythm('industrial')).toBe('industrial');
    expect(asRhythm('autre')).toBeNull();
    expect(RHYTHM_PRESETS.artisanal.mrp_horizon_days).toBeLessThan(RHYTHM_PRESETS.industrial.mrp_horizon_days);
    vi.mocked(getParameter).mockResolvedValue(undefined as never);
    expect(await stockOrganization()).toBe('per_store');
    vi.mocked(getParameter).mockResolvedValue({ mode: 'central' } as never);
    expect(await stockOrganization()).toBe('central');
  });
});

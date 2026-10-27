import { describe, it, expect, vi } from 'vitest';

// Le service importe la base : on la neutralise (fonctions pures testées ici).
vi.mock('../config/database.js', () => ({ db: { query: vi.fn() } }));
const { coerce, mergeValues, codeFromLabel } = await import('../services/custom-fields.js');
type Def = Parameters<typeof coerce>[0];

const def = (over: Partial<Def>): Def => ({
  id: 'x', entity: 'customer', code: 'c', label: 'Champ', field_type: 'text', options: [], required: false,
  show_in_list: false, help: null, display_order: 0, is_active: true, ...over,
});

describe('codeFromLabel', () => {
  it('produit un code ASCII en minuscules', () => {
    expect(codeFromLabel('N° d\'immatriculation')).toBe('n_d_immatriculation');
    expect(codeFromLabel('Taille / Couleur')).toBe('taille_couleur');
    expect(codeFromLabel('2e contact')).toBe('c_2e_contact');
  });
});

describe('coerce', () => {
  it('nombre : virgule et espaces acceptés', () => {
    expect(coerce(def({ field_type: 'number' }), '1 250,5').value).toBe(1250.5);
    expect(coerce(def({ field_type: 'number' }), 'abc').error).toBeTruthy();
  });
  it('date : JJ/MM/AAAA ou ISO, date impossible refusée', () => {
    expect(coerce(def({ field_type: 'date' }), '05/11/2026').value).toBe('2026-11-05');
    expect(coerce(def({ field_type: 'date' }), '2026-11-05').value).toBe('2026-11-05');
    expect(coerce(def({ field_type: 'date' }), '31/02/2026').error).toBeTruthy();
  });
  it('liste : insensible à la casse, renvoie la valeur de référence', () => {
    const d = def({ field_type: 'select', options: ['Rouge', 'Bleu'] });
    expect(coerce(d, 'rouge').value).toBe('Rouge');
    expect(coerce(d, 'vert').error).toContain('Rouge');
  });
  it('case à cocher : oui / non', () => {
    expect(coerce(def({ field_type: 'boolean' }), 'Oui').value).toBe(true);
    expect(coerce(def({ field_type: 'boolean' }), 'non').value).toBe(false);
    expect(coerce(def({ field_type: 'boolean' }), 'peut-être').error).toBeTruthy();
  });
  it('vide = null', () => {
    expect(coerce(def({}), '  ').value).toBeNull();
  });
});

describe('mergeValues', () => {
  const defs = [
    def({ code: 'immat', label: 'Immatriculation', required: true }),
    def({ code: 'poids', label: 'Poids', field_type: 'number' }),
    def({ code: 'ancien', label: 'Ancien', is_active: false }),
  ];
  it('fusionne, efface les vides et garde les valeurs des champs désactivés', () => {
    const r = mergeValues(defs, { immat: '12-A-3', poids: 3, ancien: 'x' }, { poids: '' });
    expect(r.errors).toEqual({});
    expect(r.values).toEqual({ immat: '12-A-3', ancien: 'x' });
  });
  it('signale un champ obligatoire manquant et une valeur invalide', () => {
    const r = mergeValues(defs, {}, { poids: 'lourd' });
    expect(Object.keys(r.errors).sort()).toEqual(['immat', 'poids']);
  });
});

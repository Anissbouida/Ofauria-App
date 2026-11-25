import { describe, it, expect } from 'vitest';
import { diffProfileContents } from '../repositories/sector-version.repository.js';

describe('Comparaison de versions de profil (lot 14)', () => {
  it('signale modules, champs et termes modifiés, rien sinon', () => {
    const a = { label: 'Boulangerie', enabled_modules: ['pos', 'stock'], features: ['lots'], status: 'a_valider', labels: { recipe: 'Fiche', product: 'Produit' } };
    const b = { label: 'Boulangerie', enabled_modules: ['pos', 'stock', 'production'], features: [], status: 'disponible', labels: { recipe: 'Fiche technique', product: 'Produit' } };
    expect(diffProfileContents(a, b)).toEqual([
      { field: 'Modules', kind: 'list', added: ['production'], removed: [] },
      { field: 'Capacités', kind: 'list', added: [], removed: ['lots'] },
      { field: 'État', kind: 'value', before: 'a_valider', after: 'disponible' },
      { field: 'Terme « recipe »', kind: 'label', before: 'Fiche', after: 'Fiche technique' },
    ]);
    expect(diffProfileContents(a, a)).toEqual([]);
  });
});

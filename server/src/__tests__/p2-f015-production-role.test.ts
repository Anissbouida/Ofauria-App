/**
 * F-015 — Garde role <-> categorie a la creation d'un plan de production.
 *
 * Un chef ne peut pas creer un plan pour un produit relevant d'un AUTRE atelier
 * (ex. le patissier pour une baguette). La regle appliquee par le controleur :
 * on rejette seulement si la categorie du produit est rattachee a un role chef
 * DIFFERENT ; les produits sans categorie / 'general' restent permis.
 *
 * Ce test verrouille cette regle de decision (getCategoryRole + CHEF_ROLES).
 */
import { describe, it, expect } from 'vitest';
import { getCategoryRole } from '@ofauria/shared';

const CHEF_ROLES = ['baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'];

/** Reproduit la decision du controleur : le produit releve-t-il d'un autre atelier ? */
const isForeign = (slug: string, userRole: string) => {
  const catRole = getCategoryRole(slug);
  return CHEF_ROLES.includes(catRole) && catRole !== userRole;
};

describe('F-015 — plan de production : chef vs categorie produit', () => {
  it('le patissier ne peut pas planifier une baguette (atelier boulanger)', () => {
    expect(isForeign('baguette', 'pastry_chef')).toBe(true);
  });

  it('le boulanger ne peut pas planifier une viennoiserie', () => {
    expect(isForeign('viennoiseries', 'baker')).toBe(true);
  });

  it('le patissier peut planifier ses propres categories', () => {
    expect(isForeign('entremets', 'pastry_chef')).toBe(false);
    expect(isForeign('cake-et-muffins', 'pastry_chef')).toBe(false);
    expect(isForeign('patisserie-classique', 'pastry_chef')).toBe(false);
  });

  it('un produit sans categorie (general) ne bloque aucun chef', () => {
    expect(isForeign('', 'pastry_chef')).toBe(false);
    expect(isForeign('inconnu-xyz', 'baker')).toBe(false);
  });

  it('beldi_sale et boulanger : ateliers distincts', () => {
    expect(isForeign('beldi', 'baker')).toBe(true);
    expect(isForeign('baguette', 'beldi_sale')).toBe(true);
  });
});

import { db } from '../config/database.js';

/**
 * Données de départ par secteur (phase 9.3).
 *
 * Le point clé : ces données ne sont PAS dans les migrations (sinon toute société neuve
 * recevrait les recettes de croissants). Elles vivent ici, en code, et se chargent À LA
 * DEMANDE pour le secteur choisi. Une société « Générique » ne reçoit que des catégories
 * transverses ; la boulangerie ne charge rien (son référentiel existe déjà). Le chargement
 * est idempotent (par slug).
 */

type StarterCategory = { name: string; slug: string };

const STARTER: Record<string, { categories: StarterCategory[] }> = {
  boulangerie: { categories: [] },
  generique: {
    categories: [
      { name: 'Marchandises', slug: 'starter-marchandises' },
      { name: 'Services', slug: 'starter-services' },
      { name: 'Divers', slug: 'starter-divers' },
    ],
  },
  negoce: {
    categories: [
      { name: 'Marchandises', slug: 'starter-marchandises' },
      { name: 'Accessoires', slug: 'starter-accessoires' },
    ],
  },
};

export async function loadSectorStarter(sectorCode: string, _userId?: string): Promise<{ categories: number }> {
  const pack = STARTER[sectorCode] ?? { categories: [] };
  let created = 0;
  for (const c of pack.categories) {
    const r = await db.query(
      `INSERT INTO categories (name, slug) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id`,
      [c.name, c.slug]);
    if (r.rows[0]) created++;
  }
  return { categories: created };
}

/** Aperçu de ce qui serait chargé (sans écrire). */
export function sectorStarterPreview(sectorCode: string): { categories: string[] } {
  return { categories: (STARTER[sectorCode]?.categories ?? []).map(c => c.name) };
}

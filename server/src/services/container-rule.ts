/**
 * Règle d'affaires « contenant entier » (09/10/2026).
 *
 * Tout mouvement d'un ingrédient défini par contenant (sac, seau, carton…) se fait
 * par contenant COMPLET : bons de commande, demandes d'achat, transferts économat
 * → pesage. Minimum un contenant ; une quantité qui n'est pas un multiple exact est
 * arrondie au contenant SUPÉRIEUR (8 kg de chocolat en sacs de 2,5 kg → 4 sacs,
 * soit 10 kg).
 *
 * Un ingrédient est « défini par contenant » quand sa fiche porte un TYPE de
 * contenant ET une quantité par contenant (mig 226). Une taille héritée seule
 * (backfill mig 111 depuis les noms) ne déclenche pas la règle : on ne force pas
 * un arrondi sur une donnée devinée.
 *
 * Seule exception, physique : un lot dont l'économat contient moins d'un contenant
 * (dernier sac déjà entamé) se transfère en entier, pas plus.
 */

export interface ContainerDef {
  size: number;
  typeId: string | null;
  label: string | null;
}

type QueryClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, any>[] }>;
};

/** Arrondi au contenant supérieur. Renvoie la quantité en unité de stock et le
 *  nombre de contenants (toujours >= 1 pour une quantité > 0). */
export function roundUpToContainer(qty: number, size: number): { qty: number; count: number } {
  if (!(size > 0) || !(qty > 0)) return { qty, count: 0 };
  const count = Math.max(1, Math.ceil(qty / size - 1e-9));
  return { qty: count * size, count };
}

/** Définition du contenant d'un ingrédient, ou null s'il n'en a pas. */
export async function loadContainerDef(client: QueryClient, ingredientId: string): Promise<ContainerDef | null> {
  const r = await client.query(
    `SELECT ing.container_size, ing.container_type_id, ct.label
       FROM ingredients ing
       LEFT JOIN ref_entries ct ON ct.id = ing.container_type_id
      WHERE ing.id = $1`,
    [ingredientId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const size = row.container_size != null ? parseFloat(row.container_size) : 0;
  if (!(size > 0) || !row.container_type_id) return null;
  return { size, typeId: row.container_type_id as string, label: (row.label as string) || null };
}

/** Applique la règle à une quantité commandée / demandée. Sans contenant défini,
 *  la quantité est renvoyée telle quelle. */
export async function applyContainerRule(
  client: QueryClient,
  ingredientId: string,
  qty: number,
): Promise<{ qty: number; count: number | null; def: ContainerDef | null }> {
  const def = await loadContainerDef(client, ingredientId);
  if (!def) return { qty, count: null, def: null };
  const r = roundUpToContainer(qty, def.size);
  return { qty: r.qty, count: r.count, def };
}

/** Ouverture pendant la pesée d'un bon : arrondi au contenant supérieur, mais jamais
 *  au-delà de ce que le lot détient en économat (dernier contenant entamé : on prend
 *  ce qui reste, c'est le geste physique). */
export function roundUpForLot(qty: number, size: number, economatAvailable: number): { qty: number; count: number } {
  const r = roundUpToContainer(qty, size);
  if (r.qty > economatAvailable + 1e-9) {
    return { qty: economatAvailable, count: Math.max(1, Math.ceil(economatAvailable / size - 1e-9)) };
  }
  return r;
}

/** Transfert A L'AVANCE saisi par le magasinier : N contenants = N × taille, point.
 *  Si le lot ne détient pas assez en économat, le mouvement est refusé — sauf si la
 *  demande vaut exactement le reste du lot (reste entamé, bouton « Tout le lot »). */
export function strictContainerQty(qty: number, size: number, economatAvailable: number): { qty: number; count: number; ok: boolean; reason?: string } {
  if (Math.abs(qty - economatAvailable) < 1e-9) {
    return { qty: economatAvailable, count: Math.max(1, Math.ceil(economatAvailable / size - 1e-9)), ok: true };
  }
  const r = roundUpToContainer(qty, size);
  if (r.qty > economatAvailable + 1e-9) {
    return { ...r, ok: false, reason: `Le lot ne détient que ${economatAvailable} en économat (${r.count} contenant(s) = ${r.qty} demandés)` };
  }
  return { ...r, ok: true };
}

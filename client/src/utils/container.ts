/**
 * Règle d'affaires « contenant entier » (miroir client de server/services/container-rule).
 * Un ingrédient défini par contenant (type + quantité par contenant) se commande et
 * se transfère par contenant complet, arrondi au supérieur, minimum un contenant.
 */
export interface ContainerDef { size: number; label: string }

/** Définition du contenant d'un ingrédient (fiche), ou null s'il n'en a pas. */
export function containerOf(ing: Record<string, any> | null | undefined): ContainerDef | null {
  if (!ing) return null;
  const size = ing.container_size != null ? parseFloat(String(ing.container_size)) : 0;
  const hasType = !!ing.container_type_id || !!ing.container_type_label;
  if (!(size > 0) || !hasType) return null;
  return { size, label: (ing.container_type_label as string) || 'contenant' };
}

/** Arrondi au contenant supérieur (8 kg en sacs de 2,5 → 4 sacs = 10 kg). */
export function roundUpToContainer(qty: number, size: number): { qty: number; count: number } {
  if (!(size > 0) || !(qty > 0)) return { qty, count: 0 };
  const count = Math.max(1, Math.ceil(qty / size - 1e-9));
  return { qty: count * size, count };
}

/** Libellé court : « Sac de 25 kg ». */
export function containerLabel(def: ContainerDef, unit: string): string {
  const v = def.size % 1 === 0 ? def.size.toFixed(0) : def.size.toFixed(2);
  return `${def.label} de ${v} ${unit}`;
}

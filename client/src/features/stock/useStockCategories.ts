import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { expenseCategoriesApi } from '../../api/accounting.api';

// Source unique de la liste des branches stockables (cf. CategoryCascadeSelector).
import { STOCKABLE_ROOT_IDS, CONSUMABLE_ROOT_IDS } from '../../components/CategoryCascadeSelector';
export { STOCKABLE_ROOT_IDS, CONSUMABLE_ROOT_IDS };

export interface ExpenseCat {
  id: string;
  name: string;
  parent_id: string | null;
  level: number;
  code: string | null;
}

/** Couleur du tag par code de feuille (palette odoo-tag). Gris par defaut. */
export function categoryTagClass(code: string | null | undefined): string {
  if (!code) return 'odoo-tag-grey';
  if (['farines', 'pates_riz'].includes(code)) return 'odoo-tag-yellow';
  if (['sucres', 'decors'].includes(code)) return 'odoo-tag-purple';
  if (['produits_laitiers', 'gelifiants'].includes(code)) return 'odoo-tag-blue';
  if (['fruits', 'legumes', 'preparations'].includes(code)) return 'odoo-tag-green';
  if (['chocolat', 'viandes', 'epices', 'sauces', 'colorants'].includes(code)) return 'odoo-tag-red';
  if (['matieres_grasses', 'levures', 'conserves'].includes(code)) return 'odoo-tag-orange';
  return 'odoo-tag-grey';
}

/**
 * Hook de resolution des categories d'articles stockes a partir de leur
 * category_id (feuille de expense_categories). Fournit :
 *  - resolve(id)  -> { typeName, code, rootId, rootName, path }
 *  - groups       -> branches stockables avec leurs feuilles (pour filtre/kanban)
 *  - tagClass(id) -> classe CSS du tag
 */
export function useStockCategories() {
  const { data = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => expenseCategoriesApi.list(),
  });

  const cats = data as ExpenseCat[];

  const byId = useMemo(() => {
    const m = new Map<string, ExpenseCat>();
    cats.forEach(c => m.set(String(c.id), c));
    return m;
  }, [cats]);

  const childrenOf = useMemo(() => {
    const m = new Map<string, ExpenseCat[]>();
    cats.forEach(c => {
      const p = String(c.parent_id ?? '');
      if (!m.has(p)) m.set(p, []);
      m.get(p)!.push(c);
    });
    return m;
  }, [cats]);

  // Chaine d'ancetres (racine -> ... -> noeud), noeud inclus.
  const chainOf = (id?: string | null): ExpenseCat[] => {
    const out: ExpenseCat[] = [];
    let node = id ? byId.get(String(id)) : undefined;
    while (node) {
      out.unshift(node);
      node = node.parent_id ? byId.get(String(node.parent_id)) : undefined;
    }
    return out;
  };

  const resolve = (id?: string | null) => {
    const node = id ? byId.get(String(id)) : undefined;
    if (!node) return undefined;
    const chain = chainOf(id);
    const root = chain[0];
    return {
      typeName: node.name,
      code: node.code,
      rootId: root ? String(root.id) : undefined,
      rootName: root?.name,
      // Chemin "Racine / Sous-categorie / Type" — sert au tri et a l'affichage.
      path: chain.map(c => c.name).join(' / '),
    };
  };

  /** Vrai si la feuille leafId appartient au sous-arbre de la categorie branchId. */
  const isUnder = (leafId?: string | null, branchId?: string | null): boolean => {
    if (!branchId) return true;
    if (!leafId) return false;
    return chainOf(leafId).some(c => String(c.id) === String(branchId));
  };

  // Feuilles selectionnables des branches stockables (pas d'enfant), ordre tree.
  const groups = useMemo(() => {
    const isLeaf = (c: ExpenseCat) => !(childrenOf.get(String(c.id))?.length);
    const collectLeaves = (rootId: string): ExpenseCat[] => {
      const out: ExpenseCat[] = [];
      const walk = (id: string) => {
        for (const child of childrenOf.get(id) || []) {
          if (isLeaf(child)) out.push(child);
          else walk(String(child.id));
        }
      };
      walk(rootId);
      return out;
    };
    return STOCKABLE_ROOT_IDS
      .map(rid => byId.get(rid))
      .filter((r): r is ExpenseCat => !!r)
      .map(r => ({ root: r, leaves: collectLeaves(String(r.id)) }))
      .filter(g => g.leaves.length > 0);
  }, [byId, childrenOf]);

  // Categories selectionnables pour le filtre (noeuds NON-feuilles : racines +
  // sous-categories), en ordre arborescent avec leur profondeur (indentation).
  const branches = useMemo(() => {
    const out: { id: string; name: string; depth: number }[] = [];
    const walk = (id: string, depth: number) => {
      const kids = childrenOf.get(id) || [];
      if (kids.length === 0) return; // feuille -> pas une branche
      const node = byId.get(id);
      if (node) out.push({ id: String(node.id), name: node.name, depth });
      kids.forEach(k => walk(String(k.id), depth + 1));
    };
    STOCKABLE_ROOT_IDS.forEach(r => byId.has(r) && walk(r, 0));
    return out;
  }, [byId, childrenOf]);

  // Feuilles sous une branche donnee (racine ou sous-categorie).
  const leavesUnder = (branchId?: string | null): ExpenseCat[] => {
    if (!branchId) return groups.flatMap(g => g.leaves);
    const isLeaf = (c: ExpenseCat) => !(childrenOf.get(String(c.id))?.length);
    const out: ExpenseCat[] = [];
    const walk = (id: string) => {
      for (const child of childrenOf.get(id) || []) {
        if (isLeaf(child)) out.push(child); else walk(String(child.id));
      }
    };
    walk(String(branchId));
    return out;
  };

  const tagClass = (id?: string | null) => categoryTagClass(resolve(id)?.code);

  /**
   * Classe une categorie en 'consumable' (consommable -> packaging_items) ou
   * 'ingredient' (matiere premiere -> ingredients), selon que sa chaine
   * d'ancetres traverse une branche consommable (Emballages, Entretien,
   * Equipements). Defaut = 'ingredient'. Doit rester aligne avec la fonction
   * SQL fn_purchasable_kind cote serveur (migration 207).
   */
  const kindOf = (id?: string | null): 'ingredient' | 'consumable' => {
    if (!id) return 'ingredient';
    const chainIds = chainOf(id).map(c => String(c.id));
    return chainIds.some(cid => CONSUMABLE_ROOT_IDS.includes(cid)) ? 'consumable' : 'ingredient';
  };

  return { byId, resolve, groups, branches, leavesUnder, isUnder, tagClass, kindOf, isLoading: cats.length === 0 };
}

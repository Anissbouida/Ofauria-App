import { db } from '../config/database.js';

/**
 * Catalogue FERMÉ des gardes et des actions du moteur de processus (plan d'exécution
 * multi-industries, étape 5, pas 5a).
 *
 * Règle de conception : l'administrateur COMPOSE un processus à partir de ces éléments ;
 * il n'écrit jamais de règle libre ni de SQL. Une garde ou une action manquante s'ajoute
 * ICI, avec son test. Les gardes reprennent exactement les contrôles du code existant
 * (démarrage, transfert) : le moteur et la machine à états prennent la même décision.
 *
 * Une garde renvoie null (passe) ou le motif du refus, lisible par l'utilisateur.
 */
type Runner = { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> };

export type GuardContext = { planId: string; runner?: Runner };
export type GuardDef = {
  key: string; label: string; description: string;
  check: (ctx: GuardContext) => Promise<string | null>;
};
export type ActionDef = { key: string; label: string; description: string };

const q = (ctx: GuardContext) => ctx.runner ?? db;

export const GUARDS: Record<string, GuardDef> = {
  semi_finished_ready: {
    key: 'semi_finished_ready', label: 'Semi-finis produits',
    description: 'Les recettes de base fabriquées par un plan fils sont produites (ou servies depuis le stock).',
    async check(ctx) {
      const r = await q(ctx).query(
        `SELECT r.name FROM production_plan_dependencies ppd JOIN recipes r ON r.id = ppd.sub_recipe_id
          WHERE ppd.parent_plan_id = $1 AND ppd.status NOT IN ('fulfilled', 'cancelled')`, [ctx.planId]);
      return r.rows.length ? `Semi-finis en attente: ${r.rows.map(x => x.name).join(', ')}. Produisez-les d'abord.` : null;
    },
  },
  bon_sortie_closed: {
    key: 'bon_sortie_closed', label: 'Bon de sortie clôturé',
    description: 'Les matières sont livrées à l\'atelier (bon de sortie clôturé), quand l\'ordre a des besoins.',
    async check(ctx) {
      const needs = await q(ctx).query(`SELECT 1 FROM production_ingredient_needs WHERE plan_id = $1 LIMIT 1`, [ctx.planId]);
      if (!needs.rows.length) return null;
      const bsi = (await q(ctx).query(
        `SELECT status, numero FROM production_bons_sortie WHERE plan_id = $1 AND status != 'annule' ORDER BY created_at DESC LIMIT 1`, [ctx.planId])).rows[0];
      if (!bsi) return 'Aucun bon de sortie genere. Generez le BSI avant de demarrer la production.';
      return bsi.status === 'cloture' ? null : `Le bon de sortie ${bsi.numero} n'est pas clôturé.`;
    },
  },
  all_weighed: {
    key: 'all_weighed', label: 'Toutes les lignes pesées',
    description: 'Chaque ligne du bon de sortie a été pesée.',
    async check(ctx) {
      const r = (await q(ctx).query(
        `SELECT count(*)::int AS n FROM production_bons_sortie_lignes l JOIN production_bons_sortie b ON b.id = l.bon_id
          WHERE b.plan_id = $1 AND b.status <> 'annule' AND COALESCE(l.allocated_quantity, 0) > 0 AND l.weighed_at IS NULL`, [ctx.planId])).rows[0];
      return r.n > 0 ? `Pesée obligatoire pour ce type d'ordre : ${r.n} ligne(s) du bon de sortie ne sont pas pesées.` : null;
    },
  },
  blocking_steps_done: {
    key: 'blocking_steps_done', label: 'Étapes bloquantes terminées',
    description: 'Les étapes marquées bloquantes de chaque article sont terminées.',
    async check(ctx) {
      const r = (await q(ctx).query(
        `SELECT count(*)::int AS n FROM production_item_etapes e JOIN production_plan_items i ON i.id = e.plan_item_id
          WHERE i.plan_id = $1 AND e.est_bloquante AND e.status NOT IN ('completed', 'skipped')`, [ctx.planId])).rows[0];
      return r.n > 0 ? `${r.n} étape(s) bloquante(s) non terminée(s).` : null;
    },
  },
  quality_passed: {
    key: 'quality_passed', label: 'Contrôle qualité conforme',
    description: 'Au moins un contrôle conforme sur l\'ordre, aucun en attente ni non conforme.',
    async check(ctx) {
      const r = (await q(ctx).query(
        `SELECT count(*) FILTER (WHERE status = 'a_faire')::int AS pending,
                count(*) FILTER (WHERE status = 'faite' AND conformity IS NOT FALSE)::int AS ok,
                count(*) FILTER (WHERE status = 'faite' AND conformity IS FALSE)::int AS ko
           FROM quality_inspections WHERE plan_id = $1`, [ctx.planId])).rows[0];
      if (r.pending > 0) return `Contrôle qualité obligatoire : ${r.pending} contrôle(s) en attente sur cet ordre.`;
      if (r.ko > 0) return 'Contrôle qualité obligatoire : un contrôle est non conforme.';
      return r.ok === 0 ? 'Contrôle qualité obligatoire : aucun contrôle conforme enregistré sur cet ordre.' : null;
    },
  },
  components_reserved: {
    key: 'components_reserved', label: 'Composants réservés',
    description: 'Les besoins de l\'ordre sont couverts par le stock disponible (réservation, étape 8).',
    async check(ctx) {
      const r = (await q(ctx).query(
        `SELECT count(*)::int AS n FROM production_ingredient_needs WHERE plan_id = $1 AND available_quantity < needed_quantity`, [ctx.planId])).rows[0];
      return r.n > 0 ? `${r.n} composant(s) non couverts par le stock.` : null;
    },
  },
};

export const ACTIONS: Record<string, ActionDef> = {
  generate_bon_sortie: { key: 'generate_bon_sortie', label: 'Générer le bon de sortie', description: 'Bon de sortie des matières, lots proposés par date limite.' },
  open_to_pesage: { key: 'open_to_pesage', label: 'Transférer Économat → Pesage', description: 'Un contenant ouvert passe en zone de pesée.' },
  consume_at_bon_sortie: { key: 'consume_at_bon_sortie', label: 'Consommer au bon de sortie', description: 'La matière sort du stock à l\'acceptation du bon.' },
  consume_at_declaration: { key: 'consume_at_declaration', label: 'Consommer à la déclaration', description: 'La matière sort selon la nomenclature au moment de la déclaration.' },
  consume_manual: { key: 'consume_manual', label: 'Consommation saisie', description: 'Les sorties de matière sont saisies sur l\'ordre.' },
  create_product_lot: { key: 'create_product_lot', label: 'Créer le lot produit', description: 'Lot de produit fini, date limite, emplacement.' },
  generate_final_inspection: { key: 'generate_final_inspection', label: 'Générer le contrôle final', description: 'Inspection du plan de contrôle à l\'étape finale.' },
  compute_cost: { key: 'compute_cost', label: 'Calculer coût réel et rendement', description: 'Coût réel, répartition entre articles, rendement.' },
  transfer_to_store: { key: 'transfer_to_store', label: 'Transférer vers la boutique', description: 'Bon de transfert, partiel autorisé.' },
  notify_workshop: { key: 'notify_workshop', label: 'Notifier l\'atelier', description: 'Notification aux membres de l\'atelier de l\'ordre.' },
  emit_event: { key: 'emit_event', label: 'Émettre un événement', description: 'Événement métier pour les intégrations.' },
};

export const isGuard = (k: string) => Object.prototype.hasOwnProperty.call(GUARDS, k);
export const isAction = (k: string) => Object.prototype.hasOwnProperty.call(ACTIONS, k);

/** Évalue une liste de gardes ; renvoie les motifs de refus (vide = toutes passent). */
export async function evaluateGuards(keys: string[], ctx: GuardContext): Promise<string[]> {
  const out: string[] = [];
  for (const k of keys) {
    const g = GUARDS[k];
    if (!g) { out.push(`Garde inconnue : ${k}`); continue; }
    const why = await g.check(ctx);
    if (why) out.push(why);
  }
  return out;
}

import { db } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';
import type { PoolClient } from 'pg';
import { packagingItemRepository } from './packaging-item.repository.js';
import { setActor, setReason, transitionPlan, transitionBon, withActor } from '../services/production-state.js';
import { roundUpForLot } from '../services/container-rule.js';

type BonRow = Record<string, any>;

// ─── Peremption d'un lot : jugee sur la DATE, pas sur le statut ───
// Aucun code ne pose jamais ingredient_lots.status = 'expired' (audit pesage W1) :
// tout controle fonde sur ce statut etait mort, et le FEFO servait les lots perimes
// en premier (expiration_date ASC). Toutes les requetes du module passent par ce
// fragment, avec l'alias de table en parametre.
const lotExpiredSql = (alias: string) =>
  `(${alias}.status = 'expired' OR (${alias}.expiration_date IS NOT NULL AND ${alias}.expiration_date < CURRENT_DATE))`;
const lotUsableSql = (alias: string) => `(${alias}.status = 'active' AND NOT ${lotExpiredSql(alias)})`;

/** Ouvre un contenant : deplace `qty` du lot de la zone Economat vers la zone
 *  Pesage, dans la transaction de l'appelant, avec la trace zone_transfers.
 *  Le lot est verrouille ici. Refuse un lot d'un autre ingredient / magasin,
 *  inactif, perime, ou dont l'economat ne couvre pas la quantite. */
async function moveEconomatToPesage(
  client: PoolClient,
  params: {
    lotId: string; ingredientId: string; storeId: string; qty: number; userId: string;
    bonId?: string | null; ligneId?: string | null; planId?: string | null;
    reason?: string | null; containerCount?: number | null; containerTypeId?: string | null;
  },
): Promise<BonRow> {
  const lotResult = await client.query(
    `SELECT il.id, il.ingredient_id, il.store_id, il.lot_number, il.economat_quantity, il.pesage_quantity,
            il.status, il.expiration_date, ${lotExpiredSql('il')} AS is_expired,
            CASE WHEN ing.container_type_id IS NOT NULL THEN ing.container_size ELSE NULL END AS container_size
       FROM ingredient_lots il
       JOIN ingredients ing ON ing.id = il.ingredient_id
      WHERE il.id = $1
      FOR UPDATE`,
    [params.lotId]
  );
  const lot = lotResult.rows[0];
  if (!lot) throw new Error('Lot Economat introuvable');
  // Regle « contenant entier » : on ouvre des contenants complets (arrondi au
  // superieur), sauf dernier contenant entame. `params.qty` est corrige sur place
  // pour que l'appelant enregistre la quantite reellement deplacee.
  const containerSize = lot.container_size != null ? parseFloat(lot.container_size) : 0;
  if (containerSize > 0) {
    const r = roundUpForLot(params.qty, containerSize, parseFloat(lot.economat_quantity));
    params.qty = r.qty;
    params.containerCount = r.count;
  }
  if (lot.ingredient_id !== params.ingredientId) throw new Error('Le lot ne correspond pas a l\'ingredient de la ligne BSI');
  if (lot.store_id !== params.storeId) throw new Error('Le lot n\'appartient pas au magasin du bon de sortie');
  if (lot.status !== 'active') throw new Error(`Lot non actif (statut : ${lot.status}), ouverture interdite`);
  if (lot.is_expired) throw new Error(`Lot ${lot.lot_number} perime (DLC ${lot.expiration_date}) : ouverture interdite, choisissez un autre lot`);
  const economatAvailable = parseFloat(lot.economat_quantity);
  if (economatAvailable + 1e-9 < params.qty) {
    throw new Error(`Quantite insuffisante en Economat sur le lot ${lot.lot_number} (${economatAvailable} dispo / ${params.qty} demande)`);
  }

  await client.query(
    `INSERT INTO ingredient_stock_zone_transfers
       (ingredient_lot_id, store_id, from_zone, to_zone, quantity, container_count, container_type_id,
        bon_sortie_id, bon_sortie_ligne_id, plan_production_id, reason, transferred_by)
     VALUES ($1, $2, 'ECONOMAT', 'PESAGE', $3, $4, $5, $6, $7, $8, $9, $10)`,
    [lot.id, params.storeId, params.qty, params.containerCount || null, params.containerTypeId || null,
     params.bonId || null, params.ligneId || null, params.planId || null, params.reason || null, params.userId]
  );
  const openingEntry = {
    qty: params.qty,
    opened_at: new Date().toISOString(),
    opened_by: params.userId,
    container_count: params.containerCount || null,
    container_type_id: params.containerTypeId || null,
    bon_sortie_id: params.bonId || null,
  };
  await client.query(
    `UPDATE ingredient_lots
        SET economat_quantity = economat_quantity - $1,
            pesage_quantity = pesage_quantity + $1,
            first_opened_at = COALESCE(first_opened_at, NOW()),
            opening_history = opening_history || $2::jsonb
      WHERE id = $3`,
    [params.qty, JSON.stringify(openingEntry), lot.id]
  );
  return lot;
}

// ─── Etapes internes du prelevement, enchainees par acceptReception dans UNE
//     transaction (pret -> prelevement -> verifie -> cloture). ───

/** Consomme physiquement les lignes du bon : lots pesage (ingredients) et stock
 *  emballages, avec mouvement trace. Appele une seule fois par bon, au passage en
 *  'prelevement'. Le bon est deja verrouille par l'appelant. */
async function consumeBonLines(client: PoolClient, bon: BonRow, userId: string) {
  // Lignes ingredients 'en_attente' deja allouees : auto-confirmees a la qte allouee.
  // weighing_source='auto' : pas une mesure, une recopie (voir analyse des ecarts).
  await client.query(
    `UPDATE production_bons_sortie_lignes
        SET status = 'preleve', actual_quantity = allocated_quantity,
            weighing_source = COALESCE(weighing_source, 'auto'), updated_at = NOW()
      WHERE bon_id = $1
        AND status = 'en_attente'
        AND ingredient_id IS NOT NULL
        AND ingredient_lot_id IS NOT NULL
        AND allocated_quantity > 0`,
    [bon.id]
  );

  const linesResult = await client.query(
    `SELECT bsl.id, bsl.ingredient_id, bsl.unit, bsl.status,
            bsl.allocated_quantity, bsl.actual_quantity, bsl.substitute_lot_id, bsl.ingredient_lot_id,
            ing.name AS ingredient_name
     FROM production_bons_sortie_lignes bsl
     JOIN ingredients ing ON ing.id = bsl.ingredient_id
     WHERE bsl.bon_id = $1
       AND bsl.status IN ('preleve', 'substitue', 'ecart')
       AND bsl.ingredient_id IS NOT NULL
     FOR UPDATE OF bsl`,
    [bon.id]
  );
  for (const line of linesResult.rows) {
    const lotId = line.substitute_lot_id || line.ingredient_lot_id;
    if (!lotId) continue;
    const qty = parseFloat(line.actual_quantity ?? line.allocated_quantity ?? '0');
    if (qty <= 0) continue;
    // Decremente pesage_quantity ; 'depleted' si tout est consomme. Le trigger
    // sync_quantity_remaining maintient quantity_remaining, trg_inventory_sync_lots
    // resynchronise inventory.current_quantity.
    // Si la pesee depasse ce que la zone pesage detenait (le magasinier a pris le
    // complement dans le sac encore range en economat), le surplus est preleve sur
    // l'economat du meme lot : avant, le lot etait borne a 0 alors que le mouvement
    // enregistrait la quantite complete, et l'inventaire derivait a chaque fois.
    await client.query(
      `UPDATE ingredient_lots
          SET economat_quantity = GREATEST(economat_quantity - GREATEST($1 - pesage_quantity, 0), 0),
              pesage_quantity   = GREATEST(pesage_quantity - $1, 0),
              status = CASE WHEN economat_quantity + pesage_quantity - $1 <= 0.0005 THEN 'depleted' ELSE status END
        WHERE id = $2`,
      [qty, lotId]
    );
    await client.query(
      `INSERT INTO inventory_transactions
         (ingredient_id, type, quantity_change, note, performed_by, store_id, ingredient_lot_id, production_plan_id)
       VALUES ($1, 'production', $2, $3, $4, $5, $6, $7)`,
      [line.ingredient_id, -qty,
       `BSI ${bon.numero} — Reception acceptee : ${qty.toFixed(3)} ${line.unit || ''} ${line.ingredient_name}`,
       userId, bon.store_id, lotId, bon.plan_id]
    );
    // Tracabilite lot -> production (mig 300) : c'est ce que lisent la
    // tracabilite avant/arriere et le cout reel FIFO. N'etait jamais ecrit sur
    // le chemin BSI avant.
    await client.query(
      `INSERT INTO production_lot_usage (production_plan_id, ingredient_lot_id, ingredient_id, quantity_used, bon_ligne_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [bon.plan_id, lotId, line.ingredient_id, qty, line.id, userId]
    );
  }

  // Lignes emballages : consommees ici, au meme moment que les ingredients.
  // Avant, elles etaient marquees prelevees sans jamais toucher au stock emballage.
  const pkLines = await client.query(
    `SELECT bsl.id, bsl.packaging_id, bsl.allocated_quantity, bsl.unit, pi.name, pi.unit_cost
       FROM production_bons_sortie_lignes bsl
       JOIN packaging_items pi ON pi.id = bsl.packaging_id
      WHERE bsl.bon_id = $1 AND bsl.packaging_id IS NOT NULL
        AND bsl.status IN ('en_attente', 'preleve')
      FOR UPDATE OF bsl`,
    [bon.id]
  );
  for (const pk of pkLines.rows) {
    const qty = parseFloat(pk.allocated_quantity || '0');
    await client.query(
      `UPDATE production_bons_sortie_lignes
          SET status = 'preleve', actual_quantity = COALESCE(actual_quantity, allocated_quantity),
              weighing_source = COALESCE(weighing_source, 'auto'), updated_at = NOW()
        WHERE id = $1`,
      [pk.id]
    );
    if (qty > 0 && bon.store_id) {
      await packagingItemRepository.adjustStock(client, {
        packagingId: pk.packaging_id, storeId: bon.store_id, change: -qty, type: 'consumption',
        referenceId: bon.plan_id, referenceType: 'production_plan',
        unitCost: pk.unit_cost != null ? parseFloat(pk.unit_cost) : null,
        note: `BSI ${bon.numero} — ${qty.toFixed(2)} ${pk.unit || ''} ${pk.name}`,
        performedBy: userId,
      });
    }
  }
}

/** 'pret' | 'genere' -> 'prelevement' + consommation. Retourne le bon mis a jour. */
async function applyPrelevement(client: PoolClient, bonId: string, userId: string): Promise<BonRow> {
  const bon = await transitionBon(client, bonId, 'prelevement', { extraSet: 'prelevement_by = $2, prelevement_at = NOW()', params: [userId], reason: 'Reception acceptee par le chef' });
  await consumeBonLines(client, bon, userId);
  return bon;
}

/** 'prelevement' -> 'verifie'. Le stock a deja ete consomme au prelevement : ici on
 *  ne fait que clore les lignes restantes (ruptures non resolues) sans mouvement. */
async function applyVerify(client: PoolClient, bonId: string, userId: string): Promise<BonRow> {
  await client.query(
    `UPDATE production_bons_sortie_lignes
        SET status = 'preleve', actual_quantity = COALESCE(actual_quantity, 0),
            weighing_source = COALESCE(weighing_source, 'auto'), updated_at = NOW()
      WHERE bon_id = $1 AND status = 'en_attente'`,
    [bonId]
  );
  return transitionBon(client, bonId, 'verifie', { extraSet: 'verified_by = $2, verified_at = NOW()', params: [userId] });
}

/** 'verifie' -> 'cloture'. */
async function applyClose(client: PoolClient, bonId: string, userId: string): Promise<BonRow> {
  const bon = await transitionBon(client, bonId, 'cloture', { extraSet: 'closed_by = $2, closed_at = NOW()', params: [userId], reason: 'Ingredients livres' });
  await client.query(
    `UPDATE production_plan_items SET waiting_status = 'restored'
      WHERE plan_id = $1 AND waiting_status = 'waiting'`,
    [bon.plan_id]
  );
  return bon;
}

/** Verrouille le bon et retourne sa ligne (null si introuvable). */
async function lockBon(client: PoolClient, bonId: string): Promise<BonRow | null> {
  const r = await client.query(`SELECT * FROM production_bons_sortie WHERE id = $1 FOR UPDATE`, [bonId]);
  return r.rows[0] || null;
}

/** Lignes d'un bon, avec tout ce dont l'ecran a besoin : ingredient OU emballage
 *  (LEFT JOIN — les lignes emballage etaient invisibles a cause d'une jointure
 *  interne, audit W16), lot attache, lot economat suggere, contenant de l'ingredient,
 *  peremption jugee sur la DATE, bande de tolerance, et stock LIBRE de l'ingredient
 *  (pesage / economat, hors reservations des autres lignes du meme bon). */
async function loadBonLines(bonId: string, storeId: string) {
  const r = await db.query(
    `SELECT bsl.*,
            COALESCE(ing.name, pi.name) AS ingredient_name,
            COALESCE(ing.unit, pi.unit, bsl.unit) AS ingredient_unit,
            (bsl.packaging_id IS NOT NULL) AS is_packaging,
            pi.name AS packaging_name, pi.format AS packaging_format,
            ing.container_size, ing.container_type_id, ct.label AS container_type_label,
            il.lot_number, il.supplier_lot_number, il.expiration_date,
            il.quantity_remaining AS lot_remaining, il.pesage_quantity AS lot_pesage_quantity,
            il.status AS lot_status,
            (il.id IS NOT NULL AND ${lotExpiredSql('il')}) AS lot_expired,
            ils.lot_number AS suggested_lot_number,
            ils.economat_quantity AS suggested_lot_economat_qty,
            ils.expiration_date AS suggested_lot_dlc,
            (ils.id IS NOT NULL AND ${lotExpiredSql('ils')}) AS suggested_lot_expired,
            -- Une demande d'achat est-elle deja ouverte pour cet ingredient (commande
            -- inline depuis la ligne en rupture, sans doublon) ?
            EXISTS (
              SELECT 1 FROM purchase_requests pr
               WHERE pr.ingredient_id = bsl.ingredient_id
                 AND pr.status IN ('pending', 'assigned', 'ordered')
                 AND (pr.store_id IS NULL OR pr.store_id = $2)
            ) AS already_ordered,
            -- Demi-largeur de la bande de tolerance, dans l'unite de la ligne, calculee
            -- par la meme fonction que la validation serveur. Pour une ligne a ouvrir
            -- (allocated = 0 tant que le contenant n'est pas ouvert) la cible est la
            -- quantite a transferer.
            fn_weighing_tolerance(bsl.ingredient_id,
              CASE WHEN bsl.source_location = 'ECONOMAT_REQUIRES_TRANSFER' THEN COALESCE(bsl.transfer_required_qty, bsl.needed_quantity)
                   WHEN bsl.status = 'rupture' AND bsl.allocated_quantity <= 0 THEN bsl.needed_quantity
                   ELSE bsl.allocated_quantity END,
              bsl.unit) AS tolerance_qty,
            -- Stock LIBRE (pesage + economat, lots non perimes) moins les reservations
            -- des lignes de CE bon : sans cette soustraction, une ligne en rupture
            -- voyait comme disponible du stock deja alloue a une autre ligne.
            COALESCE((
              SELECT SUM(
                GREATEST(0, COALESCE(il2.pesage_quantity, 0) - COALESCE((
                  SELECT SUM(bsl2.allocated_quantity)
                    FROM production_bons_sortie_lignes bsl2
                   WHERE bsl2.bon_id = bsl.bon_id
                     AND bsl2.ingredient_lot_id = il2.id
                     AND bsl2.source_location = 'PESAGE'
                     AND bsl2.status IN ('en_attente', 'preleve', 'substitue')
                ), 0))
                + GREATEST(0, COALESCE(il2.economat_quantity, 0) - COALESCE((
                  SELECT SUM(bsl2.transfer_required_qty)
                    FROM production_bons_sortie_lignes bsl2
                   WHERE bsl2.bon_id = bsl.bon_id
                     AND bsl2.suggested_economat_lot_id = il2.id
                     AND bsl2.source_location = 'ECONOMAT_REQUIRES_TRANSFER'
                     AND bsl2.status = 'en_attente'
                ), 0))
              )
                FROM ingredient_lots il2
               WHERE il2.ingredient_id = bsl.ingredient_id
                 AND il2.store_id = $2
                 AND ${lotUsableSql('il2')}
            ), 0) AS current_stock_total,
            COALESCE((
              SELECT SUM(GREATEST(0, COALESCE(il2.pesage_quantity, 0) - COALESCE((
                SELECT SUM(bsl2.allocated_quantity)
                  FROM production_bons_sortie_lignes bsl2
                 WHERE bsl2.bon_id = bsl.bon_id
                   AND bsl2.ingredient_lot_id = il2.id
                   AND bsl2.source_location = 'PESAGE'
                   AND bsl2.status IN ('en_attente', 'preleve', 'substitue')
              ), 0)))
                FROM ingredient_lots il2
               WHERE il2.ingredient_id = bsl.ingredient_id
                 AND il2.store_id = $2
                 AND ${lotUsableSql('il2')}
            ), 0) AS current_pesage_total
       FROM production_bons_sortie_lignes bsl
       LEFT JOIN ingredients ing ON ing.id = bsl.ingredient_id
       LEFT JOIN packaging_items pi ON pi.id = bsl.packaging_id
       LEFT JOIN ref_entries ct ON ct.id = ing.container_type_id
       LEFT JOIN ingredient_lots il ON il.id = bsl.ingredient_lot_id
       LEFT JOIN ingredient_lots ils ON ils.id = bsl.suggested_economat_lot_id
      WHERE bsl.bon_id = $1
      ORDER BY (bsl.packaging_id IS NOT NULL), COALESCE(ing.name, pi.name), il.expiration_date ASC NULLS LAST, bsl.created_at`,
    [bonId, storeId]
  );
  return r.rows;
}

export const bonSortieRepository = {

  // ─── Generate a bon de sortie from plan ingredient needs + FEFO preview ───
  // opts.derogationDlc : autorise, sur motif trace (mig 339), l'allocation de lots
  // a DLC depassee. Sans derogation, ces lots sont EXCLUS de l'allocation et
  // remontes dans `expired_lots_skipped` pour que le chef decide en connaissance.
  async generate(planId: string, storeId: string, userId: string, opts: { derogationDlc?: { motif: string } } = {}) {
    const derogation = opts.derogationDlc ?? null;
    // Lot utilisable = actif ET dans sa DLC (un lot 'active' peut avoir depasse sa
    // date si le job d'expiration n'est pas encore passe : on filtre aussi la date).
    // Lot allouable : actif et dans sa DLC (lotUsableSql) ; sous derogation tracee,
    // les lots perimes (statut 'expired' ou date passee) redeviennent allouables.
    const usableSql = derogation ? `(il.status IN ('active', 'expired'))` : lotUsableSql('il');
    const expiredLotsSkipped: { ingredient_id: string; ingredient_name: string; lot_number: string; expiration_date: string | null; quantity: number }[] = [];

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setActor(client, userId);

      // 0. Garde-fou anti-doublon : verrouille la ligne du plan + verifie qu'un BSI
      //    non-annule n'existe pas deja. Sans ce check, un double clic ou un appel
      //    concurrent (React StrictMode, retries reseau) cree plusieurs BSI pour
      //    le meme plan a quelques millisecondes d'intervalle.
      await client.query(`SELECT id FROM production_plans WHERE id = $1 FOR UPDATE`, [planId]);
      const existing = await client.query(
        `SELECT id, numero, status FROM production_bons_sortie
         WHERE plan_id = $1 AND status != 'annule'
         LIMIT 1`,
        [planId]
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        throw new Error(`Bon deja genere pour ce plan : ${existing.rows[0].numero}`);
      }

      // 1. Get ingredient needs for this plan
      const needsResult = await client.query(
        `SELECT pin.ingredient_id, ing.name AS ingredient_name, ing.unit AS ingredient_unit,
                SUM(pin.needed_quantity) AS needed_quantity
         FROM production_ingredient_needs pin
         JOIN ingredients ing ON ing.id = pin.ingredient_id
         WHERE pin.plan_id = $1
         GROUP BY pin.ingredient_id, ing.name, ing.unit
         ORDER BY ing.name`,
        [planId]
      );

      if (needsResult.rows.length === 0) {
        throw new Error('Aucun besoin en ingredients pour ce plan');
      }

      // 2. Numero du BSI : serie « bon_sortie » (Parametres > Numerotation, mig 329),
      // allouee dans la transaction (ROLLBACK = numero rendu, pas de doublon apres
      // suppression d'un BSI du jour).
      const numero = await nextDocumentNumber(client, 'bon_sortie');

      // 3. Create the bon de sortie
      const bonResult = await client.query(
        `INSERT INTO production_bons_sortie (plan_id, store_id, numero, status, generated_by, generated_at)
         VALUES ($1, $2, $3, 'genere', $4, NOW())
         RETURNING *`,
        [planId, storeId, numero, userId]
      );
      const bon = bonResult.rows[0];

      // 3b. Derogation DLC : tracee sur l'en-tete (qui, quand, pourquoi).
      if (derogation) {
        await client.query(
          `UPDATE production_bons_sortie
           SET derogation_dlc_motif = $2, derogation_dlc_by = $3, derogation_dlc_at = NOW()
           WHERE id = $1`,
          [bon.id, derogation.motif, userId]
        );
        bon.derogation_dlc_motif = derogation.motif;
        bon.derogation_dlc_by = userId;
      }

      // 4. For each ingredient need, allocate via STRICT Pesage workflow (Option B) :
      //    - Étape 1 : Pesage (lots déjà ouverts) → ligne PESAGE, alloue directement
      //    - Étape 2 : Pesage insuffisant → ligne ECONOMAT_REQUIRES_TRANSFER avec lot
      //                Economat suggere (FEFO sur DLC). Le magasinier devra transferer
      //                avant de marquer le BSI pret.
      //    - Étape 3 : Pesage + Economat insuffisants → ligne RUPTURE.
      const lines = [];
      for (const need of needsResult.rows) {
        const neededQty = parseFloat(need.needed_quantity);
        let remaining = neededQty;

        // Étape 1 : consommation depuis Pesage (FEFO sur DLC). Les lots perimes
        // (DLC passee) ne sont JAMAIS alloues : ils restent visibles dans l'onglet
        // Stock pesage pour etre sortis en perte, et la ligne passe en transfert
        // ou en rupture si rien d'autre n'est disponible.
        const pesageLotsResult = await client.query(
          `SELECT il.id, il.lot_number, il.supplier_lot_number, il.pesage_quantity, il.expiration_date,
                  il.received_at, il.status, il.first_opened_at
           FROM ingredient_lots il
           WHERE il.ingredient_id = $1 AND il.store_id = $2
             AND ${usableSql} AND il.pesage_quantity > 0
           ORDER BY il.expiration_date ASC NULLS LAST,
                    il.first_opened_at ASC NULLS FIRST, il.received_at ASC`,
          [need.ingredient_id, storeId]
        );
        const expiredStockResult = await client.query(
          `SELECT COALESCE(SUM(il.pesage_quantity + il.economat_quantity), 0)::numeric AS qty, COUNT(*)::int AS n
             FROM ingredient_lots il
            WHERE il.ingredient_id = $1 AND il.store_id = $2
              AND il.status IN ('active', 'expired') AND ${lotExpiredSql('il')}
              AND il.pesage_quantity + il.economat_quantity > 0`,
          [need.ingredient_id, storeId]
        );
        const expiredQty = parseFloat(expiredStockResult.rows[0]?.qty || '0');

        // Sans derogation : on liste ce qu'on a ecarte, pour que le chef voie qu'un
        // stock existe mais est hors DLC (et puisse deroger explicitement).
        if (!derogation) {
          const skippedResult = await client.query(
            `SELECT lot_number, expiration_date, pesage_quantity
             FROM ingredient_lots
             WHERE ingredient_id = $1 AND store_id = $2 AND pesage_quantity > 0
               AND (status = 'expired' OR expiration_date < CURRENT_DATE)`,
            [need.ingredient_id, storeId]
          );
          for (const s of skippedResult.rows) {
            expiredLotsSkipped.push({
              ingredient_id: need.ingredient_id, ingredient_name: need.ingredient_name,
              lot_number: s.lot_number, expiration_date: s.expiration_date,
              quantity: parseFloat(s.pesage_quantity),
            });
          }
        }

        for (const lot of pesageLotsResult.rows) {
          if (remaining <= 0) break;
          const available = parseFloat(lot.pesage_quantity);
          // Fond de sac : un residu de quelques grammes au pesage ne doit pas creer
          // une ligne « a peser 0 g » (le magasinier pesera le besoin entier depuis le
          // contenant ouvert ensuite). On ignore un lot qui ne couvre ni le reste du
          // besoin ni 5 % de celui-ci (plancher 1 g / 1 ml).
          if (available + 1e-9 < Math.min(remaining, Math.max(0.001, 0.05 * neededQty))) continue;
          const take = Math.min(available, remaining);
          const isExpired = lot.status === 'expired' || (lot.expiration_date && new Date(lot.expiration_date) < new Date());

          // needed_quantity = portion couverte par cette ligne (= take), pas le besoin total :
          // sinon une ligne PESAGE partielle ferait apparaitre "manque" alors que la portion
          // est entierement allouee, et le total des needed cumulees depasserait le besoin reel.
          const lineResult = await client.query(
            `INSERT INTO production_bons_sortie_lignes
               (bon_id, ingredient_id, ingredient_lot_id, needed_quantity, allocated_quantity,
                unit, status, source_location, notes, derogation_dlc)
             VALUES ($1, $2, $3, $4, $5, $6, 'en_attente', 'PESAGE', $7, $8)
             RETURNING *`,
            [bon.id, need.ingredient_id, lot.id, take, take, need.ingredient_unit || 'kg',
             `[Pesage] ouvert ${lot.first_opened_at ? new Date(lot.first_opened_at).toLocaleDateString('fr-FR') : ''}${isExpired ? ' — ⚠ DLC depassee (derogation)' : ''}`,
             !!isExpired]
          );

          lines.push({
            ...lineResult.rows[0],
            ingredient_name: need.ingredient_name,
            ingredient_unit: need.ingredient_unit,
            lot_number: lot.lot_number,
            supplier_lot_number: lot.supplier_lot_number,
            expiration_date: lot.expiration_date,
            stock_source: 'pesage',
            lot_expired: !!isExpired,
          });

          remaining -= take;
        }

        // Étape 2 : Pesage insuffisant → lignes "transfert requis", UNE PAR LOT
        // Economat (FEFO sur DLC), chacune couverte par SON lot.
        // F-069 / F-073 : auparavant une seule ligne lumpait tout le besoin economat
        // sur un unique lot suggere. Quand le stock etait eclate en plusieurs fonds
        // de sac (aucun lot ne couvrant a lui seul le besoin), la pesee de cette
        // ligne echouait (« le lot ne couvre pas la pesee ») et bloquait toute la
        // production. On eclate desormais comme les lignes PESAGE : chaque ligne
        // porte la part d'UN lot et s'ouvre sur ce lot. La regle du contenant entier
        // reste appliquee a l'ouverture (moveEconomatToPesage).
        if (remaining > 0) {
          const economatLotsResult = await client.query(
            `SELECT il.id, il.lot_number, il.supplier_lot_number, il.economat_quantity, il.expiration_date,
                    il.received_at, il.status
             FROM ingredient_lots il
             WHERE il.ingredient_id = $1 AND il.store_id = $2
               AND ${usableSql} AND il.economat_quantity > 0
             ORDER BY il.expiration_date ASC NULLS LAST, il.received_at ASC`,
            [need.ingredient_id, storeId]
          );
          for (const lot of economatLotsResult.rows) {
            if (remaining <= 1e-9) break;
            const lotEconomat = parseFloat(lot.economat_quantity);
            const take = Math.min(lotEconomat, remaining);
            if (take <= 1e-9) continue;
            const lineResult = await client.query(
              `INSERT INTO production_bons_sortie_lignes
                 (bon_id, ingredient_id, ingredient_lot_id, needed_quantity, allocated_quantity,
                  unit, status, source_location, suggested_economat_lot_id, transfer_required_qty, notes)
               VALUES ($1, $2, NULL, $3, 0, $4, 'en_attente', 'ECONOMAT_REQUIRES_TRANSFER', $5, $6, $7)
               RETURNING *`,
              [bon.id, need.ingredient_id, take, need.ingredient_unit || 'kg',
               lot.id, take,
               `Transfert requis : ${take.toFixed(2)} ${need.ingredient_unit || 'kg'} depuis Economat (lot ${lot.lot_number})`]
            );

            lines.push({
              ...lineResult.rows[0],
              ingredient_name: need.ingredient_name,
              ingredient_unit: need.ingredient_unit,
              lot_number: lot.lot_number,
              supplier_lot_number: lot.supplier_lot_number,
              expiration_date: lot.expiration_date,
              stock_source: 'economat_transfer_required',
            });

            remaining -= take;
          }
        }

        // Étape 3 : Rupture vraie (Pesage + Economat insuffisants).
        // needed_quantity = remaining (portion non couverte uniquement, pas le besoin total) :
        // les portions deja couvertes par les lignes PESAGE/ECONOMAT_REQUIRES_TRANSFER ne doivent
        // pas etre re-comptabilisees ici — sinon double-comptage et fausse rupture.
        if (remaining > 0) {
          const lineResult = await client.query(
            `INSERT INTO production_bons_sortie_lignes
               (bon_id, ingredient_id, ingredient_lot_id, needed_quantity, allocated_quantity,
                unit, status, source_location, notes)
             VALUES ($1, $2, NULL, $3, 0, $4, 'rupture', 'RUPTURE', $5)
             RETURNING *`,
            [bon.id, need.ingredient_id, remaining, need.ingredient_unit || 'kg',
             `🚨 Rupture — manque ${remaining.toFixed(2)} ${need.ingredient_unit || 'kg'}`
             + (expiredQty > 0 ? ` (${expiredQty.toFixed(2)} ${need.ingredient_unit || 'kg'} en stock mais PERIME, non allouable)` : '')]
          );

          lines.push({
            ...lineResult.rows[0],
            ingredient_name: need.ingredient_name,
            ingredient_unit: need.ingredient_unit,
            lot_number: null,
            supplier_lot_number: null,
            expiration_date: null,
            stock_source: 'rupture',
          });
        }
      }

      // ─── Phase Emballages : ajouter les lignes BSI emballages ───
      // Pour chaque item du plan, on regarde la recette → recipe_packaging et
      // on calcule le besoin emballage au prorata de la qty produite. Une seule
      // ligne BSI par packaging_id, agregant les besoins de toutes les recettes.
      const planItemsResult = await client.query(
        `SELECT pi.product_id, pi.planned_quantity, r.id as recipe_id, r.yield_quantity
         FROM production_plan_items pi
         LEFT JOIN recipes r ON r.product_id = pi.product_id
         WHERE pi.plan_id = $1 AND r.id IS NOT NULL`,
        [planId]
      );

      const packagingNeedsMap = new Map<string, { qty: number; name: string; format: string | null; unit: string; unit_cost: number }>();
      for (const planItem of planItemsResult.rows) {
        const yieldQty = parseFloat(planItem.yield_quantity) || 1;
        const itemQty = parseFloat(planItem.planned_quantity);
        const pkResult = await client.query(
          `SELECT rp.packaging_id, rp.quantity, rp.unit,
                  pi.name, pi.format, pi.unit as base_unit, pi.unit_cost
           FROM recipe_packaging rp
           JOIN packaging_items pi ON pi.id = rp.packaging_id
           WHERE rp.recipe_id = $1`,
          [planItem.recipe_id]
        );
        for (const pk of pkResult.rows) {
          const needed = (parseFloat(pk.quantity) / yieldQty) * itemQty;
          const existing = packagingNeedsMap.get(pk.packaging_id) || {
            qty: 0, name: pk.name, format: pk.format, unit: pk.unit || pk.base_unit, unit_cost: parseFloat(pk.unit_cost),
          };
          existing.qty += needed;
          packagingNeedsMap.set(pk.packaging_id, existing);
        }
      }

      // Ajouter les lignes packaging au BSI (status='en_attente' ou 'rupture' selon stock)
      for (const [packagingId, need] of packagingNeedsMap) {
        const stockResult = await client.query(
          `SELECT COALESCE(stock_quantity, 0) as stock FROM packaging_store_stock
           WHERE packaging_id = $1 AND store_id = $2`,
          [packagingId, storeId]
        );
        const available = parseFloat(stockResult.rows[0]?.stock || '0');
        const allocated = Math.min(available, need.qty);
        const isRupture = allocated < need.qty;

        const lineResult = await client.query(
          `INSERT INTO production_bons_sortie_lignes
             (bon_id, ingredient_id, packaging_id, needed_quantity, allocated_quantity, unit, status, notes)
           VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            bon.id, packagingId, need.qty, allocated, need.unit,
            isRupture ? 'rupture' : 'en_attente',
            isRupture ? `⚠ Stock insuffisant : ${available.toFixed(2)} dispo / ${need.qty.toFixed(2)} besoin` : null,
          ]
        );

        lines.push({
          ...lineResult.rows[0],
          packaging_name: need.name,
          packaging_format: need.format,
          ingredient_name: need.name,  // alias pour compat UI existante
          ingredient_unit: need.unit,
          is_packaging: true,
        });
      }

      // 5. Link bon to plan
      await client.query(
        `UPDATE production_plans SET bon_sortie_id = $1 WHERE id = $2`,
        [bon.id, planId]
      );

      // 6. Si le BSI alloue tous les ingredients sans rupture, on leve le statut
      //    'waiting' pose au confirm() : la verification au confirm utilise une vue
      //    aggregee qui peut etre desynchronisee, mais le BSI est la source de verite
      //    (FEFO sur les vrais lots). On nettoie aussi le warning obsolete.
      const ruptureCheck = await client.query(
        `SELECT COUNT(*)::int AS rupture_count
         FROM production_bons_sortie_lignes
         WHERE bon_id = $1 AND source_location = 'RUPTURE'`,
        [bon.id]
      );
      const hasRupture = (ruptureCheck.rows[0]?.rupture_count ?? 0) > 0;
      if (!hasRupture) {
        await client.query(
          `UPDATE production_plan_items
              SET waiting_status = 'restored'
            WHERE plan_id = $1 AND waiting_status = 'waiting'`,
          [planId]
        );
        // Retire les warnings "ingredients insuffisants" du plan (obsoletes).
        await client.query(
          `UPDATE production_plans
              SET warnings = COALESCE(
                ARRAY(
                  SELECT w FROM unnest(warnings) AS w
                  WHERE w NOT LIKE '%ingredients insuffisants%'
                ), ARRAY[]::text[]
              )
            WHERE id = $1`,
          [planId]
        );
      }

      await client.query('COMMIT');
      return { ...bon, lines, expired_lots_skipped: expiredLotsSkipped };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ─── Historique magasinier : BSI ayant quitte la file active (chef a valide ou annule) ───
  // Statuts retournes : 'prelevement', 'verifie', 'cloture', 'annule'. Limite/offset pour pagination.
  /**
   * Historique magasinier (bons remis / clôturés / annulés), paginé et filtré côté serveur :
   * statut, recherche (N° de bon, demandeur, préparateur), période sur la date de fin.
   */
  async findHistoryForWarehouse(storeId: string, limit = 50, offset = 0,
    f: { status?: string; search?: string; dateFrom?: string; dateTo?: string } = {}) {
    const values: unknown[] = [storeId];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const cond = [`bs.store_id = $1`, `bs.status IN ('prelevement', 'verifie', 'cloture', 'annule')`];
    if (f.status) cond.push(`bs.status = ${add(f.status)}`);
    if (f.search) {
      const p = add(`%${f.search}%`);
      cond.push(`(bs.numero ILIKE ${p} OR concat_ws(' ', ug.first_name, ug.last_name) ILIKE ${p}
                 OR concat_ws(' ', up2.first_name, up2.last_name) ILIKE ${p} OR concat_ws(' ', up.first_name, up.last_name) ILIKE ${p})`);
    }
    if (f.dateFrom) cond.push(`COALESCE(bs.closed_at, bs.prelevement_at, bs.updated_at)::date >= ${add(f.dateFrom)}::date`);
    if (f.dateTo) cond.push(`COALESCE(bs.closed_at, bs.prelevement_at, bs.updated_at)::date <= ${add(f.dateTo)}::date`);
    const lim = add(limit);
    const off = add(offset);

    const result = await db.query(
      `SELECT bs.*,
              pp.plan_date, pp.type AS plan_type,
              ug.first_name || ' ' || ug.last_name AS generated_by_name,
              up2.first_name || ' ' || up2.last_name AS preparation_by_name,
              ur.first_name || ' ' || ur.last_name AS ready_by_name,
              up.first_name || ' ' || up.last_name AS prelevement_by_name,
              uc.first_name || ' ' || uc.last_name AS closed_by_name,
              (SELECT COUNT(*) FROM production_bons_sortie_lignes bsl WHERE bsl.bon_id = bs.id) AS total_lines,
              COUNT(*) OVER() AS total_count
       FROM production_bons_sortie bs
       LEFT JOIN production_plans pp ON pp.id = bs.plan_id
       LEFT JOIN users ug ON ug.id = bs.generated_by
       LEFT JOIN users up2 ON up2.id = bs.preparation_by
       LEFT JOIN users ur ON ur.id = bs.ready_by
       LEFT JOIN users up ON up.id = bs.prelevement_by
       LEFT JOIN users uc ON uc.id = bs.closed_by
       WHERE ${cond.join(' AND ')}
       ORDER BY COALESCE(bs.closed_at, bs.prelevement_at, bs.updated_at) DESC
       LIMIT ${lim} OFFSET ${off}`,
      values
    );
    const total = result.rows[0] ? parseInt(result.rows[0].total_count, 10) : 0;
    return { rows: result.rows.map(({ total_count: _t, ...r }) => r), total };
  },

  // ─── File d'attente magasinier : liste tous les BSI en attente de preparation ou en cours ───
  // Statuts retournes : 'genere' (a prendre en charge), 'preparation' (en cours),
  // 'pret' (en attente de validation chef). Permet au magasinier de voir sa file d'attente.
  async findActiveForWarehouse(storeId: string) {
    const result = await db.query(
      `SELECT bs.*,
              pp.plan_date, pp.type AS plan_type,
              ug.first_name || ' ' || ug.last_name AS generated_by_name,
              up2.first_name || ' ' || up2.last_name AS preparation_by_name,
              ur.first_name || ' ' || ur.last_name AS ready_by_name,
              (SELECT COUNT(*) FROM production_bons_sortie_lignes bsl WHERE bsl.bon_id = bs.id) AS total_lines
       FROM production_bons_sortie bs
       LEFT JOIN production_plans pp ON pp.id = bs.plan_id
       LEFT JOIN users ug ON ug.id = bs.generated_by
       LEFT JOIN users up2 ON up2.id = bs.preparation_by
       LEFT JOIN users ur ON ur.id = bs.ready_by
       WHERE bs.store_id = $1
         AND bs.status IN ('genere', 'preparation', 'preparation_partielle', 'pret')
       ORDER BY
         CASE bs.status
           WHEN 'genere' THEN 0
           WHEN 'preparation' THEN 1
           WHEN 'preparation_partielle' THEN 1
           WHEN 'pret' THEN 2
           ELSE 3
         END,
         bs.created_at ASC`,
      [storeId]
    );
    return result.rows;
  },

  // ─── Lignes BSI en attente de transfert Economat -> Pesage ───
  // Si storeId est fourni, filtre sur le store ; sinon (admin/manager multi-store) renvoie
  // les transferts de TOUS les stores. Listees dans l'onglet "Transferts demandes" du
  // module Pesage et du module Economat.
  // Statuts BSI inclus : genere/preparation/preparation_partielle/pret/prelevement.
  // 'prelevement' est inclus pour couvrir les BSI ou le chef a accepte la reception
  // mais qui ont commit_partial laissant des lignes ECONOMAT_REQUIRES_TRANSFER en attente.
  // Vue magasinier (module Economat, onglet "Ingredients a commander") :
  // toutes les lignes BSI actives en rupture totale (allocated=0 / lot=NULL),
  // groupables par BSI. Le magasinier peut declencher une commande fournisseur
  // depuis cette vue (centralisation au lieu d'agir BSI par BSI).
  //
  // IMPORTANT : on filtre les lignes dont le stock est REVENU entre temps
  // (apres reapprovisionnement / transfert). Ces lignes restent flaggees
  // 'rupture' cote BSI jusqu'a un "Re-verifier dispo", mais elles ne doivent
  // plus apparaitre dans cette vue puisqu'il n'y a plus rien a commander.
  // Le stock total (pesage + economat) doit etre < besoin pour rester affiche.
  async findRuptureRequests(storeId: string | null) {
    const result = await db.query(
      `SELECT bsl.id AS line_id,
              bsl.bon_id,
              bsl.ingredient_id,
              bsl.needed_quantity,
              bsl.allocated_quantity,
              bsl.unit,
              bsl.status AS line_status,
              bs.store_id,
              bs.numero AS bon_numero,
              bs.status AS bon_status,
              bs.plan_id,
              pp.plan_date, pp.type AS plan_type,
              s.name AS store_name,
              ing.name AS ingredient_name,
              ing.unit AS ingredient_unit,
              -- Indicateur "deja commande" : presence d'une purchase_request
              -- ouverte (pending/assigned/ordered) pour cet ingredient.
              EXISTS (
                SELECT 1 FROM purchase_requests pr
                 WHERE pr.ingredient_id = bsl.ingredient_id
                   AND pr.status IN ('pending', 'assigned', 'ordered')
                   AND (pr.store_id IS NULL OR pr.store_id = bs.store_id)
              ) AS already_ordered
       FROM production_bons_sortie_lignes bsl
       JOIN production_bons_sortie bs ON bs.id = bsl.bon_id
       LEFT JOIN production_plans pp ON pp.id = bs.plan_id
       LEFT JOIN stores s ON s.id = bs.store_id
       LEFT JOIN ingredients ing ON ing.id = bsl.ingredient_id
       WHERE ($1::uuid IS NULL OR bs.store_id = $1)
         AND bs.status IN ('genere', 'preparation', 'preparation_partielle', 'pret')
         AND bsl.ingredient_id IS NOT NULL
         AND bsl.status = 'rupture'
         AND bsl.ingredient_lot_id IS NULL
         AND COALESCE(bsl.allocated_quantity, 0) < 0.001
         -- Cache les lignes dont le stock est revenu (pesage + economat non perimes couvrent le besoin)
         AND COALESCE((
           SELECT SUM(COALESCE(il.pesage_quantity, 0) + COALESCE(il.economat_quantity, 0))
             FROM ingredient_lots il
            WHERE il.ingredient_id = bsl.ingredient_id
              AND il.store_id = bs.store_id
              AND ${lotUsableSql('il')}
         ), 0) < bsl.needed_quantity
       ORDER BY pp.plan_date ASC NULLS LAST, bs.numero ASC, ing.name ASC`,
      [storeId]
    );
    return result.rows;
  },

  async findEconomatTransferRequests(storeId: string | null) {
    const useStoreFilter = !!storeId;
    const result = await db.query(
      `SELECT bsl.id AS line_id,
              bsl.bon_id,
              bsl.ingredient_id,
              bsl.transfer_required_qty,
              bsl.unit,
              bsl.suggested_economat_lot_id,
              bs.store_id,
              bs.numero AS bon_numero,
              bs.status AS bon_status,
              bs.plan_id,
              pp.plan_date, pp.type AS plan_type,
              s.name AS store_name,
              ing.name AS ingredient_name,
              ing.unit AS ingredient_unit,
              ing.container_size,
              ing.container_type_id,
              ct.label AS container_type_label,
              il.lot_number AS suggested_lot_number,
              il.economat_quantity AS suggested_lot_economat_qty,
              il.expiration_date AS suggested_lot_dlc,
              -- Une demande d'achat est-elle deja en cours pour cet ingredient ? Permet au
              -- magasinier de commander le manquant quand l'economat ne couvre pas le
              -- besoin, sans creer de doublon. Meme convention que findRuptureRequests :
              -- 'received' et 'cancelled' sont terminaux et ne comptent pas (mig 271).
              EXISTS (
                SELECT 1 FROM purchase_requests pr
                 WHERE pr.ingredient_id = bsl.ingredient_id
                   AND pr.status IN ('pending', 'assigned', 'ordered')
                   AND (pr.store_id IS NULL OR pr.store_id = bs.store_id)
              ) AS already_ordered,
              -- Dispo economat TOTALE de l'ingredient, tous lots actifs confondus, moins ce
              -- que les AUTRES lignes du meme BSI ont deja reserve. Le lot suggere ne fait
              -- foi ni pour l'ecran ni pour le transfert : un reappro arrive dans un lot
              -- neuf, et se fier au seul lot suggere bloquait la ligne alors que le stock
              -- etait la (constat 18/08/2026 : ligne bloquee sur un lot a 18 kg alors que
              -- l'economat en detenait 289). transferLineFromEconomat bascule en FEFO sur
              -- un lot couvrant.
              COALESCE((
                SELECT SUM(il2.economat_quantity)
                  FROM ingredient_lots il2
                 WHERE il2.ingredient_id = bsl.ingredient_id
                   AND il2.store_id = bs.store_id
                   AND ${lotUsableSql('il2')}
                   AND il2.economat_quantity > 0
              ), 0) - COALESCE((
                SELECT SUM(bsl2.transfer_required_qty)
                  FROM production_bons_sortie_lignes bsl2
                 WHERE bsl2.bon_id = bsl.bon_id
                   AND bsl2.id <> bsl.id
                   AND bsl2.ingredient_id = bsl.ingredient_id
                   AND bsl2.source_location = 'ECONOMAT_REQUIRES_TRANSFER'
                   AND bsl2.status = 'en_attente'
              ), 0) AS economat_available_total
       FROM production_bons_sortie_lignes bsl
       JOIN production_bons_sortie bs ON bs.id = bsl.bon_id
       LEFT JOIN production_plans pp ON pp.id = bs.plan_id
       LEFT JOIN stores s ON s.id = bs.store_id
       LEFT JOIN ingredients ing ON ing.id = bsl.ingredient_id
       LEFT JOIN ref_entries ct ON ct.id = ing.container_type_id
       LEFT JOIN ingredient_lots il ON il.id = bsl.suggested_economat_lot_id
       WHERE ($1::uuid IS NULL OR bs.store_id = $1)
         AND bs.status IN ('genere', 'preparation', 'preparation_partielle', 'pret')
         AND bsl.source_location = 'ECONOMAT_REQUIRES_TRANSFER'
         AND bsl.status = 'en_attente'
       ORDER BY pp.plan_date ASC NULLS LAST, bs.numero ASC, ing.name ASC`,
      [useStoreFilter ? storeId : null]
    );
    return result.rows;
  },

  // ─── Get bon(s) for a plan with all lines ───
  async findByPlan(planId: string) {
    const result = await db.query(
      `SELECT bs.*,
              ug.first_name || ' ' || ug.last_name AS generated_by_name,
              up.first_name || ' ' || up.last_name AS prelevement_by_name,
              uv.first_name || ' ' || uv.last_name AS verified_by_name,
              uc.first_name || ' ' || uc.last_name AS closed_by_name
       FROM production_bons_sortie bs
       LEFT JOIN users ug ON ug.id = bs.generated_by
       LEFT JOIN users up ON up.id = bs.prelevement_by
       LEFT JOIN users uv ON uv.id = bs.verified_by
       LEFT JOIN users uc ON uc.id = bs.closed_by
       WHERE bs.plan_id = $1
       ORDER BY bs.created_at DESC`,
      [planId]
    );

    const bons = [];
    for (const bon of result.rows) {
      bons.push({ ...bon, lines: await loadBonLines(bon.id as string, bon.store_id as string) });
    }

    return bons;
  },

  // ─── Get a single bon with all lines and details ───
  async findById(bonId: string) {
    const result = await db.query(
      `SELECT bs.*,
              pp.plan_date, pp.type AS plan_type, pp.status AS plan_status,
              ug.first_name || ' ' || ug.last_name AS generated_by_name,
              up.first_name || ' ' || up.last_name AS prelevement_by_name,
              uv.first_name || ' ' || uv.last_name AS verified_by_name,
              uc.first_name || ' ' || uc.last_name AS closed_by_name
       FROM production_bons_sortie bs
       LEFT JOIN production_plans pp ON pp.id = bs.plan_id
       LEFT JOIN users ug ON ug.id = bs.generated_by
       LEFT JOIN users up ON up.id = bs.prelevement_by
       LEFT JOIN users uv ON uv.id = bs.verified_by
       LEFT JOIN users uc ON uc.id = bs.closed_by
       WHERE bs.id = $1`,
      [bonId]
    );

    if (result.rows.length === 0) return null;

    const bon = result.rows[0];

    return { ...bon, lines: await loadBonLines(bonId, bon.store_id as string) };
  },

  // ─── Acceptation de la reception par le chef : pret -> prelevement -> verifie -> cloture ───
  // UNE transaction pour les trois transitions. Le client enchainait trois appels :
  // un echec au milieu laissait le bon en 'prelevement' avec le stock deja consomme.
  // Idempotent : reprend la ou le bon en est (prelevement, verifie, cloture).
  async acceptReception(bonId: string, userId: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setActor(client, userId);
      const bon = await lockBon(client, bonId);
      if (!bon) throw new Error('Bon de sortie introuvable');
      let current = bon;
      if (current.status === 'cloture') { await client.query('COMMIT'); return current; }
      if (!['pret', 'prelevement', 'verifie'].includes(current.status)) {
        throw new Error(`Le bon doit etre pret a remettre pour accepter la reception (statut actuel : ${current.status})`);
      }
      if (current.status === 'pret') current = await applyPrelevement(client, bonId, userId);
      if (current.status === 'prelevement') current = await applyVerify(client, bonId, userId);
      current = await applyClose(client, bonId, userId);
      await client.query('COMMIT');
      return current;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ─── Magasinier : prendre en charge la preparation ───
  // Transition 'genere' -> 'preparation'. Le magasinier marque qu'il a vu la demande
  // et commence la preparation physique des ingredients en economat.
  async markAsPreparation(bonId: string, userId: string) {
    return withActor(userId, (client) =>
      transitionBon(client, bonId, 'preparation', { extraSet: 'preparation_by = $2, preparation_at = NOW()', params: [userId] }),
      'Prise en charge par le magasinier');
  },

  // ─── Magasinier : marquer comme pret a remettre ───
  // Transition 'preparation' -> 'pret'. Le magasinier a fini la preparation,
  // les ingredients sont prets a etre remis au chef (qui sera notifie).
  // Refuse si une ligne a encore source_location='ECONOMAT_REQUIRES_TRANSFER' :
  // le magasinier doit d'abord transferer (ouvrir le contenant) tous les ingredients
  // economat necessaires avant de marquer pret.
  async markAsReady(bonId: string, userId: string, options: { withMissing?: boolean } = {}) {
    // Le bon ne peut etre remis au chef que si chaque ligne INGREDIENT est pesee.
    // Deux blocages durs :
    //  - lignes encore a ouvrir (stock disponible en economat : il faut ouvrir et peser)
    //  - lignes non pesees
    // Les lignes en RUPTURE (rien en stock) ne bloquent plus a vie : avec
    // `withMissing`, le magasinier remet le bon en signalant les manquants, et c'est
    // le chef qui decide a la reception (produire sans / refuser). Avant, une rupture
    // sur un ingredient mineur figeait tout le plan jusqu'au reapprovisionnement.
    // Les lignes emballage sont informatives (stock consomme a la remise), elles
    // n'ont jamais a etre pesees et ne bloquent pas.
    return withActor(userId, async (client) => {
    const current = await lockBon(client, bonId);
    if (!current) throw new Error('Bon de sortie introuvable');
    if (current.status === 'preparation_partielle') {
      // Un bon valide en partiel revient en preparation avant d'etre remis.
      await transitionBon(client, bonId, 'preparation', { reason: 'Reprise avant remise au chef' });
    }
    const blockersResult = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE source_location = 'ECONOMAT_REQUIRES_TRANSFER' AND status = 'en_attente')::int AS pending_transfers,
         COUNT(*) FILTER (WHERE status = 'rupture')::int AS rupture_lines,
         COUNT(*) FILTER (WHERE status = 'en_attente' AND source_location IS DISTINCT FROM 'ECONOMAT_REQUIRES_TRANSFER')::int AS waiting_lines
       FROM production_bons_sortie_lignes
       WHERE bon_id = $1 AND status != 'annule' AND ingredient_id IS NOT NULL`,
      [bonId]
    );
    const blockers = blockersResult.rows[0] || {};
    const pendingTransfers = blockers.pending_transfers ?? 0;
    const ruptureLines = blockers.rupture_lines ?? 0;
    const waitingLines = blockers.waiting_lines ?? 0;
    if (pendingTransfers > 0) {
      throw new Error(`Impossible de remettre au chef : ${pendingTransfers} ingredient(s) encore a ouvrir depuis l'economat (le stock existe).`);
    }
    if (waitingLines > 0) {
      throw new Error(`Impossible de remettre au chef : ${waitingLines} ingredient(s) non encore pese(s).`);
    }
    if (ruptureLines > 0 && !options.withMissing) {
      throw new Error(`Impossible de remettre au chef : ${ruptureLines} ingredient(s) manquant(s). Commandez-les, ou remettez le bon en signalant les manquants.`);
    }

    // Le refus chef precedent est conserve dans le journal (mig 299) : on peut
    // donc le nettoyer sur le bon sans perdre l'historique.
    const bon = await transitionBon(client, bonId, 'pret', {
      extraSet: 'ready_by = $2, ready_at = NOW(), chef_reject_reason = NULL, chef_reject_at = NULL, chef_reject_by = NULL',
      params: [userId],
      reason: ruptureLines > 0 ? `Bon remis avec ${ruptureLines} ingredient(s) manquant(s)` : undefined,
    });

    // Plan : awaiting_ingredients -> ready_to_produce, dans la MEME transaction que le bon.
    if (bon.plan_id) {
      const p = await client.query(`SELECT status FROM production_plans WHERE id = $1 FOR UPDATE`, [bon.plan_id]);
      if (p.rows[0]?.status === 'awaiting_ingredients') {
        await transitionPlan(client, bon.plan_id, 'ready_to_produce', { reason: `Bon ${bon.numero} pret a remettre` });
      }
    }
    return bon;
    }, 'Bon pret a remettre');
  },

  // Delta v1 point 4 : lister les lots Economat disponibles pour une ligne BSI,
  // tries FEFO (date d'expiration la plus proche en premier). Le magasinier peut
  // utiliser ce listing pour confirmer le lot suggere ou en choisir un autre.
  async listEconomatLotsForLigne(ligneId: string) {
    const lineResult = await db.query(
      `SELECT bsl.ingredient_id, bsl.suggested_economat_lot_id, bs.store_id
       FROM production_bons_sortie_lignes bsl
       JOIN production_bons_sortie bs ON bs.id = bsl.bon_id
       WHERE bsl.id = $1`,
      [ligneId]
    );
    if (lineResult.rows.length === 0) {
      throw new Error('Ligne BSI introuvable');
    }
    const line = lineResult.rows[0];

    const lotsResult = await db.query(
      `SELECT il.id, il.lot_number, il.supplier_lot_number, il.economat_quantity, il.expiration_date,
              il.received_at, il.first_opened_at, il.status,
              (il.id = $3) AS is_suggested
       FROM ingredient_lots il
       WHERE il.ingredient_id = $1 AND il.store_id = $2
         AND ${lotUsableSql('il')} AND il.economat_quantity > 0
       ORDER BY il.expiration_date ASC NULLS LAST, il.received_at ASC`,
      [line.ingredient_id, line.store_id, line.suggested_economat_lot_id]
    );
    return lotsResult.rows;
  },

  // ─── Lots utilisables pour une ligne, toutes zones (selecteur « Autre lot ») ───
  // Un lot deja ouvert (pesage > 0) se pese directement ; un lot scelle (economat)
  // sera ouvert au moment de la pesee. Les lots perimes sont renvoyes, marques
  // `is_expired`, pour que l'ecran explique pourquoi ils ne sont pas proposes.
  // Le pesage LIBRE exclut ce que les autres lignes du meme bon reservent deja.
  async listLotsForLigne(ligneId: string) {
    const lineResult = await db.query(
      `SELECT bsl.id, bsl.bon_id, bsl.ingredient_id, bsl.ingredient_lot_id, bsl.suggested_economat_lot_id, bs.store_id
       FROM production_bons_sortie_lignes bsl
       JOIN production_bons_sortie bs ON bs.id = bsl.bon_id
       WHERE bsl.id = $1`,
      [ligneId]
    );
    const line = lineResult.rows[0];
    if (!line) throw new Error('Ligne BSI introuvable');
    if (!line.ingredient_id) return [];
    const lotsResult = await db.query(
      `SELECT il.id, il.lot_number, il.supplier_lot_number, il.expiration_date, il.received_at,
              il.first_opened_at, il.status, il.economat_quantity,
              GREATEST(0, il.pesage_quantity - COALESCE((
                SELECT SUM(bsl2.allocated_quantity)
                  FROM production_bons_sortie_lignes bsl2
                 WHERE bsl2.bon_id = $3 AND bsl2.id <> $4
                   AND bsl2.ingredient_lot_id = il.id
                   AND bsl2.source_location = 'PESAGE'
                   AND bsl2.status IN ('en_attente', 'preleve', 'substitue', 'ecart')
              ), 0)) AS pesage_free,
              ${lotExpiredSql('il')} AS is_expired,
              (il.id = $5) AS is_current,
              (il.id = $6) AS is_suggested
         FROM ingredient_lots il
        WHERE il.ingredient_id = $1 AND il.store_id = $2
          AND il.status IN ('active', 'expired')
          AND il.pesage_quantity + il.economat_quantity > 0
        ORDER BY ${lotExpiredSql('il')} ASC, (il.pesage_quantity > 0) DESC,
                 il.expiration_date ASC NULLS LAST, il.first_opened_at ASC NULLS FIRST, il.received_at ASC`,
      [line.ingredient_id, line.store_id, line.bon_id, line.id, line.ingredient_lot_id, line.suggested_economat_lot_id]
    );
    return lotsResult.rows;
  },

  // ─── Magasinier : ouvrir un contenant pour une ligne BSI (Economat -> Pesage) ───
  // Utilise par la vue groupee du module Economat (TransferRequestsList). Depuis le
  // poste de pesee, l'ouverture se fait directement au moment de la pesee
  // (applyWeighing), en une seule action.
  // Le lot suggere est fige a la generation du BSI : un reappro arrive dans un lot
  // NEUF, et le lot d'origine peut ne plus couvrir le besoin. Sans choix explicite
  // du magasinier on retombe en FEFO sur un lot actif non perime capable de couvrir.
  async transferLineFromEconomat(
    ligneId: string,
    userId: string,
    options: { overrideLotId?: string; overrideQty?: number; reason?: string; containerCount?: number; containerTypeId?: string } = {},
  ) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setActor(client, userId);

      const lineResult = await client.query(
        `SELECT bsl.id, bsl.bon_id, bsl.ingredient_id, bsl.suggested_economat_lot_id,
                bsl.transfer_required_qty, bsl.source_location, bsl.status, bsl.unit, bsl.needed_quantity,
                bs.store_id, bs.numero AS bon_numero, bs.plan_id, bs.status AS bon_status
         FROM production_bons_sortie_lignes bsl
         JOIN production_bons_sortie bs ON bs.id = bsl.bon_id
         WHERE bsl.id = $1
         FOR UPDATE OF bsl`,
        [ligneId]
      );
      const line = lineResult.rows[0];
      if (!line) throw new Error('Ligne BSI introuvable');
      if (!['genere', 'preparation', 'preparation_partielle'].includes(line.bon_status)) {
        throw new Error(`Bon de sortie au statut "${line.bon_status}" : plus de transfert possible.`);
      }
      if (line.source_location !== 'ECONOMAT_REQUIRES_TRANSFER' || line.status !== 'en_attente') {
        throw new Error(`Cette ligne n'attend pas de transfert (source actuelle : ${line.source_location})`);
      }

      const requiredQty = parseFloat(line.transfer_required_qty);
      const requestedQty = options.overrideQty != null ? Number(options.overrideQty) : requiredQty;
      if (!Number.isFinite(requestedQty) || requestedQty <= 0) throw new Error('Quantite de transfert invalide');
      if (requestedQty + 1e-9 < requiredQty) {
        throw new Error(`Quantite insuffisante : ${requestedQty} < ${requiredQty} requis pour cette ligne BSI`);
      }

      let lotId: string | null = options.overrideLotId || line.suggested_economat_lot_id;
      if (!options.overrideLotId) {
        const suggested = lotId
          ? await client.query(
              `SELECT il.economat_quantity FROM ingredient_lots il WHERE il.id = $1 AND ${lotUsableSql('il')}`, [lotId])
          : { rows: [] as Record<string, unknown>[] };
        const suggestedQty = suggested.rows[0] ? parseFloat(suggested.rows[0].economat_quantity as string) : 0;
        if (suggestedQty + 1e-9 < requestedQty) {
          const fallback = await client.query(
            `SELECT il.id FROM ingredient_lots il
              WHERE il.ingredient_id = $1 AND il.store_id = $2 AND ${lotUsableSql('il')}
                AND il.economat_quantity >= $3
              ORDER BY il.expiration_date ASC NULLS LAST, il.created_at ASC
              LIMIT 1`,
            [line.ingredient_id, line.store_id, requestedQty],
          );
          if (fallback.rows[0]) lotId = fallback.rows[0].id as string;
        }
      }
      if (!lotId) throw new Error('Aucun lot Economat a transferer (lot suggere absent)');

      const move = {
        lotId, ingredientId: line.ingredient_id, storeId: line.store_id, qty: requestedQty, userId,
        bonId: line.bon_id, ligneId, planId: line.plan_id,
        reason: options.reason || `BSI ${line.bon_numero}`,
        containerCount: options.containerCount || null, containerTypeId: options.containerTypeId || null,
      };
      const lot = await moveEconomatToPesage(client, move);
      const movedQty = move.qty;

      // allocated_quantity = besoin BSI, pas le total transfere : le surplus reste au
      // pesage et sera consommable par les prochains bons.
      const updatedLine = await client.query(
        `UPDATE production_bons_sortie_lignes
         SET ingredient_lot_id = $1,
             allocated_quantity = $2,
             source_location = 'PESAGE',
             transferred_at = NOW(),
             transferred_by = $3,
             notes = $4,
             updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [lotId, requiredQty, userId,
         `Transfere depuis Economat (lot ${lot.lot_number}, ${movedQty.toFixed(2)} ${line.unit || 'kg'}) le ${new Date().toLocaleDateString('fr-FR')}${options.reason ? ` — ${options.reason}` : ''}`,
         ligneId]
      );

      await client.query('COMMIT');
      return updatedLine.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ─── Chef : refuser la reception (non-conformite) ───
  // Transition 'pret' -> 'preparation' avec motif. Le chef signale une non-conformite
  // (quantite, qualite, substitution non acceptable) et renvoie le BSI au magasinier
  // pour ajustement. Le motif est trace pour l'audit.
  async chefReject(bonId: string, userId: string, reason: string) {
    return withActor(userId, async (client) => {
      await lockBon(client, bonId);
      const bon = await transitionBon(client, bonId, 'preparation', {
        extraSet: 'chef_reject_by = $2, chef_reject_at = NOW(), chef_reject_reason = $3, ready_by = NULL, ready_at = NULL',
        params: [userId, reason],
      });
      // Plan : ready_to_produce -> awaiting_ingredients, meme transaction.
      if (bon.plan_id) {
        const p = await client.query(`SELECT status FROM production_plans WHERE id = $1 FOR UPDATE`, [bon.plan_id]);
        if (p.rows[0]?.status === 'ready_to_produce') {
          await transitionPlan(client, bon.plan_id, 'awaiting_ingredients', { reason: `Refus chef sur ${bon.numero}` });
        }
      }
      return bon;
    }, `Refus chef : ${reason}`);
  },

  // ─── Pesage d'une ligne : UNE action = (ouvrir le contenant si besoin) + mesurer ───
  //
  // `actualQuantity` est le poids reellement pese (clavier aujourd'hui, balance
  // connectee demain — seul `source` changera). Regle : bande SYMETRIQUE autour de
  // la cible, de demi-largeur fn_weighing_tolerance(). Dans la bande -> 'preleve'
  // (l'ecart mesure est conserve). Hors bande -> 'ecart' + motif OBLIGATOIRE. La
  // tolerance retenue est figee sur la ligne.
  //
  // Avant, une ligne « a transferer » exigeait un detour par le module Economat
  // (transfert), puis un retour au bon pour peser. Ici, peser une ligne dont le stock
  // est en economat OUVRE le contenant dans la meme transaction :
  //   - lot = `lotId` choisi par le magasinier (« Autre lot »), sinon le lot suggere,
  //     sinon le meilleur lot FEFO non perime ;
  //   - quantite ouverte = `transferQty` si saisie, sinon des contenants entiers quand
  //     l'ingredient est defini par contenant (`containerCount` ou arrondi au
  //     contenant superieur), sinon exactement le manque. Le reliquat reste au pesage.
  // Un `lotId` different du lot alloue sur une ligne deja au pesage = substitution de
  // lot (le lot reellement attrape), tracee dans les notes de la ligne.
  async applyWeighing(
    client: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, any>[] }> },
    ligneId: string,
    actualQuantity: number,
    userId: string | null,
    options: {
      notes?: string; tareQuantity?: number; reason?: string; source?: 'manual' | 'scale';
      lotId?: string; transferQty?: number; containerCount?: number; containerTypeId?: string;
    } = {},
  ) {
    const lineResult = await client.query(
      `SELECT bsl.id, bsl.bon_id, bsl.allocated_quantity, bsl.needed_quantity, bsl.transfer_required_qty,
              bsl.ingredient_id, bsl.ingredient_lot_id, bsl.suggested_economat_lot_id, bsl.unit,
              bsl.source_location, bsl.status AS line_status, bsl.notes,
              ing.name AS ingredient_name, ing.container_size, ing.container_type_id,
              il.status AS lot_status, il.lot_number AS lot_number,
              (il.id IS NOT NULL AND ${lotExpiredSql('il')}) AS lot_expired,
              bs.status AS bon_status, bs.store_id, bs.plan_id, bs.numero AS bon_numero
         FROM production_bons_sortie_lignes bsl
         LEFT JOIN ingredients ing ON ing.id = bsl.ingredient_id
         LEFT JOIN ingredient_lots il ON il.id = bsl.ingredient_lot_id
         JOIN production_bons_sortie bs ON bs.id = bsl.bon_id
        WHERE bsl.id = $1
        FOR UPDATE OF bsl`,
      [ligneId]
    );
    const line = lineResult.rows[0];
    if (!line) throw new Error('Ligne de bon de sortie introuvable');
    if (!line.ingredient_id) throw new Error('Les lignes emballage ne se pesent pas : elles sont consommees a la remise du bon.');

    // Garde-fou : on ne pese plus une ligne dont le BSI a quitte la preparation.
    // Sans ce controle, on pouvait modifier actual_quantity APRES que le stock ait
    // ete decremente (le decrement se fait a l'acceptation du chef).
    if (!['genere', 'preparation', 'preparation_partielle'].includes(line.bon_status)) {
      throw new Error(`Bon de sortie au statut "${line.bon_status}" : la pesee n'est plus modifiable.`);
    }
    if (!Number.isFinite(actualQuantity) || actualQuantity < 0) throw new Error('Quantite pesee invalide');

    const unit = line.unit || 'kg';
    const isOpening = line.source_location === 'ECONOMAT_REQUIRES_TRANSFER';
    const isRupture = line.line_status === 'rupture' && !line.ingredient_lot_id;
    // Cible de la pesee : l'allocation ; pour une ligne a ouvrir ou en rupture
    // (allocated = 0), le besoin de la ligne.
    const target = isOpening
      ? parseFloat(line.transfer_required_qty ?? line.needed_quantity ?? '0')
      : isRupture ? parseFloat(line.needed_quantity || '0')
      : parseFloat(line.allocated_quantity || '0');

    // Lot a utiliser.
    let lotId: string | null = options.lotId || null;
    if (!lotId && isOpening) {
      // Stock deja mis au pesage a l'avance (TransferToPesage) : on le prend en
      // priorite (FEFO), sinon on ouvrira le lot suggere.
      const staged = await client.query(
        `SELECT il.id FROM ingredient_lots il
          WHERE il.ingredient_id = $1 AND il.store_id = $2 AND ${lotUsableSql('il')}
            AND il.pesage_quantity - COALESCE((
              SELECT SUM(bsl2.allocated_quantity) FROM production_bons_sortie_lignes bsl2
               WHERE bsl2.bon_id = $3 AND bsl2.id <> $4 AND bsl2.ingredient_lot_id = il.id
                 AND bsl2.source_location = 'PESAGE' AND bsl2.status IN ('en_attente', 'preleve', 'substitue', 'ecart')
            ), 0) >= $5
          ORDER BY il.expiration_date ASC NULLS LAST, il.first_opened_at ASC NULLS FIRST, il.received_at ASC
          LIMIT 1`,
        [line.ingredient_id, line.store_id, line.bon_id, line.id, actualQuantity]
      );
      lotId = (staged.rows[0]?.id as string | undefined) || line.suggested_economat_lot_id || null;
    }
    if (!lotId && isRupture) {
      throw new Error(`${line.ingredient_name} : aucun stock n'etait disponible. Choisissez un lot si du stock est arrive, sinon signalez le manquant au chef.`);
    }
    if (!lotId) lotId = line.ingredient_lot_id;

    let openedQty = 0;
    let lotChanged = false;
    let newLotNumber: string | null = null;
    const noteParts: string[] = [];

    if (lotId !== line.ingredient_lot_id || isOpening) {
      // Lot choisi, suggere ou a ouvrir : on le verrouille et on verifie qu'il
      // peut servir cette pesee (zone pesage libre, sinon ouverture depuis l'economat).
      const lotRes = await client.query(
        `SELECT il.id, il.ingredient_id, il.store_id, il.status, il.lot_number,
                il.pesage_quantity, il.economat_quantity, il.expiration_date,
                ${lotExpiredSql('il')} AS is_expired,
                GREATEST(0, il.pesage_quantity - COALESCE((
                  SELECT SUM(bsl2.allocated_quantity)
                    FROM production_bons_sortie_lignes bsl2
                   WHERE bsl2.bon_id = $2 AND bsl2.id <> $3
                     AND bsl2.ingredient_lot_id = il.id
                     AND bsl2.source_location = 'PESAGE'
                     AND bsl2.status IN ('en_attente', 'preleve', 'substitue', 'ecart')
                ), 0)) AS pesage_free
           FROM ingredient_lots il
          WHERE il.id = $1
          FOR UPDATE`,
        [lotId, line.bon_id, line.id]
      );
      let lot = lotRes.rows[0];
      // Lot suggere disparu ou insuffisant (reappro dans un lot neuf) : FEFO sur un
      // lot non perime qui couvre la pesee, pesage libre d'abord puis economat.
      const lotCovers = (l: Record<string, any> | undefined) => !!l && l.status === 'active' && !l.is_expired
        && l.ingredient_id === line.ingredient_id && l.store_id === line.store_id
        && parseFloat(l.pesage_free) + parseFloat(l.economat_quantity) + 1e-9 >= actualQuantity;
      if (!options.lotId && !lotCovers(lot)) {
        const fallback = await client.query(
          `SELECT il.id FROM ingredient_lots il
            WHERE il.ingredient_id = $1 AND il.store_id = $2 AND ${lotUsableSql('il')}
              AND il.pesage_quantity + il.economat_quantity >= $3
            ORDER BY (il.pesage_quantity >= $3) DESC, il.expiration_date ASC NULLS LAST, il.received_at ASC
            LIMIT 1`,
          [line.ingredient_id, line.store_id, actualQuantity]
        );
        if (fallback.rows[0] && fallback.rows[0].id !== lotId) {
          lotId = fallback.rows[0].id as string;
          const again = await client.query(
            `SELECT il.id, il.ingredient_id, il.store_id, il.status, il.lot_number,
                    il.pesage_quantity, il.economat_quantity, il.expiration_date,
                    ${lotExpiredSql('il')} AS is_expired,
                    GREATEST(0, il.pesage_quantity - COALESCE((
                      SELECT SUM(bsl2.allocated_quantity)
                        FROM production_bons_sortie_lignes bsl2
                       WHERE bsl2.bon_id = $2 AND bsl2.id <> $3
                         AND bsl2.ingredient_lot_id = il.id
                         AND bsl2.source_location = 'PESAGE'
                         AND bsl2.status IN ('en_attente', 'preleve', 'substitue', 'ecart')
                    ), 0)) AS pesage_free
               FROM ingredient_lots il WHERE il.id = $1 FOR UPDATE`,
            [lotId, line.bon_id, line.id]
          );
          lot = again.rows[0];
        }
      }
      if (!lot) throw new Error('Lot introuvable');
      if (lot.ingredient_id !== line.ingredient_id) throw new Error('Le lot ne correspond pas a l\'ingredient de la ligne');
      if (lot.store_id !== line.store_id) throw new Error('Le lot n\'appartient pas au magasin du bon');
      if (lot.status !== 'active') throw new Error(`Lot ${lot.lot_number} non actif (${lot.status})`);
      if (lot.is_expired) throw new Error(`Lot ${lot.lot_number} perime (DLC ${lot.expiration_date}) : prelevement interdit, choisissez un autre lot.`);

      const pesageFree = parseFloat(lot.pesage_free || '0');
      const shortfall = actualQuantity - pesageFree;
      if (shortfall > 1e-9) {
        // Il faut ouvrir : des contenants entiers quand l'ingredient en a, sinon le manque.
        const containerSize = line.container_size != null ? parseFloat(line.container_size) : 0;
        let qty: number;
        if (options.transferQty != null && Number.isFinite(Number(options.transferQty))) {
          qty = Number(options.transferQty);
        } else if (options.containerCount && containerSize > 0) {
          qty = Number(options.containerCount) * containerSize;
        } else if (containerSize > 0) {
          qty = Math.ceil(shortfall / containerSize - 1e-9) * containerSize;
        } else {
          qty = shortfall;
        }
        const economat = parseFloat(lot.economat_quantity || '0');
        // Le dernier contenant d'un lot peut etre entame : on ne depasse jamais l'economat.
        qty = Math.min(qty, economat);
        if (qty + 1e-9 < shortfall) {
          throw new Error(`${line.ingredient_name} : le lot ${lot.lot_number} ne couvre pas la pesee (${pesageFree.toFixed(3)} ${unit} au pesage + ${economat.toFixed(3)} ${unit} en economat pour ${actualQuantity.toFixed(3)} ${unit}).`);
        }
        const move = {
          lotId: lot.id, ingredientId: line.ingredient_id, storeId: line.store_id, qty, userId: userId as string,
          bonId: line.bon_id, ligneId: line.id, planId: line.plan_id,
          reason: `BSI ${line.bon_numero} — ouverture au pesage`,
          containerCount: options.containerCount ?? (containerSize > 0 ? Math.round(qty / containerSize) : null),
          containerTypeId: options.containerTypeId ?? line.container_type_id ?? null,
        };
        await moveEconomatToPesage(client as unknown as PoolClient, move);
        qty = move.qty; // quantite reellement ouverte (contenants entiers)
        openedQty = qty;
        noteParts.push(`Ouvert ${qty.toFixed(2)} ${unit} depuis l'economat (lot ${lot.lot_number})`);
      }
      lotChanged = lotId !== line.ingredient_lot_id;
      newLotNumber = lot.lot_number;
      if (lotChanged && line.ingredient_lot_id) {
        noteParts.push(`Lot substitue : ${line.lot_number || '?'} -> ${lot.lot_number}`);
      }
    } else if (line.lot_expired) {
      throw new Error(`Lot ${line.lot_number} perime : prelevement interdit, choisissez un autre lot.`);
    }

    // Tolerance calculee par la fonction SQL — meme source que celle affichee a l'ecran.
    const tolResult = await client.query(
      `SELECT fn_weighing_tolerance($1, $2::numeric, $3) AS tolerance`,
      [line.ingredient_id, target, unit]
    );
    const tolerance = parseFloat(tolResult.rows[0]?.tolerance || '0');
    const ecart = actualQuantity - target;
    // Marge de 1e-9 : une saisie pile sur la borne ne doit pas tomber du mauvais cote.
    const outOfBand = Math.abs(ecart) > tolerance + 1e-9;
    const reason = options.reason?.trim() || null;
    if (outOfBand && !reason) {
      const fmt = (v: number) => v.toFixed(Math.abs(v) < 1 ? 3 : 2);
      throw new Error(
        `Quantite hors tolerance pour ${line.ingredient_name || 'cet ingredient'} : ` +
        `${fmt(actualQuantity)} ${unit} pese pour une cible de ${fmt(target)} ` +
        `(tolerance ±${fmt(tolerance)}) — un motif est obligatoire.`
      );
    }
    const status = outOfBand ? 'ecart' : 'preleve';
    const notes = [options.notes, ...noteParts].filter(Boolean).join(' | ') || null;

    const result = await client.query(
      `UPDATE production_bons_sortie_lignes
          SET actual_quantity   = $1,
              ecart_quantity    = $2,
              status            = $3,
              notes             = CASE WHEN $4::text IS NULL THEN notes ELSE COALESCE(notes || ' | ', '') || $4 END,
              tare_quantity     = $5,
              weighed_at        = NOW(),
              weighed_by        = $6,
              weighing_source   = $7,
              tolerance_applied = $8,
              ecart_reason      = $9,
              ingredient_lot_id = $11,
              allocated_quantity = $12,
              source_location   = 'PESAGE',
              transferred_at    = CASE WHEN $13::numeric > 0 THEN NOW() ELSE transferred_at END,
              transferred_by    = CASE WHEN $13::numeric > 0 THEN $6 ELSE transferred_by END,
              updated_at        = NOW()
        WHERE id = $10
        RETURNING *`,
      [
        actualQuantity, ecart, status, notes,
        options.tareQuantity ?? null, userId, options.source || 'manual',
        tolerance, reason, ligneId,
        lotId, target, openedQty,
      ]
    );
    return { ...result.rows[0], out_of_tolerance: outOfBand, tolerance_qty: tolerance, opened_qty: openedQty, lot_changed: lotChanged, lot_number: newLotNumber || line.lot_number };
  },

  /** Pesee d'une seule ligne (transaction autonome). */
  async updateLigne(
    ligneId: string,
    actualQuantity: number,
    userId: string | null,
    options: { notes?: string; tareQuantity?: number; reason?: string; source?: 'manual' | 'scale'; lotId?: string; transferQty?: number; containerCount?: number; containerTypeId?: string } = {},
  ) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setActor(client, userId);
      const row = await this.applyWeighing(client, ligneId, actualQuantity, userId, options);
      await client.query('COMMIT');
      return row;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ─── Enregistrement groupe des pesees d'un BSI (une seule transaction) ───
  // Remplace la boucle de N appels HTTP sequentiels du bouton "Tout conforme".
  // Tout ou rien : si une ligne est hors tolerance sans motif, rien n'est enregistre
  // et le message nomme l'ingredient fautif.
  async weighLignes(
    bonId: string,
    userId: string | null,
    entries: Array<{ ligneId: string; actualQuantity: number; tareQuantity?: number; reason?: string; source?: 'manual' | 'scale'; lotId?: string; transferQty?: number; containerCount?: number }>,
  ) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setActor(client, userId);

      // Toutes les lignes doivent appartenir au BSI cible : evite qu'un payload
      // bricole des lignes d'un autre bon (voire d'un autre magasin).
      const owned = await client.query(
        `SELECT id FROM production_bons_sortie_lignes
          WHERE bon_id = $1 AND id = ANY($2::uuid[])`,
        [bonId, entries.map(e => e.ligneId)]
      );
      if (owned.rows.length !== entries.length) {
        throw new Error('Ligne BSI n\'appartenant pas a ce bon de sortie');
      }

      const results = [];
      for (const entry of entries) {
        results.push(await this.applyWeighing(client, entry.ligneId, entry.actualQuantity, userId, {
          tareQuantity: entry.tareQuantity,
          reason: entry.reason,
          source: entry.source,
          lotId: entry.lotId,
          transferQty: entry.transferQty,
          containerCount: entry.containerCount,
        }));
      }

      await client.query('COMMIT');
      return {
        weighed: results.length,
        outOfTolerance: results.filter(r => r.out_of_tolerance).length,
        lines: results,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ─── BSI partiel : commit ce qui est preleve, garde le reste en attente d'approvisionnement ───
  // Transition autorisee depuis 'preparation' (ou 'preparation_partielle' pour re-commit
  // apres modifications). Logique :
  //   - Les lignes 'preleve' / 'substitue' / 'ecart' sont conservees telles quelles
  //   - Les lignes 'en_attente' (non encore touchees) sont gardees pour la suite
  //   - Les lignes 'rupture' (FEFO insuffisant) restent rupture jusqu'au reapprov
  //   - Le BSI passe en 'preparation_partielle' pour que le manager voie qu'il y a un blocage
  // Refuse si AUCUNE ligne n'est preleve/ecart/substitue (rien a commiter).
  async commitPartial(bonId: string, userId: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setActor(client, userId);

      const current = await client.query(
        `SELECT * FROM production_bons_sortie WHERE id = $1 FOR UPDATE`,
        [bonId]
      );
      if (current.rows.length === 0) throw new Error('Bon de sortie introuvable');
      const bonStatus = current.rows[0].status;
      if (!['preparation', 'preparation_partielle'].includes(bonStatus)) {
        throw new Error(`Statut invalide pour commit partiel : ${bonStatus}`);
      }

      // Au moins 1 ligne doit avoir ete prelevee
      const counts = await client.query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('preleve', 'substitue', 'ecart')) AS done,
           COUNT(*) FILTER (WHERE status IN ('en_attente', 'rupture')) AS pending
         FROM production_bons_sortie_lignes WHERE bon_id = $1`,
        [bonId]
      );
      const done = parseInt(counts.rows[0].done);
      const pending = parseInt(counts.rows[0].pending);
      if (done === 0) {
        throw new Error('Aucune ligne prelevee — commit partiel refuse');
      }
      if (pending === 0) {
        throw new Error('Aucune ligne en attente — utilisez "Pret pour livraison" plutot');
      }

      // Depuis 'preparation' : transition ; depuis 'preparation_partielle' (re-commit) :
      // statut inchange, on ne fait que dater.
      const cur = await client.query(`SELECT status FROM production_bons_sortie WHERE id = $1`, [bonId]);
      let bonRow: Record<string, any>;
      if (cur.rows[0]?.status === 'preparation_partielle') {
        const r = await client.query(
          `UPDATE production_bons_sortie SET partial_committed_by = $1, partial_committed_at = NOW(), updated_at = NOW()
            WHERE id = $2 RETURNING *`, [userId, bonId]);
        bonRow = r.rows[0];
      } else {
        bonRow = await transitionBon(client, bonId, 'preparation_partielle', {
          extraSet: 'partial_committed_by = $2, partial_committed_at = NOW()', params: [userId],
          reason: `Validation partielle : ${done} ligne(s) prelevee(s), ${pending} en attente`,
        });
      }

      await client.query('COMMIT');
      return { ...bonRow, done_count: done, pending_count: pending };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ─── BSI partiel : compléter les lignes en attente après réapprovisionnement ───
  // Refait le FEFO sur les lignes 'en_attente' et 'rupture', alloue depuis le stock
  // qui vient d'arriver. Les lignes en rupture qui restent en rupture sont gardees.
  // Si TOUTES les lignes sont desormais allouees (pas de rupture restante) on peut
  // remettre le BSI en 'preparation' (le magasinier doit refinaliser le prelevement)
  // ou directement en 'pret' si toutes les lignes sont deja prelevees.
  async completePending(bonId: string, userId: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setActor(client, userId);

      const current = await client.query(
        `SELECT bs.*, p.id as plan_id_check FROM production_bons_sortie bs
         LEFT JOIN production_plans p ON p.id = bs.plan_id
         WHERE bs.id = $1 FOR UPDATE OF bs`,
        [bonId]
      );
      if (current.rows.length === 0) throw new Error('Bon de sortie introuvable');
      // Autorise depuis preparation OU preparation_partielle. Le magasinier peut
      // re-verifier la dispo des qu'il a transferé/reapprovisionné, sans devoir
      // d'abord prelever et commit_partial.
      if (!['preparation', 'preparation_partielle'].includes(current.rows[0].status)) {
        throw new Error(`Statut invalide pour complete-pending : ${current.rows[0].status}`);
      }
      const storeId = current.rows[0].store_id;

      // 1. Recupere les lignes en attente / rupture avec leur ingredient.
      //    Inclut source_location pour pouvoir recycler les lignes ECONOMAT_REQUIRES_TRANSFER
      //    dont le pesage a ete reapprovisionne entre-temps (transfert via le module
      //    Economat sans passer par le bouton "transferer" du BSI).
      const pendingLines = await client.query(
        `SELECT bsl.id, bsl.ingredient_id, bsl.needed_quantity, bsl.allocated_quantity,
                bsl.status, bsl.source_location,
                ing.name as ingredient_name, ing.unit as ingredient_unit
         FROM production_bons_sortie_lignes bsl
         JOIN ingredients ing ON ing.id = bsl.ingredient_id
         WHERE bsl.bon_id = $1 AND bsl.status IN ('en_attente', 'rupture')
         ORDER BY ing.name`,
        [bonId]
      );

      let resolved = 0;
      let stillPending = 0;

      for (const line of pendingLines.rows) {
        const stillNeeded = parseFloat(line.needed_quantity) - parseFloat(line.allocated_quantity);
        if (stillNeeded <= 0) continue;

        let remaining = stillNeeded;
        // Cas 1 : ligne 'rupture' sans allocation -> on reutilise la ligne pour la 1ere
        //   allocation (Pesage ou Economat), puis on cree des lignes supplementaires.
        // Cas 2 : ligne 'en_attente' avec allocation partielle -> on ne touche pas a
        //   l'originale (firstUpdateDone reste false), on cree uniquement des
        //   complementaires pour le residuel.
        let firstUpdateDone = false;

        // Une ligne ECONOMAT_REQUIRES_TRANSFER est aussi "recyclable" : son besoin
        // n'est pas encore servi (allocated=0), donc on peut la basculer en PESAGE
        // si du stock pesage est apparu (transfert deja fait via Economat).
        const isRecyclable = line.status === 'rupture'
          || (line.status === 'en_attente' && line.source_location === 'ECONOMAT_REQUIRES_TRANSFER');

        const applyAllocation = async (params: {
          sourceLocation: 'PESAGE' | 'ECONOMAT_REQUIRES_TRANSFER';
          lotId: string | null;
          suggestedEcoLotId: string | null;
          qty: number;
          note: string;
        }) => {
          const { sourceLocation, lotId, suggestedEcoLotId, qty, note } = params;
          if (!firstUpdateDone && isRecyclable) {
            if (sourceLocation === 'PESAGE') {
              await client.query(
                `UPDATE production_bons_sortie_lignes
                 SET ingredient_lot_id = $1,
                     needed_quantity = $2, allocated_quantity = $2,
                     status = 'en_attente', source_location = 'PESAGE',
                     suggested_economat_lot_id = NULL, transfer_required_qty = NULL,
                     notes = COALESCE(notes, '') || ' | ' || $3,
                     updated_at = NOW()
                 WHERE id = $4`,
                [lotId, qty, note, line.id]
              );
            } else {
              await client.query(
                `UPDATE production_bons_sortie_lignes
                 SET ingredient_lot_id = NULL,
                     needed_quantity = $1, allocated_quantity = 0,
                     status = 'en_attente', source_location = 'ECONOMAT_REQUIRES_TRANSFER',
                     suggested_economat_lot_id = $2, transfer_required_qty = $1,
                     notes = COALESCE(notes, '') || ' | ' || $3,
                     updated_at = NOW()
                 WHERE id = $4`,
                [qty, suggestedEcoLotId, note, line.id]
              );
            }
            firstUpdateDone = true;
          } else {
            if (sourceLocation === 'PESAGE') {
              await client.query(
                `INSERT INTO production_bons_sortie_lignes
                   (bon_id, ingredient_id, ingredient_lot_id, needed_quantity, allocated_quantity,
                    unit, status, source_location, notes)
                 VALUES ($1, $2, $3, $4, $4, $5, 'en_attente', 'PESAGE', $6)`,
                [bonId, line.ingredient_id, lotId, qty, line.ingredient_unit || 'kg', note]
              );
            } else {
              await client.query(
                `INSERT INTO production_bons_sortie_lignes
                   (bon_id, ingredient_id, ingredient_lot_id, needed_quantity, allocated_quantity,
                    unit, status, source_location, suggested_economat_lot_id, transfer_required_qty, notes)
                 VALUES ($1, $2, NULL, $3, 0, $4, 'en_attente', 'ECONOMAT_REQUIRES_TRANSFER', $5, $3, $6)`,
                [bonId, line.ingredient_id, qty, line.ingredient_unit || 'kg', suggestedEcoLotId, note]
              );
            }
          }
        };

        // Étape 1 : FEFO sur Pesage uniquement (lots deja ouverts, prets a prelever).
        // On NE consomme PAS economat_quantity ici : un sac scelle en economat n'est pas
        // dispo au pesage sans transfert physique prealable.
        //
        // effective_pesage = pesage_quantity - sum(allocated des lignes BSI deja attachees
        // a ce lot sur ce BSI). Indispensable car :
        //  1) plusieurs lignes pending peuvent exister pour le meme ingredient (ex:
        //     legacy bug ayant cree des complementaires) -> iterations multiples
        //     re-allouaient le meme lot.
        //  2) re-click du bouton "Re-verifier dispo" : les lignes attachees lors
        //     du premier click sont visibles ici, donc l'allocation est idempotente.
        // Dans une transaction Postgres, le sous-SELECT voit les INSERT/UPDATE faits
        // plus tot dans la meme boucle.
        const pesageLots = await client.query(
          `SELECT l.id, l.lot_number, l.expiration_date, l.first_opened_at, l.status,
                  (l.pesage_quantity - COALESCE((
                    SELECT SUM(bsl.allocated_quantity)
                    FROM production_bons_sortie_lignes bsl
                    WHERE bsl.bon_id = $3 AND bsl.ingredient_lot_id = l.id
                      AND bsl.source_location = 'PESAGE'
                      AND bsl.status IN ('en_attente', 'preleve', 'substitue')
                  ), 0)) AS effective_pesage
           FROM ingredient_lots l
           WHERE l.ingredient_id = $1 AND l.store_id = $2
             AND ${lotUsableSql('l')} AND l.pesage_quantity > 0
           ORDER BY
             l.expiration_date ASC NULLS LAST,
             l.first_opened_at ASC NULLS FIRST, l.received_at ASC`,
          [line.ingredient_id, storeId, bonId]
        );

        for (const lot of pesageLots.rows) {
          if (remaining <= 0) break;
          const effective = parseFloat(lot.effective_pesage);
          if (effective <= 0) continue;
          // Fond de sac (meme regle qu'a la generation) : pas de ligne « a peser 0 g ».
          if (effective + 1e-9 < Math.min(remaining, Math.max(0.001, 0.05 * stillNeeded))) continue;
          const take = Math.min(effective, remaining);
          await applyAllocation({
            sourceLocation: 'PESAGE',
            lotId: lot.id,
            suggestedEcoLotId: null,
            qty: take,
            note: `Reapprov pesage (lot ${lot.lot_number})`,
          });
          remaining -= take;
        }

        // Étape 2 : si encore besoin, on regarde l'economat -> ligne ECONOMAT_REQUIRES_TRANSFER.
        // Une seule ligne agrege le besoin (meme logique que generate), avec un lot
        // economat suggere par FEFO. Le magasinier devra effectuer le transfert depuis
        // le module Economat avant de pouvoir prelever.
        //
        // Meme principe d'idempotence : effective_economat = economat_quantity - sum(
        // transfer_required_qty des lignes ECONOMAT_REQUIRES_TRANSFER deja suggerees
        // sur ce BSI pour ce lot).
        if (remaining > 0) {
          const ecoLotsResult = await client.query(
            `SELECT l.id, l.lot_number,
                    (l.economat_quantity - COALESCE((
                      SELECT SUM(bsl.transfer_required_qty)
                      FROM production_bons_sortie_lignes bsl
                      WHERE bsl.bon_id = $3 AND bsl.id <> $4
                        AND bsl.suggested_economat_lot_id = l.id
                        AND bsl.source_location = 'ECONOMAT_REQUIRES_TRANSFER'
                        AND bsl.status = 'en_attente'
                    ), 0)) AS effective_economat
             FROM ingredient_lots l
             WHERE l.ingredient_id = $1 AND l.store_id = $2
               AND ${lotUsableSql('l')} AND l.economat_quantity > 0
             ORDER BY l.expiration_date ASC NULLS LAST, l.received_at ASC`,
            [line.ingredient_id, storeId, bonId, line.id]
          );
          const totalEco = ecoLotsResult.rows.reduce(
            (sum, r) => sum + Math.max(0, parseFloat(r.effective_economat || '0')),
            0
          );
          const transferable = Math.min(totalEco, remaining);

          if (transferable > 0) {
            const suggested = ecoLotsResult.rows.find(r => parseFloat(r.effective_economat || '0') > 0);
            if (suggested) {
              await applyAllocation({
                sourceLocation: 'ECONOMAT_REQUIRES_TRANSFER',
                lotId: null,
                suggestedEcoLotId: suggested.id,
                qty: transferable,
                note: `Reapprov economat - transfert requis (lot ${suggested.lot_number})`,
              });
              remaining -= transferable;
            }
          }
        }

        // Étape 3 : residuel toujours en rupture
        if (remaining > 0) {
          stillPending++;
          if (firstUpdateDone) {
            // La ligne d'origine a deja ete reaffectee (PESAGE/ECONOMAT_REQUIRES_TRANSFER) :
            // on cree une ligne RUPTURE separee pour le residuel non couvrable.
            await client.query(
              `INSERT INTO production_bons_sortie_lignes
                 (bon_id, ingredient_id, ingredient_lot_id, needed_quantity, allocated_quantity,
                  unit, status, source_location, notes)
               VALUES ($1, $2, NULL, $3, 0, $4, 'rupture', 'RUPTURE', $5)`,
              [bonId, line.ingredient_id, remaining, line.ingredient_unit || 'kg',
               `🚨 Rupture residuelle apres reapprov - manque ${remaining.toFixed(2)} ${line.ingredient_unit || 'kg'}`]
            );
          }
          // Si !firstUpdateDone, la ligne d'origine reste telle quelle (rupture pure ou en_attente partiel).
        } else {
          resolved++;
          if (!firstUpdateDone && line.status === 'rupture') {
            // Edge case : remaining=0 sans avoir touche a la ligne d'origine.
            // Devrait etre impossible (si remaining baisse, on a alloue) — securite.
            await client.query(
              `UPDATE production_bons_sortie_lignes
               SET status = 'annule', notes = COALESCE(notes, '') || ' | Remplacee par lignes complementaires apres reapprov'
               WHERE id = $1`,
              [line.id]
            );
          }
        }
      }

      // 2. Si plus aucune rupture/attente, repassage en 'preparation' pour finaliser le prelevement
      const stillCount = await client.query(
        `SELECT COUNT(*) FROM production_bons_sortie_lignes
         WHERE bon_id = $1 AND status IN ('en_attente', 'rupture')`,
        [bonId]
      );
      const remainingPending = parseInt(stillCount.rows[0].count);

      let finalStatus = 'preparation_partielle';
      if (remainingPending === 0) {
        finalStatus = 'preparation';  // Tout dispo, magasinier peut prélever et marquer prêt
        const cur = await client.query(`SELECT status FROM production_bons_sortie WHERE id = $1`, [bonId]);
        if (cur.rows[0]?.status === 'preparation_partielle') {
          await transitionBon(client, bonId, 'preparation', {
            extraSet: 'partial_completed_by = $2, partial_completed_at = NOW()', params: [userId],
            reason: 'Reapprovisionnement : toutes les lignes re-allouees',
          });
        } else {
          await client.query(
            `UPDATE production_bons_sortie SET partial_completed_by = $1, partial_completed_at = NOW(), updated_at = NOW() WHERE id = $2`,
            [userId, bonId]);
        }
      }

      await client.query('COMMIT');
      return {
        bonId, finalStatus,
        resolved, stillPending,
        remainingPendingLines: remainingPending,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ─── Cancel the bon ───
  // Refuse une fois le prelevement engage (prelevement / verifie / cloture) : les
  // lots sont deja decrementes et rien ne les restitue. Trace auteur, date, motif.
  async cancel(bonId: string, userId: string, reason?: string) {
    return withActor(userId, async (client) => {
      await lockBon(client, bonId);
      try {
        return await transitionBon(client, bonId, 'annule', {
          extraSet: 'cancelled_by = $2, cancelled_at = NOW(), cancel_reason = $3', params: [userId, reason || null],
        });
      } catch (err) {
        throw new Error('Bon de sortie introuvable, deja cloture/annule, ou prelevement deja engage (stock consomme)');
      }
    }, reason || 'Annulation du bon');
  },

  // ─── Regenerate : annule le bon courant et en genere un nouveau ───
  // Refuse si un bon du plan a deja consomme le stock (prelevement / verifie / cloture) :
  // regenerer puis prelever deduisait les memes ingredients une seconde fois.
  async regenerate(planId: string, storeId: string, userId: string, opts: { derogationDlc?: { motif: string } } = {}) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setActor(client, userId);
      await client.query(`SELECT id FROM production_plans WHERE id = $1 FOR UPDATE`, [planId]);
      const engaged = await client.query(
        `SELECT numero FROM production_bons_sortie
          WHERE plan_id = $1 AND status IN ('prelevement', 'verifie', 'cloture') LIMIT 1`,
        [planId]
      );
      if (engaged.rows.length > 0) {
        throw new Error(`Impossible de regenerer : le bon ${engaged.rows[0].numero} a deja ete preleve (stock consomme)`);
      }
      await setReason(client, 'Regeneration du bon de sortie');
      const toCancel = await client.query(
        `SELECT id FROM production_bons_sortie WHERE plan_id = $1 AND status NOT IN ('cloture', 'annule')`, [planId]);
      for (const row of toCancel.rows) {
        await transitionBon(client, row.id, 'annule', {
          extraSet: "cancelled_by = $2, cancelled_at = NOW(), cancel_reason = 'Regeneration du bon de sortie'", params: [userId],
        });
      }
      await client.query(`UPDATE production_plans SET bon_sortie_id = NULL WHERE id = $1`, [planId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    // Generation dans sa propre transaction (elle reverrouille le plan).
    return this.generate(planId, storeId, userId, opts);
  },
};

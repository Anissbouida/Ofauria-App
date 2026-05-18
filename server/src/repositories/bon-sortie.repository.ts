import { db } from '../config/database.js';

export const bonSortieRepository = {

  // ─── Generate a bon de sortie from plan ingredient needs + FEFO preview ───
  async generate(planId: string, storeId: string, userId: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

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

      // 2. Generate BSI number: BSI-YYMMDD-NNN
      const now = new Date();
      const yy = String(now.getFullYear()).slice(2);
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const dateStr = `${yy}${mm}${dd}`;

      const countResult = await client.query(
        `SELECT COUNT(*) FROM production_bons_sortie
         WHERE numero LIKE $1`,
        [`BSI-${dateStr}-%`]
      );
      const seq = (parseInt(countResult.rows[0].count) + 1).toString().padStart(3, '0');
      const numero = `BSI-${dateStr}-${seq}`;

      // 3. Create the bon de sortie
      const bonResult = await client.query(
        `INSERT INTO production_bons_sortie (plan_id, store_id, numero, status, generated_by, generated_at)
         VALUES ($1, $2, $3, 'genere', $4, NOW())
         RETURNING *`,
        [planId, storeId, numero, userId]
      );
      const bon = bonResult.rows[0];

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

        // Étape 1 : consommation depuis Pesage (FEFO sur DLC)
        const pesageLotsResult = await client.query(
          `SELECT id, lot_number, supplier_lot_number, pesage_quantity, expiration_date,
                  received_at, status, first_opened_at
           FROM ingredient_lots
           WHERE ingredient_id = $1 AND store_id = $2
             AND status IN ('active', 'expired') AND pesage_quantity > 0
           ORDER BY expiration_date ASC NULLS LAST,
                    first_opened_at ASC NULLS FIRST, received_at ASC`,
          [need.ingredient_id, storeId]
        );

        for (const lot of pesageLotsResult.rows) {
          if (remaining <= 0) break;
          const available = parseFloat(lot.pesage_quantity);
          const take = Math.min(available, remaining);
          const isExpired = lot.expiration_date && new Date(lot.expiration_date) < new Date();

          // needed_quantity = portion couverte par cette ligne (= take), pas le besoin total :
          // sinon une ligne PESAGE partielle ferait apparaitre "manque" alors que la portion
          // est entierement allouee, et le total des needed cumulees depasserait le besoin reel.
          const lineResult = await client.query(
            `INSERT INTO production_bons_sortie_lignes
               (bon_id, ingredient_id, ingredient_lot_id, needed_quantity, allocated_quantity,
                unit, status, source_location, notes)
             VALUES ($1, $2, $3, $4, $5, $6, 'en_attente', 'PESAGE', $7)
             RETURNING *`,
            [bon.id, need.ingredient_id, lot.id, take, take, need.ingredient_unit || 'kg',
             `[Pesage] ouvert ${lot.first_opened_at ? new Date(lot.first_opened_at).toLocaleDateString('fr-FR') : ''}${isExpired ? ' — ⚠ DLC depassee' : ''}`]
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

        // Étape 2 : Pesage insuffisant → ligne "transfert requis" avec lot Economat suggere.
        // Une seule ligne par ingredient, meme si plusieurs lots Economat necessaires :
        // le magasinier transferera depuis le lot suggere et pourra ouvrir un autre lot
        // si besoin (geste manuel). On suggere le meilleur lot FEFO actif.
        if (remaining > 0) {
          const suggestedLotResult = await client.query(
            `SELECT id, lot_number, supplier_lot_number, economat_quantity, expiration_date,
                    received_at, status
             FROM ingredient_lots
             WHERE ingredient_id = $1 AND store_id = $2
               AND status = 'active' AND economat_quantity > 0
             ORDER BY expiration_date ASC NULLS LAST, received_at ASC
             LIMIT 1`,
            [need.ingredient_id, storeId]
          );

          // Total Economat dispo (tous lots actifs confondus) : sert a savoir si le besoin
          // est couvrable par transfert ou s'il y a une rupture residuelle.
          const totalEconomatResult = await client.query(
            `SELECT COALESCE(SUM(economat_quantity), 0)::numeric AS total
             FROM ingredient_lots
             WHERE ingredient_id = $1 AND store_id = $2
               AND status = 'active' AND economat_quantity > 0`,
            [need.ingredient_id, storeId]
          );
          const totalEconomat = parseFloat(totalEconomatResult.rows[0]?.total || '0');
          const transferable = Math.min(totalEconomat, remaining);

          if (transferable > 0 && suggestedLotResult.rows.length > 0) {
            const lot = suggestedLotResult.rows[0];
            const lineResult = await client.query(
              `INSERT INTO production_bons_sortie_lignes
                 (bon_id, ingredient_id, ingredient_lot_id, needed_quantity, allocated_quantity,
                  unit, status, source_location, suggested_economat_lot_id, transfer_required_qty, notes)
               VALUES ($1, $2, NULL, $3, 0, $4, 'en_attente', 'ECONOMAT_REQUIRES_TRANSFER', $5, $6, $7)
               RETURNING *`,
              [bon.id, need.ingredient_id, transferable, need.ingredient_unit || 'kg',
               lot.id, transferable,
               `Transfert requis : ${transferable.toFixed(2)} ${need.ingredient_unit || 'kg'} depuis Economat (lot ${lot.lot_number})`]
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

            remaining -= transferable;
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
             `🚨 Rupture — manque ${remaining.toFixed(2)} ${need.ingredient_unit || 'kg'}`]
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
      return { ...bon, lines };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ─── Historique magasinier : BSI ayant quitte la file active (chef a valide ou annule) ───
  // Statuts retournes : 'prelevement', 'verifie', 'cloture', 'annule'. Limite/offset pour pagination.
  async findHistoryForWarehouse(storeId: string, limit = 50, offset = 0) {
    const countResult = await db.query(
      `SELECT COUNT(*)::int as total FROM production_bons_sortie
       WHERE store_id = $1 AND status IN ('prelevement', 'verifie', 'cloture', 'annule')`,
      [storeId]
    );
    const total = countResult.rows[0]?.total ?? 0;

    const result = await db.query(
      `SELECT bs.*,
              pp.plan_date, pp.type AS plan_type,
              ug.first_name || ' ' || ug.last_name AS generated_by_name,
              up2.first_name || ' ' || up2.last_name AS preparation_by_name,
              ur.first_name || ' ' || ur.last_name AS ready_by_name,
              up.first_name || ' ' || up.last_name AS prelevement_by_name,
              uc.first_name || ' ' || uc.last_name AS closed_by_name,
              (SELECT COUNT(*) FROM production_bons_sortie_lignes bsl WHERE bsl.bon_id = bs.id) AS total_lines
       FROM production_bons_sortie bs
       LEFT JOIN production_plans pp ON pp.id = bs.plan_id
       LEFT JOIN users ug ON ug.id = bs.generated_by
       LEFT JOIN users up2 ON up2.id = bs.preparation_by
       LEFT JOIN users ur ON ur.id = bs.ready_by
       LEFT JOIN users up ON up.id = bs.prelevement_by
       LEFT JOIN users uc ON uc.id = bs.closed_by
       WHERE bs.store_id = $1
         AND bs.status IN ('prelevement', 'verifie', 'cloture', 'annule')
       ORDER BY COALESCE(bs.closed_at, bs.prelevement_at, bs.updated_at) DESC
       LIMIT $2 OFFSET $3`,
      [storeId, limit, offset]
    );
    return { rows: result.rows, total };
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
         AND bs.status IN ('genere', 'preparation', 'pret')
       ORDER BY
         CASE bs.status
           WHEN 'genere' THEN 0
           WHEN 'preparation' THEN 1
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
         -- Cache les lignes dont le stock est revenu (pesage + economat couvrent le besoin)
         AND COALESCE((
           SELECT SUM(COALESCE(il.pesage_quantity, 0) + COALESCE(il.economat_quantity, 0))
             FROM ingredient_lots il
            WHERE il.ingredient_id = bsl.ingredient_id
              AND il.store_id = bs.store_id
              AND il.status = 'active'
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
              il.lot_number AS suggested_lot_number,
              il.economat_quantity AS suggested_lot_economat_qty,
              il.expiration_date AS suggested_lot_dlc
       FROM production_bons_sortie_lignes bsl
       JOIN production_bons_sortie bs ON bs.id = bsl.bon_id
       LEFT JOIN production_plans pp ON pp.id = bs.plan_id
       LEFT JOIN stores s ON s.id = bs.store_id
       LEFT JOIN ingredients ing ON ing.id = bsl.ingredient_id
       LEFT JOIN ingredient_lots il ON il.id = bsl.suggested_economat_lot_id
       WHERE ($1::uuid IS NULL OR bs.store_id = $1)
         AND bs.status IN ('genere', 'preparation', 'preparation_partielle', 'pret', 'prelevement')
         AND bsl.source_location = 'ECONOMAT_REQUIRES_TRANSFER'
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
      const linesResult = await db.query(
        `SELECT bsl.*,
                ing.name AS ingredient_name, ing.unit AS ingredient_unit,
                il.lot_number, il.supplier_lot_number, il.expiration_date,
                il.quantity_remaining AS lot_remaining,
                il.status AS lot_status,
                CASE WHEN il.status = 'expired' THEN true ELSE false END AS lot_expired,
                -- Stock courant total (pesage + economat) pour cet ingredient sur ce store.
                -- Sert au frontend a savoir si une ligne 'rupture' a en realite ete reapprovisionnee
                -- depuis la generation du BSI -> ne plus l'afficher dans le bandeau ruptures.
                COALESCE((
                  SELECT SUM(COALESCE(il2.pesage_quantity, 0) + COALESCE(il2.economat_quantity, 0))
                    FROM ingredient_lots il2
                   WHERE il2.ingredient_id = bsl.ingredient_id
                     AND il2.store_id = $2
                     AND il2.status = 'active'
                ), 0) AS current_stock_total
         FROM production_bons_sortie_lignes bsl
         JOIN ingredients ing ON ing.id = bsl.ingredient_id
         LEFT JOIN ingredient_lots il ON il.id = bsl.ingredient_lot_id
         WHERE bsl.bon_id = $1
         ORDER BY ing.name, il.expiration_date ASC NULLS LAST`,
        [bon.id, bon.store_id]
      );
      bons.push({ ...bon, lines: linesResult.rows });
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

    const linesResult = await db.query(
      `SELECT bsl.*,
              ing.name AS ingredient_name, ing.unit AS ingredient_unit,
              il.lot_number, il.supplier_lot_number, il.expiration_date, il.quantity_remaining AS lot_remaining,
              il.status AS lot_status,
              -- Stock courant total (pesage + economat) — voir findByPlan pour la motivation.
              COALESCE((
                SELECT SUM(COALESCE(il2.pesage_quantity, 0) + COALESCE(il2.economat_quantity, 0))
                  FROM ingredient_lots il2
                 WHERE il2.ingredient_id = bsl.ingredient_id
                   AND il2.store_id = $2
                   AND il2.status = 'active'
              ), 0) AS current_stock_total
       FROM production_bons_sortie_lignes bsl
       JOIN ingredients ing ON ing.id = bsl.ingredient_id
       LEFT JOIN ingredient_lots il ON il.id = bsl.ingredient_lot_id
       WHERE bsl.bon_id = $1
       ORDER BY ing.name, il.expiration_date ASC NULLS LAST`,
      [bonId, bon.store_id]
    );

    return { ...bon, lines: linesResult.rows };
  },

  // ─── Start prelevement: update status + decrement pesage stock ───
  // Accepte les statuts 'genere' (flow legacy sans magasinier) ET 'pret' (flow magasinier,
  // chef valide la reception -> on demarre le prelevement pour la tracabilite des ecarts).
  // Au moment ou le chef accepte la reception, les ingredients ont physiquement quitte
  // la zone pesage : on decremente pesage_quantity sur chaque lot prele​ve, on trace
  // un mouvement 'production' et on lie au plan via inventory_transactions.
  async startPrelevement(bonId: string, userId: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const bonResult = await client.query(
        `UPDATE production_bons_sortie
         SET status = 'prelevement', prelevement_by = $1, prelevement_at = NOW(), updated_at = NOW()
         WHERE id = $2 AND status IN ('genere', 'pret')
         RETURNING *`,
        [userId, bonId]
      );
      if (bonResult.rows.length === 0) {
        throw new Error('Bon de sortie introuvable ou statut invalide pour demarrer le prelevement');
      }
      const bon = bonResult.rows[0];

      // Le chef accepte la reception : on auto-confirme les lignes 'en_attente'
      // qui ont deja une allocation FEFO (ingredient_lot_id) en les passant
      // a 'preleve' avec actual = allocated. Cela debloque la verification +
      // cloture qui suit dans le workflow chef. Les lignes 'rupture' sans lot
      // restent telles quelles (rien a consommer).
      await client.query(
        `UPDATE production_bons_sortie_lignes
            SET status = 'preleve', actual_quantity = allocated_quantity, updated_at = NOW()
          WHERE bon_id = $1
            AND status = 'en_attente'
            AND ingredient_id IS NOT NULL
            AND ingredient_lot_id IS NOT NULL
            AND allocated_quantity > 0`,
        [bonId]
      );

      // Recupere les lignes prelevees / substituees / avec ecart : ce sont celles qui
      // ont quitte le pesage. Les lignes 'rupture' sans lot sont ignorees.
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
        [bonId]
      );

      for (const line of linesResult.rows) {
        const lotId = line.substitute_lot_id || line.ingredient_lot_id;
        if (!lotId) continue;
        const qty = parseFloat(line.actual_quantity ?? line.allocated_quantity ?? '0');
        if (qty <= 0) continue;

        // Decremente pesage_quantity. Bascule en 'depleted' si tout est consomme.
        // Le trigger sync_quantity_remaining maintient quantity_remaining a jour.
        await client.query(
          `UPDATE ingredient_lots
              SET pesage_quantity = GREATEST(pesage_quantity - $1, 0),
                  status = CASE
                    WHEN economat_quantity = 0 AND pesage_quantity - $1 <= 0 THEN 'depleted'
                    ELSE status
                  END
            WHERE id = $2`,
          [qty, lotId]
        );

        // Trace mouvement de stock (type='production' pour coherence avec consumeFEFO).
        // Le trigger trg_inventory_sync_lots resync inventory.current_quantity depuis
        // les lots — pas besoin de mettre a jour inventory manuellement ici.
        await client.query(
          `INSERT INTO inventory_transactions
             (ingredient_id, type, quantity_change, note, performed_by, store_id, ingredient_lot_id, production_plan_id)
           VALUES ($1, 'production', $2, $3, $4, $5, $6, $7)`,
          [
            line.ingredient_id,
            -qty,
            `BSI ${bon.numero} — Reception acceptee : ${qty.toFixed(3)} ${line.unit || ''} ${line.ingredient_name}`,
            userId,
            bon.store_id,
            lotId,
            bon.plan_id,
          ]
        );
      }

      await client.query('COMMIT');
      return bon;
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
    const result = await db.query(
      `UPDATE production_bons_sortie
       SET status = 'preparation', preparation_by = $1, preparation_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND status = 'genere'
       RETURNING *`,
      [userId, bonId]
    );
    if (result.rows.length === 0) {
      throw new Error('Bon de sortie introuvable ou statut invalide pour demarrer la preparation');
    }
    return result.rows[0];
  },

  // ─── Magasinier : marquer comme pret a remettre ───
  // Transition 'preparation' -> 'pret'. Le magasinier a fini la preparation,
  // les ingredients sont prets a etre remis au chef (qui sera notifie).
  // Refuse si une ligne a encore source_location='ECONOMAT_REQUIRES_TRANSFER' :
  // le magasinier doit d'abord transferer (ouvrir le contenant) tous les ingredients
  // economat necessaires avant de marquer pret.
  async markAsReady(bonId: string, userId: string) {
    // Delta v1 point 5 : le BSI ne peut etre marque pret que si TOUTES les lignes
    // sont a l'etat "Pret" (preleve, substitue ou ecart). On agrege en une seule
    // requete les 3 motifs de blocage :
    //  - lignes encore en_attente (non pesees)
    //  - lignes rupture (ingredient absent du pesage ET de l'economat)
    //  - lignes ECONOMAT_REQUIRES_TRANSFER (transfert pas encore effectue)
    // Pour partir avec des ingredients manquants, le magasinier doit utiliser
    // commitPartial (-> preparation_partielle), pas markAsReady.
    const blockersResult = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE source_location = 'ECONOMAT_REQUIRES_TRANSFER')::int AS pending_transfers,
         COUNT(*) FILTER (WHERE status = 'rupture')::int AS rupture_lines,
         COUNT(*) FILTER (WHERE status = 'en_attente' AND source_location IS DISTINCT FROM 'ECONOMAT_REQUIRES_TRANSFER')::int AS waiting_lines
       FROM production_bons_sortie_lignes
       WHERE bon_id = $1 AND status != 'annule'`,
      [bonId]
    );
    const blockers = blockersResult.rows[0] || {};
    const pendingTransfers = blockers.pending_transfers ?? 0;
    const ruptureLines = blockers.rupture_lines ?? 0;
    const waitingLines = blockers.waiting_lines ?? 0;
    if (pendingTransfers > 0) {
      throw new Error(`Impossible de marquer pret : ${pendingTransfers} ligne(s) necessitent encore un transfert depuis l'economat.`);
    }
    if (ruptureLines > 0) {
      throw new Error(`Impossible de marquer pret : ${ruptureLines} ligne(s) en rupture. Utilisez "Valider partiel" ou commandez les ingredients manquants.`);
    }
    if (waitingLines > 0) {
      throw new Error(`Impossible de marquer pret : ${waitingLines} ligne(s) non encore pesee(s).`);
    }

    const result = await db.query(
      `UPDATE production_bons_sortie
       SET status = 'pret', ready_by = $1, ready_at = NOW(),
           chef_reject_reason = NULL, chef_reject_at = NULL, chef_reject_by = NULL,
           updated_at = NOW()
       WHERE id = $2 AND status = 'preparation'
       RETURNING *`,
      [userId, bonId]
    );
    if (result.rows.length === 0) {
      throw new Error('Bon de sortie introuvable ou statut invalide pour marquer comme pret');
    }

    // Transition cycle de vie plan (delta v1 point 1) : magasinier a fini la
    // preparation -> le plan passe en "pret a produire" en attendant l'acceptation
    // de reception par le chef. Ne touche que si le plan est encore en attente.
    const bon = result.rows[0];
    if (bon.plan_id) {
      await db.query(
        `UPDATE production_plans SET status = 'ready_to_produce', updated_at = NOW()
         WHERE id = $1 AND status = 'awaiting_ingredients'`,
        [bon.plan_id]
      );
    }
    return bon;
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
      `SELECT id, lot_number, supplier_lot_number, economat_quantity, expiration_date,
              received_at, first_opened_at, status,
              (id = $3) AS is_suggested
       FROM ingredient_lots
       WHERE ingredient_id = $1 AND store_id = $2
         AND status = 'active' AND economat_quantity > 0
       ORDER BY expiration_date ASC NULLS LAST, received_at ASC`,
      [line.ingredient_id, line.store_id, line.suggested_economat_lot_id]
    );
    return lotsResult.rows;
  },

  // ─── Magasinier : transferer une ligne BSI Economat -> Pesage ───
  // Action declenchee depuis la WarehousePage sur une ligne ECONOMAT_REQUIRES_TRANSFER.
  // Effectue dans une transaction :
  //   1. Insert ingredient_stock_zone_transfers (audit + tracabilite)
  //   2. Decremente economat_quantity / incremente pesage_quantity du lot
  //      (le trigger sync_quantity_remaining maintient quantity_remaining)
  //   3. Met a jour la ligne BSI : ingredient_lot_id <- lot transfere,
  //      allocated_quantity <- qty, source_location <- 'PESAGE',
  //      transferred_at/by remplis. Le statut reste 'en_attente' (pret a etre preleve).
  // Le magasinier peut substituer le lot suggere via overrideLotId, et ajuster la qty
  // transferee via overrideQty (utile s'il decide d'ouvrir un contenant entier au lieu
  // de la portion exacte demandee). overrideQty doit etre <= economat_quantity du lot.
  async transferLineFromEconomat(
    ligneId: string,
    userId: string,
    options: { overrideLotId?: string; overrideQty?: number; reason?: string; containerCount?: number } = {},
  ) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Verrouiller la ligne BSI + recuperer contexte
      // bs.plan_id est requis pour remplir plan_production_id sur le transfert
      // (delta v1 point 4 — lien obligatoire avec le plan).
      const lineResult = await client.query(
        `SELECT bsl.id, bsl.bon_id, bsl.ingredient_id, bsl.suggested_economat_lot_id,
                bsl.transfer_required_qty, bsl.source_location, bsl.unit, bsl.needed_quantity,
                bs.store_id, bs.numero AS bon_numero, bs.plan_id
         FROM production_bons_sortie_lignes bsl
         JOIN production_bons_sortie bs ON bs.id = bsl.bon_id
         WHERE bsl.id = $1
         FOR UPDATE OF bsl`,
        [ligneId]
      );
      if (lineResult.rows.length === 0) {
        throw new Error('Ligne BSI introuvable');
      }
      const line = lineResult.rows[0];
      if (line.source_location !== 'ECONOMAT_REQUIRES_TRANSFER') {
        throw new Error(`Cette ligne n'attend pas de transfert (source actuelle : ${line.source_location})`);
      }

      const lotId = options.overrideLotId || line.suggested_economat_lot_id;
      if (!lotId) {
        throw new Error('Aucun lot Economat a transferer (lot suggere absent)');
      }

      // Quantite a transferer : par defaut le besoin BSI (transfer_required_qty),
      // mais le magasinier peut surcharger via overrideQty (ex. ouvrir un contenant entier).
      // Doit etre > 0 ; la verification contre economat_quantity est faite plus bas.
      const requestedQty = options.overrideQty != null
        ? Number(options.overrideQty)
        : parseFloat(line.transfer_required_qty);
      if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
        throw new Error('Quantite de transfert invalide');
      }
      const transferQty = requestedQty;
      // allocated_quantity sur la ligne BSI doit couvrir le besoin (transfer_required_qty).
      // Si le magasinier transfere plus, le surplus reste au pesage (sera consomme par les
      // prochains BSI). Si moins, la ligne BSI ne peut pas etre marquee couverte → on refuse.
      const requiredQty = parseFloat(line.transfer_required_qty);
      if (transferQty < requiredQty) {
        throw new Error(`Quantite insuffisante : ${transferQty} < ${requiredQty} requis pour cette ligne BSI`);
      }

      // 2. Verrouiller + verifier le lot Economat
      const lotResult = await client.query(
        `SELECT id, ingredient_id, store_id, lot_number, economat_quantity, status,
                first_opened_at, opening_history
         FROM ingredient_lots
         WHERE id = $1
         FOR UPDATE`,
        [lotId]
      );
      if (lotResult.rows.length === 0) {
        throw new Error('Lot Economat introuvable');
      }
      const lot = lotResult.rows[0];
      if (lot.ingredient_id !== line.ingredient_id) {
        throw new Error('Le lot ne correspond pas a l\'ingredient de la ligne BSI');
      }
      if (lot.store_id !== line.store_id) {
        throw new Error('Le lot n\'appartient pas au store du BSI');
      }
      if (lot.status !== 'active') {
        throw new Error(`Lot non actif (statut: ${lot.status}), transfert interdit`);
      }
      const economatAvailable = parseFloat(lot.economat_quantity);
      if (economatAvailable < transferQty) {
        throw new Error(`Quantite insuffisante en Economat (${economatAvailable} dispo / ${transferQty} requis)`);
      }

      // 3. Insert audit transfer (delta v1 point 4 : plan_production_id requis)
      await client.query(
        `INSERT INTO ingredient_stock_zone_transfers
           (ingredient_lot_id, store_id, from_zone, to_zone, quantity, container_count,
            bon_sortie_id, bon_sortie_ligne_id, plan_production_id, reason, transferred_by)
         VALUES ($1, $2, 'ECONOMAT', 'PESAGE', $3, $4, $5, $6, $7, $8, $9)`,
        [lotId, line.store_id, transferQty, options.containerCount || null,
         line.bon_id, ligneId, line.plan_id, options.reason || `BSI ${line.bon_numero}`, userId]
      );

      // 4. Update lot quantities + opening history
      const openingEntry = {
        qty: transferQty,
        opened_at: new Date().toISOString(),
        opened_by: userId,
        container_count: options.containerCount || null,
        bon_sortie_id: line.bon_id,
      };
      // Migration 112 a supprime effective_expiry_after_opening / shelf_life_after_opening_days :
      // pour les ingredients on ne distingue plus DLC vs DLV apres ouverture.
      await client.query(
        `UPDATE ingredient_lots
         SET economat_quantity = economat_quantity - $1,
             pesage_quantity = pesage_quantity + $1,
             first_opened_at = COALESCE(first_opened_at, NOW()),
             opening_history = opening_history || $2::jsonb
         WHERE id = $3`,
        [transferQty, JSON.stringify(openingEntry), lotId]
      );

      // 5. Update BSI line : attache le lot, bascule en PESAGE, prepare pour prelevement.
      // allocated_quantity = besoin BSI (requiredQty), pas le total transfere : le surplus
      // (transferQty - requiredQty) reste au pesage et sera consommable par les autres BSI.
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
         `Transfere depuis Economat (lot ${lot.lot_number}, ${transferQty.toFixed(2)} ${line.unit || 'kg'}) le ${new Date().toLocaleDateString('fr-FR')}${options.reason ? ` — ${options.reason}` : ''}`,
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
    const result = await db.query(
      `UPDATE production_bons_sortie
       SET status = 'preparation',
           chef_reject_by = $1, chef_reject_at = NOW(), chef_reject_reason = $2,
           ready_by = NULL, ready_at = NULL,
           updated_at = NOW()
       WHERE id = $3 AND status = 'pret'
       RETURNING *`,
      [userId, reason, bonId]
    );
    if (result.rows.length === 0) {
      throw new Error('Bon de sortie introuvable ou statut invalide pour refus');
    }

    // Transition cycle de vie plan (delta v1 point 1) : chef refuse la reception
    // -> le plan retombe en attente ingredients pour que le magasinier corrige.
    const bon = result.rows[0];
    if (bon.plan_id) {
      await db.query(
        `UPDATE production_plans SET status = 'awaiting_ingredients', updated_at = NOW()
         WHERE id = $1 AND status = 'ready_to_produce'`,
        [bon.plan_id]
      );
    }
    return bon;
  },

  // ─── Update a line's actual quantity ───
  async updateLigne(ligneId: string, actualQuantity: number, notes?: string) {
    // Get the line + lot status to compute ecart and block expired lots
    const lineResult = await db.query(
      `SELECT bsl.allocated_quantity, il.status AS lot_status
       FROM production_bons_sortie_lignes bsl
       LEFT JOIN ingredient_lots il ON il.id = bsl.ingredient_lot_id
       WHERE bsl.id = $1`,
      [ligneId]
    );
    if (lineResult.rows.length === 0) {
      throw new Error('Ligne de bon de sortie introuvable');
    }

    // Block picking from an expired lot — user must substitute to another lot first
    if (lineResult.rows[0].lot_status === 'expired') {
      throw new Error('Lot expire — prelevement interdit. Utilisez la substitution pour remplacer le lot.');
    }

    const allocated = parseFloat(lineResult.rows[0].allocated_quantity);
    const ecart = actualQuantity - allocated;
    const status = Math.abs(ecart) < 0.001 ? 'preleve' : 'ecart';

    const result = await db.query(
      `UPDATE production_bons_sortie_lignes
       SET actual_quantity = $1, ecart_quantity = $2, status = $3, notes = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [actualQuantity, ecart, status, notes || null, ligneId]
    );
    return result.rows[0];
  },

  // ─── Verify the bon: check all lines are processed ───
  // Idempotent : si deja 'verifie' ou 'cloture', retourne le bon actuel sans erreur.
  // Evite les erreurs quand validateBon() est appele deux fois (double clic ou
  // StrictMode) : le 1er appel verifie, le 2eme retombe sur l'etat actuel.
  async verify(bonId: string, userId: string) {
    // Si le bon est deja avance, retourner l'etat actuel (idempotent).
    const current = await db.query(
      `SELECT * FROM production_bons_sortie WHERE id = $1`,
      [bonId]
    );
    if (current.rows.length === 0) {
      throw new Error('Bon de sortie introuvable');
    }
    if (current.rows[0].status === 'verifie' || current.rows[0].status === 'cloture') {
      return current.rows[0];
    }

    // Auto-confirme les lignes ingredients 'en_attente' qui ont une allocation
    // FEFO (ingredient_lot_id) — la chef a accepte la reception, on considere
    // que les ingredients sont recus a la qte allouee. Consomme ensuite les
    // lots correspondants pour rester coherent avec startPrelevement.
    const linesToConsume = await db.query(
      `SELECT bsl.id, bsl.ingredient_id, bsl.unit, bsl.allocated_quantity,
              bsl.ingredient_lot_id, bsl.substitute_lot_id,
              ing.name AS ingredient_name,
              bs.numero, bs.store_id, bs.plan_id
       FROM production_bons_sortie_lignes bsl
       JOIN ingredients ing ON ing.id = bsl.ingredient_id
       JOIN production_bons_sortie bs ON bs.id = bsl.bon_id
       WHERE bsl.bon_id = $1
         AND bsl.status = 'en_attente'
         AND bsl.ingredient_id IS NOT NULL
         AND bsl.ingredient_lot_id IS NOT NULL
         AND bsl.allocated_quantity > 0`,
      [bonId]
    );
    for (const line of linesToConsume.rows) {
      const lotId = line.substitute_lot_id || line.ingredient_lot_id;
      const qty = parseFloat(line.allocated_quantity);
      await db.query(
        `UPDATE ingredient_lots
            SET pesage_quantity = GREATEST(pesage_quantity - $1, 0),
                status = CASE
                  WHEN economat_quantity = 0 AND pesage_quantity - $1 <= 0 THEN 'depleted'
                  ELSE status
                END
          WHERE id = $2`,
        [qty, lotId]
      );
      await db.query(
        `INSERT INTO inventory_transactions
           (ingredient_id, type, quantity_change, note, performed_by, store_id, ingredient_lot_id, production_plan_id)
         VALUES ($1, 'production', $2, $3, $4, $5, $6, $7)`,
        [line.ingredient_id, -qty,
         `BSI ${line.numero} — Auto-validation : ${qty.toFixed(3)} ${line.unit || ''} ${line.ingredient_name}`,
         userId, line.store_id, lotId, line.plan_id]
      );
    }
    // Auto-confirme toutes les lignes en_attente restantes (ingredients sans lot
    // = ruptures non resolues, et packaging) pour ne pas bloquer la cloture.
    await db.query(
      `UPDATE production_bons_sortie_lignes
       SET status = 'preleve', actual_quantity = allocated_quantity, updated_at = NOW()
       WHERE bon_id = $1 AND status = 'en_attente'`,
      [bonId]
    );

    const result = await db.query(
      `UPDATE production_bons_sortie
       SET status = 'verifie', verified_by = $1, verified_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND status = 'prelevement'
       RETURNING *`,
      [userId, bonId]
    );
    if (result.rows.length === 0) {
      throw new Error('Bon de sortie introuvable ou statut invalide pour verification');
    }
    return result.rows[0];
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

      const result = await client.query(
        `UPDATE production_bons_sortie
         SET status = 'preparation_partielle',
             partial_committed_by = $1, partial_committed_at = NOW(),
             updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [userId, bonId]
      );

      await client.query('COMMIT');
      return { ...result.rows[0], done_count: done, pending_count: pending };
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

      // 1. Recupere les lignes en attente / rupture avec leur ingredient
      const pendingLines = await client.query(
        `SELECT bsl.id, bsl.ingredient_id, bsl.needed_quantity, bsl.allocated_quantity,
                bsl.status, ing.name as ingredient_name, ing.unit as ingredient_unit
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

        const applyAllocation = async (params: {
          sourceLocation: 'PESAGE' | 'ECONOMAT_REQUIRES_TRANSFER';
          lotId: string | null;
          suggestedEcoLotId: string | null;
          qty: number;
          note: string;
        }) => {
          const { sourceLocation, lotId, suggestedEcoLotId, qty, note } = params;
          if (!firstUpdateDone && line.status === 'rupture') {
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
             AND l.status IN ('active', 'expired') AND l.pesage_quantity > 0
           ORDER BY
             CASE WHEN l.status = 'active' THEN 0 ELSE 1 END,
             l.expiration_date ASC NULLS LAST,
             l.first_opened_at ASC NULLS FIRST, l.received_at ASC`,
          [line.ingredient_id, storeId, bonId]
        );

        for (const lot of pesageLots.rows) {
          if (remaining <= 0) break;
          const effective = parseFloat(lot.effective_pesage);
          if (effective <= 0) continue;
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
                      WHERE bsl.bon_id = $3 AND bsl.suggested_economat_lot_id = l.id
                        AND bsl.source_location = 'ECONOMAT_REQUIRES_TRANSFER'
                        AND bsl.status = 'en_attente'
                    ), 0)) AS effective_economat
             FROM ingredient_lots l
             WHERE l.ingredient_id = $1 AND l.store_id = $2
               AND l.status = 'active' AND l.economat_quantity > 0
             ORDER BY l.expiration_date ASC NULLS LAST, l.received_at ASC`,
            [line.ingredient_id, storeId, bonId]
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
        await client.query(
          `UPDATE production_bons_sortie
           SET status = 'preparation',
               partial_completed_by = $1, partial_completed_at = NOW(),
               updated_at = NOW()
           WHERE id = $2`,
          [userId, bonId]
        );
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

  // ─── Close the bon ───
  // Idempotent : si deja 'cloture', retourne le bon actuel sans erreur (double
  // appel de validation tolere, pas de toast rouge trompeur).
  async close(bonId: string, userId: string) {
    const current = await db.query(
      `SELECT * FROM production_bons_sortie WHERE id = $1`,
      [bonId]
    );
    if (current.rows.length === 0) {
      throw new Error('Bon de sortie introuvable');
    }
    if (current.rows[0].status === 'cloture') {
      return current.rows[0];
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `UPDATE production_bons_sortie
         SET status = 'cloture', closed_by = $1, closed_at = NOW(), updated_at = NOW()
         WHERE id = $2 AND status = 'verifie'
         RETURNING *`,
        [userId, bonId]
      );
      if (result.rows.length === 0) {
        throw new Error('Bon de sortie introuvable ou statut invalide pour cloture');
      }

      const bon = result.rows[0];

      // Auto-restore waiting items: le magasinier a validé le transfert,
      // donc les articles en attente peuvent être produits.
      await client.query(
        `UPDATE production_plan_items
         SET waiting_status = 'restored'
         WHERE plan_id = $1 AND waiting_status = 'waiting'`,
        [bon.plan_id]
      );

      await client.query('COMMIT');
      return bon;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ─── Cancel the bon ───
  async cancel(bonId: string, userId: string) {
    const result = await db.query(
      `UPDATE production_bons_sortie
       SET status = 'annule', updated_at = NOW()
       WHERE id = $1 AND status NOT IN ('cloture', 'annule')
       RETURNING *`,
      [bonId]
    );
    if (result.rows.length === 0) {
      throw new Error('Bon de sortie introuvable ou deja cloture/annule');
    }
    return result.rows[0];
  },

  // ─── Handle ecart: substitute lot or adjust quantity ───
  async handleEcart(bonId: string, ligneId: string, substituteLotId?: string, newQuantity?: number) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Verify the line belongs to the bon
      const lineResult = await client.query(
        `SELECT bsl.*, bs.store_id
         FROM production_bons_sortie_lignes bsl
         JOIN production_bons_sortie bs ON bs.id = bsl.bon_id
         WHERE bsl.id = $1 AND bsl.bon_id = $2`,
        [ligneId, bonId]
      );
      if (lineResult.rows.length === 0) {
        throw new Error('Ligne introuvable pour ce bon de sortie');
      }

      const line = lineResult.rows[0];

      if (substituteLotId) {
        // Substitute with a different lot
        const quantity = newQuantity ?? parseFloat(line.allocated_quantity);
        const ecart = quantity - parseFloat(line.allocated_quantity);

        await client.query(
          `UPDATE production_bons_sortie_lignes
           SET substitute_lot_id = $1, actual_quantity = $2, ecart_quantity = $3, status = 'substitue', updated_at = NOW()
           WHERE id = $4`,
          [substituteLotId, quantity, ecart, ligneId]
        );
      } else if (newQuantity !== undefined) {
        // Just adjust the quantity
        const ecart = newQuantity - parseFloat(line.allocated_quantity);
        const status = Math.abs(ecart) < 0.001 ? 'preleve' : 'ecart';

        await client.query(
          `UPDATE production_bons_sortie_lignes
           SET actual_quantity = $1, ecart_quantity = $2, status = $3, updated_at = NOW()
           WHERE id = $4`,
          [newQuantity, ecart, status, ligneId]
        );
      }

      const updatedResult = await client.query(
        `SELECT bsl.*,
                ing.name AS ingredient_name, ing.unit AS ingredient_unit,
                il.lot_number, il.supplier_lot_number, il.expiration_date
         FROM production_bons_sortie_lignes bsl
         JOIN ingredients ing ON ing.id = bsl.ingredient_id
         LEFT JOIN ingredient_lots il ON il.id = bsl.ingredient_lot_id
         WHERE bsl.id = $1`,
        [ligneId]
      );

      await client.query('COMMIT');
      return updatedResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ─── Regenerate: cancel existing bon(s) and create a new one ───
  async regenerate(planId: string, storeId: string, userId: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Cancel existing bons for this plan
      await client.query(
        `UPDATE production_bons_sortie
         SET status = 'annule', updated_at = NOW()
         WHERE plan_id = $1 AND status NOT IN ('cloture', 'annule')`,
        [planId]
      );

      // Clear the link on the plan
      await client.query(
        `UPDATE production_plans SET bon_sortie_id = NULL WHERE id = $1`,
        [planId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Now generate a fresh bon (this handles its own transaction)
    return this.generate(planId, storeId, userId);
  },
};

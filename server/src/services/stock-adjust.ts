/**
 * Ajustement du stock d'une matière (extrait de inventoryController.adjust pour être
 * partagé avec l'inventaire physique, mig 367).
 *
 * Source de vérité = ingredient_lots (mig 114) : le trigger trg_inventory_sync_lots tient
 * inventory.current_quantity à jour.
 *   - en plus : lot d'ajustement ADJ-AAMMJJ-NNNNN en réserve (économat), sans DLC ;
 *   - en moins : prélèvement FIFO sur les lots actifs, poste de pesée d'abord (stock
 *     entamé, origine la plus probable d'un écart) puis réserve.
 * Le client transmis doit être dans une transaction ouverte.
 */
type Runner = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, any>[] }> };

export async function ingredientStock(client: Runner, ingredientId: string, storeId: string | null): Promise<number> {
  const r = await client.query(
    `SELECT COALESCE(SUM(economat_quantity + pesage_quantity), 0)::numeric AS total
       FROM ingredient_lots
      WHERE ingredient_id = $1 AND ${storeId ? 'store_id = $2' : 'store_id IS NULL'} AND status = 'active'`,
    storeId ? [ingredientId, storeId] : [ingredientId]);
  return parseFloat(r.rows[0]?.total || '0');
}

export async function adjustIngredientStock(client: Runner, p: {
  ingredientId: string; storeId: string | null; qty: number; type: string; note?: string | null;
  userId: string | null; reasonCode?: string | null; lotNote?: string;
}): Promise<{ ok: true } | { ok: false; available: number }> {
  const { ingredientId, storeId, qty } = p;
  if (qty < 0) {
    const current = await ingredientStock(client, ingredientId, storeId);
    if (current + qty < 0) return { ok: false, available: current };
  }
  if (qty > 0) {
    // Numéro tiré de la séquence des lots (mig 308) : COUNT+1 non verrouillé produisait des doublons.
    const seq = await client.query(`SELECT 'ADJ-' || to_char(CURRENT_DATE, 'YYMMDD') || '-' || lpad(nextval('lot_number_seq')::text, 5, '0') AS n`);
    await client.query(
      `INSERT INTO ingredient_lots
         (ingredient_id, store_id, lot_number, quantity_received, quantity_remaining, economat_quantity, pesage_quantity, status, notes)
       VALUES ($1, $2, $3, $4, $4, $4, 0, 'active', $5)`,
      [ingredientId, storeId, seq.rows[0].n, qty, p.lotNote ?? `Ajustement positif (${p.type}) : ${p.note || 'sans motif'}`]);
  } else if (qty < 0) {
    let remaining = -qty;
    const lots = await client.query(
      `SELECT id, economat_quantity, pesage_quantity FROM ingredient_lots
        WHERE ingredient_id = $1 AND ${storeId ? 'store_id = $2' : 'store_id IS NULL'}
          AND status = 'active' AND (economat_quantity + pesage_quantity) > 0
        ORDER BY received_at ASC, created_at ASC FOR UPDATE`,
      storeId ? [ingredientId, storeId] : [ingredientId]);
    for (const lot of lots.rows) {
      if (remaining <= 0) break;
      const takePesage = Math.min(parseFloat(lot.pesage_quantity), remaining);
      remaining -= takePesage;
      const takeEconomat = Math.min(parseFloat(lot.economat_quantity), remaining);
      remaining -= takeEconomat;
      if (takePesage > 0 || takeEconomat > 0) {
        await client.query(`UPDATE ingredient_lots SET pesage_quantity = pesage_quantity - $1, economat_quantity = economat_quantity - $2 WHERE id = $3`,
          [takePesage, takeEconomat, lot.id]);
      }
    }
    if (remaining > 0.0001) throw new Error(`Decrement impossible : ${remaining.toFixed(4)} restant non couvert`);
  }
  // qty === 0 : aucun mouvement de stock, la transaction garde la trace.
  await client.query(
    `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, store_id, reason_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [ingredientId, p.type, qty, p.note || null, p.userId, storeId, p.reasonCode ?? null]);
  return { ok: true };
}

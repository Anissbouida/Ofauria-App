import type { PoolClient } from 'pg';
import { db } from '../config/database.js';

/**
 * Résolution du prix de vente par liste de prix (phase 6.1–6.3).
 *
 * Choisit, parmi les listes actives et en vigueur à la date, la plus SPÉCIFIQUE qui
 * cible le contexte (client précis > groupe libre > type de client > canal > générale),
 * départage par `priority` puis par date, et prend la ligne du bon palier de quantité.
 * Renvoie null quand aucune liste ne s'applique : l'appelant garde alors le prix de base.
 *
 * Le prix rendu est dans l'unité de vente de l'article (prix/pièce, /kg ou /personne),
 * comme products.price.
 */
type Runner = Pick<PoolClient, 'query'> | typeof db;

export interface PriceContext {
  channelId?: string | null;
  customerId?: string | null;
  customerType?: string | null;
  priceGroup?: string | null;
  date?: string | null;
}

export interface ResolvedPrice {
  unitPrice: number;
  priceListId: string;
  priceListName: string;
  currency: string;
}

export async function resolveSalePrice(
  runner: Runner,
  productId: string,
  quantity: number,
  ctx: PriceContext,
): Promise<ResolvedPrice | null> {
  const date = ctx.date ?? new Date().toISOString().slice(0, 10);
  // Spécificité : la liste doit soit ne pas cibler une dimension, soit la cibler
  // exactement. Score = somme des cibles exactes (plus spécifique = plus fort).
  const r = await runner.query(
    `SELECT pl.id, pl.name, pl.currency, pli.unit_price,
            (CASE WHEN pl.customer_id IS NOT NULL THEN 8 ELSE 0 END
           + CASE WHEN pl.price_group  IS NOT NULL THEN 4 ELSE 0 END
           + CASE WHEN pl.customer_type IS NOT NULL THEN 2 ELSE 0 END
           + CASE WHEN pl.channel_id   IS NOT NULL THEN 1 ELSE 0 END) AS specificity
       FROM price_lists pl
       JOIN price_list_items pli ON pli.price_list_id = pl.id AND pli.product_id = $1
      WHERE pl.is_active
        AND (pl.valid_from IS NULL OR pl.valid_from <= $2::date)
        AND (pl.valid_to   IS NULL OR pl.valid_to   >= $2::date)
        AND (pl.channel_id    IS NULL OR pl.channel_id    = $3)
        AND (pl.customer_id   IS NULL OR pl.customer_id   = $4)
        AND (pl.customer_type IS NULL OR pl.customer_type = $5)
        AND (pl.price_group   IS NULL OR pl.price_group   = $6)
        AND pli.min_quantity <= $7
      ORDER BY specificity DESC, pl.priority DESC, pli.min_quantity DESC, pl.created_at DESC
      LIMIT 1`,
    [productId, date, ctx.channelId ?? null, ctx.customerId ?? null,
     ctx.customerType ?? null, ctx.priceGroup ?? null, quantity],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    unitPrice: parseFloat(row.unit_price),
    priceListId: row.id,
    priceListName: row.name,
    currency: row.currency,
  };
}

/** Contexte de prix à partir d'un client (type + groupe lus en base si besoin). */
export async function priceContextForCustomer(
  runner: Runner,
  customerId: string | null | undefined,
  channelId: string | null | undefined,
): Promise<PriceContext> {
  if (!customerId) return { channelId: channelId ?? null };
  const c = (await runner.query(`SELECT customer_type, price_group FROM customers WHERE id = $1`, [customerId])).rows[0];
  return {
    channelId: channelId ?? null,
    customerId,
    customerType: c?.customer_type ?? null,
    priceGroup: c?.price_group ?? null,
  };
}

/**
 * Synchronisation des demandes d'achat avec les BC (refonte Achats D2, mig 305).
 *
 * Depuis la mig 305 le statut d'une demande est CALCULÉ par la base
 * (fn_recompute_purchase_request) à partir de sa couverture par ligne de BC
 * (request_po_lines) : triggers sur purchase_orders.status et sur les quantités
 * de purchase_order_items. Les trois appelants historiques (réception, édition
 * admin des lignes, passage en_attente_facturation -> livre_complet) gardent
 * cet appel : il force un recalcul idempotent, utile si une écriture contourne
 * les triggers (ex. remplacement des lignes d'un BC).
 *
 * Ce module n'importe que le type client pg : purchase-request.repository importe
 * déjà purchase-order.repository, l'inverse créerait un cycle.
 */

type QueryClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
};

/** Conservé pour compatibilité des appelants ; n'influe plus sur la décision. */
export const PO_RECEIVED_STATUSES = ['livre_complet', 'en_attente_facturation'] as const;

/**
 * Recalcule les demandes couvertes par un BC. Le statut du BC n'est plus lu ici :
 * c'est la quantité réellement livrée sur chaque ligne qui décide.
 *
 * @returns le nombre de demandes recalculées
 */
export async function closePurchaseRequestsForOrder(
  client: QueryClient,
  purchaseOrderId: string,
  _poStatus?: string,
): Promise<number> {
  const result = await client.query(
    `SELECT fn_recompute_purchase_requests_for_po($1) AS n`,
    [purchaseOrderId],
  );
  return Number(result.rows[0]?.n ?? 0);
}

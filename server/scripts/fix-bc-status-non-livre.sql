-- Correctif ponctuel : des BC simplement "Envoyes" ont ete bascules a tort en
-- 'non_livre' par une edition (bug de recalcul corrige dans replaceItems).
--
-- On ne remet en 'envoye' QUE les BC qui sont en 'non_livre' alors qu'aucune
-- ligne n'a ete reellement recue (quantity_delivered = 0 partout). Un BC
-- volontairement marque "Non livre" via le bouton dedie tombe aussi dans ce cas,
-- d'ou le ciblage explicite par numero pour rester prudent.

BEGIN;

-- Visualiser les candidats avant d'agir (decommente pour controle) :
-- SELECT po.order_number, po.status,
--        COALESCE(SUM(poi.quantity_delivered), 0) AS total_livre
-- FROM purchase_orders po
-- LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
-- WHERE po.status = 'non_livre'
-- GROUP BY po.id, po.order_number, po.status;

UPDATE purchase_orders po
SET status = 'envoye', updated_at = NOW()
WHERE po.status = 'non_livre'
  AND po.order_number IN ('BC-2026-0053', 'BC-2026-0051')
  AND NOT EXISTS (
    SELECT 1 FROM purchase_order_items poi
    WHERE poi.purchase_order_id = po.id
      AND poi.quantity_delivered > 0
  );

COMMIT;

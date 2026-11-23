-- 631 — Un lot de produit fini périmé garde le statut « expired ».
--
-- POURQUOI
--   fn_product_lot_invariant (mig 105, reprise en 440) bascule un lot en 'depleted' dès que
--   ses quantités en réserve et en vitrine tombent à zéro, en ne regardant que l'ancien
--   statut. La péremption automatique (productLotRepository.autoExpireDueLots) pose
--   status = 'expired' ET vide le lot dans la même mise à jour : le déclencheur réécrivait
--   'expired' en 'depleted'. Un lot jeté pour date dépassée devenait indiscernable d'un lot
--   vendu, ce qui fausse le registre des pertes, la traçabilité et les rappels.
--   Constaté par le scénario « Auto-expire lots produits » (tests base).
--
-- CE QUI CHANGE
--   La bascule automatique en 'depleted' ne s'applique que si l'appelant laisse le statut
--   à 'active'. Un statut posé explicitement (expired, disposed, recalled…) est respecté.
--   Aucune donnée existante n'est modifiée.

CREATE OR REPLACE FUNCTION fn_product_lot_invariant()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.backroom_qty + NEW.vitrine_qty + NEW.sold_qty + NEW.wasted_qty + NEW.recycled_qty
       > NEW.quantity_total + 0.001 THEN
    RAISE EXCEPTION 'product_lot invariant violated: somme(%, %, %, %, %) > total(%) pour lot %',
      NEW.backroom_qty, NEW.vitrine_qty, NEW.sold_qty, NEW.wasted_qty, NEW.recycled_qty,
      NEW.quantity_total, NEW.id;
  END IF;

  -- Auto-bascule en 'depleted' quand tout est consommé, sauf si l'appelant a posé
  -- lui-même un autre statut dans la même mise à jour (péremption, destruction…).
  IF NEW.backroom_qty = 0 AND NEW.vitrine_qty = 0 AND OLD.status = 'active'
     AND NEW.status = 'active'
     AND (NEW.sold_qty + NEW.wasted_qty + NEW.recycled_qty) > 0 THEN
    NEW.status := 'depleted';
  END IF;

  -- Retour en stock d'un lot épuisé non périmé : de nouveau actif (O2C L1, mig 440).
  IF OLD.status = 'depleted' AND NEW.status = 'depleted' AND NEW.backroom_qty + NEW.vitrine_qty > 0
     AND (CASE WHEN NEW.dlc_effective IS NOT NULL THEN NEW.dlc_effective > now()
               ELSE NEW.expires_at IS NULL OR NEW.expires_at > CURRENT_DATE END) THEN
    NEW.status := 'active';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;

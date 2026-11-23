-- 654 — Un seul lot ouvert à la fois par matière.
--
-- POURQUOI
--   Décision utilisateur (2026-11-23) : le système doit empêcher d'ouvrir un lot tant que le
--   lot déjà entamé n'est pas fini ou périmé. Avec le coût au prix du lot en cours (mig 653),
--   deux lots ouverts en même temps brouillent à la fois la rotation du stock (FEFO) et le coût.
--
-- CE QUI CHANGE
--   Ouvrir un lot = sa quantité au poste de pesée passe de 0 à plus de 0 (ouverture manuelle
--   vers le pesage, ouverture automatique à la pesée, prélèvement du bon de sortie : les trois
--   chemins passent par là). C'est refusé si, dans le même établissement, un AUTRE lot actif de
--   la même matière, non périmé (sans DLC ou DLC ≥ aujourd'hui), est entamé (quantité au poste
--   de pesée) ET a encore des contenants fermés en réserve : on finit d'ouvrir un lot avant
--   d'en entamer un autre. Quand tout le reste du lot entamé est déjà au pesage et ne suffit
--   pas, ouvrir le lot suivant pour compléter la pesée reste permis (le premier se finit par
--   la consommation, qui sort du lot à la DLC la plus proche). Ouvrir un autre contenant du
--   MÊME lot reste permis.
--   La règle vise les ouvertures décidées par l'opérateur (mise au pesage, prélèvement d'une
--   ligne de bon). La répartition FEFO automatique d'une pesée de bon sur plusieurs lots reste
--   permise (indicateur de transaction kalum.multi_lot_weighing posé par l'application).
--   Contrôle DIFFÉRÉ à la validation de l'opération (trigger de contrainte) : une pesée qui
--   vide le lot A puis ouvre le lot B dans la même transaction est jugée sur l'état final.
--   Pour débloquer : ouvrir le reste du lot entamé, le remettre en réserve, déclarer la perte,
--   ou attendre sa péremption. Erreur métier OF409 (409, message affiché tel quel).
--   Mode « pesage éteint » (sortie directe de la réserve) : aucun lot n'est ouvert, rien ne change.
--
-- RETOUR ARRIÈRE
--   DROP TRIGGER trg_one_open_lot ON ingredient_lots; DROP FUNCTION fn_one_open_lot();

CREATE OR REPLACE FUNCTION fn_one_open_lot()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cur record;
  o record;
  ing_name text;
BEGIN
  -- Répartition FEFO automatique d'une pesée de bon de sortie sur plusieurs lots (le lot
  -- choisi ne suffit pas, ou ses contenants restants sont réservés à un autre bon) : permise.
  -- Posé par bon-sortie.applyWeighing pour la seule transaction (set_config local).
  IF current_setting('kalum.multi_lot_weighing', true) = 'on' THEN
    RETURN NULL;
  END IF;
  -- État à la validation : le lot ouvert l'est-il toujours ?
  SELECT id, ingredient_id, store_id, lot_number, pesage_quantity, status INTO cur
    FROM ingredient_lots WHERE id = NEW.id;
  IF NOT FOUND OR cur.status <> 'active' OR COALESCE(cur.pesage_quantity, 0) <= 0 THEN
    RETURN NULL;
  END IF;
  SELECT l.lot_number, l.pesage_quantity, l.economat_quantity INTO o
    FROM ingredient_lots l
   WHERE l.ingredient_id = cur.ingredient_id
     AND l.store_id IS NOT DISTINCT FROM cur.store_id
     AND l.id <> cur.id
     AND l.status = 'active'
     AND COALESCE(l.pesage_quantity, 0) > 0
     AND COALESCE(l.economat_quantity, 0) > 0
     AND (l.expiration_date IS NULL OR l.expiration_date >= CURRENT_DATE)
   ORDER BY l.first_opened_at ASC NULLS LAST
   LIMIT 1;
  IF FOUND THEN
    SELECT name INTO ing_name FROM ingredients WHERE id = cur.ingredient_id;
    RAISE EXCEPTION 'Le lot « % » de % est déjà entamé (% au poste de pesée, % encore fermé en réserve) : finissez-le avant d''ouvrir le lot « % ».',
      o.lot_number, ing_name, round(o.pesage_quantity, 3), round(o.economat_quantity, 3), cur.lot_number
      USING ERRCODE = 'OF409';
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_one_open_lot ON ingredient_lots;
CREATE CONSTRAINT TRIGGER trg_one_open_lot
  AFTER UPDATE OF pesage_quantity ON ingredient_lots
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (COALESCE(OLD.pesage_quantity, 0) = 0 AND NEW.pesage_quantity > 0)
  EXECUTE FUNCTION fn_one_open_lot();

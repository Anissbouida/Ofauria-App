-- Coût figé à la consommation (analyse d'écart P2P, lot L3 — 1er incrément).
-- docs/AUDIT_P2P_GAP_ANALYSIS.md
--
-- Aujourd'hui le coût réel d'une fournée est lu EN DIRECT sur ingredient_lots.unit_cost
-- (production-cout.repository.ts). Dès que la suite du lot L3 réévaluera un lot
-- (écart de facture, frais d'approche), ce coût en direct réécrirait le passé :
-- une fournée déjà produite verrait son coût matière changer rétroactivement.
--
-- On fige donc le coût unitaire AU MOMENT DE LA CONSOMMATION dans
-- production_lot_usage.unit_cost_at_use. Le calcul de coût le lira en priorité ;
-- la réévaluation à venir ne touchera que la part ENCORE EN STOCK, jamais le
-- consommé. Incrément neutre aujourd'hui (valeur = coût courant du lot), il
-- devient le garde-fou des incréments suivants.

ALTER TABLE production_lot_usage ADD COLUMN IF NOT EXISTS unit_cost_at_use NUMERIC(12,4);
COMMENT ON COLUMN production_lot_usage.unit_cost_at_use IS
  'Coût unitaire du lot figé à la consommation (mig 444, lot L3 P2P). Lu en priorité par le coût réel de production ; fallback ingredient_lots.unit_cost pour les lignes d''avant la reprise.';

-- Instantané du coût au moment de l'usage. Ne touche pas une valeur déjà fournie.
CREATE OR REPLACE FUNCTION fn_plu_snapshot_cost() RETURNS trigger AS $$
BEGIN
  IF NEW.unit_cost_at_use IS NULL THEN
    SELECT COALESCE(il.unit_cost, i.unit_cost) INTO NEW.unit_cost_at_use
      FROM ingredient_lots il JOIN ingredients i ON i.id = il.ingredient_id
     WHERE il.id = NEW.ingredient_lot_id;
  END IF;
  IF NEW.unit_cost_at_use IS NULL OR NEW.unit_cost_at_use = 0 THEN
    -- Avertissement seulement (reprise en cours) ; deviendra bloquant quand tous
    -- les lots porteront un coût (suite du lot L3).
    RAISE WARNING 'Consommation sans coût figé (lot %, ingrédient %)', NEW.ingredient_lot_id, NEW.ingredient_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_plu_snapshot_cost ON production_lot_usage;
CREATE TRIGGER trg_plu_snapshot_cost BEFORE INSERT ON production_lot_usage
  FOR EACH ROW EXECUTE FUNCTION fn_plu_snapshot_cost();

-- Reprise : les consommations existantes prennent le coût ACTUEL de leur lot —
-- identique à ce que le calcul lisait en direct, donc aucune valeur ne change.
UPDATE production_lot_usage plu SET unit_cost_at_use = il.unit_cost
  FROM ingredient_lots il WHERE il.id = plu.ingredient_lot_id AND plu.unit_cost_at_use IS NULL;

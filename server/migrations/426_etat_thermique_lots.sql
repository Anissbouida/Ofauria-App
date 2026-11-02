-- 426 — État thermique des lots : surgelé / décongelé (épic labo L4, partie 1)
--
-- POURQUOI
--   Les lots de semi-finis et de produits ont une DLC (expires_at) mais aucun
--   état thermique : impossible de distinguer un lot frais d'un lot surgelé, de
--   recalculer la DLC à la décongélation, ni d'interdire la recongélation. Le
--   type d'étape « refroidissement » couvre surgélation et ressuage sans
--   distinction (écart F6.2, P1).
--
-- QUOI (sur semi_finished_lots ET product_lots)
--   - etat_thermique : frais | surgele | decongele (défaut frais).
--   - surgele_a / decongele_a : horodatage des transitions.
--   - dlc_effective : DLC applicable après décongélation (= decongele_a + durée de
--     vie après décongélation), NULL tant que le lot n'est pas décongelé. La DLC
--     affichée et le FEFO prennent COALESCE(dlc_effective, expires_at).
--   Les règles (surgelé→décongelé une fois, décongelé→surgelé interdit) sont
--   portées par le service (lot-thermal.repository).
--
-- INVERSION : DROP COLUMN dlc_effective, decongele_a, surgele_a, etat_thermique
--   sur les deux tables.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['semi_finished_lots', 'product_lots'] LOOP
    EXECUTE format($f$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS etat_thermique VARCHAR(10) NOT NULL DEFAULT 'frais'
          CHECK (etat_thermique IN ('frais', 'surgele', 'decongele')),
        ADD COLUMN IF NOT EXISTS surgele_a      TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS decongele_a    TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS dlc_effective  TIMESTAMPTZ
    $f$, t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_etat_thermique ON %I(etat_thermique) WHERE etat_thermique <> ''frais''', t, t);
  END LOOP;
END $$;

COMMENT ON COLUMN semi_finished_lots.etat_thermique IS
  'État thermique (épic labo L4, mig 426) : frais | surgele | decongele. Recongélation interdite.';
COMMENT ON COLUMN product_lots.etat_thermique IS
  'État thermique (épic labo L4, mig 426) : frais | surgele | decongele. Recongélation interdite.';

-- G6-06 — devise de base de la société en SQL, au lieu du code 'MAD' écrit en dur dans les
-- requêtes (factures en devise, FEC, réévaluation, campagnes de paiement…).
-- Une seule devise de base (uq_currencies_base, mig 363) ; repli 'MAD' si la table est vide.
-- Fonction nouvelle (aucune version antérieure en prod).
CREATE FUNCTION fn_base_currency() RETURNS varchar
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT code FROM currencies WHERE is_base LIMIT 1), 'MAD')::varchar
$$;

COMMENT ON FUNCTION fn_base_currency() IS 'Code ISO de la devise de base de la société (G6-06).';

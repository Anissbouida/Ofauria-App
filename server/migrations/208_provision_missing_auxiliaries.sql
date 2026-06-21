-- 208: Provisionne les auxiliaires comptables manquants (fournisseurs + clients)
--
-- Le seed des auxiliaires (compte collectif 4411 fournisseurs / 3421 clients)
-- n'a tourne qu'une fois dans la migration 179. Aucun code applicatif ne creait
-- l'auxiliaire d'un tiers ajoute APRES (le commentaire de 179 annoncait un
-- "code applicatif a venir" jamais ecrit). Resultat : un fournisseur/client
-- recent n'avait pas de ligne account_auxiliaries, donc la generation d'ecriture
-- (persistEntry) levait "Auxiliaire manquant" et echouait silencieusement
-- -> facture "sans ecriture" dans la reconciliation legacy <-> ledger.
--
-- Cette migration comble le retard pour tous les tiers existants. La prevention
-- (provision a la volee lors de la generation d'ecriture) est cablee cote code
-- dans journal-generator.service.ts (persistEntry). Apres cette migration, le
-- bouton "Generer" du bandeau de reconciliation peut creer les ecritures qui
-- manquaient.
--
-- Meme convention de code que le seed 179 :
--   4411-FOUR-<6 lettres nom>-<4 premiers chars id>
--   3421-CLI-<6 lettres prenom+nom>-<4 premiers chars id>
-- Idempotent : WHERE NOT EXISTS + ON CONFLICT DO NOTHING.

INSERT INTO account_auxiliaries (account_id, supplier_id, code, label)
SELECT
  (SELECT id FROM accounts WHERE code = '4411'),
  s.id,
  '4411-FOUR-' || UPPER(SUBSTR(REGEXP_REPLACE(s.name, '[^A-Za-z0-9]', '', 'g'), 1, 6))
              || '-' || SUBSTR(s.id::TEXT, 1, 4),
  s.name
FROM suppliers s
WHERE NOT EXISTS (
  SELECT 1 FROM account_auxiliaries a WHERE a.supplier_id = s.id
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO account_auxiliaries (account_id, customer_id, code, label)
SELECT
  (SELECT id FROM accounts WHERE code = '3421'),
  c.id,
  '3421-CLI-' || UPPER(SUBSTR(REGEXP_REPLACE(
    COALESCE(c.first_name, '') || COALESCE(c.last_name, ''),
    '[^A-Za-z0-9]', '', 'g'), 1, 6))
            || '-' || SUBSTR(c.id::TEXT, 1, 4),
  TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
FROM customers c
WHERE NOT EXISTS (
  SELECT 1 FROM account_auxiliaries a WHERE a.customer_id = c.id
)
ON CONFLICT (code) DO NOTHING;

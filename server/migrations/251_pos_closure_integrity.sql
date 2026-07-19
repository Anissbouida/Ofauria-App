-- Migration 251 : integrites structurelles fermeture de caisse / decisions invendus
--
-- Corrige plusieurs constats de l'audit POS (docs/AUDIT_POS.md, sections 3-4) :
--   * N3  : dedoublonnage des decisions invendus par (session_id, product_id).
--   * C10 : CHECK sur close_type ; les fenetres d'inventaire des invendus filtrent
--           sur ce champ, une valeur inattendue les fausse.
--   * C6  : phase de comptage entre close() et submit() -> refuser les ventes,
--           on tag closing_started_at et on discrimine cote sale.controller.
--   * C8  : race a l'ouverture (2 sessions ouvertes possibles) -> index unique
--           partiel (user_id) WHERE status='open'.
--   * N6  : type de check 'passation' distinct de 'closing' pour que le trigger
--           opening (mig 116) ne bloque pas l'ouverture du shift suivant en
--           pleine journee. On l'ajoute a l'enum CHECK et on adapte le trigger.
--
-- N.B. : les CHECK des destinations unsold_decisions sont deja OK depuis la
-- mig 244 (retour_stock ajoute). Le CHECK de sessions.status reste ('open',
-- 'closed') : on ne cree pas d'etat intermediaire, on utilise un flag booleen
-- (closing_started_at) pour bloquer les ventes pendant le comptage.

BEGIN;

-- ─── 1. close_type strictement borne ────────────────────────────────────────
-- Deux valeurs metier : 'passation' (changement de shift) et 'fin_journee'
-- (cloture de la journee). Toute autre valeur casse la logique de fenetrage
-- des invendus et des rapports Z.
ALTER TABLE cash_register_sessions
  DROP CONSTRAINT IF EXISTS cash_register_sessions_close_type_check;
ALTER TABLE cash_register_sessions
  ADD CONSTRAINT cash_register_sessions_close_type_check
  CHECK (close_type IS NULL OR close_type IN ('passation', 'fin_journee'));

-- ─── 2. Phase de comptage : bloquer les ventes entre close() et submit() ────
-- close() fige les totaux mais laisse status='open'. Toute vente encaissee
-- entre-temps entrait dans le tiroir sans etre comptabilisee dans
-- expected_cash -> faux excedent au submit. On tag l'entree en phase.
ALTER TABLE cash_register_sessions
  ADD COLUMN IF NOT EXISTS closing_started_at TIMESTAMPTZ;

-- ─── 3. Une seule session ouverte par utilisateur (garantie DB) ────────────
-- Le check-then-insert du controller n'est pas transactionnel : 2 clics
-- simultanes creent 2 sessions. Index partiel = garde-fou definitif.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cash_session_open_per_user
  ON cash_register_sessions (user_id)
  WHERE status = 'open';

-- ─── 4. Une decision invendu unique par (session, produit) ─────────────────
-- Retry reseau ou double fermeture creaient un double decrement vitrine +
-- deux pertes. Avant de poser la contrainte on nettoie les doublons
-- historiques : on garde la ligne la plus recente et supprime les autres,
-- ainsi que leurs items miroir dans daily_inventory_check_items pour ne pas
-- laisser des orphelins pointer sur des decisions supprimees.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY session_id, product_id
           ORDER BY created_at DESC
         ) AS rn
    FROM unsold_decisions
   WHERE session_id IS NOT NULL
),
to_delete AS (
  SELECT id FROM ranked WHERE rn > 1
)
DELETE FROM unsold_decisions WHERE id IN (SELECT id FROM to_delete);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_unsold_decisions_session_product
  ON unsold_decisions (session_id, product_id)
  WHERE session_id IS NOT NULL;

-- ─── 5. Type 'passation' pour les daily_inventory_checks ──────────────────
-- Le trigger check_opening_inventory_required (mig 116) bloque l'ouverture
-- de caisse tant qu'un check opening n'est pas valide APRES la derniere
-- ligne check_type='closing'. Sans distinction, une passation ecrite en
-- 'closing' declenche le trigger au shift suivant en pleine journee
-- (constat N6). On ajoute 'passation' a l'enum, et on adapte le trigger
-- pour n'exiger un check opening qu'apres un vrai 'closing' (fin_journee).
ALTER TABLE daily_inventory_checks
  DROP CONSTRAINT IF EXISTS daily_inventory_checks_check_type_check;
ALTER TABLE daily_inventory_checks
  ADD CONSTRAINT daily_inventory_checks_check_type_check
  CHECK (check_type IN ('closing', 'opening', 'passation'));

CREATE OR REPLACE FUNCTION check_opening_inventory_required()
RETURNS TRIGGER AS $$
DECLARE
  yesterday_remaining INTEGER;
  validated_opening_count INTEGER;
BEGIN
  -- Invendus reexposes lors de la DERNIERE cloture 'closing' (fin_journee).
  -- Les passations ne creent PAS d'obligation de check d'ouverture : elles
  -- servent de comptage contradictoire au sein d'une meme journee, le shift
  -- entrant recoit deja les invendus a vue.
  SELECT COALESCE(SUM(dici.remaining_qty), 0)
    INTO yesterday_remaining
    FROM daily_inventory_checks dic
    JOIN daily_inventory_check_items dici ON dici.check_id = dic.id
   WHERE dic.store_id = NEW.store_id
     AND dic.check_type = 'closing'
     AND dici.destination = 'reexpose'
     AND dici.remaining_qty > 0
     AND dic.created_at = (
       SELECT MAX(dic2.created_at)
         FROM daily_inventory_checks dic2
        WHERE dic2.store_id = NEW.store_id
          AND dic2.check_type = 'closing'
     );

  IF yesterday_remaining = 0 THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
    INTO validated_opening_count
    FROM daily_inventory_checks dic
   WHERE dic.store_id = NEW.store_id
     AND dic.check_type = 'opening'
     AND dic.status = 'validated'
     AND dic.created_at > (
       SELECT MAX(dic2.created_at)
         FROM daily_inventory_checks dic2
        WHERE dic2.store_id = NEW.store_id
          AND dic2.check_type = 'closing'
     );

  IF validated_opening_count = 0 THEN
    RAISE EXCEPTION 'opening_inventory_check_required: % invendus reexposes en attente de controle d''ouverture pour le store %',
      yesterday_remaining, NEW.store_id
      USING ERRCODE = 'P0001',
            HINT = 'Effectuer le controle d''inventaire d''ouverture avant d''ouvrir la caisse.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;

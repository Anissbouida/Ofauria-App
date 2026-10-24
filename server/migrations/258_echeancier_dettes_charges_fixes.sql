-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 258 : Echeancier des dettes & charges fixes recurrentes
--
-- POURQUOI
--   Deux besoins non couverts aujourd'hui :
--
--   1. MATERIEL / EQUIPEMENT ACHETE A CREDIT
--      Une facture ne porte qu'une seule `due_date`. Impossible de suivre
--      "four a 60 000 DH regle en 10 mensualites de 6 000". On voit le reste
--      a payer, jamais le calendrier. Et un achat a credit sans facture saisie
--      (materiel ancien, credit direct chez le fournisseur) n'a aucun support.
--
--   2. CHARGES FIXES (loyer, electricite, eau, internet...)
--      Aucune notion de recurrence : chaque mois il faut se souvenir de saisir
--      le loyer. Si on oublie, rien ne le signale — le systeme ignore qu'un
--      loyer etait attendu.
--
-- PORTEE
--   - debts              : dette echelonnee autonome (sans facture).
--   - recurring_charges  : modele d'une charge fixe (loyer 8 000 le 5, etc.).
--   - scheduled_payments : LES ECHEANCES. Une ligne = une date + un montant du.
--                          Rattachee a exactement une source : facture, dette
--                          autonome, ou modele recurrent.
--   - payments.scheduled_payment_id : un reglement d'echeance reste un paiement
--                          normal (caisse, cheques, ledger) — on ajoute juste
--                          le lien vers l'echeance qu'il solde.
--   - Trigger de resync amount_paid/status des echeances (et statut des dettes).
--   - fn_generate_recurring_schedules() : materialise les echeances a venir des
--                          charges fixes, de facon idempotente.
--   - Compte CGNC 4481 (Dettes sur acquisitions d'immobilisations), absent du
--     plan : c'est le compte de la dette envers un fournisseur d'equipement,
--     distinct de 4411 (fournisseurs d'exploitation).
--
--   Aucune table existante modifiee hors l'ajout de colonne sur `payments`.
--
-- INVERSION
--   DROP TRIGGER trg_sync_scheduled_payment ON payments;
--   DROP FUNCTION fn_sync_scheduled_payment, fn_recompute_scheduled_payment,
--                 fn_generate_recurring_schedules;
--   ALTER TABLE payments DROP COLUMN scheduled_payment_id;
--   DROP TABLE scheduled_payments, recurring_charges, debts;
-- ═══════════════════════════════════════════════════════════════════════════

-- ============================================================================
-- 1. Compte CGNC manquant : dettes sur acquisitions d'immobilisations
-- ============================================================================
INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side, is_collective, auxiliary_kind, tva_rate, tva_direction) VALUES
  ('4481', 'Dettes sur acquisitions d''immobilisations', 4, '44', '448', 'liability', 'C', false, NULL, NULL, NULL)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- 2. debts — dette echelonnee autonome (pas de facture en face)
-- ============================================================================
-- Cas d'usage : materiel achete a credit sans facture saisie dans le systeme,
-- reprise d'un credit en cours, avance d'un tiers. Le solde est porte par la
-- dette elle-meme (total_amount - somme des reglements de ses echeances).
--
-- Quand la facture EXISTE dans le systeme, on ne cree PAS de dette : on
-- attache les echeances directement a la facture (scheduled_payments.invoice_id)
-- et le solde reste porte par invoices.paid_amount. Cela evite de compter la
-- meme dette deux fois dans l'onglet Dettes.

CREATE TABLE IF NOT EXISTS debts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label          VARCHAR(200) NOT NULL,
  supplier_id    UUID REFERENCES suppliers(id),
  category_id    UUID REFERENCES expense_categories(id),
  -- Lien optionnel vers l'immobilisation correspondante (four, frigo...) :
  -- la dette suit le financement, fixed_assets suit l'amortissement.
  fixed_asset_id UUID REFERENCES fixed_assets(id) ON DELETE SET NULL,
  total_amount   DECIMAL(14,2) NOT NULL CHECK (total_amount > 0),
  start_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  status         VARCHAR(20) NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'settled', 'cancelled')),
  notes          TEXT,
  store_id       UUID REFERENCES stores(id),
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_debts_status   ON debts(status);
CREATE INDEX IF NOT EXISTS idx_debts_supplier ON debts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_debts_store    ON debts(store_id);

COMMENT ON TABLE debts IS
  'Dette echelonnee sans facture (materiel a credit, credit repris). Le solde = total_amount - reglements des echeances rattachees. Si la facture existe, ne pas creer de dette : echeancier directement sur la facture.';

-- ============================================================================
-- 3. recurring_charges — modele d'une charge fixe
-- ============================================================================
-- interval_months : 1 = mensuel, 2 = bimestriel (electricite), 3 = trimestriel,
--                   12 = annuel (assurance, taxe).
-- amount NULL      = montant variable : l'echeance est generee sans montant,
--                   a completer a reception de la facture (cas electricite/eau).
-- due_day          = jour du mois de l'echeance ; borne a la fin du mois pour
--                   les mois courts (due_day=31 -> 28/29 fevrier).

CREATE TABLE IF NOT EXISTS recurring_charges (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label                 VARCHAR(200) NOT NULL,
  category_id           UUID NOT NULL REFERENCES expense_categories(id),
  supplier_id           UUID REFERENCES suppliers(id),
  amount                DECIMAL(14,2) CHECK (amount IS NULL OR amount > 0),
  interval_months       SMALLINT NOT NULL DEFAULT 1 CHECK (interval_months BETWEEN 1 AND 12),
  due_day               SMALLINT NOT NULL DEFAULT 1 CHECK (due_day BETWEEN 1 AND 31),
  start_date            DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date              DATE,
  expected_payment_mode VARCHAR(20),
  is_active             BOOLEAN NOT NULL DEFAULT true,
  notes                 TEXT,
  store_id              UUID REFERENCES stores(id),
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_recurring_charges_active ON recurring_charges(is_active);
CREATE INDEX IF NOT EXISTS idx_recurring_charges_store  ON recurring_charges(store_id);

COMMENT ON TABLE recurring_charges IS
  'Modele d''une charge fixe (loyer, electricite, eau...). Genere des echeances a l''avance via fn_generate_recurring_schedules(). amount NULL = montant variable a saisir a reception.';

-- ============================================================================
-- 4. scheduled_payments — les echeances
-- ============================================================================
-- Une ligne = "le 05/09/2026 je dois sortir 6 000 DH pour X".
-- Exactement une source parmi invoice_id / debt_id / recurring_charge_id.
--
-- amount_due NULL  = montant pas encore connu (charge fixe variable).
-- amount_paid      = somme des paiements pointant sur l'echeance (trigger).
--                    Comme pour invoices.paid_amount, un cheque compte des son
--                    emission (engagement tenu), pas a l'encaissement.

CREATE TABLE IF NOT EXISTS scheduled_payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind           VARCHAR(20) NOT NULL
                          CHECK (source_kind IN ('invoice', 'debt', 'recurring')),
  invoice_id            UUID REFERENCES invoices(id) ON DELETE CASCADE,
  debt_id               UUID REFERENCES debts(id) ON DELETE CASCADE,
  recurring_charge_id   UUID REFERENCES recurring_charges(id) ON DELETE CASCADE,
  -- Libelle affiche dans l'echeancier ("Four rotatif 3/10", "Loyer aout 2026")
  label                 VARCHAR(250) NOT NULL,
  supplier_id           UUID REFERENCES suppliers(id),
  category_id           UUID REFERENCES expense_categories(id),
  due_date              DATE NOT NULL,
  amount_due            DECIMAL(14,2) CHECK (amount_due IS NULL OR amount_due > 0),
  amount_paid           DECIMAL(14,2) NOT NULL DEFAULT 0,
  status                VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'partial', 'paid', 'cancelled')),
  -- Rang de l'echeance dans son plan : 3 / 10
  installment_no        SMALLINT,
  installment_total     SMALLINT,
  -- Periode couverte pour une charge recurrente ('2026-08') : sert de cle
  -- d'idempotence a la generation automatique.
  period_label          VARCHAR(10),
  expected_payment_mode VARCHAR(20),
  notes                 TEXT,
  store_id              UUID REFERENCES stores(id),
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Exactement une source renseignee, coherente avec source_kind
  CONSTRAINT scheduled_payments_source_ck CHECK (
    (source_kind = 'invoice'   AND invoice_id IS NOT NULL AND debt_id IS NULL AND recurring_charge_id IS NULL) OR
    (source_kind = 'debt'      AND debt_id IS NOT NULL AND invoice_id IS NULL AND recurring_charge_id IS NULL) OR
    (source_kind = 'recurring' AND recurring_charge_id IS NOT NULL AND invoice_id IS NULL AND debt_id IS NULL)
  )
);

-- Idempotence de la generation : une seule echeance par periode et par modele.
CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduled_recurring_period
  ON scheduled_payments(recurring_charge_id, period_label)
  WHERE recurring_charge_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_due     ON scheduled_payments(due_date);
CREATE INDEX IF NOT EXISTS idx_scheduled_open    ON scheduled_payments(due_date)
  WHERE status IN ('pending', 'partial');
CREATE INDEX IF NOT EXISTS idx_scheduled_invoice ON scheduled_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_debt    ON scheduled_payments(debt_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_store   ON scheduled_payments(store_id);

COMMENT ON TABLE scheduled_payments IS
  'Echeances de paiement (calendrier des sorties). Source unique : facture echelonnee, dette autonome, ou charge fixe recurrente. Le reglement se fait via un payment porteur de scheduled_payment_id.';

-- ============================================================================
-- 5. payments.scheduled_payment_id — le lien reglement <-> echeance
-- ============================================================================
-- Regler une echeance reste un paiement ordinaire : meme table, meme mode
-- (espece/cheque/traite/virement), meme integration caisse / cheques / ledger.
-- On ajoute uniquement le pointeur vers l'echeance soldee.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS scheduled_payment_id UUID REFERENCES scheduled_payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_scheduled ON payments(scheduled_payment_id)
  WHERE scheduled_payment_id IS NOT NULL;

COMMENT ON COLUMN payments.scheduled_payment_id IS
  'Echeance soldee par ce paiement (NULL pour un paiement hors echeancier).';

-- ============================================================================
-- 6. Resync automatique amount_paid / status
-- ============================================================================
-- Meme semantique que invoiceRepository.updatePaidAmount : on somme les
-- paiements rattaches, sans filtrer sur cashed_at. Un statut 'cancelled' pose
-- manuellement n'est jamais ecrase par le recalcul.

CREATE OR REPLACE FUNCTION fn_recompute_scheduled_payment(p_id UUID)
RETURNS VOID AS $$
DECLARE
  v_paid    NUMERIC;
  v_due     NUMERIC;
  v_status  VARCHAR(20);
  v_debt_id UUID;
BEGIN
  SELECT amount_due, status, debt_id
    INTO v_due, v_status, v_debt_id
    FROM scheduled_payments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM payments WHERE scheduled_payment_id = p_id;

  UPDATE scheduled_payments
     SET amount_paid = v_paid,
         status = CASE
           WHEN v_status = 'cancelled' THEN 'cancelled'
           -- Tolerance 0.01 DH : arrondis d'echeancier (dernier terme ajuste).
           WHEN v_due IS NOT NULL AND v_paid >= v_due - 0.01 AND v_paid > 0 THEN 'paid'
           WHEN v_paid > 0 THEN 'partial'
           ELSE 'pending'
         END
   WHERE id = p_id;

  -- Une dette autonome se solde quand toutes ses echeances sont reglees.
  IF v_debt_id IS NOT NULL THEN
    UPDATE debts d
       SET status = CASE
         WHEN d.status = 'cancelled' THEN 'cancelled'
         WHEN NOT EXISTS (
           SELECT 1 FROM scheduled_payments sp
            WHERE sp.debt_id = d.id AND sp.status IN ('pending', 'partial')
         ) AND EXISTS (
           SELECT 1 FROM scheduled_payments sp WHERE sp.debt_id = d.id
         ) THEN 'settled'
         ELSE 'active'
       END
     WHERE d.id = v_debt_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_sync_scheduled_payment()
RETURNS TRIGGER AS $$
BEGIN
  -- Ancienne echeance (UPDATE qui deplace le lien, ou DELETE)
  IF TG_OP <> 'INSERT' AND OLD.scheduled_payment_id IS NOT NULL THEN
    PERFORM fn_recompute_scheduled_payment(OLD.scheduled_payment_id);
  END IF;
  -- Nouvelle echeance
  IF TG_OP <> 'DELETE' AND NEW.scheduled_payment_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.scheduled_payment_id IS DISTINCT FROM OLD.scheduled_payment_id
          OR NEW.amount IS DISTINCT FROM OLD.amount) THEN
    PERFORM fn_recompute_scheduled_payment(NEW.scheduled_payment_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_scheduled_payment ON payments;
CREATE TRIGGER trg_sync_scheduled_payment
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_sync_scheduled_payment();

-- ============================================================================
-- 7. Generation des echeances recurrentes
-- ============================================================================
-- Materialise les echeances des charges fixes actives jusqu'a l'horizon demande
-- (defaut 90 jours). Idempotent : l'index unique (modele, periode) absorbe les
-- appels repetes, donc la fonction peut etre appelee a chaque ouverture de
-- l'onglet Dettes sans effet de bord.
--
-- Une echeance deja generee n'est jamais modifiee : si le loyer passe de 8 000
-- a 8 500, seules les periodes futures non encore generees prennent le nouveau
-- montant (les anciennes se corrigent a la main si besoin).

CREATE OR REPLACE FUNCTION fn_generate_recurring_schedules(p_horizon_days INT DEFAULT 90)
RETURNS INT AS $$
DECLARE
  v_count INT := 0;
  v_mois  TEXT[] := ARRAY['janvier','février','mars','avril','mai','juin',
                          'juillet','août','septembre','octobre','novembre','décembre'];
BEGIN
  WITH periodes AS (
    SELECT
      rc.id            AS rc_id,
      rc.label         AS rc_label,
      rc.supplier_id   AS rc_supplier_id,
      rc.category_id   AS rc_category_id,
      rc.amount        AS rc_amount,
      rc.start_date    AS rc_start_date,
      rc.expected_payment_mode AS rc_mode,
      rc.store_id      AS rc_store_id,
      p.periode::date  AS periode,
      -- Jour d'echeance borne a la fin du mois (due_day=31 en fevrier -> 28/29)
      LEAST(
        p.periode + ((rc.due_day - 1) * INTERVAL '1 day'),
        p.periode + INTERVAL '1 month' - INTERVAL '1 day'
      )::date AS due_date
    FROM recurring_charges rc
    CROSS JOIN LATERAL generate_series(
      DATE_TRUNC('month', rc.start_date::timestamp),
      DATE_TRUNC('month', (CURRENT_DATE + (p_horizon_days || ' days')::interval)::timestamp),
      (rc.interval_months || ' months')::interval
    ) AS p(periode)
    WHERE rc.is_active
      AND (rc.end_date IS NULL OR p.periode::date <= rc.end_date)
  )
  INSERT INTO scheduled_payments (
    source_kind, recurring_charge_id, label, supplier_id, category_id,
    due_date, amount_due, expected_payment_mode, period_label, store_id
  )
  SELECT
    'recurring',
    pe.rc_id,
    pe.rc_label || ' — ' || v_mois[EXTRACT(MONTH FROM pe.periode)::int]
                 || ' ' || EXTRACT(YEAR FROM pe.periode)::int,
    pe.rc_supplier_id,
    pe.rc_category_id,
    pe.due_date,
    pe.rc_amount,
    pe.rc_mode,
    TO_CHAR(pe.periode, 'YYYY-MM'),
    pe.rc_store_id
  FROM periodes pe
  -- Ne pas generer une echeance anterieure au demarrage du contrat
  -- (start_date 15/08 + due_day 5 -> la periode d'aout est ignoree).
  WHERE pe.due_date >= pe.rc_start_date
  ON CONFLICT (recurring_charge_id, period_label) WHERE recurring_charge_id IS NOT NULL
  DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_generate_recurring_schedules(INT) IS
  'Genere les echeances des charges fixes actives jusqu''a CURRENT_DATE + horizon. Idempotent (index unique modele/periode). Retourne le nombre d''echeances creees.';

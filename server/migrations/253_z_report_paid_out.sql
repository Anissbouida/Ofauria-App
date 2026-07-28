-- Migration 253 : Z-report inviolable + paid-out + verrou de cloture.
--
-- Corrige les manques de la section 4.3 de l'audit POS :
--   * Z/X report : numerotation sequentielle immuable des cloturures.
--   * Paid-out/paid-in : rattacher les payments cash a la session pour ne pas
--     creer de faux deficit quand une depense est reglee depuis le tiroir.
--   * Cloture verrouillee : locked_at signale l'irrevocabilite (le repo refuse
--     desormais toute modif post-lock).

BEGIN;

-- ─── 1. Numero de cloture (Z-report) ──────────────────────────────────────
ALTER TABLE cash_register_sessions
  ADD COLUMN IF NOT EXISTS closure_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

-- Unicite du numero : un Z-report ne doit jamais etre re-emis avec le meme
-- numero. Index unique NULL-friendly (les sessions ouvertes n'en ont pas).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cash_session_closure_number
  ON cash_register_sessions (closure_number)
  WHERE closure_number IS NOT NULL;

-- ─── 2. Motif d'ecart (utilise si |difference| > seuil) ───────────────────
-- La colonne notes existait deja mais n'etait pas rattachee a un motif
-- structure. On garde notes libre + on ajoute un enum limite pour l'analyse.
ALTER TABLE cash_register_sessions
  ADD COLUMN IF NOT EXISTS difference_reason VARCHAR(30);

ALTER TABLE cash_register_sessions
  DROP CONSTRAINT IF EXISTS cash_register_sessions_difference_reason_check;
ALTER TABLE cash_register_sessions
  ADD CONSTRAINT cash_register_sessions_difference_reason_check
  CHECK (difference_reason IS NULL OR difference_reason IN (
    'rendu_monnaie', 'vol', 'erreur_comptage', 'depense_hors_paidout',
    'autre'
  ));

-- ─── 3. Paid-out : rattacher payments a la session courante ───────────────
-- Un paiement fournisseur/salaire regle en cash depuis le tiroir doit
-- diminuer expected_cash a la cloture. Sans lien, un shift avec 500 DH de
-- depenses cash montrait -500 DH d'ecart artificiel.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES cash_register_sessions(id);

CREATE INDEX IF NOT EXISTS idx_payments_session ON payments(session_id) WHERE session_id IS NOT NULL;

-- ─── 4. Nouveaux source_kind pour le ledger ───────────────────────────────
-- 'product_loss' : ecriture 6114 D / 3421 C pour tracer les pertes produits
-- (destruction, ecart inventaire, DLC expiree, recyclage) — auparavant
-- silencieusement absorbees dans le CA (7111 minore).
-- 'closure_diff' : ecriture 658 D / 5161 C (manque) ou 5161 D / 758 C
-- (excedent) pour ne plus dissimuler les ecarts de caisse dans le CA.
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_kind_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_kind_check
  CHECK (source_kind IN (
    'manual', 'invoice', 'payment', 'sale', 'reversal', 'backfill',
    'shift_entry', 'product_loss', 'closure_diff'
  ));

COMMIT;

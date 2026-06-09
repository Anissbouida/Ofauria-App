-- Migration 149 : saisie manuelle des montants caisse par shift (matin/soir).
--
-- Contexte : le POS n'est pas encore utilise de maniere fiable par toutes les
-- equipes. En attendant que les caissiers utilisent systematiquement le POS,
-- on offre aux admins/managers une saisie manuelle journaliere des montants
-- de caisse pour les deux shifts (matin/soir), avec distinction entre
-- montant reel (compte physiquement) et montant systeme (theorique POS).
--
-- Une ligne par (store_id, entry_date). Les 8 montants sont nullables : le
-- gerant peut ne saisir qu'un shift, ou ne saisir que les especes, etc.
-- Cette table est independante de cash_register_sessions — c'est un registre
-- parallele a vocation temporaire (a deprecier quand le POS sera adopte).

BEGIN;

CREATE TABLE IF NOT EXISTS manual_shift_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,

  -- Shift matin
  matin_cash_reel DECIMAL(10,2),
  matin_cash_systeme DECIMAL(10,2),
  matin_carte_reel DECIMAL(10,2),
  matin_carte_systeme DECIMAL(10,2),

  -- Shift soir
  soir_cash_reel DECIMAL(10,2),
  soir_cash_systeme DECIMAL(10,2),
  soir_carte_reel DECIMAL(10,2),
  soir_carte_systeme DECIMAL(10,2),

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),

  CONSTRAINT uq_manual_shift_entry_per_day UNIQUE (store_id, entry_date)
);

CREATE INDEX IF NOT EXISTS idx_manual_shift_entries_date
  ON manual_shift_entries(store_id, entry_date DESC);

COMMENT ON TABLE manual_shift_entries IS
  'Saisie manuelle des montants de caisse par shift (matin/soir). Temporaire le temps que le POS soit adopte par les equipes.';
COMMENT ON COLUMN manual_shift_entries.matin_cash_reel IS
  'Montant especes physiquement compte en fin de shift matin.';
COMMENT ON COLUMN manual_shift_entries.matin_cash_systeme IS
  'Montant especes theorique selon le POS pour le shift matin.';

COMMIT;

-- Migration 237 : Ajustement manuel du report de caisse (admin)
-- Le « Report mois précédent » de l'onglet Caisse est recalculé depuis tout
-- l'historique (paiements + sessions caisse + ventes/saisies manuelles).
-- Quand l'historique est incomplet (POS pas encore en prod, reprise de
-- donnees), l'admin doit pouvoir fixer le report d'un mois donne.
--
-- Principe « ancre » : une ligne fixe le solde AU 1er du mois effective_month.
-- Pour un mois M affiche, on prend l'ancre la plus recente <= 1er de M puis on
-- ajoute les flux entre l'ancre et le 1er de M. Ainsi corriger le report de
-- juillet corrige aussi automatiquement aout, septembre, etc.
-- DROP : DROP TABLE IF EXISTS caisse_balance_overrides;

CREATE TABLE IF NOT EXISTS caisse_balance_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Toujours le 1er du mois : solde reporte a l'ouverture de ce mois
  effective_month DATE NOT NULL CHECK (EXTRACT(DAY FROM effective_month) = 1),
  -- NULL = vue globale (admin sans magasin), sinon caisse d'un magasin
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  cash_net NUMERIC(12,2) NOT NULL DEFAULT 0,
  card_cumul NUMERIC(12,2) NOT NULL DEFAULT 0,
  note TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unicite par (mois, magasin) — store_id NULL traite comme une valeur
CREATE UNIQUE INDEX IF NOT EXISTS uq_caisse_balance_override_month_store
  ON caisse_balance_overrides (effective_month, COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid));

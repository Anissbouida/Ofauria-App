-- ═══════════════════════════════════════════════════════════════════════
-- 319 — Paie, lot 5 de la refonte RH : comptabilisation et déclarations
--   1. Compte de contrepartie des retenues de rubriques (prêt, divers).
--   2. Motif d'annulation « depuis la Paie » : un paiement de salaire exécuté
--      s'annule par contre-pièce (void), plus par suppression (refusée).
--   3. Catégories de règlement des dettes sociales et fiscales : CNSS (4441),
--      IR sur salaires (44525), CIMR (4443) — le règlement solde la dette.
--   4. Suivi des déclarations mensuelles (CNSS, IR, CIMR) : déclaré / réglé.
-- Écriture de paie (OD, à la clôture du mois), par bulletin :
--   D 6171 brut · D 6174 charges patronales
--   C 4441 CNSS+AMO (sal.+pat.) + alloc. familiales + TFP · C 4443 CIMR
--   C 44525 IR · C retenues (3431 par défaut) · C 4432 net à payer
-- Au paiement, D 4432 / C 6171 du net (le paiement reste 6171 D / trésorerie C).
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Compte des retenues ────────────────────────────────────────────
ALTER TABLE payroll_rubriques
  ADD COLUMN IF NOT EXISTS account_code VARCHAR(10);
COMMENT ON COLUMN payroll_rubriques.account_code IS
  'Retenue : compte crédité à la comptabilisation de la paie (NULL = 3431, personnel - avances et acomptes).';

-- ─── 2. Motif d'annulation depuis la Paie ─────────────────────────────
INSERT INTO ref_entries (table_id, code, label, display_order, metadata)
SELECT 'purchase_reason_codes', 'payroll_cancel', 'Annulation depuis le module Paie', 90,
       '{"scope": ["void_payment"]}'::jsonb
 WHERE EXISTS (SELECT 1 FROM ref_tables WHERE id = 'purchase_reason_codes')
ON CONFLICT (table_id, code) DO NOTHING;

-- ─── 3. Catégories de règlement ───────────────────────────────────────
INSERT INTO expense_categories (id, name, type, parent_id, level, display_order, is_active, account_id)
SELECT v.id::uuid, v.name, 'expense', '10000000-0000-0000-0000-000000000004'::uuid, 2, v.ord, true, a.id
  FROM (VALUES
    ('40000000-0000-0000-0000-000000000001', 'Règlement CNSS / AMO', '4441', 91),
    ('40000000-0000-0000-0000-000000000002', 'Versement IR sur salaires', '44525', 92),
    ('40000000-0000-0000-0000-000000000003', 'Règlement CIMR', '4443', 93)
  ) AS v(id, name, code, ord)
  JOIN accounts a ON a.code = v.code
 WHERE EXISTS (SELECT 1 FROM expense_categories WHERE id = '10000000-0000-0000-0000-000000000004')
ON CONFLICT (id) DO NOTHING;

-- ─── 4. Déclarations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_declarations (
  kind          VARCHAR(10) NOT NULL CHECK (kind IN ('cnss', 'ir', 'cimr')),
  year          SMALLINT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month         SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  -- Montant figé au moment de la déclaration (mois clôturé).
  amount        DECIMAL(12,2) NOT NULL CHECK (amount >= 0),
  status        VARCHAR(10) NOT NULL DEFAULT 'declared' CHECK (status IN ('declared', 'paid')),
  reference     VARCHAR(60),
  declared_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  declared_by   UUID REFERENCES users(id),
  payment_id    UUID REFERENCES payments(id),
  paid_at       DATE,
  paid_by       UUID REFERENCES users(id),
  PRIMARY KEY (kind, year, month),
  CONSTRAINT payroll_declarations_paid CHECK (status <> 'paid' OR (payment_id IS NOT NULL AND paid_at IS NOT NULL))
);

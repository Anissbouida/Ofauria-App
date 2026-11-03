-- ═══════════════════════════════════════════════════════════════════════
-- 437 — Consolidation multi-établissements (lot Bonus 17)
--
--   Compte de liaison des établissements (CGNC, rubrique 18) : les flux entre
--   magasins d'une même société (trésorerie, stocks) passent par 1811, débité
--   chez l'établissement qui cède et crédité chez celui qui reçoit ; il se
--   solde dans l'ensemble et s'élimine à la consolidation. Les transferts sont
--   deux écritures OD (une par établissement) repérées par
--   source_detail = 'liaison:<identifiant du transfert>'.
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side) VALUES
  ('1811', 'Comptes de liaison des établissements', 1, '18', '181', 'liability', 'C')
ON CONFLICT (code) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_journal_entries_liaison ON journal_entries (source_detail)
  WHERE source_detail LIKE 'liaison:%';

-- 627 — Inventaire : variation de stock comptabilisée (scénario 2, constat 133).
--
-- POURQUOI
--   Les achats de matières sont passés en charge à la réception (61121) : c'est la méthode
--   de l'inventaire intermittent. Le stock n'entre en comptabilité que par l'inventaire,
--   via la variation de stock. Or la validation d'un inventaire ne passait aucune écriture :
--   le compte 3121 restait au solde saisi à la main, les écarts d'inventaire et la
--   consommation réelle de la période n'apparaissaient pas en comptabilité.
--
-- CE QUI CHANGE
--   - Compte 6124 « Variation des stocks de matières et fournitures » (CGNC) dans le plan.
--   - Source d'écriture 'stock_count' autorisée sur journal_entries (une écriture par
--     inventaire complet validé : 3121 contre 6124, du montant de l'écart entre la valeur
--     comptée et le solde du 3121).
--
-- INVERSION
--   Supprimer les écritures source_kind = 'stock_count', remettre la contrainte sans
--   'stock_count', puis DELETE FROM accounts WHERE code = '6124' (s'il n'est plus mouvementé).

INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side, is_collective, is_active)
SELECT '6124', 'Variation des stocks de matieres et fournitures', 6, '61', '612', 'expense', 'D', false, true
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code = '6124');

ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_kind_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_kind_check CHECK (source_kind::text = ANY (ARRAY[
  'manual', 'invoice', 'credit_note', 'payment', 'payment_void', 'sale', 'reversal', 'backfill', 'shift_entry',
  'product_loss', 'closure_diff', 'advance_repayment', 'goods_receipt', 'goods_receipt_return', 'price_variance',
  'landed_cost', 'period_accrual', 'accrual_reversal', 'grir_write_off', 'vat_reclass', 'depreciation',
  'asset_acquisition', 'withholding_remittance', 'loyalty', 'opening', 'stock_count'
]::text[]));

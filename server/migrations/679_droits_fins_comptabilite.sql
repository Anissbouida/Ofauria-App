-- ═══════════════════════════════════════════════════════════════════════
-- 679 — Plan d'action compta, étape 19 (audit C-09) : droits fins à la place des droits fourre-tout
--
--   `accounting.delete` protégeait dix actions sans rapport (facture, paiement, compte du plan,
--   brouillon d'écriture, délettrage, modèle, famille de produits…) et `accounting.cancel` cinq
--   autres : qui pouvait supprimer un brouillon pouvait aussi supprimer un compte du plan.
--   Chaque action a maintenant sa clé (shared PERMISSIONS, PERMISSION_ROUTES).
--
--   AUCUN accès ne change à la migration : chaque rôle qui détient l'ancienne clé reçoit les
--   nouvelles clés correspondantes, et les exceptions par utilisateur (accordées ou retirées)
--   sont recopiées. Les nouvelles clés ne sont marquées « amorcées » que si l'ancienne l'était :
--   sur une installation neuve, l'amorçage du serveur les donne selon les rôles par défaut.
--   Ensuite le retrait d'un droit précis se règle depuis Utilisateurs › Rôles.
--
-- Rollback : supprimer les nouvelles clés ci-dessous de role_action_permissions,
--   user_action_permissions et permission_seeded_keys ; remettre can('accounting.delete' |
--   'accounting.cancel') dans les routes.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TEMP TABLE _perm_split (old_key text, new_key text) ON COMMIT DROP;
INSERT INTO _perm_split VALUES
  ('accounting.delete', 'accounting.invoices.delete'),
  ('accounting.delete', 'accounting.invoices.attachment_delete'),
  ('accounting.delete', 'accounting.payments.delete'),
  ('accounting.cancel', 'accounting.invoices.cancel'),
  ('accounting.delete', 'accounting.accounts.delete'),
  ('accounting.delete', 'accounting.corporate_tax.adjustment_delete'),
  ('accounting.cancel', 'accounting.corporate_tax.payment_cancel'),
  ('accounting.cancel', 'accounting.bills.remittance_cancel'),
  ('accounting.cancel', 'accounting.consolidation.transfer_cancel'),
  ('accounting.cancel', 'accounting.fx_revaluation.cancel'),
  ('accounting.delete', 'accounting.revenue_families.delete'),
  ('accounting.delete', 'accounting.entries.draft_delete'),
  ('accounting.delete', 'accounting.lettrage.undo'),
  ('accounting.delete', 'accounting.entry_templates.delete'),
  ('accounting.delete', 'accounting.cash_forecast.line_delete');

INSERT INTO role_action_permissions (role_code, permission_key)
SELECT r.role_code, s.new_key
  FROM role_action_permissions r JOIN _perm_split s ON s.old_key = r.permission_key
ON CONFLICT DO NOTHING;

INSERT INTO user_action_permissions (user_id, permission_key, granted, reason, updated_by)
SELECT u.user_id, s.new_key, u.granted, u.reason, u.updated_by
  FROM user_action_permissions u JOIN _perm_split s ON s.old_key = u.permission_key
ON CONFLICT DO NOTHING;

INSERT INTO permission_seeded_keys (permission_key)
SELECT s.new_key FROM _perm_split s
 WHERE EXISTS (SELECT 1 FROM permission_seeded_keys k WHERE k.permission_key = s.old_key)
ON CONFLICT DO NOTHING;

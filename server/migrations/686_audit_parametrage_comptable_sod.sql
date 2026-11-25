-- ═══════════════════════════════════════════════════════════════════════
-- 686 — Plan d'action compta, étape 23 (audit C-09) : audit du paramétrage comptable, SoD par défaut
--
--   1. Le journal d'audit du paramétrage (config_audit_log, mig 328) ne couvrait pas les tables qui
--      décident des comptes et des paiements : journaux, profils de comptabilisation, règles de
--      rapprochement bancaire, comptes de trésorerie, catégories de charge (lien catégorie → compte).
--      Un changement de compte de produit ou de compte de banque ne laissait aucune trace.
--      Trigger log_config_change posé sur ces cinq tables (ancien et nouveau contenu, auteur, date).
--
--   2. Séparation des tâches par document (mig 442) : mode « warn » par défaut = elle journalise sans
--      bloquer. Pour une INSTALLATION NEUVE (aucune facture, aucun paiement, aucun bon de commande),
--      le mode devient « block_except_admin » : les rôles opérationnels ne peuvent plus enchaîner
--      commande, réception, validation de facture et paiement, l'administrateur passe outre en
--      laissant une trace. Une installation qui travaille déjà garde son réglage (changement de
--      comportement décidé par son responsable, depuis Réglages des achats), avec un avertissement
--      dans le bilan de santé de la configuration.
--
-- Rollback : supprimer le trigger <table>_config_audit des cinq tables ; remettre
--   purchasing.sod_mode à {"mode":"warn"}.
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('journals',            'id'),
    ('posting_profiles',    'id'),
    ('bank_rules',          'id'),
    ('treasury_accounts',   'id'),
    ('expense_categories',  'id')
  ) AS t(tbl, keycol)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', r.tbl || '_config_audit', r.tbl);
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION log_config_change(%L, %L)',
        r.tbl || '_config_audit', r.tbl, r.keycol, '');
    END IF;
  END LOOP;
END $$;

UPDATE module_parameters
   SET value = '{"mode": "block_except_admin"}'::jsonb
 WHERE key = 'purchasing.sod_mode'
   AND value->>'mode' = 'warn'
   AND NOT EXISTS (SELECT 1 FROM invoices)
   AND NOT EXISTS (SELECT 1 FROM payments)
   AND NOT EXISTS (SELECT 1 FROM purchase_orders);

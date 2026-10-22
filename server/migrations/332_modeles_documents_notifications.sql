-- ═══════════════════════════════════════════════════════════════════════
-- 332 — Modèles de documents et règles de notification (audit Paramètres, lot 6)
--
--   document_templates : mentions des pièces envoyées aux tiers (facture
--     client, bon de commande) : conditions de paiement, mention des
--     pénalités de retard (loi 69-21), note de pied de page, affichage du
--     compte bancaire et de la forme juridique. Le pied de page légal
--     (raison sociale, forme, capital, siège, RC, IF, ICE, patente) est
--     commun et tiré de la fiche société (mig 326 / 331).
--
--   notification_rules : par type d'événement, notification active ou non
--     et rôles à prévenir en plus du destinataire prévu par le code.
--     Appliquées par trigger sur notifications : tous les chemins qui créent
--     des notifications les respectent, sans modification du code appelant.
--     Un type absent de la table reste actif (comportement d'origine).
--
-- INVERSION
--   DROP TRIGGER notifications_rules_before, notifications_rules_after ON notifications ;
--   DROP FUNCTION trg_notification_rules_before(), trg_notification_rules_after() ;
--   DROP TABLE notification_rules, document_templates.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS document_templates (
  doc_type         VARCHAR(30) PRIMARY KEY,
  label            VARCHAR(80) NOT NULL,
  payment_terms    TEXT,
  late_penalty     TEXT,
  footer_note      TEXT,
  show_bank        BOOLEAN NOT NULL DEFAULT true,
  show_legal_form  BOOLEAN NOT NULL DEFAULT true,
  display_order    SMALLINT NOT NULL DEFAULT 0,
  updated_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (char_length(COALESCE(payment_terms, '')) <= 500),
  CHECK (char_length(COALESCE(late_penalty, '')) <= 500),
  CHECK (char_length(COALESCE(footer_note, '')) <= 300)
);
COMMENT ON TABLE document_templates IS 'Mentions des pièces envoyées aux tiers (mig 332) ; pied de page légal tiré de la fiche société.';

INSERT INTO document_templates (doc_type, label, payment_terms, late_penalty, footer_note, show_bank, display_order) VALUES
  ('invoice', 'Facture client',
   'Paiement à réception de facture.',
   'Tout retard de paiement donne lieu de plein droit aux pénalités prévues par la loi n° 69-21 (article 78-3 du Code de commerce).',
   NULL, true, 10),
  ('purchase_order', 'Bon de commande fournisseur',
   'Livraison accompagnée du bon de livraison et de la facture rappelant le numéro de ce bon de commande.',
   NULL, NULL, false, 20)
ON CONFLICT (doc_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS notification_rules (
  type          VARCHAR(60) PRIMARY KEY,
  label         VARCHAR(120) NOT NULL,
  domain        VARCHAR(30) NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  extra_roles   VARCHAR(30)[] NOT NULL DEFAULT '{}',
  updated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE notification_rules IS 'Règles de notification par type d''événement (mig 332), appliquées par trigger sur notifications.';

INSERT INTO notification_rules (type, label, domain) VALUES
  ('production_plan_created',               'Plan de production créé',                       'production'),
  ('production_plan_draft',                 'Plan de production en brouillon',               'production'),
  ('production_plan_confirmed',             'Plan de production confirmé',                   'production'),
  ('production_plan_relaunched',            'Plan de production relancé',                    'production'),
  ('semi_finished_plan_created',            'Plan de semi-finis créé',                       'production'),
  ('production_completed',                  'Production terminée',                           'production'),
  ('production_completed_for_replenishment','Production terminée pour un réapprovisionnement','production'),
  ('production_cancelled',                  'Production annulée',                            'production'),
  ('production_transfer',                   'Transfert de production',                       'production'),
  ('frigo',                                 'Stock frigo',                                   'production'),
  ('bsi_generated',                         'Bon de sortie d''ingrédients généré',           'stock'),
  ('bsi_preparation_started',               'Préparation du bon de sortie commencée',        'stock'),
  ('bsi_ready',                             'Bon de sortie prêt',                            'stock'),
  ('bsi_chef_rejected',                     'Bon de sortie refusé par le chef',              'stock'),
  ('stock_verification_requested',          'Vérification de stock demandée',                'stock'),
  ('replenishment_request',                 'Demande de réapprovisionnement',                'replenishment'),
  ('replenishment_transferred',             'Réapprovisionnement transféré',                 'replenishment'),
  ('replenishment_discrepancy',             'Écart de réapprovisionnement',                  'replenishment'),
  ('order_ready',                           'Commande client prête',                         'sales'),
  ('pipeline_created',                      'Nouveau produit proposé',                       'products'),
  ('pipeline_approved',                     'Nouveau produit approuvé',                      'products'),
  ('pipeline_revision_requested',           'Révision demandée sur un nouveau produit',      'products'),
  ('pipeline_admin_validation',             'Nouveau produit à valider',                     'products'),
  ('pipeline_integrated',                   'Nouveau produit intégré au catalogue',          'products'),
  ('haccp_alert',                           'Alerte HACCP',                                  'quality'),
  ('product_recall',                        'Rappel de produit',                             'quality')
ON CONFLICT (type) DO NOTHING;

-- Avant insertion : un type désactivé n'est pas créé.
CREATE OR REPLACE FUNCTION trg_notification_rules_before()
RETURNS TRIGGER AS $$
DECLARE
  v_enabled BOOLEAN;
BEGIN
  SELECT enabled INTO v_enabled FROM notification_rules WHERE type = NEW.type;
  IF v_enabled IS FALSE THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Après insertion : une copie pour chaque rôle supplémentaire (sans boucle :
-- les copies sont insérées à la profondeur 2 et ignorées ici).
CREATE OR REPLACE FUNCTION trg_notification_rules_after()
RETURNS TRIGGER AS $$
DECLARE
  v_roles VARCHAR(30)[];
  v_role  VARCHAR(30);
BEGIN
  IF pg_trigger_depth() > 1 OR NEW.target_role = 'all' THEN
    RETURN NULL;
  END IF;
  SELECT extra_roles INTO v_roles FROM notification_rules WHERE type = NEW.type;
  IF v_roles IS NULL THEN RETURN NULL; END IF;
  FOREACH v_role IN ARRAY v_roles LOOP
    IF v_role <> NEW.target_role THEN
      INSERT INTO notifications (target_role, store_id, type, title, message, reference_type, reference_id, created_by)
      VALUES (v_role, NEW.store_id, NEW.type, NEW.title, NEW.message, NEW.reference_type, NEW.reference_id, NEW.created_by);
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notifications_rules_before ON notifications;
CREATE TRIGGER notifications_rules_before BEFORE INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION trg_notification_rules_before();
DROP TRIGGER IF EXISTS notifications_rules_after ON notifications;
CREATE TRIGGER notifications_rules_after AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION trg_notification_rules_after();

-- Journal du paramétrage (mig 328).
DO $$
BEGIN
  IF to_regprocedure('log_config_change()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS document_templates_config_audit ON document_templates;
    CREATE TRIGGER document_templates_config_audit AFTER INSERT OR UPDATE OR DELETE ON document_templates
      FOR EACH ROW EXECUTE FUNCTION log_config_change('doc_type', '');
    DROP TRIGGER IF EXISTS notification_rules_config_audit ON notification_rules;
    CREATE TRIGGER notification_rules_config_audit AFTER INSERT OR UPDATE OR DELETE ON notification_rules
      FOR EACH ROW EXECUTE FUNCTION log_config_change('type', '');
  END IF;
END $$;

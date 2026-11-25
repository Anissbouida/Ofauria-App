-- Lot 2 : stockage des nouveaux niveaux, sans basculer les lecteurs historiques.
-- Aucune reprise destructive ni écrasement des paramètres existants.
CREATE TABLE IF NOT EXISTS config_values (
  key varchar(80) NOT NULL,
  scope_type varchar(20) NOT NULL CHECK (scope_type IN ('base','country','sector','specialization','company','legal_entity','store','workshop','order_type','product','user')),
  scope_id text NOT NULL DEFAULT '',
  value jsonb NOT NULL,
  locked boolean NOT NULL DEFAULT false,
  lock_reason text,
  source text NOT NULL DEFAULT 'manual',
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, scope_type, scope_id),
  CHECK ((scope_type IN ('base','company')) = (scope_id = '')),
  CHECK ((NOT locked AND lock_reason IS NULL) OR (locked AND lock_reason IS NOT NULL AND
    ((scope_type IN ('base','country') AND lock_reason IN ('security','regulatory')) OR (scope_type='sector' AND lock_reason='regulatory'))))
);
-- Projection de référence : les deux sources historiques restent les seules sources
-- actives jusqu'à la comparaison de non-régression. Pas de copie à désynchroniser.
CREATE OR REPLACE VIEW config_legacy_values AS
SELECT key, scope_type, scope_id, value, 'policy_values'::text AS source FROM policy_values
UNION ALL
SELECT key, 'company'::varchar(20), ''::text, value, 'module_parameters'::text FROM module_parameters;

DROP TRIGGER IF EXISTS config_values_config_audit ON config_values;
CREATE TRIGGER config_values_config_audit AFTER INSERT OR UPDATE OR DELETE ON config_values
FOR EACH ROW EXECUTE FUNCTION log_config_change('key','scope_type');

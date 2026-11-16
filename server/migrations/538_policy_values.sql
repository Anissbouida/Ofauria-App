-- M1-02 (plan d'action 2026-11) — politiques à héritage.
--
-- Le paramétrage existait à deux niveaux (société, établissement). Une politique de
-- production se règle désormais à cinq : société, établissement, atelier, type d'ordre,
-- article. La valeur effective est la plus précise qui existe (services/policies.ts :
-- article → type d'ordre → atelier → établissement → société → défaut du catalogue).
--
-- Analogie Oracle : c'est la hiérarchie des options de profil d'E-Business Suite
-- (site → application → responsabilité → utilisateur), où la valeur la plus proche gagne.
--
--   key        : clé du paramètre dans le catalogue (services/parameters-catalog.ts)
--   scope_type : niveau de la valeur
--   scope_id   : identifiant du niveau, en texte ('' pour la société ; identifiant de
--                l'établissement ou de l'article ; code de l'atelier ; type d'ordre)
--   value      : valeur JSON, un objet de champs comme module_parameters
--
-- La table est créée VIDE : sans ligne, chaque politique vaut son défaut du catalogue,
-- c'est-à-dire la constante qu'elle remplace. Rien ne change tant que personne ne règle.
--
-- INVERSION : DROP TABLE policy_values;
CREATE TABLE IF NOT EXISTS policy_values (
  key        varchar(80) NOT NULL,
  scope_type varchar(20) NOT NULL,
  scope_id   text        NOT NULL DEFAULT '',
  value      jsonb       NOT NULL,
  updated_by uuid        REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, scope_type, scope_id),
  CONSTRAINT chk_policy_values_scope CHECK (scope_type IN ('company', 'store', 'workshop', 'order_type', 'product')),
  CONSTRAINT chk_policy_values_scope_id CHECK ((scope_type = 'company') = (scope_id = ''))
);

-- Journal du paramétrage (mig 328) : qui a changé quelle politique, à quel niveau.
DROP TRIGGER IF EXISTS policy_values_config_audit ON policy_values;
CREATE TRIGGER policy_values_config_audit
  AFTER INSERT OR UPDATE OR DELETE ON policy_values
  FOR EACH ROW EXECUTE FUNCTION log_config_change('key', 'scope_type');

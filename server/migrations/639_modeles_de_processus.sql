-- 639 — Modèles de processus (plan d'exécution multi-industries, étape 5, pas 5b-5c).
--
-- POURQUOI
--   Le parcours d'un ordre était codé deux fois (production-state.ts et la fonction SQL de
--   la mig 299) : impossible de décrire un autre métier (usinage, assemblage, contrôle)
--   sans toucher au code.
--
-- CE QUI CHANGE
--   - process_models : un modèle par type d'ordre, VERSIONNÉ (brouillon, publié, archivé).
--   - process_stages : étapes ordonnées ; chacune se rattache à un état technique existant
--     (draft…completed : rapports, intégrations et comptabilité n'y voient aucune différence),
--     porte ses gardes et ses actions (codes du catalogue fermé, services/process-catalog.ts),
--     un document, un responsable, un délai, une condition, et un groupe parallèle (deux
--     étapes du même groupe peuvent avancer en même temps).
--   - process_shadow_log : en mode « ombre », écarts entre la décision du moteur et celle de
--     la machine à états (bascule seulement quand le journal est vide sur une période réelle).
--   - Pour chaque type d'ordre existant, un modèle « standard » PUBLIÉ reproduit exactement le
--     parcours actuel (gardes selon ses drapeaux). La machine à états SQL reste en place.

CREATE TABLE IF NOT EXISTS process_models (
  id               SERIAL PRIMARY KEY,
  order_type_code  VARCHAR(40) NOT NULL,
  version_no       INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon', 'publie', 'archive')),
  label            TEXT NOT NULL,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at     TIMESTAMPTZ,
  UNIQUE (order_type_code, version_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_process_models_published ON process_models (order_type_code) WHERE status = 'publie';

CREATE TABLE IF NOT EXISTS process_stages (
  id                SERIAL PRIMARY KEY,
  model_id          INTEGER NOT NULL REFERENCES process_models(id) ON DELETE CASCADE,
  code              VARCHAR(40) NOT NULL,
  label             TEXT NOT NULL,
  sequence          INTEGER NOT NULL,
  tech_status       TEXT NOT NULL CHECK (tech_status IN ('draft', 'confirmed', 'awaiting_ingredients', 'ready_to_produce', 'in_progress', 'completed')),
  guards            TEXT[] NOT NULL DEFAULT '{}',
  actions           TEXT[] NOT NULL DEFAULT '{}',
  document_key      TEXT,
  responsible_role  TEXT,
  delay_minutes     INTEGER,
  condition_key     TEXT,
  parallel_group    TEXT,
  required_fields   TEXT[] NOT NULL DEFAULT '{}',
  allow_resume      BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (model_id, code)
);

CREATE TABLE IF NOT EXISTS process_shadow_log (
  id            BIGSERIAL PRIMARY KEY,
  plan_id       UUID NOT NULL,
  transition    TEXT NOT NULL,
  engine_allows BOOLEAN NOT NULL,
  legacy_allows BOOLEAN NOT NULL,
  engine_reasons TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Modèle « standard » publié pour chaque type d'ordre existant : le parcours actuel.
DO $$
DECLARE t RECORD; mid INT;
BEGIN
  FOR t IN SELECT * FROM production_order_types LOOP
    IF EXISTS (SELECT 1 FROM process_models WHERE order_type_code = t.code) THEN CONTINUE; END IF;
    INSERT INTO process_models (order_type_code, version_no, status, label, published_at)
    VALUES (t.code, 1, 'publie', 'Parcours standard', now()) RETURNING id INTO mid;
    INSERT INTO process_stages (model_id, code, label, sequence, tech_status, guards, actions, document_key) VALUES
      (mid, 'planification', 'Planification', 10, 'draft', '{}', '{}', 'ordre_fabrication'),
      (mid, 'confirmation', 'Confirmation', 20, 'confirmed', '{}',
        CASE WHEN t.requires_bon_sortie THEN ARRAY['generate_bon_sortie', 'notify_workshop'] ELSE ARRAY['notify_workshop'] END, NULL);
    IF t.requires_bon_sortie THEN
      INSERT INTO process_stages (model_id, code, label, sequence, tech_status, guards, actions, document_key) VALUES
        (mid, 'bon_de_sortie', 'Bon de sortie des matières', 30, 'awaiting_ingredients', '{}',
          CASE WHEN t.consumption_mode = 'au_bon_de_sortie' THEN ARRAY['open_to_pesage', 'consume_at_bon_sortie'] ELSE ARRAY['open_to_pesage'] END, 'bon_sortie');
    END IF;
    INSERT INTO process_stages (model_id, code, label, sequence, tech_status, guards, actions, document_key) VALUES
      (mid, 'fabrication', 'Fabrication', 40, 'in_progress',
        ARRAY['semi_finished_ready']
          || CASE WHEN t.requires_bon_sortie THEN ARRAY['bon_sortie_closed'] ELSE '{}'::text[] END
          || CASE WHEN t.requires_weighing THEN ARRAY['all_weighed'] ELSE '{}'::text[] END,
        CASE t.consumption_mode WHEN 'a_la_declaration' THEN ARRAY['consume_at_declaration'] WHEN 'manuel' THEN ARRAY['consume_manual'] ELSE '{}'::text[] END,
        'fiche_suivi'),
      (mid, 'cloture', 'Déclaration et clôture', 50, 'completed', '{}',
        ARRAY['create_product_lot', 'generate_final_inspection', 'compute_cost', 'emit_event'], 'rapport_production'),
      (mid, 'transfert', 'Transfert', 60, 'completed',
        CASE WHEN t.requires_quality_check THEN ARRAY['quality_passed'] ELSE '{}'::text[] END,
        ARRAY['transfer_to_store'], 'bon_transfert');
  END LOOP;
END $$;

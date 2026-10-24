-- ═══════════════════════════════════════════════════════════════════════
-- 315 — Plan de maîtrise sanitaire (HACCP), lot 2
--   Registres exigibles en contrôle ONSSA :
--     - relevés de température des enceintes froides (frigos, cellule, vitrines) ;
--     - plan de nettoyage et sa traçabilité ;
--     - actions correctives (température hors plage, nettoyage non conforme,
--       réception non conforme, autre).
--   Les chefs saisissent ; le gérant valide les actions correctives.
--   Le contrôle à réception existe déjà (reception_quality_checks, mig 056) :
--   on y rattache seulement l'action corrective en cas de non-conformité.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Enceintes surveillées : extension des équipements de production ─────
ALTER TABLE production_equipements
  ADD COLUMN IF NOT EXISTS haccp_monitored  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS temp_min         NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS temp_max         NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS readings_per_day SMALLINT NOT NULL DEFAULT 2
    CHECK (readings_per_day BETWEEN 1 AND 12);

-- Une vitrine réfrigérée n'est ni un four ni un frigo de labo.
ALTER TABLE production_equipements DROP CONSTRAINT IF EXISTS production_equipements_type_check;
ALTER TABLE production_equipements ADD CONSTRAINT production_equipements_type_check
  CHECK (type IN ('four', 'batteur', 'petrin', 'laminoir', 'surgele', 'frigo', 'vitrine', 'autre'));

ALTER TABLE production_equipements DROP CONSTRAINT IF EXISTS chk_equipements_haccp_range;
ALTER TABLE production_equipements ADD CONSTRAINT chk_equipements_haccp_range
  CHECK (NOT haccp_monitored OR (temp_min IS NOT NULL AND temp_max IS NOT NULL AND temp_min < temp_max));

-- Seuils réglementaires usuels pour les enceintes déjà connues.
UPDATE production_equipements SET haccp_monitored = true, temp_min = 0, temp_max = 4
 WHERE type = 'frigo' AND NOT haccp_monitored AND temp_min IS NULL;
UPDATE production_equipements SET haccp_monitored = true, temp_min = -40, temp_max = -18
 WHERE type = 'surgele' AND NOT haccp_monitored AND temp_min IS NULL;

-- ─── Actions correctives ─────────────────────────────────────────────────
-- open      : problème constaté, rien n'a encore été fait
-- done      : action réalisée, en attente de validation du gérant
-- validated : validée par le gérant (clôturée)
CREATE TABLE IF NOT EXISTS haccp_corrective_actions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID REFERENCES stores(id),
  source_kind      VARCHAR(20) NOT NULL CHECK (source_kind IN ('temperature', 'cleaning', 'reception', 'other')),
  source_id        UUID,
  problem          TEXT NOT NULL,
  action_taken     TEXT,
  status           VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'validated')),
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  done_by          UUID REFERENCES users(id),
  done_at          TIMESTAMPTZ,
  validated_by     UUID REFERENCES users(id),
  validated_at     TIMESTAMPTZ,
  validation_note  TEXT,
  CHECK (status = 'open' OR action_taken IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_haccp_actions_status ON haccp_corrective_actions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_haccp_actions_source ON haccp_corrective_actions(source_kind, source_id);

-- ─── Relevés de température ──────────────────────────────────────────────
-- Les seuils sont figés au moment du relevé : changer la plage plus tard ne
-- réécrit pas l'historique du registre.
CREATE TABLE IF NOT EXISTS haccp_temperature_readings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id          UUID NOT NULL REFERENCES production_equipements(id),
  store_id              UUID REFERENCES stores(id),
  value                 NUMERIC(5,1) NOT NULL CHECK (value BETWEEN -60 AND 60),
  temp_min              NUMERIC(5,1) NOT NULL,
  temp_max              NUMERIC(5,1) NOT NULL,
  in_range              BOOLEAN GENERATED ALWAYS AS (value >= temp_min AND value <= temp_max) STORED,
  read_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_by               UUID REFERENCES users(id),
  note                  TEXT,
  corrective_action_id  UUID REFERENCES haccp_corrective_actions(id)
);
CREATE INDEX IF NOT EXISTS idx_haccp_readings_equipment ON haccp_temperature_readings(equipment_id, read_at DESC);
CREATE INDEX IF NOT EXISTS idx_haccp_readings_date ON haccp_temperature_readings(read_at DESC);

-- ─── Plan de nettoyage ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS haccp_cleaning_tasks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID REFERENCES stores(id),
  zone           VARCHAR(100) NOT NULL,
  label          VARCHAR(200) NOT NULL,
  frequency      VARCHAR(10) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  method         TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS haccp_cleaning_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id               UUID NOT NULL REFERENCES haccp_cleaning_tasks(id),
  store_id              UUID REFERENCES stores(id),
  done_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  done_by               UUID REFERENCES users(id),
  conforme              BOOLEAN NOT NULL DEFAULT true,
  note                  TEXT,
  corrective_action_id  UUID REFERENCES haccp_corrective_actions(id)
);
CREATE INDEX IF NOT EXISTS idx_haccp_cleaning_logs_task ON haccp_cleaning_logs(task_id, done_at DESC);

-- Plan de départ d'un labo boulangerie-pâtisserie (modifiable dans l'écran).
INSERT INTO haccp_cleaning_tasks (zone, label, frequency, method, display_order)
SELECT * FROM (VALUES
  ('Laboratoire', 'Plans de travail et tables inox', 'daily', 'Détergent-désinfectant alimentaire, rinçage', 10),
  ('Laboratoire', 'Sols du laboratoire', 'daily', 'Balayage humide puis lavage détergent', 20),
  ('Laboratoire', 'Pétrins, batteurs et laminoir', 'daily', 'Démontage des pièces amovibles, lavage, séchage', 30),
  ('Laboratoire', 'Ustensiles, bacs et plaques', 'daily', 'Plonge ou lave-vaisselle', 40),
  ('Froid', 'Intérieur des frigos de production', 'weekly', 'Vider, laver, désinfecter, contrôler les DLC', 50),
  ('Froid', 'Cellule de surgélation', 'weekly', 'Dégivrage si besoin, nettoyage des grilles', 60),
  ('Cuisson', 'Fours (portes, soles, hottes)', 'weekly', 'Dégraissant adapté, à froid', 70),
  ('Locaux', 'Murs, portes et poignées', 'weekly', 'Détergent-désinfectant', 80),
  ('Locaux', 'Siphons et évacuations', 'monthly', 'Produit dégraissant, rinçage abondant', 90),
  ('Locaux', 'Réserve sèche / économat', 'monthly', 'Vider les étagères, dépoussiérer, contrôler nuisibles', 100)
) AS v(zone, label, frequency, method, display_order)
WHERE NOT EXISTS (SELECT 1 FROM haccp_cleaning_tasks);

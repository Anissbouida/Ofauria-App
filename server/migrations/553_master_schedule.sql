-- G5-05 (plan d'action 2026-11) — plan directeur enregistré.
--
-- master_schedule_entries : quantité à produire décidée par article, par établissement
-- et par semaine (lundi). Saisie dans Production › Plan directeur › Plan par semaine,
-- pré-remplie avec la prévision. Une semaine saisie REMPLACE la prévision de vente dans
-- le calcul des besoins phasé (G5-04), répartie sur ses jours selon le profil de la
-- prévision (à parts égales si la prévision est nulle) ; les commandes fermes restent
-- comptées en plus. Une semaine sans saisie garde la prévision.
--
-- INVERSION : DROP TABLE master_schedule_entries;
CREATE TABLE IF NOT EXISTS master_schedule_entries (
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  week_start  date NOT NULL,
  quantity    numeric(12,3) NOT NULL CHECK (quantity >= 0),
  notes       text,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, product_id, week_start),
  CONSTRAINT chk_mps_monday CHECK (EXTRACT(ISODOW FROM week_start) = 1)
);
CREATE INDEX IF NOT EXISTS idx_mps_week ON master_schedule_entries (store_id, week_start);

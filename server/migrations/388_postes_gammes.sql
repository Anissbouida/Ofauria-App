-- 388 — Postes de travail & gammes de production
--
-- Capacité AUTONOME de calcul du coût de main-d'œuvre standard, à côté du flux de
-- production réel (plans, étapes). Un poste de travail a un coût horaire ; une
-- gamme est une séquence d'opérations (chacune sur un poste, avec une durée), ce
-- qui donne le coût de main-d'œuvre standard de fabrication. (ERPNext « Workstation »
-- + « Routing » + « Operation ».)
--
-- Rollback : DROP TABLE routing_operations, routings, work_centers ;

CREATE TABLE IF NOT EXISTS work_centers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(120) NOT NULL,
  hourly_cost NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (hourly_cost >= 0),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  store_id    UUID REFERENCES stores(id),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS routings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(160) NOT NULL,
  product_id  UUID REFERENCES products(id) ON DELETE SET NULL,
  notes       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  store_id    UUID REFERENCES stores(id),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS routing_operations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  routing_id     UUID NOT NULL REFERENCES routings(id) ON DELETE CASCADE,
  sequence       INTEGER NOT NULL DEFAULT 0,
  operation_name VARCHAR(160) NOT NULL,
  work_center_id UUID REFERENCES work_centers(id) ON DELETE SET NULL,
  duration_min   INTEGER NOT NULL DEFAULT 0 CHECK (duration_min >= 0)
);
CREATE INDEX IF NOT EXISTS idx_routing_operations_routing ON routing_operations (routing_id, sequence);

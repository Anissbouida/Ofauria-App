-- 385 — Non-conformités & actions correctives (CAPA)
--
-- Enregistre un problème qualité (lot refusé, écart de contrôle, réclamation) avec
-- sa gravité, l'action corrective décidée, le responsable, l'échéance et le suivi
-- jusqu'à clôture. Complète les modèles d'inspection (mig 384) : une inspection non
-- conforme peut donner lieu à une non-conformité. (ERPNext « Quality Action ».)
--
-- Rollback : DROP TABLE quality_nonconformities ;

CREATE TABLE IF NOT EXISTS quality_nonconformities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             VARCHAR(200) NOT NULL,
  source            VARCHAR(16) NOT NULL DEFAULT 'other'
                      CHECK (source IN ('inspection', 'reception', 'production', 'complaint', 'other')),
  reference_note    VARCHAR(200),
  description       TEXT,
  severity          VARCHAR(8) NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  corrective_action TEXT,
  responsible_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  due_date          DATE,
  status            VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
  detected_on       DATE NOT NULL DEFAULT CURRENT_DATE,
  detected_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_at         TIMESTAMPTZ,
  store_id          UUID REFERENCES stores(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nonconformities_status ON quality_nonconformities (status, due_date);

-- 383 — Campagnes marketing (CRM)
--
-- Regroupe les opportunités par campagne (salon, mailing, promotion de lancement…)
-- pour mesurer le retour : nombre d'opportunités, gagnées, chiffre gagné, vs budget.
-- Complète les « sources » (ref_entries crm_sources) par un objet daté et budgété.
--
-- Rollback :
--   ALTER TABLE opportunities DROP COLUMN campaign_id ;
--   DROP TABLE crm_campaigns ;

CREATE TABLE IF NOT EXISTS crm_campaigns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(160) NOT NULL,
  start_date  DATE,
  end_date    DATE,
  budget      NUMERIC(12,2) CHECK (budget IS NULL OR budget >= 0),
  status      VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  store_id    UUID REFERENCES stores(id),
  notes       TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES crm_campaigns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_opportunities_campaign ON opportunities (campaign_id);

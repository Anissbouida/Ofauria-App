-- M5-04 — Calendrier des postes de travail.
-- Plages d'ouverture par jour de semaine (ISO 1 = lundi … 7 = dimanche), avec un nombre de
-- ressources (machines ou personnes en parallèle), et jours fermés (poste précis ou tous
-- les postes : work_center_id NULL). La capacité d'un poste un jour donné :
--   jour fermé → 0 ; sinon Σ (fin − début) × ressources des plages du jour ;
--   sans calendrier → capacity_minutes_per_day (mig 398), comportement inchangé.
-- La charge par plan compare la charge à cette capacité (date du plan) et le TRS prend
-- le temps d'ouverture du calendrier comme temps planifié (biais G0-28).

CREATE TABLE IF NOT EXISTS work_center_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_center_id UUID NOT NULL REFERENCES work_centers(id) ON DELETE CASCADE,
  iso_weekday SMALLINT NOT NULL CHECK (iso_weekday BETWEEN 1 AND 7),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  resources INTEGER NOT NULL DEFAULT 1 CHECK (resources > 0),
  CONSTRAINT chk_wcc_range CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_wcc_center ON work_center_calendar (work_center_id, iso_weekday);

CREATE TABLE IF NOT EXISTS work_center_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_center_id UUID REFERENCES work_centers(id) ON DELETE CASCADE,
  closed_on DATE NOT NULL,
  reason VARCHAR(160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wc_closures ON work_center_closures (COALESCE(work_center_id, '00000000-0000-0000-0000-000000000000'::uuid), closed_on);

CREATE OR REPLACE FUNCTION fn_work_center_capacity(p_wc UUID, p_day DATE)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM work_center_calendar c WHERE c.work_center_id = p_wc)
      THEN (SELECT w.capacity_minutes_per_day::numeric FROM work_centers w WHERE w.id = p_wc)
    WHEN EXISTS (SELECT 1 FROM work_center_closures x WHERE x.closed_on = p_day AND (x.work_center_id = p_wc OR x.work_center_id IS NULL))
      THEN 0
    ELSE COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (c.end_time - c.start_time)) / 60 * c.resources)
                     FROM work_center_calendar c
                    WHERE c.work_center_id = p_wc AND c.iso_weekday = EXTRACT(ISODOW FROM p_day)), 0)
  END
$$;
COMMENT ON FUNCTION fn_work_center_capacity(UUID, DATE) IS 'M5-04 : capacité d''un poste un jour (minutes), calendrier sinon capacity_minutes_per_day.';

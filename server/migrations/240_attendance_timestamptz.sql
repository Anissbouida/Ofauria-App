-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 240 — Attendance : colonnes TIMESTAMPTZ pour shift de nuit
--
-- attendance.check_in/check_out (mig 018) sont TIME sur une seule date :
-- impossible de representer un shift 22h -> 06h (duree devient negative).
--
-- Migration ADDITIVE (non-destructive) : ajoute check_in_at/check_out_at
-- TIMESTAMPTZ nullable, calcule automatiquement par un trigger a partir
-- des colonnes TIME existantes et de la timezone Casablanca ('Africa/Casablanca').
-- Le trigger detecte le shift de nuit (check_out < check_in) et horodate
-- check_out_at au lendemain.
--
-- L'application (UI, exports) continue de lire/ecrire les colonnes TIME
-- pour l'affichage utilisateur "heure du jour". Les nouvelles colonnes sont
-- utilisees pour :
--   - Calcul precis de duree (payroll shift de nuit)
--   - Rapports temporels croisant dates
--
-- Migration destructive TIME -> TIMESTAMPTZ possible plus tard une fois
-- les usages TIMESTAMPTZ generalises.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS check_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS check_out_at TIMESTAMPTZ;

-- Fonction utilitaire : combine date DATE + heure TIME en timezone Casablanca
-- puis convertit en timestamptz UTC. Timezone en dur : le business est
-- exclusivement au Maroc, une future multi-tenants demanderait une colonne
-- store.timezone.
CREATE OR REPLACE FUNCTION _attendance_ts(d DATE, t TIME) RETURNS TIMESTAMPTZ AS $$
  SELECT (d + t) AT TIME ZONE 'Africa/Casablanca';
$$ LANGUAGE sql IMMUTABLE;

-- Trigger : maintient check_in_at / check_out_at synchronises.
-- Shift de nuit : si check_out < check_in, on horodate check_out au lendemain.
CREATE OR REPLACE FUNCTION _attendance_sync_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.check_in IS NOT NULL THEN
    NEW.check_in_at := _attendance_ts(NEW.date, NEW.check_in);
  ELSE
    NEW.check_in_at := NULL;
  END IF;

  IF NEW.check_out IS NOT NULL THEN
    IF NEW.check_in IS NOT NULL AND NEW.check_out < NEW.check_in THEN
      -- Shift de nuit : depart le lendemain
      NEW.check_out_at := _attendance_ts(NEW.date + INTERVAL '1 day', NEW.check_out);
    ELSE
      NEW.check_out_at := _attendance_ts(NEW.date, NEW.check_out);
    END IF;
  ELSE
    NEW.check_out_at := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS attendance_sync_at_ins ON attendance;
CREATE TRIGGER attendance_sync_at_ins BEFORE INSERT OR UPDATE OF check_in, check_out, date ON attendance
  FOR EACH ROW EXECUTE FUNCTION _attendance_sync_at();

-- Backfill : alimente les nouvelles colonnes pour les lignes existantes.
UPDATE attendance
   SET check_in_at = CASE WHEN check_in IS NOT NULL THEN _attendance_ts(date, check_in) END,
       check_out_at = CASE
         WHEN check_out IS NOT NULL AND check_in IS NOT NULL AND check_out < check_in
           THEN _attendance_ts(date + INTERVAL '1 day', check_out)
         WHEN check_out IS NOT NULL
           THEN _attendance_ts(date, check_out)
       END
 WHERE check_in IS NOT NULL OR check_out IS NOT NULL;

-- Index pour recherches temporelles (rapports par plage horaire).
CREATE INDEX IF NOT EXISTS idx_attendance_check_in_at ON attendance(check_in_at) WHERE check_in_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_check_out_at ON attendance(check_out_at) WHERE check_out_at IS NOT NULL;

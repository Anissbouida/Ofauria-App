-- Migration 299 : machine à états unique + journal des transitions (lot 2)
--
-- POURQUOI
--   Les statuts du plan et du bon de sortie étaient modifiés par une vingtaine
--   d'UPDATE dispersés, souvent sans garde sur le statut de départ, et aucune
--   transition n'était journalisée : impossible de reconstituer qui a fait quoi
--   (les dates *_at sont écrasées ou remises à zéro par les relances/refus).
--
-- QUOI
--   1. production_plan_events : une ligne par transition (plan ou bon), avec
--      l'acteur (session `app.user_id` posée par le serveur, ou colonne *_by du
--      bon à défaut), le statut de départ, d'arrivée, un motif optionnel.
--   2. fn_production_transition_allowed : LA table des transitions permises.
--      Un trigger BEFORE UPDATE refuse toute transition absente (message préfixé
--      TRANSITION_INVALIDE, remonté en 409 par l'API), quel que soit le chemin
--      de code. Les mises à jour qui ne changent pas le statut ne sont pas
--      concernées.
--   3. Triggers AFTER INSERT / UPDATE OF status qui alimentent le journal.
--
--   Le code TypeScript (services/production-state.ts) porte la même table pour
--   produire des erreurs lisibles avant d'atteindre la base.

CREATE TABLE IF NOT EXISTS production_plan_events (
  id            bigserial PRIMARY KEY,
  plan_id       uuid NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  bon_id        uuid REFERENCES production_bons_sortie(id) ON DELETE SET NULL,
  entity        text NOT NULL CHECK (entity IN ('plan', 'bon')),
  from_status   text,
  to_status     text NOT NULL,
  actor_id      uuid REFERENCES users(id),
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_production_plan_events_plan ON production_plan_events (plan_id, created_at);
CREATE INDEX IF NOT EXISTS idx_production_plan_events_bon  ON production_plan_events (bon_id) WHERE bon_id IS NOT NULL;

-- ─── Table des transitions ───
CREATE OR REPLACE FUNCTION fn_production_transition_allowed(p_entity text, p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_entity, p_from, p_to) IN (
    -- Plan de production. Les retours « arrière » (depuis completed / cancelled /
    -- in_progress vers l'amont) sont ceux de la relance (relaunch) et du retour
    -- en brouillon ; ils sont journalisés avec leur motif.
    ('plan', 'draft',                'confirmed'),
    ('plan', 'draft',                'cancelled'),
    ('plan', 'confirmed',            'awaiting_ingredients'),
    ('plan', 'confirmed',            'in_progress'),
    ('plan', 'confirmed',            'draft'),
    ('plan', 'confirmed',            'cancelled'),
    ('plan', 'awaiting_ingredients', 'ready_to_produce'),
    ('plan', 'awaiting_ingredients', 'in_progress'),
    ('plan', 'awaiting_ingredients', 'confirmed'),
    ('plan', 'awaiting_ingredients', 'draft'),
    ('plan', 'awaiting_ingredients', 'cancelled'),
    ('plan', 'ready_to_produce',     'awaiting_ingredients'),
    ('plan', 'ready_to_produce',     'in_progress'),
    ('plan', 'ready_to_produce',     'confirmed'),
    ('plan', 'ready_to_produce',     'draft'),
    ('plan', 'ready_to_produce',     'cancelled'),
    ('plan', 'in_progress',          'completed'),
    ('plan', 'in_progress',          'cancelled'),
    ('plan', 'in_progress',          'confirmed'),
    ('plan', 'in_progress',          'awaiting_ingredients'),
    ('plan', 'in_progress',          'ready_to_produce'),
    ('plan', 'completed',            'in_progress'),
    ('plan', 'completed',            'confirmed'),
    ('plan', 'completed',            'awaiting_ingredients'),
    ('plan', 'completed',            'ready_to_produce'),
    ('plan', 'cancelled',            'draft'),
    ('plan', 'cancelled',            'confirmed'),
    ('plan', 'cancelled',            'awaiting_ingredients'),
    ('plan', 'cancelled',            'ready_to_produce'),
    ('plan', 'cancelled',            'in_progress'),
    -- Bon de sortie. Pas d'annulation après prélèvement (stock consommé).
    ('bon',  'genere',                'preparation'),
    ('bon',  'genere',                'prelevement'),
    ('bon',  'genere',                'annule'),
    ('bon',  'preparation',           'pret'),
    ('bon',  'preparation',           'preparation_partielle'),
    ('bon',  'preparation',           'annule'),
    ('bon',  'preparation_partielle', 'preparation'),
    ('bon',  'preparation_partielle', 'annule'),
    ('bon',  'pret',                  'prelevement'),
    ('bon',  'pret',                  'preparation'),
    ('bon',  'pret',                  'annule'),
    ('bon',  'prelevement',           'verifie'),
    ('bon',  'verifie',               'cloture')
  );
$$;

-- Acteur courant : posé par le serveur via SET LOCAL app.user_id dans la transaction.
CREATE OR REPLACE FUNCTION fn_production_current_actor()
RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE v text;
BEGIN
  v := current_setting('app.user_id', true);
  IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
  RETURN v::uuid;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION fn_production_current_reason()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.transition_reason', true), '');
$$;

-- ─── Plan : garde + journal ───
CREATE OR REPLACE FUNCTION trg_fn_production_plan_status_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT fn_production_transition_allowed('plan', OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'TRANSITION_INVALIDE: plan % -> % (plan %)', OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION trg_fn_production_plan_status_log()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO production_plan_events (plan_id, entity, from_status, to_status, actor_id, reason)
  VALUES (NEW.id, 'plan', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status,
          COALESCE(fn_production_current_actor(), CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by ELSE NULL END),
          fn_production_current_reason());
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_production_plan_status_guard ON production_plans;
CREATE TRIGGER trg_production_plan_status_guard
  BEFORE UPDATE OF status ON production_plans
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_fn_production_plan_status_guard();

DROP TRIGGER IF EXISTS trg_production_plan_status_log_upd ON production_plans;
CREATE TRIGGER trg_production_plan_status_log_upd
  AFTER UPDATE OF status ON production_plans
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_fn_production_plan_status_log();

DROP TRIGGER IF EXISTS trg_production_plan_status_log_ins ON production_plans;
CREATE TRIGGER trg_production_plan_status_log_ins
  AFTER INSERT ON production_plans
  FOR EACH ROW EXECUTE FUNCTION trg_fn_production_plan_status_log();

-- ─── Bon de sortie : garde + journal ───
CREATE OR REPLACE FUNCTION trg_fn_bon_status_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT fn_production_transition_allowed('bon', OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'TRANSITION_INVALIDE: bon % -> % (bon %)', OLD.status, NEW.status, OLD.numero
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION trg_fn_bon_status_log()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_actor uuid;
BEGIN
  v_actor := fn_production_current_actor();
  IF v_actor IS NULL THEN
    v_actor := CASE NEW.status
      WHEN 'genere'      THEN NEW.generated_by
      WHEN 'preparation' THEN COALESCE(NEW.chef_reject_by, NEW.preparation_by)
      WHEN 'pret'        THEN NEW.ready_by
      WHEN 'prelevement' THEN NEW.prelevement_by
      WHEN 'verifie'     THEN NEW.verified_by
      WHEN 'cloture'     THEN NEW.closed_by
      WHEN 'annule'      THEN NEW.cancelled_by
      ELSE NULL END;
  END IF;
  INSERT INTO production_plan_events (plan_id, bon_id, entity, from_status, to_status, actor_id, reason)
  VALUES (NEW.plan_id, NEW.id, 'bon', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status,
          v_actor,
          COALESCE(fn_production_current_reason(),
                   CASE WHEN NEW.status = 'preparation' AND NEW.chef_reject_reason IS NOT NULL AND TG_OP = 'UPDATE' AND OLD.status = 'pret'
                        THEN 'Refus chef : ' || NEW.chef_reject_reason
                        WHEN NEW.status = 'annule' THEN NEW.cancel_reason END));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bon_status_guard ON production_bons_sortie;
CREATE TRIGGER trg_bon_status_guard
  BEFORE UPDATE OF status ON production_bons_sortie
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_fn_bon_status_guard();

DROP TRIGGER IF EXISTS trg_bon_status_log_upd ON production_bons_sortie;
CREATE TRIGGER trg_bon_status_log_upd
  AFTER UPDATE OF status ON production_bons_sortie
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_fn_bon_status_log();

DROP TRIGGER IF EXISTS trg_bon_status_log_ins ON production_bons_sortie;
CREATE TRIGGER trg_bon_status_log_ins
  AFTER INSERT ON production_bons_sortie
  FOR EACH ROW EXECUTE FUNCTION trg_fn_bon_status_log();

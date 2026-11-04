-- Séparation des tâches (mig 442) : nouveau mode « Bloquer, sauf les administrateurs ».
--
-- Depuis Réglages des achats, le contrôle peut désormais prendre trois valeurs :
--   warn                 journalise sans bloquer (défaut)
--   block                bloque tout le monde
--   block_except_admin   bloque les rôles opérationnels, mais laisse passer un
--                        administrateur (users.role = 'admin') — utile pour une
--                        petite équipe où le gérant enchaîne plusieurs étapes.
--
-- Quand un administrateur passe outre en mode « block_except_admin », l'action
-- n'est PAS bloquée mais reste JOURNALISÉE dans sod_violations (traçabilité /
-- audit), exactement comme en mode « warn ».
--
-- Seule la garde commune change ; les déclencheurs par action (trg_sod_receive,
-- trg_sod_validate_invoice, trg_sod_pay, trg_sod_release_hold) restent identiques.

-- La colonne mode (mig 442) était VARCHAR(10) ; « block_except_admin » fait 18 car.
-- On l'élargit pour pouvoir journaliser ce mode quand un admin passe outre.
ALTER TABLE sod_violations ALTER COLUMN mode TYPE VARCHAR(20);

CREATE OR REPLACE FUNCTION fn_sod_enforce(p_rule text, p_doc_type text, p_doc_id uuid, p_actor uuid, p_msg text)
RETURNS void AS $$
DECLARE v_mode text; v_is_admin boolean;
BEGIN
  IF p_actor IS NULL THEN RETURN; END IF;
  IF NOT COALESCE((SELECT is_active FROM sod_document_rules WHERE code = p_rule), false) THEN RETURN; END IF;
  -- Dérogation tracée pour ce document et cet acteur : on laisse passer.
  IF EXISTS (SELECT 1 FROM sod_overrides o
              WHERE o.rule_code = p_rule AND o.doc_id = p_doc_id AND o.actor_id = p_actor) THEN
    RETURN;
  END IF;
  v_mode := COALESCE((SELECT value->>'mode' FROM module_parameters WHERE key = 'purchasing.sod_mode'), 'warn');
  v_is_admin := EXISTS (SELECT 1 FROM users WHERE id = p_actor AND role = 'admin');
  -- Bloque si « block », ou « block_except_admin » pour un non-administrateur.
  IF v_mode = 'block' OR (v_mode = 'block_except_admin' AND NOT v_is_admin) THEN
    RAISE EXCEPTION 'Séparation des tâches : %', p_msg USING ERRCODE = 'OF403';
  END IF;
  -- Sinon on journalise (warn, ou admin passant outre en block_except_admin).
  INSERT INTO sod_violations (rule_code, doc_type, doc_id, actor_id, mode)
  VALUES (p_rule, p_doc_type, p_doc_id, p_actor, v_mode);
END $$ LANGUAGE plpgsql;

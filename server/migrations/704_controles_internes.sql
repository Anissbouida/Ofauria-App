-- Refonte Utilisateurs, lot 5 : contrôles internes réunis dans un seul écran.
--
-- 1. Séparation des tâches sur les pièces (mig 442, 460) : même choix de mode que pour le cumul
--    de rôles. Le mode « off » (Désactivé) s'ajoute à warn / block / block_except_admin : la garde
--    ne bloque ni ne journalise.
-- 2. Délégation des approbations (approval_delegations) : un motif, comme pour la délégation d'un
--    rôle complet ; l'administrateur peut désormais en créer une pour le compte d'une personne.

CREATE OR REPLACE FUNCTION fn_sod_enforce(p_rule text, p_doc_type text, p_doc_id uuid, p_actor uuid, p_msg text)
RETURNS void AS $$
DECLARE v_mode text; v_is_admin boolean;
BEGIN
  IF p_actor IS NULL THEN RETURN; END IF;
  IF NOT COALESCE((SELECT is_active FROM sod_document_rules WHERE code = p_rule), false) THEN RETURN; END IF;
  v_mode := COALESCE((SELECT value->>'mode' FROM module_parameters WHERE key = 'purchasing.sod_mode'), 'warn');
  -- Désactivé : ni blocage ni journal.
  IF v_mode = 'off' THEN RETURN; END IF;
  -- Dérogation tracée pour ce document et cet acteur : on laisse passer.
  IF EXISTS (SELECT 1 FROM sod_overrides o
              WHERE o.rule_code = p_rule AND o.doc_id = p_doc_id AND o.actor_id = p_actor) THEN
    RETURN;
  END IF;
  v_is_admin := EXISTS (SELECT 1 FROM users WHERE id = p_actor AND role = 'admin');
  -- Bloque si « block », ou « block_except_admin » pour un non-administrateur.
  IF v_mode = 'block' OR (v_mode = 'block_except_admin' AND NOT v_is_admin) THEN
    RAISE EXCEPTION 'Séparation des tâches : %', p_msg USING ERRCODE = 'OF403';
  END IF;
  -- Sinon on journalise (warn, ou admin passant outre en block_except_admin).
  INSERT INTO sod_violations (rule_code, doc_type, doc_id, actor_id, mode)
  VALUES (p_rule, p_doc_type, p_doc_id, p_actor, v_mode);
END $$ LANGUAGE plpgsql;

ALTER TABLE approval_delegations ADD COLUMN IF NOT EXISTS reason text;
COMMENT ON COLUMN approval_delegations.reason IS 'Motif de la délégation (refonte Utilisateurs, lot 5).';

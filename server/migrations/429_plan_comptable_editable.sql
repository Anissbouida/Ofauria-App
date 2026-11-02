-- ═══════════════════════════════════════════════════════════════════════
-- 429 — Plan comptable modifiable depuis l'application (lot Important 11)
-- ═══════════════════════════════════════════════════════════════════════
-- POURQUOI
--   Créer un compte (un sous-compte de charge, une banque) demandait une
--   migration. Le plan devient modifiable à l'écran ; la base garde ce qui
--   rend un compte mouvementé intouchable.
--
-- QUOI
--   1. Garde : un compte qui porte des écritures garde son code, sa classe,
--      sa rubrique, son poste, sa nature, son sens et son caractère collectif ;
--      il ne se supprime pas (il se désactive). Seuls le libellé, la TVA
--      rattachée et l'état actif restent modifiables.
--   2. Journal d'audit de paramétrage (log_config_change, mig 328) posé sur
--      accounts : création, modification, suppression, avec l'auteur.
--
-- INVERSION
--   DROP TRIGGER accounts_guard ON accounts ; DROP FUNCTION trg_account_guard() ;
--   DROP TRIGGER accounts_config_audit ON accounts.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION trg_account_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_used boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM journal_entry_lines WHERE account_id = OLD.id) INTO v_used;
  IF NOT v_used THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Compte % mouvementé : il ne se supprime pas, désactivez-le', OLD.code USING ERRCODE = 'OF409';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code OR NEW.account_class IS DISTINCT FROM OLD.account_class
     OR NEW.rubrique IS DISTINCT FROM OLD.rubrique OR NEW.poste IS DISTINCT FROM OLD.poste
     OR NEW.account_type IS DISTINCT FROM OLD.account_type OR NEW.normal_side IS DISTINCT FROM OLD.normal_side
     OR NEW.is_collective IS DISTINCT FROM OLD.is_collective OR NEW.auxiliary_kind IS DISTINCT FROM OLD.auxiliary_kind THEN
    RAISE EXCEPTION 'Compte % mouvementé : code, classe, nature, sens et caractère collectif sont figés (seuls le libellé, la TVA et l''état changent)', OLD.code
      USING ERRCODE = 'OF409';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS accounts_guard ON accounts;
CREATE TRIGGER accounts_guard BEFORE UPDATE OR DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION trg_account_guard();

DROP TRIGGER IF EXISTS accounts_config_audit ON accounts;
CREATE TRIGGER accounts_config_audit AFTER INSERT OR UPDATE OR DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION log_config_change('code', '');

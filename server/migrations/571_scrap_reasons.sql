-- M6-03 — Référentiel unique des motifs de rebut.
-- Avant : trois référentiels (loss_reasons, material_loss_reasons, production_loss_reasons),
-- trois listes codées en dur (validateur des pertes produit, déclaration en caisse,
-- mouvement de lot) et une contrainte figée sur product_losses.reason.
-- Désormais : ref_entries « scrap_reasons », chaque motif portant ses domaines d'usage
-- (metadata.domains : production, vitrine, matiere, invendu, inventaire) et les anciens
-- codes qu'il remplace (metadata.legacy). Les rapports de pertes lisent son libellé
-- (fn_scrap_reason_label, qui comprend aussi les anciens codes).
-- product_losses.reason est contrôlé par le référentiel (codes actifs ou anciens codes)
-- au lieu d'une liste figée ; les lignes existantes ne sont pas revalidées.
-- Rollback : DROP TRIGGER trg_check_scrap_reason ON product_losses ; recréer
--   product_losses_reason_check CHECK (reason IN ('brule','rate','machine','matiere_defectueuse',
--   'erreur_humaine','chute','casse','qualite_non_conforme','retour_client','perime',
--   'invendu_fin_journee','invendu_vitrine','recycle','autre','dlc_expiree','dlv_expiree',
--   'ecart_inventaire','ecart_ouverture')).

INSERT INTO ref_tables (id, label, description, icon, source, editable, display_order)
VALUES ('scrap_reasons', 'Motifs de rebut', 'Référentiel unique des motifs de perte et de rebut, par domaine d''usage (M6-03).', 'Trash2', 'ref_entries', true, 60)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ref_entries (table_id, code, label, display_order, metadata)
SELECT 'scrap_reasons', v.code, v.label, v.ord, jsonb_build_object('domains', to_jsonb(v.domains), 'legacy', to_jsonb(v.legacy))
  FROM (VALUES
    ('brule',               'Brûlé / trop cuit',          10, ARRAY['production'],                       ARRAY[]::text[]),
    ('rate',                'Raté / loupé',               20, ARRAY['production'],                       ARRAY[]::text[]),
    ('machine',             'Panne machine',              30, ARRAY['production'],                       ARRAY[]::text[]),
    ('matiere_defectueuse', 'Matière défectueuse',        40, ARRAY['production'],                       ARRAY[]::text[]),
    ('erreur_humaine',      'Erreur humaine',             50, ARRAY['production'],                       ARRAY[]::text[]),
    ('chute',               'Chute / tombé',              60, ARRAY['vitrine'],                          ARRAY[]::text[]),
    ('casse',               'Cassé / écrasé / renversé',  70, ARRAY['vitrine','matiere'],                ARRAY['damaged']),
    ('qualite_non_conforme','Qualité non conforme',       80, ARRAY['vitrine','matiere','production'],   ARRAY['quality','qualite','quarantine_failed']),
    ('contamination',       'Contamination',              90, ARRAY['matiere'],                          ARRAY[]::text[]),
    ('fond_contenant',      'Fond de contenant',         100, ARRAY['matiere'],                          ARRAY[]::text[]),
    ('retour_client',       'Retour client',             110, ARRAY['vitrine'],                          ARRAY[]::text[]),
    ('perime',              'Périmé',                    120, ARRAY['vitrine','invendu'],                ARRAY['expired']),
    ('dlc_expiree',         'DLC dépassée',              130, ARRAY['vitrine','matiere','invendu'],      ARRAY['dlc_expired']),
    ('dlv_expiree',         'DLV dépassée',              140, ARRAY['vitrine','invendu'],                ARRAY[]::text[]),
    ('invendu_fin_journee', 'Invendu fin de journée',    150, ARRAY['invendu'],                          ARRAY['unsold']),
    ('invendu_vitrine',     'Invendu vitrine',           160, ARRAY['invendu'],                          ARRAY[]::text[]),
    ('recycle',             'Recyclé',                   170, ARRAY['invendu'],                          ARRAY[]::text[]),
    ('don',                 'Don / gratuité',            180, ARRAY['invendu'],                          ARRAY['donation']),
    ('ecart_inventaire',    'Écart d''inventaire',       190, ARRAY['inventaire'],                       ARRAY[]::text[]),
    ('ecart_ouverture',     'Écart d''ouverture',        200, ARRAY['inventaire'],                       ARRAY[]::text[]),
    ('autre',               'Autre',                     999, ARRAY['production','vitrine','matiere','invendu','inventaire'], ARRAY['other'])
  ) AS v(code, label, ord, domains, legacy)
ON CONFLICT (table_id, code) DO NOTHING;

-- Code canonique d'un motif (le code lui-même, ou le motif qui le liste comme ancien code).
CREATE OR REPLACE FUNCTION fn_scrap_reason_code(p_code TEXT) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT e.code FROM ref_entries e WHERE e.table_id = 'scrap_reasons' AND e.code = p_code),
    (SELECT e.code FROM ref_entries e WHERE e.table_id = 'scrap_reasons' AND e.metadata->'legacy' ? p_code LIMIT 1))
$$;
CREATE OR REPLACE FUNCTION fn_scrap_reason_label(p_code TEXT) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT e.label FROM ref_entries e WHERE e.table_id = 'scrap_reasons' AND e.code = fn_scrap_reason_code(p_code)), p_code)
$$;

CREATE OR REPLACE FUNCTION fn_check_scrap_reason() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reason IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM ref_entries e WHERE e.table_id = 'scrap_reasons' AND e.is_active
          AND (e.code = NEW.reason OR e.metadata->'legacy' ? NEW.reason)) THEN
    RAISE EXCEPTION 'Motif de rebut inconnu : %', NEW.reason USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE product_losses DROP CONSTRAINT IF EXISTS product_losses_reason_check;
DROP TRIGGER IF EXISTS trg_check_scrap_reason ON product_losses;
CREATE TRIGGER trg_check_scrap_reason BEFORE INSERT OR UPDATE OF reason ON product_losses
  FOR EACH ROW EXECUTE FUNCTION fn_check_scrap_reason();

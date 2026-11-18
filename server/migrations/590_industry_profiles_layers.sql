-- ═══════════════════════════════════════════════════════════════════════
-- 590 — Profils d'industrie : postes de charge et emplacements types (C-01)
--
--   Complète les trois profils de référence (mig 586) avec les couches ajoutées au modèle
--   de configuration : postes de charge (repérés par leur nom, ajoutés s'ils manquent) et
--   emplacements types (recréés dans chaque établissement qui n'a pas ce code), selon la
--   matrice 2 ter.5 du plan. Valeurs proposées, à relire avec une personne du métier.
--   Les plans de contrôle ne sont pas exportables : chaque point vise un article, une matière
--   ou une catégorie propres à la société (contrainte chk_qcp_target).
--
-- INVERSION
--   UPDATE sector_packs SET profile = profile - 'work_centers' - 'locations'
--    WHERE code IN ('process', 'discret', 'atelier').
-- ═══════════════════════════════════════════════════════════════════════

UPDATE sector_packs SET profile = profile || $j$
  {"work_centers": [
     {"name": "Pesée", "hourly_cost": 0, "capacity_minutes_per_day": 480},
     {"name": "Fabrication (cuve)", "hourly_cost": 0, "capacity_minutes_per_day": 480},
     {"name": "Conditionnement", "hourly_cost": 0, "capacity_minutes_per_day": 480}],
   "locations": [
     {"code": "MATIERES", "name": "Matières premières", "type": "sec", "temp_min": null, "temp_max": null},
     {"code": "QUARANTAINE", "name": "Quarantaine (lots non libérés)", "type": "sec", "temp_min": null, "temp_max": null},
     {"code": "PRODUITS_FINIS", "name": "Produits finis", "type": "sec", "temp_min": null, "temp_max": null}]}
$j$::jsonb WHERE code = 'process';

UPDATE sector_packs SET profile = profile || $j$
  {"work_centers": [
     {"name": "Débit", "hourly_cost": 0, "capacity_minutes_per_day": 480},
     {"name": "Assemblage", "hourly_cost": 0, "capacity_minutes_per_day": 480},
     {"name": "Finition", "hourly_cost": 0, "capacity_minutes_per_day": 480}],
   "locations": [
     {"code": "MAGASIN_MP", "name": "Magasin matières", "type": "sec", "temp_min": null, "temp_max": null},
     {"code": "ENCOURS", "name": "En-cours de fabrication", "type": "labo", "temp_min": null, "temp_max": null},
     {"code": "EXPEDITION", "name": "Zone d'expédition", "type": "sec", "temp_min": null, "temp_max": null}]}
$j$::jsonb WHERE code = 'discret';

UPDATE sector_packs SET profile = profile || $j$
  {"work_centers": [
     {"name": "Débit", "hourly_cost": 0, "capacity_minutes_per_day": 480},
     {"name": "Soudure", "hourly_cost": 0, "capacity_minutes_per_day": 480},
     {"name": "Pose (chantier)", "hourly_cost": 0, "capacity_minutes_per_day": 480}],
   "locations": [
     {"code": "MAGASIN_MP", "name": "Magasin matières", "type": "sec", "temp_min": null, "temp_max": null},
     {"code": "ATELIER", "name": "Atelier", "type": "labo", "temp_min": null, "temp_max": null},
     {"code": "CHANTIER", "name": "Chantier (en cours de pose)", "type": "sec", "temp_min": null, "temp_max": null}]}
$j$::jsonb WHERE code = 'atelier';

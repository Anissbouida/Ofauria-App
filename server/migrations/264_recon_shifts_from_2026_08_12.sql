-- Migration 263 : bascule Matin/Soir À PARTIR DU 12 AOÛT 2026 (module Contrôle
-- des ventes, ISOLE, TEMPORAIRE).
--
-- POURQUOI
--   La mig 262 a converti tout l'historique en shift unique n° 0 « Journée »
--   (écarts inchangés). Le découpage réel Matin/Soir démarre le 2026-08-12 :
--   les journées >= cette date encore en shift unique passent en Matin (1) +
--   Soir (2). Les journées antérieures gardent leur « Journée » (historique figé).
--
--   Le vendu déjà saisi sur ces journées est un TOTAL JOURNÉE. Le laisser sur
--   le Matin ferait un double comptage au ré-import des reçus horodatés (un
--   produit vendu le soir compterait sur le Matin ET sur le Soir). Il est donc
--   remis à zéro ; appro / reçu / reste / prix sont CONSERVÉS sur le Matin. Le
--   vendu se re-remplit proprement par l'import « Reçus par article » (ventilé
--   Matin/Soir à l'heure du ticket).
--
--   Idempotente : ne touche que les journées >= 12/08 encore en shift unique 0
--   (les journées créées après la 262 ont déjà Matin/Soir et sont ignorées).
--
-- DROP (retour arrière) : refusionner Soir dans Matin, puis
--   UPDATE recon_shifts SET shift_number = 0, label = 'Journée'
--     WHERE recon_day_id IN (<journées converties>) AND shift_number = 1;
--   (le vendu remis à zéro n'est pas restaurable — ré-importer les reçus.)

-- Cible : journées >= 12/08 en shift unique n° 0 (backfill 262). On fige l'ensemble
-- dans une table temporaire AVANT toute modification, pour que les 3 étapes
-- (reset vendu / relabel / ajout Soir) visent exactement les mêmes journées.
CREATE TEMP TABLE _recon_convert_days ON COMMIT DROP AS
SELECT d.id AS day_id, s.id AS shift0_id, s.status
FROM recon_days d
JOIN recon_shifts s ON s.recon_day_id = d.id AND s.shift_number = 0
WHERE d.business_date >= DATE '2026-08-12'
  AND NOT EXISTS (
    SELECT 1 FROM recon_shifts s2
    WHERE s2.recon_day_id = d.id AND s2.shift_number IN (1, 2)
  );

-- 1. Vendu (total journée) remis à zéro sur le shift à convertir. Appro / reçu /
--    reste / prix conservés. Évite le double comptage au ré-import des reçus.
UPDATE recon_lines l
SET vendu_qty = 0, vendu_amount = 0, source_vendu = 'manual', updated_at = NOW()
FROM _recon_convert_days c
WHERE l.recon_shift_id = c.shift0_id
  AND (l.vendu_qty <> 0 OR l.vendu_amount <> 0 OR l.source_vendu = 'loyverse_import');

-- 2. Le shift 0 devient le Matin (les lignes restent attachées via recon_shift_id).
UPDATE recon_shifts s
SET shift_number = 1, label = 'Matin', updated_at = NOW()
FROM _recon_convert_days c
WHERE s.id = c.shift0_id;

-- 3. Création du Soir (vide), même statut que la journée convertie.
INSERT INTO recon_shifts (recon_day_id, shift_number, label, status)
SELECT c.day_id, 2, 'Soir', c.status
FROM _recon_convert_days c
ON CONFLICT (recon_day_id, shift_number) DO NOTHING;

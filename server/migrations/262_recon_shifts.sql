-- Migration 262 : Contrôle des ventes PAR SHIFT (module ISOLE, TEMPORAIRE).
--
-- POURQUOI
--   Le bilan journalier dit COMBIEN il manque, pas DANS QUEL SHIFT. La journée
--   est découpée en shifts chaînés (Matin / Soir) avec un comptage physique à
--   la passation (~14h), aligné sur la passation de caisse existante :
--     ouverture du Matin = reste veille (J-1, catégories à report — mig 259) ;
--     ouverture du Soir  = comptage de passation (reste fin de matin, TOUTES
--       catégories : entre deux shifts du même jour tout reste en vitrine,
--       la règle « catégories à report » ne vaut qu'entre deux jours) ;
--     reste du Soir      = reste soir (alimente J+1, mécanique inchangée).
--
--   Écart d'un shift = Vendu + Reste fin − (Ouverture + Reçu). La somme des
--   écarts des shifts égale l'écart journalier actuel (le comptage de
--   passation s'annule entre les deux) : le total ne bouge pas, le comptage
--   intermédiaire sert uniquement à LOCALISER l'écart.
--
--   report_veille_qty devient le « stock d'ouverture du shift » (rempli par la
--   synchro serveur : report J-1 pour le 1er shift, passation pour le suivant).
--   Les colonnes générées ecart_qty / ecart_value (mig 259) sont inchangées,
--   garde-fou « ligne non touchée → écart 0 » compris.
--
--   HISTORIQUE INTACT : chaque journée existante reçoit un shift unique n° 0
--   « Journée » qui porte ses lignes — aucun écart passé ne bouge.
--
-- DROP (retour arrière) :
--   ALTER TABLE recon_lines DROP CONSTRAINT IF EXISTS recon_lines_shift_product_uniq;
--   -- fusionner d'abord les lignes multi-shifts d'un même jour, puis :
--   ALTER TABLE recon_lines ADD CONSTRAINT recon_lines_recon_day_id_product_key_key
--     UNIQUE (recon_day_id, product_key);
--   ALTER TABLE recon_lines DROP COLUMN IF EXISTS recon_shift_id;
--   DROP TABLE IF EXISTS recon_shifts;

-- 1. Shifts d'une journée (bloc détail entre recon_days et recon_lines)
CREATE TABLE IF NOT EXISTS recon_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recon_day_id UUID NOT NULL REFERENCES recon_days(id) ON DELETE CASCADE,
  shift_number SMALLINT NOT NULL,   -- 0 = journée entière (historique), 1 = Matin, 2 = Soir
  label VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (recon_day_id, shift_number)
);

CREATE INDEX IF NOT EXISTS idx_recon_shifts_day ON recon_shifts(recon_day_id);

-- 2. Backfill : un shift unique « Journée » par journée existante, même statut
--    que le jour. Les journées créées après la migration reçoivent Matin + Soir
--    (côté serveur, openDay).
INSERT INTO recon_shifts (recon_day_id, shift_number, label, status)
SELECT d.id, 0, 'Journée', d.status
FROM recon_days d
WHERE NOT EXISTS (SELECT 1 FROM recon_shifts s WHERE s.recon_day_id = d.id);

-- 3. Rattachement des lignes à leur shift. recon_day_id est conservé sur la
--    ligne (dénormalisation volontaire : agrégats journée et rapport de période
--    restent des requêtes directes).
ALTER TABLE recon_lines ADD COLUMN IF NOT EXISTS recon_shift_id UUID REFERENCES recon_shifts(id) ON DELETE CASCADE;

UPDATE recon_lines l
SET recon_shift_id = s.id
FROM recon_shifts s
WHERE s.recon_day_id = l.recon_day_id
  AND s.shift_number = 0
  AND l.recon_shift_id IS NULL;

ALTER TABLE recon_lines ALTER COLUMN recon_shift_id SET NOT NULL;

-- 4. Unicité produit PAR SHIFT (remplace l'unicité par jour)
ALTER TABLE recon_lines DROP CONSTRAINT IF EXISTS recon_lines_recon_day_id_product_key_key;
ALTER TABLE recon_lines DROP CONSTRAINT IF EXISTS recon_lines_shift_product_uniq;
ALTER TABLE recon_lines ADD CONSTRAINT recon_lines_shift_product_uniq UNIQUE (recon_shift_id, product_key);

CREATE INDEX IF NOT EXISTS idx_recon_lines_shift ON recon_lines(recon_shift_id);

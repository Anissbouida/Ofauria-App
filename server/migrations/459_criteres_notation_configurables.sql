-- Migration 459 : critères de notation CONFIGURABLES (demande de prix)
--
-- POURQUOI
--   La notation (mig 458) avait 3 critères FIXES (prix/qualité/fournisseur) avec
--   poids réglables. Le client veut pouvoir AJOUTER ou RETIRER des critères
--   (ex. ajouter « Référence », ou retirer « Prix »). On passe d'un paramètre à
--   poids fixes (purchasing.rfq_scoring, supprimé côté catalogue) à une vraie
--   liste de critères éditable.
--
-- MODÈLE
--   rfq_scoring_criteria : la liste (globale) des critères de notation.
--     - code   : identifiant stable (sert de clé des notes manuelles) ;
--     - type   : 'price' (le moins cher = 100) · 'supplier' (dernière note
--                d'évaluation, mig 362) · 'delivery' (le plus rapide = 100) —
--                CALCULÉS ; 'manual' (note saisie par l'acheteur sur chaque devis) ;
--     - weight : poids relatif ; active : pris en compte ou non.
--   supplier_quotations.criteria_scores : JSONB { <code critère manuel>: note 0-100 }.
--   Le score d'un devis = moyenne pondérée des critères ACTIFS (rfq.repository).
--
-- INVERSION
--   DROP TABLE rfq_scoring_criteria ;
--   ALTER TABLE supplier_quotations DROP COLUMN criteria_scores.
--   (quality_score reste, legacy mig 458.)

CREATE TABLE IF NOT EXISTS rfq_scoring_criteria (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       VARCHAR(40) NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{0,39}$'),
  label      VARCHAR(80) NOT NULL,
  type       VARCHAR(10) NOT NULL CHECK (type IN ('price', 'supplier', 'delivery', 'manual')),
  weight     INTEGER NOT NULL DEFAULT 1 CHECK (weight >= 0 AND weight <= 100),
  position   INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE rfq_scoring_criteria IS
  'Critères configurables de notation des devis (mig 459). type price/supplier/delivery = calculés ; manual = note saisie par devis (supplier_quotations.criteria_scores, clé = code).';

-- Les 3 critères d'origine (mig 458) comme point de départ ; tout est éditable ensuite.
INSERT INTO rfq_scoring_criteria (code, label, type, weight, position) VALUES
  ('price',    'Prix',        'price',    50, 10),
  ('quality',  'Qualité',     'manual',   25, 20),
  ('supplier', 'Fournisseur', 'supplier', 25, 30)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE supplier_quotations
  ADD COLUMN IF NOT EXISTS criteria_scores JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN supplier_quotations.criteria_scores IS
  'Notes des critères MANUELS (mig 459) : { code_critère: note 0-100 }. Les critères calculés (prix/fournisseur/délai) ne sont pas stockés ici.';

-- Reprise de la note qualité (mig 458) dans le critère manuel « quality ».
UPDATE supplier_quotations
   SET criteria_scores = criteria_scores || jsonb_build_object('quality', quality_score)
 WHERE quality_score IS NOT NULL
   AND NOT (criteria_scores ? 'quality');

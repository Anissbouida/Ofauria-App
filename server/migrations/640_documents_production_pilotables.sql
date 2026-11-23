-- 640 — Documents de production pilotables (plan d'exécution multi-industries, étape 6).
--
-- POURQUOI
--   Les documents de production étaient tous imprimables, sans réglage : une société ne
--   pouvait ni retirer un document inutile pour son métier, ni le rendre obligatoire, ni
--   le soumettre à approbation. (E7 de l'analyse.)
--
-- CE QUI CHANGE
--   - production_documents : registre des douze documents de production (activé,
--     obligatoire, génération automatique ou manuelle, étape du parcours, type
--     d'approbation, série de numéros, gabarit d'impression). Tout est activé, rien n'est
--     obligatoire : comportement actuel. Désactiver un document ne retire QUE le document,
--     jamais l'enregistrement dont il dépend (pesée, déclaration, transfert).
--   - quality_nonconformities.nc_number : numéro « NC-AAAA-00001 » posé à la création par
--     la série de numéros (document_sequences), reprise des fiches existantes dans l'ordre.
--
-- RETOUR ARRIÈRE
--   DROP TABLE production_documents ; DROP TRIGGER trg_nc_number ON quality_nonconformities ;
--   ALTER TABLE quality_nonconformities DROP COLUMN nc_number ;
--   DELETE FROM document_sequences WHERE doc_type = 'nonconformity'.

CREATE TABLE IF NOT EXISTS production_documents (
  doc_key            VARCHAR(40) PRIMARY KEY,
  label              TEXT NOT NULL,
  description        TEXT,
  enabled            BOOLEAN NOT NULL DEFAULT true,
  mandatory          BOOLEAN NOT NULL DEFAULT false,
  generation         TEXT NOT NULL DEFAULT 'manuel' CHECK (generation IN ('auto', 'manuel')),
  stage_code         VARCHAR(40),
  approval_doc_type  VARCHAR(40),
  sequence_doc_type  VARCHAR(40),
  template_doc_type  VARCHAR(40),
  -- Enregistrement dont le document est la trace : il existe que le document soit actif ou non.
  record_label       TEXT,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  updated_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT (mandatory AND NOT enabled))
);

INSERT INTO production_documents (doc_key, label, description, generation, stage_code, approval_doc_type, sequence_doc_type, template_doc_type, record_label, sort_order) VALUES
  ('ordre_fabrication',   'Ordre de fabrication',         'Ticket d''ordre par article, remis à l''atelier.',            'manuel', 'planification', 'production_order',  'production_order',     'production_ticket',     'Ordre de fabrication', 10),
  ('bon_sortie',          'Bon de sortie',                'Matières à sortir du stock, lots proposés par date limite.',  'auto',   'bon_de_sortie', NULL,                'bon_sortie',           'production_bon_sortie', 'Bon de sortie',        20),
  ('fiche_pesage',        'Fiche de pesage',              'Relevé des pesées ligne par ligne.',                          'manuel', 'bon_de_sortie', NULL,                NULL,                   NULL,                    'Pesées',               30),
  ('fiche_suivi',         'Fiche de suivi de fabrication','Fiche de l''ordre : articles, quantités, lots, étapes.',      'manuel', 'fabrication',   'production_start',  NULL,                   'production_fiche',      'Ordre en cours',       40),
  ('fiche_controle',      'Fiche de contrôle',            'Contrôles qualité de l''ordre et leurs relevés.',             'manuel', 'transfert',     NULL,                NULL,                   NULL,                    'Contrôles qualité',    50),
  ('bon_transfert',       'Bon de transfert',             'Produits envoyés de l''atelier vers la boutique.',            'auto',   'transfert',     NULL,                'product_transfer',     NULL,                    'Transfert',            60),
  ('bon_entree_stock',    'Bon d''entrée en stock',       'Entrée des produits finis en stock à la déclaration.',        'manuel', 'cloture',       'lot_release',       NULL,                   NULL,                    'Lot de produit fini',  70),
  ('rapport_production',  'Rapport de production',        'Déclaration : quantités produites, coût réel.',               'manuel', 'cloture',       'production_closure',NULL,                   NULL,                    'Déclaration',          80),
  ('rapport_rendement',   'Rapport de rendement',         'Rendement réel comparé à l''objectif.',                       'manuel', 'cloture',       NULL,                NULL,                   NULL,                    'Déclaration',          90),
  ('rapport_pertes',      'Rapport de pertes',            'Pertes déclarées sur l''ordre, valorisées.',                  'manuel', 'cloture',       NULL,                NULL,                   NULL,                    'Pertes',               100),
  ('fiche_non_conformite','Fiche de non-conformité',      'Écart constaté, cause, décision sur le lot, actions.',        'manuel', NULL,            'nonconformity',     'nonconformity',        NULL,                    'Non-conformité',       110),
  ('bon_envoi_soustraitance','Bon d''envoi en sous-traitance','Matières et quantités confiées au sous-traitant.',         'manuel', 'fabrication',   NULL,                'subcontract_shipment', NULL,                    'Envoi en sous-traitance', 120)
ON CONFLICT (doc_key) DO NOTHING;

-- Série de numéros des non-conformités.
INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column, gapless, display_order)
VALUES ('nonconformity', 'Fiche de non-conformité', 'quality', 'NC-{YYYY}-{SEQ}', 5, 'year', 'quality_nonconformities', 'nc_number', false, 96)
ON CONFLICT (doc_type) DO NOTHING;

ALTER TABLE quality_nonconformities ADD COLUMN IF NOT EXISTS nc_number VARCHAR(40);

-- Reprise : les fiches existantes sont numérotées par année de détection, dans l'ordre de création.
WITH numbered AS (
  SELECT id, to_char(detected_on, 'YYYY') AS y,
         row_number() OVER (PARTITION BY to_char(detected_on, 'YYYY') ORDER BY created_at, id) AS n
    FROM quality_nonconformities WHERE nc_number IS NULL
)
UPDATE quality_nonconformities q SET nc_number = 'NC-' || numbered.y || '-' || lpad(numbered.n::text, 5, '0')
  FROM numbered WHERE numbered.id = q.id;

-- Le compteur repart après le plus grand numéro repris (même mécanique que la mig 546).
INSERT INTO document_sequence_counters (doc_type, period_key, last_value)
SELECT 'nonconformity', split_part(nc_number, '-', 2), MAX(split_part(nc_number, '-', 3)::bigint)
  FROM quality_nonconformities WHERE nc_number ~ '^NC-[0-9]{4}-[0-9]+$' GROUP BY 2
ON CONFLICT (doc_type, period_key) DO UPDATE SET last_value = GREATEST(document_sequence_counters.last_value, EXCLUDED.last_value);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quality_nonconformities_nc_number ON quality_nonconformities (nc_number);

CREATE OR REPLACE FUNCTION trg_fn_nc_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.nc_number IS NULL THEN
    NEW.nc_number := next_document_number('nonconformity', NEW.detected_on);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_nc_number ON quality_nonconformities;
CREATE TRIGGER trg_nc_number BEFORE INSERT ON quality_nonconformities FOR EACH ROW EXECUTE FUNCTION trg_fn_nc_number();

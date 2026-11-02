-- Liasse fiscale et télédéclarations EDI (feuille de route compta, lot Bonus 14).
--
-- La liasse (bilan, CPC, ESG) et les fichiers EDI (relevé des déductions de
-- TVA, état 9421) se calculent depuis les écritures et la paie : seule manque
-- l'adresse fiscale codifiée de l'en-tête 9421 — le code commune du
-- référentiel DGI (format NNN.NN.NN, annexe 2 du cahier des charges Simpl-IR).
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS legal_commune_code VARCHAR(12);

ALTER TABLE company_settings DROP CONSTRAINT IF EXISTS company_settings_legal_commune_code_format;
ALTER TABLE company_settings ADD CONSTRAINT company_settings_legal_commune_code_format
  CHECK (legal_commune_code IS NULL OR legal_commune_code ~ '^[0-9]{3}\.[0-9]{2}\.[0-9]{2}$');

COMMENT ON COLUMN company_settings.legal_commune_code IS
  'Code commune DGI du siège (NNN.NN.NN), en-tête de l''état 9421 (Simpl-IR)';

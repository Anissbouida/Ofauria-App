-- G4-03 (plan d'action 2026-11) — prévision de trésorerie.
--
-- La prévision (services/cash-forecast.ts) est calculée à la demande à partir de ce qui
-- existe déjà : soldes de banque et de caisse au grand livre, créances clients, dettes
-- fournisseurs et échéancier, salaires, dettes sociales et fiscales, acomptes d'IS,
-- écritures récurrentes, effets en portefeuille. Deux ajouts :
--
--   cash_forecast_lines : lignes manuelles (emprunt reçu, investissement, apport…) que
--                         rien dans l'application ne connaît encore ;
--   accounting.cash_forecast (module_parameters) : seuil d'alerte du solde prévu.
--
-- INVERSION : DROP TABLE cash_forecast_lines; DELETE FROM module_parameters WHERE key = 'accounting.cash_forecast';
CREATE TABLE IF NOT EXISTS cash_forecast_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_date   date NOT NULL,
  label       varchar(160) NOT NULL,
  -- Signé : positif = encaissement, négatif = décaissement.
  amount      numeric(14,2) NOT NULL CHECK (amount <> 0),
  category    varchar(30) NOT NULL DEFAULT 'autre',
  notes       text,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_cash_forecast_category CHECK (category IN ('emprunt', 'investissement', 'apport', 'subvention', 'autre'))
);
CREATE INDEX IF NOT EXISTS idx_cash_forecast_lines_date ON cash_forecast_lines (flow_date);

INSERT INTO module_parameters (key, value, description)
VALUES ('accounting.cash_forecast', '{"threshold": 0}'::jsonb, 'Prévision de trésorerie : seuil d''alerte du solde prévu (DH)')
ON CONFLICT (key) DO NOTHING;

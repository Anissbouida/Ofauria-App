-- 366 — Relances clients (lot 3 des créances) et blocage de crédit
--
-- Niveaux de relance paramétrables (comme ERPNext « Dunning Type », SAP « niveaux de
-- relance », Sage « scénarios de relance ») : à partir de combien de jours de retard,
-- texte de la lettre, frais, pénalités de retard (loi 69-21), envoi par e-mail, blocage.
--
-- Chaque jour, la tâche planifiée `dunning_run` regarde les créances échues de chaque
-- client (factures émises ouvertes et tickets à crédit, mig 351) et propose une lettre
-- au niveau atteint par le plus ancien retard, si ce niveau n'a pas déjà été envoyé.
-- La lettre part par e-mail (si le niveau le prévoit et que l'envoi automatique est
-- activé), sinon elle attend d'être imprimée ou envoyée depuis l'écran Relances.
-- Une relance dont toutes les pièces sont réglées passe « soldée ».
--
-- Frais et pénalités : mentionnés sur la lettre, ils ne sont pas comptabilisés
-- automatiquement (à facturer si le client les accepte).
--
-- Blocage : un niveau « bloque le client » met customers.credit_hold ; un client bloqué
-- ne peut plus acheter à crédit (ticket à plus tard, commande ou devis converti d'un
-- professionnel). Levée à la main, ou automatiquement quand plus rien n'est échu.
-- Le plafond de crédit peut aussi devenir bloquant (paramètre sales.dunning.credit_control).
--
-- Rollback :
--   DROP TABLE dunning_items, dunnings, dunning_levels ;
--   ALTER TABLE customers DROP COLUMN credit_hold, DROP COLUMN credit_hold_reason, DROP COLUMN credit_hold_at,
--     DROP COLUMN credit_hold_by, DROP COLUMN dunning_paused_until ;
--   DELETE FROM document_sequences WHERE doc_type = 'dunning' ; DELETE FROM scheduled_jobs WHERE key = 'dunning_run' ;
--   DELETE FROM notification_rules WHERE type IN ('dunning_to_send', 'credit_hold') ;
--   DELETE FROM module_parameters WHERE key IN ('sales.dunning', 'sales.quotes').

CREATE TABLE IF NOT EXISTS dunning_levels (
  level             SMALLINT PRIMARY KEY CHECK (level BETWEEN 1 AND 9),
  label             VARCHAR(80) NOT NULL,
  days_after_due    INTEGER NOT NULL CHECK (days_after_due >= 0),
  fee_amount        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  interest_rate     NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (interest_rate BETWEEN 0 AND 100),
  subject           VARCHAR(200) NOT NULL,
  body              TEXT NOT NULL CHECK (char_length(body) <= 4000),
  send_email        BOOLEAN NOT NULL DEFAULT true,
  credit_hold       BOOLEAN NOT NULL DEFAULT false,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  updated_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE dunning_levels IS 'Niveaux de relance (mig 366). Champs du texte : {client} {montant} {pieces} {jours} {frais} {penalites} {total} {societe} {date}.';

INSERT INTO dunning_levels (level, label, days_after_due, fee_amount, interest_rate, subject, body, send_email, credit_hold) VALUES
  (1, 'Rappel amical', 7, 0, 0,
   'Rappel : facture(s) arrivée(s) à échéance',
   E'Bonjour {client},\n\nSauf erreur de notre part, les pièces suivantes, arrivées à échéance, restent à régler pour un montant de {montant} DH :\n\n{pieces}\n\nSi votre règlement est déjà parti, merci de ne pas tenir compte de ce message. Dans le cas contraire, nous vous remercions de bien vouloir procéder au paiement dans les meilleurs délais.\n\nCordialement,\n{societe}',
   true, false),
  (2, 'Relance', 30, 0, 0,
   'Relance : règlement en attente depuis {jours} jours',
   E'Bonjour {client},\n\nMalgré notre premier rappel, nous restons sans règlement des pièces suivantes, pour un montant de {montant} DH :\n\n{pieces}\n\nNous vous prions de régulariser cette situation sous huit jours. Pour toute question sur ces pièces, n''hésitez pas à nous contacter.\n\nCordialement,\n{societe}',
   true, false),
  (3, 'Mise en demeure', 60, 0, 0,
   'Mise en demeure de payer',
   E'{client},\n\nNous constatons que les pièces suivantes restent impayées malgré nos relances, pour un montant de {montant} DH :\n\n{pieces}\n\nFrais de relance : {frais} DH. Pénalités de retard (loi n° 69-21) : {penalites} DH. Total exigible : {total} DH.\n\nNous vous mettons en demeure de régler cette somme sous quinze jours à compter de la présente. À défaut, nous serons contraints d''engager une procédure de recouvrement. Vos achats à crédit sont suspendus jusqu''à régularisation.\n\n{societe}',
   false, true)
ON CONFLICT (level) DO NOTHING;

CREATE TABLE IF NOT EXISTS dunnings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number           VARCHAR(30) NOT NULL UNIQUE,
  customer_id      UUID NOT NULL REFERENCES customers(id),
  level            SMALLINT NOT NULL,
  level_label      VARCHAR(80) NOT NULL,
  dunning_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  status           VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'resolved', 'cancelled')),
  amount_due       NUMERIC(14,2) NOT NULL,
  fee_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  interest_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_days_late    INTEGER NOT NULL,
  subject          VARCHAR(200) NOT NULL,
  body             TEXT NOT NULL,
  sent_at          TIMESTAMPTZ,
  sent_via         VARCHAR(10) CHECK (sent_via IN ('email', 'print', 'phone', 'other')),
  email_to         VARCHAR(255),
  resolved_at      TIMESTAMPTZ,
  note             TEXT,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dunnings_customer ON dunnings (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dunnings_status   ON dunnings (status);
COMMENT ON TABLE dunnings IS 'Lettres de relance (mig 366) ; created_by NULL = proposée par la tâche planifiée.';

CREATE TABLE IF NOT EXISTS dunning_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dunning_id   UUID NOT NULL REFERENCES dunnings(id) ON DELETE CASCADE,
  doc_kind     VARCHAR(10) NOT NULL CHECK (doc_kind IN ('invoice', 'ticket')),
  doc_id       UUID NOT NULL,
  doc_number   VARCHAR(40) NOT NULL,
  doc_date     DATE,
  due_date     DATE NOT NULL,
  days_late    INTEGER NOT NULL,
  remaining    NUMERIC(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dunning_items ON dunning_items (dunning_id);
CREATE INDEX IF NOT EXISTS idx_dunning_items_doc ON dunning_items (doc_kind, doc_id);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_hold BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_hold_reason VARCHAR(300);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_hold_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_hold_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS dunning_paused_until DATE;
COMMENT ON COLUMN customers.credit_hold IS 'Achats à crédit suspendus (relance bloquante ou décision de la direction, mig 366).';
COMMENT ON COLUMN customers.dunning_paused_until IS 'Pas de relance jusqu''à cette date (litige, échéancier accordé, mig 366).';

INSERT INTO document_sequences (doc_type, label, module, pattern, padding, reset_period, target_table, target_column, gapless, display_order)
VALUES ('dunning', 'Lettre de relance client', 'sales', 'REL-{YYYY}-{SEQ}', 4, 'year', 'dunnings', 'number', false, 7)
ON CONFLICT (doc_type) DO NOTHING;

INSERT INTO module_parameters (key, value, description) VALUES
  ('sales.dunning', '{"enabled": true, "auto_send": false, "min_amount": 50, "credit_control": "warn", "auto_release": true}'::jsonb,
   'Relances clients : activation, envoi automatique des e-mails, montant minimal échu, contrôle du plafond (warn | block), déblocage automatique quand plus rien n''est échu.'),
  -- Oubli de la mig 365 : sans ligne, le paramètre n'est pas modifiable dans Paramètres.
  ('sales.quotes', '{"validity_days": 30}'::jsonb, 'Devis clients : durée de validité proposée sur un nouveau devis (jours).')
ON CONFLICT (key) DO NOTHING;

INSERT INTO notification_rules (type, label, domain, email_enabled) VALUES
  ('dunning_to_send', 'Relances clients à envoyer', 'sales', false),
  ('credit_hold',     'Client bloqué (achats à crédit suspendus)', 'sales', true)
ON CONFLICT (type) DO NOTHING;

INSERT INTO scheduled_jobs (key, label, description, domain, interval_minutes, display_order) VALUES
  ('dunning_run', 'Relances clients', 'Propose (ou envoie) les lettres de relance selon les niveaux, solde les relances réglées et débloque les clients à jour.', 'sales', 1440, 46)
ON CONFLICT (key) DO NOTHING;

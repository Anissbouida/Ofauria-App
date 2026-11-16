-- G1-11 (plan d'action 2026-11) — alertes de DLC, tâche planifiée.
--
-- Rien ne prévenait qu'un lot de matière ou de produit fini approchait de sa date limite.
-- La tâche `dlc_alerts` (services/scheduler.ts) notifie chaque jour les lots qui expirent
-- sous N jours, pour chaque seuil du paramètre stock.dlc_alerts (7 et 2 jours à la
-- livraison). Une alerte par lot et par seuil : la table ci-dessous en garde la trace.
--
-- ACTIVÉE : elle ne fait que notifier (et envoyer un e-mail si le paramètre le demande).
--
-- INVERSION : DELETE FROM scheduled_jobs WHERE key = 'dlc_alerts';
--             DELETE FROM module_parameters WHERE key = 'stock.dlc_alerts';
--             DROP TABLE lot_expiry_alerts;
CREATE TABLE IF NOT EXISTS lot_expiry_alerts (
  lot_kind       varchar(12) NOT NULL CHECK (lot_kind IN ('ingredient', 'product')),
  lot_id         uuid        NOT NULL,
  threshold_days smallint    NOT NULL CHECK (threshold_days > 0),
  expires_on     date        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lot_kind, lot_id, threshold_days)
);

INSERT INTO module_parameters (key, value, description) VALUES
  ('stock.dlc_alerts', '{"days":[7,2],"email":false}'::jsonb,
   'Alertes de DLC : seuils en jours avant l''échéance (une alerte par lot et par seuil) et envoi d''un e-mail aux responsables.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO scheduled_jobs (key, label, description, domain, enabled, interval_minutes, display_order) VALUES
  ('dlc_alerts',
   'Alertes de DLC',
   'Notifie les lots de matières et de produits finis qui expirent sous les seuils réglés (une alerte par lot et par seuil).',
   'stock', true, 1440, 31)
ON CONFLICT (key) DO NOTHING;

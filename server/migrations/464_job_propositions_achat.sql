-- L6 (analyse d'écart P2P) — MRP déclencheur : tâche planifiée « propositions d'achat ».
--
-- Enregistre la tâche `purchase_suggestions` (handler dans services/scheduler.ts).
-- Elle calcule le besoin net (ruptures + stock sous le seuil + demandes, DÉDUCTION
-- des BC ouverts faite — réutilise toOrderRepository.board) et crée des DEMANDES
-- D'ACHAT à l'état « proposé » (approval_status = 'draft') qu'un humain revoit puis
-- soumet à l'approbation.
--
-- DÉSACTIVÉE par défaut (enabled = false) : on l'active depuis Paramètres quand on
-- veut l'automatisation. Fréquence proposée : quotidienne (1440 min).
--
-- INVERSION : DELETE FROM scheduled_jobs WHERE key = 'purchase_suggestions';

INSERT INTO scheduled_jobs (key, label, description, domain, enabled, interval_minutes, display_order) VALUES
  ('purchase_suggestions',
   'Propositions d''achat (réappro)',
   'Calcule le besoin net (ruptures, stock sous le seuil, demandes − BC ouverts) et crée des demandes d''achat proposées à revoir.',
   'purchasing', false, 1440, 40)
ON CONFLICT (key) DO NOTHING;

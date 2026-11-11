-- Phase 5.6 — Mentions légales contrôlées à l'émission + numérotation par date.
--
-- 1) Mentions légales : une facture client à un professionnel sans ICE est refusée
--    (loi marocaine). Paramètre éditable dans Paramètres › Ventes. Défaut DÉSACTIVÉ
--    (additif, rien ne change tant qu'un admin ne l'active pas, données à compléter
--    d'abord) ; une fois activé, l'émission exige l'ICE du professionnel.
-- 2) Numérotation selon la date de la facture : l'allocation du numéro émis prend
--    désormais la date de la pièce (jeton {YYYY}), au lieu du jour d'enregistrement.
--    Ces deux points sont en code (accounting.repository) ; seul le paramètre est
--    semé ici pour être visible et modifiable à l'écran.
--
-- Additif : le paramètre est le seul changement de schéma ; aucune facture existante
-- n'est touchée. Les clients professionnels réels ont un ICE, donc pas de régression
-- sur les données saines ; une fiche incomplète se complète (ICE) ou le contrôle se
-- désactive dans les Paramètres.

INSERT INTO module_parameters (key, value, description)
VALUES ('sales.legal_mentions', '{"enforce_customer_ice": false}'::jsonb,
        'Mentions légales des factures émises : refuser une facture à un professionnel sans ICE (phase 5.6).')
ON CONFLICT (key) DO NOTHING;

-- 378 — Tailles « par personne » : stockage en objet { sizes: [...] }.
--
-- La mig 377 stockait sales.person_sizes comme un tableau JSON brut. Le catalogue
-- de paramètres (Paramètres › Paramètres métier) attend un objet { champ: valeur }
-- pour rendre et valider le réglage. On enveloppe la valeur existante.
--
-- Rollback : UPDATE module_parameters SET value = value->'sizes'
--            WHERE key = 'sales.person_sizes' AND jsonb_typeof(value) = 'object' ;

UPDATE module_parameters
   SET value = jsonb_build_object('sizes', value),
       description = 'Entremets par personne : nombres de personnes proposés en caisse (objet { sizes: [...] }, éditable dans Paramètres, mig 377/378).'
 WHERE key = 'sales.person_sizes'
   AND jsonb_typeof(value) = 'array';

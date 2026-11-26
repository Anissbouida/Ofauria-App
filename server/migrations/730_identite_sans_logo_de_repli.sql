-- 730 — Identité neutre : Kalum n'emprunte plus celle d'un client (audit de cohérence des profils, lot L1).
--
-- Kalum est un ERP multisectoriel ; Ofauria (boulangerie) a été le premier client, et ses
-- valeurs servaient de défauts à toute installation : nom « OFAURIA », sous-titre « Boulangerie -
-- Patisserie » (mig 013), secteur « boulangerie » (mig 468), logo Ôfauria imprimé sur les
-- documents faute de logo (retiré du code). Désormais :
--   - défauts de colonne neutres (nom et sous-titre vides, secteur générique) ;
--   - l'identité d'origine encore en place est remise à blanc : l'en-tête affiche « Kalum »
--     jusqu'à ce que l'assistant écrive le nom de la société (la raison sociale saisie devient
--     le nom affiché d'une société sans nom) ;
--   - un logo identique à celui livré avec le code (empreinte du fichier d'origine) est retiré.
-- Le profil Boulangerie reste un profil parmi les autres (vocabulaire, capacités, mig 731).
--
-- Rollback : ALTER TABLE company_settings ALTER COLUMN company_name SET DEFAULT 'OFAURIA',
--   ALTER COLUMN subtitle SET DEFAULT 'Boulangerie - Patisserie', ALTER COLUMN sector_pack SET DEFAULT 'boulangerie'.

ALTER TABLE company_settings ALTER COLUMN company_name SET DEFAULT '';
ALTER TABLE company_settings ALTER COLUMN subtitle SET DEFAULT '';
ALTER TABLE company_settings ALTER COLUMN sector_pack SET DEFAULT 'generique';

UPDATE company_settings SET company_name = '' WHERE upper(btrim(company_name)) = 'OFAURIA';
UPDATE company_settings SET subtitle = '' WHERE subtitle IN ('Boulangerie - Patisserie', 'Boulangerie - Pâtisserie');
UPDATE company_settings SET logo_url = NULL WHERE md5(logo_url) = 'a19081e949087e8e23d4afaba2a8c263';

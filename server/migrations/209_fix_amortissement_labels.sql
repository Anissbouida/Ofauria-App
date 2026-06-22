-- Migration 209 : Realignement des libelles d'amortissement (283x) sur le CGNC
--
-- POURQUOI
--   Les libelles des comptes d'amortissement seedes (migrations 179/186) ne
--   correspondaient pas a la nomenclature officielle du CGNC. Verifie contre le
--   Code General de Normalisation Comptable :
--     2831 = Amortissements des terrains          (et non "non-valeurs")
--     2832 = Amortissements des constructions     (et non "materiel et outillage")
--     2833 = Amort. installations techniques, materiel et outillage
--     2834 = Amortissements du materiel de transport
--     2835 = Amort. du mobilier, materiel de bureau et amenagements divers
--
-- SECURITE
--   0 immobilisation et 0 ecriture ne referencent ces comptes au moment de la
--   correction -> simple mise a jour des libelles, aucun impact sur des donnees.
--
-- INVERSION : remettre les anciens libelles (cf. valeurs ci-dessous).

UPDATE accounts SET label = 'Amortissements des terrains'                                   WHERE code = '2831';
UPDATE accounts SET label = 'Amortissements des constructions'                              WHERE code = '2832';
UPDATE accounts SET label = 'Amortissements des installations techniques, materiel et outillage' WHERE code = '2833';
UPDATE accounts SET label = 'Amortissements du materiel de transport'                       WHERE code = '2834';
UPDATE accounts SET label = 'Amortissements du mobilier, materiel de bureau et amenagements divers' WHERE code = '2835';

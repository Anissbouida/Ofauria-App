-- 630 — Libellé des auxiliaires clients société : raison sociale au lieu d'un libellé vide.
--
-- POURQUOI
--   journal-generator créait l'auxiliaire d'un client avec le libellé « prénom nom » : pour un
--   client société (prénom et nom vides), le libellé était vide et le grand livre auxiliaire
--   n'affichait pas de nom. Depuis la mig 629, fn_ensure_customer_auxiliary retombe sur la
--   raison sociale ; ici on rattrape les auxiliaires déjà créés. Les codes ne changent pas
--   (ils servent de référence, notamment dans le FEC).
--
-- INVERSION
--   Sans objet (libellé d'affichage).

UPDATE account_auxiliaries a
   SET label = TRIM(c.company_name)
  FROM customers c
 WHERE c.id = a.customer_id
   AND TRIM(COALESCE(a.label, '')) = ''
   AND TRIM(COALESCE(c.company_name, '')) <> '';

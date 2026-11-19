# Migrations 519 à 595 — préparation du déploiement (plan pilote, étape 4)

État au 2026-11-18. Ces 77 migrations sont sur `main` et appliquées en dev et sur la base de test ;
**aucune n'est appliquée en production**.

> **Relevé en production le 2026-11-18 (lecture seule)** : dernière migration appliquée = **505**
> (`505_quote_free_lines.sql`). Le déploiement jouera donc **90 migrations, de 506 à 595** — les
> 13 migrations 506 à 518 s'ajoutent à la plage étudiée ici (voir section 2 bis). Sauvegardes faites
> avant toute opération : sauvegarde Cloud SQL à la demande `1795055846731` (« Avant deploiement plan
> pilote ») et copie locale `pg_dump` hors du dépôt.

## 1. Séquence vérifiée

- 77 fichiers, numéros 519 à 595 continus : aucun trou, aucun doublon.
- Rejeu complet sur une base **vierge** (`server/scripts/test-db-setup.sh`, base `kalum_verify`) :
  594 migrations passent ; les 19 sautées sont d'anciennes reprises de fiches (115 à 303) liées aux
  identifiants de la production — **aucune de 519 à 595**.
- Aucune migration de 519 à 595 ne fait `CREATE OR REPLACE` d'une fonction ou d'une vue créée avant
  519 : pas de piège « propriétaire différent » en production (incident du déploiement O2C).
  La fonction redéfinie en 595 (`trg_fn_bom_version_frozen`) est née dans la plage (mig 559).

## 2. Ce qui n'est pas réversible sans sauvegarde

Toutes les migrations sont additives (tables, colonnes, fonctions, déclencheurs) **sauf** les
reprises de données ci-dessous. Une sauvegarde complète de la base juste avant l'application
est donc **obligatoire** : c'est le seul retour arrière sûr pour ces valeurs.

| Mig | Ce qui est modifié | Effet visible |
|---|---|---|
| 537 | `company_settings` : étapes, rendement et coût de revient **activés** (valaient « désactivé » alors que les fonctions servaient) | Les panneaux correspondants restent affichés ; aucun chiffre ne change |
| 546 | Ordres existants rattachés au type « Plan du jour », numéro d'OF attribué ; lignes sans statut → « pending » | Numéros d'OF visibles sur les anciens ordres |
| 564 | Sorties de production dont le produit diffère de celui de la ligne : `principal` → `co_produit` | Répartition du coût des sorties (zéro écart sur la coupe, vérifié) |
| 580 | Secteur boulangerie : option « mode fournée » ajoutée | Rien tant que le secteur n'est pas rechargé |
| 581, 590 | Rôles de composants marqués « boulangerie » ; profils d'industrie complétés (postes, emplacements) | Configuration seulement |

Remplissage de colonnes vides ou neuves, sans écrasement (réversible en retirant la colonne) :
520 (expiration des liens portail), 521, 544, 548, 554, 557 (doubles colonnes quantité + unité),
587, 595 (gamme figée des versions actives).

Faux positifs relevés à l'analyse : les `DELETE` de 555, 556, 570 et 593 sont dans le corps de
fonctions (non exécutés par la migration) ; les `DROP COLUMN` de 527 et 584 retirent une colonne
calculée (`cout_total`) recréée aussitôt ; les `DROP TRIGGER IF EXISTS` recréent le déclencheur.

Migrations sans section `INVERSION` (à documenter si un retour arrière ciblé devient nécessaire) :
519 à 530, 563, 564, 566 à 569, 572 à 574, 576, 592.

## 2 bis. Migrations 506 à 518 (aussi à jouer en production)

Même audit : aucune ne redéfinit une fonction ou une vue antérieure à 506 (pas de piège de
propriétaire). Points à connaître :
- **512** : quantités planifiées, produites, transférées (`production_plan_items`,
  transferts, commandes) passent d'entier à décimal — élargissement sans perte, mais verrou des
  tables pendant l'opération : **appliquer hors des heures d'ouverture**.
- **508** : supprime les réglages de modules identiques au préréglage du secteur (sans effet visible).
- 507, 513, 514 : mises à jour de configuration (activation des modules, référentiels de procédé,
  vocabulaire) ; 509, 511, 515, 518 : déclencheurs et contraintes recréés.
- 12 des 13 n'ont pas de section `INVERSION` : retour arrière = restauration de la sauvegarde.

## 3. Procédure de déploiement (staging, puis production)

1. **Sauvegarde** complète de la base cible (et test de restauration sur staging — G3-02).
2. Relever l'état de départ : `SELECT name FROM _migrations ORDER BY name DESC LIMIT 5;` — noter
   le dernier numéro appliqué ; toutes les migrations au-delà seront jouées, pas seulement 519-595.
3. Appliquer les migrations avec le lanceur du projet (`server/src/config/migrate.ts`), dans l'ordre.
4. Contrôler : `psql "$DATABASE_URL" -f server/scripts/post-migration-check.sql` — chaque ligne doit
   être `OK`. La ligne « Info : allergènes… » est attendue tant que G2-06 n'est pas fait.
   Le contrôle « migrations 519 à 595 » ne couvre pas 506-518 : vérifier aussi
   `SELECT count(*) FROM _migrations WHERE name ~ '^(50[6-9]|51[0-8])_';` → 13.
5. Rejouer le jeu de référence (`npx tsx scripts/reference-snapshot.ts capture … --like avant-g0`
   puis `compare`) : zéro écart attendu sur les chiffres existants.
6. Déployer le code serveur et client correspondant (`main`) seulement après un contrôle vert.

## 4. Script de contrôle

`server/scripts/post-migration-check.sql` (lecture seule) : migrations 519-595 présentes et
uniques, contraintes validées, aucun déclencheur désactivé (constat déjà fait en dev sur
`journal_entries`), index valides, fonctions et tables clés présentes, une seule devise de base,
une version de nomenclature active par fiche, un type par ordre de fabrication, écritures
comptables équilibrées, aucun stock matière négatif. Résultat sur la base vierge et sur la base
de dev au 2026-11-18 : tout `OK`.

# Migrations — règles

Les migrations sont des fichiers SQL numérotés, joués dans l'ordre par `src/config/migrate.ts`
(`npm run migrate --workspace=server`). Chaque fichier joué est inscrit dans la table
`_migrations` avec l'empreinte SHA-256 de son contenu.

Pour qui vient d'Oracle : c'est l'équivalent d'un dossier de scripts de livraison versionnés,
avec une table de contrôle qui dit lesquels sont passés — et qui refuse un script modifié
après coup.

## 1. Numérotation

- Nom : `NNN_objet_en_minuscules.sql`. Le numéro est le suivant libre **sur `main`**, pas
  seulement dans son répertoire de travail : vérifier les migrations déjà commitées avant de
  numéroter.
- Deux migrations ne partagent jamais un numéro. Six doublons historiques (051, 264, 265,
  426, 427, 428) sont tolérés parce qu'ils sont déjà en production ; tout nouveau doublon est
  refusé par le lanceur et par le test `src/__tests__/migrations-numbering.test.ts`.

## 2. Une migration appliquée ne se modifie plus

Le lanceur compare l'empreinte du fichier à celle enregistrée : un fichier modifié après son
application arrête la migration (« checksum mismatch »). Pour corriger une migration déjà
passée quelque part, écrire une **nouvelle** migration.

Conséquence pratique : ne pas appliquer à la main, sur une base partagée, une migration qui
n'est pas encore figée — son empreinte ne correspondra plus au fichier commité.

## 3. Migrations destructives

- Une migration qui supprime ou réécrit des données (`DROP COLUMN`, `DROP TABLE`, `UPDATE` ou
  `DELETE` de masse, changement de type avec perte) est **précédée** d'une migration de
  sauvegarde : la colonne ou la table est d'abord copiée (`…_backup_NNN`), dans un fichier
  séparé, appliqué et vérifié avant le second.
- Pas de script de retour arrière générique. Chaque migration décrit son inversion dans son
  en-tête (`-- INVERSION : …`) ; pour une migration destructive, l'inversion est la
  restauration depuis la sauvegarde.
- Une correction de données de production se prépare en lecture seule (script
  `scripts/diagnose-*.sql`), se chiffre, et s'applique après accord.

## 4. Écrire une migration rejouable

- `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, contraintes créées sous
  `IF NOT EXISTS (SELECT 1 FROM pg_constraint …)`, `INSERT … ON CONFLICT DO NOTHING`.
- En-tête obligatoire : la tâche, le pourquoi, ce que fait le fichier, l'inversion.
- Une colonne ajoutée à une table déjà remplie est `NULL` ou porte un `DEFAULT` : la valeur
  d'avant doit rester le comportement d'avant.

## 5. Pièges rencontrés en production

- Ne jamais faire `CREATE OR REPLACE` d'une fonction ancienne : son propriétaire en
  production n'est pas le rôle de migration. Créer une fonction d'un autre nom, ou la
  supprimer dans une migration dédiée.
- Un paramètre non typé dans `GREATEST($1, 0)` ou une comparaison numérique est inféré
  `integer` : écrire `$1::numeric`.
- Un `FOR UPDATE` sur une requête avec jointure externe échoue : préciser `FOR UPDATE OF alias`.

## 6. Base vierge et intégration continue

`scripts/test-db-setup.sh` crée une base vide et y joue **toutes** les migrations ; il tourne
à chaque intégration continue. Une migration de schéma qui échoue sur base vide arrête la
chaîne. Les migrations de données qui dépendent d'identifiants de la base de production sont
marquées jouées sans l'être, et listées à la fin.

## 7. Appliquer une migration à la main (développement)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f migrations/NNN_objet.sql
```

puis l'inscrire avec l'empreinte du fichier **commité** :

```bash
psql "$DATABASE_URL" -c "INSERT INTO _migrations(name, checksum) VALUES ('NNN_objet.sql', '$(shasum -a 256 migrations/NNN_objet.sql | cut -d' ' -f1)') ON CONFLICT DO NOTHING"
```

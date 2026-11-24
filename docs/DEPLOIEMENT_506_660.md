# Déploiement en production — migrations 506 à 660 (2026-11-23)

Préparé le 2026-11-23. Il pousse **614 commits** (origin/main `f56b2496` → main) et joue
**148 migrations** (506 à 660 ; les numéros manquants 597, 599-600, 602-605, 607-609 sont
réservés par d'autres branches, ce n'est pas un trou). Prend la suite de
`docs/MIGRATIONS_519_595.md` (même règles, plage étendue).

## 1. État de la production (relevé en lecture seule, 2026-11-23 21 h 13)

| Point | Valeur |
|---|---|
| Dernière migration | `505_quote_free_lines.sql` |
| PostgreSQL | 16 (Cloud SQL `ofauria-db`, db-f1-micro) ; migrations jouées par `ofauria`, **non superutilisateur** (membre de `cloudsqlsuperuser`) |
| Activité | dernière vente le 2026-08-04 (3 ventes au total), dernier plan le 2026-07-27, 1 plan chiffré (13,34) |
| Coût de revient | charges loyer / énergie / autres à 0, taux de charges fixes 40 % ; la colonne « mode de calcul » n'existe pas encore → après migration : `rate` (taux sur les matières) |
| Centres, immobilisations | 0 / 0 (les 11 centres sont créés par la 655) |

## 2. Ce qui a été vérifié avant le push

- **Sauvegarde locale** : `pg_dump` complet hors dépôt —
  `Ofauria-app-sauvegardes/ofauria_prod_20261123_211311_avant_deploiement_506_660.dump`
  (5,3 Mo). `--enable-row-security` est obligatoire depuis le FORCE RLS des tables comptables ;
  la politique `fn_rls_store_ok` laisse tout voir sans `app.store_scope` : 453 factures,
  1 469 écritures, 993 règlements, identiques à la production.
- **Répétition** : copie restaurée dans un PostgreSQL 16 avec les propriétaires et les droits de
  la production, migrations jouées par un rôle `ofauria` non superutilisateur : **148 / 148 en
  6,4 s** (la 512, qui verrouille les tables de production, dure moins d'une seconde à ce
  volume). `post-migration-check.sql` : tout `OK`.
- **Propriétaires** : seuls 4 fonctions et 3 types appartiennent à `postgres` en production
  (`check_product_lot_invariant`, `sync_inventory_from_lots`, `sync_quantity_remaining`,
  `trg_sync_inventory_from_lots`, types `pipeline_*`) ; aucune migration 506-660 n'y touche
  (pas de piège « propriétaire différent »).
- **Chiffres existants** : jeu de référence capturé avant / après sur la copie (§ 7).
- **CI rejouée en local** (PG 16 neuf) : lint, typage, 565 tests unitaires, 980 tests de base,
  79 tests client, build client — vert.
- **Image Docker de production** construite et démarrée sur la copie migrée : `/health` 200
  (base `ok`), routes analytiques en ligne (401 sans jeton), client servi. Toutes les
  dépendances importées par `server/src` sont déclarées (`docx` à la racine, en dépendance).

### Correctifs CI faits pour ce déploiement
- La dernière CI sur origin (11/11) avait échoué **sans message** : `test-db-setup.sh`
  s'arrêtait en silence (pipefail + errexit sur un `grep` sans résultat). Corrigé (`|| true`) :
  la sortie de la migration en échec est maintenant affichée.
- Les tests de base tournaient **en parallèle** sur la même base : 9 échecs sur PG 16 neuf
  (réglages globaux partagés). Ils tournent maintenant un fichier à la fois (`test:db`), dans
  une étape séparée ; délai du job porté à 30 min.

## 3. Déroulé

1. **Annuler les 4 runs GitHub restés ouverts depuis le 11/11** (Actions → chaque run →
   *Cancel workflow*) : 43087991396 (déploiement de `675cf171` en attente d'approbation),
   43097850751, 43097850766, 43102417400. Ils portent sur des commits déjà inclus ; sans
   annulation, le nouveau déploiement attend derrière eux (`concurrency: deploy-production`).
2. Push de main → la **CI** tourne (≈ 15-20 min). Un échec arrête tout ici.
3. CI verte → le workflow **Deploy to Cloud Run** construit l'image puis **attend ton
   approbation** (environnement `production`, relecteur obligatoire). **N'approuver que le run
   du dernier commit.**
4. Juste avant d'approuver : **sauvegarde Cloud SQL à la demande**
   `gcloud sql backups create --instance=ofauria-db --project=ofauria --description="Avant 506-660"`
   (la copie locale du § 2 existe déjà ; la sauvegarde Cloud SQL permet une restauration
   rapide sur l'instance). Hors heures d'ouverture conseillé (512) — la production est
   inactive depuis août, le risque est faible.
5. Approuver → `Run DB migrations` puis `Deploy to Cloud Run`.

## 4. Contrôles après déploiement

- `server/scripts/post-migration-check.sql` sur la production (via `cloud-sql-proxy`) : tout `OK`.
- `SELECT count(*) FROM _migrations WHERE name >= '506'` → 148.
- `https://ofauria-app-gpezecanha-ew.a.run.app/health` → `"database":"ok"`.
- Dans l'appli : Production › Analyse des coûts s'ouvre (mode « taux sur les matières »).

## 5. Retour arrière

- Code seul en échec (conteneur qui ne démarre pas) : Cloud Run garde l'ancienne révision ;
  les migrations sont additives, l'ancien code fonctionne avec la base migrée.
- Données : restaurer la sauvegarde Cloud SQL du § 3.4 (ou la copie locale du § 2). Plusieurs
  migrations de reprise (537, 546, 564, 649-652…) n'ont pas d'inverse autre que la sauvegarde.
- Moteur analytique : il n'est pas activé par le déploiement ; s'il l'est plus tard, repasser
  le mode à « taux sur les matières » et recalculer le mois.

## 6. Après la mise en production (phase 4, étapes 5-8 du plan coût de revient)

Paramétrer charges, personnel, capacités, clés, immobilisations et outillage ; activer le
moteur ; recalculer le mois ; contrôle « Équilibré ». Voir `docs/PLAN_ACTION_COUT_DE_REVIENT.md`.

## 7. Jeu de référence avant / après (copie de la production)

`scripts/reference-snapshot.ts` sur la copie avant (505) et après (660), même périmètre :

| Famille | Résultat |
|---|---|
| Plans clôturés, lots de stock (1 053), balance, TVA (12 mois), paie (219 bulletins), amortissements | **identiques au centime** |
| Coût théorique des fiches (656 formats) | 607 changent : 469 de moins de 1 %, 86 de 1 à 5 %, 16 de 5 à 20 %, 36 de plus de 20 % |

Les écarts de fiches sont les corrections voulues, déjà validées en dev :
- **÷ 2 exact** sur la plupart des 36 grands écarts (entremets, cakes, trompe-l'œil, Mini
  croissant 2,35 → 1,18…) : la 650 retire les 91 lignes d'ingrédients en double laissées par
  la 411 (27 fiches) ;
- hausses sur les fiches salées et ghriba (Briouate 7,21 → 9,62, Ghriba fromage 5,01 → 8,18…)
  et pièces corrigées (Biscuit moelleux, Confit framboise, Crème amande) : bases repointées
  et converties en grammes (649, 652) ;
- petits écarts (< 1 %) : coût matière = prix du lot en cours au lieu du coût moyen (653).

**À faire confirmer par le chef** : Tarte aux amandes 136,42 → 3,00 par part (22 parts) —
quantités de 651/652 estimées (crème d'amande 242 g, 440 g / 990 g).

Rien n'est figé par ces changements : le coût des lots déjà produits et la comptabilité ne
bougent pas ; seuls les prochains plans et l'affichage des fiches suivent les nouvelles valeurs.

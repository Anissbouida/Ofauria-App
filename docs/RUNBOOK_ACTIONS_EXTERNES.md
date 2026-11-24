# Actions externes — ce qui ne se fait pas depuis le poste de développement

Rédigé le 2026-11-18 pour le plan d'action global 2026-11 et le plan pilote. Tout ce qui suit
demande soit un accès à la production, soit une ressource Google Cloud payante, soit une
validation métier (gérant, comptable, expert-comptable). Le code correspondant est livré.

Règle commune : **les scripts de diagnostic sont en lecture seule**. Une reprise chiffrée ne se
passe qu'après accord écrit du gérant, montants sous les yeux.

---

## 1. Diagnostics à passer en production (lecture seule)

Connexion par le proxy Cloud SQL (comme dans `deploy.yml`), puis par exemple :

```bash
psql "$PROD_DATABASE_URL" -f server/scripts/diagnose-fermetures-tickets-annules.sql
```

| Script | Tâche | Ce qu'il dit | Suite |
|---|---|---|---|
| `diagnose-fermetures-tickets-annules.sql` | Plan pilote (ead6757, e866295) | Fermetures de caisse qui ont compté des tickets annulés (écart corrigé estimé) ; tickets annulés dont le lot n'a pas été rendu | **Avant le déploiement.** Résultat non vide : reprise des écarts de fermeture et des lots, sur accord |
| `diagnose-pointages-exclus-paie.sql` | G0-09 | Repos payés perdus (jours certains et jours à vérifier) | Le gérant valide la liste ; bulletins non payés régénérés ; régularisation le mois suivant pour les payés |
| `diagnose-emballages-double-consommation.sql` | G0-22 | Mouvements d'emballages en double et quantités à rendre | Ajustement de stock tracé, sur accord |
| `diagnose-master-data.sql` | G2-01 | Complétude des fiches (poids cuit, allergènes, étapes, homonymes, prix suspects) | Dimensionne G2-03 à G2-09 ; mêmes compteurs dans Paramètres › Données › Qualité des données |
| `diagnose-lots-perimes-actifs.sql` | G1-10 | Lots périmés restés actifs | La tâche `lots_expire` les passe au statut périmé à son premier passage |
| `post-migration-check.sql` | Migrations | 13 contrôles après migration | Après chaque déploiement de migrations |

Migrations en attente en production : la prod est à **505** ; voir `docs/MIGRATIONS_519_595.md`
(506-518 relues ; **512 à passer hors heures d'ouverture**). Les migrations 596 à 605 sont
venues depuis (ventes hors ligne abandonnées, coût unifié, format de virement, commission carte,
emplacements des produits finis) : mêmes règles, sauvegarde à la demande juste avant.
**Mise à jour 2026-11-23** : la plage complète 506-660 a été répétée sur une copie de la
production ; procédure à suivre : `docs/DEPLOIEMENT_506_660.md`.

---

## 2. Validations métier

### Comptable de paie
- **SMIG horaire et mensuel** (G0-11) : Paramètres › Paie › barème daté. Tant que les valeurs ne
  sont pas saisies, le contrôle reste inactif. Ne saisir que la valeur officielle en vigueur à la
  date d'effet.
- **Barème IR de l'exercice** (G0-13) : « Nouvelle version » dans Paramètres de paie, date
  d'effet au 1ᵉʳ janvier ; un barème déjà utilisé par un bulletin n'est plus modifiable.
- **Premier dépôt e-BDS de test** sur Damancom (mig 325).

### Expert-comptable
- **Dégressif** (G0-15) : règle de prorata de la première annuité et sort des dotations passées.
- **Écritures de réévaluation et de frais d'approche** (G1-04) : schéma d'écriture à valider.
- **Commission carte** (G4-02) : compte 6147 proposé par défaut dans la règle ; à confirmer.

### Gérant
- **Contrôles en avertissement → bloquants** (G1-01) : revue cas par cas, date pivot.
- **Approbation des campagnes de paiement** (G4-01) : règle par défaut « toute campagne va à
  l'administrateur » (Paramètres › Circuits d'approbation) ; ajuster le seuil si besoin.
- **Anonymisation d'un salarié ou d'un fournisseur** (G3-11) : non offerte tant que les durées
  légales de conservation (bulletins, CNSS, pièces comptables) ne sont pas fixées avec le conseil.

---

## 3. Infrastructure Google Cloud (ressources payantes : décision de la direction)

### Stockage des fichiers (G0-04)
Code livré (mig 521). Créer un bucket privé (accès uniforme, aucun accès public, versions
d'objets activées), donner au compte de service Cloud Run le rôle *Storage Object Admin* sur ce
seul bucket, puis poser sur le service `STORAGE_DRIVER=gcs` et `STORAGE_BUCKET=<nom>`.

### Staging (G3-01)
Code livré : `APP_ENV=staging` (bandeau, e-mails détournés), `server/scripts/anonymize-staging.sql`,
`.github/workflows/deploy-staging.yml` (inactif tant que `STAGING_SERVICE_NAME` est vide).
1. Seconde instance Cloud SQL, petite (même version de Postgres), base `kalum_staging`.
2. Copie de la production : export à la demande, import dans l'instance staging, puis
   ```bash
   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -v confirm=kalum_staging -f server/scripts/anonymize-staging.sql
   ```
   (refus si `confirm` ne correspond pas au nom de la base), puis
   `DATABASE_URL=… npx tsx server/scripts/seed-test-accounts.ts`.
3. Secret Manager : `STAGING_DATABASE_URL`, `STAGING_JWT_SECRET` (différent de la prod).
4. Variables du dépôt GitHub : `STAGING_SERVICE_NAME`, `STAGING_SQL_INSTANCE`,
   `STAGING_ALLOWED_ORIGINS`, `STAGING_MAIL_TO` (boîte de test ; vide = aucun e-mail ne part).
5. Environnement GitHub `staging` (sans relecteur) ; vérifier que l'environnement `production`
   a des **relecteurs obligatoires** (validation manuelle du déploiement prod).

### Sauvegarde et restauration (G3-02)
1. Sur l'instance prod : sauvegardes automatiques et restauration à un instant donné actives ;
   noter la rétention.
2. Exercice réel : restaurer vers une instance temporaire, chronométrer, passer
   `post-migration-check.sql`, supprimer l'instance. Écrire qui / comment / durée dans
   `docs/DEPLOYMENT.md`. À refaire chaque trimestre.
3. Bucket de fichiers : versions d'objets activées (cf. G0-04).
Sauvegardes déjà prises le 2026-11-18 : Cloud SQL à la demande `1795055846731` et dumps locaux
hors dépôt (`Ofauria-app-sauvegardes/`).

### Observabilité (G3-03)
Livré : journal structuré dans tout le code serveur, requêtes lentes journalisées
(`SLOW_QUERY_MS`, 500 ms par défaut, sans paramètres). Reste :
- outil de suivi des erreurs (Sentry ou équivalent, avec masquage des données personnelles) ;
- alertes Cloud Logging : taux d'erreur 5xx, « requête SQL lente » en rafale, tâche planifiée en
  échec deux fois (`scheduled_jobs.last_status`), file d'e-mails bloquée, intégrité du grand
  livre rompue.

### Tâches planifiées et e-mails
`CRON_SECRET` + Cloud Scheduler appelant `/cron/tick` ; `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, `SMTP_FROM` en secrets. Sans eux, la file d'e-mails reste en attente.

### Connexion d'entreprise (G6-02)
Code livré (mig 579), inactif sans identifiants. Créer l'application chez Google et/ou
Microsoft, URI de redirection `<OIDC_REDIRECT_BASE>/api/v1/auth/oidc/<google|microsoft>/callback`,
puis poser `OIDC_REDIRECT_BASE`, `OIDC_FRONT_URL`, `OIDC_GOOGLE_CLIENT_ID`,
`OIDC_GOOGLE_CLIENT_SECRET`, `OIDC_MICROSOFT_CLIENT_ID`, `OIDC_MICROSOFT_CLIENT_SECRET`,
`OIDC_MICROSOFT_TENANT`. Les comptes se rattachent par e-mail vérifié à un utilisateur existant.

---

## 4. Installation chez un nouveau client

```bash
server/scripts/client-install.sh "postgresql://user:motdepasse@hote:port/base"
```
Migrations sur base vierge, retrait des données Ofauria semées par d'anciennes migrations,
administrateur seul (mot de passe affiché une fois), contrôle post-migration. Refuse une base qui
contient déjà des ventes, des écritures ou des factures.

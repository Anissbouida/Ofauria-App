# Pipeline de déploiement

## Vue d'ensemble

```
[Local dev] → git push → [GitHub] ──► CI (ci.yml)         : tests + build
                                  └─► CD (deploy.yml)     : build image → push GAR
                                              │
                                              ▼ ⏸ Approbation manuelle (environment "production")
                                              │
                                              ▼
                                       [Cloud Run]
```

## 1. Local — développement & tests

```bash
# Dev (server + client en parallèle)
npm run dev

# Tests unitaires (vitest)
npm run test --workspace=server

# Build complet (vérifie que tout compile)
npm run build
```

## 2. Setup GCP (one-time)

> Remplacer `PROJECT_ID`, `REGION` (`europe-west1` recommandé), `SERVICE` et `REPO`.

### a) Activer les APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com \
  --project=PROJECT_ID
```

### b) Créer l'Artifact Registry

```bash
gcloud artifacts repositories create REPO \
  --repository-format=docker \
  --location=REGION \
  --project=PROJECT_ID
```

### c) Service account pour GitHub Actions

```bash
gcloud iam service-accounts create github-deployer \
  --display-name="GitHub Actions deployer" \
  --project=PROJECT_ID

# Permissions minimales
SA="github-deployer@PROJECT_ID.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/run.admin"

gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/iam.serviceAccountUser"
```

### d) Workload Identity Federation (auth sans clé JSON)

```bash
# Pool
gcloud iam workload-identity-pools create github-pool \
  --location=global --project=PROJECT_ID

# Provider
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner == 'Anissbouida'" \
  --project=PROJECT_ID

# Lier le SA au repo GitHub
PROJECT_NUMBER=$(gcloud projects describe PROJECT_ID --format='value(projectNumber)')

gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/attribute.repository/Anissbouida/Ofauria-App" \
  --project=PROJECT_ID

# Récupérer le nom complet du provider (à mettre dans GitHub Secret)
echo "projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/providers/github-provider"
```

## 3. Configuration GitHub

### Secrets (Settings → Secrets and variables → Actions → Secrets)

| Nom | Valeur |
|---|---|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/NUMBER/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| `GCP_SERVICE_ACCOUNT` | `github-deployer@PROJECT_ID.iam.gserviceaccount.com` |

### Variables (Settings → Secrets and variables → Actions → Variables)

| Nom | Exemple |
|---|---|
| `GCP_PROJECT_ID` | `ofauria-prod` |
| `GCP_REGION` | `europe-west1` |
| `GCP_AR_REPOSITORY` | `ofauria` |
| `GCP_SERVICE_NAME` | `ofauria-app` |

### Environment "production" (gate d'approbation)

1. Settings → **Environments** → **New environment** → nom `production`
2. Cocher **Required reviewers** et ajouter votre compte
3. (Optionnel) Restreindre aux branches `main`

➡️ À chaque push sur `main`, la CI se lance, l'image se construit et se pousse, puis le job `deploy` **attend votre clic d'approbation** dans l'onglet Actions.

## 4. Variables d'environnement runtime (Cloud Run)

À configurer une fois dans Cloud Run (Console ou `gcloud run services update`) — la pipeline ne les écrase pas :

```bash
gcloud run services update ofauria-app \
  --region=REGION \
  --set-env-vars=NODE_ENV=production \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest
```

Stocker les secrets sensibles dans **Secret Manager**, pas en variables.

### Stockage des fichiers téléversés (G0-04)

Le disque de Cloud Run est vidé à chaque révision : factures fournisseurs, photos de pertes, de réclamations et de produits vont dans un **bucket privé**. À faire une fois :

```bash
# Bucket privé, accès uniforme, sans accès public
gcloud storage buckets create gs://NOM_DU_BUCKET \
  --location=REGION --uniform-bucket-level-access --public-access-prevention

# Le compte de service d'exécution de Cloud Run écrit et lit les objets
gcloud storage buckets add-iam-policy-binding gs://NOM_DU_BUCKET \
  --member="serviceAccount:COMPTE_DE_SERVICE_CLOUD_RUN" \
  --role="roles/storage.objectAdmin"

# Versions d'objets (sauvegarde, voir G3-02)
gcloud storage buckets update gs://NOM_DU_BUCKET --versioning

gcloud run services update ofauria-app --region=REGION \
  --update-env-vars=STORAGE_DRIVER=gcs,STORAGE_BUCKET=NOM_DU_BUCKET
```

| Variable | Valeur | Rôle |
|---|---|---|
| `STORAGE_DRIVER` | `gcs` en production, `local` (défaut) en développement | pilote de stockage |
| `STORAGE_BUCKET` | nom du bucket | obligatoire si `gcs` |
| `STORAGE_LOCAL_DIR` | dossier (défaut : `storage/` à la racine du dépôt) | pilote local |

Sans `STORAGE_DRIVER=gcs` en production, le serveur le signale au premier téléversement et les fichiers ne survivent pas au déploiement suivant.

Les fichiers sont lus par `GET /api/v1/files/:id`, authentifié ; le dossier `/uploads` ne sert plus que les fichiers hérités, à un utilisateur connecté. Rapport des pièces héritées (présentes / perdues) : `npx tsx scripts/migrate-uploads-to-storage.ts` depuis `server/` (lecture seule ; `--apply` reprend les fichiers encore présents).

### Limiteurs de débit (G0-02)

`RATE_LIMIT_PUBLIC_PER_MIN` (défaut 120, par clé d'API), `RATE_LIMIT_PORTAL_PER_MIN` (60, par IP), `RATE_LIMIT_GLOBAL_PER_MIN` (1 200, par IP). `0` désactive le limiteur.

## 5. Workflow quotidien

```bash
git checkout -b feat/ma-feature
# ... travail ...
npm run test --workspace=server   # vérif locale
git commit -am "feat: ..."
git push origin feat/ma-feature
# Ouvrir PR → CI tourne automatiquement
# Merge sur main → CI puis CD (avec approbation) → Cloud Run
```

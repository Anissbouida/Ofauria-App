# Audit de sécurité — Ofauria (serveur / client / mobile)

_Date : 2026-07-02 · Périmètre : `server/` (Express/PG), `client/` (React/Vite), `mobile/` (Capacitor/Android), Docker, dépendances._

## Résumé exécutif

Le socle de sécurité est **globalement solide et mature** : JWT en cookie HttpOnly `SameSite=Strict`, révocation par `jti` + `tokenVersion`, bcrypt cost 12, lockout de compte, timing-safe login, Helmet (CSP+HSTS), CORS allowlist, check anti-CSRF Origin/Referer, SQL paramétré, allowlist de timezones, cleartext désactivé sur mobile. Beaucoup de menaces OWASP classiques sont déjà traitées.

Les failles restantes sont concentrées sur **le contrôle d'accès aux ressources (IDOR / autorisation)** et **quelques surfaces d'exposition** :

| # | Vulnérabilité | Sévérité | Effort |
|---|---|---|---|
| V1 | IDOR employés : lecture/modif/**suppression définitive** cross-magasin + paie | 🔴 Haute | S |
| V2 | `/uploads/invoices/*` (factures fournisseurs) servi **sans authentification** | 🔴 Haute | M |
| V3 | Dépendances vulnérables (`xlsx` prototype-pollution/ReDoS sur uploads, `form-data`, `express`/`qs`) | 🔴 Haute | M |
| V4 | `pin-login` : brute-force possible, pas de lockout compte, PIN global, DoS bcrypt | 🟠 Moyenne | M |
| V5 | GET sensibles sans `authorize(...)` + `POST /products/:id/image` ouvert à tous les rôles | 🟠 Moyenne | M |
| V6 | Multi-magasin non systématique (`requireStoreContext` = code mort, accès global implicite) | 🟠 Moyenne | L |
| V7 | Conteneur Docker exécuté en **root** | 🟠 Moyenne | S |
| V8 | `GET /auth/users-list` non authentifié expose noms + **rôles** de tous les comptes | 🟠 Moyenne | S |
| V9 | Upload SVG autorisé (logo) → XSS stocké (mitigé par CSP) | 🟡 Faible | S |
| V10 | Interpolation `tz` dans le SQL — sûre aujourd'hui (allowlist) mais fragile | 🟡 Faible | S |
| V11 | `.gitignore` racine trop étroit (`.env` seul) → risque de commit d'un futur `.env.production` | 🟡 Faible | S |
| V12 | `docker-compose` : Postgres/pgAdmin bindés sur toutes les interfaces (LAN), pgAdmin `admin/admin` | 🟡 Faible | S |
| V13 | Fallback Bearer legacy `localStorage` côté client (migration cookie non close) | 🟡 Faible | S |

_Effort : S = < 2 h, M = 0,5–1 j, L = 1–3 j._

**Deux volets sont propres (audités et confirmés) :**
- **Injection SQL — RAS.** Les ~1600 appels `query()` sont tous paramétrés (`$1, $2…`) ; les seules interpolations `${}` portent sur `tz` (allowlist), des clauses `WHERE`/`SET` pré-formatées avec leurs propres placeholders, et des noms de colonnes issus de whitelists.
- **Secrets — RAS.** Aucun secret réel dans le repo ni dans tout l'historique git. `JWT_SECRET`/`DATABASE_URL` viennent de GCP Secret Manager, auth GitHub→GCP par Workload Identity (OIDC, pas de clé de service), validation stricte au boot (`env.ts`), `.dockerignore` exclut les `.env`, seed sans mot de passe par défaut.

---

## Détail des vulnérabilités

### V1 — IDOR sur les employés 🔴
**Fichier :** `server/src/controllers/employee.controller.ts:12-45`
`getById`, `update`, `remove` (dont `?hard=true` = suppression physique) et `dependencies` utilisent `req.params.id` **sans aucun contrôle d'appartenance au magasin**. Les routes sont protégées par `authorize(ADMIN_MANAGER)`, mais un **manager du magasin A peut lire, modifier et supprimer définitivement un employé du magasin B**, données de paie incluses. Seul `list` filtre par `storeId`.
**Impact :** violation de cloisonnement multi-tenant, destruction de données RH, fuite de salaires.

### V2 — Factures fournisseurs exposées sans auth 🔴
**Fichiers :** `server/src/app.ts` (`app.use('/uploads', express.static(...))`) + `server/src/routes/accounting.routes.ts:12-16`
Tout le répertoire `/uploads` est servi en statique **sans authentification**, y compris `/uploads/invoices/*` (PDF/images de factures = données comptables). Les noms sont faiblement aléatoires : `facture-${Date.now()}-${Math.round(Math.random()*1000)}.pdf` → devinables sur une fenêtre temporelle connue.
**Impact :** fuite de documents comptables/fournisseurs (A01 Broken Access Control).

### V3 — Dépendances vulnérables 🔴
`npm audit` (prod) — 2 High, 5 Moderate :
- **`xlsx` (SheetJS) — aucun correctif npm.** Prototype Pollution (GHSA-4r6h-8v6p-xvw6) + ReDoS (GHSA-5pgg-2g8v-p4x9). **Critique ici car parse des fichiers uploadés** : `caisse-excel-parser.service.ts`, `recipe-excel.service.ts`, imports ingrédients/recettes/caisse. Input non fiable → parsing vulnérable.
- **`form-data` 4.0.0–4.0.5** — CRLF injection (High).
- **`express` / `qs` / `body-parser`** — DoS `qs.stringify` (Moderate).
- **`ip-address`** (via `express-rate-limit`) — XSS Address6 (Moderate).

### V4 — pin-login : brute-force, pas de lockout, DoS 🟠
**Fichiers :** `server/src/controllers/auth.controller.ts` (`pinLogin`) + `repositories/user.repository.ts:46` (`findByPinCode`)
- Le PIN est **global** : `findByPinCode` charge tous les users actifs et compare — n'importe quel PIN valide connecte au compte correspondant (pas de sélection d'utilisateur). Espace de collision ≈ N_users / 10^4.
- Sur échec PIN, **`recordFailedLogin` n'est jamais appelé** (aucun user matché) → le lockout de compte (A04-2) ne protège pas le PIN. Seul le rate-limit **IP** (5/h) agit, et il est **désactivé en dev**.
- PIN de **4 chiffres** encore accepté (`{4,10}`).
- **DoS :** chaque tentative fait un `bcrypt.compare` (cost 12 ≈ 200-400 ms) sur **tous** les users à PIN → amplification + fuite de timing sur le nombre d'utilisateurs.

### V5 — Autorisation manquante sur des GET sensibles + mutation image 🟠
**Fichiers :** voir routes ci-dessous. GET lisibles par **tout rôle authentifié** (caissière/vendeuse/magasinier) alors que les données sont stratégiques :
- `production-cout.routes.ts` (coûts réels, main-d'œuvre, équipements), `production-markup.routes.ts:9` (marge), `recipes.routes.ts` (recettes + finance = savoir-faire), `inventory.routes.ts:12-17` (stocks/coûts), `ingredient-lot.routes.ts` (prix d'achat), `product-loss.routes.ts` (valorisation pertes), `orders.routes.ts:11-13`.
- **`products.routes.ts:35` — `POST /products/:id/image`** : n'importe quel rôle peut remplacer l'image d'un produit (defacement), alors que les autres mutations produit sont `ADMIN_MANAGER`.

### V6 — Multi-magasin non systématique 🟠
**Fichiers :** `server/src/middleware/tenant.middleware.ts` (0 usage), contrôleurs divers.
`requireStoreContext` et `checkStoreOwnership` sont du **code mort**. Le filtrage repose sur des `if (req.user.storeId)` inline, avec deux trous récurrents :
1. **Non-admin sans `storeId` → accès global implicite** (ex. `reports.controller.ts` : un manager `store_id NULL` voit les finances tous magasins). La politique « 403 si non-admin sans magasin » n'existe que dans `sale.controller.getById`.
2. **Ressources à `store_id NULL`** passent le filtre `store_id !== user.storeId` → visibles par tous les magasins (ex. `accounting.controller.ts`).

### V7 — Conteneur Docker en root 🟠
**Fichier :** `Dockerfile` — aucune directive `USER`. Le process Node tourne en **root** dans le conteneur (image `node:22-alpine` fournit pourtant un user `node`). Amplifie l'impact d'une éventuelle RCE. `--ignore-scripts` est bien présent (bon point).

### V8 — `/auth/users-list` non authentifié 🟠
**Fichier :** `server/src/routes/auth.routes.ts:40`
Renvoie `id, prénom, nom, rôle` de **tous** les comptes actifs, sans auth. Nécessaire pour l'écran PIN, mais l'exposition du **rôle** facilite le ciblage (repérer les admins) et l'énumération pré-auth.

### V9 — Upload SVG → XSS stocké 🟡
**Fichier :** `server/src/routes/upload.routes.ts` — `imageFilter` autorise `.svg`. Un SVG peut embarquer du script. Mitigé par la CSP (`script-src 'self'`) + `Content-Disposition: inline` + `X-Content-Type-Options: nosniff`, mais le format reste à proscrire.

### V10 — Interpolation `tz` dans le SQL (fragile, pas exploitable) 🟡
**Fichiers :** `unsold-decision.repository.ts`, `replenishment.repository.ts`, `return.repository.ts` — `AT TIME ZONE '${tz}'`. **Actuellement sûr** : `getUserTimezone()` ne renvoie que des valeurs de l'allowlist IANA (`utils/timezone.ts`), le header `X-Timezone` malveillant est rejeté. À conserver sous surveillance : toute évolution qui contournerait l'allowlist rouvrirait une injection SQL.

### V11 — `.gitignore` racine trop étroit 🟡
N'ignore que `.env`, `.env.local`, `.env.backup.*`. Preuve du trou : `mobile/.env.production` et `client/.env.local.prod-backup` sont **trackés** (inoffensifs — URL publiques — mais un futur `server/.env.production` avec vrais secrets serait committable). `client/.env.mobile` (nouveau) n'est pas ignoré. **Correctif :** `.env.*` + `!.env.example`, versionner les URL publiques sous `.env.mobile.example`. Note : `.env.example` contient `ofauria_secret`, qui est le vrai mot de passe Postgres local (`docker-compose.yml`) → remplacer par un placeholder.

### V12 — `docker-compose` exposé + pgAdmin admin/admin 🟡
Postgres `5433` et pgAdmin `5050` (login `admin@ofauria.com`/`admin`) bindés sans préfixe `127.0.0.1:` → accessibles depuis le LAN. **Correctif :** `127.0.0.1:5433:5432` et `127.0.0.1:5050:80`. (Dev uniquement, mais évite l'exposition sur réseau partagé.)

### V13 — Fallback Bearer legacy côté client 🟡
`client/src/api/client.ts` renvoie encore un token trouvé dans `localStorage` (`ofauria_token`) ; son propre commentaire dit « à retirer après migration ». La migration cookie HttpOnly est faite → supprimer ce fallback pour clore la surface. Idem : `JWT_SECRET` réel est passé au job de migration CI uniquement pour satisfaire `env.ts` — un dummy 32-chars suffirait, réduisant l'exposition du vrai secret dans le runner.

### Bons points confirmés ✅
Cookie JWT HttpOnly/Secure/SameSite=Strict · révocation `jti` + `tokenVersion` · bcrypt 12 + dummy-hash timing-safe · lockout compte 5/15 min · Helmet CSP+HSTS · CORS + CSRF Origin check · SQL paramétré partout ailleurs · limites de taille de body (10 Ko) · logs structurés avec redaction · allowlist timezones · mobile cleartext désactivé (sauf IP dev) · pas de token en `localStorage` · pas de `dangerouslySetInnerHTML`.

---

## Plan d'implémentation

### Phase 1 — Correctifs critiques (Sprint immédiat, ~1 j)
1. **V1 IDOR employés** — dans `getById/update/remove/dependencies`, charger l'employé puis refuser si `employee.store_id !== req.user.storeId` (admin global exempté). Réutiliser `checkStoreOwnership`.
2. **V2 factures** — retirer `/uploads/invoices` du statique public ; servir via une route `GET /invoices/:id/attachment` avec `authenticate` + `authorize(ADMIN_MANAGER)` + contrôle `store_id`, en streamant le fichier.
3. **V3 deps** — `npm audit fix` (form-data, express/qs, ip-address). Pour **`xlsx`** : migrer vers `xlsx` de la source officielle SheetJS (`https://cdn.sheetjs.com/...`, version ≥ 0.20.3 corrigée) ou remplacer par `exceljs` ; en attendant, isoler le parsing (taille/feuilles limitées) et le figer aux rôles admin/manager.
4. **V8 users-list** — ne renvoyer que `id, prénom` (retirer le rôle et le nom de famille).

### Phase 2 — Durcissement autorisations (Sprint suivant, ~2 j)
5. **V5** — ajouter `authorize(...)` sur les GET sensibles (production-cout, production-markup, recipes, inventory, ingredient-lots, product-losses, orders) et sur `POST /products/:id/image`.
6. **V4 pin-login** — enregistrer un échec/lockout même sans match (compteur IP + délai constant), passer à un `bcrypt.compare` unique ou à une recherche indexée sur un hash déterministe, imposer PIN ≥ 6 chiffres après migration des comptes legacy, réactiver un plancher de rate-limit IP même en dev.
7. **V7 Docker** — ajouter `RUN addgroup ... && adduser` ou utiliser l'utilisateur `node` intégré + `USER node` avant le `CMD`.

### Phase 3 — Cloisonnement systémique (~3 j)
8. **V6** — câbler `requireStoreContext` sur les routers multi-magasin, généraliser le pattern de `sale.controller.getById` (404/403 explicites), traiter les ressources `store_id NULL` (refus pour non-admin). Auditer `schedule`/`notification` pour l'IDOR résiduel.
9. **V9** — retirer `.svg` de l'allowlist d'upload (ou passer par une sanitization type DOMPurify/`svgo` + revalidation MIME).
10. **V10** — encapsuler l'usage de `tz` dans un unique helper validé, ajouter un test qui vérifie qu'une timezone non-allowlistée est bien rejetée.

### Phase 4 — Hygiène continue
- Monter `authenticate` **globalement** dans `routes/index.ts` (+ whitelist login/pin-login/users-list) pour éliminer le risque d'oubli sur une future route.
- Ajouter `npm audit --omit=dev` en CI (échec si High).
- Faire tourner `/security-review` sur chaque PR touchant l'auth ou les routes.

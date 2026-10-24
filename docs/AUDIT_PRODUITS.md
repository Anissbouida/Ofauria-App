# Audit du module Produits

*Audit réalisé le 14/07/2026 — périmètre : backend (products.routes/controller/repository, product-stock.helper, pricing-tiers, channel-pricing, product-lots, product-losses, product-pipeline), modèle de données (migrations 003→236), frontend (ProductsPage, ExpiredProductLotsBanner, SemiFinisTab, ProductionProfileTab, api produits).*

*Note : l'audit porte sur le working tree du jour, qui contient un flag de test non committé `POS_ALLOW_NEGATIVE_STOCK` dans `product-stock.helper.ts` (vente en stock négatif). Rien à redire sur son implémentation, mais il ne doit jamais partir activé en production — voir A6.*

---

## Synthèse

Le module est fonctionnel et le sous-module **lots** est le mieux construit (transactions, verrous `FOR UPDATE`, trigger d'invariant comptable de la mig 106). Mais le cœur du module — création, suppression, stock — souffre de trois maux :

1. **La création de produit perd silencieusement la moitié du formulaire** : les onglets « Production » et « Cycle de vie » (DLV, DDE, seuils) sont envoyés par le client mais ignorés par l'INSERT du serveur. Un produit « vente du jour » créé via l'UI n'expire donc jamais au POS.
2. **La suppression de produit détruit l'historique financier** : DELETE physique qui purge `sale_items` et `sale_return_items` (les lignes de ventes passées !), hors transaction, avec en prime un CASCADE silencieux sur tout le journal de stock et les lots. Incompatible avec l'exigence de traçabilité (audits/normes).
3. **Aucune validation d'entrée sur le cœur** : pas de `product.validator.ts`, pas d'`asyncHandler` sur `products.routes.ts` ni `product-loss.routes.ts` (analogie Oracle : un bloc sans `EXCEPTION WHEN OTHERS` — sauf qu'ici la « session » HTTP reste suspendue jusqu'au timeout Cloud Run). Un `quantity` non numérique peut même écrire `NaN` dans le stock (le type `numeric` de PG l'accepte).

Côté client, deux bugs peuvent **effacer des données tarifaires en base** (paliers au poids et prix par canal) à cause d'un pattern d'initialisation `useState`+`useEffect` défaillant, et deux types de perte (`casse`, `non_vendu`) sont inutilisables car l'enum zod a dérivé de la contrainte CHECK SQL.

Points forts à préserver : gestion de la concurrence exemplaire dans `product-lot.repository.ts`, whitelist de colonnes dans `productRepository.update`, SQL paramétré partout, `product-loss.validator.ts` est un bon modèle zod à généraliser, invalidations React Query croisées et commentées côté client.

---

## 1. Backend cœur (routes / controller / repository / stock)

### CRITIQUE

**B1. DELETE produit = destruction de l'historique de ventes, hors transaction** — `product.repository.ts:248-264`
`delete()` fait 12 DELETE séquentiels **sans BEGIN/COMMIT**, dont `sale_return_items` et `sale_items` : supprimer un produit retiré du catalogue efface ses lignes dans toutes les ventes passées → les totaux (`sales.total_amount`) ne correspondent plus à la somme des lignes, les rapports et la compta divergent. S'y ajoutent les FK `ON DELETE CASCADE` (migs 029, 105, 171, 173) qui font disparaître **silencieusement** tout le journal `product_stock_transactions`, les lots et les tarifs. Et comme rien n'est transactionnel, si un DELETE intermédiaire échoue (FK non listée, ex. `unsold_decisions`, `invoice_items`), les ventes sont déjà purgées et commitées alors que le produit reste.
→ **Reco** : soft-delete (`deleted_at` ou réutiliser `is_available` + flag `is_deleted`), refuser le DELETE physique dès qu'un historique existe, et retirer définitivement les DELETE sur `sale_items`/`sale_return_items`. Au strict minimum : tout envelopper dans une transaction.

**B2. La création ignore les champs Production et Cycle de vie** — `product.controller.ts:190-197` (voir aussi C1)
L'INSERT du `create` ne couvre que 12 colonnes ; `stockMinThreshold`, `minProductionQuantity`, `shelfLifeDays`, `displayLifeHours`, `isReexposable`, `isRecyclable`, `saleType` — envoyés par le formulaire (ProductsPage.tsx:780-786) — sont silencieusement perdus. Un produit créé « vente du jour, DLV 3 j, DDE 24 h » est sauvé avec `shelf_life_days = NULL` : ses lots ne seront jamais marqués expirés, le POS le laissera vendable indéfiniment. Il faut rouvrir la fiche et re-sauver pour que l'update (qui, lui, mappe tout) rattrape.
→ **Reco** : faire porter au `create` le même mapping que l'update (ou INSERT minimal puis `productRepository.update` dans la même transaction).

**B3. Aucun `asyncHandler` sur `products.routes.ts` (0 occurrence) ni `product-loss.routes.ts`** — fichiers entiers
14 autres fichiers de routes l'utilisent (dont `product-lot.routes.ts` et `product-pipeline.routes.ts`). Express 4 ne rattrape pas les promesses rejetées : `GET /products/abc` (22P02), création avec nom en doublon (slug UNIQUE, 23505), `price` absent (23502), catégorie inexistante (23503)… = requête suspendue jusqu'au 504 Cloud Run, jamais transmise à `errorHandler`.
→ **Reco** : envelopper tous les handlers + valider les params `:id` en UUID (400 propre au lieu d'une erreur PG).

### MAJEUR

**B4. Piège d'inférence `integer` sur `GREATEST(0 + $3, 0)`** — `product-stock.helper.ts:21-23` et `:105-113`
Piège déjà rencontré dans le projet (cf. mémo « GREATEST($N,0) param non typé ») : dans `INSERT … VALUES ($1,$2,GREATEST(0 + $3,0)) ON CONFLICT …`, l'expression `0 + $3` fait inférer `$3` en `integer` pour **tout le statement**. Toute quantité décimale — produits au poids, colonnes `DECIMAL(12,2)` — échoue avec `invalid input syntax for type integer: "2.5"`. Concerne `adjustProductStock` **et** `adjustVitrineStock`, donc l'ajustement manuel, les pertes et la vente POS au poids.
→ **Reco** : caster `$3::numeric` dans les deux branches (VALUES et DO UPDATE) des deux fonctions.

**B5. Aucune validation d'entrée sur create/update/adjustStock** — `product.controller.ts:166-211, 290-320`
Pas de `product.validator.ts`. Conséquences vérifiées : `name` absent → crash `slugify` (`.toLowerCase` d'undefined) ; `price` absent → 23502 ; surtout `adjustStock` fait `parseFloat(quantity)` sans test : `quantity: "abc"` → `NaN` → sur la voie sans storeId (`stock_quantity + $1`, type numeric), **PG accepte `NaN`** → `products.stock_quantity = NaN` de façon permanente (et `GREATEST(NaN,0) = NaN` en PG, le clamp ne protège pas). Le champ `type` de la transaction de stock est du texte libre non contrôlé.
→ **Reco** : créer `product.validator.ts` sur le modèle de `product-loss.validator.ts` (zod + `z.coerce.number().finite()`, enum sur `type`, bornes métier) et brancher `validate()` sur POST/PUT/`/stock`.

**B6. `PUT /products/:id` permet de modifier le stock sans trace** — `product.repository.ts:212-213`
Le mapping d'update expose `stockQuantity`/`stockMinThreshold` : un PUT écrit directement `products.stock_quantity` (le stock **global**, pas celui du magasin) sans passer par `product_stock_transactions`. Double problème : contournement du journal (traçabilité exigée par vos audits — analogie : UPDATE direct du solde d'un compte sans écriture au journal) et incohérence avec le modèle multi-magasin (`product_store_stock`).
→ **Reco** : retirer `stockQuantity` du mapping ; seul `POST /:id/stock` (ledgé) doit bouger le stock.

**B7. Upload d'image : pas de contrôle de rôle + stockage éphémère** — `products.routes.ts:35` + `app.ts:147` + `.dockerignore:15`
(a) La route `POST /:id/image` n'a pas d'`authorize` : n'importe quel utilisateur authentifié (caissière, livreur…) peut remplacer l'image de n'importe quel produit, alors que create/update exigent ADMIN_MANAGER. (b) Les fichiers vont sur le FS local, or `uploads/` est dans `.dockerignore` et Cloud Run a un FS éphémère : **toutes les images produits disparaissent à chaque redéploiement** (précédent connu : le logo, corrigé en data URI). (c) Filtre par extension seulement, rejet silencieux (`cb(null,false)` → 400 « Aucune image fournie », trompeur) ; `LIMIT_FILE_SIZE` → 500 au lieu de 413.
→ **Reco** : ajouter `authorize(...ROLE_GROUPS.ADMIN_MANAGER)` ; stocker durablement (GCS, ou data URI en base comme le logo si volumes modestes) ; vérifier le MIME réel et mapper les erreurs multer.

### MINEUR

- **B8.** `update` du controller : le lien recette est commité dans une transaction séparée de l'update produit (`product.controller.ts:227-264`) → état partiel possible si la 2e étape échoue.
- **B9.** `remove` : détection FK par `msg.includes('foreign key')` (`product.controller.ts:272`) — utiliser `err.code === '23503'`. Vu B1, ce catch arrive de toute façon trop tard.
- **B10.** `list` : `page`/`limit` non bornés ni validés (`limit=100000` accepté ; `page=abc` → offset NaN → erreur PG → hang vu B3). Recherche `ILIKE '%…%'` sans index trigram.
- **B11.** `findTopSelling` (`product.repository.ts:88-172`) : ne déduit pas les retours (`sale_return_items`) ; et pour les produits au poids, `SUM(si.quantity)` mélange des kg et des unités dans le même classement.
- **B12.** Sémantique DLV incohérente : `expires_at > CURRENT_DATE` (produit invendable **le jour même** de sa DLV) vs `display_expires_at > NOW()` ; et le cast `expires_at::timestamptz` dans `effective_deadline` dépend du fuseau du serveur. À trancher métier (DLV inclusive ?) et centraliser.
- **B13.** `maybeAutoExpire` (`product.controller.ts:14-28`) : le timestamp de debounce est posé avant l'exécution — un échec bloque le retry 60 s ; le job est global mais débouncé par store (nom trompeur).
- **B14.** `replacePricingTiers`/`replaceChannelPricing` (`product.controller.ts:46-79`) : les lignes invalides sont ignorées en silence (l'utilisateur croit avoir tout enregistré) ; pas de contrôle de chevauchement des paliers ; `channel_id` non-UUID → 22P02 → hang (B3).

---

## 2. Lots, pertes, pipeline (backend)

### CRITIQUE

**L1. `product-loss.routes.ts` sans `asyncHandler`** (fusionné avec B3) — toute erreur DB dans list/create/remove/stats → requête suspendue.

**L2. Types de perte `casse` et `non_vendu` inutilisables** — `product-loss.validator.ts:18` vs mig `068:3-5`
Le zod accepte 6 valeurs, la contrainte CHECK `product_losses_loss_type_check` n'en autorise que 4 (`production`, `vitrine`, `perime`, `recyclage`). POST avec `lossType:'casse'` → passe la validation, viole la CHECK (23514) → ROLLBACK → hang (L1). La branche de décrément du stock (`product-loss.controller.ts:87`) ne couvre pas non plus ces deux types, contrairement à ce que dit son commentaire.
→ **Reco** : aligner enum zod ↔ CHECK ↔ branche de décrément (décider si casse/non_vendu existent, sinon les retirer du zod et du client).

### MAJEUR

**L3. Les pertes manuelles ne consomment pas les lots** — `product-loss.controller.ts:87-98`
La déclaration décrémente `product_store_stock.vitrine_quantity` mais jamais `product_lots` (le flux invendus, lui, consomme en FEFO). Scénario chiffré : lot de 10, perte manuelle de 5 (store passe à 5, lot reste à 10) ; à l'expiration, `autoExpireDueLots` jette les 10 du lot et insère une 2e perte de 10 → **15 unités de perte comptabilisées pour 10 produites**, valorisation des pertes gonflée.
→ **Reco** : consommer les lots en FEFO (`planFefoVitrineConsumption` + `consumeVitrineWaste`) dans la même transaction que la perte.

**L4.** (= B4, s'applique aux pertes : `quantity: 2.5` autorisé par le zod → erreur d'inférence integer.)

**L5. Le pipeline permet de contourner la validation admin** — `product-pipeline.repository.ts:215-218, 440-442` + `routes:28-34`
`advanceStage('admin_validation')` passe en `catalog_integration` sans exiger d'`admin_decision` (le `case` de validation est vide), et les routes decision/integrate sont ouvertes à ADMIN_MANAGER malgré le commentaire « admin only ».
→ **Reco** : refuser l'avancement depuis `admin_validation` (forcer le passage par `adminDecision`) et restreindre au rôle ADMIN si c'est l'intention.

**L6. `integrateCatalog` sans transaction ni verrou** — `product-pipeline.repository.ts:292-339`
4 écritures (INSERT produit, UPDATE recette, UPDATE pipeline, historique) sans BEGIN/COMMIT, check de doublon en lecture non verrouillée, slug suffixé `Date.now()` qui neutralise la contrainte UNIQUE → double-clic ou échec partiel = produits en doublon / orphelins.
→ **Reco** : transaction + `UPDATE product_pipeline … WHERE current_stage='catalog_integration' AND product_id IS NULL RETURNING` comme gate atomique.

**L7. Suppression d'une perte sans reversement du stock** — `product-loss.controller.ts:114-117`
DELETE physique de la ligne `product_losses` alors que la vitrine a été décrémentée et la transaction de stock tracée → stock faux, journal orphelin.
→ **Reco** : re-créditer le stock dans une transaction, ou soft-delete + écriture compensatoire.

### MINEUR

- **L8.** DLC et numéro de lot calculés en **date UTC** (`toISOString().slice(0,10)`, `product-lot.repository.ts:60,76`) : fournée validée le 15/07 à 00:30 Casablanca → lot daté du 14/07, DLC **un jour trop tôt**. Utiliser `getLocalISODate()` (existe déjà dans `utils/timezone.ts`).
- **L9.** Notes de dégustation contournables (`product-pipeline.repository.ts:430-437`) : scores non numériques → `NaN < 7` = false → seuil validé ; un score de 0 est rejeté comme « manquant ». Valider en zod (plage 1-10, `Number.isFinite`).
- **L10.** `stats` pertes : bucket journalier en `DATE(pl.created_at)` (UTC) mais filtre mois/année en fuseau local → pertes de fin de mois bucketées sur le mois précédent. `DATE(pl.created_at AT TIME ZONE '<tz>')`.
- **L11.** `GET /product-losses` sans pagination ni filtre par défaut : tout l'historique à chaque appel.
- **L12.** `stock_after` codé en dur à 0 dans les transactions d'expiration de lots (`product-lot.repository.ts:568-575, 755-762`) alors que d'autres lots peuvent rester : la colonne d'audit ment.
- **L13.** Motifs `damaged`/`quarantine_failed` réécrits en `perime` en base → les stats de pertes attribuent la casse au périmé ; la CHECK 107 accepte pourtant `casse`/`qualite_non_conforme`.
- **L14.** Pipeline et lots : aucune validation zod sur les mutations (name non borné, limit/offset non clampés, `:id` non UUID → message PG brut).
- **L15.** `autoExpireDueLots` : `FOR UPDATE` sur la jointure verrouille aussi `products` (contention) — préférer `FOR UPDATE OF pl` ; re-dérivation JS de la DLC fragile selon le fuseau serveur, le booléen SQL suffit.
- **L16.** `advanceStage`/`updateStageData` : lecture puis UPDATE sans condition `WHERE current_stage=…` → deux requêtes concurrentes peuvent se croiser (advance vs rejet admin). Gate d'état non atomique.

---

## 3. Frontend (client)

### CRITIQUE

**C1.** (= B2 côté client) Le formulaire envoie les champs Production/Cycle de vie à la création, le serveur les ignore. Aussi dans l'autre sens : `saleUnit`/`pricePerKg` sont acceptés par le serveur mais jamais envoyés — **impossible de créer un produit au poids via l'UI**.

**C2. Ouvrir puis enregistrer les paliers tarifaires peut tout effacer** — `ProductsPage.tsx:1305-1329`
`const { data: existingTiers = [] } = useQuery(…)` + verrou `initialized` : au premier montage, le défaut `[]` (truthy) initialise `rows` à vide **avant** la résolution de la requête, puis verrouille. Les paliers existants ne s'affichent pas (bug intermittent : cache chaud = OK) ; « Enregistrer les paliers » envoie `[]` → `replaceForProduct` **supprime tous les paliers en base**.
→ **Reco** : initialiser sur `isSuccess`/`isFetched`, jamais depuis la valeur par défaut.

**C3. Même pattern sur les prix par canal** — `ProductsPage.tsx:1461-1473`
L'init attend `channels.length > 0` mais pas la résolution des overrides → mêmes conséquences : overrides invisibles puis effacés à l'enregistrement.

### MAJEUR

- **C4.** Prix auto-calculé : recette à coût 0/NULL → `parseFloat('')` = NaN → `price: null` → 23502 → 500 générique à la création (`ProductsPage.tsx:620-633, 777`). Valider `price` fini et > 0 avant `onSave`.
- **C5.** Détachement de recette impossible : le client n'envoie `recipeId` que s'il est truthy (`:787`), la branche serveur « détacher » (`product.controller.ts:249-252`) est du code mort. Cliquer le X puis sauver = aucun effet, sans erreur.
- **C6.** Toute édition recalcule et écrase silencieusement `price`/`costPrice` depuis la recette (marge fallback ×3) — même pour corriger une description, le prix POS peut bouger sans signal (`:593-633`, champ readOnly). Ne recalculer que sur changement explicite de recette + afficher le diff.
- **C7.** `saveMutation` enchaîne create → uploadImage → profile sans compensation : si l'upload échoue, la modale reste en mode création → re-soumission → « Cette recette est deja liee a un autre produit », produit n°1 créé sans photo (`:129-143`). Basculer en mode édition après create réussi.

### MINEUR

- **C8.** `toggleMutation` sans `onError` ni `disabled` pendant la mutation (`:121-127`).
- **C9.** Recherche non debouncée dans la query key + `limit: '500'` sans pager : au-delà de 500 produits, liste et stats silencieusement tronquées alors que le serveur renvoie `total` (`:105-108, 165`).
- **C10.** `Enter` dans la recherche de recette soumet tout le formulaire si aucun résultat (`:661-676`) — `preventDefault` systématique dropdown ouvert.
- **C11.** Vue kanban : badge Rupture calculé sur `stock_quantity` (total) mais chiffre affiché = `backroom_quantity` (`:306-311` vs `:372-376`) — harmoniser avec la vue table.
- **C12.** `categoryId` fallback en dur sur `1` si les catégories ne sont pas chargées (`:555`) → FK 23503 possible.
- **C13.** **Code mort avec bugs latents** : `ProductionProfileTab.tsx` (417 lignes) n'est rendu nulle part ; toute la plomberie `pendingProfile` de ProductsPage est morte (`setPendingProfile` jamais appelé). S'il est réactivé tel quel : boucle infinie possible (`onChange(buildFormData())`), `etapes_surcharges` toujours écrasé à `[]`, `notes` jamais réhydraté. Supprimer ou finir le câblage.
- **C14.** `ProductsPage.tsx` = 1 548 lignes : extraire `CatalogueTab` (89-536), `ProductFormModal` (544-1298), `PricingTiersPanel`, `ChannelPricingPanel`, hook `useCameraCapture` (705-758) ; `SortHeader` dupliqué à l'identique dans `SemiFinisTab.tsx:49-64`.
- **C15.** `ExpiredProductLotsBanner` : après envoi aux pertes, n'invalide pas les queries du module Pertes (`['product-losses']`, stats).

---

## 4. Plan d'action proposé

**Lot 1 — stopper les pertes de données (1-2 jours)**
1. B1 : bloquer le DELETE destructif (soft-delete, retirer les DELETE sur `sale_items`/`sale_return_items`).
2. B2/C1 : création complète (mapping identique à l'update) + permettre `saleUnit`/`pricePerKg` à la création.
3. C2/C3 : corriger l'init des deux panneaux tarifaires (`isSuccess`).
4. B3/L1 : `asyncHandler` sur `products.routes.ts` et `product-loss.routes.ts` + validation UUID des params.
5. L2 : réaligner enum zod ↔ CHECK des pertes.

**Lot 2 — fiabiliser le stock (2-3 jours)**
6. B4/L4 : casts `::numeric` dans `product-stock.helper.ts`.
7. B5 : `product.validator.ts` (zod) sur create/update/adjustStock — rejeter NaN.
8. B6 : retirer `stockQuantity` du mapping d'update (tout passe par le ledger).
9. L3 : consommation FEFO des lots dans les pertes manuelles.
10. L7 : reversement de stock à la suppression d'une perte.

**Lot 3 — sécurité et intégrité des flux (1-2 jours)**
11. B7 : `authorize` sur l'upload d'image + stockage durable (GCS ou data URI).
12. L5/L6/L16 : gates atomiques du pipeline + transaction sur `integrateCatalog` + rôles admin.
13. A6 : garde-fou sur `POS_ALLOW_NEGATIVE_STOCK` (refuser le démarrage en `NODE_ENV=production` avec le flag actif, ou log d'alerte au boot).

**Lot 4 — qualité et dette (au fil de l'eau)**
14. Fuseaux horaires : L8/L10/L15/B12 (une seule convention, `Africa/Casablanca`, via `utils/timezone.ts`).
15. C6 : recalcul de prix uniquement sur changement de recette + affichage du diff.
16. C13/C14 : purge du code mort + découpage de ProductsPage.
17. B10/B11/C9/L11 : pagination bornée partout, retours déduits du top ventes.

---

## Points forts

1. **`product-lot.repository.ts` est le meilleur code du module** : transactions systématiques, `SELECT … FOR UPDATE`, idempotence (statuts déjà traités), trigger d'invariant comptable (mig 106) qui garantit `somme des qty ≤ quantity_total` côté base.
2. **`productRepository.update` whitelist ses colonnes** (mapping explicite camelCase→snake_case) — pas d'injection d'identifiants possible ; SQL 100 % paramétré partout, fuseau interpolé protégé par whitelist stricte (`timezone.ts`).
3. **`product-loss.validator.ts` est un bon modèle zod** (coercition, bornes métier, UUID stricts) — à décliner sur products, lots et pipeline.
4. Côté client : invalidations React Query croisées et commentées (`['recipes']` après save produit, `['products']` après envoi aux pertes), anti-double-submit sur les chemins destructifs, et `SemiFinisTab` bien architecturé (chargement paresseux, parsing défensif des numerics PG).

# Existant — Demandes d'achat, ruptures, besoins (D2, D3)

Lecteur : « demandes-achat-et-ruptures ». Audit du 2026-10-11 sur le dépôt `/Users/anissbouida/projets/Ofauria-app` (branche `main`, HEAD `cb91fc3`) et la base locale (copie récente de la prod, lecture seule).

Tous les chemins sont relatifs à la racine du dépôt. Les numéros de ligne correspondent au working tree au moment de la lecture.

---

## 1. Résumé exécutif

Le sous-module « demandes d'achat » (DA, table `purchase_requests`) est une **liste d'attente mono-table** : une ligne = un ingrédient + une quantité + un fournisseur optionnel. Il n'y a ni en-tête de demande, ni numérotation, ni priorité, ni date de besoin, ni approbation, ni demande de prix. Une DA est créée **uniquement à la main** (4 boutons côté client, aucun automatisme serveur), puis un admin/manager la regroupe par fournisseur et génère un BC en un clic (`POST /purchase-requests/generate-po`). La clôture (`received`, mig 271) est pilotée par le statut du BC, pas par la ligne livrée.

Chiffres clés (base locale) :
- 31 DA au total, **toutes en `received`** ; 0 `pending`, 0 `cancelled`, le statut `ordered` n'est posé nulle part dans le code.
- 29 DA sur 31 ont pour motif `production` (rupture signalée depuis un BSI), 2 `manual`.
- 9 BC générés depuis des DA sur 304 BC (3 %). Les 295 autres BC sont créés directement sans DA.
- Délai DA → BC → réception = **0 jour sur les 31 DA** : la DA est saisie le jour même de l'achat et de la réception, c'est une régularisation a posteriori, pas une planification.
- Quantités demandées = besoin théorique brut du BSI (0,0035 kg de poudre, 0,0272 kg de jaune d'oeuf…) : 17 DA sur 31 portent moins de 0,5 kg, et génèrent des lignes de BC à 0,0035 kg « livrées » 5 kg.
- Seuils de stock : `inventory.minimum_threshold` existe depuis la mig 006, **0 ligne sur 377 a un seuil > 0** : l'alerte « stock bas » et le motif `stock_bas` sont inertes.
- Aucune notification de type DA/rupture dans la table `notifications` (20 types observés, aucun lié aux achats).

Les 5 problèmes dominants :
1. **Aucun MRP / aucune suggestion de réappro** : ni seuil renseigné, ni point de commande, ni consommation moyenne, ni projection depuis les plans de production. La DA naît d'un clic humain sur une rupture déjà constatée (D2).
2. **Drapeau `already_ordered` par ingrédient, pas par ligne** : une DA ouverte pour 5 kg bloque la commande des 10 kg du BSI suivant (sous-commande silencieuse), et une DA orpheline (BC annulé ou supprimé) bloque l'ingrédient à vie (D2/D10).
3. **Pas de circuit d'approbation, pas de budget, pas de demande de prix** : D3 est absent à 100 %. Le prix du BC généré = `ingredients.unit_cost` (dernier coût connu), 27 ingrédients sans coût.
4. **Consommables exclus** : `purchase_requests.ingredient_id NOT NULL`, pas de `packaging_id` ; les lignes emballage en rupture d'un BSI sont filtrées de l'écran « Ingrédients à commander » (D2).
5. **Bug d'intégrité dans `generatePurchaseOrder`** : le `UPDATE … SET status='assigned'` marque tous les `requestIds` reçus sans refiltrer `status='pending' AND supplier_id=$2` comme le `SELECT` ; une DA d'un autre fournisseur ou déjà annulée peut être rattachée à un BC qui ne la contient pas (D4/D10).

---

## 2. Périmètre et fichiers lus

| Couche | Fichier | Lignes | Rôle |
|---|---|---|---|
| Migration | `server/migrations/057_purchase_requests.sql` | 1-23 | Table `purchase_requests`, CHECK reason/status, index |
| Migration | `server/migrations/271_purchase_request_received.sql` | 1-52 | Ajout statut `received`, backfill |
| Routes | `server/src/routes/purchase-request.routes.ts` | 1-23 | 9 endpoints |
| Contrôleur | `server/src/controllers/purchase-request.controller.ts` | 1-107 | Validation manuelle minimale, pas de zod |
| Repository | `server/src/repositories/purchase-request.repository.ts` | 1-263 | CRUD + `generatePurchaseOrder` |
| Helper | `server/src/repositories/purchase-request.helper.ts` | 1-48 | `closePurchaseRequestsForOrder` |
| Service | `server/src/services/container-rule.ts` | 1-89 | Arrondi au contenant entier |
| Repository | `server/src/repositories/bon-sortie.repository.ts` | 246-257, 519-545, 746-794, 796-860 | `already_ordered`, lignes `rupture`, vue « Ingrédients à commander » |
| Repository | `server/src/repositories/purchase-order.repository.ts` | 100-178, 240-275, 455-499, 545-547 | Numérotation, create, updateStatus, resync, delete |
| Repository | `server/src/repositories/reception-voucher.repository.ts` | 505-545, 586-611, 749 | Clôture DA à la réception ; annulation réception |
| Contrôleur | `server/src/controllers/purchase-order.controller.ts` | 104-150 | cancel / remove BC (aucun effet sur DA) |
| Contrôleur | `server/src/controllers/production.controller.ts` | 560-612 | `requestStockVerification` (notification, pas DA) |
| Repository | `server/src/repositories/production.repository.ts` | 150-175 | `available_quantity` des besoins plan (stock physique seul) |
| Client API | `client/src/api/purchase-requests.api.ts` | 1-33 | 9 fonctions, 3 jamais appelées |
| Client | `client/src/features/purchasing/PurchaseRequestsPage.tsx` | 1-597 | Onglet « Liste d'attente » (Achats) |
| Client | `client/src/features/purchasing/PurchasingPage.tsx` | 55-100 | Onglets Achats |
| Client | `client/src/features/warehouse/RuptureRequestsList.tsx` | 1-184 | Onglet « Ingrédients à commander » (Économat) |
| Client | `client/src/features/warehouse/TransferRequestsList.tsx` | 79-102, 259 | « Commander le manquant » depuis les transferts |
| Client | `client/src/features/production/BonSortiePanel.tsx` | 208-226, 518, 599-600 | « Commander » depuis une ligne manquante au pesage |
| Client | `client/src/features/inventory/IngredientDetailPage.tsx` | 278-294, 310, 320, 693-704, 776-892 | Modal « Demande d'achat » sur fiche ingrédient |
| Client | `client/src/features/inventory/InventoryPage.tsx` | 40, 75, 110-123, 352-353, 388-390 | Onglet `ruptures` + badge |
| Client | `client/src/features/production/PlanDetailPage.tsx` | 586-665, 1840-1845 | Besoins plan → « Demander vérification » |
| Client | `client/src/utils/container.ts` | 1-28 | Miroir client de la règle contenant |
| Shared | `shared/src/constants/roles.ts` | 21-37 | `ROLE_GROUPS.ADMIN_MANAGER`, `WAREHOUSE` |
| Docs | `docs/PROCESSUS_PESAGE_ECONOMAT.md` | 31, 50 | Mention « Commander (demande d'achat) » |
| Docs | `docs/AUDIT_FONCTIONNEL.md` | 86, 115, 187 | Audit antérieur : 2 écrans même API, pas de `packaging_id`, `ordered` inutilisé |

---

## 3. Modèle de données

### 3.1 `purchase_requests` (mig 057 + 271)

```
\d+ purchase_requests
 id                | uuid          | not null | gen_random_uuid()
 ingredient_id     | uuid          | not null                      -- FK ingredients ON DELETE CASCADE
 supplier_id       | uuid          |                               -- FK suppliers ON DELETE SET NULL
 quantity          | numeric(12,4) | not null                      -- CHECK > 0
 unit              | varchar(20)   | not null                      -- texte libre, non validé vs ingredients.unit
 reason            | varchar(50)   | not null | 'manual'           -- CHECK IN (stock_bas, production, manual, replenishment)
 note              | text          |
 status            | varchar(20)   | not null | 'pending'          -- CHECK IN (pending, assigned, ordered, received, cancelled)
 purchase_order_id | uuid          |                               -- FK purchase_orders ON DELETE SET NULL
 requested_by      | uuid          |                               -- FK users
 store_id          | uuid          |                               -- FK stores
 created_at / updated_at timestamptz
Index : pkey, idx_pr_ingredient, idx_pr_status, idx_pr_store (partiel), idx_pr_supplier
```

Observations :
- **Pas de `packaging_id`** : les consommables (`packaging_items`, 109 lignes) ne peuvent pas faire l'objet d'une DA. `purchase_order_items` a pourtant `packaging_id` (colonnes : `id, purchase_order_id, ingredient_id, quantity_ordered, quantity_delivered, unit_price, created_at, packaging_id`).
- **Pas de lien vers la ligne BSI** (`production_bons_sortie_lignes.id`) ni vers le plan : le seul lien est la note texte (`BSI BSI-261008-001 — rupture totale signalee depuis Economat`).
- **Pas de** : numéro de DA, `needed_by`, priorité, `approved_by/at`, `cancelled_by`, `assigned_by`, `unit_price` cible, `quantity_ordered` (quantité réellement reprise au BC), `history`.
- `ON DELETE SET NULL` sur `purchase_order_id` : la suppression d'un BC (`purchase-order.repository.ts:545-547`, autorisée pour `en_attente`/`annule`) laisse la DA en `assigned` sans BC.
- `ON DELETE CASCADE` sur `ingredient_id` : supprimer un ingrédient efface silencieusement son historique de DA.
- Une seule migration appliquée (`_migrations` : `057_purchase_requests.sql`) ; `271_purchase_request_received.sql` est **absente de `_migrations`** mais son effet est présent (CHECK contient `received`, notes « Cloturee (mig 271) »). Idem pour 266-270 et 275 : environnement local appliqué à la main (cf. mémoire « migrate local cassé sur 266 »).

### 3.2 Tables liées (hors périmètre mais déterminantes)

| Table | Constat | Preuve |
|---|---|---|
| `inventory` | `minimum_threshold numeric NOT NULL DEFAULT 0` (mig 006:5) ; index partiel `idx_inventory_low_stock` | `SELECT COUNT(*) FILTER (WHERE minimum_threshold>0) FROM inventory` → **0 / 377** |
| `ingredients` | `supplier varchar` (texte libre, 137 renseignés), `supplier_id uuid` (**0 renseigné sur 405**), `supplier_reference`, `unit_cost` (27 nuls/0), `container_size`+`container_type_id` (11 définis) | requête §7 Q15 |
| `suppliers` | colonnes : `id, name, contact_name, phone, email, address, city, ice, notes, is_active, created_at` — **aucun délai de livraison, conditions de paiement, minimum de commande, jours de livraison** | `information_schema.columns` |
| `replenishment_requests` (mig 040) | Demandes de **réapprovisionnement boutique en produits finis** (DRA-YYYYMMDD-NNN, `product_id`), pas des achats. 0 ligne. Le motif DA `replenishment` n'est jamais produit par ce module. | `server/migrations/040_replenishment_requests.sql:1-25` ; `server/src/repositories/replenishment.repository.ts` ne référence jamais `purchase_requests` |
| Aucune table article-fournisseur | pas de `ingredient_suppliers`, `supplier_prices`, tarifs, conditionnements fournisseur | `grep -rln -i "ingredient_supplier\|supplier_price\|price_list\|tarif" server/migrations` → seulement des tables de prix de vente (171-173) |

---

## 4. API serveur

Montage : `server/src/routes/index.ts:90` → `router.use('/purchase-requests', purchaseRequestRoutes)`. Toutes les routes passent par `asyncHandler`. **Aucun validateur zod** (`ls server/src/validators` : pas de `purchase-request.validator.ts`).

| Méthode | Chemin | Rôles (`authorize`) | Handler | Appelé par le client | Notes |
|---|---|---|---|---|---|
| GET | `/purchase-requests` | ADMIN, MANAGER | `list` (ctrl:6) → `findAll` (repo:7-42) | oui — `PurchaseRequestsPage.tsx:78` (vue « Toutes ») | filtre `status`, `supplierId`, `requestedBy`, `storeId` du JWT ; pas de pagination |
| GET | `/purchase-requests/grouped` | ADMIN, MANAGER | `grouped` (ctrl:17) → `findGroupedBySupplier` (repo:45-84) | oui — `PurchaseRequestsPage.tsx:57` | seulement `pending`, `json_agg` par fournisseur, `estimated_total = SUM(qty × ing.unit_cost)` |
| GET | `/purchase-requests/count` | tout rôle authentifié | `count` (ctrl:103) → `countPending` (repo:254-262) | **non** (`grep purchaseRequestsApi.count client/src` → 0) | code mort ; aucun badge n'affiche le nombre de DA en attente |
| POST | `/purchase-requests` | **tout rôle authentifié** (route:16, pas d'`authorize`) | `create` (ctrl:22) → `create` (repo:87-115) | oui — 4 appelants : `RuptureRequestsList.tsx:34`, `TransferRequestsList.tsx:86`, `BonSortiePanel.tsx:210`, `IngredientDetailPage.tsx:280` | validation : `ingredientId`, `quantity>0`, `unit` ; `reason` non validé côté serveur (CHECK SQL → 500 si valeur hors liste) ; arrondi contenant (`applyContainerRule`) |
| PUT | `/purchase-requests/:id/quantity` | ADMIN, MANAGER | `updateQuantity` (ctrl:41) → repo:118-126 | **non** (`purchaseRequestsApi.updateQuantity` défini `api:18` jamais appelé) | code mort ; `WHERE status='pending'` |
| PUT | `/purchase-requests/:id/supplier` | ADMIN, MANAGER | `assignSupplier` (ctrl:55) → repo:129-135 | **non** (`api:20` jamais appelé) | code mort ; remplacé par le bulk |
| POST | `/purchase-requests/bulk-assign-supplier` | ADMIN, MANAGER | `bulkAssignSupplier` (ctrl:65) → repo:138-145 | oui — `PurchaseRequestsPage.tsx:67` | `WHERE id = ANY($2) AND status='pending'` |
| POST | `/purchase-requests/:id/cancel` | ADMIN, MANAGER | `cancel` (ctrl:75) → repo:148-159 | oui — `PurchaseRequestsPage.tsx:83` (sans confirmation UI, `:322`) | note concaténée `' | Annule: ' || $2` ; pas de `cancelled_by` |
| POST | `/purchase-requests/generate-po` | ADMIN, MANAGER | `generatePO` (ctrl:85) → `generatePurchaseOrder` (repo:162-251) | oui — `PurchaseRequestsPage.tsx:92` | transaction ; BC `en_attente` ; voir §5.3 |

Endpoints connexes (hors routeur DA mais dans le périmètre « ruptures ») :

| Méthode | Chemin | Rôles | Handler | Appelé | Notes |
|---|---|---|---|---|---|
| GET | `/bons-sortie/warehouse/rupture-requests` | ADMIN, MANAGER, MAGASINIER (`ROLE_GROUPS.WAREHOUSE`, `bon-sortie.routes.ts:27`) | `getRuptureRequests` → `findRuptureRequests` (`bon-sortie.repository.ts:746-794`) | oui — `RuptureRequestsList.tsx:27`, `InventoryPage.tsx:120` (badge) | lignes BSI `status='rupture'`, `ingredient_id IS NOT NULL` (emballages exclus :778), stock total < besoin |
| GET | `/bons-sortie/warehouse/transfer-requests` | WAREHOUSE (`:25`) | `findEconomatTransferRequests` (`:796-860`) | oui — `TransferRequestsList.tsx:47` | expose `already_ordered` (`:823-828`) |
| PUT | `/bons-sortie/:id/complete-pending` | WAREHOUSE (`:47`) | `completePending` | oui (« Actualiser le stock ») | ré-allocation **manuelle** après réappro ; rien d'automatique à la réception |
| POST | `/production/:id/needs/:ingredientId/request-verification` | PRODUCTION (`production.routes.ts:34`) | `requestStockVerification` (`production.controller.ts:561-612`) | oui — `PlanDetailPage.tsx:1845` | crée **2 notifications** (`magasinier`, `manager`) de type `stock_verification_requested` ; **ne crée pas de DA** |

Bilan : 9 endpoints DA, **3 jamais appelés** (`GET /count`, `PUT /:id/quantity`, `PUT /:id/supplier`).

---

## 5. Logique métier telle que codée

### 5.1 Qui crée une DA — 4 points d'entrée, tous manuels

Le seul `INSERT INTO purchase_requests` du serveur est dans `purchase-request.repository.ts:101`. Aucun automatisme (ni trigger, ni job, ni hook BSI/plan/seuil). `grep -rn "INSERT INTO purchase_requests" server/src server/migrations` → 1 résultat.

| # | Écran | Fichier:ligne | Qui | Quantité envoyée | `reason` | `supplier_id` | Note |
|---|---|---|---|---|---|---|---|
| 1 | Économat → onglet « Ingrédients à commander » (bouton « Commander ») | `RuptureRequestsList.tsx:32-50` | magasinier/admin/manager (`InventoryPage.tsx:75`) | `needed_quantity` de la ligne rupture (= portion non couverte, `bon-sortie.repository.ts:519-530`) | `production` | `null` | `BSI <numero> — rupture totale signalee depuis Economat` |
| 2 | Économat/Pesage → « Transferts demandés » (« Commander le manquant ») | `TransferRequestsList.tsx:84-102` | WAREHOUSE | `missing` = transfert requis − dispo économat | `production` | `null` | `BSI <numero> — manquant transfert economat` |
| 3 | Production → panneau BSI, ligne « Manquant » | `BonSortiePanel.tsx:209-226` | WAREHOUSE (pesage) | `max(0.001, needed − allocated)` | `production` | `null` | `Bon <numero> — manquant au pesage` |
| 4 | Fiche ingrédient → modal « Demande d'achat » | `IngredientDetailPage.tsx:278-294, 776-892` | tout rôle ayant la fiche | 1 contenant par défaut si contenant défini, sinon saisie libre | choix : `stock_bas` (défaut si `isLow`, `:796`) / `production` / `manual` / `replenishment` | select fournisseur, pré-rempli par **correspondance texte** `ingredients.supplier` ↔ `suppliers.name` (`:789-791`) | libre |

Points notables :
- Les 3 premiers créent une DA **sans fournisseur** → groupe « Sans fournisseur » dans la liste d'attente, l'admin doit attribuer avant de générer (`PurchaseRequestsPage.tsx:239-265`).
- Le serveur **n'utilise pas** `ingredients.supplier_id` ni `ingredients.supplier` pour pré-affecter (`create` repo:99-113 n'insère que `data.supplierId`). Le pré-remplissage texte côté fiche ne fonctionne que si le nom correspond exactement : **21 ingrédients sur 137** ayant un `supplier` texte matchent un `suppliers.name` (requête §7).
- `isLow` (`IngredientDetailPage.tsx:310`) = `threshold > 0 && qty <= threshold` ; comme aucun seuil n'est renseigné, `isLow` est toujours faux → le motif `stock_bas` n'est jamais proposé par défaut (0 DA `stock_bas` en base).
- Les points 1-3 utilisent un **état local** (`commandedLineIds`, `orderedLineIds`, `orderedIds`) pour masquer le bouton après clic, en plus de `already_ordered` serveur.
- Règle « contenant entier » appliquée à la création (`repo:99`) : 1 kg manquant en sacs de 2,5 kg → DA de 2,5 kg. Mais seuls **11 ingrédients sur 405** ont un contenant défini ; pour les 394 autres la DA reprend le besoin théorique brut (ex. 0,0035 kg).
- `POST /purchase-requests` est ouvert à **tout rôle authentifié** (`purchase-request.routes.ts:16`), y compris caissier/vendeuse.

### 5.2 Drapeau `already_ordered` (anti-doublon)

Trois requêtes identiques, toutes **par ingrédient et magasin**, jamais par ligne BSI :

```sql
-- bon-sortie.repository.ts:250-256 (loadBonLines), :765-770 (findRuptureRequests), :823-828 (findEconomatTransferRequests)
EXISTS (
  SELECT 1 FROM purchase_requests pr
   WHERE pr.ingredient_id = bsl.ingredient_id
     AND pr.status IN ('pending', 'assigned', 'ordered')
     AND (pr.store_id IS NULL OR pr.store_id = bs.store_id)
) AS already_ordered
```

Consommé par `RuptureRequestsList.tsx:138,161-164` (badge vert « Commandé », bouton masqué), `TransferRequestsList.tsx:259`, `BonSortiePanel.tsx:518`.

Conséquences :
- **Sous-commande** : BSI-A rupture 5 kg crème → DA 5 kg. BSI-B (même semaine) rupture 10 kg crème → la ligne affiche « Commandé », le bouton disparaît ; les 10 kg ne sont jamais demandés. Aucune agrégation des besoins par ingrédient n'est proposée.
- **Blocage à vie** si la DA ne sort jamais de `assigned` (BC annulé ou supprimé, voir §5.4). La mig 271 décrit exactement ce blocage historique (9 DA toutes en `assigned`, BSI-260817-001 bloqué).

### 5.3 Transformation DA → BC (`generatePurchaseOrder`, repo:162-251)

Flux :
1. `SELECT … FROM purchase_requests pr WHERE pr.id = ANY($1) AND pr.status='pending' AND pr.supplier_id=$2 FOR UPDATE` (`:176-183`). Si 0 ligne → erreur « Aucune demande en attente trouvee pour ce fournisseur ».
2. Numéro `BC-YYYY-NNNN` via `purchaseOrderRepository.generateOrderNumber(client)` (advisory lock, `purchase-order.repository.ts:100-123`).
3. `INSERT INTO purchase_orders (order_number, supplier_id, expected_delivery_date, notes, created_by, store_id)` (`:197-208`) → statut par défaut `en_attente`.
4. Fusion par ingrédient (`Map` `:212-223`) : quantités sommées, `quantityOverrides[requestId]` appliqué **avant** fusion, `unit_price = ingredients.unit_cost` (dernier coût connu, `:215`).
5. Une ligne `purchase_order_items` par ingrédient, arrondie au contenant (`:227-234`).
6. **`UPDATE purchase_requests SET status='assigned', purchase_order_id=$1 WHERE id = ANY($2)`** (`:237-241`) — **sans** `AND status='pending' AND supplier_id=$2`.

Bug d'intégrité (point 6) : si `requestIds` contient une DA d'un autre fournisseur, déjà `cancelled`, ou déjà `assigned` à un autre BC, elle est quand même basculée en `assigned` et rattachée à ce BC, **alors que le BC ne contient aucune ligne pour elle** (le `SELECT` l'a filtrée). Le client (`PurchaseRequestsPage.tsx:445-451`) n'envoie que les ids sélectionnés dans un groupe fournisseur, donc le cas nominal est sain ; mais toute course (DA annulée/réaffectée par un autre utilisateur entre l'affichage et la génération) ou tout appel API direct corrompt la DA et déclenche le blocage `already_ordered`.

Autres caractéristiques :
- **Regroupement** : oui, N DA → 1 BC, à condition d'un seul fournisseur (règle affichée `PurchaseRequestsPage.tsx:501`). Plusieurs DA du même ingrédient sont fusionnées en une ligne.
- **Pas de scission** : une DA ne peut pas être répartie sur 2 BC/fournisseurs ; une DA n'est pas partiellement convertible.
- Le BC généré **ne garde aucune trace lisible** de ses DA : ni `notes` auto, ni affichage dans le détail BC (`purchase-order.repository.ts` ne lit jamais `purchase_requests` ; `PurchaseOrdersTab.tsx` ne référence ni `waiting_list` ni `purchase-requests`). La traçabilité BC → DA → BSI n'existe qu'en base (`purchase_order_id`), et BSI → DA n'existe que dans la note texte.
- `expectedDeliveryDate` saisie à la main (`:439-448`), aucun délai fournisseur disponible pour le proposer (table `suppliers` sans lead time).
- Aucune vérification que `supplierId` est actif, ni que l'ingrédient a un prix.

### 5.4 Clôture et effets de bord BC → DA

`closePurchaseRequestsForOrder(client, poId, poStatus)` (`purchase-request.helper.ts:32-48`) :
```sql
UPDATE purchase_requests SET status='received', updated_at=NOW()
 WHERE purchase_order_id=$1 AND status IN ('assigned','ordered')
```
appelé seulement si `poStatus ∈ {livre_complet, en_attente_facturation}` (`PO_RECEIVED_STATUSES`, `:23`). Trois appelants :
- `reception-voucher.repository.ts:534` (réception via BR, flux normal) ;
- `purchase-order.repository.ts:489` (`replaceItems`, édition admin des lignes) ;
- `purchase-order.repository.ts:260` (passage `en_attente_facturation` → `livre_complet` à la saisie des prix).

| Événement BC | Effet sur les DA rattachées | Preuve |
|---|---|---|
| `livre_complet` / `en_attente_facturation` | → `received` (toutes, même si la ligne de cet ingrédient a été livrée 0) | helper:37-46 |
| `livre_partiel` | aucune (restent `assigned`) même si l'ingrédient de la DA est intégralement livré | helper:19-23 (choix volontaire) |
| `annule` (`purchase-order.controller.ts:111-120` → `updateStatus`) | **aucune** : DA reste `assigned` à un BC annulé → `already_ordered` vrai à vie, ingrédient jamais re-commandable | `updateStatus` repo:172-178 ne touche pas `purchase_requests` |
| `non_livre` (`markNotDelivered` ctrl:104-109) | **aucune** (idem) | idem |
| Suppression BC (`remove` ctrl:141-150 → `delete` repo:545-547, statuts `en_attente`/`annule`) | `purchase_order_id` → NULL (FK SET NULL), DA reste `assigned` **orpheline** | `\d purchase_requests` |
| Annulation de réception (`cancelForPurchaseOrder`, `reception-voucher.repository.ts:586-…`, BC repassé `envoye` `:749`) | **aucune** : DA reste `received` alors que la marchandise est ressortie du stock | grep `purchase_request` dans le fichier → seule occurrence `:534` |

En base locale aujourd'hui : 0 DA orpheline (Q10), mais la mig 271 documente que ce blocage s'est déjà produit en prod (9 DA, BSI bloqué).

### 5.5 Besoins du plan de production → achats

- `production_ingredient_needs` est calculé à la confirmation du plan ; `available_quantity` est recalculé à la lecture depuis `ingredient_lots` (pesage + économat actifs, `production.repository.ts:157-167`). **Aucune prise en compte des BC en cours (« en commande »)**, ni des réservations des autres plans, ni des DA ouvertes.
- Écran `PlanDetailPage.tsx:586-665` : colonnes Besoin / Dispo / Statut pour le magasinier, action unique « Demander vérification » (`setRestockNeed`, `:661`) → `POST /production/:id/needs/:ingredientId/request-verification` → **2 notifications** (`production.controller.ts:588-608`), **pas de DA**. 24 notifications `stock_verification_requested` en base : la demande repose sur l'humain qui va ensuite cliquer « Commander » ailleurs.
- La rupture est matérialisée à la **génération du BSI** (`bon-sortie.repository.ts:523-533` : ligne `status='rupture'`, `source_location='RUPTURE'`, note « 🚨 Rupture — manque X »). Pas de notification spécifique rupture (seule `bsi_generated` vers `magasinier`, `bon-sortie.controller.ts:94-103`).
- Après réception du BC, rien ne ré-alloue la ligne BSI : il faut cliquer « Actualiser le stock » (`PUT /bons-sortie/:id/complete-pending`), comme le dit le bandeau `RuptureRequestsList.tsx:109`.
- Lignes **emballage** en rupture (créées `bon-sortie.repository.ts:581-599`) : exclues de « Ingrédients à commander » (`:778 AND bsl.ingredient_id IS NOT NULL`) et impossibles à transformer en DA (pas de `packaging_id`).

### 5.6 Seuils, point de commande, MRP

| Capacité ERP | État | Preuve |
|---|---|---|
| Seuil mini par ingrédient | colonne existe, **jamais renseignée** (0/377) ; endpoint `PUT /inventory/threshold` (ADMIN_MANAGER, `inventory.routes.ts:16`) | Q14 |
| Alerte stock bas | `GET /inventory/alerts` (`inventory.repository.ts:65-76`) ; `inventoryApi.alerts` défini (`inventory.api.ts:5`) mais **aucun écran ne l'appelle** ; compteur `lowStockCount` du dashboard (`reports.controller.ts:102-104`) toujours 0 | grep client |
| Point de commande / stock de sécurité / quantité économique | inexistant | grep `reorder|safety_stock|point_de_commande` → 0 |
| Suggestion basée sur la consommation | `GET /inventory/consumption` existe (stats) mais ne produit aucune proposition de DA | `inventory.routes.ts:19` |
| Suggestion basée sur le plan de production | non ; les besoins plan ne créent pas de DA, et ne tiennent pas compte des BC en cours | §5.5 |
| Création automatique de DA | **aucune** (1 seul INSERT, côté contrôleur) | grep |
| Délai fournisseur / date de besoin | absents (`suppliers` sans lead time, `purchase_requests` sans `needed_by`) | schémas |

### 5.7 Approbation, sourcing, budget (D3)

Rien : pas de statut `approved`, pas de table d'approbation, pas de demande de prix/comparatif, pas de budget. Le passage `pending → assigned` est fait directement par ADMIN/MANAGER via « Générer le BC ». Un `magasinier` peut créer une DA mais ne voit pas la liste d'attente (routes `GET /` et `/grouped` réservées ADMIN_MANAGER ; onglet « Liste d'attente » dans `PurchasingPage`, module `purchasing`).

---

## 6. Machine à états telle que codée

```
                 create (POST /purchase-requests, tout rôle)
                 reason ∈ {stock_bas, production, manual, replenishment}
                            │
                            ▼
                      ┌──────────┐  PUT /:id/quantity, PUT /:id/supplier, POST /bulk-assign-supplier
                      │ pending  │◄─────────────── (modifs autorisées uniquement ici, WHERE status='pending')
                      └──────────┘
                        │       │
   POST /:id/cancel     │       │  POST /generate-po (ADMIN_MANAGER)
   (ADMIN_MANAGER)      │       │  SELECT … status='pending' AND supplier_id=$2 FOR UPDATE
                        ▼       │  UPDATE … WHERE id = ANY($2)   ← sans refiltre (bug)
                 ┌───────────┐  ▼
                 │ cancelled │ ┌──────────┐
                 └───────────┘ │ assigned │  (purchase_order_id posé ; BC en 'en_attente')
                               └──────────┘
                                    │
                                    │ closePurchaseRequestsForOrder quand BC ∈ {livre_complet, en_attente_facturation}
                                    │ (reception-voucher:534, purchase-order:260, :489)
                                    ▼
                               ┌──────────┐
                               │ received │  terminal (mig 271)
                               └──────────┘

   ordered : présent dans le CHECK et dans tous les IN (...), jamais écrit (grep "'ordered'" hors IN → 0).
   Transitions absentes : assigned → pending (BC annulé/supprimé), received → assigned (réception annulée),
                          pending → approved/rejected, assigned → partially_received.
```

Statuts du BC qui n'ont aucun effet : `envoye`, `livre_partiel`, `non_livre`, `annule`.

---

## 7. Analyse des données (base locale, lecture seule)

Script : `scratchpad/achats/da_funnel.sql`, résultat brut : `scratchpad/achats/da_funnel_result.txt`.

**Q1 — statuts**
```sql
SELECT status, COUNT(*) FROM purchase_requests GROUP BY 1;
-- received | 31
```

**Q2/Q3 — motifs**
```sql
SELECT reason, COUNT(*) FROM purchase_requests GROUP BY 1;
-- production | 29 ; manual | 2   (0 stock_bas, 0 replenishment)
```

**Q4 — complétude**
```sql
SELECT COUNT(*) FILTER (WHERE supplier_id IS NULL), COUNT(*) FILTER (WHERE store_id IS NULL),
       COUNT(*) FILTER (WHERE purchase_order_id IS NULL), COUNT(*) FILTER (WHERE requested_by IS NULL) FROM purchase_requests;
-- 0 | 0 | 0 | 0
```

**Q5 — demandeurs**
```sql
SELECT u.role, COUNT(*) FROM purchase_requests pr LEFT JOIN users u ON u.id=pr.requested_by GROUP BY 1;
-- manager | 16 ; admin | 15     (aucune DA créée par un magasinier)
```

**Q6 — chronologie** : 2026-08 → 12 DA ; 2026-10 → 19 DA. Rien en septembre.

**Q7 — regroupement DA → BC**
```
order_number | po_status     | nb_da | nb_ing | first_da   | order_date | delivery_date
BC-2026-0297 | livre_complet | 5     | 5      | 2026-08-17 | 2026-08-17 | 2026-08-17
BC-2026-0298 | livre_complet | 4     | 4      | 2026-08-17 | 2026-08-17 | 2026-08-17
BC-2026-0299 | livre_complet | 2     | 2      | 2026-08-18 | 2026-08-18 | 2026-08-18
BC-2026-0300 | livre_complet | 1     | 1      | 2026-08-18 | 2026-08-18 | 2026-08-18
BC-2026-0301 | livre_complet | 5     | 5      | 2026-10-03 | 2026-10-03 | 2026-10-03
BC-2026-0302 | livre_complet | 6     | 6      | 2026-10-09 | 2026-10-09 | 2026-10-09
BC-2026-0303 | livre_complet | 6     | 6      | 2026-10-09 | 2026-10-09 | 2026-10-09
BC-2026-0304 | livre_complet | 1     | 1      | 2026-10-09 | 2026-10-09 | 2026-10-09
BC-2026-0305 | livre_complet | 1     | 1      | 2026-10-09 | 2026-10-09 | 2026-10-09
```
Regroupement effectif : 31 DA → 9 BC (moyenne 3,4 lignes/BC).

**Q8 — délais** : `(po.order_date − pr.created_at::date)` = 0 et `(po.delivery_date − po.order_date)` = 0 pour **les 31 DA**. La chaîne DA → BC → BR est saisie en bloc le même jour : usage de régularisation, pas d'anticipation.

**Q8 bis — quantités** (extrait) :
```
Prép. poudre crème pâtissière MAB   0.0035 kg   (DA)  → BC 0.0035 → livré 5.0000
Oeufs Jaune                          0.0272 kg
Purée de griotte                     0.0321 kg
Crème fraîche                        0.0657 kg
Sucre semoule                        0.1791 kg   → BC 50.0000 (override manuel)
```
17 DA / 31 < 0,5 kg. Les quantités sont le besoin théorique résiduel du BSI, pas une quantité d'achat.

**Q12 — DA vs BC vs livré** : 24 DA sur 31 ont `bc_qty = da_qty` ; 7 ont été relevées à la génération (`quantityOverrides`) : 0,45→1 ; 0,0768→1 ; 0,3743→1 ; 0,15→1 ; 0,7332→1 ; 0,275→1 ; 0,1791→50. Côté réception, 5 lignes du BC-0297 livrées au-dessus du commandé (ex. 1,5593 commandé / 5 livré). `unit_price` renseigné partout (repris de `ingredients.unit_cost`).

**Q13 — part des BC issus de DA**
```sql
SELECT COUNT(DISTINCT purchase_order_id) FROM purchase_requests WHERE purchase_order_id IS NOT NULL; -- 9
SELECT COUNT(*) FROM purchase_orders; -- 304
```
→ 3 % des BC passent par la liste d'attente.

**Q9/Q10/Q11 — DA ouvertes, orphelines, doublons** : 0, 0, 0 (après la clôture mig 271).

**Q14 — seuils**
```sql
SELECT COUNT(*), COUNT(*) FILTER (WHERE minimum_threshold>0), COUNT(*) FILTER (WHERE minimum_threshold>0 AND current_quantity<=minimum_threshold) FROM inventory;
-- 377 | 0 | 0
```

**Q15 — référentiel ingrédient utile aux achats**
```sql
SELECT COUNT(*) total, COUNT(supplier_id), COUNT(*) FILTER (WHERE supplier<>''), COUNT(*) FILTER (WHERE container_type_id IS NOT NULL AND container_size>0), COUNT(*) FILTER (WHERE unit_cost IS NULL OR unit_cost=0) FROM ingredients;
-- 405 | 0 | 137 | 11 | 27
SELECT COUNT(*) FILTER (WHERE s.id IS NOT NULL), COUNT(*) FROM ingredients ing LEFT JOIN suppliers s ON lower(s.name)=lower(ing.supplier) WHERE ing.supplier<>'';
-- 21 | 137   (auto-match fournisseur de la fiche ingrédient : 15 %)
```
Ingrédients des 31 DA : 2 seulement avec contenant (Amande concassée sac 2 kg, Amandes entières carton 25 kg) ; `supplier_id` nul pour tous ; `supplier` texte « Générique », « DGF », « Ovotec », « ECOMAB », vide…

**Q16 — notes** : 29 notes `BSI … — rupture totale signalee depuis Economat` / `manquant transfert economat` / `manquant au pesage`, 2 vides. 9 portent le suffixe `| Cloturee (mig 271) : BC receptionne`.

**Q17 — ruptures BSI actives** : 0 ligne aujourd'hui.

**Q18 — notifications** : 20 types, aucun lié aux DA, aux ruptures ou aux achats (`replenishment_*` concernent la boutique). `stock_verification_requested` : 24.

**Q19 — migrations** : `_migrations` = 298 lignes ; absentes ≥ 266 : `266, 267, 268, 269, 270, 271, 275` (appliquées hors outil).

**Q20 — unités** : 0 DA avec `unit ≠ ingredients.unit`.

---

## 8. Écrans client

| Écran | Fichier | Rôles | Contenu |
|---|---|---|---|
| Achats → onglet « Liste d'attente » | `PurchasingPage.tsx:58-63, 93` → `PurchaseRequestsPage.tsx` | module `purchasing` (navigation `client/src/config/navigation.ts:76`) ; API ADMIN_MANAGER | 3 tuiles (En attente / Fournisseurs / Estimé DH), recherche, 2 vues : **Par fournisseur** (groupes dépliables, sélection, « Générer le BC (n lignes) », select « Attribuez un fournisseur » pour le groupe sans fournisseur, corbeille = annulation **sans confirmation** `:322`) et **Toutes les demandes** (filtre statut pending/assigned/ordered/received/cancelled/tous, colonne BC). Modal `GeneratePOModal` (`:462-597`) : quantités éditables (en nombre de contenants si défini), prix = `ingredient_unit_cost`, total estimé, date livraison prévue, notes. Pas de badge compteur sur l'onglet. |
| Économat → onglet « Ingrédients à commander » | `InventoryPage.tsx:352-353, 388-390` → `RuptureRequestsList.tsx` | admin/manager/magasinier (`:75`) ; badge via `bonSortieApi.ruptureRequests` toutes les 30 s (`:118-123`) | Groupes par BSI (numéro, date plan, type), lignes : besoin / dispo / manque, bouton « Commander » ou badge « Commandé » ; lien « Ouvrir au pesage ». Bandeau : après réception « Actualiser le stock » sur le bon. |
| Économat/Pesage → « Transferts demandés » | `TransferRequestsList.tsx:259-…` | WAREHOUSE | « Commander le manquant » quand économat insuffisant |
| Production → panneau BSI | `BonSortiePanel.tsx:518, 599-600` | WAREHOUSE | ligne « Manquant » → bouton « Commander » |
| Fiche ingrédient | `IngredientDetailPage.tsx:693-704, 776-892` | tout rôle avec la fiche | Modal « Demande d'achat » : fournisseur (pré-match texte), nb contenants ou quantité, motif, note |
| Plan de production → « Besoins » | `PlanDetailPage.tsx:586-665` | magasinier voit Dispo/Statut | « Demander vérification » → notification, pas DA |

Doublon fonctionnel documenté dans `docs/AUDIT_FONCTIONNEL.md:86` : « `PurchaseRequestsPage` **et** `warehouse/RuptureRequestsList` (même API) — on ne sait pas quel écran fait foi ».

---

## 9. Règles métier codées (liste exhaustive)

1. Une DA porte un seul ingrédient (jamais un consommable) et une quantité > 0 (`057:4-6`).
2. Motif ∈ {stock_bas, production, manual, replenishment}, défaut `manual` (`057:9-10`) ; côté serveur, non validé avant le CHECK SQL.
3. Statut ∈ {pending, assigned, ordered, received, cancelled} (`271:40-42`) ; `ordered` jamais écrit.
4. Règle « contenant entier » : quantité arrondie au contenant supérieur, minimum 1 contenant, si la fiche porte type + taille (`container-rule.ts:1-64`, appliquée `purchase-request.repository.ts:99, 120, 228`).
5. Seules les DA `pending` sont modifiables (quantité, fournisseur), annulables, et convertibles en BC (`repo:122, 131, 141, 155, 180`).
6. Un BC généré ne contient que des DA d'un seul fournisseur ; les DA du même ingrédient sont fusionnées en une ligne ; le prix de ligne = `ingredients.unit_cost` ; le BC naît en `en_attente` (`repo:176-234`).
7. Anti-doublon : un ingrédient ayant une DA ouverte (pending/assigned/ordered) dans le magasin est « déjà commandé » pour toutes ses lignes BSI (`bon-sortie.repository.ts:250-256, 765-770, 823-828`).
8. Une DA passe en `received` quand son BC passe `livre_complet` ou `en_attente_facturation` ; `livre_partiel` ne clôture pas (`helper:19-46`).
9. Les lignes BSI en rupture n'apparaissent dans « Ingrédients à commander » que si le stock utilisable total (pesage + économat, lots non périmés) reste < besoin (`bon-sortie.repository.ts:783-789`).
10. Lecture/gestion de la liste d'attente : ADMIN et MANAGER ; création : tout rôle authentifié (`routes:13-21`).
11. Filtrage magasin : `store_id` du JWT ; un admin sans `storeId` voit tous les magasins (`ctrl:12, 18`).

---

## 10. Forces

- Chaîne **rupture BSI → DA → BC → clôture** câblée de bout en bout, avec clôture idempotente et commentée (`purchase-request.helper.ts`), appelée sur les 3 chemins de réception.
- Regroupement multi-DA → 1 BC par fournisseur, avec ajustement des quantités avant génération et numérotation partagée sous advisory lock (`generateOrderNumber`).
- Règle « contenant entier » centralisée serveur (`container-rule.ts`) avec miroir client (`utils/container.ts`) et test unitaire (`server/src/__tests__/container-rule.test.ts`).
- `FOR UPDATE` dans `generatePurchaseOrder` et transaction complète.
- Vue magasinier centralisée « Ingrédients à commander » cross-BSI, rafraîchie toutes les 30 s, avec filtrage des ruptures résolues entre-temps.
- Le motif et le demandeur sont conservés ; la vue « Toutes les demandes » donne l'historique et le BC lié.
- Mig 271 : rédaction exemplaire (pourquoi/choix/portée/inversion) et backfill ciblé.

---

## 11. Faiblesses (ordonnées par sévérité)

| # | Sév. | Dom. | Titre | Preuve | Impact |
|---|---|---|---|---|---|
| W1 | critique | D2, D10 | Une DA `assigned` dont le BC est annulé, supprimé ou non livré n'est jamais libérée ; l'ingrédient reste « Commandé » à vie | `purchase-order.controller.ts:111-120` → `updateStatus('annule')` (`repo:172-178`) ; `remove` `:141-150` → `delete` (`repo:545-547`) + FK `ON DELETE SET NULL` ; `markNotDelivered` `:104-109` ; `closePurchaseRequestsForOrder` ne traite que `livre_complet/en_attente_facturation` (`helper:23`) ; `already_ordered` = `status IN ('pending','assigned','ordered')` (`bon-sortie.repository.ts:765-770`) | Blocage opérationnel : le magasinier ne peut plus commander l'ingrédient (bouton masqué), reproduction du cas documenté dans la mig 271 (BSI bloqué) |
| W2 | critique | D4, D10 | `generatePurchaseOrder` marque `assigned` tous les `requestIds` reçus sans refiltrer statut/fournisseur | `purchase-request.repository.ts:176-183` (SELECT filtré `status='pending' AND supplier_id=$2`) vs `:237-241` (`UPDATE … WHERE id = ANY($2)` sans filtre) | Une DA annulée, d'un autre fournisseur ou déjà affectée peut être rattachée à un BC qui ne la contient pas → DA fantôme `assigned`, déclenche W1 ; atteignable par course entre deux utilisateurs ou appel API |
| W3 | critique | D2 | Aucun mécanisme de réapprovisionnement : seuils à 0 partout, pas de point de commande, pas de suggestion consommation/plan, aucune DA automatique | `inventory.minimum_threshold` : 0/377 > 0 (Q14) ; `GET /inventory/alerts` jamais appelé par le client ; 1 seul `INSERT INTO purchase_requests` (ctrl) ; `production.repository.ts:157-167` ignore les BC en cours ; `suppliers` sans lead time | La rupture est constatée au pesage, le jour J (délai DA→BC→BR = 0 j sur 31 DA, Q8) : arrêt de production ou achat d'urgence hors circuit (295 BC/304 sans DA) |
| W4 | majeur | D2 | `already_ordered` évalué par ingrédient (et non par ligne BSI/besoin) → sous-commande silencieuse | `bon-sortie.repository.ts:250-256, 765-770, 823-828` ; `RuptureRequestsList.tsx:138, 161-164` masque le bouton | BSI-B ne peut pas ajouter ses 10 kg si BSI-A a déjà demandé 5 kg du même ingrédient ; aucune agrégation des besoins |
| W5 | majeur | D2 | Quantité de DA = besoin théorique résiduel brut (0,0035 kg) ; pas de quantité d'achat (MOQ, conditionnement fournisseur, arrondi) hors les 11 ingrédients avec contenant | `RuptureRequestsList.tsx:36` (`needed_quantity`), `BonSortiePanel.tsx:212` (`max(0.001, …)`), `TransferRequestsList.tsx:88` ; Q8 bis : 17/31 DA < 0,5 kg ; Q12 : BC 0,0035 kg livré 5 kg ; 11/405 ingrédients avec contenant | BC générés inexploitables sans retouche manuelle, écart commandé/livré systématique, prix de ligne et contrôle 3-way faussés en aval |
| W6 | majeur | D2 | Consommables exclus de la liste d'attente | `057:4` `ingredient_id NOT NULL`, pas de `packaging_id` ; `bon-sortie.repository.ts:778` filtre `ingredient_id IS NOT NULL` ; `purchase_order_items.packaging_id` existe pourtant | Les ruptures d'emballage (109 articles) ne peuvent être ni vues dans « Ingrédients à commander » ni commandées via DA ; déjà relevé `docs/AUDIT_FONCTIONNEL.md:115, 187` |
| W7 | majeur | D3 | Aucune approbation, aucun budget, aucune demande de prix / comparatif fournisseur | Machine à états §6 : `pending → assigned` direct par ADMIN_MANAGER (`routes:21`) ; pas de table, pas de statut `approved`/`rejected` ; prix BC = `ingredients.unit_cost` (`repo:215`), 27 ingrédients sans coût | Pas de contrôle financier avant engagement ; prix d'achat non négociés/non comparés ; D3 absent à 100 % |
| W8 | majeur | D1, D2 | Pré-affectation fournisseur fondée sur un texte libre ; `ingredients.supplier_id` jamais renseigné ; 3 des 4 points de création posent `supplierId: null` | `IngredientDetailPage.tsx:789-791` (match `lower(name)`) ; Q15 : `supplier_id` 0/405, match texte 21/137 ; `RuptureRequestsList.tsx:40`, `TransferRequestsList.tsx:92`, `BonSortiePanel.tsx:216` | Toutes les DA de rupture atterrissent dans « Sans fournisseur » et exigent une attribution manuelle ; pas de fiche info article-fournisseur (prix, délai, conditionnement) |
| W9 | majeur | D5, D10 | Clôture de DA pilotée par le statut global du BC, pas par la ligne ; réception annulée ne rouvre pas la DA | `helper:19-23` (`livre_partiel` ignoré), `:40-44` (toutes les DA du BC) ; `cancelForPurchaseOrder` (`reception-voucher.repository.ts:586-…`, `:749` BC → `envoye`) ne touche pas `purchase_requests` | DA « reçue » alors que son ingrédient est livré 0 (ou marchandise ressortie), DA « en attente » alors que son ingrédient est arrivé en partiel |
| W10 | majeur | D10 | Pas de ré-allocation automatique du BSI à la réception ; pas de notification de rupture ni de DA | `RuptureRequestsList.tsx:109` (« après réception, Actualiser le stock ») ; `PUT /bons-sortie/:id/complete-pending` manuel ; Q18 : aucun type de notification DA/rupture ; `GET /purchase-requests/count` jamais appelé → pas de badge | Le manager n'est pas alerté d'une nouvelle DA ; le magasinier doit penser à ré-actualiser chaque BSI après réception |
| W11 | majeur | D2 | Besoins du plan de production non reliés aux achats : « Demander vérification » = notification ; `available_quantity` ignore les BC en cours et les autres plans | `production.controller.ts:561-612` ; `production.repository.ts:157-167` ; `PlanDetailPage.tsx:661` | Pas de projection « besoin net = besoin − stock − en commande + réservé » ; double saisie humaine (vérifier puis commander) |
| W12 | majeur | D10 | Pas de piste d'audit sur les DA : pas de `cancelled_by/approved_by/assigned_by`, pas de table d'historique, annulation non confirmée côté UI | `\d purchase_requests` ; `repo:148-159` (note concaténée) ; `PurchaseRequestsPage.tsx:322` (`cancelMutation.mutate` direct) | Impossible de savoir qui a annulé/converti ; suppression d'ingrédient efface l'historique (`ON DELETE CASCADE`) |
| W13 | mineur | D10 | 3 endpoints morts (`GET /count`, `PUT /:id/quantity`, `PUT /:id/supplier`) et statut `ordered` jamais écrit | grep client → 0 appel ; grep serveur `'ordered'` hors `IN (...)` → 0 | Dette, surface d'API inutile ; déjà noté `docs/AUDIT_FONCTIONNEL.md:115` |
| W14 | mineur | D10 | Aucune validation zod ; `reason`/`unit` non validés ; `POST /` ouvert à tout rôle | `ls server/src/validators` (pas de purchase-request) ; `ctrl:22-39` ; `routes:16` sans `authorize` | Valeur `reason` hors liste → erreur 500 PG ; caissier/vendeuse peuvent créer des DA |
| W15 | mineur | D4, D10 | Traçabilité BC ↔ DA ↔ BSI invisible en UI | `purchase-order.repository.ts` ne lit pas `purchase_requests` ; `PurchaseOrdersTab.tsx` sans référence ; lien BSI = note texte | Impossible depuis un BC de voir les BSI/plans à l'origine, ni depuis un BSI de suivre sa DA |
| W16 | mineur | D10 | Deux écrans d'entrée DA aux conventions différentes (Économat `RuptureRequestsList` en Tailwind brut, Achats `PurchaseRequestsPage` en `odoo-*`) ; onglet « Liste d'attente » sans compteur | `docs/AUDIT_FONCTIONNEL.md:86` ; `PurchasingPage.tsx:58-63` | Ergonomie, « quel écran fait foi » |
| W17 | mineur | D10 | Aucun test sur le module DA ; environnement local avec migrations 266-271/275 non tracées dans `_migrations` | `server/src/__tests__/` (5 fichiers, aucun DA) ; Q19 | Régressions non détectées ; divergence outil de migration |

---

## 12. Code mort / inutilisé

- `GET /purchase-requests/count` + `purchaseRequestRepository.countPending` + `purchaseRequestsApi.count` : jamais appelés.
- `PUT /purchase-requests/:id/quantity` + `updateQuantity` + `purchaseRequestsApi.updateQuantity` : jamais appelés (la quantité n'est ajustable qu'au moment de « Générer le BC »).
- `PUT /purchase-requests/:id/supplier` + `updateSupplier` + `purchaseRequestsApi.assignSupplier` : jamais appelés (remplacés par `bulk-assign-supplier`).
- Statut `ordered` : présent dans le CHECK, les `IN`, les libellés UI (`PurchaseRequestsPage.tsx:346-400`), jamais posé.
- Motif `replenishment` : présent dans le CHECK et le select de la fiche ingrédient, jamais produit automatiquement (le module `replenishment` concerne les produits finis).
- Motif `stock_bas` : jamais sélectionné par défaut (aucun seuil renseigné), 0 occurrence en base.
- `inventory.minimum_threshold`, `GET /inventory/alerts`, `inventoryApi.alerts`, `idx_inventory_low_stock` : mécanisme de stock bas entièrement inerte (0 seuil, 0 appel client).
- Colonne `ingredients.supplier_id` : 0/405 renseignée, jamais utilisée par les DA.

---

## 13. Questions ouvertes

1. Qui doit être autorisé à **créer** une DA (aujourd'hui tout rôle) et qui doit la **valider** (aujourd'hui personne) ? Y a-t-il un seuil de montant déclenchant une approbation ?
2. La DA doit-elle porter la **quantité d'achat** (conditionnement fournisseur / MOQ) ou le **besoin net**, la conversion se faisant à la génération du BC ?
3. Faut-il une **fiche article-fournisseur** (prix, délai, conditionnement, référence) pour alimenter le pré-choix fournisseur et la date de livraison prévue ? `ingredients.supplier_id` (0 renseigné) ou nouvelle table ?
4. Quelle politique de réappro par ingrédient : seuil fixe, couverture en jours sur consommation moyenne (`inventory_transactions`), ou projection depuis les plans confirmés ? Mixte selon famille (frais vs sec) ?
5. Le rattachement DA ↔ ligne BSI doit-il être une FK (pour ré-allouer automatiquement à la réception et calculer `already_ordered` par ligne) ?
6. Comportement attendu quand un BC issu de DA est annulé : DA → `pending` (re-sourcer) ou `cancelled` ?
7. Les 295 BC hors DA sont-ils voulus (achats directs du gérant) ou faut-il rendre la DA obligatoire au-delà d'un montant ?
8. Faut-il garder deux écrans d'entrée (Économat/Achats) ou un seul avec vues par rôle ?
9. Les migrations 266-271/275 absentes de `_migrations` en local : la prod est-elle alignée ? (hors périmètre mais à vérifier avant toute nouvelle migration DA.)

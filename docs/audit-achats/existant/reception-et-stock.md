# Réception, qualité, lots, stock — état de l'existant (D5, D10)

Lecteur « reception-et-stock ». Dépôt `/Users/anissbouida/projets/Ofauria-app`, base locale (copie prod) en lecture seule, 2026-10-11. Dernière migration appliquée en base : `303_foret_noire_10065_fiche_technique.sql` (`SELECT MAX(name) FROM _migrations`).

Tout chemin de fichier est relatif à la racine du dépôt. Les volumes proviennent de la base locale.

---

## 1. Périmètre et cartographie

### 1.1 Tables

| Table | Rôle | Migrations | Volume | Colonnes clés |
|---|---|---|---|---|
| `reception_vouchers` (BR) | En-tête de réception, 1 BR = 1 livraison d'un BC | 055 (création), 147 (`supplier_invoice_number`, `supplier_invoice_date`) | 307 | `voucher_number` UNIQUE (`BR-YYYY-NNNN`), `purchase_order_id` NOT NULL, `reception_date` DEFAULT CURRENT_DATE, `store_id`, `received_by`, `supplier_invoice_number/date`. Pas de statut, pas de `updated_at`, pas de motif. |
| `reception_voucher_items` (RVI) | Lignes reçues | 055, 056 (`supplier_lot_number`, `expiration_date`, `manufactured_date`), 194 (`category_id`), 207 (`packaging_id`, `rvi_kind_check`) | 789 (634 ingrédient, 155 consommable) | `purchase_order_item_id` NOT NULL (FK), `quantity_received > 0` CHECK, `unit_price` nullable, exactement un de `ingredient_id`/`packaging_id`. |
| `reception_quality_checks` | Contrôle qualité ONSSA à la réception (température, visuel, emballage, étiquettes) | 056 | **0** | `reception_voucher_id` UNIQUE, `overall_conformity` DEFAULT true. |
| `ingredient_lots` | Lot d'ingrédient (traçabilité ONSSA + stock par zone) | 056, 105 (`source_product_lot_id`), 111 (`economat_quantity`, `pesage_quantity`, `opening_history`), 112, 114 (trigger sync inventory), 224, 300 | 669 (active 646, depleted 17, waste 6) | `lot_number` **nullable** en base (NOT NULL UNIQUE en 056, relâché sans migration visible), `reception_voucher_item_id` (ON DELETE SET NULL), `supplier_id`, `quantity_received`, `quantity_remaining` (= eco+pesage via trigger), `unit_cost`, `expiration_date`, `status` CHECK (active/depleted/expired/quarantine/waste). |
| `inventory` | Cache « stock par ingrédient/magasin » (`current_quantity`) | historique, 114 (devient dérivé des lots) | 377 | UNIQUE (`store_id`,`ingredient_id`), `minimum_threshold`, `last_restocked_at`. |
| `inventory_transactions` | Journal des mouvements ingrédient | 055 (`reception_voucher_id`), 056 (`ingredient_lot_id`) | 1 016 (restock 640, adjustment 251, production 119, waste 6) | `type` CHECK (restock/usage/adjustment/waste/recycle/production/open_container/reception), `purchase_order_item_id`, `reception_voucher_id`, `ingredient_lot_id`. |
| `packaging_store_stock` / `packaging_stock_transactions` | Stock consommables (sans lot/DLC) | 110, 207 | 102 lignes / 188 mouvements (reception 182, adjustment 6) | `reference_type='purchase_order'` sur 161 mouvements. |
| `ingredient_stock_zone_transfers` | Transferts économat→pesage (hors périmètre, cité pour cohérence) | 113, 225 | 52 | `ingredient_lot_id`, `container_type_id`. |

Schémas vérifiés par `\d+` (reception_vouchers, reception_voucher_items, reception_quality_checks, ingredient_lots, inventory, inventory_transactions).

Triggers sur `ingredient_lots` (migration 111 et 114) :
- `trg_sync_quantity_remaining` BEFORE INSERT OR UPDATE OF `economat_quantity`, `pesage_quantity` → `quantity_remaining := eco + pesage`.
- `trg_inventory_sync_lots` AFTER INSERT/UPDATE(eco, pesage, status, ingredient_id, store_id)/DELETE → `sync_inventory_from_lots(ingredient, store)` recalcule `inventory.current_quantity = SUM(eco+pesage) des lots actifs` (`server/migrations/114_inventory_lot_sync.sql:11-70`). Commentaire de la migration : « un seul point de vérité (les lots actifs). inventory.current_quantity devient un cache dérivable maintenu par trigger ».

### 1.2 Code serveur

| Fichier | Lignes | Rôle |
|---|---|---|
| `server/src/routes/reception-voucher.routes.ts` | 14 | 4 routes `/reception-vouchers` (ADMIN_MANAGER) |
| `server/src/controllers/reception-voucher.controller.ts` | 53 | list/getById/create/findByPurchaseOrder |
| `server/src/repositories/reception-voucher.repository.ts` | 780 | `createInvoiceFromPo` (l.76-215), `findAll` (217), `findById` (243), `generateVoucherNumber` (267), **`create` (284-562)**, **`cancelForPurchaseOrder` (586-765)**, `findByPurchaseOrder` (767) |
| `server/src/controllers/purchase-order.controller.ts` | 76-102 | `confirmDelivery` → `purchaseOrderRepository.confirmDelivery` ; 127-139 `cancelReception` |
| `server/src/repositories/purchase-order.repository.ts` | 180-221 | `confirmDelivery` (délègue à `receptionVoucherRepository.create`) ; 328-500 `replaceItems` (édition admin des qty livrées, **sans lot**) ; 506-527 `_adjustInventory` |
| `server/src/repositories/ingredient-lot.repository.ts` | 832 | lecture lots, FEFO, zones, `quarantine` (627), `markAsWaste` (636), `sendToLosses` (651), `saveQualityCheck` (793), `findQualityCheck` (822) |
| `server/src/routes/ingredient-lot.routes.ts` | 17, 23 | `GET/POST /ingredient-lots/quality-check/:rvId` |
| `server/src/controllers/inventory.controller.ts` | 16-66 | `restock` = **réception sans BC** (achat direct) ; 67-160 `adjust` (lot `ADJ-`) |
| `server/src/repositories/inventory.repository.ts` | 78-100 | `restock` legacy (sans lot) — non référencé par le contrôleur ; 189-260 `findMaterialPurchases` (vue Achats par lot) |
| `server/src/repositories/packaging-item.repository.ts` | 145-178 | `adjustStock` (upsert `packaging_store_stock` + journal) ; 181-206 `receiveBatch` |
| `server/src/repositories/purchase-request.helper.ts` | 38-54 | `closePurchaseRequestsForOrder` → DA en `received` |

### 1.3 Code client

| Fichier | Lignes | Rôle |
|---|---|---|
| `client/src/api/purchase-orders.api.ts` | 12-13 | `confirmDelivery` → `POST /purchase-orders/:id/confirm-delivery` (**le seul chemin de réception réellement utilisé**) ; 18-20 `cancelReception` ; 48-57 `receptionVouchersApi` (4 fonctions, **jamais importées** : `grep -rn receptionVouchersApi client/src/features` → 0) |
| `client/src/api/inventory.api.ts` | 6-7 | `restock`/`adjust` (jamais appelés par une feature : `grep -rln "inventoryApi.restock\|\.restock(" client/src/features` → 0) ; 47-48 `saveQualityCheck`/`getQualityCheck` (jamais appelés) |
| `client/src/features/accounting/PurchaseOrdersTab.tsx` | 1393-1750 | `DeliveryModal` (modal de réception) ; 494 bouton « Confirmer réception » (statuts `envoye`/`livre_partiel`) ; 524-540 bouton admin « Annuler la réception » ; 1255 `PODetailModal` (qty livrée cumulée, **aucune liste de BR**) |
| `client/src/features/purchasing/PurchasingPage.tsx` | 18, 76 | héberge `PurchaseOrdersTab` dans l'onglet `purchase_orders` |
| `client/src/features/inventory/IngredientDetailPage.tsx` | 987-989 | affiche `BR : {lot.reception_voucher_number}` sur chaque lot ; 247-256 quarantaine / rebut d'un lot |
| `client/src/config/navigation.ts` | 76 | module `purchasing` (« Fournisseurs, commandes et factures ») |

Aucun test ne couvre la réception : `server/src/__tests__/` contient 5 fichiers (recipe-composition, smoke, tva, units-densite, container-rule), aucun ne mentionne `reception` ni `ingredient_lots`.

---

## 2. Endpoints du périmètre

| Méthode | Chemin | Handler | Rôles (route) | Appelé par le client ? | Remarque |
|---|---|---|---|---|---|
| POST | `/purchase-orders/:id/confirm-delivery` | `purchaseOrderController.confirmDelivery` → `receptionVoucherRepository.create` | ADMIN_MANAGER | **oui** (`purchase-orders.api.ts:12`, `PurchaseOrdersTab.tsx:1414`) | Chemin réel de réception. Garde statut `envoye`/`livre_partiel` (ctrl l.80). |
| POST | `/purchase-orders/:id/cancel-reception` | `purchaseOrderController.cancelReception` → `cancelForPurchaseOrder` | ADMIN | oui (`purchase-orders.api.ts:19`, `PurchaseOrdersTab.tsx:146`) | Annule TOUTES les réceptions du BC. |
| PUT | `/purchase-orders/:id/items` | `replaceItems` | ADMIN_MANAGER | oui (`purchase-orders.api.ts:30`) | Peut modifier `quantity_delivered` → stock sans BR ni lot. 16 mouvements `Admin edit BC%` en base. |
| GET | `/reception-vouchers` | `receptionVoucherController.list` | ADMIN_MANAGER | **non** (défini dans `purchase-orders.api.ts:49`, jamais importé) | Code mort côté UI. |
| GET | `/reception-vouchers/:id` | `getById` | ADMIN_MANAGER | **non** | Code mort. Seule requête qui expose les lignes d'un BR (qty, prix, lot, DLC). |
| POST | `/reception-vouchers` | `create` | ADMIN_MANAGER | **non** | Doublon du confirm-delivery mais **ne transmet pas** `supplierInvoiceNumber/Date/forceComplete` (ctrl l.25 : `const { purchaseOrderId, notes, items } = req.body`) et accepte le statut `en_attente` (l.33) alors que confirm-delivery le refuse. |
| GET | `/reception-vouchers/purchase-order/:poId` | `findByPurchaseOrder` | ADMIN_MANAGER | **non** | Code mort. |
| POST | `/ingredient-lots/quality-check/:rvId` | `ingredientLotController.saveQualityCheck` | ADMIN_MANAGER | **non** (`inventory.api.ts:47` jamais appelé) | Table vide (0 lignes). |
| GET | `/ingredient-lots/quality-check/:rvId` | `getQualityCheck` | authentifié | **non** | idem |
| POST | `/ingredient-lots/:id/quarantine` | `quarantine` | ADMIN_MANAGER | oui (`IngredientDetailPage.tsx:247`) | `UPDATE status='quarantine'` sans motif, sans mouvement, sans lien retour fournisseur. |
| POST | `/ingredient-lots/:id/waste` | `markAsWaste` | ADMIN_MANAGER | oui (`IngredientDetailPage.tsx:256`) | `SET status='waste', quantity_remaining=0` **sans toucher eco/pesage ni journal** (repo l.636-641). |
| POST | `/ingredient-lots/:id/send-to-losses` | `sendToLosses` | ADMIN_MANAGER + magasinier | oui (`inventory.api.ts:46`) | Version correcte (zones à 0 + `inventory_transactions` waste). |
| POST | `/inventory/restock` | `inventoryController.restock` | ADMIN_MANAGER | **non** (api défini l.6, jamais utilisé) | Réception sans BC : crée un lot sans `lot_number`, sans fournisseur, au `ingredients.unit_cost`. 6 `restock` sans `reception_voucher_id` en base (juin 2026). |
| POST | `/replenishment/:id/confirm-reception` | `replenishmentController.confirmReception` | STORE_STAFF | oui (`replenishment.api.ts:19`) | Réapprovisionnement inter-magasin, hors achats fournisseur ; `replenishment_requests` = 0 lignes. |

Aucune route ne produit un PDF de BR : `ls server/src/services | grep pdf` → `invoice-pdf.service.ts`, `purchase-order-pdf.service.ts`, `recipe-fiche-pdf.service.ts` ; `grep -rln reception server/src/services` → vide.

---

## 3. Le flux de réception tel qu'il est codé

### 3.1 Saisie (client) — `DeliveryModal`, `PurchaseOrdersTab.tsx:1393-1750`

- Ouvert depuis le bouton l.494, uniquement si `status ∈ {envoye, livre_partiel}`.
- Par ligne : nombre de contenants (si `container_size` ET `container_type_label`, l.1620-1660) qui pilote la qty, qty reçue (`max={remaining}` l.1663 — contrainte HTML seulement), prix unitaire (pré-rempli au prix BC), réf. lot fournisseur, DLC, date de production (l.1694-1718).
- « Tout reçu » (l.1578) remplit le reliquat de chaque ligne.
- Case `forceComplete` (l.1411, 1524-1541) : « le fournisseur ne livrera pas le reste ».
- N° et date de facture fournisseur (l.1406-1407, 1562-1569). Si la réception clôture le BC sans N°, un `confirm()` avertit (l.1467-1476) mais n'empêche pas.
- Aucun champ : motif d'écart, refus/retour, contrôle qualité, température, remarque par ligne (le champ `notes` RVI existe mais n'est pas exposé : 1 RVI sur 789 a une note).
- Les lignes déjà complètes sont figées (`isComplete` l.1605) : impossible de saisir un surplus sur une ligne déjà servie, mais possible sur une ligne non complète (voir sur-livraison).

### 3.2 Contrôleur — `purchase-order.controller.ts:76-102`

```ts
if (!['envoye', 'livre_partiel'].includes(po.status)) { 409 }          // l.80
const stockStoreId = (po.store_id as string | undefined) ?? req.user!.storeId; // l.90
```
Aucune validation de schéma (pas de validator) : `items[].quantityDelivered` non borné, `unitPrice` non contrôlé, dates non validées.

### 3.3 Dépôt — `receptionVoucherRepository.create`, `reception-voucher.repository.ts:284-562` (une transaction)

1. Charge le BC + fournisseur (l.302-309).
2. Garde doublon facture fournisseur : même `supplier_invoice_number` déjà saisi sur un BR du même fournisseur → 409 (l.316-339). La garde ne regarde que `reception_vouchers`, pas `invoices.invoice_number` saisi à la main.
3. Numéro BR : `pg_advisory_xact_lock(hashtext('voucher_number'))` puis `MAX(suffixe) + 1` sur `BR-<année>-%` (l.267-282). Le numéro est **réutilisable** après annulation (cf. §6).
4. INSERT `reception_vouchers` (l.345-352) : `reception_date` non fourni → `CURRENT_DATE` (aucune rétro-datation possible ; 0 BR avec `reception_date <> created_at::date`).
5. Pour chaque ligne (l.363-477) :
   - `quantityReceived <= 0` ignorée (l.364) → c'est l'origine des **7 BR sans aucune ligne** (voir §5).
   - INSERT RVI (l.368-373) — **`category_id` jamais renseigné** à l'insertion (31 RVI postérieures à la migration 255, 31 à `category_id IS NULL`).
   - `SELECT ... FOR UPDATE` puis `UPDATE purchase_order_items SET quantity_delivered = quantity_delivered + $1` (l.377-385). **Aucun plafond** sur `quantity_ordered` → sur-livraison acceptée silencieusement.
   - Prix : `effectiveCost = item.unitPrice ?? poItem.unit_price` (l.388). Si un prix > 0 est saisi, **il écrase le prix du BC** (l.393-396) : l'écart prix BC/réception n'est pas conservé sur le BC (il ne reste que `rvi.unit_price`).
   - **Consommable** (`packaging_id`) : `packagingItemRepository.adjustStock(... type:'reception', referenceType:'purchase_order')` (l.408-418) + `UPDATE packaging_items SET unit_cost` (l.421-424). Pas de lot, pas de DLC. `continue`.
   - **Ingrédient** : INSERT `ingredient_lots` (l.431-437) avec `quantity_received = quantity_remaining = economat_quantity = qty`, `pesage_quantity = 0`, `unit_cost = effectiveCost`, `supplier_id = po.supplier_id`, `received_at = CURRENT_DATE`, `store_id`. **`lot_number` n'est pas renseigné** → 634 lots sur 669 ont `lot_number IS NULL`.
   - Lock + `UPDATE inventory SET current_quantity = current_quantity + $1` (l.445-457) — **en plus** du trigger `trg_inventory_sync_lots` déclenché par l'INSERT du lot. Voir §5.1 (double comptage).
   - `UPDATE ingredients SET unit_cost = $1` (l.462-466) : dernier prix payé, pas de moyenne pondérée.
   - INSERT `inventory_transactions` type `restock` avec `purchase_order_item_id`, `reception_voucher_id` (l.469-476) mais **sans `ingredient_lot_id`** (la colonne existe depuis 056).
6. `forceComplete` (l.486-498) : `DELETE` des lignes à 0 livré, `quantity_ordered := quantity_delivered` sur les partielles. Destructif : la quantité commandée d'origine est perdue (le commentaire de `cancelForPurchaseOrder` l.584 l'admet : « non restaurables »).
7. Statut BC recalculé (l.501-528) — voir §4.
8. `delivery_date = CURRENT_DATE` à chaque réception (l.527) : écrasée par la dernière livraison (8 BC multi-BR ont `delivery_date` = date du dernier BR).
9. `closePurchaseRequestsForOrder` (l.534) si `livre_complet`/`en_attente_facturation`.
10. Si `livre_complet` : `createInvoiceFromPo` (l.541-544) crée la facture reçue : lignes = `quantity_delivered × effective_unit_price` (dernier `rvi.unit_price` sinon prix BC, l.100-113), `tax_amount = 0` (l.169-170), numéro = `supplier_invoice_number` du dernier BR sinon auto (l.149), catégorie dérivée (l.157), écriture comptable si `FLAGS.LEDGER_AUTOGEN` (l.189-207).

### 3.4 Routage consommable vs ingrédient (mig 110/207)

Le routage est **porté par la ligne de BC** (`purchase_order_items.packaging_id` vs `ingredient_id`), recopié dans la RVI (`purchase-order.repository.ts:195-205`). `fn_purchasable_kind` n'est pas appelée à la réception (`grep fn_purchasable_kind server/src` → seulement un commentaire l.130 du dépôt BC). 155 RVI consommables / 634 ingrédients.

---

## 4. Machine à états telle que codée

### 4.1 Bon de commande (statuts CHECK mig 055 : `en_attente, envoye, livre_complet, livre_partiel, non_livre, annule, en_attente_facturation`)

| De | Vers | Déclencheur | Code |
|---|---|---|---|
| `en_attente` | `envoye` | POST `/send` | `purchase-order.controller.ts:65-74` |
| `envoye`, `livre_partiel` | `livre_partiel` | réception partielle (`someDelivered && !allDelivered`) | `reception-voucher.repository.ts:515-524` |
| `envoye`, `livre_partiel` | `livre_complet` | `allDelivered && !hasMissingPrices` (ou `forceComplete`) | idem l.515-518 ; déclenche la facture auto l.541 |
| `envoye`, `livre_partiel` | `en_attente_facturation` | `allDelivered && hasMissingPrices` | idem l.515-516 |
| `envoye`, `livre_partiel` | `non_livre` | réception où rien n'est livré (théorique : lignes à 0 ignorées → ne se produit que si toutes les lignes sont à 0) ; ou bouton « Non livré » sans garde de statut | l.522-524 ; `purchase-order.controller.ts:104-109` |
| `en_attente_facturation` | `livre_complet` | saisie des prix manquants (`update-prices`) | `purchase-order.repository.ts:242-262` ; **ne crée pas la facture** → bouton « Générer la facture » (l.564-620) |
| `livre_complet`, `livre_partiel`, `en_attente_facturation` | `envoye` | `cancel-reception` (admin) : supprime BR/lots/transactions/facture | `reception-voucher.repository.ts:586-765` |
| tout sauf `livre_complet`, `annule` | `annule` | POST `/cancel` | `purchase-order.controller.ts:111-120` |
| tout statut | recalcul (`livre_*`, `en_attente_facturation`, conservé si `en_attente/envoye/annule` et rien livré, sinon `non_livre`) | `replaceItems` (édition admin) | `purchase-order.repository.ts:457-483` |

Distribution réelle : `livre_complet` 299, `envoye` 3, `en_attente_facturation` 1, `annule` 1, **`livre_partiel` 0, `non_livre` 0**. 290 BC ont 1 BR, 7 en ont 2, 1 en a 3 : la livraison partielle existe mais est marginale (8/298).

### 4.2 Bon de réception

**Aucun statut.** Un BR est créé définitif (pas de brouillon, pas de validation, pas de `updated_at`). La seule « transition » est la suppression physique par `cancelForPurchaseOrder`, qui supprime tous les BR du BC (`DELETE FROM reception_vouchers WHERE id = ANY(...)`, l.754-757). Il n'existe pas d'annulation d'un BR isolé ni de BR d'extourne.

### 4.3 Lot d'ingrédient (`status` : active → depleted / waste / quarantine / expired)

| Transition | Où |
|---|---|
| création `active` (eco = qty) | réception l.431-437 ; restock direct `inventory.controller.ts:41-48` ; ajustement positif `ADJ-` l.116-135 |
| `active → depleted` | BSI `consumeBonLines` quand `eco + pesage − qty ≤ 0,0005` (`bon-sortie.repository.ts:134-140`) ; `consumeFEFO` (`ingredient-lot.repository.ts:462-470`) ; `wasteFromPesage` |
| `active → waste` | `sendToLosses` (zones à 0 + journal) l.651-740 ; `markAsWaste` (sans zones ni journal) l.636-641 |
| `active → quarantine` | `quarantine` l.627-633 (sans motif, sans retour) |
| `quarantine → *` | **aucune transition codée** (pas de libération, pas de retour fournisseur) |
| `* → expired` | **jamais écrit** (le statut existe dans le CHECK, les requêtes calculent `expiration_date < CURRENT_DATE` à la volée) |
| suppression | `cancelForPurchaseOrder` l.722-727 ; `inventoryRepository.delete` l.438 |

Constat base : **245 lots `active` à quantité 0** (244 avec eco=0 et pesage=0, 239 issus d'une réception, tous créés avant 2026-08-01, 237 sans aucune trace de consommation par lot). Ces lots ont été vidés par un chemin qui ne travaillait pas sur les lots (ajustements d'inventaire physique directs sur `inventory`, cf. §5.1) et n'ont jamais été passés en `depleted`.

---

## 5. Constats chiffrés (SQL, base locale)

### 5.1 `inventory.current_quantity` dérive : double comptage à la réception

Requête :
```sql
WITH l AS (SELECT ingredient_id, store_id,
           COALESCE(SUM(economat_quantity+pesage_quantity) FILTER (WHERE status='active'),0) lots_qty
           FROM ingredient_lots GROUP BY 1,2),
m AS (SELECT i.ingredient_id, i.current_quantity-COALESCE(l.lots_qty,0) diff
      FROM inventory i LEFT JOIN l ON l.ingredient_id=i.ingredient_id AND l.store_id IS NOT DISTINCT FROM i.store_id
      WHERE ABS(i.current_quantity-COALESCE(l.lots_qty,0))>0.001),
lr AS (SELECT DISTINCT ON (ingredient_id) ingredient_id, quantity_received FROM ingredient_lots
       WHERE reception_voucher_item_id IS NOT NULL ORDER BY ingredient_id, created_at DESC)
SELECT 'mismatch', COUNT(*) FROM m
UNION ALL SELECT 'diff>0', COUNT(*) FROM m WHERE diff>0
UNION ALL SELECT 'diff<0', COUNT(*) FROM m WHERE diff<0
UNION ALL SELECT 'diff = qty derniere reception', COUNT(*) FROM m JOIN lr USING (ingredient_id) WHERE ABS(m.diff-lr.quantity_received)<0.001;
```
Résultat : `mismatch 176` sur 377 lignes `inventory` ; `diff>0 119` ; `diff<0 57` ; **`diff = qty dernière réception` : 116**.

Mécanisme (code) : l'INSERT du lot (l.431-437) déclenche `trg_inventory_sync_lots` qui fixe `inventory = SUM(lots actifs)` ; puis l.452-456 ajoute encore `+ qty`. Tant qu'aucun autre mouvement de lot ne re-déclenche le trigger, l'inventaire reste gonflé de la dernière réception.

Preuve sur un cas : ingrédient « Ail » — lot 2026-07-28 reçu 500, `quantity_remaining` 500 ; `inventory.current_quantity` = **1000** ; transactions : `restock 250 (07-01), adjustment −250 (07-06), restock 500 (07-28)`. « Farine viennoiserie » : lots 731, inventaire 1231, dernière réception 500.

Les 57 écarts négatifs viennent du chemin inverse : ajustements d'inventaire physique écrits sur `inventory` sans passer par les lots (ex. « Sirop de glucose » : `restock 500 → adjustment −1000`, inventaire 0, lots 500). Même défaut dans `inventoryController.restock` (`inventory.controller.ts:30-48` : UPDATE inventory puis INSERT lot) et dans `purchaseOrderRepository._adjustInventory` (`purchase-order.repository.ts:506-527` : UPDATE inventory sans lot — 16 mouvements `Admin edit BC%` en base, dont l'effet est **écrasé** au prochain déclenchement du trigger).

Conséquence : trois chemins d'écriture (`inventory` direct, lots, les deux) coexistent alors que la migration 114 a décrété les lots « seul point de vérité ». `inventoryRepository.findAlerts` (l.65-76) et le seuil mini lisent `inventory.current_quantity`, donc les alertes de rupture sont fausses pour 176 ingrédients.

### 5.2 Lots : identité et DLC

| Mesure | SQL | Résultat |
|---|---|---|
| Lots sans `lot_number` | `SELECT COUNT(*) FROM ingredient_lots WHERE lot_number IS NULL` | **634 / 669** (tous les lots de réception) |
| Lots sans `lot_number` ni `supplier_lot_number` | `... WHERE lot_number IS NULL AND (supplier_lot_number IS NULL OR supplier_lot_number='')` | **586** — lot non identifiable |
| Lots sans DLC | `WHERE expiration_date IS NULL` | 616 / 669 ; **389 des 401 lots actifs avec stock** |
| RVI avec DLC saisie | `WHERE expiration_date IS NOT NULL` | 53 / 789 (6,7 %) |
| RVI avec n° de lot fournisseur | 48 / 789 | |
| Lots sans coût | `WHERE unit_cost IS NULL OR unit_cost=0` | 35 (= les lots `ADJ-`/restock) |
| Lots de réception sans fournisseur | 0 | OK |
| Cohérence lot ↔ RVI (qty, prix, date) | `rvi_qty_ne_lot_qty 0`, `lots_cost_ne_rvi_price 0`, `lots_received_at_ne_rv_date 0` | OK |
| RVI ingrédient sans lot | 0 | OK (1 RVI ingrédient = 1 lot) |
| Lots sans BR (`reception_voucher_item_id IS NULL`) | 35 | lots `ADJ-YYMMDD-NNN` (inventaire physique/ajustement) et 6 restocks directs de juin 2026 |
| Lots actifs à 0 | 245 (voir §4.3) | |
| `quantity_remaining ≠ eco + pesage` | 11 | 4 lots créés 2026-10-09 consommés par `BSI-261008-002` (eco 0,923 / remaining 0,846) — chemin BSI en cours de développement sur la base partagée ; à surveiller |

Le numéro interne de lot (séquence `lot_number_seq` créée en 056) n'est **jamais utilisé** : `grep -rn lot_number_seq server/src` → 0. La seule numérotation est `ADJ-` dans `inventory.controller.ts:116-126` (COUNT+1, non verrouillée). L'UI affiche `lot.lot_number` (souvent vide) et `supplier_lot_number`.

### 5.3 Écarts quantité commandée / reçue

| Mesure | Résultat |
|---|---|
| Lignes BC sur-livrées (`quantity_delivered > quantity_ordered`) | **12** (ex. BC-2026-0297 « Prép. poudre crème pâtissière » commandé 0,0035, reçu 5 ; « Semoule kenz » 4 → 20 ; BC-2026-0005 1 → 5) |
| Lignes BC dont `quantity_delivered ≠ SUM(rvi.quantity_received)` | **16** (ex. BC-2026-0124 : 5 lignes à 1500/125/25/125/125 livrées **sans aucune RVI** ; BC-2026-0216 : 300 livré, 600 reçu en RVI ; BC-2026-0002 : 250 vs 274,98) |
| BC `livre_*` sans aucun BR | **2** (BC-2026-0015, BC-2026-0124 — 1 900 kg de farines passés en stock via `replaceItems`) |
| BR sans aucune ligne | **7** (BR-2026-0014, 0020, 0027, 0041, 0042, 0046, 0106 — toutes les qty saisies à 0 ⇒ lignes ignorées l.364, BR vide créé quand même) |
| Lignes sous-livrées sur BC clos | 0 (par construction : `forceComplete` aligne `quantity_ordered`) |
| `delivery_date` NULL sur BC `livre_complet` | 2 |
| BC avec date prévue | 203 ; livrés après la date prévue : **75** (37 %) — aucun écran OTIF |

Le serveur n'applique aucune tolérance (ni quantité ni prix) : `UPDATE ... quantity_delivered + $1` sans comparaison à `quantity_ordered` (l.381-384).

### 5.4 Écart de prix à la réception

| Mesure | Résultat |
|---|---|
| RVI dont `unit_price ≠ poi.unit_price` (après écrasement l.393) | 25 — résidus d'arrondi (10,83 vs 10,832) ou de modifications ultérieures (BC-2026-0172 Myrtille 15 → 18) |
| RVI sans prix | 7 |
| Variations > 10 % entre deux réceptions successives du même ingrédient | **147** couples (`LAG` sur `rvi.unit_price`) — aucune alerte, aucun historique de prix fournisseur (pas de table article-fournisseur : `information_schema.tables ILIKE '%supplier%'` → `suppliers` seulement) |
| Ingrédients `unit_cost = 0` | 27 / 405 |

Le prix saisi écrase le BC (l.393-396) et le coût catalogue (l.462-466) : il n'y a ni « prix commandé vs prix facturé » conservé sur le BC, ni tolérance, ni blocage.

### 5.5 Contrôle qualité, refus, retour, avoir

| Objet | Existe ? | Preuve |
|---|---|---|
| `reception_quality_checks` | table + 2 endpoints + 2 fonctions API client | **0 ligne**, endpoints jamais appelés par une feature |
| Quantité refusée / motif de refus à la réception | non | aucune colonne (`rvi` : `quantity_received` uniquement) |
| Retour fournisseur | non | aucune table (`%return%` → `sale_returns` uniquement, côté ventes) |
| Avoir fournisseur | non | aucune table ; `invoices.invoice_type ∈ {received, emitted}` ; montant négatif non prévu |
| Quarantaine | partielle | `status='quarantine'` posé via UI ; aucune sortie de quarantaine, aucun blocage FEFO explicite autre que `status='active'` |
| Annulation d'une réception | oui, globale | `cancelForPurchaseOrder` : refuse si lot entamé (l.634-651) ou facture payée (l.620-632) ; supprime physiquement BR, lots, transactions, facture (extourne comptable si `LEDGER_AUTOGEN`) ; numéro BR réattribuable |

### 5.6 Qui réceptionne

`reception_vouchers.received_by` : **manager 289, admin 18, 3 utilisateurs distincts**. Routes `confirm-delivery` et `/reception-vouchers` en `ROLE_GROUPS.ADMIN_MANAGER` (`shared/src/constants/roles.ts:25`) ; le rôle `magasinier` (`roles.ts:15`, groupe `WAREHOUSE` l.37) **ne peut pas réceptionner**, alors qu'il tient l'économat et le pesage. La réception se fait depuis l'onglet « Bons de commande » du module Achats (`PurchasingPage.tsx:76`), pas depuis l'économat.

### 5.7 Lien réception → facture (mig 147)

| Mesure | Résultat |
|---|---|
| BR avec `supplier_invoice_number` | 46 / 307 (15 %) |
| Factures auto liées à un BC | 294 ; numéro = n° fournisseur : 40 ; **auto-généré `FR-…` : 249** |
| Factures auto : `tax_amount = 0` | 263 / 294 (TVA par ligne mig 189 non alimentée à la réception) |
| Factures auto sans `due_date` | 279 / 294 ; sans `expected_payment_mode` : 226 — aucune condition de paiement fournisseur appliquée à la création |
| Factures avec `reception_voucher_id` | 292 |
| Doublons (`supplier_id`, `invoice_number`) | 0 |

Le 3-way match n'existe pas : la facture est **générée** à partir du BC/BR (quantités livrées × prix de réception), elle n'est jamais rapprochée d'une facture saisie indépendamment. La fusion multi-BC (`accounting.repository.ts:mergeForPurchaseOrders`) réutilise `createInvoiceFromPo` (35 lignes `invoice_purchase_orders`, 1 facture multi-BC).

### 5.8 Consommables

- Crédit `packaging_store_stock` par `adjustStock` (upsert, `GREATEST(..., 0)` — un stock ne peut jamais être négatif, un retrait trop grand est **tronqué silencieusement**, `packaging-item.repository.ts:154-160`).
- 182 mouvements `reception` (4 739 unités), 6 `adjustment` (−1 022), 161 référencés `purchase_order`. Aucune DLC, aucun lot (choix assumé, en-tête du fichier l.6-14).
- Store de crédit : `data.storeId` sinon **premier magasin créé** (`reception-voucher.repository.ts:356-360`) — 1 seul `stores` en base aujourd'hui.

---

## 6. Numérotation, dates, audit

- BR : `BR-YYYY-NNNN`, `MAX+1` sous verrou consultatif (l.267-282). Une annulation supprime les BR → le numéro suivant **réutilise** le trou (le commentaire l.272-275 le présente comme une robustesse). Pour un auditeur, deux documents différents peuvent avoir porté le même numéro.
- Lot : pas de numéro interne (voir §5.2).
- `reception_date` = date serveur, non saisissable ; `received_at` du lot idem.
- Aucune piste d'audit sur BR (pas de `updated_at`, pas d'auteur de modification, pas de motif d'annulation ; `cancelForPurchaseOrder` ne trace nulle part qui a annulé quoi — contrairement aux BSI depuis la migration 298).
- `inventory_transactions.restock` de réception ne porte pas `ingredient_lot_id` (l.469-476) alors que la colonne existe : la traçabilité mouvement → lot passe par `reception_voucher_id` → RVI → lot.

---

## 7. Ce qui est solide

1. Transaction unique pour BR + RVI + lot + inventaire + statut BC + facture (`create`, l.296-561) avec `FOR UPDATE` sur les lignes BC et l'inventaire.
2. Un lot par ligne de réception ingrédient avec fournisseur, coût et BR (0 RVI sans lot, 0 incohérence lot ↔ RVI).
3. Verrou consultatif sur la numérotation BR.
4. Garde anti-doublon du n° de facture fournisseur par fournisseur (l.316-339).
5. Annulation de réception atomique avec garde-fous (lot entamé, facture payée) et extourne comptable.
6. Saisie par contenant à la réception (mig 226, `DeliveryModal` l.1620-1660) ; 11 ingrédients ont un type de contenant.
7. Fermeture automatique des demandes d'achat à la réception (31 DA en `received`).
8. Routage consommable/ingrédient effectif (155 RVI consommables, journal `packaging_stock_transactions` avec `reference_type`).
9. Vue « Entrées (achats) » par lot/période (`findMaterialPurchases`) distinguant BC vs achat direct.
10. KPI « reçu non facturé » (`dashboard.repository.ts:80-97`) : embryon de GR/IR.

---

## 8. Faiblesses (ordre de sévérité)

| # | Sévérité | Domaine | Constat | Preuve |
|---|---|---|---|---|
| W1 | critique | D5, D10 | Double comptage de l'inventaire à la réception (trigger + UPDATE manuel) ; 176 lignes `inventory` fausses, 116 exactement = dernière réception | `reception-voucher.repository.ts:431-457` ; mig 114 ; SQL §5.1 ; cas « Ail » 1000 vs 500 |
| W2 | critique | D5, D10 | Trois chemins écrivent le stock de façon incompatible : `replaceItems/_adjustInventory` (inventory sans lot, écrasé par le trigger), `inventoryController.restock` (les deux), inventaire physique (inventory direct) | `purchase-order.repository.ts:506-527` ; `inventory.controller.ts:30-48` ; 16 mouvements `Admin edit BC%`, 235 `inventaire physique` ; 245 lots actifs à 0 |
| W3 | critique | D5 | Lots non identifiables : 634 lots sans `lot_number`, 586 sans aucun numéro ; séquence `lot_number_seq` jamais utilisée ; contrainte NOT NULL/UNIQUE de 056 relâchée | INSERT l.431-437 sans `lot_number` ; `\d ingredient_lots` ; `grep lot_number_seq server/src` → 0 |
| W4 | critique | D5 | DLC absente sur 97 % des lots actifs (389/401) ; FEFO et alertes péremption inopérants ; aucune obligation de saisie | `rvi_with_dlc 53/789` ; `DeliveryModal` l.1703-1708 champ optionnel |
| W5 | critique | D5, D6 | Sur-livraison et écart de prix acceptés sans contrôle ni trace : 12 lignes sur-livrées (0,0035 → 5), prix saisi écrase le prix BC et le coût catalogue | l.381-384, 393-396, 462-466 ; §5.3, §5.4 |
| W6 | critique | D5, D10 | Stock livré sans BR ni lot via l'édition admin des lignes (BC-2026-0124 : 1 900 kg de farines) ; 16 lignes BC dont le livré ≠ somme des RVI ; 2 BC livrés sans BR | `replaceItems` l.328-500 ; §5.3 |
| W7 | majeur | D5 | Contrôle qualité réception inexistant en pratique : table `reception_quality_checks` vide, endpoints et API client jamais appelés ; aucun refus/quantité rejetée/motif | §5.5 ; `inventory.api.ts:47-48` |
| W8 | majeur | D5, D6 | Aucun retour fournisseur ni avoir : quarantaine sans issue, `markAsWaste` sans mouvement ni zones | `ingredient-lot.repository.ts:627-641` ; aucune table return/credit |
| W9 | majeur | D5, D10 | Pas de document BR (PDF/impression), pas de consultation des BR dans l'UI (API `receptionVouchersApi` morte), détail BC = cumul seulement | `grep receptionVouchersApi client/src/features` → 0 ; `PODetailModal` l.1255 ; services PDF |
| W10 | majeur | D10 | Le magasinier ne peut pas réceptionner (routes ADMIN_MANAGER) ; 289/307 BR saisis par un manager depuis l'onglet Achats | `reception-voucher.routes.ts` ; `purchase-order.routes.ts:13` ; `roles.ts:25,37` |
| W11 | majeur | D4, D5 | `forceComplete` détruit la commande d'origine (DELETE lignes, `quantity_ordered := quantity_delivered`) : plus de mesure du taux de service ; annulation de réception ne restaure pas | l.486-498 ; commentaire l.580-584 |
| W12 | majeur | D5, D10 | Annulation de réception = suppression physique (BR, lots, transactions, facture) sans trace ; numéro BR réattribué | l.722-757, 267-282 |
| W13 | majeur | D6, D7 | Facture auto créée à la réception sans TVA (263/294 à 0), sans échéance (279/294), 249/294 avec un numéro interne `FR-` au lieu du n° fournisseur ; pas de 3-way match (la facture est dérivée, pas rapprochée) | `createInvoiceFromPo` l.149, 169-170 ; §5.7 |
| W14 | majeur | D9 | Aucune mesure de performance fournisseur : 75/203 BC livrés en retard, 147 variations de prix > 10 % non signalées, pas de fiche article-fournisseur | §5.3, §5.4 |
| W15 | mineur | D5 | 7 BR vides créés quand toutes les qty sont à 0 (lignes ignorées l.364 mais en-tête inséré l.345) | §5.3 |
| W16 | mineur | D5, D10 | `delivery_date` écrasée à chaque réception ; `reception_date` non saisissable (pas de rétro-datation) ; `category_id` RVI jamais renseigné à l'insertion (31/31 depuis mig 255) | l.527, 345-352, 368-373 |
| W17 | mineur | D10 | Endpoint `POST /reception-vouchers` dupliqué et divergent (pas de n° facture, pas de forceComplete, accepte `en_attente`) ; `/inventory/restock` orphelin ; zéro test sur la réception | `reception-voucher.controller.ts:25-46` ; `__tests__/` |
| W18 | mineur | D5 | `inventory_transactions.restock` sans `ingredient_lot_id` ; statut `expired` jamais écrit ; `adjustStock` consommables tronque à 0 sans erreur | l.469-476 ; `packaging-item.repository.ts:154-160` |

---

## 9. Code mort / inutilisé

- `GET /reception-vouchers`, `GET /reception-vouchers/:id`, `POST /reception-vouchers`, `GET /reception-vouchers/purchase-order/:poId` — définis côté client (`purchase-orders.api.ts:48-57`) mais jamais appelés par une feature.
- `POST/GET /ingredient-lots/quality-check/:id` et `reception_quality_checks` (0 ligne).
- `POST /inventory/restock` (`inventory.api.ts:6`, aucune feature) ; `inventoryRepository.restock` (l.78-100) n'est référencé par aucun contrôleur (le contrôleur a sa propre implémentation).
- `packagingItemRepository.receiveBatch` (l.181-206) : `grep receiveBatch server/src` ne retourne que sa définition.
- Séquences `seq_reception_voucher` (055) et `lot_number_seq` (056) : jamais lues.
- Statut de lot `expired` et statut BC `non_livre` (0 occurrence, transition quasi impossible).
- `ingredient_lots.effective_expiry_after_opening` : supprimée en 112 mais présente dans `\d+` de la base locale (dérive schéma local).
- `replenishment_requests` (0 ligne) et son `confirm-reception` : réapprovisionnement inter-magasin inutilisé.

---

## 10. Questions ouvertes

1. Les 11 lots dont `quantity_remaining ≠ eco + pesage` (créés 2026-10-09, consommés par BSI-261008-002) : effet du chantier BSI en cours sur la base partagée (client 4173) ou bug de `consumeBonLines` (`bon-sortie.repository.ts:134-140`) ? À vérifier sur la prod.
2. Qui a relâché `ingredient_lots.lot_number` NOT NULL (aucune migration trouvée) — dérive manuelle à reproduire en prod ?
3. Les 245 lots actifs à 0 : les passer en `depleted` par script ou recalculer depuis l'inventaire physique ?
4. Faut-il conserver `inventory.current_quantity` (cache) ou lire systématiquement `v_ingredient_stock` / les lots (la vue n'est référencée nulle part dans `server/src`) ?
5. Quelle unité de réception pour les consommables achetés en carton/unité (pas de contenant sur `packaging_items`) ?

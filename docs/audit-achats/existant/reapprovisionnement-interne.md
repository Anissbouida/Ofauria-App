# Réapprovisionnement interne (module `replenishment`) — état des lieux

Lecteur : « reapprovisionnement-interne » · Domaines : D2 (besoins), D10 (transverse) · Date : 2026-10-11
Dépôt : `/Users/anissbouida/projets/Ofauria-app` · Base locale (lecture seule) : `localhost:5433/ofauria_db`, dernière migration appliquée `303_foret_noire_10065_fiche_technique.sql` (2026-10-09).

> **Verdict en une phrase.** Le module n'est **pas un module d'achats** : c'est le **réassort de produits finis labo → vitrine boutique** (DRA = demande de réapprovisionnement, caissière → chef → réception caisse). Il est **vivant dans le code** (routes montées, menu, 2 pages, intégré au POS) mais **mort dans les données** (0 demande, 0 ligne, 0 mouvement `replenishment_in`, 0 plan lié) depuis mi-mai 2026, et son rôle « besoins de la boutique » a été repris de fait par le module Contrôle des ventes (`recon_*`, migs 232-265, « fiche de besoin » mig 249). Un audit interne (docs/AUDIT_POS.md § 2, 2026-07-14) avait déjà relevé 11 défauts ; **aucun n'a été corrigé** (dernier commit serveur : 2026-05-20).

---

## 1. Périmètre lu et méthode

| Élément | Fichier | Taille |
|---|---|---|
| Migrations | `server/migrations/040_replenishment_requests.sql`, `043_replenishment_v2.sql`, `044_replenishment_sub_requests.sql`, `045_replenishment_stock_check.sql`, `047_add_batch_id.sql`, `087_vitrine_quantity.sql`, `088_stock_tx_replenishment_in.sql`, `096_partial_reception.sql`, `119_order_sourcing.sql`, `142_production_markup.sql` (+ 042, 053, 057, 083 en périphérie) | — |
| Routes | `server/src/routes/replenishment.routes.ts` (montées dans `server/src/routes/index.ts:23,87` sous `/replenishment`) | 47 l. |
| Contrôleur | `server/src/controllers/replenishment.controller.ts` | 350 l. |
| Repository | `server/src/repositories/replenishment.repository.ts` | 1084 l. |
| Helpers | `server/src/repositories/sourcing.helper.ts` (254 l.), `product-stock.helper.ts` (`transferBackroomToVitrine` l.127-160), `product-lot.repository.ts` (`planFefoBackroomConsumption` l.102, `transferBackroomToVitrine` l.198) | — |
| Client API | `client/src/api/replenishment.api.ts` | 25 l. |
| Écrans | `client/src/features/replenishment/ReplenishmentPage.tsx` (808 l.), `RequestDetailPage.tsx` (896 l.), `client/src/features/pos/POSPage.tsx` (modal l.4434+, transferts l.468-500 et 3777-4060), `client/src/features/production/PlanDetailPage.tsx:84-88, 1581-1625` | — |
| Config | `shared/src/constants/modules.ts:21,63,74-84`, `client/src/config/navigation.ts:93-94`, `client/src/App.tsx:33-34,79-80`, `client/src/components/layout/AppLayout.tsx:157`, `NotificationBell.tsx:97-98` | — |

Méthode : lecture intégrale des fichiers (sed par tranches), grep croisé client/serveur pour chaque endpoint, requêtes SQL en lecture seule (`PGOPTIONS='-c default_transaction_read_only=on'`), historique git par fichier.

---

## 2. À quoi sert réellement le module

Les commentaires de code et les migrations sont sans ambiguïté :

- `087_vitrine_quantity.sql:4-17` : « `stock_quantity` → backroom (magasin) reserve, fed by production ; `vitrine_quantity` → display, **fed only by replenishment reception**, decremented by POS sales … the cashier must trigger a replenishment request + reception to get anything sellable ».
- `product-stock.helper.ts:53-56` : « vitrine_quantity … is filled only by replenishment reception (backroom → vitrine transfer) and is what the POS reads and decrements on every sale ».
- `044_replenishment_sub_requests.sql:1-3` : « split replenishment requests per production chef — Parent request = what the cashier sees ».
- `sale.controller.ts:93` : message POS « Stock vitrine insuffisant … **Faire une demande d'approvisionnement.** »

Objets manipulés : `products` (produits finis), `product_store_stock` (réserve/vitrine par magasin), `production_plans` (plan auto si rupture), `product_lots` (FEFO). **Aucun lien** avec `suppliers`, `purchase_orders`, `ingredients`, `packaging_items`, `reception_vouchers`. Le seul contact avec le domaine Achats est la valeur `reason = 'replenishment'` du CHECK de `purchase_requests` (mig 057:9) — libellé « Approvisionnement » dans `PurchaseRequestsPage.tsx:19` et `IngredientDetailPage.tsx:874` — **0 ligne en base** l'utilise (voir § 10).

**Conclusion D2** : il s'agit d'un flux de **réapprovisionnement interne de produits finis** (boutique ← atelier), pas d'une réquisition d'achat. Dans un ERP standard il relève du « transfert inter-emplacements / réassort point de vente » (Odoo : *Inventory → Transfers / Replenishment*), pas du module Achats.

---

## 3. Historique et vitalité

### 3.1 Git

| Fichier | Dernier commit |
|---|---|
| `routes/replenishment.routes.ts` | `f371b29` 2026-04-07 (création du module) |
| `controllers/replenishment.controller.ts` | `59a17ee` 2026-04-18 |
| `repositories/replenishment.repository.ts` | `ea85329` 2026-05-20 (majoration paramétrable) |
| `api/replenishment.api.ts` | `55d5f54` 2026-05-07 |
| `ReplenishmentPage.tsx` / `RequestDetailPage.tsx` | `4c66f94` 2026-05-13 (refonte Odoo), puis `994518a` 2026-08-13 (refactor nav uniquement) |
| Migrations 040-045 | 2026-04-07 ; 087/088/096 : 2026-04-18 ; 142 : 2026-05-20 |

Aucun commit fonctionnel depuis le **20 mai 2026** ; aucun correctif après l'audit du 14 juillet (`git log --since=2026-07-14` ne renvoie que le refactor nav).

### 3.2 Données (base locale, copie récente de prod)

```sql
SELECT count(*) FROM replenishment_requests;            -- 0
SELECT count(*) FROM replenishment_request_items;       -- 0
SELECT count(*) FROM stock_deliveries;                  -- 0
SELECT count(*) FROM production_plans WHERE replenishment_request_id IS NOT NULL;  -- 0 (sur 27)
SELECT count(*) FROM product_stock_transactions WHERE type='replenishment_in';    -- 0 (5 lignes, toutes 'production')
SELECT to_char(created_at,'YYYY-MM'), type, count(*) FROM notifications
 WHERE reference_type='replenishment_request' GROUP BY 1,2 ORDER BY 1,2;
-- 2026-04 replenishment_discrepancy 1 ; 2026-04 replenishment_request 130 ; 2026-04 replenishment_transferred 52
-- 2026-05 replenishment_request 6   ; 2026-05 replenishment_transferred 2
SELECT count(*), count(*) FILTER (WHERE EXISTS (SELECT 1 FROM replenishment_requests r WHERE r.id=n.reference_id))
  FROM notifications n WHERE reference_type='replenishment_request';            -- 191 | 0  (toutes orphelines, 77 non lues)
```

Lecture : le flux a **tourné du 12 avril au 15 mai 2026** (191 notifications), puis plus rien ; les demandes ont disparu (aucune migration ni script du dépôt ne les purge : `grep -n "DELETE FROM replenishment\|TRUNCATE.*replenishment" server/migrations/*.sql` → vide), les notifications sont restées. Le module Contrôle des ventes apparaît le **13 juillet 2026** (`88ac98f`, mig 232) et porte depuis les notions « appro / reçu / fiche de besoin » (49 journées, 4 159 lignes, 1 569 lignes de fiche).

---

## 4. Schéma de données

### 4.1 `replenishment_requests` (0 ligne, 64 kB)

| Colonne | Type | Origine | Utilisée par le code ? |
|---|---|---|---|
| id, request_number (UNIQUE), store_id→stores, requested_by→users, status, priority, notes, created_at, updated_at | — | 040 | oui |
| needed_by | timestamptz | 040 | écrite (`repo:206` depuis `data.neededBy`) mais **jamais envoyée par le client** (`ReplenishmentPage:494`, `POSPage:4601` n'envoient que priority/notes/items) |
| dispatched_by, dispatched_at, fulfilled_at | — | 040 (V1) | **0 référence** serveur/client → mortes |
| acknowledged_by/at, preparing_at, transferred_by/at, closed_by/at | — | 043 | oui |
| parent_id→self (CASCADE), is_parent, assigned_role | — | 044 | `parent_id` toujours inséré NULL, `is_parent` toujours false (`repo:200-203`) ; `assigned_role` **utilisé** (filtrage chef, notifications) |
| batch_id | uuid | 047 | oui (numérotation) |
| partial_deadline | timestamptz | 096 | **écrite** (`repo:522`) **jamais lue** (1 seule occurrence dans tout `server/src`) |

CHECK `status IN ('submitted','acknowledged','preparing','transferred','partially_received','closed','closed_with_discrepancy','cancelled')` (mig 096). CHECK `priority IN ('low','normal','high','urgent')`.
Index : `idx_replenishment_requests_store`, `_status`, `idx_replenishment_parent_id`, `idx_replenishment_assigned_role`, `idx_replenishment_batch`, `replenishment_requests_request_number_key`.

### 4.2 `replenishment_request_items` (0 ligne, 48 kB)

| Colonne | Origine | Utilisée ? |
|---|---|---|
| id, request_id→requests (CASCADE), product_id→products, requested_quantity (>0), status, notes, created_at | 040 | oui |
| fulfilled_quantity, fulfilled_from_stock, fulfilled_from_production, assigned_to_role | 040 (V1) | **0 référence serveur** ; `fulfilled_from_stock` lu par `PlanDetailPage.tsx:1589,1621` (bloc mort, cf. § 12) |
| qty_to_store, qty_to_stock, qty_received, source, reception_notes | 043 | oui (`qty_to_stock` saisi mais **sans effet stock**) |
| source_type ('stock'/'mixed'/'production'), qty_from_stock, qty_to_produce, production_plan_id→production_plans (SET NULL) | 045 | oui (sourcing) |
| suggested_quantity | 142 | écrite si fournie ; **jamais fournie par `ReplenishmentPage`** (cf. § 14 n°12), fournie par le modal POS |

CHECK `status IN ('pending','preparing','ready','received','received_with_discrepancy')` (mig 043).

### 4.3 `stock_deliveries` (0 ligne, 24 kB) — **table jamais alimentée**

Créée par mig 040 (« Track deliveries from production/stock to store »). `grep -rn stock_deliveries server/src` → 2 occurrences seulement : un `SELECT` dans `replenishment.repository.ts:667` (`checkUnsoldItems`) et un `DELETE` de nettoyage dans `product.repository.ts:262`. **Aucun INSERT dans tout le dépôt.**

### 4.4 Colonnes/valeurs ajoutées à d'autres tables

| Objet | Migration | Usage réel |
|---|---|---|
| `production_plans.replenishment_request_id` (FK SET NULL) + `idx_production_plans_replenishment` | 040 | écrit par `sourcing.helper.ts:201-204` (linkColumn) ; lu par `production.controller.ts:503-513` (notif `production_completed_for_replenishment` : **0 en base**) et `replenishment.repository.ts:565-569` (cascade annulation). 0 ligne non NULL / 27 plans |
| `product_store_stock.vitrine_quantity` | 087 | **cœur du modèle** : 11 fichiers serveur la lisent/écrivent (POS, invendus, retours, pertes, contrôle d'ouverture, lots) |
| `product_stock_transactions` CHECK + `'replenishment_in'` | 088 | écrit uniquement par `replenishment.repository.ts:483-484` ; 0 ligne |
| `stock_frigo_transactions` CHECK `'replenishment_out'` | 083 | branche `referenceType === 'replenishment'` dans `stock-frigo.repository.ts:78` ; **aucun appelant ne passe `'replenishment'`** (`grep -rn "'replenishment'" server/src` hors module → 1 seule occurrence, celle-ci) |
| `purchase_requests.reason` CHECK `'replenishment'` | 057 | 0 ligne (`SELECT reason,status,count(*) … GROUP BY` → `manual/received 2`, `production/received 29`) |
| `order_items.source_type, qty_from_stock, qty_to_produce, production_plan_id` | 119 | **miroir** des colonnes de 045 pour partager `sourcing.helper` avec les commandes clients (13 lignes `source_type='production'`) — à **conserver** |
| `daily_inventory_checks`, `daily_inventory_check_items` | 042 (« Rule 3: closing inventory for replenished items ») | aujourd'hui portées par le **contrôle d'ouverture** (mig 116 : `check_type`, workflow validation) et la caisse (`cash-register.repository.ts:74-107`) — à **conserver** |
| `product_display_tracking` | 053 | 2 lignes ; utilisée par invendus/réexposition — à **conserver** |

Pas de trigger ni de vue dépendant des 3 tables (`pg_trigger`, `pg_depend/pg_rewrite` → vide). **Remarque** : la consigne mentionnait « `inventory_transactions` type `replenishment_in` » — ce type est sur **`product_stock_transactions`** (mig 088) ; `inventory_transactions_type_check` ne le contient pas (`restock, usage, adjustment, waste, recycle, production, open_container, reception`).

### 4.5 FK impliquant les tables du module (pg_constraint)

```
production_plans.replenishment_request_id         → replenishment_requests(id) ON DELETE SET NULL
replenishment_request_items.request_id            → replenishment_requests(id) ON DELETE CASCADE
replenishment_request_items.product_id            → products(id)
replenishment_request_items.production_plan_id    → production_plans(id) ON DELETE SET NULL
replenishment_requests.{requested_by,acknowledged_by,closed_by,dispatched_by,transferred_by} → users(id)
replenishment_requests.store_id                   → stores(id)
replenishment_requests.parent_id                  → replenishment_requests(id) ON DELETE CASCADE
stock_deliveries.{request_id→requests SET NULL, request_item_id→items SET NULL, product_id→products, production_plan_id→plans SET NULL, delivered_by→users, store_id→stores}
```

---

## 5. Machine à états telle que codée

### 5.1 Demande (`replenishment_requests.status`)

```
                 create (caissière)            acknowledge (chef/resp.)       prepare (≥1 ligne préparable)
   [∅] ─────────────────────────► submitted ─────────────────────► acknowledged ─────────────────────► preparing
                                     │                                 ▲   │                                │
                                     │ cancel                          │   │ cancel                         │ transfer
                                     ▼                                 │   ▼                                ▼
                                 cancelled ◄───────────────────────────┼─ cancelled                    transferred
                                     ▲                                 │                                    │
                                     │ cancel                          │ prepare (0 ligne) ─ revert         │ confirm-reception
                                     │                                 │                                    ▼
                           partially_received ◄────────────────────────┘──── (lignes 'pending' restent) ◄──┤
                                     │ prepare (reliquat)                                                   │ (plus de 'pending')
                                     └──────────────────────────► preparing                                 ▼
                                                                                             closed | closed_with_discrepancy
```

| Transition | Garde SQL | Code |
|---|---|---|
| ∅ → submitted | aucune ligne ouverte pour le magasin (`status NOT IN ('closed','closed_with_discrepancy','cancelled')`) sinon **409** | `controller.ts:100-109`, `repository.ts:160-253` (une sous-demande **par rôle chef**, suffixe `-BOUL/-PAT/-VIEN/-BELD/-GEN`, même `batch_id`) |
| submitted → acknowledged | `WHERE status='submitted'` ; chef : `assigned_role = req.user.role` sinon 403 | `controller.ts:155-194`, `repository.ts:255-321` ; déclenche `computeSourcingAndCreatePlan` (plan de production auto si rupture) |
| acknowledged/partially_received → preparing | `WHERE status IN ('acknowledged','partially_received')` ; ne prépare que les lignes `pending` dont la production est faite ; **si 0 ligne préparée, retour à l'état d'origine** | `repository.ts:323-403` (revert l.376-389) |
| preparing → transferred | `WHERE status='preparing'` ; lignes `preparing` → `ready` ; **aucun mouvement de stock** | `repository.ts:405-437` |
| transferred → closed / closed_with_discrepancy / partially_received | `UPDATE … WHERE status='transferred'` (**no-op silencieux si faux, rowCount non vérifié**) ; `partially_received` si des lignes `pending` subsistent (+ `partial_deadline = NOW()+24h`) | `repository.ts:439-546` (mouvement backroom→vitrine l.481-504) |
| submitted/acknowledged/partially_received → cancelled | contrôleur puis `UPDATE … WHERE status IN (...)` ; cascade sur plans non `completed` (draft→cancelled, confirmed…in_progress→items pending cancelled + plan cancelled) | `controller.ts:273-317`, `repository.ts:550-623` |
| `display_status` virtuel `partially_delivered` | acknowledged/partially_received avec ≥1 ligne reçue | `repository.ts:69-76, 148-152` |

### 5.2 Ligne (`replenishment_request_items.status`)

`pending` → (`prepare`) `preparing` → (`transfer`) `ready` → (`confirm-reception`) `received` | `received_with_discrepancy` (si `qty_received ≠ qty_to_store`, `repository.ts:467`).
**Défaut** : `confirmReception` met à jour **toute ligne passée dans le body** sans exiger `status='ready'` (`repository.ts:470-475`), et la demande n'est pas vérifiée `transferred` avant les mouvements.

---

## 6. Endpoints (`/api/replenishment`)

Rôles : `STORE_STAFF = admin, manager, cashier, saleswoman` ; `RESPONSABLE = PRODUCTION (admin, manager, baker, pastry_chef, viennoiserie, beldi_sale) ∪ ADMIN_MANAGER` (`routes.ts:9-11`). Aucun validator (`ls server/src/validators | grep replen` → rien) ; aucun test (`server/src/__tests__` : 0 fichier mentionnant replenishment).

| Méthode | Chemin | Autorisation | Handler (ctrl:ligne → repo:ligne) | Appelé par le client ? |
|---|---|---|---|---|
| GET | `/` | authenticate | `list` 13-32 → `findAll` 28-93 (filtre magasin pour cashier/saleswoman, filtre `assigned_role` pour chefs) | **oui** `ReplenishmentPage.tsx:78` |
| GET | `/recommendations` | authenticate | `recommendations` 325-333 → `getRecommendations` 928-1083 (J-7 → J-14 → moy. 4 occurrences ; majoration `productionMarkupRepository`) | **oui** `ReplenishmentPage:368`, `POSPage:4476` |
| GET | `/check-today` | STORE_STAFF | `checkToday` 53-57 → `findTodayRequestedProductIds` 625, `findTodayRequestedDetails` 639 | **oui** `ReplenishmentPage:350`, `POSPage:4451` |
| GET | `/closing-inventory` | STORE_STAFF | `closingInventory` 86-89 → `getReplenishedItemsToday` 696-742 | **non** (`replenishmentApi.closingInventory` défini `api.ts:8`, 0 appel dans `client/src/features`) |
| GET | `/pending-transfers` | STORE_STAFF | `pendingTransfers` 319-322 → `findPendingTransfers` 882-926 | **oui** `POSPage:468-472` (refetch 30 s) |
| GET | `/:id` | authenticate (+ contrôle `storeId` 46-48) | `getById` 35-50 → `findById` 95-157 | **oui** `RequestDetailPage:100`, `PlanDetailPage:87` |
| POST | `/check-items` | STORE_STAFF | `checkItems` 60-83 → `checkUnsoldItems` 659-694 (**lit `stock_deliveries`, vide → toujours `[]`**) | **oui** `ReplenishmentPage:479`, `POSPage:4579` — mais inopérant |
| POST | `/` | STORE_STAFF | `create` 92-152 → `create` 160-253 ; notifications chefs + manager | **oui** `ReplenishmentPage:455`, `POSPage:4563` |
| POST | `/:id/acknowledge` | RESPONSABLE | `acknowledge` 155-194 → `acknowledge` 255-321 (+ sourcing/plan) | **oui** `RequestDetailPage:107` |
| POST | `/:id/prepare` | RESPONSABLE | `startPreparing` 197-213 → 323-403 | **oui** `RequestDetailPage:117` |
| POST | `/:id/transfer` | RESPONSABLE | `transfer` 216-236 → 405-437 ; notif `cashier` | **oui** `RequestDetailPage:126` |
| POST | `/:id/confirm-reception` | STORE_STAFF | `confirmReception` 239-270 → 439-546 ; notif manager si écart | **oui** `RequestDetailPage:136`, `POSPage:485` |
| POST | `/inventory-check` | STORE_STAFF | `saveInventoryCheck` 335-349 → 744-880 | **non** (`api.ts:23-24` défini, jamais appelé ; le contrôle d'ouverture a sa propre API) |
| POST | `/:id/cancel` | STORE_STAFF + ADMIN_MANAGER | `cancel` 273-317 → 550-623 (cascade plans, notifs) | **oui** `ReplenishmentPage:84,306`, `RequestDetailPage:150` |

Le rôle **`magasinier`** a le module `replenishment` par défaut (`shared/src/constants/modules.ts:84`) mais n'est dans **aucune** liste d'autorisation des routes → il voit le menu et la liste, ne peut rien faire.

---

## 7. Écrans

| Écran | Fichier:lignes | Rôle(s) | Contenu |
|---|---|---|---|
| Liste « Besoins › Demandes » | `ReplenishmentPage.tsx:67-333` | tous les rôles ayant le module ; bouton **Nouveau** si cashier/saleswoman/admin/manager (l.73-74,131-135) | stat tiles, onglets statut, `odoo-table`, annulation en ligne (l.305-310, submitted/acknowledged, demandeur ou admin) |
| Modal « Nouvelle demande » | `ReplenishmentPage.tsx:335-808` (`CreateRequestModal`) | idem | onglet Suggestions (J-7/J-14/Moy., `MARGIN = 1.10` en dur l.358) / Catalogue ; pré-sélection auto (l.380-403, **aléatoire si pas d'historique l.392-393**) ; `checkItems` avant envoi (l.475-487) |
| Détail demande | `RequestDetailPage.tsx:87-896` | `isResponsable` l.92, `isStoreStaff` l.93, `isMyRequest` l.235 | stepper 5 étapes (l.48-62, ignore `partially_received`), panneaux par statut : Prendre en charge l.538, Préparation l.566 (Magasin/Stock/Source par ligne), Valider le transfert l.681, Confirmation de réception l.709 (Attendu/Reçu/Écart/Note), clôture l.756+, tableau Articles l.788+ |
| POS — bouton « Approvisionnement » | `POSPage.tsx:1372, 3739-3747, 4434-~4800` (`ReplenishmentRequestModal`) | caissière | même formulaire que le module, mais **utilise `suggested_qty`/`markup_percent` serveur et envoie `suggestedQuantity`** (l.4463, 4594-4601) ; pré-sélection aléatoire l.4505-4507 |
| POS — « Transferts en attente de confirmation » | `POSPage.tsx:468-500, 3777-4060` | caissière (session ouverte) | fusionne **deux flux** : `replenishmentApi.pendingTransfers` + `productionApi.pendingTransfers` (`production_transfers`, mig 049) |
| Plan de production — « Prélevés du stock » | `PlanDetailPage.tsx:84-88, 1581-1625` | production | charge la demande liée via `replenishment_request_id` ; filtre sur `fulfilled_from_stock`/`status in ('fulfilled','from_stock')` = **schéma V1 (mig 040) jamais écrit par V2** → bloc jamais rendu |
| Cloche notifications | `NotificationBell.tsx:97-98` | tous | `reference_type='replenishment_request'` → `/replenishment/:id` (191 notifications orphelines → « Demande non trouvée ») |

Navigation : groupe **« Production »**, libellé **« Besoins »** (`modules.ts:63`), description « Demandes et transferts de stock » (`navigation.ts:93-94`) ; `AppLayout.tsx:157` retire le padding pour `/replenishment` (style Odoo plein écran). Routes React `App.tsx:79-80`.

---

## 8. Règles métier codées

| # | Règle | Où |
|---|---|---|
| R1 | **Une seule demande ouverte par magasin** : toute création est refusée (409) tant qu'une sous-demande n'est pas close/annulée | `controller.ts:100-109` |
| R2 | Éclatement **par rôle chef** selon la catégorie produit (`getCategoryRole(slug)` → `ROLE_CATEGORY_SLUGS`, `shared/roles.ts:58-76`) ; rôle `general` si catégorie non mappée | `repository.ts:170-203` |
| R3 | Numérotation `DRA-YYYYMMDD-nnn-SUFFIXE`, `nnn` = `COUNT(DISTINCT batch_id)` du jour + 1, verrou advisory | `repository.ts:11-23` (appelé **sans** le client de transaction l.216) |
| R4 | Sourcing à l'acknowledge : backroom (`product_store_stock.stock_quantity`) → frigo semi-fini valide (`stock_semifini_frigo`) → production ; calcul inverse contenants ; floor `min_production_quantity` ; **un** plan `daily` daté du jour, `target_role` = rôle de la sous-demande | `sourcing.helper.ts:53-253` |
| R5 | Préparation partielle : une ligne liée à une production n'est préparable que si l'item est `produced/transferred/received` ou le plan `completed` | `repository.ts:343-365` ; miroir client `RequestDetailPage.tsx:244-256` |
| R6 | Le transfert ne bouge **aucun** stock ; la **réception** déplace `min(backroom disponible, qty reçue)` de `stock_quantity` vers `vitrine_quantity`, journalise `replenishment_in`, consomme les `product_lots` en FEFO et pose la DLV (`display_life_hours`) à la première exposition | `repository.ts:476-505`, `product-stock.helper.ts:127-160`, `product-lot.repository.ts:102-130,198-230` |
| R7 | Écart = `qty_received ≠ qty_to_store` → ligne `received_with_discrepancy`, demande `closed_with_discrepancy`, notification `manager` | `repository.ts:465-475,531-537`, `controller.ts:250-261` |
| R8 | Réception partielle (lignes `pending` restantes) → `partially_received` + `partial_deadline` 24 h (**jamais lue**) | `repository.ts:508-528` |
| R9 | Annulation possible en `submitted/acknowledged/partially_received` ; cascade sur les plans non terminés ; notifications chef + manager | `controller.ts:279-313`, `repository.ts:550-623` |
| R10 | Suggestions : jour cible = lendemain ; cascade J-7 → J-14 → moyenne 4 occurrences ; majoration globale ou par catégorie (`production_markup`, mig 142) ; produits sans historique exclus | `repository.ts:928-1083` |
| R11 | « Déjà demandé aujourd'hui » : simple avertissement client (store_stock > 0), **pas de blocage serveur** | `repository.ts:625-657`, `ReplenishmentPage.tsx:674-679` |
| R12 | « Invendus restants » (`checkItems`) : destiné à bloquer, mais lit `stock_deliveries` (vide) → **jamais déclenché** | `repository.ts:659-694` |
| R13 | Chef : ne peut acknowledge que sa sous-demande (`assigned_role`) ; **aucun** contrôle de rôle/magasin sur prepare/transfer/confirm/cancel | `controller.ts:158-167` vs 197-317 |

---

## 9. Intégrations

| Avec | Mécanisme | État |
|---|---|---|
| **Stock produits finis** | `product_store_stock.stock_quantity` (alimenté par la clôture de production : `production.repository.ts:1120,1593` via `adjustProductStock`) → `vitrine_quantity` (réception DRA). Vitrine aussi modifiée par : POS (`sale.repository.ts:2`, `adjustVitrineStock`), retours (`return.repository.ts`), pertes (`product-loss.repository.ts:128`), invendus (`unsold-decision.repository.ts:545-779`), contrôle d'ouverture (`opening-inventory-check.repository.ts:219,249`) | vivant côté consommateurs ; **seule source d'entrée** = réception DRA (0 depuis mai) → `SUM(vitrine_quantity)=0` localement |
| **Production** | plan auto (sourcing), FK `production_plans.replenishment_request_id`, notif `production_completed_for_replenishment` (`production.controller.ts:502-514`), cascade d'annulation | code présent, **0 plan lié** en base ; `production.repository.ts:1184-1185` : « Replenishment V2 decouples production from replenishment » |
| **Flux parallèle `production_transfers`** (mig 049) | `POST /production/:id/transfer-items` → `production_transfers` ; `POST /production/transfers/:id/receive` (`production.repository.ts:1729-1835`) : ne bouge **aucun** stock, ne fait que passer les items en `received` et compléter le plan | 0 ligne ; affiché dans le même panneau POS que les DRA |
| **POS** | modal de demande + panneau transferts + message « Faire une demande d'approvisionnement » quand vitrine insuffisante (`sale.controller.ts:93`) ; flag `POS_ALLOW_NEGATIVE_STOCK` ON en dev / OFF en prod (`feature-flags.ts`) | en prod, sans réception DRA, **aucune vente POS possible** (409) |
| **Invendus** | CTE `replen_window` = Σ `COALESCE(qty_received, qty_to_store, requested_quantity)` des demandes du jour (`unsold-decision.repository.ts:182-193`) | toujours 0 → le « stock initial » dérivé ignore le réassort |
| **Notifications** | types `replenishment_request`, `replenishment_transferred`, `replenishment_discrepancy`, `production_completed_for_replenishment`, `production_cancelled` | 191 orphelines |
| **Commandes clients** | `sourcing.helper.ts` partagé (`linkColumn: 'replenishment_request_id' | 'order_id'`) ; colonnes miroir `order_items` (mig 119) | vivant côté commandes (13 lignes `source_type='production'`) |
| **Suppression produit** | `product.repository.ts:261-262` supprime `replenishment_request_items` et `stock_deliveries` du produit | — |

---

## 10. Faits base (SQL et résultats)

| Fait | SQL | Résultat |
|---|---|---|
| Tables du module vides | `SELECT (SELECT count(*) FROM replenishment_requests),(SELECT count(*) FROM replenishment_request_items),(SELECT count(*) FROM stock_deliveries)` | `0 / 0 / 0` |
| Aucun mouvement vitrine issu d'une DRA | `SELECT type,count(*) FROM product_stock_transactions GROUP BY type` | `production 5` (2026-10-02 → 10-09) ; `replenishment_in` absent |
| Vitrine à zéro, réserve alimentée | `SELECT count(*), sum(stock_quantity), sum(vitrine_quantity) FROM product_store_stock` | `3 / 104.00 / 0.00` (AMANDINE 35, OPÉRA 10, FORÊT NOIRE 59) |
| Aucun plan lié à une DRA | `SELECT count(*) FILTER (WHERE replenishment_request_id IS NOT NULL), count(*), min(plan_date), max(plan_date) FROM production_plans` | `0 / 27 / 2026-06-16 / 2026-10-08` (27 `completed`/`daily`, 6 avec `bon_sortie_id`, 0 `order_id`) |
| Activité passée du module | `SELECT min(created_at)::date, max(created_at)::date, count(*) FROM notifications WHERE reference_type='replenishment_request'` | `2026-04-12 / 2026-05-15 / 191` |
| Notifications orphelines | `SELECT count(*) FILTER (WHERE read_by IS NULL OR cardinality(read_by)=0), count(*) FROM notifications WHERE reference_type='replenishment_request'` | `77 non lues / 191` ; 0 cible existante |
| Notif production→appro jamais émise | `SELECT count(*) FROM notifications WHERE type='production_completed_for_replenishment'` | `0` |
| `reason='replenishment'` inutilisé en DA | `SELECT reason,status,count(*) FROM purchase_requests GROUP BY 1,2` | `manual/received 2 ; production/received 29` |
| Sourcing partagé vivant via commandes | `SELECT source_type,count(*) FROM order_items GROUP BY 1` | `NULL 10 ; production 13` |
| Contrôle des ventes porte « appro/reçu » | `SELECT count(*), count(*) FILTER (WHERE appro_qty>0), count(*) FILTER (WHERE recu_qty>0), count(*) FILTER (WHERE vendu_qty>0) FROM recon_lines` | `4159 / 1410 / 704 / 3766` ; `recon_days` 49 (2026-07-01 → 2026-10-02) ; `recon_fiche_lines` 1569 ; `recon_shifts` 56 ; `recon_supply_slots` 16 |
| Transferts économat→pesage = autre domaine | `SELECT count(*) FROM ingredient_stock_zone_transfers` | `52` (ingrédients ; code dans `ingredient-lot.repository.ts`, `bon-sortie.repository.ts` ; 0 référence à replenishment) |
| Flux parallèle production_transfers | `SELECT count(*) FROM production_transfers` | `0` |
| Un seul magasin | `SELECT id,name FROM stores` | `00000000-…-0001 / Point de vente principal` |
| Permissions custom | `SELECT u.role, up.can_view, count(*) FROM user_permissions up JOIN users u ON u.id=up.user_id WHERE up.module='replenishment' GROUP BY 1,2` | baker/beldi_sale/pastry_chef/viennoiserie `can_view=t` (1 chacun) ; utilisateurs actifs : admin 3, cashier 2, manager 1, pastry_chef 1 (baker/beldi/viennoiserie inactifs) |
| Ventes locales quasi nulles (POS pas en prod) | `SELECT to_char(created_at,'YYYY-MM'),count(*) FROM sales GROUP BY 1` | `2026-06 2 ; 2026-07 1` ; `sale_items` 0 → `/recommendations` renvoie `[]` |
| Migrations appliquées | `SELECT name FROM _migrations WHERE name ~ '^(040\|043\|044\|045\|047\|083\|087\|088\|096\|119\|142\|262)_'` | les 12 présentes |
| Objets dépendants | `pg_trigger` sur les 3 tables ; vues via `pg_depend` | aucun trigger, aucune vue |

---

## 11. Chevauchements

| Avec | Nature | Verdict |
|---|---|---|
| **`purchase_requests` (DA, D2 achats)** | Objet différent : ingrédient/consommable → fournisseur. Seul lien : valeur `reason='replenishment'` (CHECK mig 057, libellés client) jamais utilisée (0 ligne). | **Pas de chevauchement fonctionnel** ; retirer la valeur du CHECK et les libellés lors d'une refonte des DA. |
| **`ingredient_stock_zone_transfers` (économat → pesage)** | Transfert d'**ingrédients** entre zones, par contenant (mig 225-226) ; code `ingredient-lot.repository.ts`, `bon-sortie.repository.ts`. | **Aucun chevauchement** (ingrédients vs produits finis). Le pattern « demande → préparation → transfert → réception » est le même que le BSI ; une refonte pourrait réutiliser l'UI timeline/BSI. |
| **Contrôle des ventes (`recon_*`, migs 232-265)** | Porte exactement le besoin boutique : `recon_lines.appro_qty` (fiche de besoin), `recu_qty` (reçu réel, mig 235), `recon_supply_slots` (créneaux d'appro), `recon_fiche_lines` (fiche de besoin partagée, mig 249), écart par shift (mig 262). **Saisie manuelle** (`reconciliation.repository.ts:460-461`), aucun pont avec `qty_received`/`replenishment_in` (`grep -i replenishment reconciliation.repository.ts` → 0). Module déclaré « ISOLÉ, TEMPORAIRE ». | **Chevauchement total du concept « Besoins »** : deux fiches de besoin (DRA suggestions J-7 vs `recon_fiche_lines` J-7 par créneau), deux « reçu » (`qty_received` vs `recu_qty`). À fusionner : un seul référentiel « besoin du jour par produit/créneau » → transfert → réception qui alimente à la fois la vitrine (`vitrine_quantity`) et `recu_qty`. |
| **`production_transfers` (mig 049)** | Second flux atelier→boutique (transfert d'items produits, réception caissière), sans mouvement de stock, affiché dans le même panneau POS. | **Doublon** du transfert/réception DRA ; à fusionner en un seul objet « transfert interne de produits finis ». |

---

## 12. Code mort ou jamais appelé

1. **Table `stock_deliveries`** : jamais insérée (§ 4.3) → `checkUnsoldItems` (`repository.ts:659-694`) et l'endpoint `POST /check-items` sont inopérants (le client l'appelle pourtant avant chaque envoi).
2. **`GET /replenishment/closing-inventory`** et **`POST /replenishment/inventory-check`** (`routes.ts:19,42` ; `controller.ts:86-89,335-349` ; `repository.ts:696-880`) : définis dans `replenishment.api.ts:8,23-24`, **jamais appelés** par `client/src/features`. Le contrôle fin de journée est porté par `opening-inventory-check.repository.ts` / invendus. Bug latent dans ce code mort : `ON CONFLICT (product_id, store_id, first_displayed_at)` avec `first_displayed_at = NOW()` ne matche jamais (`repository.ts:858-864`) → doublons `product_display_tracking`.
3. **Colonnes V1** `dispatched_by`, `dispatched_at`, `fulfilled_at`, `fulfilled_quantity`, `fulfilled_from_stock`, `fulfilled_from_production`, `assigned_to_role` : 0 référence serveur.
4. **`parent_id` / `is_parent`** (mig 044) : toujours NULL/false à l'insertion (`repository.ts:200-203`) ; le modèle « parent consolidé » n'a jamais été implémenté (V2 crée des sous-demandes indépendantes).
5. **`partial_deadline`** : écrite (`repository.ts:522`), jamais lue ni affichée.
6. **`needed_by`** : jamais envoyée par les deux formulaires.
7. **`qty_to_stock`** : saisie dans l'UI de préparation (`RequestDetailPage.tsx:640-644`), stockée, **aucun effet** sur le stock ni la réception.
8. **`PlanDetailPage.tsx:1581-1625`** : bloc « Prélevés du stock » filtré sur `fulfilled_from_stock`/`status in ('fulfilled','from_stock')` (schéma V1) → `stockItems.length === 0` toujours → jamais rendu.
9. **`stock-frigo.repository.ts:78`** : branche `'replenishment_out'` sans appelant.
10. **`production_plans.replenishment_request_id`** + notif `production_completed_for_replenishment` (`production.controller.ts:502-514`) : 0 ligne, 0 notification.
11. **`purchase_requests.reason='replenishment'`** (CHECK + libellés `PurchaseRequestsPage.tsx:19,288,384`, `IngredientDetailPage.tsx:874`) : 0 ligne.
12. **Import inutilisé** `ROLE_CATEGORY_SLUGS` (`controller.ts:5`).
13. **`_semiFinishedInfo`** retourné par `acknowledge` (`repository.ts:314`) : jamais exploité côté client.
14. **191 notifications** `reference_type='replenishment_request'` orphelines (77 non lues) → clic = « Demande non trouvée ».
15. Le module entier côté **données** : 0 demande depuis le 15 mai 2026 alors que le code, le menu et le POS le présentent comme le seul moyen d'alimenter la vitrine.

---

## 13. Forces

- **Cycle de vie explicite et horodaté** par acteur : `acknowledged_by/at`, `preparing_at`, `transferred_by/at`, `closed_by/at` ; `received_with_discrepancy` + notification manager (`controller.ts:250-261`).
- **Sourcing automatique factorisé** (`sourcing.helper.ts`) : backroom → frigo semi-fini → production, calcul inverse contenants, floor `min_production_quantity`, plan de production lié, détection semi-finis ; réutilisé par les commandes clients (mig 119).
- **Séparation réserve / vitrine** (mig 087) : la production ne rend pas vendable ; seule la réception confirmée le fait — bon principe de contrôle, avec miroir **FEFO `product_lots`** et pose de la DLV à la première exposition (`repository.ts:490-504`).
- **Suggestions fondées sur l'historique** du même jour de semaine (J-7 → J-14 → moyenne 4) avec **majoration paramétrable** globale/catégorie (mig 142) — logique serveur propre.
- **Éclatement par rôle chef** (`getCategoryRole`) avec `batch_id`, notifications ciblées par rôle, filtrage de la liste par rôle (`repository.ts:46-51`).
- **Transactions SQL** systématiques (BEGIN/COMMIT/ROLLBACK) et verrous `FOR UPDATE` sur `product_store_stock` et `product_lots`.
- **Préparation/transfert/réception partiels** gérés (lignes `pending` conservées, retour en `partially_received`).
- **UI alignée** sur la convention du projet (odoo-control-bar, stat tiles, odoo-table, odoo-btn-*), stepper lisible, écarts visibles ligne à ligne.
- **Cascade d'annulation** vers les plans de production (draft et confirmés), avec notifications.

---

## 14. Faiblesses (par sévérité)

| # | Sév. | Dom. | Constat | Preuve | Impact |
|---|---|---|---|---|---|
| 1 | **critique** | D5, D10 | **Réception rejouable sans garde d'état** : `confirmReception` ne vérifie ni `status='transferred'` sur la demande ni `status='ready'` sur la ligne ; le `UPDATE … WHERE status='transferred'` final est un no-op silencieux (rowCount non testé) mais les mouvements backroom→vitrine et `replenishment_in` sont **commités**. | `repository.ts:439-546` (UPDATE ligne l.470-475 sans filtre statut ; UPDATE demande l.531-537) ; déjà noté AUDIT_POS A1, non corrigé | Double-clic/retry = stock vitrine gonflé sans marchandise ; faux écarts d'inventaire |
| 2 | **critique** | D10, D2 | **Module « seul alimentateur de la vitrine » mort dans les données** : 0 DRA depuis le 15/05/2026, `SUM(vitrine_quantity)=0`, alors que le POS refuse toute vente si vitrine insuffisante (`sale.controller.ts:85-93`) et que le flag `POS_ALLOW_NEGATIVE_STOCK` est OFF en production (`feature-flags.ts`). | § 3.2, § 10 ; `product-stock.helper.ts:53-56` | Si le POS passe en prod sans ce flux (ou un remplaçant), **blocage des ventes** ; si le flag est activé, dérive silencieuse du stock |
| 3 | **majeur** | D5 | **Écart silencieux entre document et stock** : `moved = min(backroom dispo, reçu)` mais la ligne enregistre `qty_received = reçu` et la demande se clôt « conforme » ; aucune réservation entre acknowledge et réception. | `repository.ts:481-485`, `product-stock.helper.ts:147-149` ; AUDIT_POS A10 | Le reçu confirmé ne correspond pas à la vitrine réelle ; écart invisible |
| 4 | **majeur** | D2, D10 | **Blocage opérationnel « une seule demande ouverte par magasin »** combiné à `partial_deadline` jamais lue : une sous-demande `partially_received` dont la production traîne bloque toute nouvelle demande ; seule issue = annuler. | `controller.ts:100-109` ; `repository.ts:522` (1 occurrence) ; AUDIT_POS A6 | Impossible de faire un 2e réassort dans la journée (matin/soir) sans annuler |
| 5 | **majeur** | D5 | **Annulation après réception partielle sans contre-passation** : `cancel` autorisé en `partially_received` alors que des lignes sont déjà reçues et la vitrine déjà incrémentée ; aucun mouvement inverse. | `controller.ts:279`, `repository.ts:556-560` | Demande `cancelled` portant des mouvements de stock réels → traçabilité fausse |
| 6 | **majeur** | D4, D10 | **Collision de numéros DRA** : `generateRequestNumber()` appelé **sans** le client transactionnel → `pg_advisory_xact_lock` pris en autocommit sur une autre connexion (relâché aussitôt) et `COUNT(DISTINCT batch_id)` hors transaction. | `repository.ts:216` vs `11-23` ; AUDIT_POS A3 | Deux caissières simultanées → même `DRA-…-nnn-SUFFIXE` → violation UNIQUE → 500 |
| 7 | **majeur** | D5, D10 | **Aucune validation serveur des quantités** (pas de validator, pas de borne) : `qtyToStore/qtyToStock/qtyReceived` négatifs, > demandé, NaN acceptés ; `items` non typés. | `routes.ts` (aucun `validate`), `controller.ts:197-213, 239-270`, `repository.ts:367-371, 470-475` ; AUDIT_POS A5 | Stock négatif ou gonflé par saisie erronée |
| 8 | **majeur** | D10 | **Contrôles d'accès incomplets** : le contrôle magasin n'existe que sur `getById` (`controller.ts:46-48`) ; le contrôle de rôle chef n'existe que sur `acknowledge` (`controller.ts:158-167`) ; prepare/transfer/confirm/cancel ne vérifient ni magasin ni rôle. Mono-magasin aujourd'hui mais le plan SaaS multi-tenant (mémoire) rend le trou critique. | AUDIT_POS A2, A11 | Un chef peut préparer la demande d'un autre atelier ; une caisse recevoir pour un autre magasin |
| 9 | **majeur** | D5, D10 | **Deux flux parallèles atelier → boutique** : transfert/réception DRA (bouge le stock) et `production_transfers` (mig 049, `production.repository.ts:1729-1835`, **aucun mouvement de stock**), affichés ensemble dans le POS (`POSPage.tsx:3777-3778`). | § 9, § 11 | Deux réceptions caissière pour la même marchandise, dont une sans effet stock ; confusion |
| 10 | **majeur** | D2, D9, D10 | **Concept « Besoins » dupliqué avec le Contrôle des ventes** : `recon_fiche_lines` (fiche de besoin J-7 par créneau, mig 249), `recon_lines.appro_qty/recu_qty` saisis à la main (`reconciliation.repository.ts:460-461`) ; aucun pont avec `qty_received`/`replenishment_in`. | § 11 ; `grep -i replenishment server/src/repositories/reconciliation.repository.ts` → 0 | Double saisie du besoin et du reçu ; deux vérités |
| 11 | **majeur** | D2 | **Règle « invendus » morte** : `checkUnsoldItems` lit `stock_deliveries`, table jamais alimentée → `POST /check-items` renvoie toujours `[]` ; l'UI (« Attention : articles avec stock non vendu ») ne se déclenche jamais. | `repository.ts:659-694` ; grep INSERT → 0 ; AUDIT_POS A7 | Garde-fou annoncé mais inexistant ; appel réseau inutile avant chaque envoi |
| 12 | **majeur** | D2 | **Code de démo en production** : sans historique de ventes, les deux formulaires pré-sélectionnent 12 (module) / 15 (POS) produits **au hasard** avec quantités **aléatoires** (2-9 / 2-11). | `ReplenishmentPage.tsx:391-393`, `POSPage.tsx:4505-4507` ; AUDIT_POS A4 | Demandes fantaisistes envoyées aux ateliers |
| 13 | **majeur** | D2, D9 | **Deux logiques de suggestion divergentes** : `ReplenishmentPage` recalcule avec `MARGIN = 1.10` en dur et n'envoie pas `suggestedQuantity` (`suggested_quantity` reste NULL) ; `POSPage` applique `suggested_qty`/`markup_percent` serveur et l'envoie. La majoration paramétrable (mig 142) est ignorée par la page du module. | `ReplenishmentPage.tsx:358,387,443,494,632` vs `POSPage.tsx:4463,4594-4601` ; AUDIT_POS A8 | Traçabilité suggéré/demandé perdue ; paramètre admin sans effet selon l'écran |
| 14 | **mineur** | D10 | **Nommage incohérent** : module « Besoins » (`modules.ts:63`) dans le groupe **Production** avec description « Demandes et transferts de stock » (`navigation.ts:93-94`) ; « Approvisionnement » dans le POS ; « demande d'approvisionnement » dans les messages ; « Approvisionnement » = aussi une raison de DA (`PurchaseRequestsPage.tsx:19`) et « fiche de besoin » = recon. | § 7, § 11 | Utilisateurs et développeurs confondent réassort boutique, DA fournisseur et fiche de besoin |
| 15 | **mineur** | D10 | **Schéma encombré de colonnes mortes** (V1 + parent/is_parent + partial_deadline + needed_by + qty_to_stock sans effet) et bloc client basé sur le schéma V1 (`PlanDetailPage.tsx:1581-1625`) jamais rendu. | § 4, § 12 | Dette ; lecture du modèle trompeuse |
| 16 | **mineur** | D10 | **Endpoints et repo morts** `GET /closing-inventory`, `POST /inventory-check` (+ `getReplenishedItemsToday`, `saveInventoryCheck`, 185 lignes) avec bug latent `ON CONFLICT first_displayed_at=NOW()`. | `routes.ts:19,42`, `repository.ts:696-880` ; AUDIT_POS A9 | Surface d'attaque/maintenance inutile |
| 17 | **mineur** | D10 | **Notifications orphelines** : 191 (77 non lues) pointent vers des demandes inexistantes ; la cloche navigue vers `/replenishment/:id` → « Demande non trouvée ». | § 10 ; `NotificationBell.tsx:97-98` | Bruit ; perte de confiance dans la cloche |
| 18 | **mineur** | D10 | **Aucun test, aucun validator, import inutilisé** (`ROLE_CATEGORY_SLUGS`, `controller.ts:5`) ; messages d'erreur génériques (409 « ne peut pas être … ») masquant la cause (`controller.ts:191-193, 233-235`). | § 6 | Régressions non détectées ; diagnostic difficile |
| 19 | **mineur** | D10 | **Rôles/UI** : `magasinier` a le module par défaut (`modules.ts:84`) sans aucune route autorisée ; stepper ignore `partially_received` (`RequestDetailPage.tsx:56-62` → index 0 « Envoyée ») ; 4 utilisateurs ont des permissions custom sur un module vide. | § 6, § 7, § 10 | Écrans vides ou incohérents |
| 20 | **mineur** | D4 | **Numérotation par comptage** (`COUNT(DISTINCT batch_id)` du jour, fuseau par interpolation de chaîne) au lieu d'une séquence PostgreSQL ; dépend de `getUserTimezone()`. | `repository.ts:14-23` | Trous/doublons de numérotation possibles, non auditable |

---

## 15. Ce qu'il faudrait retirer ou fusionner — et les dépendances

### 15.1 Décision structurante

Le module n'appartient pas aux Achats. Deux options cohérentes avec un ERP standard :

- **A — Supprimer** le module (code + tables) et confier le réassort boutique au Contrôle des ventes (fiche de besoin `recon_fiche_lines` → transfert → `recu_qty`), en faisant **écrire la vitrine** par ce dernier (aujourd'hui `recu_qty` est purement déclaratif). Risque : le POS n'a plus de source `vitrine_quantity` tant que ce pont n'existe pas.
- **B — Refondre** en un seul objet **« Transfert interne de produits finis »** (atelier → boutique) absorbant DRA + `production_transfers` + fiche de besoin recon, avec réservation à l'acknowledge, garde d'état à la réception, et alimentation simultanée de `vitrine_quantity` et de `recon_lines.recu_qty`.

Dans les deux cas, le domaine Achats (BC/BR/DA/factures) **n'a rien à reprendre** de ce module, sinon retirer la valeur `reason='replenishment'`.

### 15.2 Inventaire des dépendances à traiter (ordre conseillé)

| Étape | Objet | Action | Référence |
|---|---|---|---|
| 1 | Client : routes `/replenishment`, `/replenishment/:id` | retirer ou rediriger | `App.tsx:33-34,79-80` |
| 1 | Menu / module | retirer `replenishment` de `APP_MODULES`, `MODULE_LABELS`, `DEFAULT_ROLE_MODULES` (7 rôles) ; purger `user_permissions WHERE module='replenishment'` (4 lignes) | `shared/src/constants/modules.ts:21,63,74-84`, `navigation.ts:93-94`, `AppLayout.tsx:157` |
| 1 | POS | retirer `ReplenishmentRequestModal` (l.4434+), le bouton l.1372, la query `pendingTransfers` l.468-472 et la mutation l.483-495 ; décider du sort du panneau `production_transfers` | `POSPage.tsx` |
| 1 | PlanDetailPage | retirer la query l.84-88 et le bloc mort l.1581-1625 | `PlanDetailPage.tsx` |
| 1 | NotificationBell | retirer la branche `replenishment_request` ; marquer/supprimer les 191 notifications orphelines | `NotificationBell.tsx:97-98` |
| 2 | Serveur | retirer `routes/replenishment.routes.ts`, `controllers/replenishment.controller.ts`, `repositories/replenishment.repository.ts`, `api/replenishment.api.ts`, le montage `routes/index.ts:23,87` | — |
| 2 | Production | retirer la notif `production_completed_for_replenishment` (`production.controller.ts:502-514`) ; dans `sourcing.helper.ts:49` réduire `linkColumn` à `'order_id'` (ou garder générique pour le futur objet transfert) | — |
| 2 | Invendus | supprimer la CTE `replen_window` (`unsold-decision.repository.ts:182-193`) ou la rebrancher sur le nouvel objet | — |
| 2 | Frigo | retirer la branche `'replenishment_out'` (`stock-frigo.repository.ts:78`) et la valeur du CHECK `stock_frigo_transactions_type_check` | mig 083 |
| 2 | Suppression produit | retirer les 2 DELETE (`product.repository.ts:261-262`) | — |
| 3 | Base — FK sortantes | `production_plans.replenishment_request_id` (+ `idx_production_plans_replenishment`) : DROP COLUMN (0 valeur) | mig 040 |
| 3 | Base — tables | `DROP TABLE stock_deliveries; DROP TABLE replenishment_request_items; DROP TABLE replenishment_requests;` (CASCADE inutile : aucune vue, aucun trigger, FK internes seulement) | migs 040-047, 096, 142 |
| 3 | Base — CHECK | retirer `'replenishment_in'` de `product_stock_transactions_type_check` (0 ligne) ; retirer `'replenishment'` de `purchase_requests_reason_check` (0 ligne) + libellés client `PurchaseRequestsPage.tsx:19,288,384`, `IngredientDetailPage.tsx:874` | migs 088, 057 |
| 3 | Base — à **conserver** | `product_store_stock.vitrine_quantity` (POS, invendus, retours, pertes, contrôle d'ouverture), `daily_inventory_checks*` (contrôle d'ouverture mig 116, caisse), `product_display_tracking`, `order_items` colonnes miroir (mig 119), `production_markup` (mig 142, réutilisable pour la fiche de besoin) | — |
| 4 | Docs | mettre à jour `docs/AUDIT_POS.md` § 2, `docs/AUDIT_FONCTIONNEL.md:87`, `docs/AUDIT_CYCLE_VIE.md:50` | — |

### 15.3 Si l'option B (refonte) est retenue — exigences minimales tirées des constats

1. Garde d'état atomique à la réception (`UPDATE … WHERE status='transferred' RETURNING` avant tout mouvement ; ligne `WHERE status='ready'`) — corrige n°1.
2. Réservation du backroom à l'acknowledge ou refus si `moved < reçu` — corrige n°3.
3. Plusieurs demandes ouvertes par magasin (par créneau), suppression de `partial_deadline` ou job de relance — corrige n°4.
4. Contre-passation à l'annulation après réception partielle — n°5.
5. Séquence PostgreSQL pour la numérotation — n°6, n°20.
6. Validator zod sur tous les bodies ; bornes `0 ≤ qty ≤ demandé` — n°7.
7. Contrôle magasin + rôle sur toutes les transitions — n°8.
8. Fusion avec `production_transfers` et pont vers `recon_lines.recu_qty` — n°9, n°10.
9. Suppression du code aléatoire ; une seule logique de suggestion (serveur) — n°12, n°13.

---

## 16. Questions ouvertes

1. Les 191 notifications d'avril-mai 2026 prouvent une utilisation réelle : les demandes ont-elles été **purgées volontairement** (reset de la base de prod) ou perdues ? La prod contient-elle encore des `replenishment_requests` ?
2. Le POS est-il destiné à passer en production ? Si oui, **quel flux alimentera `vitrine_quantity`** (DRA, nouvel objet transfert, ou saisie du Contrôle des ventes) ?
3. Le module Contrôle des ventes est annoté « ISOLÉ, TEMPORAIRE » (mig 262) : est-il destiné à **remplacer** le réassort DRA ou à disparaître au profit d'un flux stock réel ?
4. `production_transfers` (mig 049) doit-il survivre ? Il ne bouge aucun stock et fait doublon avec la réception DRA.
5. Dans le plan SaaS multi-magasins (mémoire `saas_multi_industries_plan`), le réassort boutique devient un **transfert inter-sites** : faut-il le concevoir dès maintenant comme un objet générique « transfert interne » (ingrédients et produits finis) plutôt que deux flux (BSI/pesage et DRA) ?
6. Faut-il conserver les colonnes miroir `order_items` et `sourcing.helper` tel quel (vivant côté commandes) — oui a priori — et le `production_markup` (mig 142) pour la fiche de besoin ?

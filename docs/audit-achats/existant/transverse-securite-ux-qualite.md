# Audit achats — Lecteur « transverse : sécurité, permissions, validation, notifications, piste d'audit, UX, API, tests » (D10)

Date : 2026-10-11. Dépôt : `/Users/anissbouida/projets/Ofauria-app`. Base locale (copie récente de prod, lecture seule) : `_migrations` max = `303_foret_noire_10065_fiche_technique.sql`.
Tous les chemins sont relatifs au dépôt. Toute requête SQL ci-dessous a été exécutée en `default_transaction_read_only=on`.

---

## 0. Résumé exécutif

Le module achats est servi par 6 fichiers de routes (`purchase-order`, `purchase-request`, `reception-voucher`, `accounting` [suppliers/invoices/payments], `payment-schedule`, `replenishment`) montés dans `server/src/routes/index.ts:76-90,112-114`. **73 endpoints** touchent le périmètre achats (hors réappro magasin), **+14** pour le réappro boutique.

Ce qui tient :
- Authentification systématique (`authenticate` sur 100 % des routes), autorisation **par rôle** (`authorize(...ROLE_GROUPS.*)`), cookie HttpOnly + check Origin/Referer anti-CSRF (`server/src/app.ts:111-115`), Helmet/CSP/HSTS (`app.ts:50-72`), body JSON limité à 10 Ko (`app.ts:134`), redaction des logs (pino).
- SQL 100 % paramétré dans les repositories lus ; transactions + `FOR UPDATE` + advisory locks sur la numérotation BC/BR ; idempotence de la facture auto (`createInvoiceFromPo`, `reception-voucher.repository.ts:77-95`).
- Les actions sensibles sont restreintes à `admin` : `cancel-reception`, `DELETE /purchase-orders/:id`, `DELETE /suppliers/:id`, `unmark-cashed`.

Les 5 problèmes dominants :
1. **Aucune piste d'audit sur les achats** : pas de table d'historique, pas de `updated_by/cancelled_by/sent_by`, et l'annulation de réception **supprime physiquement** BR, lots, mouvements de stock et facture (`reception-voucher.repository.ts:666,723,729,739,743`) — à l'inverse du standard déjà adopté par le projet pour les BSI (mig 298 : `cancelled_by/cancelled_at/cancel_reason`).
2. **Aucun validateur zod sur 73 endpoints achats** alors que le middleware `validate()` / `validateUuidParams()` existe (`server/src/middleware/validate.middleware.ts`) et est utilisé sur 9 autres fichiers de routes. `POST /suppliers` et `POST /invoices` passent `req.body` brut au repository (`accounting.controller.ts:66,184`).
3. **Pas de `asyncHandler` sur purchase-order / reception-voucher / accounting / payment-schedule** (Express 4) : tout rejet non capturé (id non-UUID → erreur Postgres, NOT NULL violé…) laisse la requête pendante côté client ; 8 handlers de `purchaseOrderController` n'ont ni try/catch ni wrapper (`list, eligible, getById, send, markNotDelivered, cancel, updatePrices, overdue`).
4. **Trous de contrôle financier / stock accessibles au `manager`** : `PUT /purchase-orders/:id/items` crée du stock sans réception ni lot (16 ajustements, +1 887,52 unités en base) ; `POST /:id/not-delivered` sans garde de statut ; `PUT /invoices/:id/status` permet de passer une facture en `paid` sans paiement ; `DELETE /invoices/:id?force=true` supprime physiquement facture + paiements ; `DELETE /payments/:id` sans aucun contrôle de propriété ; 70 dépenses fournisseur (26 523,52 DH) saisies sur des catégories `requires_po` sans BC car `ENFORCE_PO_REQUIREMENT = false` (`accounting.controller.ts:668`).
5. **Zéro notification et zéro test sur les achats** : `createNotification` n'est appelé que par `order`, `production`, `replenishment` ; la table `notifications` ne contient aucun `reference_type` achats ; 5 fichiers de tests serveur, aucun sur achats/factures/paiements ; la table `reception_quality_checks` (mig 056) et ses 2 endpoints existent mais **aucun écran** ne les appelle (0 lignes en base).

Côté UX : les 4 écrans achats (`PurchasingPage.tsx` 2 145 l., `PurchaseOrdersTab.tsx` 2 164 l., `PurchaseRequestsPage.tsx` 597 l., `AccountingPage.tsx` 3 990 l.) n'utilisent **ni `ui-timeline` ni `StatusBanner`** (0 occurrence) alors que le BC a 7 statuts ; 11 `confirm()` natifs là où le projet fournit `useConfirm` ; 26 champs Tailwind `border-gray-200 rounded-md` dans `PurchasingPage.tsx` ; 9 `rounded-xl` ; `PurchaseOrdersTab.tsx` est rangé dans `features/accounting` mais rendu sous `/purchasing`.

---

## 1. Surface d'authentification et d'autorisation (D10)

### 1.1 Mécanismes (ce qui existe)

| Mécanisme | Fichier | Constat |
|---|---|---|
| JWT en cookie HttpOnly `ofauria_auth` + fallback Bearer | `server/src/middleware/auth.middleware.ts:18-32` | OK ; blacklist `jti` (`:45`) ; `tokenVersion` invalide le token si rôle/store changent (`:54-64`) |
| Autorisation par rôle | `server/src/middleware/role.middleware.ts:5-19` | Simple inclusion `roles.includes(req.user.role)` — **aucune notion de module ni de can_create/can_edit/can_delete** |
| Groupes de rôles | `shared/src/constants/roles.ts:21-40` | `ADMIN_MANAGER`, `PRODUCTION` (admin+manager+4 chefs), `STORE_STAFF`, `WAREHOUSE` (admin+manager+magasinier) |
| Permissions par module (`user_permissions`) | `server/src/repositories/permission.repository.ts`, `shared/src/constants/modules.ts:72-85` | Lues **uniquement** par `user.controller.ts` (exposition au client) ; **jamais vérifiées par un endpoint métier** (grep `permissionRepository` dans `server/src` → seulement `user.controller.ts`) |
| Contexte store | `server/src/middleware/tenant.middleware.ts` (`requireStoreContext`) | Défini mais **non utilisé par les routes achats** ; chaque contrôleur filtre à la main |
| CSRF | `server/src/middleware/csrf.middleware.ts`, monté `app.ts:115` | Origin/Referer sur toute mutation `/api/v1` |
| Helmet / CORS / HSTS | `app.ts:50-108` | OK |
| Rate limiting | `express-rate-limit` uniquement sur `auth.routes.ts:17,27` et `customers.routes.ts:10,19` | **Aucun sur les achats** |
| Body limit | `app.ts:134` `express.json({ limit: '10kb' })` | Les routes achats ne sont pas dans la liste élargie `ROUTES_WITH_LOCAL_JSON_PARSER` (`app.ts:120-132`) |
| Logs HTTP | `app.ts:29-45` pino-http | Sérialise `id, method, url, remoteAddress` — **pas de `userId`** : impossible de savoir *qui* a fait l'appel depuis les logs |

### 1.2 Incohérences de filtrage store

Trois conventions coexistent pour un seul magasin en base (`SELECT count(*) FROM stores` → 1 ; tous les utilisateurs ont un `store_id`, cf. §6) :

| Contrôleur | Règle | Fichier |
|---|---|---|
| `purchaseOrderController` | admin voit tout, sinon `user.storeId` | `purchase-order.controller.ts:13-15` (`effectiveStoreFilter`) |
| `purchaseRequestController`, `receptionVoucherController`, `invoiceController`, `paymentController` | `req.user.storeId` brut (un admin rattaché à un store ne voit que son store) | `purchase-request.controller.ts:12`, `reception-voucher.controller.ts:10`, `accounting.controller.ts:144,593` |
| `replenishmentController.list` | filtre store uniquement pour `cashier/saleswoman` | `replenishment.controller.ts:8,19` |

Endpoints de mutation **sans vérification de propriété store** (IDOR latent pour le plan SaaS multi-tenant) : `PUT /purchase-requests/:id/quantity`, `PUT /purchase-requests/:id/supplier`, `POST /purchase-requests/:id/cancel` (`purchase-request.controller.ts:41-83`), `GET /reception-vouchers/purchase-order/:poId` (`reception-voucher.controller.ts:49-52`), `PUT /invoices/line/:id/category` (`accounting.controller.ts:167-174`), `POST /invoices/:id/cancel` (`:224-227`), `PUT /payments/:id`, `DELETE /payments/:id` (`:732-739`), `POST /purchase-orders/:id/send|not-delivered|cancel|update-prices` (`purchase-order.controller.ts:65-125,164-178`).

---

## 2. Tableau COMPLET des endpoints achats

Légende : AM = `ROLE_GROUPS.ADMIN_MANAGER` (admin, manager) ; A = admin seul ; P = `ROLE_GROUPS.PRODUCTION` (admin, manager, baker, pastry_chef, viennoiserie, beldi_sale) ; auth = tout utilisateur authentifié. « Val. » = validateur zod via `validate()` ; « inline » = vérifications manuelles dans le contrôleur. « AH » = enveloppé par `asyncHandler` ou try/catch local. « Client » = grep du chemin / de la méthode dans `client/src/api` **et** usage effectif dans `client/src/features|components`.

### 2.1 Bons de commande — `/api/v1/purchase-orders` (`server/src/routes/purchase-order.routes.ts`)

| # | Méthode | Chemin | Handler (`purchase-order.controller.ts`) | Rôle | Val. | AH | Client |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/` | `list` :18 | AM | non (query brute) | **non** | oui — `PurchaseOrdersTab.tsx` |
| 2 | GET | `/eligible` | `eligible` :26 | AM | — | **non** | oui — `AccountingPage.tsx` |
| 3 | GET | `/overdue` | `overdue` :293 (`parseInt(days)` sans garde NaN :294) | AM | non | **non** | oui — `PurchaseOrdersTab.tsx` |
| 4 | GET | `/:id` | `getById` :31 | AM | pas d'UUID check | **non** | oui |
| 5 | POST | `/` | `create` :41 | AM | inline (`supplierId`, `items.length`) ; pas de type/qté | try/catch :51 | oui |
| 6 | POST | `/:id/send` | `send` :65 | AM | garde statut `en_attente` :68 | **non** | oui |
| 7 | POST | `/:id/confirm-delivery` | `confirmDelivery` :76 | AM | inline statut + `items` | try/catch | oui |
| 8 | POST | `/:id/not-delivered` | `markNotDelivered` :104 | AM | **aucune garde de statut** :104-109 | **non** | oui |
| 9 | POST | `/:id/cancel` | `cancel` :111 | AM | refuse `livre_complet`/`annule` seulement :114 (un `livre_partiel` avec stock reçu peut être annulé) | **non** | oui |
| 10 | POST | `/:id/cancel-reception` | `cancelReception` :127 | **A** | gardes repo (409) | try/catch | oui |
| 11 | POST | `/:id/update-prices` | `updatePrices` :164 | AM | inline `items` | **non** | **NON — mort** (`purchaseOrdersApi.updatePrices` défini `client/src/api/purchase-orders.api.ts:21`, 0 usage) |
| 12 | POST | `/:id/invoice` | `generateInvoice` :253 | AM | gardes repo | try/catch | oui |
| 13 | PUT | `/:id` | `updateHeader` :180 | AM | aucune (cast `as string`) | try/catch | oui |
| 14 | PUT | `/:id/items` | `replaceItems` :206 | AM | inline (article + qté>0) ; `quantityDelivered` libre | try/catch | oui |
| 15 | GET | `/:id/download-pdf` | `downloadPdf` :299 | AM | — | try/catch | oui |
| 16 | DELETE | `/:id` | `remove` :141 | **A** | garde statut `en_attente`/`annule` :144 | try/catch | oui |

### 2.2 Bons de réception — `/api/v1/reception-vouchers` (`reception-voucher.routes.ts`)

| # | Méthode | Chemin | Handler (`reception-voucher.controller.ts`) | Rôle | Val. | AH | Client |
|---|---|---|---|---|---|---|---|
| 17 | GET | `/` | `list` :7 | AM | — | **non** | **NON — mort** (`receptionVouchersApi.list` 0 usage) |
| 18 | GET | `/:id` | `getById` :15 | AM | — | **non** | **NON — mort** |
| 19 | POST | `/` | `create` :24 | AM | inline | **non** (le repo lève des erreurs `statusCode 409` qui ne seront jamais rendues → requête pendante) | **NON — mort** (la réception passe par `POST /purchase-orders/:id/confirm-delivery`) |
| 20 | GET | `/purchase-order/:poId` | `findByPurchaseOrder` :49 | AM | — | **non** | **NON — mort** |

> Conséquence : l'écran BC n'affiche **jamais la liste des BR** d'un BC (grep `reception|voucher|BR-` dans `PurchaseOrdersTab.tsx` → seulement des commentaires, lignes 95-163, 1444-1763). Le numéro `BR-YYYY-NNNN` n'est visible nulle part dans l'UI.

### 2.3 Demandes d'achat — `/api/v1/purchase-requests` (`purchase-request.routes.ts`, tous enveloppés `asyncHandler`)

| # | Méthode | Chemin | Handler (`purchase-request.controller.ts`) | Rôle | Val. | Client |
|---|---|---|---|---|---|---|
| 21 | GET | `/` | `list` :6 | AM | — | oui — `PurchaseRequestsPage.tsx` |
| 22 | GET | `/grouped` | `grouped` :17 | AM | — | oui |
| 23 | GET | `/count` | `count` :103 | **auth** | — | **NON — mort** |
| 24 | POST | `/` | `create` :22 | **auth (tout rôle, caissier inclus)** | inline (`ingredientId, quantity>0, unit`) ; `reason` non contrôlé côté API (CHECK en base) | oui — `IngredientDetailPage.tsx:280`, `BonSortiePanel.tsx:210`, `TransferRequestsList.tsx`, `RuptureRequestsList.tsx` |
| 25 | PUT | `/:id/quantity` | `updateQuantity` :41 | AM | inline | **NON — mort** |
| 26 | PUT | `/:id/supplier` | `assignSupplier` :55 | AM | — | **NON — mort** (le client n'utilise que le bulk) |
| 27 | POST | `/bulk-assign-supplier` | `bulkAssignSupplier` :65 | AM | inline | oui |
| 28 | POST | `/:id/cancel` | `cancel` :75 | AM | — | oui |
| 29 | POST | `/generate-po` | `generatePO` :85 | AM | inline | oui |

> `generatePurchaseOrder` lève `new Error('Aucune demande en attente…')` sans `statusCode` (`purchase-request.repository.ts:186`) → `errorHandler` renvoie **500 « Erreur interne du serveur »** en prod (`error.middleware.ts:31-33`) : message métier perdu.

### 2.4 Fournisseurs — `/api/v1/suppliers` (`accounting.routes.ts:36-42`)

| # | Méthode | Chemin | Handler (`accounting.controller.ts`) | Rôle | Val. | AH | Client |
|---|---|---|---|---|---|---|---|
| 30 | GET | `/` | `list` :56 | **P** (pas magasinier, pas caissier) | — | non | oui — 10 usages dont `IngredientDetailPage.tsx` (module économat accordé au magasinier → **403 pour lui**) |
| 31 | GET | `/:id` | `getById` :60 | P | — | non | **NON — mort** |
| 32 | POST | `/` | `create` :65 `supplierRepository.create(req.body)` | AM | **aucune** (`name` NOT NULL non vérifié → rejet Postgres non capturé) | **non** | oui |
| 33 | PUT | `/:id` | `update` :69 | AM | whitelist de colonnes dans le repo (`accounting.repository.ts:334-337`) | **non** | oui |
| 34 | DELETE | `/:id` | `remove` :73 (soft : `is_active=false`, `accounting.repository.ts:347-349`) | **A** | — | **non** | oui — bouton visible au manager (`PurchasingPage.tsx:125`, aucune garde de rôle) → 403 « Erreur lors de la désactivation » |

### 2.5 Factures (reçues + émises) — `/api/v1/invoices` (`accounting.routes.ts:58-82`)

| # | Méthode | Chemin | Handler (`accounting.controller.ts`) | Rôle | Val. | AH | Client |
|---|---|---|---|---|---|---|---|
| 35 | GET | `/` | `list` :138 | AM | — | non | oui — `PurchasingPage.tsx`, `EmittedInvoicesTab.tsx` |
| 36 | GET | `/line-expenses` | `lineExpenses` :147 | AM | — | non | oui — `AccountingPage.tsx` |
| 37 | GET | `/payment-alerts` | `paymentAlerts` :302 | AM | `days` borné 1-60 | non | oui — `PaymentAlertsWidget.tsx` |
| 38 | GET | `/debts` | `debts` :316 | AM | — | non | oui — `AccountingPage.tsx` |
| 39 | GET | `/:id` | `getById` :175 | AM | — | non | oui |
| 40 | PUT | `/line/:id/category` | `updateLineCategory` :167 | AM | — ; **pas de store check** | non | oui — `AccountingPage.tsx:2232` |
| 41 | PUT | `/:id/category` | `updateCategory` :154 | AM | — | non | **NON — mort** |
| 42 | PUT | `/:id/items` | `replaceItems` :329 | AM | inline | try/catch | oui |
| 43 | PUT | `/:id/payment-terms` | `updatePaymentTerms` :368 | AM | mode règlement via référentiel | non | **NON — mort** (remplacé par PUT `/:id`) |
| 44 | PUT | `/:id/status` | `updateStatusManual` :384 | AM | liste blanche incluant **`paid`** :391 | non | oui — `PurchasingPage.tsx:527,949` |
| 45 | PUT | `/:id` | `update` :233 | AM | mode règlement ; montants via `num()` | try/catch | oui |
| 46 | POST | `/` | `create` :183 `{ ...req.body, createdBy, storeId }` | AM | **aucune** (pas de `invoiceDate`/`amount` requis côté API) | **non** | oui |
| 47 | POST | `/from-order/:orderId` | `createFromOrder` :189 | AM | — | non | oui — `EmittedInvoicesTab.tsx` (ventes, hors achats) |
| 48 | POST | `/merge` | `merge` :200 | AM | inline (≥2 BC) | try/catch | oui — `PurchaseOrdersTab.tsx` |
| 49 | POST | `/:id/schedule` | `paymentScheduleController.createInvoiceSchedule` | AM | inline (1-120) | try/catch | oui — `PurchasingPage.tsx` |
| 50 | POST | `/:id/cancel` | `cancel` :224 | AM | **aucune** (ni store, ni garde « facture payée ») | **non** | oui |
| 51 | DELETE | `/:id?force=true` | `remove` :283 → `deleteById` (`accounting.repository.ts:1248`) | **AM** | — | try/catch | oui — `PurchasingPage.tsx:483,514-520` (double `confirm()` natif) |
| 52 | POST | `/:id/attachment` | `uploadAttachment` :399 (multer 10 Mo, extensions whitelist `accounting.routes.ts:20-28`) | AM | ext. uniquement (pas de MIME sniff) | non | oui |
| 53 | DELETE | `/:id/attachment` | `removeAttachment` :408 | AM | — | non | oui |
| 54 | GET | `/:id/download-docx` | `downloadDocx` :412 | AM | — | try/catch | **NON — alias mort** |
| 55 | GET | `/:id/download-pdf` | `downloadDocx` :412 (même handler) | AM | — | try/catch | oui — `EmittedInvoicesTab.tsx` seulement (pas pour les factures reçues) |

### 2.6 Paiements — `/api/v1/payments` (`accounting.routes.ts:98-111`)

| # | Méthode | Chemin | Handler (`accounting.controller.ts`) | Rôle | Val. | AH | Client |
|---|---|---|---|---|---|---|---|
| 56 | GET | `/` | `list` :588 | AM | — | non | oui — `AccountingPage.tsx` |
| 57 | GET | `/summary` | `summary` :740 | AM | dates requises | non | **NON — mort** |
| 58 | GET | `/checks` | `listChecks` :597 | AM | `status` whitelist | non | oui |
| 59 | POST | `/` | `create` :637 | AM | catégorie obligatoire si `expense` :680 ; **`ENFORCE_PO_REQUIREMENT = false`** :668 ; pas de validation `amount` numérique/>0 au contrôleur (gardes de sur-paiement dans le repo `:1958-1969`) | **non** (les erreurs `statusCode 409` du repo ne sont pas capturées → pendante) | oui — 5 usages |
| 60 | PUT | `/:id` | `update` :732 `paymentRepository.update(req.params.id, req.body)` | AM | whitelist repo (`:2072-2078`) ; **pas de store check** | **non** | oui — `AccountingPage.tsx` |
| 61 | POST | `/:id/mark-cashed` | `markCashed` :612 | AM | — | try/catch | oui |
| 62 | POST | `/:id/unmark-cashed` | `unmarkCashed` :628 | **A** | — | try/catch | oui |
| 63 | DELETE | `/:id` | `remove` :736 `paymentRepository.delete(id)` | **AM** | **aucune** (ni store, ni garde chèque encaissé) | **non** | oui — `AccountingPage.tsx`, `PurchasingPage.tsx:1991` |

### 2.7 Échéancier, dettes, charges fixes (`payment-schedule.routes.ts`, garde AM partout, aucun `asyncHandler`, try/catch locaux)

| # | Méthode | Chemin | Handler | Client |
|---|---|---|---|---|
| 64 | GET | `/payment-schedules` | `list` | oui — `EcheancierView.tsx` |
| 65 | GET | `/payment-schedules/by-source/:kind/:id` | `bySource` | **NON — mort** |
| 66 | PATCH | `/payment-schedules/:id` | `update` | oui |
| 67 | GET | `/debts` | `listDebts` | **NON — mort** (le client lit `/invoices/debts`) |
| 68 | POST | `/debts` | `createDebt` | oui |
| 69 | PATCH | `/debts/:id` | `updateDebt` | **NON — mort** (`debtsApi.setStatus` 0 usage) |
| 70 | DELETE | `/debts/:id` | `removeDebt` | **NON — mort** |
| 71 | GET | `/recurring-charges` | `listRecurring` | oui |
| 72 | POST | `/recurring-charges` | `createRecurring` | oui |
| 73 | PATCH | `/recurring-charges/:id` | `updateRecurring` | oui |
| 74 | DELETE | `/recurring-charges/:id` | `removeRecurring` | oui |

### 2.8 Lots / qualité réception (`ingredient-lot.routes.ts`, partie achats)

| # | Méthode | Chemin | Rôle | Client |
|---|---|---|---|---|
| 75 | GET | `/ingredient-lots/quality-check/:id` | auth | **NON — mort** (`inventoryApi.getQualityCheck` défini `client/src/api/inventory.api.ts:48`, 0 usage) |
| 76 | POST | `/ingredient-lots/quality-check/:id` | AM | **NON — mort** (`saveQualityCheck` :47, 0 usage) → table `reception_quality_checks` (mig 056) : **0 ligne** |

### 2.9 Réappro boutique — `/api/v1/replenishment` (`replenishment.routes.ts`, hors achat fournisseur : transfert production→boutique ; tous `asyncHandler`)

14 routes : `GET /` (auth), `GET /recommendations` (auth), `GET /check-today`, `/closing-inventory`, `/pending-transfers` (STORE_STAFF), `GET /:id` (auth, UUID check inline `:36`), `POST /check-items`, `POST /` (STORE_STAFF), `POST /:id/acknowledge|prepare|transfer` (PRODUCTION+AM), `POST /:id/confirm-reception` (STORE_STAFF), `POST /inventory-check` (STORE_STAFF), `POST /:id/cancel` (STORE_STAFF+AM).
Usages client (`replenishmentApi.*`) : tous utilisés **sauf** `closingInventory` (`GET /closing-inventory`) et `saveInventoryCheck` (`POST /inventory-check`) → **2 endpoints morts**. Volume : `replenishment_requests` = 0 ligne en base locale.
Point positif : c'est le seul flux du périmètre qui notifie (`replenishment.controller.ts:126,140,221,251,290,303`) et qui porte des colonnes d'audit par étape (`acknowledged_by/at, transferred_by/at, closed_by/at, dispatched_by/at`).

### 2.10 Synthèse chiffrée

- Endpoints achats stricts (2.1→2.8) : **76** ; avec validateur zod : **0** ; avec `asyncHandler` : 9 (DA uniquement) ; avec try/catch local : 17 ; **sans aucune capture d'erreur : 50**.
- `validateUuidParams` : utilisé par `bon-sortie.routes.ts:10-12` et `production.routes.ts:7`, **jamais** sur les achats.
- Endpoints morts (jamais appelés par le client) : **21** — liste en §3.

---

## 3. Endpoints morts (jamais appelés par `client/src`)

| Endpoint | Fichier route | Remarque |
|---|---|---|
| `POST /purchase-orders/:id/update-prices` | `purchase-order.routes.ts:20` | Remplacé par `PUT /:id/items` ; conserve une logique de bascule `en_attente_facturation → livre_complet` dupliquée (`purchase-order.repository.ts:223-290`) |
| `GET /reception-vouchers` | `reception-voucher.routes.ts:9` | |
| `GET /reception-vouchers/:id` | `:10` | |
| `POST /reception-vouchers` | `:11` | Doublon fonctionnel de `confirm-delivery`, sans try/catch |
| `GET /reception-vouchers/purchase-order/:poId` | `:12` | Sans contrôle store |
| `GET /purchase-requests/count` | `purchase-request.routes.ts:15` | |
| `PUT /purchase-requests/:id/quantity` | `:17` | |
| `PUT /purchase-requests/:id/supplier` | `:18` | |
| `GET /suppliers/:id` | `accounting.routes.ts:39` | |
| `PUT /invoices/:id/category` | `:65` | |
| `PUT /invoices/:id/payment-terms` | `:67` | |
| `GET /invoices/:id/download-docx` | `:81` | Alias du même handler que `download-pdf` |
| `GET /payments/summary` | `:100` | |
| `GET /payment-schedules/by-source/:kind/:id` | `payment-schedule.routes.ts:14` | |
| `GET /debts` | `:19` | |
| `PATCH /debts/:id` | `:21` | |
| `DELETE /debts/:id` | `:22` | |
| `GET /ingredient-lots/quality-check/:id` | `ingredient-lot.routes.ts:17` | Contrôle qualité réception : schéma + API sans UI |
| `POST /ingredient-lots/quality-check/:id` | `:24` | idem |
| `GET /replenishment/closing-inventory` | `replenishment.routes.ts:19` | |
| `POST /replenishment/inventory-check` | `:42` | |

Méthodes API client définies mais non utilisées (dette côté client) : `purchaseOrdersApi.updatePrices`, `receptionVouchersApi.*` (4), `purchaseRequestsApi.count|updateQuantity|assignSupplier`, `suppliersApi.getById`, `invoicesApi.updateCategory|updatePaymentTerms`, `paymentsApi.summary`, `paymentSchedulesApi.bySource`, `debtsApi.list|setStatus|remove`, `inventoryApi.saveQualityCheck|getQualityCheck`, `replenishmentApi.closingInventory|saveInventoryCheck`.

---

## 4. Validation des entrées

- Middleware disponible : `validate(schema)`, `validateQuery(schema)`, `validateUuidParams(...)` (`server/src/middleware/validate.middleware.ts:4-55`). Validateurs zod existants : 13 fichiers dans `server/src/validators/` (auth, bon-sortie, employees, product-loss, product, production*, recipe*, return, sale, stock-frigo) — **aucun pour achats, fournisseurs, factures, paiements**.
- `grep -n validate server/src/routes/{purchase-order,purchase-request,reception-voucher,replenishment,accounting,payment-schedule}.routes.ts` → **0 résultat**.
- Cas concrets :
  - `POST /suppliers` : `supplierRepository.create(req.body)` (`accounting.controller.ts:66`) ; `name` NOT NULL non vérifié ; pas de format `email`, `phone`, `ice` (15 chiffres au Maroc) → en base 27/40 fournisseurs sans ICE, 2 fournisseurs distincts (`Carrefour`, `Supeco`) partagent l'ICE `000078523000008`, 15 sans téléphone ni e-mail.
  - `POST /invoices` : `{ ...req.body, createdBy, storeId }` (`:184`) → `invoiceType`, `supplierId`, `amount`, `invoiceDate` non validés ; `invoice_number` **sans contrainte d'unicité** en base (`\d invoices` : aucun index sur `invoice_number`) ; la seule garde anti-doublon de N° fournisseur est dans le chemin réception (`reception-voucher.repository.ts:309-330`), pas dans la saisie manuelle.
  - `POST /purchase-orders` : `items[].quantityOrdered`, `unitPrice`, `ingredientId|packagingId` non typés (`purchase-order.controller.ts:42-45`) ; la contrainte `po_item_kind_check` en base fera échouer la transaction avec un message Postgres brut renvoyé en 500 (`:60-61`).
  - `PUT /purchase-orders/:id` : `body.supplierId as string` sans existence check (`:195`).
  - `GET /purchase-orders/overdue?days=abc` : `parseInt` → NaN → erreur SQL non capturée (`:294`).
  - Paramètres `:id` non-UUID → erreur `22P02` Postgres non capturée sur 50 handlers (cf. §2.10).
- Taille de corps : 10 Ko global (`app.ts:134`). Un BC compte au plus 17 lignes en base (P95 = 7), payload `replaceItems` ≈ 170 o/ligne → plafond ≈ 55 lignes ; `confirm-delivery` avec lot/DLC ≈ 220 o/ligne → ≈ 45 lignes. Pas de risque immédiat, mais pas de parser local élargi comme pour `/settings`, `/reconciliation`.

---

## 5. Machine à états telle que CODÉE

### 5.1 BC (`purchase_orders.status`, CHECK : `en_attente, envoye, livre_complet, livre_partiel, non_livre, annule, en_attente_facturation`)

| Transition | Où | Garde |
|---|---|---|
| ∅ → `en_attente` | `purchase-order.repository.ts:125-170` (`create`), `purchase-request.repository.ts:162-251` (`generatePurchaseOrder`) | — |
| `en_attente` → `envoye` | `controller.send` :65-74 → `updateStatus` | statut = `en_attente` (409 sinon) ; **aucun envoi réel** (pas d'e-mail/WhatsApp), pas de `sent_by/sent_at` |
| `envoye`/`livre_partiel` → `livre_partiel` / `livre_complet` / `en_attente_facturation` / `non_livre` | `reception-voucher.repository.ts:496-528` (calcul après insertion des RVi) | `allDelivered && hasMissingPrices` → `en_attente_facturation` ; `allDelivered` → `livre_complet` ; `someDelivered` → `livre_partiel` ; sinon `non_livre` (:523, atteignable seulement si toutes les lignes reçues sont à 0) ; `forceComplete` **supprime** les lignes non livrées et aligne `quantity_ordered` sur `quantity_delivered` (:488-498) |
| `livre_complet` → facture auto | `:539-545` → `createInvoiceFromPo` (:77) | idempotent ; prix effectif = dernier prix RVi sinon BC |
| `en_attente_facturation` → `livre_complet` | `updateItemPrices` :223-290 (endpoint **mort**) et `replaceItems` :328-500 (resync :461-487) | tous les prix saisis |
| tout statut → `non_livre` | `controller.markNotDelivered` :104-109 | **aucune** (un `livre_complet` avec stock et facture peut être marqué non livré) |
| tout statut sauf `livre_complet`/`annule` → `annule` | `controller.cancel` :111-125 | un `livre_partiel` (stock déjà crédité, lots créés) peut être annulé sans extourne |
| `livre_*`/`en_attente_facturation` → `envoye` | `cancelForPurchaseOrder` (`reception-voucher.repository.ts:586-765`, admin) | refuse si facture payée ou lot entamé ; **supprime physiquement** facture, lots, `inventory_transactions`, RVi, RV (:666-743) |
| `en_attente`/`annule` → suppression physique | `controller.remove` :141-162 → `delete` :545 | FK sur `reception_vouchers`/`payments` → 409 |
| n'importe quel statut → recalcul par édition admin | `replaceItems` :461-487 | `quantity_delivered` modifiable à la main → stock ajusté (`_adjustInventory` :506-527, type `adjustment`, **sans `ingredient_lots`**) |

Aucune table d'historique de statut ; `updated_at` est posé manuellement dans chaque UPDATE (pas de trigger : `information_schema.triggers` sur `purchase_orders` → 0).

### 5.2 BR (`reception_vouchers`) : création uniquement (`create` :284) ; suppression physique par `cancelForPurchaseOrder`. Pas de statut.

### 5.3 DA (`purchase_requests.status`, CHECK `pending, assigned, ordered, received, cancelled`)
`pending` → `assigned` (`generatePurchaseOrder` :237-241) → `received` (`closePurchaseRequestsForOrder`, `purchase-request.helper.ts:32-48`, appelé depuis réception/`replaceItems`/`updateItemPrices`) ; `pending` → `cancelled` (`cancel` :148-159, note concaténée, pas de `cancelled_by`). `ordered` n'est jamais écrit par le code (grep `'ordered'` → seulement dans la liste du helper).

### 5.4 Facture reçue (`invoices.status`, CHECK `pending, partial, paid, overdue, cancelled, disputed`)
Calcul automatique par `updatePaidAmount` (`accounting.repository.ts:934-976`) à chaque paiement/suppression ; `disputed`/`cancelled` préservés sauf si soldée. Statut manuel libre via `PUT /:id/status` (`pending, partial, paid, overdue, cancelled, disputed`). `overdue` n'est jamais écrit automatiquement : il est **calculé à la lecture** (`is_overdue`, `:1340,1362,1381,1426`) ; en base 0 facture en `overdue`, 283/317 factures reçues **sans `due_date`**, 229 sans `expected_payment_mode`.

### 5.5 Paiement : pas de statut ; `cashed_at/by/note` pour chèques (`markCashed`/`unmarkCashed`) ; suppression physique.

---

## 6. Couverture de la piste d'audit (qui a fait quoi, quand)

### 6.1 Colonnes présentes / absentes

| Table | Création | Modification | Validation / étape | Annulation / suppression | Historique |
|---|---|---|---|---|---|
| `purchase_orders` | `created_by` (0 NULL/304), `created_at` | `updated_at` manuel ; **pas d'`updated_by`** | `delivery_date` ; **pas de `sent_by/sent_at`, `confirmed_by`** | **pas de `cancelled_by/at/reason`** ; `annule` = simple statut ; `DELETE` physique (admin) | **aucune** |
| `purchase_order_items` | `created_at` | **rien** (qté/prix écrasés in place par `replaceItems`, `updateItemPrices`, réception `:403-409`) | — | DELETE physique (`forceComplete`, `replaceItems`) | **aucune** |
| `reception_vouchers` | `received_by` (0 NULL/307), `created_at`, `reception_date` | — | — | **DELETE physique** par `cancelForPurchaseOrder` (:739-743) | **aucune** |
| `reception_voucher_items` | `created_at` | — | — | DELETE physique | **aucune** |
| `ingredient_lots` | `received_at` | — | — | DELETE physique à l'annulation de réception (:723) | — |
| `inventory_transactions` | `performed_by` (0 NULL/640 restock) | — | — | **DELETE physique** à l'annulation (:729) → la trace de stock disparaît | — |
| `purchase_requests` | `requested_by` (0 NULL/31), `created_at` | `updated_at` | — | note `' | Annule: …'` concaténée (`:150`) ; **pas de `cancelled_by`** | aucune |
| `suppliers` | `created_at` seulement ; **pas de `created_by`** | **pas d'`updated_at`/`updated_by`** | — | soft delete `is_active` sans auteur | aucune |
| `invoices` | `created_by` (0 NULL/326), `created_at` | **pas d'`updated_at`/`updated_by`** (statut, montants, N° modifiables sans trace) | — | `cancelled` = statut sans auteur ; `DELETE` physique + cascade paiements (`deleteById` :1248) | aucune |
| `payments` | `created_by` (1 NULL/689), `created_at` | **pas d'`updated_at`/`updated_by`** | `cashed_by/cashed_at/cashed_note` ✔ | DELETE physique sans auteur | aucune |

Requêtes support :
```sql
SELECT table_name, column_name FROM information_schema.columns
 WHERE column_name IN ('updated_by','validated_by','approved_by','cancelled_by','sent_by','modified_by') ORDER BY 1;
-- → attendance, biweekly_payroll, category_production_markup, daily_inventory_checks, employees, leaves,
--   manual_shift_entries, payroll, production_bons_sortie(cancelled_by), production_plans(cancelled_by),
--   recipe_format_components, recipe_formats, weekly_payroll  — AUCUNE table achats.

SELECT table_name FROM information_schema.tables WHERE table_schema='public'
 AND (table_name LIKE '%audit%' OR table_name LIKE '%history%' OR table_name LIKE '%_log' OR table_name LIKE '%events');
-- → auth_events, bsi_weighing_history, employee_salary_history, product_pipeline_history,
--   production_markup_history, production_plan_events, recipe_bom_audit, ref_audit_log — AUCUNE pour les achats.
```
Le projet a déjà posé le standard pour les BSI (`server/migrations/298_bsi_annulation_tracee.sql:1-18` : « L'annulation … ne laissait aucune trace (ni auteur, ni date, ni motif) ») — le module achats est resté à l'état antérieur.

### 6.2 Grand livre
`journal_entries` porte `created_by, posted_by, source_kind, source_id` ; `reverseEntriesForSource` **supprime** les écritures en période ouverte (`journal-generator.service.ts:845-850` « suppression dure ») et ne crée une contre-écriture `reversal` qu'en période clôturée (`:909-915`). `LEDGER_AUTOGEN` est **OFF par défaut en production** (`feature-flags.ts:29-33`) ; en base locale : `backfill 994, payment 46, invoice 14`.

### 6.3 Logs applicatifs
- pino-http sans `userId` (`app.ts:36-43`) ; les contrôleurs achats loguent via `console.error` (13 occurrences : `purchase-order.controller.ts` ×5, `accounting.controller.ts` ×2, `accounting.repository.ts` ×5, `reception-voucher.repository.ts` ×1) et **jamais** via `logger` → hors redaction et hors format structuré.
- `auth_events` existe (login/logout/permission_changed…) : rien d'équivalent pour les actes d'achat.

### 6.4 Preuves de contournement en base
```sql
-- stock créé par édition admin de BC, sans BR ni lot :
SELECT count(*), SUM(quantity_change) FROM inventory_transactions WHERE type='adjustment' AND note LIKE 'Admin edit BC%';
-- → 16 | 1887.5200
-- BC livré sans aucun bon de réception :
SELECT po.order_number, po.created_at::date, (adj_tx), (inv) ... WHERE status='livre_complet' AND NOT EXISTS(rv)
-- → BC-2026-0015 (1 ajustement, 1 facture) ; BC-2026-0124 (5 ajustements, 1 facture)
-- BC livré sans facture : 4 ; BC sans aucune ligne (forceComplete / édition) : 6, tous livre_complet
-- BC dont le total (qté livrée × prix) diverge de la facture liée (hors factures fusionnées) : 45 / 260
```

---

## 7. Notifications

- Infrastructure : `notifications` (table), `notificationRepository` (`server/src/repositories/notification.repository.ts`), `createNotification` (`server/src/utils/notify.ts`), cloche `client/src/components/layout/NotificationBell.tsx` (routage par `reference_type` : `production_plan`, `replenishment_request`, `order`, `bon_sortie` — lignes 95-103 ; **rien pour `purchase_order`, `invoice`, `payment`**).
- Émetteurs : `grep -rl "createNotification\|notificationRepository.create\|INSERT INTO notifications" server/src` → `order.controller.ts`, `production.controller.ts`, `replenishment.controller.ts`, `bon-sortie.controller.ts`, `product-pipeline.controller.ts`, `production.repository.ts`. **Aucun fichier achats.**
- Base : `SELECT type, reference_type, count(*) FROM notifications GROUP BY 1,2` → 20 types, tous production/BSI/réappro/pipeline ; **0 achats**.
- Événements achats non notifiés : nouvelle DA (le gérant ne sait pas qu'un chef a demandé), BC en retard (pull seulement via `GET /purchase-orders/overdue`, affiché dans `PurchaseOrdersTab.tsx`), réception partielle, facture auto créée sans N° fournisseur (250/317 factures reçues portent un numéro interne `FR-YYYY-NNNN` vs 67 numéros fournisseur), échéance de paiement (pull via `PaymentAlertsWidget` sur `HomePage.tsx:48,178` et `AccountingPage.tsx:302`), chèque à encaisser, écart prix BC/facture.

---

## 8. Tests

- `find server shared client -name "*.test.ts*"` → 5 fichiers, tous dans `server/src/__tests__/` : `recipe-composition`, `smoke` (`expect(1+1).toBe(2)`), `tva`, `units-densite`, `container-rule`. `grep -rln "purchase\|reception\|supplier\|invoice" server/src/__tests__/` → **aucun**.
- Aucun test client, aucun test d'intégration HTTP, aucun test de la machine à états BC, de `createInvoiceFromPo`, de `cancelForPurchaseOrder`, de `updatePaidAmount`, des gardes de sur-paiement.
- Vitest est configuré (`server/package.json:12`), donc l'outillage est prêt.

---

## 9. Conventions UX du projet — écarts dans les pages achats

Référence (mémoire projet `feedback_ui_process_tables.md` + `client/src/styles/index.css`) : écrans « pro » = `ui-timeline` (:767-815) + `odoo-table` (:368-400) + `StatusBanner` (`components/ui/StatusBanner.tsx`, CSS :889-922) + boutons `odoo-btn-primary/-secondary/-danger` (:191-234) ; pas de `rounded-xl`, dégradés, `bg-emerald-*` dans un `odoo-scope`. Écrans de référence qui l'appliquent : `features/production/PlanDetailPage.tsx`, `features/warehouse/WarehouseProcessQueue.tsx`, `features/production/BonSortiePanel.tsx`.

| Mesure (grep -c) | `PurchasingPage.tsx` (2 145 l.) | `PurchaseRequestsPage.tsx` (597 l.) | `PurchaseOrdersTab.tsx` (2 164 l.) | `AccountingPage.tsx` (3 990 l.) | `EcheancierView.tsx` (973 l.) |
|---|---|---|---|---|---|
| `ui-timeline` | **0** | **0** | **0** (7 statuts BC, aucune frise) | 0 | 0 |
| `StatusBanner` | **0** | **0** | **0** | 0 | 0 |
| `odoo-table` | 3 | 3 | 5 | 11 | 2 |
| `<table` (dont hors odoo) | 4 (1 hors) | 3 (0) | 6 (1) | 11 (0) | 2 (0) |
| `odoo-btn-*` | 16 | 3 | 21 | 15 | 17 |
| `<button` total / **hors classes odoo-** | 40 / **20** | 8 / 2 | 46 / **24** | 49 / ? | 21 / ? |
| Champs Tailwind `border-gray-200 rounded-md … focus:ring-blue` | **26** (ex. formulaire fournisseur :350,363) | 4 | 0 | — | — |
| `rounded-xl` / `bg-emerald-*` / dégradé | **9** (modale facture :1586-1637) | 0 | 2 | — | — |
| `confirm()` natif (le projet fournit `useConfirm`, `components/ui/ConfirmDialog.tsx`, adopté par 6 écrans production/pesage) | 1 (:514, double confirm suppression facture) | 0 | **6** (:512, :529, :548, :567, :760, :1468) | oui | oui |
| Badges statut Tailwind (`bg-yellow-100 text-yellow-700`…) au lieu de `odoo-tag-*` | `INVOICE_STATUS_COLORS` :29-32 | `REASON_LABELS` :15-20 | `STATUS_COLORS` :46 utilisés :1286, :1926 (alors que :423-431 utilise `odoo-tag-*`) → **deux systèmes dans le même fichier** | — | — |
| Hints responsive (`@media`, `sm:`, `overflow-x-auto`…) | **0** | **0** | 5 | — | — |
| `usePermissions().canCreate/canEdit/canDelete` | 0 | 0 | 0 (seul `isAdmin = user?.role === 'admin'` :105 pour `cancel-reception`) | `isAdmin` :239 | — |

Autres écarts :
- **Rangement** : `PurchaseOrdersTab.tsx` vit dans `features/accounting/` mais est rendu sous `/purchasing` (`PurchasingPage.tsx:17,95`) ; `PurchaseRequestsPage.tsx` est une « page » utilisée comme onglet (`:96`).
- **Monolithes** : 4 fichiers > 2 000 lignes, sous-composants internes (`SuppliersTab`, `InvoicesTab`, `ReceivedInvoicesSection`, modales) non extraits.
- **Rôle non respecté côté UI** : bouton « désactiver fournisseur » visible au manager alors que la route est admin (`PurchasingPage.tsx:125` vs `accounting.routes.ts:42`) ; aucun bouton achats conditionné par `canCreate/canEdit/canDelete` bien que la grille `user_permissions` les propose (en base : `purchasing` 1 ligne, `accounting` 1 ligne).
- **Identité société en dur** dans les PDF BC et facture (`purchase-order.controller.ts:375-383`, `accounting.controller.ts:564-574` : `TRIANGLE D'ORIENT SARL`, ICE, RC, IF, patente, téléphone) alors que `company_settings` existe (colonnes `company_name, logo_url, …` sans champs fiscaux) — bloquant pour le plan SaaS multi-tenant.
- **Mobile** : build Capacitor présent (`client/.env.mobile`, `mobile/package.json`) ; les tables achats n'ont pas de wrapper scrollable ; `PurchasingPage.tsx` 0 règle responsive.
- **Réception non visible** : aucun écran ne liste les BR (cf. §2.2) ; la saisie lot/DLC existe dans la modale réception (`PurchaseOrdersTab.tsx:1405-1407`) mais le taux de capture est faible : `supplier_lot_number` 48/634, `expiration_date` 53/634 lignes ingrédient.
- **Flux réel** : 259/298 BC sont réceptionnés **moins de 10 min** après leur création, 265/299 ont `order_date = delivery_date` → le BC est saisi a posteriori comme un bon de livraison ; l'étape « Envoyer » est une formalité sans envoi (pas de PDF mail/WhatsApp) — l'UX du cycle BC ne correspond pas à l'usage.

---

## 10. Conventions API

- Enveloppe `{ success, data }` / `{ success:false, error:{ message } }` homogène ✔ ; codes 400/404/409 utilisés de façon cohérente là où il y a un try/catch.
- **Pagination absente** sur `/purchase-orders`, `/invoices`, `/payments`, `/suppliers`, `/purchase-requests` (seul `/replenishment` paginée, `replenishment.controller.ts:14`) ; 689 paiements et 326 factures déjà renvoyés en bloc.
- Filtres `dateFrom/dateTo/supplierId` supportés par `purchaseOrderRepository.findAll` (`:10-19`) mais le client ne passe que `status` (`PurchaseOrdersTab.tsx:120`), recherche/fournisseur filtrés côté navigateur.
- Verbes : `PUT` partout sauf `PATCH` sur l'échéancier ; `POST /:id/action` pour les transitions ✔ ; `GET /download-pdf` et `/download-docx` même handler.
- Erreurs métier levées en `Error` sans `statusCode` → 500 générique en prod (`purchase-request.repository.ts:186`, `purchase-order.repository.ts` `confirmDelivery` :183).
- Pas d'idempotency-key sur `POST /purchase-orders` ; protection UI seulement (`disabled={createMutation.isPending}` `PurchaseOrdersTab.tsx:1242`).
- Client axios : `withCredentials`, header `X-Timezone`, redirection 401 (`client/src/api/client.ts:9-51`) ; **pas de `timeout`** → une requête serveur pendante (cf. §2.10) bloque le spinner indéfiniment.

---

## 11. Faits chiffrés (base locale, lecture seule)

| Fait | SQL | Résultat |
|---|---|---|
| Statuts BC | `SELECT status, count(*) FROM purchase_orders GROUP BY 1` | livre_complet 299, envoye 3, en_attente_facturation 1, annule 1 |
| BC : `created_by`/`store_id` NULL | `SELECT count(*) FILTER (WHERE created_by IS NULL), count(*) FILTER (WHERE store_id IS NULL) FROM purchase_orders` | 0, 0 (304) |
| Créateurs BC / réceptionnaires BR par rôle | `… JOIN users u ON u.id=po.created_by GROUP BY role` | BC : manager 289, admin 15 ; BR : manager 289, admin 18 |
| BC livrés sans BR | `… status='livre_complet' AND NOT EXISTS (rv)` | 2 (BC-2026-0015, BC-2026-0124) |
| BC livrés sans facture | `… NOT EXISTS invoices AND NOT EXISTS invoice_purchase_orders` | 4 |
| BC sans ligne | `NOT EXISTS purchase_order_items` | 6 (tous `livre_complet`) |
| BC avec ligne sans prix | `poi.unit_price IS NULL` | 5 BC |
| Délai création BC → 1re réception | `EXTRACT(EPOCH FROM MIN(rv.created_at)-po.created_at)/60` | < 10 min : 259 ; 10 min–24 h : 21 ; > 24 h : 18 (298) |
| Ajustements stock « Admin edit BC » | `inventory_transactions WHERE type='adjustment' AND note LIKE 'Admin edit BC%'` | 16 lignes, +1 887,52 |
| BR avec N° facture fournisseur | `supplier_invoice_number IS NOT NULL` | 46 / 307 |
| Lignes BR ingrédient avec lot / DLC / sans prix | `reception_voucher_items WHERE ingredient_id IS NOT NULL` | lot 48, DLC 53, sans prix 1 — sur 634 |
| Contrôles qualité réception | `SELECT count(*) FROM reception_quality_checks` | 0 |
| Factures reçues par statut | `GROUP BY invoice_type, status` | received : paid 280, pending 36, partial 1 ; emitted : pending 7, paid 2 |
| Factures reçues : N° interne vs fournisseur | `invoice_number ~ '^(FR\|FA\|INV)-[0-9]{4}-'` | auto 250, fournisseur 67 |
| Factures reçues sans `due_date` / sans mode | — | 283 / 229 sur 317 |
| Factures reçues sans BC (saisie manuelle) | `purchase_order_id IS NULL AND status<>'cancelled'` | 23, 76 129,21 DH |
| Factures fusionnées (mig 178) | `invoice_purchase_orders` | 35 lignes, 34 factures |
| Écart total BC vs facture (hors fusion) | cf. §6.4 | 45 / 260 |
| `paid_amount` ≠ Σ paiements | — | 0 ✔ |
| Sur-paiement / paiement ≤ 0 / facture `paid` sous-payée / facture annulée avec paiements | — | 0 / 0 / 0 / 0 ✔ |
| Paiements par type/mode | `GROUP BY type, payment_method` | expense-cash 311, invoice-cash 248, salary 64, advance 24, invoice-traite 22, invoice-check 15, transfer 1, avoir 1, income 3 |
| Dépenses fournisseur sur catégories `requires_po` sans BC ni facture | `payments p JOIN expense_categories ec … ec.requires_po AND purchase_order_id IS NULL AND invoice_id IS NULL AND type='expense'` | **70, 26 523,52 DH** (48/135 catégories flaguées `requires_po`, garde désactivée) |
| Paiements `created_by` NULL | — | 1 / 689 |
| Fournisseurs actifs / sans ICE / sans contact / ICE dupliqué | — | 31/40 ; 27 ; 15 ; `000078523000008` partagé par Carrefour et Supeco |
| DA par statut/raison | — | received-production 29, received-manual 2 (0 pending) |
| Utilisateurs par rôle (actifs) | — | cashier 4 (2), admin 3 (3), manager 1 (1), pastry_chef 1 (1), baker/viennoiserie/beldi_sale 1 (0) ; tous avec `store_id` |
| Permissions module | `user_permissions WHERE module IN ('purchasing','accounting','replenishment')` | purchasing 1, accounting 1, replenishment 4 |
| Notifications achats | `GROUP BY type, reference_type` | 0 sur 20 types |
| Triggers sur tables achats | `information_schema.triggers` | uniquement `payments.trg_sync_scheduled_payment` |
| Écritures grand livre | `GROUP BY source_kind` | backfill 994, payment 46, invoice 14 |

---

## 12. Forces

1. Sécurité périmétrique solide et récente (OWASP A02/A05/A07/A08/A09 annotés dans le code) : cookie HttpOnly, révocation `jti`, `tokenVersion`, CSP, CORS environnemental, Origin check, redaction des logs.
2. SQL paramétré partout ; transactions avec `FOR UPDATE` sur BC/facture/stock ; advisory locks `po_number`/`voucher_number` ; numérotation `MAX+1` robuste aux suppressions.
3. Garde-fous financiers réels dans le repository : sur-paiement (`:1958-1969`), doublon de chèque (`:1972-1985`), doublon N° facture fournisseur à la réception (`reception-voucher.repository.ts:309-330`), refus d'annuler une réception si facture payée ou lot consommé (`:626-652`), `updatePaidAmount` atomique.
4. Séparation admin / manager cohérente sur les actes irréversibles (`cancel-reception`, `DELETE BC`, `unmark-cashed`, `DELETE supplier`).
5. Les DA peuvent naître de 4 écrans métier (chef, magasinier, économat) et se ferment automatiquement à la réception (`purchase-request.helper.ts`).
6. Qualité des données existantes bonne sur les colonnes d'auteur présentes (0 NULL sur `created_by`/`received_by`/`performed_by`), 0 incohérence `paid_amount`.
7. Le réappro boutique montre la cible : étapes avec `*_by/*_at`, notifications par rôle, `asyncHandler` systématique.

---

## 13. Faiblesses (ordonnées par sévérité)

| # | Sév. | Dom. | Constat | Preuve |
|---|---|---|---|---|
| W1 | critique | D10, D5, D8 | Annulation de réception = destruction physique de la preuve (BR, RVi, lots, `inventory_transactions`, facture) ; aucune trace auteur/date/motif | `reception-voucher.repository.ts:666,723,729,739,743` ; standard BSI mig 298 non appliqué |
| W2 | critique | D10, D5 | Le manager peut créer/modifier du stock via `PUT /purchase-orders/:id/items` (`quantityDelivered` libre) sans BR, sans lot, sans DLC | `purchase-order.controller.ts:206-250`, `purchase-order.repository.ts:506-527` ; 16 ajustements, +1 887,52 ; 2 BC livrés sans BR |
| W3 | critique | D10, D4 | `POST /:id/not-delivered` sans garde de statut ; `POST /:id/cancel` autorise l'annulation d'un `livre_partiel` déjà en stock | `purchase-order.controller.ts:104-109, 111-125` |
| W4 | critique | D10, D6, D7 | Contrôle financier contournable par le manager : facture passée `paid` manuellement, facture annulée sans garde, `DELETE /invoices/:id?force` cascade les paiements, `DELETE /payments/:id` sans contrôle ; BC obligatoire désactivé (70 dépenses fournisseur hors BC, 26 523,52 DH) | `accounting.controller.ts:224-227, 283-300, 384-397, 668, 736-739`, `accounting.routes.ts:76-78,111` |
| W5 | critique | D10 | 50 handlers achats sans `asyncHandler` ni try/catch (Express 4) : erreur Postgres (id non-UUID, NOT NULL…) ou erreur métier `statusCode 409` du repo → requête jamais répondue, client sans `timeout` | `purchase-order.routes.ts`, `reception-voucher.routes.ts`, `accounting.routes.ts`, `payment-schedule.routes.ts` (aucun `asyncHandler`) ; `index.ts:8-10` ne fait que loguer ; `client/src/api/client.ts:9-14` |
| W6 | majeur | D10 | 0 validateur zod sur 76 endpoints ; `req.body` brut en création fournisseur/facture ; `invoice_number` sans unicité | `accounting.controller.ts:66,184` ; `server/src/validators/` sans fichier achats ; `\d invoices` |
| W7 | majeur | D10 | Aucune piste d'audit : pas d'`updated_by`, `sent_by`, `cancelled_by` ; pas de table d'historique ; `invoices`, `payments`, `suppliers` sans `updated_at` ; logs HTTP sans `userId` ; `console.error` au lieu de `logger` | §6.1 ; `app.ts:36-43` ; 13 `console.error` |
| W8 | majeur | D10, D2, D4, D7 | Aucune notification achats (DA créée, BC en retard, réception partielle, facture auto sans N° fournisseur, échéance) ; cloche sans routage achats | `grep createNotification` ; `NotificationBell.tsx:95-103` ; table `notifications` 0 type achats |
| W9 | majeur | D10 | Aucun test sur achats/factures/paiements ; `smoke.test.ts` trivial | `server/src/__tests__/` |
| W10 | majeur | D10, D5 | 21 endpoints morts dont tout `/reception-vouchers` (les BR ne sont visibles nulle part) et le contrôle qualité réception (schéma + API, 0 UI, 0 ligne) | §3 ; `reception_quality_checks` = 0 |
| W11 | majeur | D10 | Permissions par module (`user_permissions.can_create/edit/delete`) jamais appliquées côté serveur ni côté UI achats ; `authorize` ne connaît que le rôle | `role.middleware.ts:5-19` ; `grep canCreate( client/src/features` → 0 |
| W12 | majeur | D10, D1 | `GET /suppliers` interdit au magasinier (`PRODUCTION`) alors qu'il a l'économat et l'écran `IngredientDetailPage` qui charge les fournisseurs ; bouton « désactiver » visible au manager alors que route admin | `accounting.routes.ts:38,42` ; `IngredientDetailPage.tsx:6` ; `PurchasingPage.tsx:125` |
| W13 | majeur | D10 | Filtrage store incohérent (3 règles) et absence de contrôle de propriété sur 12 mutations — dette bloquante pour le plan SaaS multi-tenant | §1.2 |
| W14 | majeur | D10 (UX) | Écrans achats hors conventions : 0 `ui-timeline`, 0 `StatusBanner`, 11 `confirm()` natifs, 26 champs Tailwind, 9 `rounded-xl`, deux systèmes de badges dans le même fichier, `PurchaseOrdersTab` rangé dans `accounting` | §9 |
| W15 | majeur | D10, D4 | Cycle BC déconnecté de l'usage : 259/298 BC réceptionnés < 10 min après création, « Envoyer » ne fait que changer un statut (pas d'envoi, pas de `sent_at`), 250/317 factures reçues avec un N° interne | §9, §11 |
| W16 | mineur | D10 | Identité légale de la société en dur dans 2 contrôleurs PDF | `purchase-order.controller.ts:375-383`, `accounting.controller.ts:564-574` |
| W17 | mineur | D10 | Pas de pagination ni de filtres serveur exploités (`/purchase-orders`, `/invoices`, `/payments`) ; erreurs métier sans `statusCode` → 500 générique en prod | `purchase-request.repository.ts:186` ; `error.middleware.ts:31-33` |
| W18 | mineur | D10 | Pas de rate-limit ni de parser JSON élargi sur les achats (plafond ≈ 45-55 lignes par BC) ; `GET /overdue?days=` non borné | `app.ts:120-134` ; `purchase-order.controller.ts:294` |
| W19 | mineur | D10 | Mobile (Capacitor) : tables achats sans wrapper responsive, `PurchasingPage.tsx` 0 règle `@media` | §9 |
| W20 | mineur | D10 | Code dupliqué : `updateItemPrices` (mort) et `replaceItems` recalculent le statut BC avec deux implémentations ; `download-pdf`/`download-docx` alias | `purchase-order.repository.ts:223-290, 461-487` |

---

## 14. Questions ouvertes

1. L'annulation de réception doit-elle rester une suppression (reconstruction d'état) ou devenir une extourne tracée (BR d'annulation, mouvements négatifs) comme pour les BSI ?
2. Le flux réel (BC saisi au moment de la livraison) doit-il être officialisé (mode « réception directe » créant BC+BR en un acte) ou le vrai cycle commande→envoi→réception doit-il être imposé ?
3. Qui doit pouvoir supprimer physiquement une facture ou un paiement — admin seul, personne (annulation uniquement) ?
4. Quelle(s) permission(s) module (`can_create/edit/delete`) doivent être appliquées côté serveur pour les achats, et le rôle `magasinier` doit-il réceptionner (aujourd'hui seuls admin/manager le peuvent) ?
5. `ENFORCE_PO_REQUIREMENT` : remise en service prévue ? sur quelles catégories ?
6. `LEDGER_AUTOGEN` reste OFF en prod : la piste comptable des achats ne peut pas servir d'audit tant que ce flag n'est pas activé.

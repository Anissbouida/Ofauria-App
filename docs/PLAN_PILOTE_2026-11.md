# Plan pilote 2026-11 — socle avant staging

État au 2026-11-18. Objectif unique : sécuriser le socle (migrations 519 à 595 comprises) pour un
staging puis un pilote contrôlé. **Gel** : G6-03, G6-05, G6-06, G3-08, G0-14, C-04, G0-05, G0-08,
G3-04 ; G1-07 et G1-08 restent désactivés, G1-01 reste en mode « avertir ».

Un lot = un sujet = des commits isolés. Toute règle métier ambiguë (stock, caisse, paie) est
remontée avant d'imposer une validation qui pourrait bloquer le terrain (section 5).

## 1. Étape 1 — clôture M4-04 et M5-05

**FAIT le 2026-11-18** : M4-04 aa0a2f0 (points 1 à 6, plus l'instantané du coût théorique au démarrage, le coût réel matières et le rendement, trouvés en cours de route — même défaut), M5-05 6b7c29c. Aucune règle métier ambiguë rencontrée.

### M4-04 — plusieurs nomenclatures par article
Fait (mig 562) : fiche par défaut = `recipes.product_id` (index unique conservé), fiches
alternative / sous-traitance par `alternative_for_product_id`, choix sur la ligne d'ordre
(`alt_recipe_id`), respecté à la confirmation, à la déclaration, à l'écart théorique, aux
substituts du bon de sortie et à la gamme.

Manque pour clôturer (la fiche choisie sur la ligne est ignorée) :
1. `production-cout.repository.ts` : coût prévu de l'ordre et poids unitaire de la clé de répartition lisent la fiche par défaut.
2. `production.repository.ts` : `analyzeSubRecipes` et `detectAndCreateSemiFinishedPlans` (bases d'une fiche alternative non détectées).
3. `bon-sortie.repository.ts` : besoins en emballages du bon de sortie.
4. `traceability.repository.ts` : rappel de lot — un ordre fait sur une fiche alternative n'est pas « certain ».
5. `production-etapes.repository.ts` : étapes JSON initialisées depuis la fiche par défaut.
6. Aucune opération pour **changer la fiche par défaut** d'un produit (échanger avec une alternative).

Périmètre : ces six points, rien d'autre. Test : produit à deux nomenclatures, ordre sur
l'alternative → coût prévu, bases, emballages, traçabilité et étapes de l'alternative ; sans
choix → fiche par défaut.

### M5-05 — référentiel équipement unique
Fait (mig 569) : équipement → poste et immobilisation (écran de rapprochement), arrêt de poste →
demande d'intervention (case à cocher), intervention terminée → arrêt du poste, qualité dans le TRS.

Manque pour clôturer :
1. Le formulaire d'intervention de la Maintenance ne propose pas l'**équipement de production** :
   une intervention saisie depuis la Maintenance n'a jamais `equipment_id`, donc ne crée jamais
   l'arrêt du poste à sa clôture.
2. Le serveur exige une immobilisation ou un libellé (`hasEquipment`) : un équipement seul est refusé.

Périmètre : choix de l'équipement sur l'intervention (immobilisation reprise du lien de
l'équipement), règle serveur élargie. Les plans d'entretien restent sur immobilisation / libellé.

## 2. Étape 2 — validation des routes critiques (G0-07 ciblé)

357 mutations sans schéma (`fixtures/unvalidated-mutations.json`) :
**192 critiques**, 144 importantes, 21 secondaires (liste complète en annexe).

Méthode, par module critique (un commit par module) :
- **2a — actions sans corps** (annuler, imprimer, encaisser, payer…) : `validateUuidParams` + corps vide.
- **2b — routes à corps** : schéma zod tiré de ce que le contrôleur lit réellement (types, champs
  obligatoires, montants ≥ 0, quantités > 0, unités du référentiel) ; droits vérifiés au passage.
- Un champ dont la règle n'est pas claire dans le code est laissé **permissif** et noté en section 5.
- Chaque route traitée sort de la liste blanche ; la garde `route-validation-guard` le vérifie.

Ordre : caisse et ventes → paiements / règlements / rapprochement → achats / réceptions → stock →
production → paie.

## 3. Étape 3 — transactions critiques (G3-06 vague 3 ciblée)

195 blocs `BEGIN … COMMIT` manuels. Un bloc manuel est déjà atomique sur **sa** connexion ; le
risque réel est un bloc qui appelle, au milieu, du code écrivant par le **pool** (`db.query`, un
autre dépôt, `withActor`) : cette écriture part sur une autre connexion et survit à un ROLLBACK.
Audit (lecture seule) : 64 blocs écrivent plusieurs tables d'un module critique, dont **20 appellent
du code hors de leur connexion**. Ce sont eux qui sont traités :

| Fichier : ligne | Fonction | Modules | Appel hors transaction |
|---|---|---|---|
| delivery-note.repository.ts:551 | facturer un BL | ventes, compta | `invoiceRepository.create` |
| credit-note.repository.ts:66 | imputer un avoir | ventes | `invoiceRepository.create` |
| pro-return.repository.ts:48 | retour pro | stock | `invoiceRepository.create` |
| customer-receipt.repository.ts:51 / 93 | règlement client, affectation | paiements | `invoiceRepository.updatePaidAmount`, `withActor` |
| quote.repository.ts:455 | devis → commande | ventes | `orderRepository.create` |
| order.controller.ts:335 | avance de commande | caisse | `saleRepository.create` |
| bill-portfolio.repository.ts:111 / 168 / 192 / 218 | effets (retour, remise, impayé) | paiements | `withActor`, `paymentRepository.voidPaymentInTx` |
| production.repository.ts:1132 / 1492 | déclaration de production | production, stock | lectures seules (`featureOn`, étapes bloquantes) — à vérifier |
| payroll-config.repository.ts:505 | déclaration e-BDS | paie | `db.query` |
| period-end.repository.ts:43, consolidation.repository.ts:106 / 133 | clôture, consolidation | compta | `withActor` |
| sachet-config, production-consumption (variance), recipe-restore | — | non critiques | lecture ou hors périmètre |

Méthode : chaque fonction passe sous `withTransaction` (transaction ambiante : les appels internes
rejoignent la même transaction), garde contre le double traitement (verrou de ligne / statut relu
sous verrou), test qui provoque une erreur après l'écriture interne et vérifie que rien ne reste.
Les 175 autres blocs restent tels quels, listés pour plus tard.

## 4. Étape 4 — préparation staging / pilote

1. **Migrations 519 → 595** : séquence vérifiée sur base vierge, liste des migrations non
   réversibles (suppressions, conversions, reprises de données), script de contrôle post-migration
   (contraintes valides, déclencheurs actifs, comptes de lignes clés, fonctions présentes).
2. **Parcours métier de bout en bout**, chiffres attendus écrits à la main :
   achat → réception → stock (quantités, coûts) ; économat → pesage → production → caisse ;
   vente → caisse avec annulation après encaissement et clôture / réouverture de journée ; retour ou
   perte de production ; inventaire → valorisation ; dépenses → trésorerie ; paie → bulletins (sans
   envoi comptable automatique).

## 5. Règles métier ambiguës à trancher

(Complété au fil des lots ; rien n'est imposé sans réponse.)

## Annexe — classement des 357 routes sans schéma

### Critiques (192)
| Routeur | Nb | Routes |
|---|---|---|
| `ledger:ledgerRouter` | 17 | `PATCH /fiscal-periods/:id/status`<br>`POST /accounts/:id/active`<br>`POST /backfill`<br>`POST /bills/remittances/:id/cancel`<br>`POST /corporate-tax/:year/book`<br>`POST /entries`<br>`POST /entries/:id/post`<br>`POST /entries/post`<br>`POST /entry-templates/:id/active`<br>`POST /fiscal-periods/:id/fae`<br>`POST /fiscal-periods/:id/fg-stock`<br>`POST /fiscal-years/:year/close`<br>`POST /integrity/seal`<br>`POST /integrity/verify`<br>`POST /outbox/:id/replay`<br>`POST /outbox/replay`<br>`PUT /entries/:id` |
| `reconciliation` | 17 | `POST /darija`<br>`POST /days`<br>`POST /days/:id/close`<br>`POST /days/:id/reopen`<br>`POST /products`<br>`POST /products/bulk`<br>`POST /shifts/:id/bulk-appro`<br>`POST /shifts/:id/close`<br>`POST /shifts/:id/import-sales`<br>`POST /shifts/:id/lines`<br>`POST /shifts/:id/prefill-reste`<br>`POST /shifts/:id/reopen`<br>`POST /shifts/:id/reset-sales`<br>`POST /slots`<br>`PUT /carryover`<br>`PUT /fiche`<br>`PUT /lines/:lineId` |
| `accounting:invoicesRouter` | 16 | `POST /:id/apply-credit`<br>`POST /:id/attachment`<br>`POST /:id/bad-debts`<br>`POST /:id/cancel`<br>`POST /:id/credit-notes`<br>`POST /:id/disputes`<br>`POST /:id/schedule`<br>`POST /from-order/:orderId`<br>`PUT /:id/category`<br>`PUT /:id/items`<br>`PUT /:id/payment-terms`<br>`PUT /:id/status`<br>`PUT /bad-debts/:badDebtId/revert`<br>`PUT /disputes/:disputeId/reject`<br>`PUT /disputes/:disputeId/resolve`<br>`PUT /line/:id/category` |
| `bon-sortie` | 12 | `POST /generate`<br>`POST /ligne/:ligneId/transfer-from-economat`<br>`POST /plan/:planId/regenerate`<br>`PUT /:id/accept-reception`<br>`PUT /:id/cancel`<br>`PUT /:id/chef-reject`<br>`PUT /:id/commit-partial`<br>`PUT /:id/complete-pending`<br>`PUT /:id/peser`<br>`PUT /:id/preparation`<br>`PUT /:id/ready`<br>`PUT /ligne/:ligneId` |
| `production-etapes` | 10 | `POST /etapes/:etapeId/pause`<br>`POST /etapes/:etapeId/readings`<br>`POST /etapes/:etapeId/repetition`<br>`POST /etapes/:etapeId/resume`<br>`POST /etapes/:etapeId/timer`<br>`POST /items/:itemId/etapes/init`<br>`POST /items/:itemId/rendement`<br>`POST /plans/:planId/retro-planning`<br>`PUT /etapes/:etapeId/assign`<br>`PUT /etapes/:etapeId/status` |
| `production` | 9 | `POST /:id/confirm`<br>`POST /:id/detect-semi-finished`<br>`POST /:id/revert-to-draft`<br>`POST /:id/start`<br>`POST /mrp/generate`<br>`POST /mrp/generate-purchase-requests`<br>`POST /transfers/:transferId/receive`<br>`PUT /settings`<br>`PUT /workshops/:code` |
| `ingredient-lot` | 8 | `POST /:id/move-location`<br>`POST /:id/movement`<br>`POST /:id/open-to-pesage`<br>`POST /:id/pesage-waste`<br>`POST /:id/quarantine`<br>`POST /:id/return-to-economat`<br>`POST /:id/send-to-losses`<br>`POST /quality-check/:id` |
| `replenishment` | 8 | `POST /`<br>`POST /:id/acknowledge`<br>`POST /:id/cancel`<br>`POST /:id/confirm-reception`<br>`POST /:id/prepare`<br>`POST /:id/transfer`<br>`POST /check-items`<br>`POST /inventory-check` |
| `delivery-note` | 7 | `POST /`<br>`POST /:id/cancel`<br>`POST /:id/deliver`<br>`POST /:id/ship`<br>`POST /from-order/:orderId`<br>`POST /invoice`<br>`POST /prepared` |
| `orders` | 6 | `POST /`<br>`POST /:id/deliver`<br>`POST /:id/prepayment-invoice`<br>`POST /:id/reschedule`<br>`PUT /:id`<br>`PUT /:id/status` |
| `production-cout` | 6 | `POST /batch-calculate`<br>`POST /equipements`<br>`POST /plans/:planId/calculate`<br>`POST /plans/:planId/equipement-usage`<br>`POST /plans/:planId/temps-travail`<br>`PUT /equipements/:id` |
| `purchase-order` | 6 | `POST /:id/confirm-delivery`<br>`POST /:id/invoice`<br>`POST /:id/send`<br>`POST /:id/update-prices`<br>`PUT /:id`<br>`PUT /:id/items` |
| `sales` | 6 | `POST /:id/cancel`<br>`POST /:id/invoice`<br>`POST /:id/print`<br>`POST /import`<br>`POST /special`<br>`PUT /special/:id` |
| `inventory:ingredientsRouter` | 5 | `POST /`<br>`POST /:id/convert-to-consumable`<br>`POST /import/commit`<br>`POST /import/preview`<br>`PUT /:id` |
| `production-contenant` | 5 | `POST /`<br>`POST /bulk-deactivate`<br>`POST /bulk-delete`<br>`PUT /:id`<br>`PUT /products/:productId` |
| `stock-frigo` | 5 | `POST /consume`<br>`POST /reconciliation/apply`<br>`POST /surplus`<br>`PUT /:id/adjust`<br>`PUT /:id/loss` |
| `accounting:paymentsRouter` | 4 | `POST /:id/mark-cashed`<br>`POST /:id/unmark-cashed`<br>`POST /customer-receipts`<br>`POST /customer-receipts/:id/allocate` |
| `bank-reconciliation` | 4 | `POST /lines/:id/match`<br>`POST /lines/:id/unmatch`<br>`POST /statements`<br>`POST /statements/:id/auto-match` |
| `packaging` | 3 | `POST /`<br>`POST /:id/adjust-stock`<br>`PUT /:id` |
| `product-lot` | 3 | `POST /:id/send-to-losses`<br>`POST /send-orphan-to-losses`<br>`POST /vitrine-reconciliation/apply` |
| `stock-counts:stockCountsRouter` | 3 | `POST /:id/cancel`<br>`POST /:id/reopen`<br>`POST /:id/submit` |
| `payment-schedule:debtsRouter` | 2 | `PATCH /:id`<br>`POST /` |
| `payment-schedule:recurringChargesRouter` | 2 | `PATCH /:id`<br>`POST /` |
| `withholding` | 2 | `PATCH /types/:id`<br>`POST /reversement` |
| `accounting:caisseImportRouter` | 2 | `POST /commit`<br>`POST /preview` |
| `cash-register` | 2 | `POST /:id/print-z`<br>`POST /closure-gaps/post` |
| `employees:payrollRouter` | 2 | `POST /:id/unpay`<br>`POST /declarations/ebds` |
| `lot-thermal` | 2 | `POST /:kind/:id/freeze`<br>`POST /:kind/:id/thaw` |
| `opening-inventory-check` | 2 | `POST /opening`<br>`POST /opening/:id/validate` |
| `quotes:quotesRouter` | 2 | `POST /:id/duplicate`<br>`POST /:id/revise` |
| `reception-voucher` | 2 | `POST /`<br>`PUT /items/:id/price-decision` |
| `stock-location` | 2 | `POST /`<br>`PUT /:id` |
| `unsold-decision` | 2 | `POST /`<br>`POST /destroy-expired` |
| `payment-schedule:paymentSchedulesRouter` | 1 | `PATCH /:id` |
| `employees:biweeklyPayrollRouter` | 1 | `POST /:id/unpay` |
| `employees:weeklyPayrollRouter` | 1 | `POST /:id/unpay` |
| `inventory` | 1 | `POST /closings` |
| `pro-return` | 1 | `POST /` |
| `product-transfer` | 1 | `POST /` |
| `purchase-request` | 1 | `POST /:id/submit` |
| `accounting:caisseRouter` | 1 | `PUT /report-override` |

### Importantes (144)
| Routeur | Nb | Routes |
|---|---|---|
| `settings` | 32 | `POST /api-keys`<br>`POST /approval-rules`<br>`POST /bank-accounts`<br>`POST /data/import/:entity/commit`<br>`POST /data/import/:entity/preview`<br>`POST /data/imports/:id/undo`<br>`POST /document-sequences/preview`<br>`POST /modules/assistant`<br>`POST /modules/health/:key/dismiss`<br>`POST /modules/health/restore`<br>`POST /modules/import/preview`<br>`POST /modules/onboarding/:module/hide`<br>`POST /modules/onboarding/show`<br>`POST /modules/preview`<br>`POST /modules/reset`<br>`POST /modules/versions/:id/restore`<br>`POST /sector/starter`<br>`POST /sectors`<br>`POST /tax-codes`<br>`POST /webhooks`<br>`PUT /`<br>`PUT /approval-rules/:code`<br>`PUT /bank-accounts/:id`<br>`PUT /document-sequences/:docType`<br>`PUT /documents/:docType`<br>`PUT /modules`<br>`PUT /modules/:key/rollout`<br>`PUT /notification-rules/:type`<br>`PUT /parameters/:key`<br>`PUT /sector`<br>`PUT /tax-codes/:id`<br>`PUT /webhooks/:id` |
| `users` | 12 | `POST /`<br>`POST /approval-limits`<br>`POST /delegations`<br>`POST /roles`<br>`POST /sod`<br>`PUT /:id`<br>`PUT /:id/permissions`<br>`PUT /roles/:code`<br>`PUT /roles/:code/permissions`<br>`PUT /security`<br>`PUT /sod/:code`<br>`PUT /sod/mode` |
| `customers` | 9 | `POST /`<br>`POST /:id/addresses`<br>`POST /:id/anonymize`<br>`POST /:id/portal-token`<br>`POST /:id/restore`<br>`POST /:id/tax-exemptions`<br>`PUT /:id`<br>`PUT /:id/addresses/:addressId`<br>`PUT /:id/consent` |
| `quality` | 6 | `POST /inspections`<br>`POST /nonconformities`<br>`POST /templates`<br>`POST /templates/:id/active`<br>`PUT /nonconformities/:id`<br>`PUT /templates/:id` |
| `routing` | 6 | `POST /:id/active`<br>`POST /work-centers`<br>`POST /work-centers/:id/active`<br>`POST /work-centers/:id/downtime`<br>`POST /work-centers/:id/status`<br>`PUT /work-centers/:id` |
| `products` | 5 | `PATCH /:id/toggle-availability`<br>`POST /:id/image`<br>`POST /:id/stock`<br>`PUT /:id/channel-pricing`<br>`PUT /:id/pricing-tiers` |
| `supplier-items` | 5 | `PATCH /:id`<br>`POST /`<br>`POST /:id/archive`<br>`POST /:id/prefer`<br>`POST /:id/prices` |
| `delivery-route` | 5 | `POST /`<br>`POST /:id/reorder`<br>`POST /:id/status`<br>`POST /:id/stops`<br>`POST /stops/:stopId/delivered` |
| `recipes` | 5 | `POST /:id/restore`<br>`POST /:id/versions/:versionNumber/restore`<br>`POST /bulk-replace/:logId/revert`<br>`POST /import/commit`<br>`POST /import/preview` |
| `approval` | 4 | `POST /:id/approve`<br>`POST /:id/cancel`<br>`POST /:id/reject`<br>`POST /delegations` |
| `pricing` | 4 | `POST /bulk-update`<br>`POST /lists`<br>`POST /lists/:id/items`<br>`PUT /lists/:id` |
| `referentiel` | 4 | `POST /:tableName`<br>`PUT /:tableName/:id`<br>`PUT /:tableName/:id/reactivate`<br>`PUT /:tableName/reorder` |
| `cost-center` | 3 | `POST /`<br>`POST /:id/active`<br>`POST /assign` |
| `crm:crmRouter` | 3 | `POST /campaigns`<br>`POST /campaigns/:id/status`<br>`POST /opportunities/:id/customer` |
| `dunning:dunningRouter` | 3 | `POST /:id/cancel`<br>`POST /customers/:customerId/release`<br>`PUT /levels/:level` |
| `employees` | 3 | `POST /:employeeId/contracts/renew-trial`<br>`POST /:employeeId/documents`<br>`POST /settlements/:id/cancel` |
| `haccp:haccpRouter` | 3 | `POST /equipment`<br>`POST /receptions/:id/check`<br>`POST /tasks` |
| `rebates` | 3 | `POST /`<br>`PUT /:id/cancel`<br>`PUT /:id/settle` |
| `sales-contracts` | 3 | `POST /`<br>`POST /:id/releases`<br>`PUT /:id/close` |
| `subscription` | 3 | `POST /`<br>`POST /:id/status`<br>`POST /generate` |
| `accounting:expenseCategoriesRouter` | 2 | `POST /`<br>`PUT /:id` |
| `accounting:revenueCategoriesRouter` | 2 | `POST /`<br>`PUT /:id` |
| `categories` | 2 | `POST /`<br>`PUT /:id` |
| `employees:leavesRouter` | 2 | `POST /:id/approve`<br>`POST /:id/reject` |
| `fixed-asset` | 2 | `POST /`<br>`POST /run-depreciation` |
| `prepaid-charge` | 2 | `POST /`<br>`POST /recognize` |
| `sachet-config` | 2 | `POST /suggest`<br>`PUT /` |
| `sales-channel` | 2 | `POST /`<br>`PUT /:id` |
| `store` | 2 | `POST /`<br>`PUT /:id` |
| `auth` | 1 | `POST /logout` |
| `automation:automationRouter` | 1 | `POST /jobs/:key/run` |
| `forecast:forecastRouter` | 1 | `POST /events` |
| `sales-targets` | 1 | `POST /` |
| `production-markup` | 1 | `PUT /` |

### Secondaires (21)
| Routeur | Nb | Routes |
|---|---|---|
| `product-pipeline` | 6 | `POST /`<br>`POST /:id/admin-decision`<br>`POST /:id/advance`<br>`POST /:id/cancel`<br>`POST /:id/integrate`<br>`PUT /:id/stage-data` |
| `printer` | 5 | `POST /`<br>`POST /:id/open-drawer`<br>`POST /:id/test`<br>`POST /system/attach`<br>`PUT /:id` |
| `reports` | 5 | `POST /custom/dashboards`<br>`POST /custom/definitions`<br>`POST /custom/run`<br>`PUT /custom/dashboards/:id`<br>`PUT /custom/definitions/:id` |
| `upload` | 3 | `POST /complaint-photo`<br>`POST /logo`<br>`POST /loss-photo` |
| `notifications` | 2 | `PUT /:id/read`<br>`PUT /read-all` |

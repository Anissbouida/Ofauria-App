# KALUM — Analyse d'écart Procure-to-Pay (P2P)

> **Date :** 2026-11-01 · **HEAD :** `cfd7779` (main) · **Base :** locale 5433 (`ofauria_db`, copie de travail des données réelles).
> **Méthode :** lecture du code serveur (`server/src`, `server/migrations` jusqu'à 423) et requêtes SQL sur la base. Chaque constat porte sa preuve (`fichier:ligne` ou chiffre mesuré). Ce document **complète** `docs/audit-achats/` (benchmark du 12/10, état du 30/10) : il ne reprend pas les 186 écarts. Il juge le **flux réel** contre les 7 étapes P2P, avec un seul critère : *le contrôle est-il bloquant, et le contourne-t-on ?*
> **Lecture Oracle :** `purchase_requests` ≈ `PO_REQUISITION_LINES`, `purchase_orders/_items` ≈ `PO_HEADERS/PO_LINES`, `reception_voucher*` ≈ `RCV_TRANSACTIONS`, `invoices` ≈ `AP_INVOICES_ALL`, `invoice_holds` ≈ `AP_HOLDS_ALL`, `ingredient_lots` ≈ `MTL_LOT_NUMBERS` + coûts de couche.

---

## 0. Verdict en une phrase

Les **briques** P2P existent presque toutes (DA, moteur d'approbation, appels d'offres, verrou du BC, journal de lignes, holds de facture, GR/IR, frais d'approche). Le **processus**, lui, n'est pas P2P : le BC sert à **régulariser** un achat déjà livré, la facture est **générée à partir de la réception**, et le rapprochement compare donc la réception à sa propre copie. Il ne trouve rien parce qu'il ne peut rien trouver.

| Indicateur mesuré (base locale) | Valeur | Ce que ça prouve |
|---|---|---|
| BC réceptionnés < 10 min après leur création | **263 / 350 (75 %)** | Le BC n'engage rien : il est saisi au moment de la livraison |
| Réceptions faites par l'auteur du BC | **357 / 369 (97 %)** | Aucune séparation des tâches au niveau du document |
| BC issus d'une demande d'achat | **45 / 357 (13 %)** | La DA est contournée |
| Demandes d'approbation BC depuis la mise en service (mig 350) | **1** | L'approbation ne joue presque jamais |
| Factures fournisseurs générées depuis la réception (`legacy_auto` + `from_receipt`) | **302 / 372 (81 %)** | La facture n'est pas la pièce du fournisseur |
| Factures avec n° de facture fournisseur | **113 / 372 (30 %)** | Pas de pièce justificative |
| Holds `QTY_REC` ou `PRICE` jamais ouverts | **0** | Le three-way matching ne trouve rien parce qu'il compare la réception à sa propre copie |
| Lots actifs sans DLC | **396 / 460 (86 %)** | Traçabilité aval incomplète |
| Consommations de production sur des lots sans coût ni réception | **115 / 1 364 (8,4 %)** | Le coût réel des fournées est sous-évalué |
| Articles avec seuil de réappro > 0 | **1 / 377** | Rien ne peut se déclencher automatiquement |
| Tarifs fournisseur datés (`supplier_item_prices`) | **13 lignes** pour 377 articles | Pas de référentiel de prix contractuel |
| Rôle PostgreSQL de l'application | **superuser + BYPASSRLS**, 0 politique RLS | Les triggers d'intégrité ne protègent que contre le code, pas contre l'accès base |

---

## 1. Analyse d'écart — les 7 étapes

Légende : 🟥 **absent ou contourné** · 🟧 **présent mais non bloquant** · 🟩 **conforme**.

### Étape 1 — Identification du besoin (MRP) · 🟧

| Standard | KALUM | Preuve |
|---|---|---|
| Déclenchement **automatique** (point de commande, explosion des fournées) | **Aucun déclenchement automatique.** Toutes les créations passent par un clic : `POST /purchase-requests/order-direct`, `/generate-po`, `/production/mrp/generate-purchase-requests` | `purchase-request.routes.ts:24,35` ; `production.routes.ts:28` ; aucune tâche achat dans `services/scheduler.ts:166-176` |
| Besoin net = besoin brut − stock − **en-cours de commande** | Le MRP **ne retranche pas les BC ouverts** : `max(0, needed + seuil − onHand)`. L'écran « À commander » les retranche, lui. Les deux calculs ne donnent donc pas le même résultat | `mrp.repository.ts:368` vs `to-order.repository.ts:98-104,127` |
| Délai d'approvisionnement, MOQ, stock de sécurité, conditionnement | `lead_time_days` et `moq` sont **stockés mais jamais lus**. Le seuil minimum sert de stock de sécurité, alors qu'un seul article sur 377 en a un | `404_supplier_items.sql:23-24` ; grep : lus uniquement par le CRUD `supplier-item.*` |

**Écart :** l'étape existe en lecture (Plan directeur, « À commander »), mais elle n'émet rien seule. Sans seuils renseignés, même un déclencheur automatique ne déclencherait rien.

### Étape 2 — Demande d'achat (PR) · 🟥 contournée

| Standard | KALUM | Preuve |
|---|---|---|
| Pas de BC sans besoin formalisé (sauf urgence motivée) | `POST /purchase-orders` (ADMIN_MANAGER) crée un BC **sans DA**. Seuls 13 % des BC en sont issus | `purchase-order.routes.ts:61`, `purchase-order.controller.ts:92-97` ; mesure 45/357 |
| Machine à états de la DA | Statut calculé par `fn_recompute_purchase_request` (bon) mais l'état `ordered` n'est jamais posé ; 82/82 DA en `received`, zéro en attente | `305:101-128` |
| **BUG de schéma** | Le CHECK de statut en base locale **n'accepte pas `closed`** : la migration 271, rejouée après la 305, a remis l'ancien CHECK. « Clôturer le reliquat » échoue donc sur une violation de contrainte. **À vérifier en prod** | `271:29-33` remplace `305:52-54` ; `pg_constraint` local |
| Validation de la DA | Aucune : `pending` → BC directement | `to-order.repository.ts:167` |

### Étape 3 — Approbation (RBAC / SoD) · 🟥

| Standard | KALUM | Preuve |
|---|---|---|
| Barème complet (tous montants, par acheteur/catégorie) | Une seule règle : **HT > 5 000 DH → admin**. En dessous, le BC part sans approbation (`approval_limits` vide) | `350_approbations.sql:115-147` ; `governance.ts:97-105` |
| Montant comparé = engagement réel | `Σ quantité × prix` : **sans TVA, remise ni frais**. Aucune détection du **fractionnement** (deux BC de 4 900 DH le même jour) | `purchase-order.controller.ts:160-165` |
| Le demandeur n'approuve jamais | **L'admin qui envoie approuve lui-même** (`outcome: 'not_required'`) | `approval.service.ts:174-178` (relu) |
| Avenant après approbation = ré-approbation | `changeOrder` modifie un BC envoyé **sans repasser par l'approbation** | `purchase-order-actions.repository.ts:258` |
| Séparation des tâches **par document** (acheteur ≠ réceptionnaire ≠ comptable ≠ payeur) | Les `sod_rules` (mig 336) portent sur des **paires de droits par rôle**, vérifiées à l'attribution des droits seulement. BC, réception, facture, paiement et levée de hold sont tous en **ADMIN_MANAGER** : un même gérant fait la chaîne entière (97 % mesurés) | `reception-voucher.routes.ts:9-12`, `accounting.routes.ts:74-148,104,132` ; `access-rules.ts:177` |
| Contrôle d'accès appliqué | `security_module_enforcement = 'log'` : un refus est **journalisé puis la requête passe**. `requireVerb('purchasing','approve')` ne bloque qu'en `enforce` | `module-guard.middleware.ts:141-152` ; base : `log` |

### Étape 4 — Sourcing · 🟧

| Standard | KALUM | Preuve |
|---|---|---|
| Appel d'offres → BC au prix attribué | Présent (`rfqs`, `award`), mais c'est un **circuit isolé** : rien ne relie à une offre un BC créé autrement | `rfq.repository.ts:334-357` |
| Prix du BC = tarif contractuel ou écart justifié | Le prix du BC vient du client (`item.unitPrice ?? null`), du `unit_cost` de l'article ou du dernier prix payé. **Aucun contrôle hors tarif** | `purchase-order.repository.ts:324-327` ; `purchase-request.repository.ts:317` ; `to-order.repository.ts:139` |
| Le tarif alimente le BC | **C'est l'inverse :** la réception écrit le tarif (`recordSupplierPriceAtReception`, `source='reception'`). Le référentiel apprend le prix *payé* au lieu de *contraindre* le prix *commandé* | `supplier-item.repository.ts:179-185` |

### Étape 5 — Bon de commande (PO) · 🟧 (bon verrou, mauvais usage)

| Standard | KALUM | Preuve |
|---|---|---|
| Prix figé à l'émission | 🟩 Verrou en base une fois envoyé : quantité, remise et TVA gelées ; prix modifiable **seulement s'il était vide** | `307:379-414`, `306:189-191` |
| Envoi interdit sans prix | 🟩 `PO_UNPRICED` | `purchase-order.controller.ts:139-153` |
| …mais | La réception **remplit le prix BC vide** avec le prix reçu (17 lignes BC sans prix aujourd'hui). Le BC est saisi au moment de la livraison (75 % < 10 min) : le « prix figé » est le prix lu sur le bon de livraison | `reception-voucher.repository.ts:486` |
| Pas d'état `approuvé` distinct | `en_attente` sert à la fois de brouillon et d'état « en approbation » | `055:11-12` |

### Étape 6 — Réception (GR) · 🟧

| Standard | KALUM | Preuve |
|---|---|---|
| Réception adossée à un BC envoyé | 🟩 `FOR UPDATE` + statut `envoye/livre_partiel` exigé | `reception-voucher.repository.ts:393-402` |
| Prix de réception = prix BC (sinon écart bloqué) | Le réceptionnaire **saisit librement le prix**, sans tolérance. Ce prix devient le **coût du lot** et alimente le **CMUP** | `reception-voucher.repository.ts:480` (relu), `:573` ; `PurchaseOrdersTab.tsx:2483-2486` |
| CMUP à jour à la réception | 🟩 Moyenne pondérée sous verrou (`FOR UPDATE`), stock lu avant l'entrée. **Mais** calculée sur le prix *saisi*, alors que la GR/IR 4417 est passée au prix *BC* : stock et grand livre divergent dès qu'ils diffèrent | `:586, :620-634` (relu) vs `journal-generator.service.ts:378` (relu) |
| Toute entrée de stock passe par la même valorisation | Réappro direct (`inventory.controller.ts:18-68`) : lot valorisé au `unit_cost` courant, **CMUP non recalculé**. Ajustement positif (`stock-adjust.ts:32-39`) : lot `ADJ-` **sans coût, sans DLC**. Bilan : 34 lots actifs sans coût, 31 sans réception | mesures SQL |
| Poids réels intégrés | Quantité **saisie à la main** (ou nombre de contenants × taille). La balance WebSerial ne sert qu'au pesage BSI ; pas de brut/tare/net ni de poids variable à la réception | grep `navigator.serial` : absent de la réception ; `270:1-12` |
| Sur-livraison | 🟩 Tolérance 10 % appliquée en trigger | `307:189-196` |
| Lot / DLC obligatoires | Mode **`warn`** : 86 % des lots actifs n'ont pas de DLC. Seule une DLC déjà dépassée est refusée | `308:221-238` ; `module_parameters` |
| Contrôle qualité avant mise à disposition | Le contrôle (`reception_quality_checks`) se fait **après** la réception et ne bloque rien. Le lot naît `active` et la FEFO peut le consommer tout de suite. La quarantaine reste manuelle | `haccp.repository.ts:383-398` ; `ingredient-lot.repository.ts:632` |
| Écritures de réception | GR/IR passée dans la transaction, mais en mode **`outbox`** : si l'écriture échoue, la réception est quand même validée et l'écriture attend dans une file | `ledger-posting.service.ts:31-60` ; `ledger.posting_mode = outbox` |

### Étape 7 — Three-Way Matching · 🟥 (moteur présent, résultat neutralisé)

| Standard | KALUM | Preuve |
|---|---|---|
| La facture est la **pièce du fournisseur** (n°, montants imprimés) | 81 % des factures sont **fabriquées depuis la réception** : quantités = `quantity_delivered`, prix = dernier prix reçu. `declared_ht/vat/ttc` ne sont **jamais remplis**. Le n° fournisseur est facultatif | `reception-voucher.repository.ts:85,113-135,174,197` (relu) ; `309:7` (« copie du bon de réception ») |
| Match par ligne qté facturée ≤ reçue, prix facturé ≈ prix BC | 🟩 Le moteur existe (`fn_validate_invoice`, holds `QTY_REC`/`PRICE`, tolérances 2 % / 0,50 DH, mode `block`) **mais** : (a) facture = copie de la réception → jamais d'écart (**0 hold ouvert**) ; (b) seules les lignes portant `purchase_order_item_id` sont rapprochées, et `replaceItems` **efface ce lien** quand on modifie les lignes (54 lignes orphelines) | `309:237-315` ; `accounting.repository.ts:1341-1349` |
| Compteur « facturé » par ligne de BC | Absent (calculé en vue). `po_line_events` ne connaît que GR/CANCEL | `po_line_events` CHECK |
| Écart déclaré ≠ calculé | Branche morte : `declared_ttc` toujours NULL | `309:296-302` |
| Facture en brouillon, validée après contrôle | `validation_status` **par défaut `validated`**, et aucun code ne pose `draft`. Toute facture naît validée | `309:120` (relu) |
| Facture validée immuable | 🟩 Triggers `invoices_guard_validated`… **mais** contournés par `app.invoice_edit='on'`, que pose `PUT /invoices/:id` pour tout ADMIN/MANAGER tant qu'il n'y a pas de règlement | `309:486,526` ; `accounting.repository.ts:884,1323,1415` |
| Levée de hold par une autre personne que le payeur | Même groupe ADMIN_MANAGER pour lever et pour payer ; motif exigé, mais pas de quatre-yeux | `accounting.routes.ts:104,132` |
| Paiement sans facture rapprochée | Le trigger de garde des paiements **ignore** les paiements sans facture. `expense_requires_po` : désactivé par défaut dans le code (activé en local, seuil 500 DH) | `310:265` ; `module-parameters.service.ts:13` |
| Écart de prix (IPV) | **Pas de compte d'écart.** Le reliquat va en charge (`fromInvoice`) ; `source_kind 'price_variance'` déclaré mais jamais posté. Le coût du lot et le CMUP ne sont **jamais corrigés** par la facture | `journal-generator.service.ts:250-278` ; `311:31` |
| Avoir fournisseur / retour | `kind='credit_note'` existe dans le CHECK, mais aucun code ne le crée. Un « avoir » est en fait un pseudo-paiement (`payment_method='avoir'`). Pas de bon de retour fournisseur | `309:137` ; `accounting.repository.ts:292-305` |

### Transverse — sécurité des tables financières · 🟥

- L'application se connecte avec **un seul rôle PostgreSQL, superuser et BYPASSRLS**, propriétaire du schéma (`config/database.ts:15-17`, `migrate.ts:5`). Aucune `GRANT`/`REVOKE`/`POLICY` dans les 423 migrations. N'importe quelle requête applicative peut faire `ALTER TABLE … DISABLE TRIGGER` (la mig 310 le fait elle-même, `310:132`). Les triggers d'inaltérabilité (309/310/311/413) protègent donc **contre une erreur de code**, pas contre un accès malveillant ou une maladresse en console.
- Les contournements de triggers passent par des réglages de session (`app.invoice_edit`, `app.change_origin`, `app.po_events`), que le rôle applicatif peut poser **depuis n'importe quel chemin de code**. Ce sont des interrupteurs, pas des autorisations.
- `POST /invoices` n'a **aucun validateur** : le corps de la requête est passé tel quel au dépôt (`accounting.routes.ts:95`, `accounting.controller.ts:211-215`).

---

## 2. Évaluation des risques métier

### 2.1 Coût de revient des nomenclatures (BOM)

KALUM calcule **deux coûts** qui ne lisent pas la même source :

```
 Coût théorique (fiche technique)            Coût réel (fournée)
 v_recipe_*_cost  ──►  ingredients.unit_cost  production_lot_usage ──► ingredient_lots.unit_cost (lu EN DIRECT)
                         ▲  CMUP                                          ▲
                         │                                                │
             prix SAISI à la réception  ─────────────────────────────────┘
             (≠ prix BC, ≠ prix facture)
```

| # | Mécanisme | Effet sur le coût | Gravité |
|---|---|---|---|
| R1 | Le **prix de réception est libre** et devient le coût du lot et le CMUP | Une faute de frappe (prix du sac saisi comme prix au kg, ou l'inverse) contamine le CMUP **pour toutes les fournées suivantes**. Le CMUP lisse l'erreur sans jamais l'effacer : elle se dilue, mais on ne peut plus la retrouver | **Critique** |
| R2 | La **facture ne corrige jamais** le coût (ni IPV, ni réévaluation) | Remise de fin de facture, prix renégocié, erreur du bon de livraison : la vérité comptable (facture) ne remonte pas vers le coût matière. Marge des recettes faussée en permanence | **Critique** |
| R3 | GR/IR au **prix BC**, stock au **prix saisi** | La valorisation du stock (lots × coût) ≠ le solde 4417 + charges. L'écart n'a pas de compte : il est noyé en charge à la facture | Élevée |
| R4 | Le **coût réel lit `il.unit_cost` en direct**, sans instantané à la consommation | Un frais d'approche appliqué après coup (`lotAfter = lotBefore + inc`, `landed-cost.repository.ts:210-212`) **réécrit le coût des fournées passées**, déjà vendues. Une fournée close n'a pas un coût stable dans le temps | Élevée |
| R5 | Entrées hors réception (réappro direct, ajustement) : **pas de coût** ou coût sans CMUP | 8,4 % des consommations tirent des lots à coût nul → `COALESCE(il.unit_cost, 0)` ou repli sur le CMUP courant (`production-cout.repository.ts:156,172-175`). Coût réel **sous-évalué** sur ces fournées | Élevée |
| R6 | Le **tarif est appris de la réception** et non contractuel | Pas de prix standard de référence : on ne peut ni mesurer l'écart d'achat (PPV), ni distinguer un écart de **prix** d'un écart de **rendement** dans l'analyse des fournées | Moyenne |
| R7 | **Fractionnement** et absence de SoD | Un achat surfacturé (collusion, erreur) passe sans second regard, puis entre dans le CMUP comme un prix légitime | Élevée (fraude) |

**Exemple chiffré (R1 + R2).** Beurre, stock de 50 kg à 80 DH/kg. On réceptionne 25 kg. Le magasinier recopie le prix du carton (2 000 DH) au lieu du prix au kg (80 DH). CMUP = (50×80 + 25×2 000) / 75 = **720 DH/kg**. La facture arrive à 80 DH/kg : elle va en charge, rien ne corrige le CMUP. Toutes les recettes au beurre affichent un coût multiplié par 9 jusqu'à ce que le stock se renouvelle, et le coût réel des fournées qui consomment ce lot est faux pour toujours.

### 2.2 Traçabilité des lots matière

| # | Mécanisme | Effet sur la traçabilité | Gravité |
|---|---|---|---|
| T1 | **86 % des lots sans DLC** (mode `warn`) | La FEFO trie `expiration_date ASC NULLS LAST` : un lot sans DLC passe **après** tous les lots datés, ce qui inverse en pratique la rotation des stocks. Lors d'un rappel, on ne peut pas borner le risque par la date | **Critique** (ONSSA / HACCP) |
| T2 | **Contrôle qualité non bloquant**, lot `active` dès sa création | Un lot non conforme (température, emballage) peut être pesé et consommé avant même que son contrôle soit saisi | **Critique** |
| T3 | **31 lots actifs sans réception** (réappro direct, ajustements) | Ces lots n'ont **pas de fournisseur source fiable**. La chaîne de rappel `lot matière → client` (`/traceability/recall`) est rompue en amont pour eux | Élevée |
| T4 | BC de **régularisation** saisi a posteriori | La date de réception enregistrée est celle de la saisie, pas celle de l'arrivée physique. La fenêtre d'exposition d'un rappel et l'âge réel du lot sont faussés | Moyenne |
| T5 | **Quantité saisie à la main**, sans pesée | L'écart entre poids facturé et poids réel (casse, givrage, humidité sur fruits et viandes) n'est jamais constaté. Le bilan massique du lot (reçu = consommé + perte + restant) ne peut pas boucler | Moyenne |
| T6 | Le lot porte un **numéro fournisseur facultatif** | Lors d'un rappel émis *par le fournisseur* (cas le plus fréquent), il faut retrouver ses lots à partir de son numéro, et ce numéro manque | Élevée |

---

## 3. Plan de refactoring (feuille de route)

Principe : **d'abord rendre les contrôles bloquants et non contournables, ensuite seulement automatiser.** Automatiser un flux non contrôlé ne fait qu'accélérer les erreurs.

| Lot | Objectif | Contenu technique | Migr. | Dépend de | Effort |
|---|---|---|---|---|---|
| **L0 — Socle de sécurité** | Rendre les triggers et les droits réellement opposables | (1) Séparer les rôles PG : `kalum_owner` (DDL, migrations) / `kalum_app` (DML seulement, non superuser, ne peut désactiver aucun trigger). (2) Remplacer les interrupteurs `app.*` par des fonctions `SECURITY DEFINER` qui vérifient elles-mêmes l'acteur et le motif. (3) Passer `security_module_enforcement` en `enforce` après lecture des refus journalisés (`npm run audit:droits-routes`). (4) Ajouter un validateur zod sur `POST/PUT /invoices` | 424 | — | M |
| **L1 — Facture = pièce fournisseur** | Rendre le three-way matching significatif | (1) `validation_status` par défaut à `draft` ; pour valider, exiger `supplier_invoice_number` + `declared_ttc`. (2) La réception ne crée plus une facture validée : elle crée une **pré-facture brouillon** (préremplie, marquée `source='from_receipt'`) que le comptable doit **confronter au papier** et corriger (n°, montants imprimés). (3) `replaceItems` conserve `purchase_order_item_id`. (4) Compteur `qty_invoiced_base` alimenté par de nouveaux événements `IR` / `IR_REVERSAL` dans `po_line_events`. (5) Écran « Factures à confronter » | 425 | L0 | M |
| **L2 — Séparation des tâches par document** | Le même acteur ne fait jamais deux étapes incompatibles | Table `sod_document_rules` + fonction `fn_assert_sod()` appelée par les triggers de réception, validation de facture, levée de hold et paiement. Dérogation admin **motivée et journalisée** (paramètre `purchasing.sod_mode` : `warn` → `block`). Suppression de l'auto-approbation admin (sauf mode « structure mono-utilisateur » déclaré) | 426 | L0 | S |
| **L3 — Prix et valorisation** | Coût de revient juste et stable | (1) Prix de réception **figé au prix BC** ; un écart au-delà de la tolérance ouvre un `receipt_price_hold` qui exige un approbateur. (2) `stock_valuation_adjustments` : l'écart facture/réception réévalue la **quantité restante** du lot et du CMUP ; la part déjà consommée part en compte d'écart (IPV, `posting_profiles.price_variance`). (3) Coût **figé à la consommation** : `production_lot_usage.unit_cost_at_use`. (4) Frais d'approche : réévaluer le restant seulement, et passer l'écriture. (5) **Une seule fonction d'entrée en stock** `fn_stock_receipt()` (réception, réappro, ajustement) qui exige un coût et recalcule le CMUP | 427-428 | L1 | L |
| **L4 — Approbation complète** | Barème couvrant tous les montants | Règles par montant **TTC + frais**, cumul par fournisseur et par jour (anti-fractionnement), ré-approbation obligatoire sur avenant, contrôle **hors tarif** contre `supplier_item_prices` (hold `OFF_CONTRACT`). DA obligatoire pour un BC, sauf motif `urgence` | 429 | L2 | M |
| **L5 — Réception qualité et poids** | Lot exploitable seulement après contrôle | Lot créé en `quarantine` pour les catégories `requires_qc`, libéré par le contrôle ; `lot_dlc_enforcement` en `block` pour les catégories `requires_dlc` ; capture de pesée à la réception (réutiliser le module WebSerial du pesage BSI) avec **brut / tare / net** et écart poids facturé / poids réel ; n° de lot fournisseur obligatoire | 430 | L3 | M |
| **L6 — MRP déclencheur** | Identification automatique | Tâche planifiée `purchase_suggestions` (cron existant `/cron/tick`) : besoin net = brut − stock − **BC ouverts**, avec délai, MOQ, conditionnement et stock de sécurité distinct du seuil. Elle crée des DA à l'état `proposed`, qu'un humain transforme en BC. Unifier les calculs du MRP et de l'écran « À commander » | 431 | L4 | M |
| **Correctif immédiat** | Bug du CHECK `closed` | Recréer `purchase_requests_status_check` avec `closed` (et l'état `proposed` du L6) ; vérifier l'état en prod | 424 | — | XS |

Ordre recommandé : **Correctif → L0 → L1 → L2 → L3**. Ce sont ces lots qui rendent le coût de revient fiable. **L4 → L5 → L6** viennent ensuite. L3 est le seul lot qui déplace des montants (réévaluation) : il passe par un **dry-run sur staging**, comme le backfill CMUP.

Reprise de l'historique : les 302 factures `legacy_auto`/`from_receipt` restent `validated` avec un drapeau `needs_supplier_document` ; on ne les ré-ouvre pas. Les règles bloquantes ne s'appliquent qu'aux pièces créées après la mise en service (date pivot dans `module_parameters`).

---

## 4. Mise à niveau du modèle de données

> Brouillons de migrations à partir de **424** (dernière sur main : 423). À tester d'abord en `pg_temp` + `ROLLBACK` sur l'instance 5432 (voir mémoire « Postgres Homebrew 5432 »), puis sur une copie de la base. Noms de colonnes vérifiés contre la base locale au 01/11.

### 4.1 Machine à états P2P déclarative (424)

Au lieu de disperser les transitions dans les contrôleurs, une table de transitions autorisées et un trigger générique. Équivalent Oracle : un `BEFORE UPDATE OF status` appuyé sur une table de référence.

```sql
-- 424_p2p_machine_etats.sql
BEGIN;

-- Correctif : la 271 rejouée a écrasé le CHECK de la 305 (statut 'closed' perdu)
ALTER TABLE purchase_requests DROP CONSTRAINT IF EXISTS purchase_requests_status_check;
ALTER TABLE purchase_requests ADD CONSTRAINT purchase_requests_status_check
  CHECK (status IN ('proposed','pending','approved','assigned','ordered','received','closed','cancelled'));

-- BC : un état « approuvé » distinct du brouillon
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('en_attente','en_approbation','approuve','envoye','livre_partiel',
                    'livre_complet','en_attente_facturation','non_livre','annule'));

CREATE TABLE p2p_transitions (
  doc_type     VARCHAR(30) NOT NULL,          -- purchase_request | purchase_order | invoice
  from_status  VARCHAR(30) NOT NULL,
  to_status    VARCHAR(30) NOT NULL,
  required_verb VARCHAR(30),                  -- droit exigé (module purchasing) ; NULL = système
  system_only  BOOLEAN NOT NULL DEFAULT false,-- posé uniquement par un trigger (ex. réception)
  PRIMARY KEY (doc_type, from_status, to_status)
);

INSERT INTO p2p_transitions VALUES
  ('purchase_order','en_attente','en_approbation','create',false),
  ('purchase_order','en_attente','approuve','approve',true),        -- sous le seuil, posé par le moteur
  ('purchase_order','en_approbation','approuve','approve',true),
  ('purchase_order','en_approbation','en_attente',NULL,true),       -- refus / retrait
  ('purchase_order','approuve','envoye','send',false),
  ('purchase_order','envoye','livre_partiel',NULL,true),
  ('purchase_order','envoye','livre_complet',NULL,true),
  ('purchase_order','livre_partiel','livre_complet',NULL,true),
  ('purchase_order','envoye','en_attente_facturation',NULL,true),
  ('purchase_order','livre_partiel','en_attente_facturation',NULL,true),
  ('purchase_order','en_attente_facturation','livre_complet',NULL,true),
  ('purchase_order','en_attente','annule','cancel',false),
  ('purchase_order','approuve','annule','cancel',false),
  ('purchase_order','envoye','non_livre','cancel',false),
  ('invoice','draft','validated','validate',false),
  ('invoice','draft','cancelled','cancel',false),
  ('invoice','validated','cancelled','cancel',false);

CREATE OR REPLACE FUNCTION fn_guard_p2p_transition() RETURNS trigger AS $$
DECLARE v_doc text := TG_ARGV[0]; v_col text := TG_ARGV[1];
        v_from text; v_to text; v_t p2p_transitions%ROWTYPE;
BEGIN
  EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', v_col, v_col) INTO v_from, v_to USING OLD, NEW;
  IF v_from IS NOT DISTINCT FROM v_to THEN RETURN NEW; END IF;
  SELECT * INTO v_t FROM p2p_transitions
   WHERE doc_type = v_doc AND from_status = v_from AND to_status = v_to;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transition % → % interdite pour %', v_from, v_to, v_doc USING ERRCODE = 'OF409';
  END IF;
  IF v_t.system_only AND current_setting('app.p2p_system', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Transition % → % réservée au système', v_from, v_to USING ERRCODE = 'OF409';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_po_transition BEFORE UPDATE OF status ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION fn_guard_p2p_transition('purchase_order','status');
CREATE TRIGGER trg_invoice_transition BEFORE UPDATE OF validation_status ON invoices
  FOR EACH ROW EXECUTE FUNCTION fn_guard_p2p_transition('invoice','validation_status');

-- Réception : uniquement sur un BC envoyé (déjà vrai côté dépôt, désormais en base)
CREATE OR REPLACE FUNCTION fn_rv_requires_sent_po() RETURNS trigger AS $$
BEGIN
  IF NEW.voucher_kind = 'receipt' AND NOT EXISTS (
       SELECT 1 FROM purchase_orders WHERE id = NEW.purchase_order_id
        AND status IN ('envoye','livre_partiel')) THEN
    RAISE EXCEPTION 'Réception impossible : BC non envoyé' USING ERRCODE = 'OF409';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_rv_requires_sent_po BEFORE INSERT ON reception_vouchers
  FOR EACH ROW EXECUTE FUNCTION fn_rv_requires_sent_po();

COMMIT;
```

> Reprise : aucun BC n'est en `en_attente` en base locale (348 `livre_complet`, 4 `en_attente_facturation`, 3 `non_livre`, 2 `annule`), il n'y a donc rien à migrer ici. À vérifier en prod. Côté code, `purchaseOrderActionsRepository.send` fait aujourd'hui `en_attente → envoye` directement : il doit passer par `approuve`, et les transitions réception/facturation doivent poser `app.p2p_system`. Il faut relever la liste exacte des transitions réellement émises par le code (`grep "SET status"`) avant d'activer le trigger.

### 4.2 Facture = pièce fournisseur + compteur facturé (425)

```sql
-- 425_facture_piece_fournisseur.sql
BEGIN;
ALTER TABLE invoices ALTER COLUMN validation_status SET DEFAULT 'draft';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS needs_supplier_document BOOLEAN NOT NULL DEFAULT false;
UPDATE invoices SET needs_supplier_document = true
 WHERE invoice_type = 'received' AND source IN ('legacy_auto','from_receipt')
   AND (supplier_invoice_number IS NULL OR declared_ttc IS NULL);

-- Valider une facture reçue exige la pièce : n° fournisseur + total imprimé
CREATE OR REPLACE FUNCTION fn_invoice_validation_requires_document() RETURNS trigger AS $$
BEGIN
  IF NEW.invoice_type = 'received' AND NEW.kind IN ('invoice','credit_note')
     AND NEW.validation_status = 'validated' AND OLD.validation_status = 'draft'
     AND (NULLIF(trim(NEW.supplier_invoice_number),'') IS NULL OR NEW.declared_ttc IS NULL) THEN
    RAISE EXCEPTION 'Validation impossible : n° et total TTC de la facture fournisseur requis'
      USING ERRCODE = 'OF409';
  END IF;
  NEW.validated_at := COALESCE(NEW.validated_at, now());
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_invoice_requires_document BEFORE UPDATE OF validation_status ON invoices
  FOR EACH ROW EXECUTE FUNCTION fn_invoice_validation_requires_document();

-- Compteur facturé par ligne de BC, alimenté comme qty_received_base (événements append-only)
ALTER TABLE po_line_events DROP CONSTRAINT IF EXISTS po_line_events_event_type_check;
ALTER TABLE po_line_events ADD CONSTRAINT po_line_events_event_type_check
  CHECK (event_type IN ('GR','GR_REVERSAL','CANCEL','CANCEL_REVERSAL','LEGACY_ADJUST','IR','IR_REVERSAL'));
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS qty_invoiced_base NUMERIC(14,4) NOT NULL DEFAULT 0;
-- trg_po_line_events_apply (mig 307) : ajouter la branche IR/IR_REVERSAL → qty_invoiced_base,
-- avec garde « qty_invoiced_base ≤ qty_received_base × (1 + match_tolerances.qty_pct) ».
-- Événement IR posé à la VALIDATION de la facture (pas à sa création), IR_REVERSAL à l'annulation.

-- Une ligne de facture reçue liée à un BC garde son lien (replaceItems le perdait)
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS reception_voucher_item_id UUID
  REFERENCES reception_voucher_items(id);
CREATE INDEX IF NOT EXISTS ix_invoice_items_poi ON invoice_items(purchase_order_item_id);
COMMIT;
```

### 4.3 Séparation des tâches par document (426)

```sql
-- 426_sod_document.sql
BEGIN;
CREATE TABLE sod_document_rules (
  code        VARCHAR(40) PRIMARY KEY,
  action      VARCHAR(30) NOT NULL,   -- receive | validate_invoice | release_hold | pay
  forbidden   VARCHAR(30) NOT NULL,   -- acteur d'une étape antérieure qui ne peut pas faire l'action
  is_active   BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO sod_document_rules VALUES
  ('GR_NOT_BUYER',      'receive',          'po_creator',        true),
  ('IV_NOT_RECEIVER',   'validate_invoice', 'receiver',          true),
  ('HOLD_NOT_PAYER',    'release_hold',     'payer',             true),
  ('PAY_NOT_VALIDATOR', 'pay',              'invoice_validator', true);

CREATE TABLE sod_overrides (          -- dérogation tracée (petite structure : 1 seul gérant)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code VARCHAR(40) NOT NULL REFERENCES sod_document_rules(code),
  doc_type VARCHAR(30) NOT NULL, doc_id UUID NOT NULL,
  actor_id UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE UPDATE, DELETE ON sod_overrides FROM PUBLIC;   -- append-only (cf. L0 pour le rôle app)

-- Exemple : réception
CREATE OR REPLACE FUNCTION fn_sod_receive() RETURNS trigger AS $$
DECLARE v_mode text := COALESCE((SELECT value->>'mode' FROM module_parameters
                                  WHERE key = 'purchasing.sod_mode'), 'warn');
BEGIN
  IF v_mode = 'block' AND NEW.voucher_kind = 'receipt'
     AND EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = NEW.purchase_order_id
                  AND po.created_by = NEW.received_by)
     AND NOT EXISTS (SELECT 1 FROM sod_overrides o WHERE o.rule_code = 'GR_NOT_BUYER'
                  AND o.doc_id = NEW.purchase_order_id AND o.actor_id = NEW.received_by) THEN
    RAISE EXCEPTION 'Séparation des tâches : l''auteur du BC ne peut pas le réceptionner'
      USING ERRCODE = 'OF403';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_sod_receive BEFORE INSERT ON reception_vouchers
  FOR EACH ROW EXECUTE FUNCTION fn_sod_receive();
-- Même patron pour invoices (validated_by vs reception_vouchers.received_by),
-- invoice_holds (released_by vs payments.created_by) et payments (created_by vs invoices.validated_by).

INSERT INTO module_parameters(key, value) VALUES ('purchasing.sod_mode', '{"mode":"warn"}')
ON CONFLICT (key) DO NOTHING;
COMMIT;
```

### 4.4 Prix de réception, écarts et valorisation (427-428)

```sql
-- 427_prix_reception_ecarts.sql
BEGIN;
-- Prix reçu ≠ prix BC au-delà de la tolérance → hold de réception, lot en quarantaine
ALTER TABLE reception_voucher_items
  ADD COLUMN IF NOT EXISTS price_status VARCHAR(12) NOT NULL DEFAULT 'ok'
    CHECK (price_status IN ('ok','variance','approved','rejected')),
  ADD COLUMN IF NOT EXISTS price_approved_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS price_approved_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION fn_rvi_price_check() RETURNS trigger AS $$
DECLARE v_tol match_tolerances%ROWTYPE;
BEGIN
  SELECT * INTO v_tol FROM match_tolerances WHERE scope_type = 'global' LIMIT 1;
  IF NEW.po_unit_price IS NOT NULL AND NEW.unit_price IS NOT NULL
     AND abs(NEW.unit_price - NEW.po_unit_price)
         > GREATEST(v_tol.price_abs, NEW.po_unit_price * v_tol.price_pct / 100) THEN
    NEW.price_status := 'variance';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_rvi_price_check BEFORE INSERT ON reception_voucher_items
  FOR EACH ROW EXECUTE FUNCTION fn_rvi_price_check();
-- Côté dépôt : un lot issu d'une ligne 'variance' naît status='quarantine' et n'entre pas
-- dans le CMUP tant que price_status ∉ ('ok','approved') ; l'approbation recalcule le CMUP.

-- Coût figé à la consommation : le coût réel d'une fournée ne bouge plus
ALTER TABLE production_lot_usage ADD COLUMN IF NOT EXISTS unit_cost_at_use NUMERIC(12,4);
CREATE OR REPLACE FUNCTION fn_plu_snapshot_cost() RETURNS trigger AS $$
BEGIN
  SELECT COALESCE(il.unit_cost, i.unit_cost) INTO NEW.unit_cost_at_use
    FROM ingredient_lots il JOIN ingredients i ON i.id = il.ingredient_id
   WHERE il.id = NEW.ingredient_lot_id;
  IF NEW.unit_cost_at_use IS NULL OR NEW.unit_cost_at_use = 0 THEN
    RAISE WARNING 'Consommation sans coût (lot %)', NEW.ingredient_lot_id;  -- → 'block' après reprise
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_plu_snapshot_cost BEFORE INSERT ON production_lot_usage
  FOR EACH ROW EXECUTE FUNCTION fn_plu_snapshot_cost();
UPDATE production_lot_usage plu SET unit_cost_at_use = il.unit_cost      -- reprise : coût actuel
  FROM ingredient_lots il WHERE il.id = plu.ingredient_lot_id AND plu.unit_cost_at_use IS NULL;
COMMIT;
```

```sql
-- 428_stock_valuation_adjustments.sql — écart facture → stock restant + compte d'écart
BEGIN;
CREATE TABLE stock_valuation_adjustments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind        VARCHAR(20) NOT NULL CHECK (source_kind IN ('invoice_price','landed_cost','manual')),
  source_id          UUID NOT NULL,                       -- invoice_items.id / landed_cost_vouchers.id
  ingredient_lot_id  UUID REFERENCES ingredient_lots(id),
  ingredient_id      UUID REFERENCES ingredients(id),
  packaging_id       UUID REFERENCES packaging_items(id),
  qty_basis          NUMERIC(14,4) NOT NULL,              -- quantité facturée concernée
  qty_remaining      NUMERIC(14,4) NOT NULL,              -- part encore en stock → réévaluée
  unit_delta         NUMERIC(12,4) NOT NULL,              -- prix facture − prix lot
  amount_to_stock    NUMERIC(14,2) NOT NULL,              -- unit_delta × qty_remaining
  amount_to_variance NUMERIC(14,2) NOT NULL,              -- unit_delta × (qty_basis − qty_remaining)
  cmup_before        NUMERIC(12,4), cmup_after NUMERIC(12,4),
  journal_entry_id   UUID REFERENCES journal_entries(id),
  created_by         UUID NOT NULL REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(ingredient_id, packaging_id) = 1),
  CHECK (amount_to_stock + amount_to_variance = round(unit_delta * qty_basis, 2)),
  UNIQUE (source_kind, source_id, ingredient_lot_id)       -- idempotence
);
-- Append-only, même patron que po_line_events (mig 307)
CREATE TRIGGER trg_sva_immutable BEFORE UPDATE OR DELETE ON stock_valuation_adjustments
  FOR EACH ROW EXECUTE FUNCTION fn_forbid_mutation();   -- fonction existante à réutiliser ou créer

INSERT INTO posting_profiles(code, account_code, label)        -- adapter aux colonnes réelles
VALUES ('price_variance', '6129', 'Écarts sur prix d''achat matières')
ON CONFLICT DO NOTHING;
COMMIT;
```

Règle de calcul (à la **validation** de la facture, dans la même transaction que l'événement `IR`) :
`unit_delta = prix_facture − lot.unit_cost` ; `qty_remaining = min(lot.quantity_remaining, qty_basis)` ; le lot passe à `unit_cost + unit_delta` **pour le restant seulement** (couche de coût), le CMUP est recalculé sur le restant, et la part déjà consommée part en `price_variance`. Les fournées passées restent figées grâce à `unit_cost_at_use`. Les frais d'approche suivent la même table (`source_kind='landed_cost'`), ce qui corrige R4.

### 4.5 Rôles PostgreSQL et intégrité (L0, 424 bis — hors migration applicative)

À jouer **une fois par environnement** avec un compte d'administration, pas par `npm run migrate` :

```sql
CREATE ROLE kalum_owner NOLOGIN;                         -- propriétaire du schéma
CREATE ROLE kalum_app LOGIN PASSWORD :'app_pwd' NOSUPERUSER NOBYPASSRLS NOCREATEROLE;
REASSIGN OWNED BY ofauria TO kalum_owner;                -- tables, fonctions, séquences
GRANT USAGE ON SCHEMA public TO kalum_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kalum_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalum_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO kalum_app;
-- Tables append-only : ni UPDATE ni DELETE pour l'application
REVOKE UPDATE, DELETE ON po_line_events, document_actions, ledger_audit_log,
                         stock_valuation_adjustments, sod_overrides FROM kalum_app;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM kalum_app;
-- kalum_app n'étant plus propriétaire, ALTER TABLE … DISABLE TRIGGER lui est refusé.
ALTER DEFAULT PRIVILEGES FOR ROLE kalum_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kalum_app;
```

Conséquences à traiter avant la bascule :
- `DATABASE_URL` (application) → `kalum_app` ; `MIGRATION_DATABASE_URL` (migrations) → un rôle membre de `kalum_owner`. `config/migrate.ts` lit aujourd'hui la même URL que l'app.
- Les migrations qui font `DISABLE TRIGGER` (ex. 310) restent possibles, mais seulement via le compte de migration.
- Les interrupteurs `app.invoice_edit` / `app.change_origin` / `app.po_events` deviennent des fonctions `SECURITY DEFINER` appartenant à `kalum_owner` (ex. `fn_invoice_edit(p_invoice uuid, p_actor uuid, p_reason text)`). Elles vérifient l'état de la pièce et journalisent l'acteur. L'application n'a plus le droit d'écrire directement les colonnes protégées (`REVOKE UPDATE (total_amount, amount, …) ON invoices FROM kalum_app`).
- RLS : utile seulement lors du passage multi-tenant (`tenant_id`, voir mémoire « SaaS multi-industries »). Ce n'est pas un prérequis de ce chantier.

### 4.6 MRP déclencheur (431)

```sql
CREATE TABLE purchase_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL, run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  store_id UUID REFERENCES stores(id),
  ingredient_id UUID REFERENCES ingredients(id), packaging_id UUID REFERENCES packaging_items(id),
  supplier_item_id UUID REFERENCES supplier_items(id),
  gross_need NUMERIC(14,4) NOT NULL, on_hand NUMERIC(14,4) NOT NULL,
  on_order NUMERIC(14,4) NOT NULL, safety_stock NUMERIC(14,4) NOT NULL DEFAULT 0,
  net_need NUMERIC(14,4) GENERATED ALWAYS AS
    (GREATEST(gross_need + safety_stock - on_hand - on_order, 0)) STORED,
  suggested_qty NUMERIC(14,4) NOT NULL,          -- arrondi MOQ / conditionnement
  need_by DATE NOT NULL, order_by DATE NOT NULL,  -- need_by − lead_time_days
  source VARCHAR(20) NOT NULL CHECK (source IN ('threshold','production_plan','order','forecast')),
  purchase_request_id UUID REFERENCES purchase_requests(id),   -- transformée en DA 'proposed'
  CHECK (num_nonnulls(ingredient_id, packaging_id) = 1)
);
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS safety_stock NUMERIC(14,4);  -- distinct du seuil d'alerte
INSERT INTO scheduled_jobs(code, ...) VALUES ('purchase_suggestions', ...);   -- cron existant (mig 364)
```

---

## 5. Ce qui est déjà conforme (à ne pas casser)

- Verrou du BC après envoi, journal append-only des lignes (`po_line_events`), versions et avenants (306/307).
- Réception adossée à un BC envoyé, CMUP sous verrou, double comptage stock supprimé (308).
- Moteur de holds par ligne, tolérances paramétrées, paiement refusé sur hold bloquant (309/310).
- GR/IR 4417 par ligne de BC, écritures jamais supprimées, chaînage SHA-256 (311/413).
- Appels d'offres, frais d'approche au poids, évaluation fournisseurs, devises (360-363, 392).

L'essentiel du travail consiste donc à **rendre bloquant et non contournable** ce qui existe, à **inverser deux sens** (le tarif contraint le BC au lieu d'être appris de la réception ; la facture corrige le stock au lieu d'être copiée de la réception), et à **figer le coût à la consommation**.

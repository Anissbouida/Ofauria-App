# Audit du cycle de vente Kalum — Analyse d'écart Order-to-Cash (O2C)

*Rédigé le 2026-11-01, sur `main` à 2a9aba7 (migrations ≤ 427). Lecture du code serveur, des migrations et de la base locale. Rien n'a été modifié.*

Le document compare le cycle de vente actuel de Kalum au standard O2C en 7 étapes. Il ne se limite pas à la description du processus : chaque constat renvoie au fichier et à la ligne qui le prouvent. Les points marqués **(déduit)** sont des conséquences logiques du code, pas des cas reproduits.

---

## 0. Synthèse

### Verdict par étape

| # | Étape O2C | Maturité (0-5) | En une phrase |
|---|---|:-:|---|
| 1 | Gestion des commandes | **2** | Quatre entités de vente parallèles, aucune machine à états, prix modifiable librement par une caissière. |
| 2 | Contrôle de crédit | **2** | Le contrôle existe, mais seulement à la création d'une commande pro, en simple avertissement par défaut. Une caissière peut relever le plafond. |
| 3 | Exécution | **2,5** | Bon socle (sourcing auto, réservation, lien commande → plan), mais la modification d'une commande l'efface et l'annulation laisse le plan actif. |
| 4 | Expédition / sortie de stock | **0,5** | **Le BL professionnel ne sort aucun stock et ne capture aucun lot.** Une seule livraison par commande, sans reliquat. |
| 5 | Facturation | **3** | Bonne base (facture sur quantité livrée du BL), mais factures émises modifiables après envoi, aucun avoir, factures sans livraison possibles. |
| 6 | Encaissement | **2** | Un règlement = une facture ; encaissement non affecté passé en produit (7585) ; tickets à crédit absents du grand livre. |
| 7 | Reconnaissance du revenu | **1,5** | Avances comptées en CA dès l'encaissement, pas de FAE à la clôture, aucun coût des ventes figé. |

### Les cinq constats qui comptent

1. **Rupture de traçabilité aval sur le B2B.** Les bons de livraison n'ont aucun lien avec les lots (`delivery_note_items` n'a ni lot ni ligne de commande). Le rappel de lot (`/traceability/recall`) ne voit donc **aucun client professionnel**. Or ce sont précisément les clients que la réglementation oblige à pouvoir notifier (traçabilité « un pas en aval »).
2. **Stock fantôme puis fausses pertes.** La production pour commande crée du stock en réserve. Aucun chemin commande/BL ne le décrémente : la réservation est libérée à la livraison, le stock reste. À la DLC, `autoExpireDueLots` le passe en perte. Le food cost et le taux de perte sont faussés à chaque commande livrée.
3. **Quatre types de mouvements de stock rejetés par la base.** Le code écrit `'adjust'` et `'retour_invendus'`, que la contrainte `product_stock_transactions_type_check` refuse (vérifié en base locale). Les transactions concernées échouent entièrement (retour d'invendus en stock, régularisation de surplus, suppression d'une perte, contrôle d'ouverture).
4. **Facture client modifiable et statut forçable.** `assertInvoiceEditable` ne protège que les factures fournisseurs. Un manager peut modifier une facture émise déjà envoyée, ou la passer « payée » sans règlement : elle sort des créances et des relances alors que le 3421 reste ouvert.
5. **Pas de coût des ventes.** Aucun coût n'est figé sur les lignes vendues (ticket, commande, BL, facture). Le rapport de marges exclut le B2B et applique le coût *actuel* aux ventes passées : les marges historiques bougent à chaque mise à jour de recette.

### Ce qui est déjà bien fait (à conserver)

- **La facture B2B naît du BL, sur la quantité livrée** (`delivery-note.repository.ts:268-316`). C'est la bonne règle O2C ; il manque le plafond sur la quantité commandée.
- **Numérotation des factures sans trou** dans la transaction (mig 329), suppression bloquée par trigger (`guard_emitted_invoice`).
- **Sourcing automatique à la commande** : stock réserve net du réservé, puis frigo, puis quantité à produire, avec un plan de production lié par `order_id` (mig 032/119/389).
- **FEFO avec capture de lot au ticket de caisse** (`sale_item_lots`, mig 337), qui tient compte de la DLC effective des lots décongelés (mig 426).
- **Lettrage contraint par trigger différé** (mig 420) et auto-lettrage des factures soldées.
- **Ticket comptoir = O2C condensé** (commande + sortie + facture + encaissement en une transaction). C'est légitime en boulangerie et ne doit pas être alourdi.

---

## 1. Cartographie du processus actuel

### 1.1 Quatre entités de vente sans document central

| Entité | Tables | Statuts | Usage |
|---|---|---|---|
| Ticket de caisse | `sales`, `sale_items` (mig 011) | `sale_type` : standard, advance, delivery, special ; `payment_status` : paid, unpaid | Comptoir B2C, avances, soldes de commande, « vente spéciale » B2B |
| Commande | `orders`, `order_items` (mig 008/015) | pending, confirmed, in_production, ready, completed, cancelled | Commandes particulier et pro |
| Devis / proforma | `quotes`, `quote_items` (mig 365) | draft, sent, accepted, refused, expired, converted, cancelled | Avant-vente, convertible en commande |
| Bon de livraison | `delivery_notes`, `delivery_note_items` (mig 352) | delivered, invoiced, cancelled | Livraison pro, base de la facture |
| Facture émise | `invoices` (`invoice_type='emitted'`) | pending, partial, paid, overdue, cancelled, disputed | Facture client (BL, manuelle, abonnement) |

S'y ajoutent les tickets en attente (`pos_parked_tickets`, mig 373, JSONB, jamais une vente) et les abonnements (mig 382), qui génèrent directement des factures émises.

### 1.2 Les cinq parcours réels

```
B2C comptoir      Ticket ─────────────────────────────────────────────► Écriture 5161/5141 → 7111
                  (FEFO vitrine + sale_item_lots, même transaction)

B2C commande      Commande ─► Plan auto ─► ready ─► Remise caisse (ticket "delivery" ou "standard")
particulier       │ avance = ticket "advance" (7111 immédiat)            │ avec avance : AUCUNE sortie, AUCUN lot
                  │                                                      │ sans avance : sortie VITRINE (pas réserve)

B2B commande pro  Commande ─► Plan auto ─► ready ─► BL (statut "delivered" dès création) ─► Facture FE ─► Règlement
                  credit gate           AUCUNE sortie de stock, AUCUN lot     3421/7111/4455   1 règlement = 1 facture

B2B vente         Ticket "special" : prix libres, TVA 0, aucune sortie de stock, supprimable par l'admin
spéciale (legacy)

Abonnement        Abonnement ─► Facture FE périodique (y compris « pain en dépôt récurrent ») : ni commande, ni BL, ni stock
```

Le seul parcours où la marchandise sort physiquement du stock *avec* son lot est le ticket comptoir standard.

---

## 2. Analyse d'écart détaillée

Gravité : **P0** = risque sanitaire, fiscal ou d'intégrité des données, à corriger en premier ; **P1** = écart structurel au standard O2C ; **P2** = robustesse ou confort.

### 2.1 Étape 1 — Gestion des commandes

| ID | Standard O2C | Kalum aujourd'hui | Preuve | Grav. |
|---|---|---|---|:-:|
| G-OM-01 | Une entité « commande » unique, tous canaux | 4 entités parallèles ; la vente spéciale B2B contourne commande et BL | `sale.controller.ts:334-482` | P1 |
| G-OM-02 | Machine à états contrôlée | Aucune matrice de transitions : `ready → pending` accepté ; seul `completed` est refusé à la main | `order.controller.ts:376-418` | P1 |
| G-OM-03 | Canal de vente porté par la commande | `orders` et `quotes` n'ont pas de `channel_id` ; les tickets issus de commandes ont un canal NULL | `order.controller.ts:268, 489` | P2 |
| G-OM-04 | Grille tarifaire appliquée strictement, dérogation tracée | `unitPrice` saisi gagne toujours, ouvert à la caissière, sans validateur, ni approbation, ni journal | `order.controller.ts:100-122`, `orders.routes.ts:15-16` | P1 |
| G-OM-05 | Remise bornée par rôle | `discountPct` 0-100 non contrôlé ; la remise personnel n'est appliquée que côté client | `order.controller.ts:64-76`, `OrderFormModal.tsx:283` | P1 |
| G-OM-06 | Lignes de commande stables (identifiant pérenne) | La modification supprime et réinsère `order_items` sans les colonnes de sourcing ; réservations et plan non resynchronisés | `order.repository.ts:205-213` | P1 |
| G-OM-07 | Transactions atomiques | Création de commande, ticket d'avance et promotion en trois écritures séparées ; conversion de devis sans verrou (double conversion possible) | `order.controller.ts:254-288`, `quote.repository.ts:343-362` | P1 |
| G-OM-08 | Date de document non antidatable sans droit | `orderDate` libre pour tout rôle SALES | `order.repository.ts:87` | P2 |
| G-OM-09 | Historique des modifications | Aucun trigger d'audit sur `orders`, `sales`, `quotes` | — | P2 |
| G-OM-10 | Devis : acceptation avant conversion | Conversion autorisée depuis `draft` ; promotions expirées conservées à la conversion | `quote.repository.ts:315, 334` | P2 |

### 2.2 Étape 2 — Contrôle de crédit

| ID | Standard O2C | Kalum aujourd'hui | Preuve | Grav. |
|---|---|---|---|:-:|
| G-CR-01 | Blocage automatique (mode bloquant par défaut) | Paramètre `sales.dunning.credit_control` = `warn` par défaut ; en `warn`, la commande est enregistrée puis un avertissement est renvoyé | mig 366:114, `order.controller.ts:227-230` | P1 |
| G-CR-02 | Contrôle aux jalons : confirmation, lancement production, expédition | Contrôlé à la création de commande pro, à la conversion de devis et au ticket impayé seulement. **Pas** à la confirmation, au lancement de production, au BL ni à la facture | `order.controller.ts:372`, `quote.repository.ts:338-341`, `sale.controller.ts:177-180` | P1 |
| G-CR-03 | Encours unique et complet | Deux calculs : la commande inclut les commandes ouvertes et BL non facturés ; le POS non | `order.controller.ts:125-140` vs `dunning.repository.ts:293-304` | P1 |
| G-CR-04 | Données de crédit réservées à la direction | **Tout rôle SALES (caissière comprise) peut modifier `credit_limit`, `remise_pct`, `customer_type`, `tva_exonere`** via `PUT /customers/:id`. Passer un client de pro à particulier contourne tout le parcours direction | `customers.routes.ts:36`, `customer.repository.ts:98-107` | **P0** |
| G-CR-05 | Dérogation tracée | Aucun journal des contrôles ni des dérogations | — | P1 |
| G-CR-06 | Contrôle des ventes à crédit hors commandes | `createSpecial` impayé et commandes particulier non contrôlés | `sale.controller.ts:334-482` | P2 |

### 2.3 Étape 3 — Exécution (allocation / ordres de fabrication)

| ID | Standard O2C | Kalum aujourd'hui | Preuve | Grav. |
|---|---|---|---|:-:|
| G-FF-01 | Ordre de fabrication daté sur le besoin | Le plan auto est daté du jour de la commande (`CURRENT_DATE`), pas de la date de retrait | `sourcing.helper.ts:214` | P1 |
| G-FF-02 | Pas de double comptage du besoin | Le MRP lit les commandes ouvertes comme besoin ferme à la date de retrait, sans netter le plan auto déjà créé pour elles **(déduit : double production possible)** | `mrp.repository.ts:33-66, 202-230` | P1 |
| G-FF-03 | Annulation propagée à la fabrication | Annuler une commande laisse son plan auto actif | `order.controller.ts:376-418` | P1 |
| G-FF-04 | Lien commande ↔ OF exact | La fin de production passe en `ready` toutes les commandes `in_production` du même jour et produit, même non liées | `production.repository.ts:1270-1280, 1879-1890` | P2 |
| G-FF-05 | Réservation couvrant toute la quantité servie du stock | Seule la réserve est réservée ; le frigo est utilisé pour le sourcing mais pas réservé | `sourcing.helper.ts:65-74, 153-155` | P2 |
| G-FF-06 | Allocation de lots finis à la commande (avec DLC résiduelle client) | Aucune allocation de lot à une commande | — | P1 |
| G-FF-07 | Sourcing systématique | Sauté silencieusement si l'utilisateur n'a pas de `storeId` | `order.repository.ts:117-153` | P2 |
| G-FF-08 | Semi-finis détectés dans la même transaction | `detectAndCreateSemiFinishedPlans` ouvre sa propre connexion alors que le plan n'est pas encore commité **(déduit : ne trouve rien)** ; et une erreur SQL dans le try/catch sans savepoint annulerait la commande | `production.repository.ts:2393`, `sourcing.helper.ts:272-279` | P1 |

### 2.4 Étape 4 — Expédition (sortie de stock, lots, BL)

C'est l'étape la plus en retrait, et celle qui porte le risque sanitaire.

| ID | Standard O2C | Kalum aujourd'hui | Preuve | Grav. |
|---|---|---|---|:-:|
| G-GI-01 | Sortie d'inventaire à l'expédition | **Aucune sortie de stock** pour le BL pro, la commande particulier avec avance, la vente spéciale, l'import CSV | `delivery-note.repository.ts:9-12`, `sale.repository.ts:225-231` | **P0** |
| G-GI-02 | Capture obligatoire des lots expédiés | Aucun lot sur `delivery_note_items` ni `order_items` ; au ticket, capture « best effort » : la quantité non couverte part sans lot, silencieusement | `sale.repository.ts:280-282` | **P0** |
| G-GI-03 | Rappel couvrant tous les clients livrés | Les deux systèmes de rappel (mig 316 et 337) ignorent BL et commandes : **aucun client B2B traçable** | `recall.repository.ts`, `traceability.repository.ts` | **P0** |
| G-GI-04 | Le stock sorti est celui qui était réservé | Commande particulier sans avance : sortie **vitrine** alors que la réservation et la production sont en réserve **(déduit : refus « stock vitrine insuffisant » à la remise si le produit est encore en réserve)** | `order.controller.ts:452-509` | P1 |
| G-GI-05 | Livraisons partielles, reliquat | Index unique `uq_delivery_notes_order` : un seul BL non annulé par commande ; le reliquat est perdu (commande `completed`) | mig 352:41, `delivery-note.repository.ts:164` | P1 |
| G-GI-06 | Quantité livrée bornée par la commande (avec tolérance) | Aucune borne supérieure : sur-livraison acceptée | `delivery-note.repository.ts:198-206` | P1 |
| G-GI-07 | Lien ligne BL → ligne de commande | Lignes de BL libres, sans `order_item_id`, non contrôlées contre la commande en création directe | `delivery-note.repository.ts:122-174` | P1 |
| G-GI-08 | Statut « expédié » distinct de « livré », preuve de livraison | Le BL est `delivered` dès sa création ; preuve = nom saisi au clavier ; le pointage de l'arrêt de tournée ne met pas à jour le BL | mig 354, `delivery-route.repository.ts:84-88` | P1 |
| G-GI-09 | Annulation d'expédition réversible et cohérente | Annuler un BL ne rouvre pas la commande, ne re-réserve pas | `delivery-note.repository.ts:231-237` | P1 |
| G-GI-10 | Contrôle DLC / état à l'expédition | `checkSaleability` ignore `dlc_effective` (FEFO l'utilise) et lit hors transaction ; les lots surgelés sont vendables en FEFO | `product-lot.repository.ts:241-265` | P1 |
| G-GI-11 | Remise de commande atomique | `order.deliver` : ticket puis statut en deux étapes sans verrou **(déduit : double remise = double ticket et double sortie)** | `order.controller.ts:489, 509` | P1 |
| G-GI-12 | Types de mouvements valides | `'adjust'` et `'retour_invendus'` refusés par la contrainte → transaction entière annulée (vérifié sur la base locale) | `unsold-decision.repository.ts:694, 798`, `product-loss.repository.ts:146, 167`, `opening-inventory-check.repository.ts:255` | **P0** |
| G-GI-13 | Retours : réintégration et lots inversés | Retour POS : la quantité d'un lot expiré disparaît sans perte enregistrée ; `sale_item_lots` jamais diminué (le rappel compte encore le retour comme vendu) ; retour d'un ticket « delivery » recrée du stock vitrine fantôme ; l'échange n'a pas de `sale_item_lots` | `return.repository.ts:214-294` | P1 |
| G-GI-14 | Robustesse des routes | Routes tournées et rappel sans `asyncHandler` (Express 4 : la requête reste pendante en cas d'erreur SQL) ; `addStops` hors transaction | `delivery-route.routes.ts`, `recall.routes.ts` | P2 |

### 2.5 Étape 5 — Facturation

| ID | Standard O2C | Kalum aujourd'hui | Preuve | Grav. |
|---|---|---|---|:-:|
| G-IV-01 | Facture uniquement sur quantité expédiée | ✅ Respecté pour le parcours BL. ❌ Contourné par la facture manuelle (`POST /invoices` émise, montants libres) et par les abonnements (« pain en dépôt récurrent » facturé sans livraison) | `accounting.repository.ts:718`, mig 382 | P1 |
| G-IV-02 | Lien ligne facture → ligne BL | `invoice_items` n'a ni `delivery_note_item_id` ni `order_item_id` ; la facture n'a pas d'`order_id` ; les lignes divergent du BL dès qu'on remplace les items | `delivery-note.repository.ts:268-316` | P1 |
| G-IV-03 | Facture validée immuable, correction par avoir | **Facture émise modifiable à tout moment** (montant, date, client, lignes) : `assertInvoiceEditable` sort immédiatement si ce n'est pas une facture reçue ; seule limite : total ≥ déjà payé | `accounting.repository.ts:16-21` | **P0** |
| G-IV-04 | Statut dérivé des règlements | **`PUT /invoices/:id/status` permet de passer une facture émise à `paid` ou `cancelled`** sans règlement ni approbation (la garde ne vise que les factures reçues) | `accounting.controller.ts:476-496` | **P0** |
| G-IV-05 | Numérotation imposée | Le numéro peut être fourni dans le corps de la requête et contourner la série | `accounting.repository.ts:718` | **P0** |
| G-IV-06 | Avoir client numéroté, lié à la facture d'origine | Pas d'avoir : l'annulation passe la facture à `cancelled` et extourne l'écriture ; aucune pièce AV, aucun lien | `accounting.controller.ts:256-285` | P1 |
| G-IV-07 | Annulation impossible si réglée | Annulation d'une facture payée non bloquée : le crédit 3421 du règlement reste orphelin | idem | P1 |
| G-IV-08 | Facturation périodique automatique | Clients mensuels : écran manuel « À facturer » uniquement, aucun job planifié | `scheduler.ts:167-176` | P2 |
| G-IV-09 | Date de facture cohérente avec la livraison | `invoiceDate` libre, sans contrôle par rapport aux dates de BL | `delivery-note.repository.ts:268` | P2 |
| G-IV-10 | Code mort retiré | `invoiceRepository.createFromOrder` (quantité commandée, sans contrôle de statut) est mort ; mais la modification d'une commande réécrit encore en silence les lignes d'une facture legacy liée | `accounting.repository.ts:787-847`, `order.controller.ts:355-370` | P2 |
| G-IV-11 | Totaux cohérents | `create` recalcule la TVA depuis les lignes mais garde le `totalAmount` transmis **(déduit : écriture déséquilibrée possible → outbox)** | `accounting.repository.ts` | P2 |

### 2.6 Étape 6 — Encaissement

| ID | Standard O2C | Kalum aujourd'hui | Preuve | Grav. |
|---|---|---|---|:-:|
| G-CA-01 | Un règlement affecté à N factures | `payments.invoice_id` unique : un règlement = une facture. Un client qui paie 3 factures par un seul chèque oblige à fractionner le chèque | `accounting.repository.ts:2184-2245` | P1 |
| G-CA-02 | Encaissement non affecté en 4421 (avance client) | Règlement sans facture crédité sur un compte de produit (repli 7585) : du CA fictif | `journal-generator.service.ts:680` | **P0** |
| G-CA-03 | Ticket à crédit = créance 3421 | Ticket impayé : aucune écriture à la création **ni au règlement** (`markPaid` ne poste rien) ; l'écriture n'apparaît qu'au backfill manuel ou bloque la clôture | `sale.repository.ts:481-525`, mig 415:88-96 | P1 |
| G-CA-04 | Lettrage partiel | L'auto-lettrage n'agit qu'à l'équilibre au centime : les règlements partiels restent non lettrés | `journal-generator.service.ts:984-1025` | P2 |
| G-CA-05 | Une seule vue des créances | Écran Créances (documents) et balance âgée (3421 non lettré) divergent par construction | `receivables.repository.ts:55-100`, `aged-balance.repository.ts:16-18` | P2 |
| G-CA-06 | Mode « avoir » sans flux de trésorerie | Un règlement « avoir » de type income débite 5141 : il ressemble à une entrée en banque | `journal-generator.service.ts:663` | P1 |
| G-CA-07 | Backfill fidèle | Le backfill des tickets omet `cash_amount` / `card_amount` : les tickets mixtes sortent sans ligne de trésorerie | `ledger-backfill.service.ts:~121` | P2 |

### 2.7 Étape 7 — Reconnaissance du revenu et coût des ventes

| ID | Standard O2C | Kalum aujourd'hui | Preuve | Grav. |
|---|---|---|---|:-:|
| G-RR-01 | CA reconnu à la livraison (transfert de propriété) | Avance particulier passée en 7111 le jour de l'encaissement, avant production et livraison ; TVA de toute la commande portée sur le ticket de solde | `order.controller.ts:265-288, 487-506` | P1 |
| G-RR-02 | Cut-off : livré non facturé → FAE (3427) | Le BL ne passe aucune écriture et la clôture ne contrôle pas les BL non facturés : un BL livré le 30 et facturé le 2 bascule de mois | mig 352, mig 415 | P1 |
| G-RR-03 | Coût des ventes figé sur la ligne vendue | Aucune colonne de coût sur `sale_items`, `order_items`, `delivery_note_items`, `invoice_items` ; pas de coût sur `product_lots` | — | P1 |
| G-RR-04 | Marge sur toutes les ventes | Rapport de marges : POS uniquement, au coût **actuel** `v_product_unit_cost` ; B2B exclu | `management.repository.ts:214-300` | P1 |
| G-RR-05 | Variation de stock de produits finis à la clôture (CGNC : 315 / 7132) | La clôture de stock (mig 381) ne valorise que les matières et ne passe rien au grand livre | mig 381 | P1 |
| G-RR-06 | TVA collectée sur toutes les ventes taxables | POS et vente spéciale : `taxAmount = 0` codé en dur ; CA POS en 7111 TTC sans 4455 | `sale.controller.ts:143, 379` | **P0 (à qualifier)** |
| G-RR-07 | Échec de comptabilisation visible | Ticket et écart de clôture : un échec de comptabilisation ne fait qu'un `console.error` | `sale.repository.ts:305-317`, `cash-register.repository.ts:364-375` | P2 |
| G-RR-08 | Facture sans client comptabilisée ou bloquée | `fromInvoice` renvoie null (ni écriture ni outbox) ; la checklist de clôture ne cherche que les factures fournisseurs non comptabilisées | mig 415:50-55 | P1 |
| G-RR-09 | Retours et échanges comptabilisés | Retours et échanges POS : aucune écriture ; l'échange est un INSERT brut qui contourne `fromSale` | `return.repository.ts:153` | P1 |

> **Sur G-RR-06.** Au Maroc, le pain et certaines farines sont exonérés de TVA, mais la pâtisserie et la viennoiserie ne le sont pas nécessairement, et le régime dépend du chiffre d'affaires de l'entreprise. Le « 0 en dur » est peut-être juste pour Ofauria aujourd'hui ; il ne l'est pas pour un ERP. **À valider avec l'expert-comptable**, puis rendre la TVA paramétrable par famille de produits (le socle `tax_codes` existe).

---

## 3. Risques métier et financiers

### 3.1 Traçabilité et risque sanitaire

| Scénario | Cause | Conséquence |
|---|---|---|
| Rappel d'un lot de crème pâtissière contaminée | G-GI-02, G-GI-03 | Les 10 BL pro de la base locale sont invisibles du rappel. L'hôtel ou le café livré ne peut pas être prévenu ; c'est le cœur de l'obligation réglementaire de traçabilité aval (ONSSA, loi 28-07). |
| Client retourné, produit remis en vitrine | G-GI-13 | Le rappel compte toujours la quantité retournée comme vendue au premier client, et rien n'identifie le second acheteur. |
| Lot décongelé dont la DLC effective est dépassée | G-GI-10 | `checkSaleability` le laisse passer ; FEFO l'exclut, la quantité part **sans lot**. Produit hors DLC vendu sans trace. |
| Lot surgelé vendu tel quel | G-GI-10 | Aucun contrôle de l'état thermique à la vente. |

Pour le B2C anonyme, la réglementation n'impose pas d'identifier le consommateur final : la capture de lot au ticket sert surtout à la gestion du stock et au retrait en rayon. **Pour le B2B, la capture est obligatoire.** C'est l'argument principal pour prioriser le lot 1 de la feuille de route.

### 3.2 Stock, coût des ventes et pertes

- **Stock fantôme en réserve.** Chaque unité produite pour une commande reste en `product_store_stock.stock_quantity` après livraison (G-GI-01). L'ATP (stock − réservé) remonte à la livraison, au lieu de rester stable. Le sourcing des commandes suivantes croit disposer de ce stock et **ne lance pas la production** **(déduit : rupture sur la commande suivante)**.
- **Fausses pertes.** À la DLC, `autoExpireDueLots` (`product-lot.repository.ts:856-890`) passe ce stock fantôme en perte. Le taux de perte, l'indicateur le plus suivi en boulangerie, est gonflé à hauteur du volume B2B.
- **Food cost faux dans les deux sens.** Le rapport de marges ignore le CA B2B mais les pertes fantômes, elles, sont comptées. Et comme le coût est lu au moment du rapport, une hausse du beurre en novembre fait baisser la marge affichée d'octobre.
- **Transactions de stock qui échouent** (G-GI-12). Le retour d'invendus en stock et la régularisation de surplus échouent entièrement : l'utilisateur contourne, ou abandonne, et la vitrine dérive.
- **Double remise** (G-GI-11). Deux clics simultanés sur « Remettre » = deux tickets, deux sorties vitrine, CA doublé.

### 3.3 Litiges clients

- **Sur-livraison facturée** (G-GI-06) : le client conteste la quantité, et le BL n'a ni signature ni photo (G-GI-08).
- **Facture modifiée après envoi** (G-IV-03) : le PDF détenu par le client diffère de la facture en base. Le grand livre est extourné puis repassé, mais il n'y a ni avoir ni trace de la version envoyée.
- **Reliquat perdu** (G-GI-05) : une livraison partielle clôt la commande, le reste n'est ni livré ni annulé explicitement.
- **Prix libre** (G-OM-04) : une caissière peut saisir un prix sur une commande pro ; le client compare avec la grille de son contrat.

### 3.4 Risques financiers et fiscaux

| Risque | Cause | Effet |
|---|---|---|
| Encours client sous-estimé | G-CR-01 à 04 | Le plafond est consultatif ; il est modifiable par une caissière ; il n'est pas revu à la livraison. |
| CA fictif | G-CA-02, G-CA-06 | Un acompte non affecté devient du produit (7585). Un règlement « avoir » ressemble à de la trésorerie. |
| Créance « soldée » sans paiement | G-IV-04 | La facture sort des créances et des relances, le 3421 reste ouvert : écart permanent entre l'écran Créances et la balance âgée. |
| Rupture de séquence apparente | G-IV-05 | Un numéro saisi à la main dans la série FE fragilise le caractère probant des factures. |
| CA mal rattaché à l'exercice | G-RR-01, G-RR-02 | Avances en CA avant livraison, BL livrés non facturés hors période. |
| TVA collectée | G-RR-06 | Si une partie des ventes comptoir est taxable, la TVA n'est ni facturée ni déclarée. |

---

## 4. Feuille de route de refactoring

### 4.1 Principes d'adaptation à l'agroalimentaire frais

Le standard O2C est pensé pour des cycles de plusieurs jours. Une boulangerie produit la nuit, livre le matin et vend le jour même. Le refactoring doit renforcer les contrôles **sans ajouter d'écran à l'opérateur** :

1. **Garder le ticket comptoir condensé.** Commande, sortie, facture et encaissement restent une seule transaction. On n'y touche que pour fiabiliser la capture de lot.
2. **Le lot est proposé, jamais saisi.** FEFO calcule l'affectation ; l'opérateur confirme d'un clic ou remplace par scan. La saisie libre de numéro de lot est interdite.
3. **Obligatoire en B2B, toléré en B2C.** Au BL, une ligne produit non couverte par des lots bloque l'expédition. Au ticket, l'écart est toléré mais compté et affiché (indicateur « ventes sans lot »).
4. **Tolérances propres au frais.** Sur-livraison et sous-livraison en pourcentage par client (pesées, casse), et DLC résiduelle minimale par client (« l'hôtel exige J+2 »).
5. **Heure limite de commande.** Une commande pro reçue avant l'heure limite (ex. J-1 18 h) alimente le plan de production du lendemain ; après, elle passe en confirmation manuelle.
6. **Le contrôle de crédit bloque à l'expédition**, là où la marchandise sort vraiment, avec dérogation tracée par la direction. À la commande, il prévient.
7. **Écritures en code applicatif, invariants en base.** Kalum passe ses écritures dans `journal-generator.service.ts` ; on garde ce modèle. La base porte les invariants par des contraintes et des triggers différés (l'équivalent d'une contrainte `DEFERRABLE INITIALLY DEFERRED` vérifiée au `COMMIT` en Oracle).

### 4.2 Lots

| Lot | Contenu | Corrige | Dépend de | Effort |
|---|---|---|---|---|
| **L0 — Correctifs bloquants** | Types de mouvements (`adjust` → `adjustment`, ajout `unsold_return`) ; garde de statut sur factures émises ; refus du numéro de facture fourni par le client ; verrou des factures émises validées ; annulation refusée si réglée ; `order.deliver` en une transaction avec `SELECT … FOR UPDATE` ; champs crédit / type / remise / exonération du client réservés à admin-manager ; `asyncHandler` sur les routes tournées, rappel et clients | G-GI-12, G-IV-03/04/05/07, G-GI-11, G-CR-04, G-GI-14 | — | 2-3 j |
| **L1 — Sortie de stock et lots à l'expédition** | Statuts BL `draft → picked → shipped → delivered` ; à `shipped` : sortie de la **réserve**, affectation FEFO proposée, `delivery_note_item_lots`, mouvements `delivery` ; contrôle DLC résiduelle et état thermique ; remise particulier qui sort de la réserve (là où la commande a été produite) et capture les lots ; rappel étendu aux BL ; capture de lot sur l'échange et inversion de `sale_item_lots` au retour ; `checkSaleability` aligné sur `dlc_effective` | G-GI-01/02/03/04/10/13 | L0 | 6-8 j |
| **L2 — Flux documentaire et livraisons partielles** | Lignes de commande stables (mise à jour au lieu de supprimer/réinsérer) ; `order_item_id` sur les lignes BL ; cumuls `qty_delivered` / `qty_invoiced` / `qty_cancelled` ; plusieurs BL par commande ; reliquat explicite (livrer plus tard ou solder) ; matrice de transitions ; statut `partially_delivered` ; tolérances ; annulation de BL qui rouvre la commande ; propagation de l'annulation au plan ; plan daté sur la date de retrait ; MRP qui nette les plans liés | G-OM-02/06, G-GI-05/06/07/09, G-FF-01/02/03 | L1 | 6-8 j |
| **L3 — Crédit et prix** | Une fonction d'encours unique `fn_customer_exposure` utilisée partout ; contrôle à la confirmation, au lancement de production et **bloquant au BL** ; journal `credit_check_events` avec dérogation ; prix catalogue figé sur la ligne (`list_price`) et dérogation tracée, au-delà d'un seuil via le circuit d'approbations (mig 350) ; `channel_id` sur commandes et devis ; remise bornée par rôle côté serveur ; transactions uniques pour commande + avance + promotion et pour la conversion de devis | G-CR-01/02/03/05/06, G-OM-03/04/05/07 | L2 | 4-5 j |
| **L4 — Facturation sur livré et avoirs** | `invoice_items.delivery_note_item_id` ; garde quantité facturée ≤ quantité livrée ; facture émise de marchandises obligatoirement rattachée à un BL (la facture manuelle reste possible pour les prestations) ; avoir client numéroté AV lié à la facture d'origine ; job de facturation mensuelle ; abonnements de marchandises qui génèrent des **commandes / BL** au lieu de factures ; retrait du code mort (`createFromOrder`, réécriture de facture legacy, vente spéciale B2B remplacée par le BL) | G-IV-01/02/06/08/09/10/11, G-OM-01 | L2 | 5-6 j |
| **L5 — Encaissement** | Table `payment_allocations` (un règlement → N factures / tickets) ; encaissement non affecté en 4421 ; ticket à crédit passé en 3421 à la création et soldé au règlement ; correction du mode « avoir » ; lettrage partiel ; backfill corrigé pour les tickets mixtes | G-CA-01 à 07 | L4 | 4-5 j |
| **L6 — Revenu, coût, clôture** | Avances particulier en 4421, reprises en 7111 à la remise ; contrôle de clôture « BL livrés non facturés » avec écriture FAE 3427 extournée à l'ouverture ; coût unitaire figé sur le lot à la fin de production (`production_cout_reel`), recopié sur chaque ligne vendue ou livrée ; rapport de marges sur toutes les ventes, au coût figé ; valorisation des produits finis à la clôture (315 / 7132) ; TVA POS paramétrable après avis de l'expert-comptable ; retours et échanges comptabilisés ; échec de comptabilisation POS mis en file d'attente au lieu d'un `console.error` | G-RR-01 à 09 | L1, L5 | 6-8 j |

**Pourquoi cet ordre.** L0 corrige ce qui casse ou ment aujourd'hui. L1 vient avant le flux documentaire parce que c'est lui qui ferme le risque sanitaire et le stock fantôme, et il est utile même avec un seul BL par commande. L2 crée les liens ligne à ligne sur lesquels reposent la facturation (L4) et l'affectation des règlements (L5). L6 vient en dernier parce qu'il a besoin des coûts figés sur les lots (L1) et des avances séparées (L5).

**Sur le coût des ventes.** Le plan comptable marocain (CGNC) fonctionne en inventaire intermittent : le coût des ventes n'est pas passé au grand livre à chaque vente, la variation de stock de produits finis (7132) est constatée à la clôture. Il ne faut donc **pas** construire un inventaire permanent comptable à chaque ticket. Il faut en revanche figer le coût sur chaque ligne pour le calcul des marges de gestion, et valoriser les produits finis à la clôture.

---

## 5. Mise à niveau du modèle de données

Esquisses de migrations, numérotées à partir de **428** (dernière sur `main` : 427 ; le numéro 426 est déjà en double). Elles suivent les conventions du dépôt : `IF NOT EXISTS`, commentaire de tête, rollback en en-tête. Les noms de tables, colonnes et contraintes ont été vérifiés sur la base locale ; seule l'exemption de transaction du verrou de facture (5.2) a été exécutée, sur l'instance de test Homebrew 5432. **Le reste du SQL est une esquisse non exécutée : à tester en `pg_temp` + `ROLLBACK` avant tout commit.**

### 5.1 Chaîne documentaire cible

```
quotes ──► orders ──► order_items ──┬──► production_plans (order_id)
              │            │        └──► order_stock_reservations
              │            ▼
              │   delivery_note_items ──► delivery_note_item_lots ──► product_lots
              │            │ (order_item_id)        (sortie réserve, mouvements 'delivery')
              ▼            ▼
       delivery_notes   invoice_items (delivery_note_item_id)
                           │
                        invoices (FE, AV → credited_invoice_id)
                           │
                     payment_allocations ──► payments (4421 si non affecté)
```

Chaque document hérite de la ligne du précédent par une clé étrangère de ligne à ligne, et les cumuls (`qty_delivered`, `qty_invoiced`) sont tenus sur la ligne source.

### 5.2 428 — Correctifs L0

```sql
-- 428 — O2C L0 : types de mouvements, verrou des factures émises
-- Rollback : restaurer les CHECK de 088 et 316 ; DROP TRIGGER trg_guard_emitted_invoice_lock / trg_guard_emitted_invoice_items.

-- 1) Mouvements produits finis. Le code sera aligné sur 'adjustment' (au lieu de 'adjust') ;
--    on ajoute les types O2C utilisés par les lots suivants.
ALTER TABLE product_stock_transactions DROP CONSTRAINT IF EXISTS product_stock_transactions_type_check;
ALTER TABLE product_stock_transactions ADD CONSTRAINT product_stock_transactions_type_check CHECK (type IN (
  'production','sale','return','adjustment','waste','exchange','loss','replenishment_in',
  'unsold_return','delivery','delivery_reversal'));
ALTER TABLE product_stock_transactions ADD COLUMN IF NOT EXISTS reference_type VARCHAR(30);

ALTER TABLE product_lot_movements DROP CONSTRAINT IF EXISTS product_lot_movements_kind_check;
ALTER TABLE product_lot_movements ADD CONSTRAINT product_lot_movements_kind_check CHECK (kind IN (
  'display','sale','waste','recycle','return','delivery','delivery_reversal','adjustment'));

-- 2) Facture émise validée : en-tête figé, annulation interdite si réglée.
--    Les FE naissent déjà 'validated' (vérifié : 10/10 en base locale) et leurs lignes sont
--    insérées juste après l'en-tête : on exempte donc la transaction qui a créé la ligne
--    (xmin = transaction courante). Testé sur PG 15 : modifiable dans la transaction de création,
--    refusé dans toute transaction ultérieure.
CREATE OR REPLACE FUNCTION fn_invoice_created_in_current_tx(p_xmin xid) RETURNS boolean AS $$
  SELECT p_xmin::text = (pg_current_xact_id()::text::bigint % 4294967296)::text
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_guard_emitted_invoice_lock() RETURNS trigger AS $$
BEGIN
  IF OLD.invoice_type = 'emitted' AND OLD.validation_status = 'validated'
     AND NOT fn_invoice_created_in_current_tx(OLD.xmin) THEN
    IF (NEW.amount, NEW.tax_amount, NEW.total_amount, NEW.invoice_date, NEW.customer_id)
       IS DISTINCT FROM (OLD.amount, OLD.tax_amount, OLD.total_amount, OLD.invoice_date, OLD.customer_id) THEN
      RAISE EXCEPTION 'Facture % validée : correction par avoir uniquement', OLD.invoice_number
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' AND COALESCE(OLD.paid_amount, 0) > 0.005 THEN
      RAISE EXCEPTION 'Facture % réglée : annulation impossible, émettre un avoir', OLD.invoice_number
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_emitted_invoice_lock ON invoices;
CREATE TRIGGER trg_guard_emitted_invoice_lock BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION fn_guard_emitted_invoice_lock();

CREATE OR REPLACE FUNCTION fn_guard_emitted_invoice_items() RETURNS trigger AS $$
DECLARE v_id uuid := COALESCE(NEW.invoice_id, OLD.invoice_id);
BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE id = v_id
              AND invoice_type = 'emitted' AND validation_status = 'validated'
              AND NOT fn_invoice_created_in_current_tx(xmin)) THEN
    RAISE EXCEPTION 'Lignes d''une facture émise validée : non modifiables' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_emitted_invoice_items ON invoice_items;
CREATE TRIGGER trg_guard_emitted_invoice_items BEFORE INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION fn_guard_emitted_invoice_items();
```

Ce verrou casse volontairement deux chemins actuels, à remplacer par l'avoir (L4) : `PUT /invoices/:id` et `PUT /invoices/:id/items` sur une facture émise, et la réécriture de facture legacy depuis la modification d'une commande (`order.controller.ts:355-370`). Côté code dans le même lot : retirer `data.invoiceNumber` pour les factures émises, ajouter la garde de statut manuel pour `emitted`, corriger les 4 fichiers qui écrivent `'adjust'` / `'retour_invendus'`.

### 5.3 429 — Commande : canal, états, cumuls, crédit

```sql
-- 429 — O2C L2/L3 : machine à états des commandes, cumuls par ligne, journal de crédit
-- Rollback : DROP TABLE credit_check_events, order_status_transitions ; DROP des colonnes ajoutées ; restaurer orders_status_check.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES sales_channels(id);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES sales_channels(id);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (
  'pending','confirmed','in_production','ready','partially_delivered','completed','cancelled'));

CREATE TABLE IF NOT EXISTS order_status_transitions (
  from_status VARCHAR(30) NOT NULL,
  to_status   VARCHAR(30) NOT NULL,
  PRIMARY KEY (from_status, to_status)
);
INSERT INTO order_status_transitions VALUES
  ('pending','confirmed'), ('pending','cancelled'),
  ('confirmed','in_production'), ('confirmed','ready'), ('confirmed','cancelled'),
  ('in_production','ready'), ('in_production','cancelled'),
  ('ready','partially_delivered'), ('ready','completed'), ('ready','cancelled'),
  ('partially_delivered','completed')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION fn_order_status_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT EXISTS (
       SELECT 1 FROM order_status_transitions WHERE from_status = OLD.status AND to_status = NEW.status) THEN
    RAISE EXCEPTION 'Transition de commande interdite : % → %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_order_status_guard ON orders;
CREATE TRIGGER trg_order_status_guard BEFORE UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION fn_order_status_guard();

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS list_price            NUMERIC(12,2),          -- prix grille figé à la saisie
  ADD COLUMN IF NOT EXISTS price_override_by     UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS price_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS qty_delivered NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (qty_delivered >= 0),
  ADD COLUMN IF NOT EXISTS qty_invoiced  NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (qty_invoiced  >= 0),
  ADD COLUMN IF NOT EXISTS qty_cancelled NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (qty_cancelled >= 0);
ALTER TABLE order_items ADD CONSTRAINT chk_order_items_invoiced_le_delivered CHECK (qty_invoiced <= qty_delivered);
ALTER TABLE order_items ADD CONSTRAINT chk_order_items_override_reason
  CHECK (price_override_by IS NULL OR price_override_reason IS NOT NULL);

-- Paramètres propres au frais, par client
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS over_delivery_tolerance_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_shelf_life_days         INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS order_cutoff_time           TIME;

-- Journal des contrôles de crédit (décision et dérogation)
CREATE TABLE IF NOT EXISTS credit_check_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES customers(id),
  document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('order','quote','delivery_note','sale','production')),
  document_id   UUID NOT NULL,
  checkpoint    VARCHAR(20) NOT NULL CHECK (checkpoint IN ('create','confirm','production','ship','invoice')),
  exposure      NUMERIC(12,2) NOT NULL,
  credit_limit  NUMERIC(12,2),
  on_hold       BOOLEAN NOT NULL DEFAULT false,
  decision      VARCHAR(10) NOT NULL CHECK (decision IN ('pass','warn','block','override')),
  overridden_by UUID REFERENCES users(id),
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (decision <> 'override' OR (overridden_by IS NOT NULL AND reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_credit_check_events_customer ON credit_check_events (customer_id, created_at DESC);
```

L'encours unique `fn_customer_exposure(customer_id)` (tickets impayés + factures ouvertes + BL livrés non facturés + commandes ouvertes non livrées) remplace les deux calculs actuels ; il se pose en fonction SQL `STABLE` pour être appelé par le POS, les commandes et le BL.

### 5.4 430 — Expédition : livraisons partielles, lots, preuve de livraison

```sql
-- 430 — O2C L1/L2 : BL expédié, lignes liées à la commande, lots expédiés
-- Rollback : DROP TABLE delivery_note_item_lots ; DROP des colonnes ; recréer uq_delivery_notes_order ; restaurer le CHECK de statut.

DROP INDEX IF EXISTS uq_delivery_notes_order;           -- plusieurs BL par commande

ALTER TABLE delivery_notes DROP CONSTRAINT IF EXISTS delivery_notes_status_check;
ALTER TABLE delivery_notes ADD CONSTRAINT delivery_notes_status_check CHECK (status IN (
  'draft','picked','shipped','delivered','invoiced','cancelled'));
ALTER TABLE delivery_notes ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE delivery_notes
  ADD COLUMN IF NOT EXISTS shipped_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shipped_by    UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS delivered_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pod_signature TEXT,           -- signature (data URI, cf. contrainte Cloud Run)
  ADD COLUMN IF NOT EXISTS pod_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS route_stop_id UUID REFERENCES delivery_route_stops(id);
ALTER TABLE delivery_notes ADD CONSTRAINT chk_dn_shipped_dates
  CHECK (status IN ('draft','picked','cancelled') OR shipped_at IS NOT NULL);

ALTER TABLE delivery_note_items
  ADD COLUMN IF NOT EXISTS order_item_id UUID REFERENCES order_items(id),
  ADD COLUMN IF NOT EXISTS qty_ordered   NUMERIC(12,3),     -- instantané de la ligne de commande
  ADD COLUMN IF NOT EXISTS unit_cost     NUMERIC(12,4),     -- coût figé à l'expédition (L6)
  ADD COLUMN IF NOT EXISTS qty_invoiced  NUMERIC(12,3) NOT NULL DEFAULT 0;
ALTER TABLE delivery_note_items ADD CONSTRAINT chk_dni_invoiced_le_qty CHECK (qty_invoiced <= quantity);
CREATE INDEX IF NOT EXISTS idx_dni_order_item ON delivery_note_items (order_item_id);

CREATE TABLE IF NOT EXISTS delivery_note_item_lots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_note_item_id UUID NOT NULL REFERENCES delivery_note_items(id) ON DELETE CASCADE,
  product_lot_id        UUID NOT NULL REFERENCES product_lots(id) ON DELETE RESTRICT,
  quantity              NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  dlc_snapshot          DATE,                              -- DLC effective au moment de l'expédition
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (delivery_note_item_id, product_lot_id)
);
CREATE INDEX IF NOT EXISTS idx_dnil_lot ON delivery_note_item_lots (product_lot_id);

-- Invariant vérifié au COMMIT : un BL expédié couvre chaque ligne produit à 100 % par des lots.
CREATE OR REPLACE FUNCTION fn_dn_assert_lots() RETURNS trigger AS $$
DECLARE v_bad RECORD;
BEGIN
  IF NEW.status IN ('shipped','delivered','invoiced') THEN
    SELECT dni.id, dni.quantity, COALESCE(SUM(l.quantity), 0) AS covered INTO v_bad
      FROM delivery_note_items dni
      LEFT JOIN delivery_note_item_lots l ON l.delivery_note_item_id = dni.id
     WHERE dni.delivery_note_id = NEW.id AND dni.product_id IS NOT NULL
     GROUP BY dni.id, dni.quantity
    HAVING ABS(COALESCE(SUM(l.quantity), 0) - dni.quantity) > 0.0005
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'BL % : ligne % non couverte par des lots (% / %)', NEW.number, v_bad.id, v_bad.covered, v_bad.quantity
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_dn_assert_lots ON delivery_notes;
CREATE CONSTRAINT TRIGGER trg_dn_assert_lots AFTER INSERT OR UPDATE OF status ON delivery_notes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_dn_assert_lots();

-- Retours : inverser la traçabilité au lieu de la laisser compter comme vendue
ALTER TABLE sale_item_lots ADD COLUMN IF NOT EXISTS returned_qty NUMERIC(12,3) NOT NULL DEFAULT 0
  CHECK (returned_qty >= 0 AND returned_qty <= quantity);
```

La sortie de stock elle-même (décrément de `product_lots.backroom_qty` et `product_store_stock.stock_quantity`, mouvements `delivery`, cumul `order_items.qty_delivered`, consommation de la réservation) se fait dans le repository, dans la transaction qui passe le BL à `shipped`, sur le modèle de `sale.repository.ts`. Le trigger différé ci-dessus garantit qu'aucun chemin ne peut expédier sans lots. Les BL existants (10 en base locale, statut `delivered` ou `invoiced`) sont antérieurs : il faut soit les exclure du trigger par une date de bascule, soit les reprendre en `invoiced` sans contrôle via un drapeau `legacy`.

### 5.5 431 — Facturation sur livré et avoirs

```sql
-- 431 — O2C L4 : ligne de facture rattachée à la ligne de BL, avoirs clients
-- Rollback : DROP des colonnes et triggers ajoutés.

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS delivery_note_item_id UUID REFERENCES delivery_note_items(id),
  ADD COLUMN IF NOT EXISTS order_item_id         UUID REFERENCES order_items(id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_dni ON invoice_items (delivery_note_item_id);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS credited_invoice_id UUID REFERENCES invoices(id);
ALTER TABLE invoices ADD CONSTRAINT chk_emitted_credit_note_origin
  CHECK (invoice_type <> 'emitted' OR kind <> 'credit_note' OR credited_invoice_id IS NOT NULL);

-- Quantité facturée nette (factures − avoirs) ≤ quantité livrée, par ligne de BL. Vérifié au COMMIT.
CREATE OR REPLACE FUNCTION fn_invoice_qty_le_delivered() RETURNS trigger AS $$
DECLARE v_dni uuid := COALESCE(NEW.delivery_note_item_id, OLD.delivery_note_item_id);
        v_net numeric; v_delivered numeric;
BEGIN
  IF v_dni IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(CASE WHEN i.kind = 'credit_note' THEN -ii.quantity ELSE ii.quantity END), 0)
    INTO v_net
    FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
   WHERE ii.delivery_note_item_id = v_dni AND i.invoice_type = 'emitted' AND i.status <> 'cancelled';
  SELECT quantity INTO v_delivered FROM delivery_note_items WHERE id = v_dni;
  IF v_net > v_delivered + 0.0005 THEN
    RAISE EXCEPTION 'Ligne de BL % : facturé % > livré %', v_dni, v_net, v_delivered USING ERRCODE = 'check_violation';
  END IF;
  UPDATE delivery_note_items SET qty_invoiced = v_net WHERE id = v_dni;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_invoice_qty_le_delivered ON invoice_items;
CREATE CONSTRAINT TRIGGER trg_invoice_qty_le_delivered AFTER INSERT OR UPDATE OR DELETE ON invoice_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_invoice_qty_le_delivered();
```

Dans le même lot : nouvelle série `credit_note_emitted` au format `AV-{YYYY}-{SEQ}` dans le référentiel de séquences (mig 329) ; règle applicative « une ligne de facture émise portant un `product_id` exige un `delivery_note_item_id` », sauf `source = 'legacy_auto'` ; `order_items.qty_invoiced` recalculé depuis les lignes de BL.

### 5.6 432 — Encaissement : affectations et avances

```sql
-- 432 — O2C L5 : un règlement affecté à plusieurs factures ou tickets ; avances clients
-- Rollback : DROP TABLE payment_allocations ; DROP COLUMN payments.customer_id.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id   UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id   UUID REFERENCES invoices(id),
  sale_id      UUID REFERENCES sales(id),
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  allocated_by UUID REFERENCES users(id),
  CHECK (num_nonnulls(invoice_id, sale_id) = 1)
);
CREATE INDEX IF NOT EXISTS idx_payment_alloc_invoice ON payment_allocations (invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_alloc_sale    ON payment_allocations (sale_id);

-- Reprise de l'existant : un règlement = une affectation
INSERT INTO payment_allocations (payment_id, invoice_id, amount, allocated_at, allocated_by)
SELECT p.id, p.invoice_id, p.amount, p.created_at, p.created_by
  FROM payments p JOIN invoices i ON i.id = p.invoice_id
 WHERE p.type = 'income' AND i.invoice_type = 'emitted' AND p.voided_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.payment_id = p.id);

-- Somme affectée ≤ montant du règlement (vérifié au COMMIT)
CREATE OR REPLACE FUNCTION fn_payment_alloc_le_amount() RETURNS trigger AS $$
DECLARE v_pid uuid := COALESCE(NEW.payment_id, OLD.payment_id);
BEGIN
  IF (SELECT COALESCE(SUM(amount), 0) FROM payment_allocations WHERE payment_id = v_pid)
     > (SELECT amount FROM payments WHERE id = v_pid) + 0.005 THEN
    RAISE EXCEPTION 'Règlement % : affectations supérieures au montant', v_pid USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_payment_alloc_le_amount ON payment_allocations;
CREATE CONSTRAINT TRIGGER trg_payment_alloc_le_amount AFTER INSERT OR UPDATE ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_payment_alloc_le_amount();

-- Avance client = règlement non affecté (passé en 4421 par le générateur d'écritures)
CREATE OR REPLACE VIEW v_customer_unapplied_cash AS
SELECT p.customer_id, p.id AS payment_id, p.payment_date,
       p.amount - COALESCE(SUM(a.amount), 0) AS unapplied
  FROM payments p LEFT JOIN payment_allocations a ON a.payment_id = p.id
 WHERE p.type = 'income' AND p.customer_id IS NOT NULL AND p.voided_at IS NULL
 GROUP BY p.id
HAVING p.amount - COALESCE(SUM(a.amount), 0) > 0.005;
```

`payments.invoice_id` reste en lecture le temps de la bascule, puis `updatePaidAmount` lit les affectations.

### 5.7 433 — Coût, cut-off et vues de flux

```sql
-- 433 — O2C L6 : coût figé, cut-off FAE, flux documentaire, traçabilité aval unifiée
-- Rollback : DROP VIEW v_o2c_document_flow, v_lot_downstream, v_o2c_cutoff_fae ; DROP COLUMN unit_cost.

ALTER TABLE product_lots ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,4);  -- figé à la fin de production
ALTER TABLE sale_items   ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,4);  -- moyenne pondérée des lots FEFO consommés

-- BL expédiés ou livrés, non facturés, à la date de clôture → FAE 3427 (contrôle de clôture mig 415)
CREATE OR REPLACE VIEW v_o2c_cutoff_fae AS
SELECT dn.id AS delivery_note_id, dn.number, dn.customer_id, dn.delivery_date,
       SUM((dni.quantity - dni.qty_invoiced) * dni.unit_price) AS amount_ht_to_invoice
  FROM delivery_notes dn JOIN delivery_note_items dni ON dni.delivery_note_id = dn.id
 WHERE dn.status IN ('shipped','delivered')
 GROUP BY dn.id
HAVING SUM((dni.quantity - dni.qty_invoiced) * dni.unit_price) > 0.005;

-- Flux documentaire ligne à ligne (équivalent du « Document Flow » SAP)
CREATE OR REPLACE VIEW v_o2c_document_flow AS
SELECT o.id AS order_id, o.order_number, oi.id AS order_item_id, oi.product_id,
       oi.quantity AS qty_ordered, oi.qty_delivered, oi.qty_invoiced,
       dn.id AS delivery_note_id, dn.number AS delivery_note_number, dn.status AS dn_status,
       dni.id AS delivery_note_item_id, dni.quantity AS qty_shipped,
       i.id AS invoice_id, i.invoice_number, i.status AS invoice_status, ii.quantity AS qty_on_invoice
  FROM orders o
  JOIN order_items oi              ON oi.order_id = o.id
  LEFT JOIN delivery_note_items dni ON dni.order_item_id = oi.id
  LEFT JOIN delivery_notes dn       ON dn.id = dni.delivery_note_id AND dn.status <> 'cancelled'
  LEFT JOIN invoice_items ii        ON ii.delivery_note_item_id = dni.id
  LEFT JOIN invoices i              ON i.id = ii.invoice_id AND i.status <> 'cancelled';

-- Traçabilité aval unifiée : un lot → tous ses destinataires (B2C ticket, B2B BL)
CREATE OR REPLACE VIEW v_lot_downstream AS
SELECT sil.product_lot_id, 'sale'::text AS channel, s.id AS document_id, s.sale_number AS document_number,
       s.customer_id, sil.quantity - sil.returned_qty AS quantity, s.created_at AS shipped_at
  FROM sale_item_lots sil
  JOIN sale_items si ON si.id = sil.sale_item_id
  JOIN sales s       ON s.id = si.sale_id
UNION ALL
SELECT l.product_lot_id, 'delivery_note', dn.id, dn.number, dn.customer_id, l.quantity, dn.shipped_at
  FROM delivery_note_item_lots l
  JOIN delivery_note_items dni ON dni.id = l.delivery_note_item_id
  JOIN delivery_notes dn       ON dn.id = dni.delivery_note_id
 WHERE dn.status <> 'cancelled';
```

Le rappel (`/traceability/recall`) lit ensuite `v_lot_downstream`, ce qui permet aussi de fusionner les deux systèmes de rappel existants (mig 316 et 337) en un seul.

### 5.8 Récapitulatif des statuts cibles

| Document | Statuts | Transition clé et effet |
|---|---|---|
| Devis | draft → sent → accepted → converted ; refused, expired, cancelled | `accepted` exigé avant `converted` |
| Commande | pending → confirmed → in_production → ready → partially_delivered → completed ; cancelled | `confirmed` : contrôle de crédit, plan daté sur le retrait ; `cancelled` : plan annulé, réservation relâchée |
| Ligne de commande | cumuls `qty_delivered`, `qty_invoiced`, `qty_cancelled` | `qty_invoiced ≤ qty_delivered ≤ quantity × (1 + tolérance)` |
| BL | draft → picked → shipped → delivered → invoiced ; cancelled | `shipped` : sortie réserve + lots obligatoires + crédit bloquant ; `delivered` : preuve de livraison ; annulation après `shipped` : mouvement `delivery_reversal` |
| Facture émise | brouillon → validée (immuable) → pending / partial / paid ; cancelled seulement si non réglée | correction = avoir AV lié |
| Règlement | non affecté (4421) → affecté (3421 lettré) | `payment_allocations` |

---

## 6. Hors périmètre et points à valider

- **Régime de TVA** des ventes comptoir (G-RR-06) et des avances (régime des encaissements ou des débits) : avis de l'expert-comptable requis avant L6.
- **Reprise des données** : BL existants sans lots, factures émises déjà modifiées, règlements d'avant le correctif 3421 du 2026-10-26 qui pourraient porter encore un crédit 7111 **(déduit)**.
- **Vente spéciale B2B** : à confirmer avec le métier qu'elle peut être retirée au profit du BL.
- **Abonnements** (mig 382) : séparer les abonnements de prestations (facture directe, correct) des dépôts récurrents de marchandises (doivent générer des BL).
- **Promotions** : le contrôle `max_uses` puis l'incrément ne sont pas atomiques (`promotions.ts:49, 211`) **(déduit : course possible)** ; hors O2C strict, à traiter avec L3.

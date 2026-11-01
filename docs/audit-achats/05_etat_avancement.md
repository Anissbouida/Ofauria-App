# Module Achats — état d'avancement vs le benchmark

> **Date :** 2026-10-30 · Vérification du code/base actuels contre les écarts D1-D10 de [02_benchmark_erp.md](02_benchmark_erp.md) et les fiches `ecarts/D1..D10.md`.
> **Portée :** confirmer ce qui a été **livré depuis l'audit** (migrations 304→392) et ce qui **reste**. Comparaison alignée sur le benchmark P2P (SAP/Oracle/D365/Odoo/NetSuite) et, où pertinent, sur ERPNext Buying.

---

## 1. Ce qui a été LIVRÉ depuis l'audit (vérifié en base)

La **refonte architecturale** recommandée par l'audit — la partie la plus difficile — est en grande partie en place :

| Capacité (audit) | Preuve en base | Migration |
|---|---|---|
| **Historique de ligne append-only** (pattern P1, C-D4-04/D5/D8) | table `po_line_events` ✅ | — |
| **Versions / avenants de BC** (C-D4-07, P0) | table `purchase_order_versions` ✅ | — |
| **Holds de facture par ligne** (C-D6-06, P0) | table `invoice_holds` ✅ | 311 |
| **Détermination automatique des comptes** (C-D8-05, P0) | table `posting_profiles` ✅ | — |
| **Appels d'offres / sourcing** (D3) | table `rfqs` ✅, `rfq.routes`, `RfqTab` | 360 |
| **Approbation par seuils** (C-D3-01) | `approbations` (BC > 5 000 DH → admin) | 350 |
| **Imputation par ligne** (catégorie) | `purchase_order_items.category_id` ✅, `invoice_items.category_id` ✅ | — |
| **Lignes service / immobilisation** (C-D4-01 partiel) | `purchase_order_items.line_type` ✅ | 349 |
| **Identité légale + audit fournisseur** (C-D4-08 partiel) | `304_fournisseurs_identite_legale_audit` | 304 |
| **Couverture des demandes d'achat** (D2/D4-22) | `305_demandes_achat_couverture` | 305 |
| **Motifs obligatoires + verrous du cycle** (C-D3-08/D4-19) | `306_achats_actions_motifs_verrou` | 306 |
| **DLC active + contre-pièce à la réception** (D5) | `308_reception_contrepiece_lots_dlc` | 308 |
| **GR/IR + TVA par ligne** (C-D8-02) | `311_compta_achats_integrite_grir_tva` | 311 |
| **Rapprochement + registre de pilotage** (D6/D9) | `312_pilotage_achats_rapprochement_registre`, `PurchasingPilotageTab` | 312 |
| **Frais d'approche / landed cost** (C-D4-14/D8-07) | `landed-cost.routes`, `LandedCostTab`, poids/ligne | 361, 392 |
| **Évaluation fournisseurs / scorecard** (C-D9-06) | `supplier-score.routes`, `SupplierScoreTab` | 362 |
| **Multi-devises** (C-D4-15) | `363_devises`, `368_devises_factures_reglements` | 363, 368 |

➡️ **Verdict :** le socle « pro » du procure-to-pay (historique par ligne, versions, holds, comptes auto, sourcing, approbations, landed cost, scorecard, devises) est **en place**. C'est l'essentiel des P0 structurants de l'audit.

---

## 2. Ce qui RESTE (vérifié absent en base)

Classé par impact. Les plus importants d'abord.

| # | Manque | Capacité | Impact | Prio |
|---|---|---|---|---|
| 1 | **Tarifs datés par article × fournisseur** (`supplier_item_prices`) | C-D1 / C-D9-05 | **Le problème n°1 de l'audit** : `ingredients.unit_cost` = dernier prix saisi, écrasé sans qualification (fournisseur/unité/conditionnement) → 22 articles varient > 100 %, stock survalorisé +32 %. Pilote le coût de toutes les recettes. | **P0** |
| 2 | **Double unité figée sur la ligne BC** (`qty_base`, contenant snapshot, TVA/remise par ligne) | C-D4-03 | Prix du sac vs prix du kg indistinguables ; TVA absente du BC → factures auto à 0. (La catégorie par ligne est faite, pas le reste.) | **P0** |
| 3 | **Compteur « facturé » par ligne** (`quantity_invoiced`) + **rapprochement 3-voies par ligne** | C-D4-04 / C-D6-04 | Reste-à-facturer non calculable par ligne ; rapprochement encore global. (Les holds existent, pas le match par ligne.) | **P0** |
| 4 | **Écart de prix facture → correction PMP** (`stock_valuation_adjustments`) | C-D8-04 | L'écart prix BC/facture n'ajuste pas le coût du lot/PMP ; noyé en charge. | **P1** |
| 5 | **Échéancier de livraison par ligne** (`po_schedules`) + dates métier saisissables | C-D4-02 / C-D4-20 | Pas de date de livraison par ligne, pas de rétro-datation → délais non mesurés. | **P1** |
| 6 | **Lettrage N:N des paiements** (`payment_applications`) | C-D7-02 | Un paiement multi-factures / avoirs / acomptes, compensation, écart de règlement. | **P1** |
| 7 | **Journal d'envoi + PDF conforme** (`document_sends`, totaux/TVA/identité légale sur le PDF) | C-D4-08 | Pas de preuve d'envoi ni de prix engagé sur le document. (L'identité légale en base est faite ; le PDF reste à mettre à niveau.) | **P1** |
| 8 | **Avoirs attendus** (`expected_credit_notes`) | C-D5 / C-D9 | Litiges/retours sans suivi des avoirs réclamés vs obtenus. | **P2** |
| 9 | **Défauts fournisseur en cascade** (`payment_term_id`, `credit_limit`, `supplier_type`, devise par défaut) | C-D1-02 | Pas d'héritage des conditions commerciales ; pas de distinction fournisseur marché/comptoir. | **P2** |
| 10 | **Types de BC explicites** (`type_code` : stock/charge/cadre/retour/bon interne) + **bon d'achat interne** (marché/espèces) | C-D4-01 / C-D4-17 | Achats comptoir forcés dans un cycle de commande ; cumul espèces non surveillé. (`line_type` service/asset existe, pas le type d'en-tête.) | **P1-P2** |
| 11 | **Catch weight / poids réel à la réception** | C-D4-18 / C-D5-07 | Fruits/viandes au poids variable. (Le poids/ligne 392 et la balance pesage existent ; pas le flux réception.) | **P2** |

### Vs ERPNext Buying spécifiquement
- **Déjà couvert** : RFQ (360), supplier scorecard (362), approbations, multi-devises, landed cost, comptes auto.
- **Manque côté ERPNext aussi** : **commande-cadre (blanket order)** — absente ; **tarif fournisseur daté** (≈ `Item Price`/`item_supplier`) — absent (c'est le point 1 ci-dessus) ; **échéancier de livraison par ligne** (`Purchase Order Item.schedule_date`) — absent (point 5) ; **rapprochement 3-voies par ligne** à la facture — partiel (point 3).

---

## 3. Synthèse

- **Le gros de la refonte Achats de l'audit est fait** : l'architecture « historique par ligne + versions + holds + comptes auto » et les grands modules (sourcing, approbations, landed cost, scorecard, devises) sont livrés.
- **Le cœur restant = la maîtrise du prix** : tarifs datés par article×fournisseur (#1), double unité figée sur la ligne (#2), compteur facturé + match 3-voies par ligne (#3), et l'IPV→PMP (#4). Ce sont les P0 qui restent et qui pèsent le plus (coût des recettes + valorisation du stock).
- Le reste (échéancier ligne, lettrage N:N, journal d'envoi, avoirs attendus, défauts fournisseur, types de BC, catch weight) est du P1-P2.

### Réserve
Vérification par présence de tables/colonnes + inventaire des migrations, pas par lecture ligne à ligne des services. L'écart n°1 est **confirmé** : aucune table de tarif fournisseur daté (ni `ingredient_supplier_ref`, ni `supplier_items`) — le seul prix par fournisseur est `supplier_quotation_items.unit_price` (prix d'appel d'offres, non entretenu comme liste de prix). Les fiches `ecarts/D1..D10.md` restent la référence détaillée par capacité.

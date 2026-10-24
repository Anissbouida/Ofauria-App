# Module Achats — données réelles (audit SQL, lecture seule)

Base : `ofauria_db` locale (port 5433, `default_transaction_read_only=on`), 298 migrations appliquées (dernière `303_foret_noire_10065_fiche_technique.sql`). Date de l'audit : 2026-10-11.
Volumes : purchase_orders 304 · purchase_order_items 810 · reception_vouchers 307 · reception_voucher_items 789 · invoices 326 (317 reçues + 9 émises) · invoice_items 870 (816 sur factures reçues) · payments 689 (287 de type `invoice`) · suppliers 40 · purchase_requests 31 · ingredient_lots 669 · replenishment_requests 0 · scheduled_payments 0 · reception_quality_checks 0.

Fichiers de travail (SQL + sorties brutes) : `scratchpad/achats/s1_chaine.sql … s14_extra.sql`, `s*_out.txt`, `da_funnel.sql`, `schema_d.txt` (sortie `\d+` des 15 tables).

---

## 0. Résumé — les 10 faits les plus parlants

| # | Fait | Chiffre | Lecture |
|---|------|---------|---------|
| F1 | **La chaîne BC → BR → facture → paiement est saisie en une seule fois, a posteriori.** | 255/298 BR créés < 5 min après le BC (médiane 0,01 h) ; 284/292 factures créées < 5 min après le BR ; 226/280 factures payées le jour même ; 266/298 BC livrés le jour de la commande. | Le « bon de commande » n'est pas un ordre envoyé au fournisseur mais la pièce de régularisation d'un achat déjà fait (souvent au comptant). Le workflow en 4 étapes n'existe que dans le schéma. |
| F2 | **Le module s'est arrêté fin juillet.** | BC/mois : juin 103, juillet 185, août 11, septembre 0, octobre 5 (les 5 d'octobre sont générés par des DA de production). Dernier paiement fournisseur enregistré : 2026-08-01. | Deux mois d'usage intensif puis abandon ; les achats d'août-octobre ne sont plus tracés (ou le sont ailleurs : `payments.type='expense'` = 311 lignes / 252 k MAD). |
| F3 | **89 547 MAD d'encours fournisseurs sans aucune échéance.** | 37 factures non soldées (36 `pending` à 0 payé + 1 `partial`), 28 % du TTC total ; 0/37 avec `due_date` ; âge médian 80 j, 11 factures > 90 j ; Ecomab 35,6 k, OVOTEC 20,0 k, MAGHREBLAC 17,1 k. | Le statut `overdue` et l'échéancier (`scheduled_payments` = 0 ligne) sont inopérants : rien ne peut alerter sur un retard puisque la date d'échéance n'est jamais saisie (283/317 factures sans `due_date`). |
| F4 | **80 % des factures reçues sont auto-générées, numérotées en interne.** | 253/317 notes « Facture auto-generee depuis BC… », 250 numéros `FR-2026-xxxx` ; seules 67 portent le numéro du fournisseur ; 46/307 BR ont `supplier_invoice_number`. | La « facture » est un doublon du BR, pas la pièce du fournisseur : inutilisable telle quelle pour la TVA et le contrôle fiscal. |
| F5 | **La TVA est quasi absente.** | 268/317 factures reçues à TVA 0 ; 768/816 lignes sans `tva_rate` ; 4 fournisseurs seulement facturent de la TVA (Ecomab, OVOTEC, SOFADEX, SMCP-E) ; MAGHREBLAC (ICE renseigné, 74 900 MAD) et RICA MAROC (34 881 MAD) sont à 0 TVA ; 22 factures ont une TVA d'en-tête mais aucune ligne avec taux. | ~20 k MAD de TVA récupérable seulement, probablement très sous-estimée ; la TVA par ligne (mig. 189) n'est pas alimentée. |
| F6 | **Traçabilité des lots : les lots existent mais sont vides.** | 634/634 lignes BR ingrédient ont un lot, mais 581 (92 %) sans DLC, 586 sans n° lot fournisseur, 634/669 sans `lot_number` interne ; 99,3 % de la quantité restante active est sans DLC ; `reception_quality_checks` = 0 ligne. | Les champs ONSSA sont dans le schéma (mig. 056, 300) mais jamais saisis à la réception ; aucun rappel produit n'est possible. |
| F7 | **24 % du montant facturé n'a aucune ligne.** | 23 factures sans `invoice_items` = 76 129 MAD TTC (import mars→juin 2026, dont FR-2026-0080 et FC260706 à 11 800 MAD chacune, MAGHREBLAC). | Dépense par article/catégorie fausse d'un quart ; ces factures ne sont rattachées à aucun BC ni réception. |
| F8 | **Le fournisseur est souvent une étiquette générique.** | « Épicerie » 87 BC + « Marché aux puces » 72 BC = 52 % des BC ; 13/40 fournisseurs ont un ICE ; 12/40 n'ont jamais eu d'achat ; `ingredients.supplier_id` rempli sur 0/405 fiches (137 en texte libre) ; `packaging_items.supplier` vide sur 109/109. | Pas de référentiel article↔fournisseur : impossible de comparer les offres ou de proposer un fournisseur à la DA. Concentration réelle : 4 fournisseurs = 69,8 % du TTC. |
| F9 | **Les prix d'achat sont incohérents d'une ligne à l'autre (unités).** | Sur 82 articles achetés ≥ 3 fois, 22 varient de > 100 % (Languette longue 0,16 → 16 ; Eau de fleur d'oranger 4 → 235 ; Crème fraîche 18,7 → 190 /l) ; 54 articles multi-fournisseurs ont un écart min/max > 20 % ; `ingredients.unit_cost` Mangue = 40 vs PMP BC 0,04. | Les lignes BC n'ont pas d'unité d'achat : le même article est saisi tantôt au kg, tantôt au carton. Le coût matière des recettes hérite de ce bruit. |
| F10 | **Les DA servent de « bon d'achat au gramme » pour la production.** | 31 DA, 100 % `received`, 29 motif `production` ; délai DA→BC = 0 j dans 31/31 cas ; 13 lignes BC < 1 kg (0,0035 kg de poudre commandée, 5 kg livrés = +142 757 %) ; 0/377 seuils `inventory.minimum_threshold`, 0/102 seuils emballage, `replenishment_requests` = 0. | La DA n'est pas un réapprovisionnement sur seuil mais le besoin net d'un plan, reporté tel quel dans le BC. Aucune alerte stock n'existe. |

Autres faits transverses : 1 seul magasin ; 1 seul opérateur (sajri@ 289/304 BC, 272/317 factures, 256/287 paiements) ; 248/287 paiements en espèces (76 k MAD), aucun > 5 000 MAD ; 25 factures reçues (20 k MAD) et 23 paiements sans écriture comptable ; 994 écritures `backfill` vs 14 `invoice` + 46 `payment` natives.

---

## 1. Chaîne BC → BR → facture → paiement

### 1.1 BC sans BR
```sql
SELECT po.status, count(*) nb, round(coalesce(sum(t.montant),0),2) montant_ht
FROM purchase_orders po
LEFT JOIN LATERAL (SELECT sum(quantity_ordered*coalesce(unit_price,0)) montant FROM purchase_order_items WHERE purchase_order_id=po.id) t ON true
WHERE NOT EXISTS (SELECT 1 FROM reception_vouchers rv WHERE rv.purchase_order_id=po.id)
GROUP BY 1 ORDER BY 2 DESC;
```
| status | nb | montant_ht |
|---|---|---|
| envoye | 3 | 10 195,00 |
| livre_complet | 2 | 7 348,00 |
| annule | 1 | 0,00 |

Détail : BC-2026-0015 (Marché aux puces, 118 j), BC-2026-0124 (RICA, 100 j, **1 500 kg de farine « livrés » sans BR**), BC-2026-0147 / 0269 / 0270 en `envoye` depuis 75-96 j.
→ Deux BC sont `livre_complet` avec `quantity_delivered` = commandé mais sans aucun BR : le statut a été forcé, aucun lot ni mouvement de stock n'existe pour 1 900 kg de farine.

### 1.2 Multiplicité BR / facture
```sql
SELECT nb_br, count(*) nb_bc FROM (SELECT purchase_order_id, count(*) nb_br FROM reception_vouchers GROUP BY 1) x GROUP BY 1 ORDER BY 1;
```
1 BR : 290 BC · 2 BR : 7 · 3 BR : 1. BR sans BC : 0 (FK NOT NULL).

### 1.3 Trois chemins de liaison facture → BC
```sql
SELECT count(*) FILTER (WHERE purchase_order_id IS NOT NULL) via_po_id,
       count(*) FILTER (WHERE reception_voucher_id IS NOT NULL) via_rv_id,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM invoice_purchase_orders ipo WHERE ipo.invoice_id=i.id)) via_ipo,
       count(*) FILTER (WHERE purchase_order_id IS NULL AND reception_voucher_id IS NULL AND NOT EXISTS (SELECT 1 FROM invoice_purchase_orders ipo WHERE ipo.invoice_id=i.id)) sans_aucun_lien,
       count(*) total
FROM invoices i WHERE invoice_type='received';
```
| via_po_id | via_rv_id | via_ipo | sans_aucun_lien | total |
|---|---|---|---|---|
| 294 | 292 | 34 | 23 | 317 |

260 factures ont `purchase_order_id` mais ne sont **pas** dans `invoice_purchase_orders` (table de jonction mig. 178 non rétro-alimentée) ; 1 facture multi-BC (2 BC).
→ Trois sources de vérité concurrentes pour le lien facture↔BC ; toute requête « BC facturé ? » doit tester les trois.

### 1.4 BC livrés sans facture
```sql
WITH po_fact AS (SELECT po.id FROM purchase_orders po
  WHERE EXISTS (SELECT 1 FROM invoices i WHERE i.purchase_order_id=po.id)
     OR EXISTS (SELECT 1 FROM invoice_purchase_orders ipo WHERE ipo.purchase_order_id=po.id)
     OR EXISTS (SELECT 1 FROM invoices i JOIN reception_vouchers rv ON rv.id=i.reception_voucher_id WHERE rv.purchase_order_id=po.id))
SELECT po.status, count(*) nb, round(sum(t.montant),2) montant_ht, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY CURRENT_DATE-po.order_date)) age_median_j
FROM purchase_orders po
LEFT JOIN LATERAL (SELECT sum(quantity_ordered*coalesce(unit_price,0)) montant FROM purchase_order_items WHERE purchase_order_id=po.id) t ON true
WHERE po.id NOT IN (SELECT id FROM po_fact) AND po.status<>'annule' GROUP BY 1;
```
| status | nb | montant_ht | âge médian |
|---|---|---|---|
| livre_complet | 4 | 4 346,20 | 106 j |
| envoye | 3 | 10 195,00 | 75 j |
| en_attente_facturation | 1 | 0,00 | 82 j |

→ 8 BC (14,5 k MAD HT) n'aboutissent à aucune facture ; tous datent de juin-juillet, aucun n'a été relancé.

### 1.5 Factures sans BC
```sql
SELECT to_char(invoice_date,'YYYY-MM') m,
 count(*) FILTER (WHERE purchase_order_id IS NULL AND reception_voucher_id IS NULL AND NOT EXISTS (SELECT 1 FROM invoice_purchase_orders ipo WHERE ipo.invoice_id=i.id)) sans_bc,
 count(*) total, round(sum(total_amount),2) montant_total
FROM invoices i WHERE invoice_type='received' GROUP BY 1 ORDER BY 1;
```
| mois | sans_bc | total | TTC total |
|---|---|---|---|
| 2026-03 | 1 | 1 | 610 |
| 2026-04 | 2 | 2 | 4 761 |
| 2026-05 | 13 | 14 | 36 805 |
| 2026-06 | 7 | 107 | 110 858 |
| 2026-07 | 0 | 177 | 154 256 |
| 2026-08 | 0 | 11 | 9 006 |
| 2026-10 | 0 | 5 | 3 190 |

23 factures sans BC = 76 129 MAD, catégories : Matières premières 45,9 k (18), Beurre & Margarines 11,8 k, sans catégorie 10,2 k, Fruits secs 8,2 k. **0 ligne** sur ces 23 factures (cf. 9.4b).
→ L'historique pré-juin est un import d'en-têtes ; depuis juillet toute facture passe par un BC (4 créées à la main après le 1er juillet, cf. s13 Q9).

### 1.6 Factures non soldées, âges, retards
```sql
SELECT status, count(*) nb, round(sum(total_amount-coalesce(paid_amount,0)),2) reste_du,
 round(percentile_cont(0.5) WITHIN GROUP (ORDER BY CURRENT_DATE-invoice_date)) age_median_j, max(CURRENT_DATE-invoice_date) age_max_j,
 count(*) FILTER (WHERE due_date IS NULL) sans_echeance, count(*) FILTER (WHERE due_date < CURRENT_DATE) en_retard
FROM invoices WHERE invoice_type='received' AND status NOT IN ('paid','cancelled') GROUP BY 1;
```
| status | nb | reste dû | âge médian | âge max | sans échéance | en retard |
|---|---|---|---|---|---|---|
| partial | 1 | 749,00 | 142 j | 142 | 1 | 0 |
| pending | 36 | 88 797,37 | 80 j | 129 | 36 | 0 |

Balance âgée : 0-30 j : 5 (3 190) · 31-60 : 4 (5 655) · 61-90 : 17 (58 009) · > 90 : 11 (22 693).
Par fournisseur (14.7) : Ecomab 11 fact. / 35 614 · OVOTEC 9 / 19 976 · MAGHREBLAC 1 / 17 100 · Épicerie 3 / 4 865 · ASMAE FOOD 4 / 3 962 · Abdelilah 2 / 2 874 · …
Statut `overdue` : 0 occurrence ; `devrait_etre_overdue` : 0 (aucune `due_date` renseignée sur les impayées).
→ 89,5 k MAD d'encours (28 % du TTC facturé) pilotés sans date d'échéance : aucun indicateur de retard ne peut se déclencher.

### 1.7 Cohérence statut BC vs quantités
```sql
SELECT po.status, count(*) FILTER (WHERE t.tot_del >= t.tot_ord) complet, count(*) FILTER (WHERE t.tot_del > 0 AND t.tot_del < t.tot_ord) partiel, count(*) FILTER (WHERE t.tot_del = 0) rien, count(*) total
FROM purchase_orders po JOIN LATERAL (SELECT sum(quantity_ordered) tot_ord, sum(quantity_delivered) tot_del FROM purchase_order_items WHERE purchase_order_id=po.id) t ON true GROUP BY 1;
```
| status | complet | partiel | rien | total |
|---|---|---|---|---|
| livre_complet | 293 | 0 | 0 | 299 (6 BC sans aucune ligne) |
| envoye | 0 | 0 | 3 | 3 |
| en_attente_facturation | 1 | 0 | 0 | 1 |
| annule | 0 | 0 | 1 | 1 |

Statuts `livre_partiel`, `non_livre`, `en_attente` (défaut du schéma) : **0 occurrence**. 6 BC `livre_complet` n'ont aucune ligne mais ont un BR et une facture (BC-2026-0016, 0024, 0028, 0041, 0044, 0101).
→ Le cycle de vie est binaire (envoyé → livré complet) ; les BC sans ligne montrent que la facture a été saisie directement sans passer par les lignes.

### 1.8 Paiements
`payments.type='invoice'` sans `invoice_id` : 0 ; paiements liés directement à un BC (`purchase_order_id`) : 0. 275 factures ont 1 paiement, 6 en ont 2. 287 paiements = 229 939,60 MAD = `sum(paid_amount)` exactement.

### 1.9 Activité mensuelle (14.4)
```sql
SELECT m, sum(bc) bc, sum(br) br, sum(fact) fact, sum(pay) pay FROM (
 SELECT to_char(order_date,'YYYY-MM') m, count(*) bc, 0 br, 0 fact, 0 pay FROM purchase_orders GROUP BY 1
 UNION ALL SELECT to_char(reception_date,'YYYY-MM'), 0, count(*), 0, 0 FROM reception_vouchers GROUP BY 1
 UNION ALL SELECT to_char(invoice_date,'YYYY-MM'), 0, 0, count(*), 0 FROM invoices WHERE invoice_type='received' GROUP BY 1
 UNION ALL SELECT to_char(payment_date,'YYYY-MM'), 0, 0, 0, count(*) FROM payments WHERE type='invoice' GROUP BY 1) x GROUP BY 1 ORDER BY 1;
```
| mois | BC | BR | factures | paiements |
|---|---|---|---|---|
| 2026-05 | 0 | 0 | 14 | 4 |
| 2026-06 | 103 | 107 | 107 | 102 |
| 2026-07 | 185 | 183 | 177 | 174 |
| 2026-08 | 11 | 12 | 11 | 7 |
| 2026-09 | 0 | 0 | 0 | 0 |
| 2026-10 | 5 | 5 | 5 | 0 |

Semaines depuis août : 27/07 : 7 · 17/08 : 4 · 28/09 : 1 · 05/10 : 4. Dernier paiement : 2026-08-01. Moyenne 5,8 BC/jour actif, max 13/jour, 27 jours à > 5 BC.
→ Usage « rattrapage » intensif sur 8 semaines, puis arrêt ; les 5 BC d'octobre viennent tous de DA de production.

---

## 2. Livraisons partielles / écarts de quantité

### 2.1 Répartition lignes BC
```sql
SELECT count(*) total, count(*) FILTER (WHERE quantity_delivered = quantity_ordered) exact,
 count(*) FILTER (WHERE quantity_delivered < quantity_ordered AND quantity_delivered > 0) partiel,
 count(*) FILTER (WHERE quantity_delivered = 0) rien, count(*) FILTER (WHERE quantity_delivered > quantity_ordered) sur_livre
FROM purchase_order_items;
```
| total | exact | partiel | rien | sur-livré |
|---|---|---|---|---|
| 810 | 778 | **0** | 20 | 12 |

Écart relatif des 12 sur-livraisons : > 50 % : 5 · 20-50 % : 4 · 5-20 % : 3. Top : Prép. poudre crème pât. 0,0035 → 5 (+142 757 %), Semoule kenz 4 → 20, Sapoir shaabi 1 → 5, Œufs liquides 1,56 → 5, Crème cuisson 4 → 12.
→ Aucune livraison partielle en 304 BC : la quantité livrée est recopiée de la commande (ou l'inverse). Les sur-livraisons sont des arrondis au conditionnement réel face à une DA « au gramme ».

### 2.2 `quantity_delivered` (ligne BC) vs Σ `quantity_received` (lignes BR)
```sql
SELECT count(*) total_lignes, count(*) FILTER (WHERE poi.quantity_delivered = coalesce(r.s,0)) coherent,
 count(*) FILTER (WHERE poi.quantity_delivered > coalesce(r.s,0)) delivered_sup_rvi, count(*) FILTER (WHERE poi.quantity_delivered < coalesce(r.s,0)) delivered_inf_rvi
FROM purchase_order_items poi LEFT JOIN (SELECT purchase_order_item_id, sum(quantity_received) s FROM reception_voucher_items GROUP BY 1) r ON r.purchase_order_item_id=poi.id;
```
794 cohérentes · 11 `delivered` > BR (dont 8 lignes `livre_complet` sans aucune RVI : BC-0015, 0036, 0086, 0124 ×5) · 5 `delivered` < BR (**doubles réceptions** : BC-0216 Languettes 600 reçues pour 300 commandées ×2 articles ; BC-0017 Nappage 12 pour 4 — 3 BR BR-0023/0025/0030 ; BC-0002 Farine viennoiserie 275 pour 250 ; BC-0218 Orange 8 pour 1).
→ Les re-réceptions créent des lots et du stock en double (3 lots « Nappage » de 4 pour 4 commandés) ; les lignes sans RVI n'ont ni lot ni mouvement de stock bien que « livrées ».

### 2.3 Date de livraison attendue
203/304 BC ont `expected_delivery_date` ; **59 antérieure à `order_date`**, 142 le jour même ; 298 ont `delivery_date`. Les 9 BC issus de DA n'ont aucune date attendue.
→ Le champ est rempli par défaut, pas comme engagement fournisseur.

---

## 3. Écarts de prix

### 3.1 Prix nuls
```sql
SELECT count(*) total, count(*) FILTER (WHERE unit_price IS NULL) prix_null, count(*) FILTER (WHERE unit_price=0) prix_zero FROM purchase_order_items;
```
810 lignes BC : 15 NULL + 1 à 0 (BC-0003 OVOTEC crème fraîche, BC-0117 annulé ×6, BC-0147 ×3, BC-0230 ×3, BC-0269, BC-0270 ×2). RVI : 7 prix NULL (Raisins secs golden, cadres et plaques inox BC-0108/0109/0230).
→ Les BC encore ouverts (0147, 0230) sont valorisés 0 MAD : l'encours à recevoir est sous-estimé.

### 3.2 Prix BC vs prix réception (même ligne)
```sql
SELECT count(*) total_rvi, count(*) FILTER (WHERE rvi.unit_price = poi.unit_price) identique, count(*) FILTER (WHERE rvi.unit_price <> poi.unit_price) different,
 count(*) FILTER (WHERE rvi.unit_price IS NULL OR poi.unit_price IS NULL) un_null,
 round(sum((rvi.unit_price-poi.unit_price)*rvi.quantity_received) FILTER (WHERE rvi.unit_price <> poi.unit_price),2) impact_montant
FROM reception_voucher_items rvi JOIN purchase_order_items poi ON poi.id=rvi.purchase_order_item_id;
```
789 RVI : 757 identiques · 25 différents · 7 NULL · impact +536,11 MAD. Top : Crème fraîche BC-0003 0 → 25,5 (+612) ; Farine viennoiserie BC-0002 5 → 7,6 (+65) ; Amande poudre 120 → 99,5 (−61,5) ; Amande effilée 125 → 99 (−52) ; Farine d'orge 7,6 → 6 (−40).

### 3.3 Prix réception vs prix facture (appariement BC + article)
761 appariées : 749 identiques · 11 différentes (6 > 2 %) · impact +298,57 MAD. Top : Chocolat Rich Noir 86,66 → 433,33 (×5, +693) ; Farine viennoiserie 7,6 → 5 (−650) ; Sucre glace 7,94 → 39,70 (×5, +95).
→ Les écarts ×5 sur Ecomab 26F17969 sont des changements d'unité (carton de 5 kg vs kg) entre la réception et la facture.

### 3.4 Prix BC vs facture direct (14.9)
762 appariées : 743 identiques · 19 différentes · impact +1 419,69 MAD.

### 3.5 Rapprochement 3 voies au niveau en-tête (Σ reçu HT vs Σ facturé HT par BC)
```sql
WITH po_recu AS (SELECT rv.purchase_order_id, sum(rvi.quantity_received*coalesce(rvi.unit_price,0)) recu_ht FROM reception_voucher_items rvi JOIN reception_vouchers rv ON rv.id=rvi.reception_voucher_id GROUP BY 1),
po_fact AS (SELECT purchase_order_id, sum(amount) fact_ht, sum(total_amount) fact_ttc FROM invoices WHERE invoice_type='received' AND purchase_order_id IS NOT NULL GROUP BY 1)
SELECT count(*) nb_bc, count(*) FILTER (WHERE abs(f.fact_ht - r.recu_ht) < 0.5) match_ht,
 count(*) FILTER (WHERE abs(f.fact_ht - r.recu_ht) >= 0.5 AND abs(f.fact_ttc - r.recu_ht) >= 0.5) aucun_match,
 round(sum(f.fact_ht - r.recu_ht) FILTER (WHERE abs(f.fact_ht - r.recu_ht) >= 0.5 AND abs(f.fact_ttc - r.recu_ht) >= 0.5),2) ecart_cumule
FROM po_fact f JOIN po_recu r ON r.purchase_order_id=f.purchase_order_id;
```
286 BC facturés : 259 match HT · **27 sans match**, écart cumulé +6 230,93 MAD. Top 10 :

| BC | fournisseur | facture | reçu HT | facturé HT | TVA | écart HT |
|---|---|---|---|---|---|---|
| BC-2026-0036 | Abdelilah | FR-2026-0059 | 0,00 | 2 500,00 | 0 | +2 500,00 |
| BC-2026-0017 | Ecomab | 26F17969 | 6 294,90 | 7 854,54 | 1 559,00 | +1 559,64 |
| BC-2026-0050 | Marché aux puces | FR-2026-0065 | 291,00 | 1 091,10 | 0 | +800,10 |
| BC-2026-0086 | Abedlkrim | FR-2026-0103 | 230,00 | 617,50 | 0 | +387,50 |
| BC-2026-0038 | Marché aux puces | FR-2026-0050 | 140,00 | 485,00 | 0 | +345,00 |
| BC-2026-0076 | Emballages | FR-2026-0093 | 1 092,50 | 1 342,50 | 0 | +250,00 |
| BC-2026-0002 | RICA MAROC | 515042 | 13 577,40 | 13 427,50 | 0 | −149,90 |
| BC-2026-0216 | Abedlkrim | FR-2026-0229 | 276,00 | 138,00 | 0 | −138,00 |
| BC-2026-0012 | Épicerie | FR-2026-0027 | 496,50 | 610,00 | 0 | +113,50 |
| BC-2026-0034 | Marché aux puces | FR-2026-0047 | 180,00 | 289,08 | 0 | +109,08 |

→ Les écarts viennent (a) de lignes à prix NULL côté BR (BC-0036 : 20 l d'huile d'olive sans prix, facturés 2 500), (b) de la TVA ajoutée à la main sur `amount` au lieu de `tax_amount` (BC-0017 : écart HT = TVA), (c) de lignes ajoutées sur la facture mais absentes du BR. Aucun contrôle ne bloque la facture quand Σ lignes ≠ Σ réception.

### 3.6 Catalogue (`ingredients.unit_cost`) vs dernier prix BC
269 ingrédients achetés : 267 identiques au dernier prix BC, 2 écarts > 10 %, 0 catalogue à zéro. En revanche catalogue vs **prix moyen pondéré** BC (6.7) : Mangue 40 vs 0,04 (+99 900 %), Eau de fleur d'oranger 235 vs 44,6, Margarine atlas 67,5 vs 24,75, Chocolat bâton 12 vs 108,8, Filet de dinde 10 vs 35,5.
→ Le catalogue est écrasé par le dernier achat (quelle que soit son unité) ; le coût matière des recettes dépend du dernier BC saisi.

---

## 4. Délais

```sql
-- BC -> premier BR (jours)
SELECT count(*) nb, percentile_cont(0.5) WITHIN GROUP (ORDER BY d) mediane, percentile_cont(0.9) WITHIN GROUP (ORDER BY d) p90, max(d), count(*) FILTER (WHERE d=0) jour_meme
FROM (SELECT po.id, min(rv.reception_date)-po.order_date d FROM purchase_orders po JOIN reception_vouchers rv ON rv.purchase_order_id=po.id GROUP BY po.id, po.order_date) x;
-- BC -> BR en heures (created_at)
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY h) mediane_h, percentile_cont(0.9) WITHIN GROUP (ORDER BY h) p90_h, count(*) FILTER (WHERE h<0.0833) moins_5min
FROM (SELECT po.id, extract(epoch FROM min(rv.created_at)-po.created_at)/3600 h FROM purchase_orders po JOIN reception_vouchers rv ON rv.purchase_order_id=po.id GROUP BY po.id, po.created_at) x;
-- BR -> facture, facture -> paiement : mêmes patrons (s4_delais.sql 4.2, 4.3)
```
| étape | n | médiane | p90 | max | remarques |
|---|---|---|---|---|---|
| BC → 1er BR (jours) | 298 | 0 | 1 | 7 | 266 le jour même ; **255/298 BR créés < 5 min après le BC** (p90 = 18,3 h) |
| BR → facture (jours) | 292 | 0 | 0 | 13 | 284/292 factures créées < 5 min après le BR |
| `invoice_date` vs `reception_date` | 292 | 0 | — | — | 276 même jour, 14 facture antérieure à la réception, 2 postérieure |
| Facture → paiement complet (jours) | 280 | 0 | 8 | 81 | 226 payées le jour même, 13 payées **avant** la date de facture (min −4) |
| BR → paiement (jours) | 256 | 0 | 0 | 43 | min −16 |

Échéances : 34/317 factures ont `due_date` ; 88 ont `expected_payment_mode` ; 35 un n° de chèque. Sur les 34 avec échéance : 3 payées en retard, médiane −45 j (payées 45 j avant l'échéance).
Modes (type `invoice`) : cash 248 (76 287) · traite 22 (70 082) · chèque 15 (68 943) · virement 1 (13 428) · avoir 1 (1 200). 100 % des chèques/traites ont `cashed_at` ; traite : échéance moyenne +53 j, chèque +31 j. `expected_payment_mode` ≠ réel : 12 cas (10 check→traite, 1 check→avoir, 1 check→transfer).
Saisie rétroactive : BC `created_at` > `order_date` : 0/304 ; BR : 0/307 ; paiements saisis > 7 j après la date : 6/287.
→ Les délais mesurent le temps de frappe, pas le cycle fournisseur : les dates métier sont égales à la date de saisie. Seuls les effets (traite/chèque, 139 k MAD = 60 % des montants payés) portent un vrai délai.

---

## 5. Fournisseurs

### 5.1 Dépense et concentration (factures reçues TTC)
```sql
WITH d AS (SELECT s.name, count(i.id) nb_fact, sum(i.total_amount) ttc FROM suppliers s JOIN invoices i ON i.supplier_id=s.id AND i.invoice_type='received' GROUP BY 1), t AS (SELECT sum(ttc) tot FROM d)
SELECT d.name, d.nb_fact, round(d.ttc,2) ttc, round(d.ttc/t.tot*100,1) pct, round(sum(d.ttc) OVER (ORDER BY d.ttc DESC)/t.tot*100,1) pct_cumule FROM d, t ORDER BY d.ttc DESC LIMIT 10;
```
| fournisseur | nb fact. | TTC | % | % cumulé |
|---|---|---|---|---|
| Ecomab | 27 | 80 472,56 | 25,2 | 25,2 |
| MAGHREBLAC | 5 | 74 900,00 | 23,4 | 48,6 |
| RICA MAROC | 6 | 34 881,25 | 10,9 | 59,5 |
| OVOTEC | 15 | 32 806,01 | 10,3 | 69,8 |
| Épicerie | 87 | 19 474,78 | 6,1 | 75,9 |
| Marché aux puces | 72 | 18 540,06 | 5,8 | 81,7 |
| Abdelilah | 11 | 14 554,52 | 4,6 | 86,3 |
| Emballages | 8 | 7 092,50 | 2,2 | 88,5 |
| Abedlkrim | 23 | 6 139,00 | 1,9 | 90,4 |
| SMCP-E | 5 | 5 937,00 | 1,9 | 92,3 |

40 fournisseurs, 31 actifs, 28 avec facture, 28 avec BC. Vue BC HT : MAGHREBLAC 51 300 (3 BC), RICA 44 336 (7), Ecomab 40 180 (17), OVOTEC 19 664 (11), Épicerie 18 829 (84), Marché aux puces 17 123 (72).
→ 4 fournisseurs industriels = 70 % de la dépense en 53 factures ; 2 « fournisseurs » génériques = 52 % des BC pour 12 % de la dépense (achats de détail au comptant).

### 5.2 Inactivité
```sql
SELECT count(*) FILTER (WHERE dernier < CURRENT_DATE-90) sans_achat_90j, count(*) FILTER (WHERE dernier='1900-01-01') jamais_achat FROM (
 SELECT s.id, max(greatest(coalesce(po.last_po,'1900-01-01'), coalesce(i.last_inv,'1900-01-01'))) dernier FROM suppliers s
 LEFT JOIN (SELECT supplier_id, max(order_date) last_po FROM purchase_orders GROUP BY 1) po ON po.supplier_id=s.id
 LEFT JOIN (SELECT supplier_id, max(invoice_date) last_inv FROM invoices WHERE invoice_type='received' GROUP BY 1) i ON i.supplier_id=s.id GROUP BY s.id) x;
```
15 sans achat depuis 90 j, dont **12 sans aucun achat** (Les Oeufs Frais, BIOUGNACH, MAGNATE EMBALLAGE, ALERTE NUISIBLE actifs ; 8 inactifs dont « Personnel – Avances caisse » utilisé comme pseudo-fournisseur). 3 dormants : Orientines (06-04), SONEPAL (07-07), Carrefour (07-11). Quasi-doublon : SONEPAL / SONEPALE (2 BC chacun).

### 5.3 Complétude de la fiche
```sql
SELECT count(*) total, count(*) FILTER (WHERE nullif(trim(ice),'') IS NOT NULL) avec_ice, count(*) FILTER (WHERE nullif(trim(phone),'') IS NOT NULL) avec_tel,
 count(*) FILTER (WHERE nullif(trim(email),'') IS NOT NULL) avec_email, count(*) FILTER (WHERE nullif(trim(address),'') IS NOT NULL) avec_adresse,
 count(*) FILTER (WHERE nullif(trim(contact_name),'') IS NOT NULL) avec_contact FROM suppliers;
```
| total | ICE | tél | email | adresse | ville | contact |
|---|---|---|---|---|---|---|
| 40 | 13 | 20 | 15 | 14 | 16 | 11 |

ICE : 12 valeurs distinctes pour 13 fiches (Supeco et Carrefour partagent `000078523000008`), toutes à 15 chiffres. Pas de colonne RC, IF, patente, délai de paiement, conditions, RIB. `account_auxiliaries` : 35/40 fournisseurs ont un auxiliaire ; 5 sans (sablés et JAWDA ont pourtant 1 facture chacun) ; 564/564 lignes 4411 portent un auxiliaire (mig. 208 efficace).
→ La fiche fournisseur est un nom ; 2/3 des fiches ne permettent ni facture conforme (ICE) ni relance (contact).

### 5.4 Lien article → fournisseur
```sql
SELECT count(*) total, count(supplier_id) avec_supplier_id, count(nullif(trim(supplier),'')) avec_supplier_texte, count(nullif(trim(supplier_reference),'')) avec_ref FROM ingredients;
SELECT count(*) total, count(nullif(trim(supplier),'')) avec_supplier_texte FROM packaging_items;
```
ingredients : 405, `supplier_id` **0**, texte libre 137, `supplier_reference` 0. packaging_items : 109, `supplier` **0**. Fournisseur du BC = fournisseur de la facture : 294/294 ; fournisseur du paiement = facture : 287/287.
→ La colonne `ingredients.supplier_id` (mig. 136) n'a jamais été alimentée : pas de fournisseur par défaut, pas de prix négocié, pas de référence article.

---

## 6. Articles et prix

### 6.1 Multi-fournisseurs
```sql
SELECT kind, count(*) FROM (
 SELECT 'ingredient' kind, poi.ingredient_id aid, count(DISTINCT po.supplier_id) nf FROM purchase_order_items poi JOIN purchase_orders po ON po.id=poi.purchase_order_id WHERE poi.ingredient_id IS NOT NULL AND po.status<>'annule' GROUP BY 1,2 HAVING count(DISTINCT po.supplier_id)>=2
 UNION ALL SELECT 'packaging', poi.packaging_id, count(DISTINCT po.supplier_id) FROM purchase_order_items poi JOIN purchase_orders po ON po.id=poi.purchase_order_id WHERE poi.packaging_id IS NOT NULL AND po.status<>'annule' GROUP BY 1,2 HAVING count(DISTINCT po.supplier_id)>=2) x GROUP BY 1;
```
64 ingrédients + 14 emballages achetés chez ≥ 2 fournisseurs ; **54 d'entre eux ont un écart min/max > 20 %**. Top : Filet de dinde fumé 6 fournisseurs (7,9 → 62,9), Lait 5 (9,5 → 11,03), Amande poudre 5 (57,5 → 120), Sésame décortiqué 4 (22 → 64), Creme cheese 4 (18 → 50), « Crème fraiche » 4 (18,67 → 190).

### 6.2 Volatilité 12 mois (articles achetés ≥ 3 fois)
```sql
WITH l AS (SELECT coalesce(poi.ingredient_id,poi.packaging_id) aid, coalesce(ing.name,pk.name) article, coalesce(ing.unit,pk.unit) unite, poi.unit_price, po.order_date, po.supplier_id
 FROM purchase_order_items poi JOIN purchase_orders po ON po.id=poi.purchase_order_id LEFT JOIN ingredients ing ON ing.id=poi.ingredient_id LEFT JOIN packaging_items pk ON pk.id=poi.packaging_id
 WHERE po.status<>'annule' AND poi.unit_price>0 AND po.order_date>=CURRENT_DATE-365)
SELECT article, unite, count(*) nb_achats, count(DISTINCT supplier_id) nb_fourn, min(unit_price) pmin, max(unit_price) pmax, (array_agg(unit_price ORDER BY order_date DESC))[1] dernier, round((max(unit_price)-min(unit_price))/min(unit_price)*100,1) variation_pct
FROM l GROUP BY aid, article, unite HAVING count(*)>=3 ORDER BY variation_pct DESC LIMIT 15;
```
| article | unité | achats | fourn. | min | max | dernier | variation |
|---|---|---|---|---|---|---|---|
| Languette longue | unit | 5 | 2 | 0,16 | 16,00 | 0,16 | 9 900 % |
| Eau de fleur d'oranger | unit | 6 | 3 | 4,00 | 235,00 | 4,00 | 5 775 % |
| Ruban adhésif | unit | 3 | 2 | 1,00 | 20,00 | 20,00 | 1 900 % |
| Crème fraiche | l | 6 | 4 | 18,67 | 190,00 | 19,00 | 918 % |
| Balai | unit | 4 | 1 | 5,00 | 40,00 | 40,00 | 700 % |
| Filet de dinde fumé | unit | 13 | 6 | 7,90 | 62,90 | 10,00 | 696 % |
| RUBAN | unit | 3 | 2 | 5,00 | 35,00 | 35,00 | 600 % |
| Huile de table | l | 4 | 2 | 17,00 | 81,95 | 17,50 | 382 % |
| Thon tam | unit | 3 | 3 | 27,95 | 128,00 | 128,00 | 358 % |
| Semoule kenz | kg | 4 | 3 | 2,24 | 10,19 | 10,19 | 355 % |
| Margarine atlas | unit | 4 | 2 | 16,00 | 67,50 | 67,50 | 322 % |
| Papier essuie-mains | unit | 9 | 2 | 10,00 | 40,00 | 10,00 | 300 % |
| Sésame décortiqué | kg | 12 | 4 | 22,00 | 64,00 | 35,00 | 191 % |
| Creme cheese | unit | 9 | 4 | 18,00 | 50,00 | 50,00 | 178 % |
| Film cellophane | unit | 5 | 1 | 25,00 | 68,00 | 68,00 | 172 % |

Répartition des 82 articles ≥ 3 achats : stable 16 · ≤ 5 % 10 · 5-20 % 8 · 20-50 % 14 · 50-100 % 12 · **> 100 % 22**.
→ Les variations > 100 % sont des changements d'unité (pièce vs paquet vs carton), pas des hausses : `purchase_order_items` n'a aucune colonne d'unité d'achat ni de conditionnement (6.6 : 0 colonne `unit`/`container_count`) ; 11/405 ingrédients ont un `container_size`.

### 6.3 Articles sans prix / sans fournisseur / jamais achetés
ingredients 405 : 27 sans `unit_cost`, 405 sans `supplier_id`, 130 jamais achetés (ni BC ni facture), 275 achetés via BC. packaging_items 109 : 10 sans prix, 109 sans fournisseur, 63 sans `category_id`, 86 achetés.
Lots actifs : `unit_cost` lot = `ingredients.unit_cost` dans 237/372 cas, **91 lots > 10 % d'écart** avec le catalogue.

### 6.4 Lignes de facture non rattachées à un article
52 lignes `invoice_items` reçues (5 137 MAD) sans `ingredient_id` ni `packaging_id`, toutes sur des factures liées à un BC : Produits de nettoyage ×7, Sachet moyen ×2 (750), poche ×2, Papier essuie-mains, Film cellophane, Cuillère plastique… (des consommables qui existent par ailleurs comme `packaging_items`).

---

## 7. Lots (traçabilité)

```sql
SELECT count(*) rvi_ingredient, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ingredient_lots l WHERE l.reception_voucher_item_id=rvi.id)) avec_lot FROM reception_voucher_items rvi WHERE rvi.ingredient_id IS NOT NULL;
SELECT count(*) total, count(reception_voucher_item_id) depuis_br, count(source_product_lot_id) depuis_recyclage, count(*) FILTER (WHERE reception_voucher_item_id IS NULL AND source_product_lot_id IS NULL) sans_origine FROM ingredient_lots;
SELECT count(*) total, count(*) FILTER (WHERE expiration_date IS NULL) sans_dlc, count(*) FILTER (WHERE coalesce(unit_cost,0)=0) sans_prix, count(*) FILTER (WHERE supplier_id IS NULL) sans_fournisseur,
 count(*) FILTER (WHERE nullif(trim(supplier_lot_number),'') IS NULL) sans_lot_fournisseur, count(*) FILTER (WHERE manufactured_date IS NULL) sans_date_fab FROM ingredient_lots;
```
| indicateur | valeur |
|---|---|
| RVI ingrédient avec lot | 634/634 (1 lot par RVI, jamais plusieurs) |
| Lots total / depuis BR / recyclage / sans origine | 669 / 634 / 0 / 35 (ajustements d'inventaire physique 2026-07-06 et « restock sans motif ») |
| Lots sans DLC | **616/669** (581/634 sur lots BR) |
| Lots sans n° lot fournisseur | 621 (586 sur lots BR) |
| Lots sans date de fabrication | 618 |
| Lots sans `lot_number` interne | 634/669 (seuls les 35 lots d'ajustement en ont un) |
| Lots sans prix / sans fournisseur | 35 / 35 (les lots d'ajustement uniquement) |
| RVI avec DLC saisie / lot fournisseur / date fab | 53 / 48 / 51 sur 789 |
| Lots actifs avec reste > 0 | 401, dont 389 sans DLC = **99,3 % de la quantité restante** |
| Lots actifs DLC dépassée | 4 (Danone, Sauce tomate, Mozzarella, Lotus — tous à 0 restant mais non clôturés) |
| Statuts | active 646 · depleted 17 · waste 6 ; `expired` jamais utilisé |
| Cohérence lot vs RVI (qté, prix) | 634/634 égal |
| `inventory_transactions` restock liées à un BR | 634/640 (6 restock hors BR) ; 0 BR ingrédient sans transaction |
| `inventory.current_quantity` = Σ lots actifs | 212/377 égal, **165 ingrédients divergent** |
| Emballages : RVI packaging ↔ `packaging_stock_transactions` | 155 RVI ; 0 transaction référence la RVI ou le BR (reference_type = `purchase_order`, 161/161 pointent le BC) ; quantités égales sur 151/152 BC |
| `reception_quality_checks` | **0 ligne** (table créée mig. 056, jamais écrite) |

→ Le lot est créé mécaniquement à la réception (1 RVI = 1 lot) mais aucune donnée ONSSA n'y est portée ; la DLC n'est saisie que sur 7 % des réceptions. Les lots d'inventaire physique (35) sont les seuls à avoir un numéro de lot, ce qui est l'inverse de l'attendu. Les 165 divergences inventory ↔ lots confirment la dérive signalée dans la mémoire « Inventaire physique mensuel ».

---

## 8. Demandes d'achat (DA)

```sql
SELECT status, reason, count(*), min(created_at)::date, max(created_at)::date FROM purchase_requests GROUP BY 1,2 ORDER BY 1,2;
SELECT count(*) nb, percentile_cont(0.5) WITHIN GROUP (ORDER BY d) mediane, max(d) FROM (SELECT po.order_date - pr.created_at::date d FROM purchase_requests pr JOIN purchase_orders po ON po.id=pr.purchase_order_id) x;
SELECT count(DISTINCT po.id) bc_avec_da, (SELECT count(*) FROM purchase_orders) total_bc FROM purchase_orders po JOIN purchase_requests pr ON pr.purchase_order_id=po.id;
```
| indicateur | valeur |
|---|---|
| Funnel par statut | `received` 31/31 ; `pending`, `assigned`, `ordered`, `cancelled` : 0 |
| Motif | production 29 · manual 2 · `stock_bas` 0 |
| Mois | 2026-08 : 12 · 2026-10 : 19 |
| Délai DA → BC | 31/31 = **0 jour** (médiane 0, max 0) ; BC → réception 0 jour |
| BC issus d'une DA | 9/304 (BC-0297 → 0305) ; 9 BC = 100 % des BC depuis le 17 août |
| DA jamais traitées / orphelines / doublons ouverts | 0 / 0 / 0 |
| Demandeurs | manager Meryem Sajri 16 · admin Aniss Bouida 15 |
| Unités DA = unité ingrédient | 31/31 |
| Qté DA = qté ligne BC | 30/31 (Sucre semoule : DA 0,1791 kg → BC 50 kg) |
| Lignes BC issues de DA < 1 kg | 13 (0,0035 ; 0,0272 ; 0,0321 ; 0,0625 kg…) |
| Seuils de réappro | `inventory.minimum_threshold` > 0 : **0/377** ; `packaging_store_stock.stock_min_threshold` > 0 : 0/102 ; `replenishment_requests` : 0 |

→ La DA est le besoin net d'un plan de production (au gramme près) converti en BC le même jour puis « reçu » le même jour : c'est un bon de sortie déguisé en achat. Aucun mécanisme de seuil ou de regroupement par fournisseur ; les quantités au gramme forcent des sur-livraisons de +400 % à +142 757 %.

---

## 9. TVA et cohérence des montants

```sql
SELECT count(*) total, count(*) FILTER (WHERE coalesce(tax_amount,0)=0) tva_zero, count(*) FILTER (WHERE tax_amount>0) tva_positive, round(sum(tax_amount),2) tva_totale, round(sum(amount),2) ht_total, round(sum(total_amount),2) ttc_total FROM invoices WHERE invoice_type='received';
SELECT count(*) total, count(tva_rate) avec_taux, count(*) FILTER (WHERE tva_rate IS NULL) sans_taux FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.invoice_type='received';
```
| indicateur | valeur |
|---|---|
| Factures reçues TVA = 0 / > 0 | **268 / 49** ; TVA totale 19 985,06 sur HT 299 500,91 (TTC 319 485,97) |
| Lignes sans `tva_rate` | **768/816** ; 42 lignes à 20 %, 6 à 10 % |
| HT + TVA = TTC (en-tête) | 317/317 OK |
| Σ lignes HT = en-tête HT | 292/294 OK (2 écarts de 0,01) |
| Σ TVA lignes = `tax_amount` | 272/294 ; **22 KO** = factures avec TVA d'en-tête mais lignes sans taux |
| `subtotal` = qté × PU | 816/816 |
| Factures sans aucune ligne | 23 = 76 129,21 MAD TTC |
| Fournisseurs facturant la TVA | Ecomab 27/27 (13 349), OVOTEC 13/15 (5 236), SOFADEX 6/7 (789), SMCP-E 3/5 (610) |
| Fournisseurs avec ICE mais factures à 0 TVA | MAGHREBLAC 5/5 (74 900 TTC), RICA MAROC 6/6 (34 881), Supeco 14/14, BS2M, JAWDA, Orientines, BRICOMA, Carrefour, BIM |
| Factures auto-générées avec TVA | 1/253 ; 31 ont vu la TVA ajoutée a posteriori, 15 une échéance, 68 un mode de paiement |

→ Les montants sont arithmétiquement propres (triggers mig. 189 efficaces) mais la TVA n'est renseignée que lorsqu'un opérateur corrige l'en-tête à la main ; la ventilation par ligne et par taux (34552/34554) est inexploitable pour la déclaration.

---

## 10. Qualité des données

```sql
SELECT count(*) nb, count(*) FILTER (WHERE abs(coalesce(i.paid_amount,0)-coalesce(p.s,0))<0.01) ok FROM invoices i LEFT JOIN (SELECT invoice_id, sum(amount) s FROM payments WHERE type='invoice' GROUP BY 1) p ON p.invoice_id=i.id WHERE i.invoice_type='received';
SELECT s.name, i.invoice_number, count(*) FROM invoices i JOIN suppliers s ON s.id=i.supplier_id WHERE i.invoice_type='received' GROUP BY 1,2 HAVING count(*)>1;
SELECT count(*) FROM purchase_orders WHERE status='envoye' AND order_date < CURRENT_DATE-30;
WITH n AS (SELECT substring(order_number FROM '\d+$')::int num FROM purchase_orders WHERE order_number ~ '^BC-2026-\d+$') SELECT count(*), min(num), max(num), max(num)-min(num)+1-count(*) trous FROM n;
```
| contrôle | résultat |
|---|---|
| `paid_amount` = Σ paiements | 317/317 OK ; statut cohérent (paid 280 soldées, pending 36 à 0, partial 1) ; 0 sur-payée |
| Doublons n° facture par fournisseur | 0 (mais 250 numéros `FR-` internes, donc le contrôle ne porte que sur 67 numéros fournisseur) |
| BC `envoye` > 30 j | 3 (depuis 2026-07-07) ; 1 `en_attente_facturation` depuis 82 j |
| Montants négatifs (factures, lignes, paiements, lots, POI) | 0 |
| Orphelins (store, créateur, receveur) | 0 ; 62 lignes de facture sans `category_id`, 1 facture sans catégorie |
| Trous de numérotation | BC : 1 (304 pour 1→305) ; BR : 2 (307 pour 1→309) ; 0 hors format |
| BC sans ligne | 6 (tous avec BR + facture) |
| Doubles réceptions (même article, > 1 BR, Σ reçu > commandé) | BC-0002, 0017 (×3), 0216 (×2 = 600/300), 0218 |
| Tables mortes | `reception_quality_checks` 0 · `replenishment_requests` 0 · `scheduled_payments` 0 · `invoices.attachment_url` 0 · `payments.check_attachment_url` 0 · `payments.withholding_type_id` 0 · `purchase_orders.notes` 0 · statuts `disputed`/`cancelled`/`livre_partiel`/`non_livre`/`en_attente`/`overdue`/`expired` : 0 |
| Notes | 307/307 BR et 294/317 factures ont une note **générée** (« Reception depuis confirmation de livraison BC … », « Facture auto-generee depuis BC-… ») ; 1 note libre sur RVI |
| Pièces jointes | 0 facture scannée, 0 chèque scanné |
| Comptabilité | journal_entries : backfill 994 · payment 46 · invoice 14 ; 25 factures reçues (20 086,91) et 23 paiements sans écriture `source_id` ; 0 écriture sur BR (pas de provision GR/IR) ; comptes mouvementés : 4411, 61121, 34552/34554, 4415 effets, 5141, 5111 |
| Piste d'audit | aucune table d'historique pour BC/BR/facture (`ref_audit_log` ne couvre que le référentiel) ; 81/304 BC modifiés > 1 min après création, 25 > 1 jour |
| Utilisateurs | sajri@ (manager) 289 BC / 289 BR / 272 factures / 256 paiements ; admin@ 14 / 17 / 44 / 30 ; ibrahim@ 1 |
| Magasins | 1 (« Point de vente principal ») pour 100 % des BC et factures |
| Espèces > 5 000 MAD (plafond déductibilité) | 0 paiement, 0 facture cumulée |

---

## 11. Faiblesses étiquetées

| ID | Sévérité | Faiblesse | Preuve chiffrée |
|---|---|---|---|
| **D1** | **Critique** | Le workflow BC→BR→facture→paiement est une saisie unique a posteriori : aucune étape n'a de réalité métier (pas d'envoi, pas d'attente, pas de contrôle). | 255/298 BR < 5 min après BC ; 284/292 factures < 5 min après BR ; 0 livraison partielle sur 810 lignes ; 59 dates attendues antérieures à la commande. |
| **D2** | **Critique** | Encours fournisseurs non pilotable : aucune échéance, statut `overdue` et échéancier jamais alimentés. | 37 factures / 89 547 MAD à 0 `due_date` ; 283/317 sans échéance ; `scheduled_payments` 0 ; 11 factures > 90 j. |
| **D3** | **Critique** | La facture reçue est une copie du BR numérotée en interne, pas la pièce fournisseur ; TVA quasi absente. | 250 numéros `FR-` / 317 ; 268 factures à TVA 0 ; 768/816 lignes sans taux ; MAGHREBLAC + RICA (110 k TTC, ICE connu) à 0 TVA ; 23 factures sans ligne = 76 k. |
| **D4** | **Critique** | Traçabilité lots inopérante : DLC, n° lot fournisseur, contrôle qualité non saisis. | 92 % des lots BR sans DLC ; 99,3 % de la quantité active sans DLC ; 586 sans lot fournisseur ; `reception_quality_checks` 0 ; 634 lots sans `lot_number`. |
| **D5** | **Majeur** | Le module n'est plus utilisé depuis août (sauf DA→BC automatiques) ; les achats courants ont probablement migré vers `payments.type='expense'`. | BC : juin 103, juillet 185, août 11, sept. 0, oct. 5 ; dernier paiement facture 2026-08-01 ; 311 paiements `expense` = 252 k MAD. |
| **D6** | **Majeur** | Pas d'unité d'achat ni de conditionnement sur les lignes : prix incomparables, catalogue et coût recette pollués. | 22 articles avec variation > 100 % (Languette 0,16↔16 ; Eau de fleur 4↔235) ; 54 articles multi-fournisseurs à écart > 20 % ; Mangue catalogue 40 vs PMP 0,04 ; 91 lots à > 10 % du catalogue ; 0 colonne unité sur `purchase_order_items`. |
| **D7** | **Majeur** | Référentiel fournisseur pauvre et non relié aux articles. | 13/40 ICE ; 11/40 contact ; `ingredients.supplier_id` 0/405 ; `packaging_items.supplier` 0/109 ; 12 fournisseurs jamais utilisés ; 2 génériques = 52 % des BC ; 5 sans auxiliaire ; SONEPAL/SONEPALE. |
| **D8** | **Majeur** | Intégrité réception ↔ stock non garantie : doubles réceptions, lignes « livrées » sans BR, lien facture↔BC triple. | 5 lignes Σ BR > commandé (600/300 ×2, Nappage 12/4) ; 8 lignes `livre_complet` sans RVI (1 900 kg farine) ; 260 factures hors `invoice_purchase_orders` ; 165/377 `inventory` ≠ Σ lots ; 27 BC à écart en-tête (6 231 MAD). |
| **D9** | **Majeur** | DA = besoin net de production au gramme, sans seuil, sans regroupement, converti en BC/BR le même jour. | 31/31 DA → BC en 0 j ; 13 lignes < 1 kg ; sur-livraison +142 757 % ; 0/377 seuils stock ; `replenishment_requests` 0 ; motif `stock_bas` 0. |
| **D10** | **Mineur** | Hygiène : prix nuls sur BC ouverts, lignes de facture sans article, champs/tables morts, pas de piste d'audit, pas de pièce jointe, 1 seul opérateur. | 16 lignes BC à prix NULL/0 (encours 0147/0230 valorisé 0) ; 52 lignes facture sans article (5 137 MAD) ; 0 pièce jointe ; 25 factures + 23 paiements sans écriture ; 81 BC modifiés sans trace ; sajri@ = 95 % des BC. |

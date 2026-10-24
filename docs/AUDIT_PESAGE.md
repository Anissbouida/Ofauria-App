# Audit du module Pesage (BSI / magasinier) — comparaison aux standards WMS

*Audit réalisé le 16/08/2026 — périmètre : migrations 111 (split Économat/Pesage), 112, 113 (workflow strict Option B), 225/226 (contenants) ; `bon-sortie.repository.ts` (1666 l.), `bon-sortie.controller.ts`, `bon-sortie.routes.ts`, `ingredient-lot.repository.ts` (`findPesageStock`), `WarehousePage.tsx`, `BonSortiePanel.tsx`, `TransferRequestsList.tsx` ; données réelles de la base locale (copie prod). Référentiels comparés : SAP EWM/WM (picking, catch weight, statut qualité), Odoo Inventory (emplacements réserve/picking, removal strategy FEFO), Sage X3 (préparation, poids variable), verticaux boulangerie (Cybake, FlexiBake, BakeSmart).*

---

## Synthèse

Le squelette du module est **le bon** et il est rare à cette échelle. Trois choix sont exactement ceux du marché :

1. **Deux zones de stock physiques** (`economat_quantity` / `pesage_quantity` sur le même lot, mig 111) avec réapprovisionnement de la zone de prélèvement par transfert tracé (`ingredient_stock_zone_transfers`) — c'est le modèle réserve/picking de SAP WM et le double emplacement d'Odoo. Beaucoup d'outils internes se contentent d'un stock unique.
2. **Le workflow strict Option B** (mig 113) : le BSI n'alloue que depuis le pesage, une ligne « transfert requis » matérialise l'ouverture du contenant. La disponibilité théorique ne masque plus le geste physique.
3. **L'accusé de réception avec refus motivé** (`pret` → `chef-reject` avec motif tracé, retour en `preparation`) et le **prélèvement partiel avec reliquat** (`preparation_partielle` + `complete-pending`) : deux mécanismes que ni Odoo Community ni les verticaux boulangerie ne fournissent nativement.

En face, un écart structurel domine tous les autres :

**Le module s'appelle Pesage mais ne pèse rien.** `actual_quantity` n'est jamais une mesure : le bouton « Tout conforme » écrit `actual = allocated` sur toutes les lignes ([BonSortiePanel.tsx:242](../client/src/features/production/BonSortiePanel.tsx#L242)), et `startPrelevement` puis `verify` complètent automatiquement tout ce qui reste ([bon-sortie.repository.ts:687](../server/src/repositories/bon-sortie.repository.ts#L687), [:1148](../server/src/repositories/bon-sortie.repository.ts#L1148)). En base : **19 lignes, 7 avec `actual_quantity`, 0 écart** — `ecart_quantity` est nul partout. Tout l'aval (coût réel, rendement, écart mix/prix de l'audit A10) se calcule donc sur des quantités théoriques, avec une précision qui n'est qu'apparente.

Deux autres écarts de fond : **le garde-fou DLC est inerte** (aucun code ne passe un `ingredient_lot` en `expired`, donc tous les contrôles qui en dépendent sont morts) et **il n'existe aucun retour Pesage → Économat** (13 transferts en base, 13 dans le même sens) — un sac de 25 kg ouvert pour 3 kg laisse 22 kg au pesage pour toujours, sans possibilité de retour ni de sortie pour casse.

Points forts à préserver : idempotence explicite de `verify`/`close`, garde anti-doublon avec `FOR UPDATE` sur le plan à la génération, calcul du stock **libre** (déduction des réservations du même BSI) dans `findByPlan`/`findById`, ré-allocation idempotente dans `completePending`, notifications non bloquantes (`notifySafe`), et une densité de commentaires métier qui explique les décisions plutôt que le code.

---

## 1. Rappel du modèle (ce qui existe)

| Brique | Table / colonne | Migration | Équivalent marché |
|---|---|---|---|
| Zone réserve / zone de prélèvement | `ingredient_lots.economat_quantity` / `pesage_quantity` | 111 | Réserve + emplacement de picking (SAP WM, Odoo 2 emplacements) |
| Cohérence des deux zones | trigger `sync_quantity_remaining` | 111 | — |
| Transfert de zone tracé | `ingredient_stock_zone_transfers` (lot, qté, contenants, BSI, plan, auteur) | 113 | Réapprovisionnement de zone (replenishment) |
| Ordre de prélèvement | `production_bons_sortie` + `_lignes` | 084 | Bon de préparation / picking list |
| Source de la ligne | `source_location` ∈ PESAGE / ECONOMAT_REQUIRES_TRANSFER / RUPTURE | 113 | Statut de ligne de picking |
| Lot suggéré pour l'ouverture | `suggested_economat_lot_id` + `transfer_required_qty` | 113 | Proposition FEFO |
| Contenants | `ingredients.container_type_id`/`container_size`, `container_types` | 225, 226 | Unité de conditionnement |
| Traçabilité lot → ordre | `inventory_transactions.ingredient_lot_id` + `production_plan_id` | — | Lot genealogy |
| Cycle de vie | `genere → preparation [→ preparation_partielle] → pret → prelevement → verifie → cloture` (+ `annule`, + refus chef) | 084, 113 | Workflow de préparation avec accusé de réception |

Deux points de décrémentation du stock, tous deux déclenchés par l'acceptation du chef : `startPrelevement` ([:664](../server/src/repositories/bon-sortie.repository.ts#L664)) et, en rattrapage, `verify` ([:1092](../server/src/repositories/bon-sortie.repository.ts#L1092)). Les lignes emballage ne sont pas concernées : le stock emballage est consommé à la confirmation de production ([production.repository.ts:1022](../server/src/repositories/production.repository.ts#L1022)), pas par le BSI — cohérent, mais cela signifie que les lignes emballage du BSI sont purement indicatives et ne sont jamais réconciliées.

---

## 2. Constats

### Intégrité et sécurité alimentaire

**W1. Le garde-fou DLC ne s'est jamais déclenché et ne peut pas se déclencher.** Aucune ligne de code ne passe un `ingredient_lots.status` à `'expired'` — la recherche ne trouve ce `SET` que sur `product_lots` ([product-lot.repository.ts:595](../server/src/repositories/product-lot.repository.ts#L595), `:633`, `:722`), il n'y a ni job planifié ni `node-cron` dans le serveur. Tout ce qui dépend de ce statut est donc mort :
- le blocage du prélèvement sur lot périmé ([bon-sortie.repository.ts:1070](../server/src/repositories/bon-sortie.repository.ts#L1070)) ne se déclenche jamais ;
- `lot_expired` est calculé par `CASE WHEN il.status = 'expired'` ([:517](../server/src/repositories/bon-sortie.repository.ts#L517)) → toujours `false` → le badge « Lot expiré » ([BonSortiePanel.tsx:852](../client/src/features/production/BonSortiePanel.tsx#L852)) ne s'affiche jamais ;
- le FEFO alloue un lot dont la `expiration_date` est passée exactement comme un lot frais ([:84](../server/src/repositories/bon-sortie.repository.ts#L84)), la seule trace étant la mention « ⚠ DLC depassee » écrite dans `notes` ([:106](../server/src/repositories/bon-sortie.repository.ts#L106)) — champ qui n'est affiché nulle part dans le panneau.

Autrement dit : un ingrédient périmé part en production sans qu'aucun écran ne le signale. C'est le constat le plus grave de l'audit, et il est invisible parce que le code *donne l'impression* que le contrôle existe.
→ **Reco** : ne plus dépendre de `status`. Calculer l'expiration sur la date dans les trois endroits (`lot_expired`, FEFO, `updateLigne`) — `il.expiration_date < CURRENT_DATE`. Un job de nuit qui bascule le statut est utile en complément (pour les listings et l'alerte), mais il ne doit pas être le seul rempart.

**W2. Aucune pesée réelle n'est capturée** (voir Synthèse). Le bouton « Tout conforme » est le chemin nominal ; il vide de sens la distinction `allocated` / `actual` / `ecart`.
→ **Reco**, par ordre de coût croissant : (a) séparer « conforme » de « pesé » — le bouton global reste, mais une tolérance par ingrédient (ex. ±2 %) force la saisie au-delà ; (b) saisie du poids ligne à ligne sur les ingrédients à fort impact coût ; (c) balance connectée (série / HID / Bluetooth) — standard chez Cybake et FlexiBake, et seule façon d'avoir un écart fiable. Sans (a) au minimum, le chantier « coût réel » (A10) mesure du bruit.
→ **Étape 1 livrée le 16/08/2026** (mig 270) : bande de tolérance symétrique par ingrédient (`fn_weighing_tolerance` = MAX(pct × cible, plancher absolu), défauts par catégorie), saisie du poids réel obligatoire, motif exigé hors bande, mesure tracée (`weighed_at/by`, `weighing_source`, `tolerance_applied` figée). Les complétions système (`verify`, `startPrelevement`) sont marquées `weighing_source='auto'` pour ne jamais être confondues avec une mesure. Reste : la balance connectée (étape 2, WebSerial sur le poste de pesée).

**W3. Aucun retour Pesage → Économat, aucune sortie pour casse.** `ingredient_stock_zone_transfers` n'est écrit que par `transferLineFromEconomat` avec `from_zone='ECONOMAT'` ([:964](../server/src/repositories/bon-sortie.repository.ts#L964)) ; en base, 13 transferts, tous dans ce sens, et `container_count` renseigné une seule fois sur 13. La table supporte pourtant les deux sens (`CHECK (from_zone <> to_zone)`). Conséquences : le reliquat d'un contenant ouvert reste indéfiniment au pesage (correct comptablement, faux physiquement dès qu'on remet le sac en réserve), et une perte au pesage (renversement, contamination) n'a aucun moyen d'être enregistrée — elle se retrouvera dans l'écart d'inventaire physique mensuel sans explication.
→ **Reco** : deux actions sur l'onglet *Stock pesage* — « Retour économat » (`from_zone='PESAGE'`) et « Perte / casse » (`inventory_transactions` typé `waste` + décrément pesage), toutes deux avec motif obligatoire.

**W4. La numérotation BSI peut violer sa propre contrainte d'unicité.** Le numéro est calculé par `SELECT COUNT(*) ... WHERE numero LIKE 'BSI-YYMMDD-%'` puis inséré ([:50-56](../server/src/repositories/bon-sortie.repository.ts#L50)), dans une transaction qui ne verrouille que la ligne du **plan** concerné. Deux plans confirmés simultanément comptent la même valeur et tentent le même numéro, alors que `numero` est `NOT NULL UNIQUE` (mig 084). Le scénario est réaliste : la génération est automatique à la confirmation du plan ([production.repository.ts:461](../server/src/repositories/production.repository.ts#L461)), donc deux chefs qui confirment leur plan le même matin. Le chef reçoit un 500.
→ **Reco** : séquence Postgres par jour, ou `INSERT ... ON CONFLICT (numero) DO NOTHING` avec retry incrémental, ou `pg_advisory_xact_lock(hashtext(dateStr))`. (C'est le motif `SELECT MAX(num)+1` vs `SEQUENCE` classique en PL/SQL — mêmes causes, mêmes effets.)

**W5. `verify()` décrémente du stock hors transaction.** La méthode boucle en `db.query` : `UPDATE ingredient_lots` puis `INSERT inventory_transactions` par ligne, sans `BEGIN`/`COMMIT` ([:1092-1166](../server/src/repositories/bon-sortie.repository.ts#L1092)). Une erreur au milieu de la boucle laisse une partie du stock consommée, une partie non, et le BSI non vérifié. `startPrelevement` fait rigoureusement la même chose **correctement**, dans une transaction ([:664](../server/src/repositories/bon-sortie.repository.ts#L664)) : les deux chemins devraient être identiques.
→ **Reco** : aligner `verify` sur `startPrelevement` (`db.getClient()` + BEGIN/COMMIT/ROLLBACK).

**W6. Pas de contrôle d'appartenance au magasin sur les endpoints par id.** `bon-sortie.routes.ts` n'utilise ni `requireStoreContext` ni `checkStoreOwnership`, qui existent pourtant ([tenant.middleware.ts](../server/src/middleware/tenant.middleware.ts)). Sont concernés `GET /:id`, `PUT /:id/preparation`, `/:id/ready`, `/:id/cancel`, `PUT /ligne/:ligneId`, `POST /ligne/:ligneId/transfer-from-economat`. Un magasinier du magasin A peut agir sur un BSI du magasin B s'il en connaît l'UUID — et le transfert de zone, lui, déplace du stock réel. Les endpoints de liste (`queue`, `history`) sont correctement scopés, eux.
→ **Reco** : `AND bs.store_id = $n` dans les requêtes d'écriture, ou un middleware de scope sur le routeur.

### Traçabilité

**W7. Pas de substitution de lot depuis l'interface.** `handleEcart` ([:1571](../server/src/repositories/bon-sortie.repository.ts#L1571)), la route `PUT /:id/ecart/:ligneId` et le client `bonSortieApi.handleEcart` ([bon-sortie.api.ts:68](../client/src/api/bon-sortie.api.ts#L68)) existent — **aucun composant ne les appelle**. Si le lot proposé par le FEFO n'est pas celui que le magasinier attrape physiquement (sac déplacé, lot terminé, étiquette illisible), il n'a aucun moyen de le dire : il confirme la ligne, et la généalogie lot → plan de production enregistrée dans `inventory_transactions` devient fausse. C'est ce qui contredit le plus directement l'exigence de traçabilité produit du projet : la donnée existe, elle est simplement fausse dès que le terrain diverge du FEFO.
→ **Reco** : bouton « Autre lot » sur la ligne, alimenté par les lots pesage de l'ingrédient, branché sur l'endpoint existant.

**W8. Ni impression du bon, ni lecture code-barres.** La tournée de prélèvement se fait en lisant des numéros de lot à l'écran puis en cherchant le sac correspondant. Aucune impression du BSI (contrairement au plan de production, qui a son `PrintModeSelectorModal`), aucun scan lot/emplacement. Le scan RF est le standard WMS depuis vingt ans, précisément parce qu'il supprime l'erreur de lot que W7 ne permet même pas de corriger.
→ **Reco** : impression du bon en premier (coût faible, gain immédiat) ; le scan quand les étiquettes lot seront imprimées à la réception.

### Parcours et ergonomie du poste

**W9. Le cœur du travail sort du module.** Une ligne « Économat — à transférer » n'a aucune action en place : le panneau affiche une bannière et un lien vers `/inventory?tab=transfers` ([BonSortiePanel.tsx:498](../client/src/features/production/BonSortiePanel.tsx#L498)). Or l'API pour agir depuis la ligne est déjà écrite et complète — choix du lot (`GET /ligne/:ligneId/economat-lots`, tri FEFO, drapeau `is_suggested`), quantité surchargeable, nombre de contenants, motif, audit. Le magasinier doit donc : quitter le BSI → module Économat → transférer → revenir → « Re-vérifier dispo ». Même chose pour les ruptures (`/inventory?tab=ruptures`).
→ **Reco** : modale de transfert inline sur la ligne (le composant existe déjà côté Économat, `TransferRequestsList.tsx`) ; garder le lien Économat pour le traitement en masse multi-BSI.

**W10. Détails de terrain qui coûtent cher sur tablette.**
- ~~« Tout conforme » enchaîne N appels HTTP **séquentiels**~~ : **corrigé le 16/08/2026** — `PUT /bons-sortie/:id/peser` enregistre toutes les pesées en une transaction, tout ou rien, avec le nom de l'ingrédient fautif en cas de refus.
- Cibles tactiles sous le seuil : boutons de ligne en `p-2` (~32 px, recommandation 44 px), libellés en `text-[10px]` / `text-[11px]` — en économat, avec les mains farinées.
- `Column` est défini dans le corps de `WarehousePage` ([WarehousePage.tsx:119](../client/src/features/warehouse/WarehousePage.tsx#L119)) : à chaque rendu (polling 15 s) c'est un nouveau type de composant, donc toutes les cartes sont démontées/remontées.
→ **Reco** : endpoint `PUT /:id/lignes/bulk-confirm` transactionnel ; cibles 44 px et typo ≥ 12 px sur le flux magasinier ; extraire `Column`.

**W11. La notification d'arrivée d'un BSI n'est pas cliquable.** Le contrôleur émet `referenceType: 'bon_sortie'` ([bon-sortie.controller.ts:51](../server/src/controllers/bon-sortie.controller.ts#L51)), mais `NotificationBell` ne route que `production_plan`, `replenishment_request` et `order` ([NotificationBell.tsx:95](../client/src/components/layout/NotificationBell.tsx#L95)). À noter pour l'implémentation : `referenceId` porte l'id du **BSI** alors que la route attend un **plan** (`/warehouse/bsi/:planId`).

### Pilotage et dette

**W12. Aucun indicateur du poste.** Tous les horodatages sont là (`generated_at`, `preparation_at`, `ready_at`, `prelevement_at`, `closed_at`, plus `chef_reject_at`), aucun n'est exploité : pas de délai moyen demande → prêt, pas de volume par magasinier, pas de taux de rupture par ingrédient, pas de vieillissement des contenants ouverts (l'onglet *Stock pesage* trie par DLC mais n'alerte pas sur « ouvert depuis 20 jours »). Détail visible : le badge de l'onglet Historique affiche 0 tant qu'on n'a pas cliqué dessus, la requête étant `enabled: tab === 'history'` ([WarehousePage.tsx:69](../client/src/features/warehouse/WarehousePage.tsx#L69)).

**W13. Divergence code / migrations sur `effective_expiry_after_opening`.** `findPesageStock` lit cette colonne trois fois ([ingredient-lot.repository.ts:124](../server/src/repositories/ingredient-lot.repository.ts#L124), `:134`, `:136`) et le client la lit aussi ([WarehousePage.tsx:550](../client/src/features/warehouse/WarehousePage.tsx#L550)) — or la migration 112 la supprime, et rien ne la recrée. La base locale l'a encore (elle provient d'une copie prod antérieure au drop, bien que `_migrations` marque 112 comme jouée) : l'onglet fonctionne ici, mais **une base reconstruite depuis `server/migrations/` renverra `column does not exist` sur tout l'onglet Stock pesage**. À vérifier en priorité sur la base de production.
→ **Reco** : retirer la colonne des requêtes (le `COALESCE` retombe naturellement sur `expiration_date`), ou la réintroduire par migration si la DLC post-ouverture revient au programme.

**W14. La saisie par contenant est branchée mais inutilisée** : 1 transfert sur 13 renseigne `container_count` (mig 225/226). Soit le champ est trop discret dans la modale, soit `container_type_id` n'est pas renseigné sur les ingrédients concernés. À trancher avant d'investir davantage sur cette brique.

**W16. Les lignes emballage du BSI sont invisibles à l'écran.** `generate` crée des lignes packaging avec `ingredient_id = NULL` ([bon-sortie.repository.ts:250](../server/src/repositories/bon-sortie.repository.ts#L250)), mais les deux requêtes de lecture font un `JOIN ingredients ing ON ing.id = bsl.ingredient_id` **inner** — ces lignes ne sortent jamais de la base. Le compteur « N lignes » de la file magasinier, lui, compte toutes les lignes : la carte annonce 12 lignes et le panneau en affiche 9, sans explication. Constat découvert en implémentant l'étape 1 du pesage.
→ **Reco** : `LEFT JOIN` + affichage d'une section emballages, ou exclusion explicite du compteur. Rappel : le stock emballage est décrémenté à la confirmation de production, pas par le BSI — ces lignes sont donc informatives, ce qui mérite d'être écrit à l'écran.

**W15. Zéro test sur le workflow BSI.** `server/src/__tests__/` contient `recipe-composition`, `smoke`, `tva`, `units-densite`. Le BSI est le module qui a le plus d'états (huit statuts, plus le refus chef et le partiel), le seul qui décrémente du stock depuis deux méthodes différentes, et celui dont les régressions sont les plus difficiles à voir (elles se manifestent en écart d'inventaire un mois plus tard).
→ **Reco** : tests d'intégration sur les transitions et surtout sur l'**invariant de conservation** : `Σ inventory_transactions` d'un BSI = `Σ actual_quantity` de ses lignes, et `pesage_quantity` avant − après = même somme.

---

## 3. Tableau de correspondance marché

| Concept | SAP EWM/WM | Odoo Inventory | Sage X3 | Verticaux boulangerie | **Ofauria** |
|---|---|---|---|---|---|
| Bon de prélèvement généré depuis l'OF | Oui | Oui | Oui | Oui | **Oui** (auto au confirm) |
| Zones réserve / picking + réappro de zone | Oui | Oui (2 emplacements) | Oui | Rare | **Oui** (mig 111/113) |
| Affectation FEFO automatique | Oui | Oui (removal strategy) | Oui | Variable | **Oui** |
| Blocage lot périmé | Oui (statut qualité) | Oui | Oui | Oui | **Non effectif** (W1) |
| Confirmation par pesée réelle / poids variable | Oui (catch weight) | Partiel | Oui | Oui (balance connectée) | **Non** (W2) |
| Substitution de lot au prélèvement | Oui | Oui | Oui | Oui | **API oui, UI non** (W7) |
| Retour de reliquat en réserve | Oui | Oui | Oui | Oui | **Non** (W3) |
| Sortie pour casse / perte en zone | Oui | Oui (scrap) | Oui | Oui | **Non** (W3) |
| Scan code-barres / RF | Standard | Oui | Oui | Oui | **Non** (W8) |
| Prélèvement partiel + reliquat | Oui (backorder) | Oui | Oui | Rare | **Oui** (`preparation_partielle`) |
| Accusé de réception avec refus motivé | Selon config | Non natif | Oui | Non | **Oui** |
| Traçabilité lot → ordre de fabrication | Oui | Oui | Oui | Oui | **Oui**, mais fragile (W7) |
| Indicateurs de poste (délai, productivité) | Oui | Basique | Oui | Oui | **Non** (W12) |

---

## 4. Recommandations priorisées

**P0 — sécurité alimentaire et intégrité des chiffres**
1. **W1** : expiration calculée sur `expiration_date` dans `lot_expired`, le FEFO et `updateLigne`. Un lot périmé doit être visible et bloquant.
2. ~~**W2** (première marche)~~ — **fait le 16/08/2026** (mig 270). Reste l'étape 2 : balance connectée.
3. **W5** : `verify()` dans une transaction, comme `startPrelevement`.
4. **W13** : vérifier `effective_expiry_after_opening` en production, puis retirer la colonne du code ou la remettre par migration.

**P1 — fiabilité du geste et conformité**
5. **W7** : substitution de lot en UI (endpoint déjà écrit).
6. **W3** : retour Économat + sortie casse depuis l'onglet Stock pesage.
7. **W9** : transfert Économat → Pesage directement sur la ligne du BSI (endpoint déjà écrit).
8. **W6** : contrôle d'appartenance au magasin sur les endpoints par id.
9. **W4** : numérotation BSI par séquence ou advisory lock.
10. **W10** : endpoint bulk-confirm transactionnel + cibles tactiles 44 px.

**P2 — finitions et outillage**
11. **W15** : tests d'intégration sur les transitions et l'invariant de conservation du stock.
12. **W8** : impression du bon de prélèvement.
13. **W11** : routage de la notification `bon_sortie`.
14. **W12** : indicateurs de poste (délai demande → prêt, ruptures récurrentes, contenants ouverts vieillissants) — les horodatages existent déjà.
15. **W14** : trancher sur la saisie par contenant (la rendre visible ou l'abandonner).
16. **W2** (suite) : balance connectée.

---

## 5. Conclusion

Le module a la bonne **anatomie** : deux zones physiques modélisées sur le lot, un ordre de prélèvement issu du plan, un FEFO, un accusé de réception avec refus motivé, un partiel avec reliquat. C'est plus que ce que fait Odoo Community, et l'Option B (mig 113) a résolu le vrai problème métier — ne plus confondre « il y en a en stock » avec « c'est prêt à peser ».

Ce qui manque tient en une phrase : **le système enregistre ce qui était prévu, pas ce qui s'est passé**. La quantité prélevée est recopiée depuis l'allocation, le lot réellement attrapé ne peut pas être corrigé, la DLC dépassée ne déclenche rien, le reliquat ne revient jamais, la casse n'a pas d'écriture. Chacun de ces trous est petit ; ensemble ils font qu'aucun chiffre sorti du pesage ne peut être opposé à un inventaire physique — et c'est exactement le symptôme déjà constaté ailleurs (dérive de `current_quantity`, écarts d'inventaire mensuel inexpliqués).

Bonne nouvelle : deux des corrections les plus utiles (substitution de lot, transfert depuis la ligne) sont du **câblage d'endpoints déjà écrits et testés côté serveur**. Le vrai investissement porte sur un seul point, W2 : décider que peser veut dire saisir un poids.

# Audit — Cycle de vie du produit (DLV / DDE / invendus / recyclage)

Date : 2026-07-16
Périmètre : onglet « Cycle de vie » du produit, moteur de lots, décisions invendus, recyclage, pertes.

---

## 1. Verdict global

Le **moteur backend est solide et bien plus abouti que l'UI ne le laisse penser** : double horloge DLC/DDE réellement calculée et appliquée (POS bloqué à la vente, clôture de caisse bloquée si périmés non traités), FEFO, traçabilité complète des lots, recyclage câblé jusqu'au stock ingrédient avec chaîne d'audit.

Les vrais problèmes sont :
1. **Le paramétrage produit (l'onglet audité) est incohérent et non validé** — c'est lui qui donne l'impression d'une conception bancale.
2. **Deux systèmes de suivi parallèles** (`product_lots` et `product_display_tracking`) qui divergent.
3. **Des chemins latéraux qui contournent les lots** (retours clients, destruction manuelle des périmés).
4. **Pas de scheduler** : l'expiration automatique est déclenchée « paresseusement ».

---

## 2. Comment ça fonctionne aujourd'hui

### Modèle de données

**`products`** (migrations 052 + 061) :

| Colonne | Rôle UI | Notes |
|---|---|---|
| `sale_type` | Type de vente (jour / dlv / commande) | `DEFAULT 'jour'`, **aucune contrainte CHECK** |
| `shelf_life_days` | DLV (jours, depuis production) | appelé « DLC » dans la couche lots |
| `display_life_hours` | DDE (heures, depuis transfert vitrine) | |
| `is_reexposable` | Toggle Re-exposable | |
| `is_recyclable` | Toggle Recyclable | |
| `recycle_ingredient_id` | Ingrédient cible (legacy, mono-cible) | remplacé par `product_recycle_destinations` (mig 106, multi-cibles + `yield_ratio` mig 116) |
| `max_reexpositions` | Plafond de re-expositions | `DEFAULT 0`, non éditable dans l'UI |

**`product_lots`** (mig 105) — le cœur du système :
- `lot_number` (séquence `LOT-YYYYMMDD-00001`), `produced_at`
- `expires_at` = produced_at + shelf_life_days (DLC)
- `first_displayed_at` / `display_expires_at` = première mise en vitrine + display_life_hours (DDE)
- compteurs `backroom/vitrine/sold/wasted/recycled_qty` avec trigger d'invariant (mig 106) : somme ≤ quantity_total
- statut `active/depleted/expired/disposed`, index FEFO

**`unsold_decisions`** (mig 062, élargie par mig 244) : une ligne par produit et par session de clôture, avec snapshot complet des paramètres cycle de vie au moment de la décision, destination suggérée vs finale, valorisation coût.

**`product_losses`** (migs 054/068/107) : pertes typées (`production/vitrine/perime/recyclage`) avec motifs détaillés (`dlc_expiree`, `dlv_expiree`, `invendu_fin_journee`, `ecart_inventaire`…) et liens de traçabilité.

### Cycle nominal

1. **Production validée** → `createFromProduction` crée le lot avec sa DLC (`product-lot.repository.ts:37`) — **uniquement si `shelf_life_days` est renseigné** (`production.repository.ts:794`).
2. **Transfert réserve → vitrine** (réception réappro, `replenishment.repository.ts:481-510`) → démarre l'horloge DDE au premier affichage.
3. **Vente POS** → `checkSaleability` (`product-lot.repository.ts:156`) refuse la vente (409 `DLV_EXPIREE`/`DDE_EXPIREE`) si `LEAST(expires_at, display_expires_at)` est dépassé ; consommation FEFO des lots.
4. **Expiration automatique** → `autoExpireDueLots` (`product-lot.repository.ts:657`) : DLC dépassée = tout le lot en perte ; DDE seule dépassée = seule la vitrine part en perte, la réserve reste vendable et l'horloge DDE est remise à zéro pour une future ré-exposition. Déclenchement **paresseux** : `maybeAutoExpire` (`product.controller.ts:15-28`), debounce 60 s, appelé au chargement de la liste produits. Aucun cron.
5. **Clôture de caisse** → bloquée (409 `EXPIRED_ITEMS_PENDING`) tant que des périmés vitrine ne sont pas détruits (`cash-register.controller.ts:99-118`).
6. **Décisions invendus** → `computeSuggestion` (`unsold-decision.repository.ts:13-123`) propose `reexpose / retour_stock / recycle / waste` selon type de vente, horloges, flags et compteur de re-expositions. `saveDecisions` applique les effets :
   - **recycle** : décrémente la vitrine, incrémente le stock ingrédient, **crée un lot ingrédient `REC-…`** avec DLC résiduelle et lien `source_product_lot_id` → traçabilité chapelure ← fournée d'origine complète ;
   - **waste** : perte valorisée ;
   - **retour_stock** : vitrine → réserve sans toucher la DLC ;
   - **reexpose** : incrémente `current_reexposition_count`.
7. **Écart d'inventaire physique** en fin de journée → perte `ecart_inventaire`.

### Migration 244 (en cours dans le working tree)

Les CHECK de `unsold_decisions` (mig 062) n'acceptaient que 3 destinations alors que le moteur suggère `retour_stock` depuis la mig 106 → l'INSERT violait la contrainte, **rollback du batch et clôture de caisse bloquée**. La mig 244 élargit les deux contraintes aux 4 valeurs. C'est un correctif de bug, à passer en prod impérativement.

---

## 3. Points forts

- Échéance effective **MIN(DLC, DDE) réellement appliquée** côté serveur (POS, clôture, auto-expiry) — pas juste un texte d'aide.
- **Traçabilité de bout en bout** : fournée → lot → vente/perte/recyclage → lot ingrédient recyclé. Conforme à l'exigence d'audit/normes du projet.
- Modèle DDE intelligent à l'expiration : seule la vitrine est perdue, la réserve survit, l'horloge repart à la ré-exposition.
- Clôture de caisse verrouillée tant que les périmés ne sont pas régularisés : discipline opérationnelle forcée.
- Détection de gaspillage récurrent (produit jeté ≥ 5 jours distincts/mois) déjà présente dans `stats` (`unsold-decision.repository.ts:673`) — signal de surproduction.

---

## 4. Problèmes constatés (par gravité)

### A. Paramétrage produit incohérent (la cause du « je ne suis pas convaincu »)

| # | Problème | Où |
|---|---|---|
| A1 | Le **type de vente ne pilote rien** : on peut saisir DLV/DDE sur un produit « Vente du jour » ou « Sur commande », et sauver un produit « DLV » sans DLV. Rien n'est masqué ni purgé au changement de type → les lignes contradictoires du catalogue (`JOUR + DLV 2j + DDE 24h`). | `ProductsPage.tsx:1190-1225` |
| A2 | **Aucune validation serveur** : pas de `product.validator.ts`, pas de CHECK sur `sale_type` (l'équivalent d'une table Oracle sans contrainte ni trigger BEFORE — tout passe). | `product.repository.ts:205-224`, mig 061 |
| A3 | **Toggle « Recyclable » inopérant depuis l'UI** : le bouton Recycler exige un ingrédient cible (`is_recyclable && recycle_ingredient_id`), mais **aucun écran produit ne permet de choisir l'ingrédient** (ni le `yield_ratio`). Le toggle est une promesse vide. | POS `POSPage.tsx:2818`, Unsold `UnsoldDecisionsPage.tsx:427` |
| A4 | `max_reexpositions` consommé partout mais **non éditable** ; et `0` (défaut DB) est silencieusement réinterprété comme `1` par le moteur quand `is_reexposable=true` → le snapshot d'audit peut enregistrer 0 alors que le moteur a utilisé 1. | `unsold-decision.repository.ts:22` |
| A5 | Badges catalogue contradictoires : deux badges distincts s'appellent tous deux « DLV » (`sale_type='dlv'` et `shelf_life_days`), et un produit peut cumuler JOUR + DLV nj + DDE nh. | `ProductsPage.tsx:472-498` |
| A6 | Étiquettes de production : le libellé du cycle est dérivé de `is_reexposable` **en ignorant `sale_type`** → un produit `sale_type='dlv'` non ré-exposable imprime « Vente du jour » sur son étiquette. Grave pour la traçabilité physique. | `PlanDetailPage.tsx:288,311` |
| A7 | Variable `hasDLV` dans le formulaire = en réalité `is_reexposable`. Piège pour tout futur développeur. | `ProductsPage.tsx:566` |

### B. Fiabilité du moteur

| # | Problème | Où |
|---|---|---|
| B1 | **Lot créé seulement si `shelf_life_days` est renseigné** : un produit sans DLV n'a ni lot, ni horloge DDE, ni FEFO, ni expiration → « stock orphelin » géré réactivement. Couplé à A1 (DLV non obligatoire), c'est un trou béant. | `production.repository.ts:794` |
| B2 | **Deux systèmes de suivi parallèles** : `product_lots` (mig 105) et `product_display_tracking` (mig 053, legacy) mis à jour séparément → dérive (« fantômes » mentionnés dans le code). Le moteur de suggestion lit encore la table legacy. | `unsold-decision.repository.ts:141+` |
| B3 | `destroyExpiredItems` (destruction manuelle des périmés) **ne met pas à jour `product_lots`** → un lot peut rester `active` avec `vitrine_qty>0` et réapparaître comme périmé. L'auto-expiry le fait correctement, pas le chemin manuel. | `unsold-decision.repository.ts:873` |
| B4 | **Les retours clients contournent les lots** : `return.repository.ts` ajuste `product_store_stock.vitrine_quantity` sans toucher `product_lots` → quantités sans lot ni DDE en vitrine. | `return.repository.ts` |
| B5 | **Pas de scheduler** : expiration déclenchée au chargement de la liste produits. Un magasin qui n'ouvre pas cet écran n'expire rien. (Équivalent Oracle : la logique existe mais le job `DBMS_SCHEDULER` n'a jamais été créé.) | `product.controller.ts:15-28` |
| B6 | Asymétrie POS / page Invendus : le POS offre 4 destinations (dont `retour_stock`), la page Invendus 3. Même décision métier, deux jeux d'options. | `POSPage.tsx:2808`, `UnsoldDecisionsPage.tsx:422` |

---

## 5. Améliorations proposées

### P1 — Rendre le paramétrage cohérent (quick wins, gros gain de confiance)

1. **Le type de vente devient le pilote du formulaire** :
   - `jour` : DLV masquée (implicite = jour même), DDE optionnelle ; section « fin de journée » (re-exposable / recyclable) mise en avant ;
   - `dlv` : **DLV obligatoire**, DDE optionnelle, re-exposable + max re-expositions visibles ;
   - `commande` : tout masqué (pas de stock vitrine = pas de cycle de vie).
   - Purger les champs non pertinents au changement de type.
2. **Validation serveur** : créer `product.validator.ts` + CHECK `sale_type IN ('jour','dlv','commande')` + règles croisées (DLV requise si type dlv, `is_recyclable` ⇒ au moins une destination de recyclage active).
3. **Compléter le toggle Recyclable** : quand activé, afficher la gestion des destinations (`product_recycle_destinations` : ingrédient + rendement) directement dans l'onglet. Sans ça, le toggle doit être retiré.
4. **Exposer `max_reexpositions`** sous le toggle Re-exposable (défaut affiché = 1, aligné avec le moteur) et corriger la réinterprétation silencieuse 0→1.
5. **Un seul badge de synthèse** au catalogue : `JOUR`, `DLV 3j (+DDE 48h)`, `CMD` — dérivé du type, jamais cumulatif contradictoire.
6. Corriger l'étiquette de production (A6) pour dériver le libellé de `sale_type`, et renommer `hasDLV` → `isReexposable`.

### P2 — Fiabiliser le moteur

7. **Créer un lot pour toute production**, y compris vente du jour (DLC = jour même, DDE = fin de journée par défaut). Supprime le stock orphelin et donne le FEFO/traçabilité à 100 % du catalogue — cohérent avec l'exigence de traçabilité du projet.
8. **Une seule source de vérité** : migrer ce que `computeSuggestion` lit encore dans `product_display_tracking` vers `product_lots`, puis geler/supprimer la table legacy.
9. **Boucher les fuites** : `destroyExpiredItems` et les retours clients doivent impacter `product_lots` (les retours peuvent recréditer le lot d'origine, connu via la vente).
10. **Vrai job planifié** (cron / scheduler applicatif) pour `autoExpireDueLots`, au lieu du déclenchement paresseux. Sur Cloud Run : Cloud Scheduler → endpoint dédié.
11. Unifier les destinations invendus POS / page Invendus (mêmes 4 options, même moteur).

### P3 — Valeur métier supplémentaire

12. **Alertes proactives DDE** : la couleur <4 h existe déjà au POS ; en faire un levier — notification à la vendeuse, voire suggestion de démarque (-30 % à H-2) pour vendre plutôt que jeter.
13. **Boucler sur la production** : la détection de gaspillage récurrent (`stats`) existe mais n'est qu'une requête. La pousser dans le module de planification : « BAGHRIR jeté 6 j/mois en moyenne 4 pcs → réduire le plan de 4 ».
14. **Tableau de bord pertes** : coût des pertes par produit / par motif (`dlc_expiree` vs `invendu_fin_journee` vs `ecart_inventaire`) — les données sont déjà toutes dans `product_losses`, valorisées.
15. À terme : DLC résiduelle sur l'étiquette de ré-exposition (le modèle « Cumulé » conserve la DLC d'origine, l'afficher évite les erreurs vendeuse).

---

## 6. Conformité terminologique (implémentée le 2026-07-18)

Les termes de l'app étaient des inventions maison ; deux entraient en collision avec des termes normalisés (réglementation UE INCO 1169/2011, Maroc loi 28-07/ONSSA) :
- **DLV** signifiait « Durée limite de vie » alors qu'en distribution DLV = Date Limite de *Vente* ; le standard pour la date sanitaire est **DLC** (déjà utilisé par la couche lots et le module achats).
- **« Recyclable »** évoque les déchets/emballages ; le terme normalisé pour la réincorporation en production est **rework / retraitement / valorisation**.
- **DDE** n'existe nulle part ; le concept standard est la *durée d'exposition* (« display life »).

Renommage appliqué (libellés UI uniquement, aucun changement de schéma ni de valeurs `sale_type`) :

| Ancien libellé | Nouveau libellé |
|---|---|
| DLV — Durée limite de vie (jours) | **DLC — Durée de vie (jours)** |
| DDE — Durée d'exposition vitrine (heures) | **Exposition max en vitrine (heures)** |
| Type de vente « DLV » | **« Multi-jours (DLC) »** |
| Re-exposable | **Remise en vente J+1** |
| Recyclable | **Valorisable en production** (rework) |
| Boutons/labels « Recycler » / « Recyclage » | **« Valoriser » / « Valorisation »** |
| Badges catalogue `DLV nj` / `+DDE nh` / `RE` / `REC` | **`DLC nj` / `+Expo nh` / `RV` / `VAL`** |
| Motifs « DLV (vitrine) dépassée » | **« Exposition vitrine dépassée »** |

Fichiers touchés : `ProductsPage.tsx`, `UnsoldDecisionsPage.tsx`, `POSPage.tsx`, `PlanDetailPage.tsx` (dont badges tableau désormais dérivés de `sale_type`, complément du P1.6), `ExpiredProductLotsBanner.tsx`. Les identifiants techniques (`sale_type='dlv'`, `dlv_expired`, colonnes DB, API) sont inchangés.

Reste ouvert (non implémenté, décision à prendre) : distinguer **DLC** (sanitaire, blocage vente) et **DDM/DLUO** (qualité, alerte seulement) via une colonne `expiry_kind` — aujourd'hui un biscuit sec « expiré » est traité aussi sévèrement qu'un entremets à la crème.

## 7. Ordre d'attaque suggéré

| Étape | Contenu | Effort |
|---|---|---|
| 1 | Mig 244 en prod + P1.1/P1.2 (formulaire piloté + validator + CHECK) | S |
| 2 | P1.3/P1.4 (recyclage configurable, max_reexpositions) | S |
| 3 | P1.5/P1.6 (badges, étiquette production) | S |
| 4 | P2.7 (lot systématique) puis P2.9 (fuites destroy/retours) | M |
| 5 | P2.8 (source unique de vérité) + P2.10 (scheduler) | M |
| 6 | P3 selon priorités métier | M/L |

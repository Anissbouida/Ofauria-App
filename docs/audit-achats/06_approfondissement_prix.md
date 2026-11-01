# Achats — Approfondissement du domaine PRIX (D1/D9)

> **Date :** 2026-10-30 · Mise à jour du domaine prix des fiches [ecarts/D1.md](ecarts/D1.md) (G-D1-07, G-D1-08) et [ecarts/D9.md](ecarts/D9.md) (C-D9-05), avec diagnostic **sur la base actuelle** (mig 403).
> **Pourquoi ce domaine :** c'est l'écart P0 le plus impactant encore ouvert — le prix d'achat pilote le **coût de toutes les recettes** et la **valorisation du stock**.

---

## 1. Ce qui a CHANGÉ depuis l'audit (mig 303 → 403)

L'audit de 2026-10-12 décrivait « `unit_cost` = dernier prix saisi, écrasé sans qualification ». **Deux évolutions importantes depuis :**

- ✅ **CMUP à la réception** (mig 335/336) — vérifié dans `reception-voucher.repository.ts:619-635` : `unit_cost` n'est plus écrasé par le dernier prix mais **moyenné** : `(stock_avant × ancien_coût + reçu × coût_reçu) / total`. C'est une vraie amélioration de la stabilité du coût.
- ✅ **Évaluation fournisseur** (mig 362) — table `supplier_score_snapshots` présente → **C-D9-06 (performance fournisseur) est fait**. L'audit le marquait « absent ».
- ✅ **Multi-devises** (mig 363/368) → **C-D4-15** couvert.

➡️ Le diagnostic « W-01 dernier prix » de l'audit est donc **en partie dépassé**. Mais le cœur du problème persiste (voir §2).

---

## 2. Ce qui RESTE — diagnostic sur données actuelles

| Constat (base actuelle, mig 403) | Chiffre | Capacité manquante |
|---|---|---|
| **Valorisation stock survalorisée** : coût réel des lots vs catalogue `unit_cost` | **122 161 vs 165 451 DH = +35 %** | C-D1-06 / hygiène |
| **Prix à 0 / NULL** | **27 / 405 ingrédients** | hygiène (G-D1-19) |
| **Multi-sourcing** (articles chez ≥ 2 fournisseurs dans les BC) | **67 articles** | C-D1-05 (impossible avec un seul `unit_cost`) |
| **Volatilité** : variations successives du prix BC (même article × fournisseur) | **90 > 10 %, 29 > 50 %** (sur 333 paires) | C-D9-05 (pas d'alerte, pas d'historique) |

### Causes racines encore ouvertes

1. **Pas de fiche article × fournisseur ni de prix datés** (C-D1-05, G-D1-07/G-D1-08). Vérifié : **aucune table** `supplier_items` / `supplier_item_prices` / `ingredient_supplier_ref`. Le seul prix par fournisseur est `supplier_quotation_items.unit_price` (prix d'appel d'offres, non entretenu). Un article a 1 à 6 fournisseurs (67 cas) → un `unit_cost` unique est **structurellement incapable** de représenter « le prix du kg chez Ecomab » vs « chez OVOTEC ».
2. **Pas de double unité figée sur la ligne BC** (C-D1-06 / C-D4-03). `purchase_order_items` n'a ni unité, ni qté/contenant, ni prix par contenant. Le CMUP mélange donc des prix qui peuvent être exprimés dans des unités/conditionnements différents → d'où les sauts > 50 %.
3. **Pas d'historique ni d'alerte prix** (C-D9-05). Aucune vue/MV de prix, aucune alerte à la saisie du BC, aucune comparaison inter-fournisseurs.
4. **Le CMUP reste mono-dimension** : un seul coût par ingrédient, tous fournisseurs/unités confondus ; il lisse mais ne qualifie pas.

### Qui consomme ce prix (rayon d'impact)
`v_recipe_direct_cost` → **coût de toutes les recettes** + prix de vente conseillés ; **valorisation du stock** ; estimation des demandes d'achat ; prix par défaut de la ligne BC. Une erreur de prix se propage partout.

---

## 3. Cible (synthèse de l'audit G-D1-07 / G-D1-08, toujours valable)

### Modèle de données
```
supplier_items(id, supplier_id, purchasable_kind, purchasable_id,
               supplier_reference, container_type_id, qty_per_container,
               lead_time_days, moq, is_preferred, is_blocked, archived_at)
   UNIQUE(supplier_id, purchasable_kind, purchasable_id)

supplier_item_prices(id, supplier_item_id, price, currency, price_unit (base|container),
                     valid_from, valid_to, source (manual|quote|invoice|po),
                     source_doc_id, created_by, created_at)
   -- prix DATÉ ; le « prix courant » = celui dont [valid_from, valid_to] couvre aujourd'hui
```
- **Retirer** `ingredients.supplier_id` (mig 136, mono-valué, mort : 0 usage) au profit de la table pivot.
- Alimentation **automatique** d'une ligne `supplier_item_prices(source='invoice')` à chaque facture `posted` (vérité payée) et `source='po'` à chaque BC.
- Vue `v_current_supplier_price(purchasable, supplier)` + MV `mv_purchase_price_history(..., month, avg_base, min, max, qty)`.

### Flux prix clarifié
- `ingredients.unit_cost` **reste** le CMUP (coût de valorisation du stock) — ne pas y toucher.
- Le **prix d'achat** (devis, BC, alerte, comparaison) vient de `supplier_item_prices`, **par fournisseur et par unité**.
- La ligne BC fige `supplier_item_id` + unité + qté/contenant + prix/contenant (C-D4-03) → le CMUP reçoit un `effectiveCost` **toujours dans la bonne unité de base**.

### Alerte & pilotage (C-D9-05)
- À la saisie du BC : `price_variance_pct = (prix saisi − prix courant daté) / prix courant` ; seuil paramétrable → `warn`/`block` dans le StatusBanner.
- Fiche ingrédient : courbe MAD/kg dans le temps, par fournisseur ; min/max/dernier ; comparaison inter-fournisseurs.

---

## 4. Plan d'implémentation proposé (lots)

| Lot | Contenu | Prérequis | Effort |
|---|---|---|---|
| **P1** | **Fiche article × fournisseur** : table `supplier_items` + endpoints + onglet « Fournisseurs » (fiche ingrédient / packaging) remplaçant l'input texte `supplier` ; retrait de mig 136 | — | Moyen |
| **P2** | **Prix datés** : table `supplier_item_prices` + alimentation auto (facture `posted`, BC) + `v_current_supplier_price` ; prix par défaut de la ligne BC = prix courant du fournisseur | P1 | Moyen |
| **P3** | **Double unité sur la ligne BC** (`unit`, `qty_per_container`, prix/contenant, TVA/remise par ligne) + `effectiveCost` toujours en base | P1 | Moyen-Élevé |
| **P4** | **Historique + alerte** : `mv_purchase_price_history`, courbe sur la fiche ingrédient, `validatePOLine` (alerte écart prix à la saisie) | P2 | Moyen |
| **P5** | **Hygiène** : corriger les 27 prix à 0, enquêter l'écart valorisation +35 % (qté `inventory` vs Σ lots, prix catalogue vs lots) | — | Faible |

> **Ordre conseillé :** P1 → P2 d'abord (débloquent le multi-sourcing et le prix juste par fournisseur), puis P3 (fiabilise le CMUP), P4 (pilotage), P5 (nettoyage) en parallèle.

---

## 5. Vs ERPNext (domaine prix)
- ERPNext : `Item Supplier` (≈ `supplier_items`) + `Item Price` daté par liste de prix (≈ `supplier_item_prices`) + `Pricing Rule`. C'est exactement la cible ci-dessus.
- Ofauria a **déjà** le CMUP (valorisation) et l'évaluation fournisseur — il manque la **liste de prix fournisseur datée** et la **double unité sur la ligne d'achat**.

### Réserve
Diagnostic par SQL sur la base dev (copie de prod) + relecture ciblée du code. L'écart de valorisation +35 % est multi-causal (prix à 0, dérive qté `inventory` vs lots, base d'unité) et mérite une enquête dédiée (lot P5). Les fiches `ecarts/D1.md` / `D9.md` restent la référence capacité par capacité.

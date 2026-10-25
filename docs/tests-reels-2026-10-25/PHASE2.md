# Phase 2 — Simulation focalisée sur la vraie base (2026-10-25)

## Méthode
- **Base** : base de l'app `ofauria_db` (Docker, port 5433) — données réelles (1 magasin, 365 produits, 2014 ventes, 912 plans, 49 employés).
- **Isolation** : un **magasin de test dédié** par exécution (nommé `SIMULATION PHASE2 …`), avec ses propres ingrédients, produits/recettes et employés. Aucune donnée réelle n'est lue ni modifiée (le CMUP, la consommation de stock, etc. ne portent que sur les entités de test). Données **laissées en place** pour vérification (dernier magasin : `d363e8ea-ece5-4d95-b66e-1e8582ba9c5d`).
- **Pilotage** : via les repositories (même logique métier que celle appelée par l'UI), un parcours représentatif par domaine, chaque étape défensive et consignée.
- Script non committé (artefact d'exécution, ne tournait que sous `PHASE2_REAL=1`).

## Résultats par domaine
| Domaine | Parcours | Résultat |
|---|---|---|
| Achats | BC chiffré créé puis envoyé (plafond respecté) ; BC non chiffré refusé | OK |
| Production | plan → confirm → BSI → pesée → réception → production → lot | **CONSTAT F-085** |
| Ventes | ouverture caisse + vente comptant FEFO | CONSTAT (cascade de F-085) |
| Ventes | retour recréditant le lot d'origine | OK |
| Utilisateurs | garde WAREHOUSE (magasinier autorisé, caissier refusé) | OK |
| Personnel | contrôle de clé RIB (valide acceptée / invalide refusée) | OK |
| Personnel | avance sur salaire plafonnée (employé de test créé) | OK |

## Constat F-085 — P1 : migration 347 non appliquée à la base de l'app
- **Observé** : la confirmation d'un plan de production échoue avec `column "non_stocke" does not exist`.
- **Cause** : le code sur `main` (correctif F-016) interroge `ingredients.non_stocke` dans `production.repository.confirm()`, mais la **migration 347** (`ingredients.non_stocke`) **n'est pas appliquée** à `ofauria_db` (colonne absente, vérifié). Tout environnement qui exécute le code actuel sans avoir joué la 347 voit la confirmation de plan cassée.
- **Portée** : bloque toute la chaîne de production (pas de BSI, pas de lot) et, par cascade, la vente FEFO du produit fabriqué.
- **Correctif** : appliquer les migrations en attente sur la base (`347_ingredient_non_stocke.sql`, puis `348_sales_advance_order_catchup.sql`). La 348 est un no-op ici (les colonnes `sales.advance_amount/advance_date/order_id` existent déjà sur la base déployée — c'est précisément l'écart que la 348 documente, cf. F-084).
- **Leçon** : discipline de déploiement — le code qui dépend d'une migration ne doit pas précéder son application sur la base cible.

## Constat ventes (cascade)
La vente n'a pas décrémenté de lot FEFO **parce que** la production a échoué (F-085) : aucun lot produit n'existait à vendre. Ce n'est pas un défaut des ventes ; à retester une fois la 347 appliquée.

## Rappel — constats déjà corrigés pendant la campagne
- **F-083** (P1) : plafond d'approbation des BC contourné à l'envoi (montant jamais calculé) — corrigé.
- **F-084** (dérive de migrations) : colonnes `sales.advance_amount/advance_date/order_id` absentes des migrations du dépôt — migration de rattrapage 348 — corrigé.

## Suites automatisées (phase 1, sur base de test)
Vertes et committées : utilisateurs, achats, personnel, ventes (contrôleurs + base). Stock et production : brouillons inachevés (agents interrompus par la limite hebdomadaire), laissés en `.wip` à finir.

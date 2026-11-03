# L3 — Runbook de validation sur staging (réévaluation de stock sur écart de prix)

> Référence : `docs/AUDIT_P2P_GAP_ANALYSIS.md` (lot L3, incrément 3/5).
> But : **valider sur une copie de prod les montants** que la réévaluation déplacerait,
> **avant** de construire/activer l'incrément 3b (réévaluation réelle + écriture).
> Rien n'est écrit pendant cette validation.

## Pourquoi un dry-run obligatoire

L3 est le seul lot qui **déplace des montants comptables**. Quand la facture
fournisseur arrive à un prix différent du prix reçu (= du coût du lot), l'écart se
partage :

- part **encore en stock** → réévalue le lot et le CMUP (`amount_to_stock`) ;
- part **déjà consommée** → compte d'écart **IPV** 6xxx (`amount_to_variance`),
  car le consommé n'est pas réécrit (coût figé à la consommation, incrément 1/5).

On veut vérifier ces deux montants sur de vraies données avant toute écriture.

## Prérequis sur staging

1. **Copie de prod** (base + horloge), pas la prod elle-même.
2. **L1 déployé** sur cette copie : colonnes
   `invoice_items.reception_voucher_item_id` et
   `ingredient_lots.reception_voucher_item_id` présentes. Le script s'arrête avec
   un message clair si elles manquent.
3. Le script de validation est **autonome** : il crée sa fonction de simulation
   dans une transaction qu'il **annule** (`ROLLBACK`). Staging n'a donc **pas**
   besoin que la migration 446 soit appliquée, et il ne reste rien après.

## ⚠️ Piège confirmé en local : le lien réception↔facture

Sur la base locale, **366 factures reçues validées mais 0 portent le lien**
`reception_voucher_item_id`. La simulation ne voit que les factures **créées via
le flux pré-facture L1** (réception → brouillon lié → validée). Les factures
historiques (saisies avant L1, ou hors réception) ne remontent pas → `0 ligne`.

**Conséquence :** sur un staging fraîchement copié de prod, le dry-run affichera
probablement `lignes_a_reevaluer = 0`. **Ce n'est pas la preuve que la mécanique
est inerte** — c'est l'absence de confrontation réelle post-L1. Pour valider les
montants, il faut **au moins un cas de confrontation réelle** (voir ci-dessous).

## Étape 1 — Lancer le dry-run tel quel

```bash
PGPASSFILE=~/.pgpass psql -h <host> -p <port> -U <user> -d <staging_db> \
  -f server/scripts/l3-revaluation-staging-check.sql
```

Lecture des sorties :

- `factures_recues_validees` / `avec_lien_reception` : le périmètre réellement
  couvert. Si `avec_lien_reception = 0`, passez à l'étape 2.
- `lignes_a_reevaluer`, `total_vers_stock`, `total_vers_ecart_ipv` : l'impact
  global.
- tableau par fournisseur, puis les 200 lignes au plus gros impact.

## Étape 2 — Fabriquer un cas de confrontation (si 0 ligne)

Sur staging uniquement, exercez le flux réel pour obtenir au moins un écart :

1. Réceptionner un BC à un prix P (crée le lot au coût P + la pré-facture liée).
2. Consommer **une partie** du lot en production (pour tester le partage
   stock / consommé).
3. Valider la facture reçue à un prix **P′ ≠ P** (ex. +10 %).
4. Relancer le dry-run de l'étape 1.

Vérifiez alors manuellement le partage sur cette ligne :

- `unit_delta = P′ − P` ;
- `amount_to_stock = unit_delta × qty_remaining` ;
- `amount_to_variance = unit_delta × qty_basis − amount_to_stock`.

Exemple de contrôle (lot reçu 2000, coût 3,55, restant 450, consommé 1550,
facture +10 % → delta 0,355) : `amount_to_stock = 159,75`,
`amount_to_variance = 550,25`, nouveau coût lot ≈ 3,905.

## Étape 3 — Décision à prendre avant 3b

- [ ] Les montants `total_vers_stock` / `total_vers_ecart_ipv` sont cohérents avec
      les factures examinées.
- [ ] **Compte d'écart IPV** (6xxx CGNC) choisi **avec le comptable** — c'est le
      compte qui recevra `amount_to_variance`. 3b ne sera pas construit sans lui.
- [ ] Sens convenu : écart défavorable (P′ > P) → charge ; favorable → produit/
      atténuation. À cadrer avec le comptable en même temps que le compte.

## Ce que 3b fera (pour mémoire, non construit)

- `fn_stock_receipt` / réévaluation : mettre à jour `ingredient_lots.unit_cost` +
  CMUP de l'ingrédient pour la part en stock, écrire une ligne
  `stock_valuation_adjustments` (idempotente), et passer une écriture équilibrée
  stock / IPV via un profil de posting `price_variance` → compte IPV choisi.
- Gardé **désactivé par mode** jusqu'au feu vert, comme SoD (L2).

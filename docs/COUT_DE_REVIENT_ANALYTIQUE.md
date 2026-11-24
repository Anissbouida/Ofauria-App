# Coût de revient — moteur analytique (mig 655, 2026-11-23)

## Le défaut corrigé

Mode « charges mensuelles » (mig 527) : les charges du mois (loyer 22 000 + énergie 14 000 DH)
étaient réparties au prorata des matières des plans **déjà chiffrés** du mois. En novembre 2026,
293 plans, un seul chiffré (OF-2026-02427, 1 376 pains) : il recevait les 36 000 DH, revient
37 206 DH, soit 27 DH le pain vendu 3 DH.

Après correction (même plan, même base) : charges imputées 2 184 DH, revient complet 3 390,58 DH,
2,46 DH par pain, marge 27,9 % du prix HT.

## Principe (imputation rationnelle)

1. **Répartition primaire** — chaque charge du référentiel va à son centre, ou est éclatée par une
   clé en % (loyer : surfaces). Le coût employeur de chaque salarié (brut + charges patronales de la
   paie) va aux centres où il est affecté. Une charge **directe** vise un produit, sans centre.
2. **Répartition secondaire** — les centres auxiliaires (maintenance, qualité, logistique, direction,
   RH, finances, informatique) cèdent leur coût aux centres principaux : pourcentages, prorata de
   l'effectif ou de la masse salariale. Passes successives (prestations croisées).
3. **Coût de l'unité d'œuvre** = charges du centre ÷ **capacité normale** de son inducteur
   (unités, kg, heures MO, heures machine, lots, valeur des matières, valeur de vente HT). Capacité
   saisie, sinon moyenne des 3 derniers mois. Un plan reçoit coût de l'unité d'œuvre × ses unités
   d'œuvre : son coût ne dépend plus des autres plans chiffrés.
4. **Écarts de période** — sous-activité = charges fixes − charges fixes imputées ; écart sur budget
   = réel − budget flexible. Contrôle affiché : imputé + écarts = charges (0 attendu).

Mois en cours : charges, capacité et activité comptées à date (jours écoulés ÷ jours du mois) ;
les taux portent sur le mois entier.

## Classement des charges (deux axes indépendants)

| | Directe (un produit) | Indirecte (centre ou clé) |
|---|---|---|
| **Fixe** | machine dédiée → produit, sur sa quantité normale | loyer, assurance, direction |
| **Variable** | façon d'un produit | électricité des ateliers |
| **Semi-variable** | part fixe en % | énergie (30 % fixe par défaut) |

Matières, emballages, MO pointée, énergie des équipements, machine et façon restent mesurées au
réel sur le plan (inchangé). La MO pointée sort du centre de son salarié (pas de double compte) ;
le temps non pointé reste dans le centre et suit son inducteur.

## Niveaux de coût d'un plan

- Coût d'achat = matières + emballages + charges d'approvisionnement
- Coût de production direct = matières + emballages + MO + énergie + machine + façon + charges directes
- Coût de production complet = direct + approvisionnement + charges indirectes de production
  → `production_cout_reel.cout_production`, **valorise les lots de produits finis**
- Coût de revient complet = production complet + administration + distribution → `cout_total`
- Unitaire, prix de vente HT, marge, taux de marge (÷ coût), taux de marque (÷ prix) — au total et
  par article

## Méthodes comparées (onglet Coûts du plan)

Imputation rationnelle (retenue) · coûts complets réels à clé unique (unités) · ABC (chaque centre
sur son inducteur, activité réelle) · coûts variables · coûts directs · coûts standards (fiches).

## Où

- Migration : `server/migrations/655_comptabilite_analytique_couts.sql`
- Moteur : `server/src/services/cost-engine.ts` ; paramétrage : `analytic-cost.repository.ts`
- API : `/production-cout/analytique/*` (droit `production.production_cout.analytique`, gérant)
- Écrans : Production › Analyse des coûts (période, centres, charges, personnel, clés) ;
  onglet Coûts d'un plan (niveaux, charges par centre, marges par article, méthodes)
- Test : `server/src/__tests__/db/analytic-cost-engine.db.test.ts`

## Livré ensuite (2026-11-23, mig 656-660)

- **Coût prévu par format** (mig 656) : une ligne de plan sans format figeait coût de fournée ÷ 1 ;
  1 491 coûts prévus refigés.
- **Lot A — coût propre de chaque article** (mig 657) : matières de sa fiche rapprochées des
  consommations, charges selon ses propres unités d'œuvre ; lots valorisés au coût de production de
  l'article.
- **Lot B — temps standard des gammes** (mig 657) : heures MO et machine sans pointage ; MO directe
  au taux chargé moyen ; heures payées / imputées / non productives.
- **Lot C — clôture mensuelle** (mig 658) : taux figés, recalcul et saisie refusés, réouverture
  motivée, journal d'audit.
- **Lot D — réel comptable** (mig 659) : comptes de classe 6 par charge, rapprochement du mois.
- **Lot E — coût standard et prix conseillé** : mêmes charges que le réel ; écart réel / standard
  décomposé (prix, quantités, MO, charges, autres). Le panneau de la fiche technique a été
  retiré le 2026-11-24 (voir « Coûts standard des articles »).
- **Lot F — rentabilité** : marge par produit et famille sur les ventes réelles, seuil de
  rentabilité, sous-activité sur 12 mois, simulation volume / prix.
- **Amortissements et outillage** (mig 660) : registre des immobilisations (dotation du mois) et
  registre de l'outillage, vers un centre ou un produit dédié ; charges d'un plan détaillées par
  nature.
- **Semi-finis** : un lot de base vaut le coût de production de son plan ; le plan qui le consomme
  l'intègre à ses matières.

## Coûts standard des articles (2026-11-24, mig 661)

Le coût ne fait plus partie de la fiche technique, comme dans les ERP du marché : la nomenclature
et la gamme disent quoi et comment, le calcul du coût standard dit combien.

- **Fiche technique** : quantités, rendement, poids, perte, allergènes, mode opératoire. Plus de
  coût, de prix, de marge, de frais indirects ni de multiplicateur (ni sur la fiche, ni dans la
  liste des fiches). Le gérant y voit seulement un lien « Voir le coût standard ».
- **Production › Rapports › Coûts standard** (`/production/couts-standard`) : tous les articles,
  calculés avec `standardCost` (mêmes charges que le coût réel), situation « calculé, à valider »,
  « validé » ou « à recalculer » (fiche modifiée depuis la validation, ou écart de plus de 0,5 %).
- **Coût standard d'un article** (`/production/couts-standard/:recipeId`) : du coût matière au
  coût de revient poste par poste, par pièce ou par fournée ; détail des matières (nomenclature
  dépliée, ramenée au total du moteur) ; prix conseillé en simulation ; validation.
- **Validation** (`standard_costs`) : le calcul du jour est figé (snapshot) et devient le coût de
  référence ; l'ancien passe « remplacé » et reste dans l'historique. Journal d'audit branché.
- **Droits** : liste, détail et validation demandent `production.production_cout.analytique`
  (gérant, administrateur) — le labo ne voit ni coût ni marge.
- Les champs `taux_main_oeuvre_dh_h`, `cout_energie_fournee`, `taux_frais_structure_pct` et
  `margin_multiplier` des fiches ne sont plus saisis ; les colonnes restent pour l'historique et le
  mode de calcul forfaitaire.

## Pas encore couvert

- Données à saisir par l'entreprise : montants des charges, surfaces, capacités, affectation du
  personnel, immobilisations, outillage, gammes, poids des pièces, codes TVA des produits.
- Produits vendus au poids sans poids de pièce (cornes de gazelle) : marge non calculée.
- Compléments du lot G (inducteurs « commandes », « énergie mesurée », budgets annuels par centre,
  choix de la méthode enregistrée).

Suite du chantier : [PLAN_ACTION_COUT_DE_REVIENT.md](PLAN_ACTION_COUT_DE_REVIENT.md).

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

## Pas encore couvert

- Montants réels repris automatiquement du grand livre (classe 6 ventilée par centre, mig 428) :
  aujourd'hui saisis par mois dans l'onglet Charges.
- Inducteurs « nombre de commandes », « surface », « consommation énergétique mesurée » au niveau
  du plan ; budgets annuels par centre.
- Coût par article au sein d'un plan : réparti selon la clé du plan (poids, quantité, valeur), pas
  encore par inducteur de chaque centre.

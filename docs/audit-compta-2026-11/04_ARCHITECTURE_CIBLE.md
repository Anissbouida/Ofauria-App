# Architecture cible et catalogue des règles paramétrables

Date : 24 novembre 2026. Livrables 5 (architecture fonctionnelle et technique cible) et 6 (catalogue des règles comptables paramétrables).

Statut : **proposition à valider**. Rien de ce document n'est implémenté.

## 1. Principe : améliorer, pas refondre

Le grand livre (tables, triggers, chaîne, numérotation, extourne) est sain et reste tel quel. Ce qui change est en amont : la façon dont un événement métier devient une écriture.

Aujourd'hui, chaque module appelle une fonction du générateur qui contient à la fois le schéma et les numéros de comptes. Neuf endroits insèrent des écritures avec des règles différentes.

Demain, chaque module publie un **événement comptable** ; un seul moteur le transforme en écriture à partir de **règles en table**.

## 2. Vue d'ensemble

```
Modules métier (ventes, achats, caisse, stock, production, paie, immobilisations, trésorerie)
        │  publient, dans la transaction du document
        ▼
┌─ Événements comptables ─────────────────────────────────────────────┐
│ type, date, société, établissement, tiers, montants par nature,      │
│ lignes (article, catégorie, code de taxe, axes), pièce d'origine     │
└──────────────────────────────────────────────────────────────────────┘
        ▼
┌─ Moteur fiscal ─────┐   ┌─ Moteur de règles ──────────────────────────┐
│ taxe applicable,    │──▶│ schéma d'écriture + comptes, par critères,   │
│ exigibilité, régime │   │ priorité, dates de validité, version         │
└─────────────────────┘   └──────────────────────────────────────────────┘
        ▼
┌─ Moteur comptable ──┐   ┌─ Moteur de validation ───────────────────────┐
│ construit les       │──▶│ équilibre, période, compte actif, tiers,      │
│ lignes, arrondit    │   │ analytique obligatoire, seuils, approbation   │
└─────────────────────┘   └──────────────────────────────────────────────┘
        ▼
Grand livre (inchangé) ──▶ Moteur analytique ──▶ Moteur de reporting (états, liasse, EDI)
```

| Moteur | Responsabilité | Existant réutilisé |
|---|---|---|
| Événements | Décrire le fait métier, sans compte ni journal | Les modèles d'entrée du générateur |
| Fiscal | Code de taxe, taux à la date, compte de taxe, exigibilité (débit ou encaissement), retenues | `tax_codes` (datée), `withholding_tax_types`, `fiscal_thresholds` |
| Règles | Choisir le schéma et les comptes | `posting_profiles`, `family_revenue_accounts`, catégories → comptes |
| Comptable | Construire, arrondir, numéroter, écrire, extourner | `persistEntry`, `reverseEntriesForSource` |
| Validation | Refuser ou mettre en attente d'approbation | Triggers, `approval_rules`, `sod_document_rules` |
| Analytique | Ventiler les lignes, clés de répartition | `journal_line_analytics`, `analytic_keys` |
| Reporting | États, liasse, déclarations | `ledger.repository`, `liasse.rules`, `dgi-edi.service` |

## 3. Modèle de données proposé

Quatre tables nouvelles. Aucune table existante n'est modifiée de façon destructive.

### `accounting_events`

Remplace `ledger_outbox`. Un événement est écrit **dans la transaction du document**, toujours ; l'écriture comptable est produite dans la même transaction quand elle réussit, et sinon l'événement reste en attente avec son erreur.

| Colonne | Rôle |
|---|---|
| `event_type` | `sale.posted`, `purchase.invoice.posted`, `payment.out`, `payroll.slip.validated`… |
| `source_table`, `source_id` | Pièce d'origine (lien retour) |
| `legal_entity_id`, `store_id` | Société et établissement |
| `event_date`, `payload` | Date et contenu (montants, lignes) |
| `status` | `pending`, `posted`, `failed`, `ignored` |
| `entry_id`, `rule_version_id`, `attempts`, `last_error` | Résultat, règle appliquée, rejeu |

Bénéfices directs : toute pièce a un événement (plus de pièce « sans rien »), le rejeu est générique, et chaque écriture sait quelle règle l'a produite.

### `posting_rule_sets` et `posting_rules`

| Colonne | Rôle |
|---|---|
| `rule_set` : `code`, `version`, `status` (`draft`, `simulated`, `approved`, `active`, `retired`), `valid_from`, `valid_to`, `approved_by` | Un jeu de règles versionné, avec son circuit de validation |
| `event_type`, `line_role` | À quelle ligne du schéma la règle répond (`revenue`, `tax_collected`, `receivable`, `cash`, `expense`, `stock`, `discount`…) |
| Critères, tous facultatifs : `legal_entity_id`, `store_id`, `sector`, `product_category_id`, `product_id`, `partner_group`, `partner_id`, `payment_mode`, `tax_regime`, `cost_center_id`, `project_id`, `fiscal_year` | Une règle sans critère est la règle par défaut |
| `priority` | Départage explicite |
| `account_code`, `journal_code`, `analytic_default` | Résultat |
| `condition` | Condition de déclenchement simple (montant, signe) |

Résolution : parmi les règles actives à la date de l'événement, on retient celles dont tous les critères renseignés correspondent, puis la plus spécifique (plus de critères), puis la plus prioritaire. Deux règles à égalité = **conflit**, détecté à l'enregistrement du jeu et refusé.

### `posting_schemas`

Un schéma décrit la forme de l'écriture d'un événement : la liste ordonnée de ses rôles de ligne, leur sens et la formule du montant (`ht`, `tva`, `ttc`, `remise`…). Les schémas réglementaires sont livrés et verrouillés ; un profil peut en ajouter, pas retirer les lignes obligatoires.

### Ce qui garantit l'intégrité du passé

- Une règle n'agit que sur les événements à venir. Les écritures validées ne sont jamais recalculées.
- Chaque écriture porte l'identifiant de la version de règle qui l'a produite.
- Rejouer un événement d'un exercice clos est refusé.
- Un jeu de règles ne s'active qu'après simulation et approbation par un second utilisateur.

## 4. Simulation et comparaison

Avant d'activer un jeu de règles : rejouer en mémoire les événements d'une période choisie avec le jeu en projet, et comparer à l'existant.

Sortie : nombre d'écritures identiques, différentes, en échec ; écart par compte ; liste des événements dont l'imputation change. Rien n'est écrit au grand livre.

C'est aussi l'outil de non-régression de la migration (section 7).

## 5. Catalogue des règles paramétrables

| Domaine | Aujourd'hui | Cible | Verrou réglementaire |
|---|---|---|---|
| Plan comptable | Une table, un plan par base, éditable | Un plan par société, modèles par pays et secteur | Classes et comptes de synthèse du PCGE non supprimables |
| Journaux | 6 journaux, 5 types, sans écran | Création libre, plusieurs banques et caisses, journal par établissement | Journal des à-nouveaux réservé |
| Schémas d'écritures | En code | `posting_schemas` | Lignes obligatoires non retirables |
| Comptes généraux et auxiliaires | ~60 en dur | `posting_rules` | — |
| Règles d'imputation | Catégorie → compte | Critères, priorité, validité | — |
| Axes analytiques | Axes, sections, clés | + ventilation obligatoire par compte, valeurs par défaut par règle | — |
| Taxes | Taux datés ; comptes en dur | Comptes, exigibilité et caractère récupérable sur le code de taxe | Taux légaux datés, non modifiables rétroactivement |
| Régime fiscal | Paramètre global, défaut « débits » | Par société, daté, demandé à l'installation | Pas de défaut silencieux |
| Ventilation | Clés analytiques | Idem + prorata de TVA | — |
| Valorisation des stocks | En code (lot en cours) | Paramètre par société ; inventaire permanent ou intermittent explicite | Méthode constante sur l'exercice |
| Amortissement | Linéaire, dégressif ; durée par bien | Catégories avec durée, méthode, comptes, plafond fiscal | Coefficients légaux datés |
| Arrondi | `round2` en code | Mode et compte d'écart paramétrables | Centime |
| Déclenchement | En code, parfois sous politique | Par type d'événement : à la validation, au paiement, à la clôture | — |
| Date de comptabilisation | Date de pièce, redatée en silence | Politique par événement : refuser ou redater avec trace | Date d'origine conservée |
| Approbation | BC, campagnes de paiement, annulations | + OD, RIB, paiements unitaires, jeux de règles | Auto-approbation interdite |
| Seuils | Plafonds dormants | Seuils par type de pièce et par rôle, actifs à l'installation | — |
| Exceptions | Replis silencieux (6181, 7585, 5161) | Compte d'attente explicite et surveillé, ou refus | Aucun repli muet |
| Clôture | Checklist partielle | Checklist paramétrable ; contrôles réglementaires non désactivables | Équilibre, TVA, paie, file vide |
| Exercice | Civil, 12 mois | Dates libres, durée libre pour le premier | — |

## 6. Profils comptables et sectoriels

Un profil est un **paquet de données**, pas du code : plan comptable, jeu de règles, schémas additionnels, catégories d'immobilisations, contrôles de clôture, indicateurs, écrans visibles.

| Profil | Particularités comptables à livrer |
|---|---|
| Commerce et distribution | Ventes en 7111, achats de marchandises, variation de stock de marchandises |
| Boulangerie, pâtisserie, métiers de bouche | Ventes de biens produits, matières et emballages, produits finis à durée courte, TVA par famille de produits |
| Industrie agroalimentaire, manufacturière | En-cours, produits finis, coût de production, inventaire permanent |
| Restauration, hôtellerie | TVA par nature de prestation, pourboires, taxe de séjour |
| Services | Pas de stock ; produits constatés d'avance, travaux en cours |
| BTP | Avancement, retenues de garantie, situations de travaux |
| Import-export | Devises, frais d'approche, TVA à l'importation, exonérations à l'export |
| Groupe | Plusieurs sociétés, intragroupe, consolidation |
| Personnalisé | Copie d'un profil, puis modification |

L'héritage évite la duplication : un profil surcharge le socle national, une société surcharge son profil. L'existant (`industry-profile.ts`, `sector_pack`, `country-pack.ts`) fournit déjà l'ossature ; il lui manque le contenu comptable.

Les taux de TVA par nature et les règles sectorielles citées ici sont à établir avec un expert-comptable avant livraison de chaque profil.

## 7. Trajectoire de migration sans régression

1. **Résolveur.** Une fonction unique `resoudreCompte(événement, rôle)` remplace chaque numéro de compte en dur. Les règles par défaut sont semées avec les valeurs actuelles. Critère de fin : la simulation sur les 111 397 écritures de la base simulée donne 100 % d'écritures identiques.
2. **Événements.** `accounting_events` remplace `ledger_outbox` ; rejeu planifié.
3. **Un seul point d'écriture.** Les neuf insertions directes passent par le moteur.
4. **Schémas en table**, événement par événement, en commençant par les plus simples (paiements, puis ventes, achats, paie).
5. **Écrans** : règles, simulation, validation.
6. **Société** sur les règles, les journaux et les exercices (prérequis du multi-sociétés).

Chaque étape se termine par la même simulation de non-régression.

## 8. Retour arrière

Toute migration de schéma est additive (nouvelles tables, nouvelles colonnes nullables). Le résolveur garde un drapeau de repli sur les comptes en dur pendant une version. Aucune étape ne réécrit une écriture validée.

## 9. Multi-tenant

Le modèle actuel est une base par client. Les tables proposées portent `legal_entity_id`, ce qui prépare plusieurs sociétés dans une base sans imposer le choix d'architecture SaaS, qui relève de `docs/G6-03_MULTI_SOCIETE.md`.

## 10. Intelligence artificielle

Position : l'assistant **propose**, l'utilisateur valide, le moteur de validation contrôle. Aucune fonction d'IA n'écrit au grand livre.

| Fonction | Socle nécessaire | Contrôle |
|---|---|---|
| Extraction des factures fournisseurs | `docs/PLAN_OCR_FACTURATION.md` | Brouillon à valider ; rapprochement avec la commande et la réception |
| Proposition d'imputation | Historique des écritures par fournisseur et libellé | Affiche les pièces similaires qui la justifient |
| Détection d'écritures inhabituelles | Statistiques par compte et tiers | Signalement, jamais de blocage automatique |
| Doublons | Fournisseur, montant, date proches | Signalement |
| Rapprochement bancaire assisté | Moteur à 4 passes existant | Proposition avec score ; règle mémorisable |
| Prévision de trésorerie | `cash-forecast.ts` | Hypothèses visibles |
| Assistance à la clôture | Checklist | Explique chaque contrôle en échec et la correction |
| Questions en langage naturel | Sources de rapports figées (`rapports configurables`) | Requête affichée, lecture seule |

Ces fonctions viennent après les correctifs : un assistant bâti sur un grand livre sans TVA proposerait des erreurs avec assurance.

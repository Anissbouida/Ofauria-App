# Benchmark — Kalum face aux ERP comptables du marché marocain

Date : 24 novembre 2026. Livrable 3.

## 1. Fiabilité de ce benchmark

La colonne Kalum vient de l'audit du code (`01_RAPPORT_AUDIT.md`). Les colonnes concurrentes viennent d'une recherche documentaire dont la qualité varie :

| Marque | Sens |
|---|---|
| **[D]** | Documentation de l'éditeur lue |
| **[E]** | Extrait d'une page éditeur (page non lue en entier) |
| **[P]** | Presse ou tiers |
| **[M]** | Connaissance générale non revérifiée |
| **NT** | Non trouvé |

Les pages de sage.com et sap.com ont refusé la consultation automatique : pour Sage et SAP Business One, les cellules reposent sur des extraits, la presse et l'aide technique de SAP. Aucune localisation Maroc officielle n'a été trouvée pour SAP Business One, ni d'application partenaire précise pour Business Central. **Ce benchmark n'est donc pas « fondé sur des fonctionnalités vérifiées » pour ces éditeurs** : il faut une démonstration ou un accès partenaire pour le compléter.

Aucun score chiffré n'est donné : avec autant de cellules non vérifiées, une note serait une impression.

## 2. Matrice

| Critère | Kalum (audité) | Sage 100 Maroc | Sage FRP 1000 | Odoo Enterprise 19 | Business Central | SAP Business One |
|---|---|---|---|---|---|---|
| **Détermination des comptes** | Catégorie → compte avec héritage ; famille de produits → compte de vente ; ~60 comptes en dur ; table de profils à 9 événements réellement lus, sans critère ni date | NT | Profils de comptes, schémas d'écriture automatiques, écritures de simulation [E] | Positions fiscales : mappage taxes et comptes, détection automatique, priorité par séquence ; pas de date de validité documentée [D] | Matrice groupes comptables marché × produit, groupes TVA, groupes par client, fournisseur, stock, banque, immobilisation ; pas de date de validité [D] | Détermination avancée par groupe d'articles, article, magasin, groupe de tiers, pays, groupe TVA, champs libres ; dates de validité ; priorité réordonnable [D aide technique, P] |
| **Localisation Maroc** | Plan PCGE réduit (109 comptes), bilan, CPC, ESG, liasse normale et simplifiée, EDI Simpl-TVA / Simpl-IS / 9421, retenues à la source, CNSS ; tableau de financement et ETIC absents | EDI fiscal, liasse, télédéclaration TVA, module délais de paiement lancé en octobre 2023 [E, P] | Page produit Maroc ; contenu fiscal NT | Plan comptable, rapport de TVA et 2 positions fiscales natifs ; liasse, Simpl-TVA et retenues par modules tiers payants [D] | Aucune localisation Microsoft ; Maroc = partenaire [D] | NT |
| **Inaltérabilité** | Chaîne SHA-256 globale, toujours active, scellement automatique, gel des écritures validées ; contournable par le compte de connexion (C-08) | NT | « Conformité contrôle fiscal » [E] | Chaîne SHA-256 par journal, **optionnelle**, avec rapport de contrôle ; dates de verrouillage [D] | Journal des modifications du paramétrage [D] ; écritures non modifiables [M] | NT |
| **Séparation des tâches, approbations** | Règles en table, en mode avertissement par défaut ; pas d'approbation d'OD | NT | NT | Approbations [M] | Workflows d'approbation [M] | Procédures d'approbation [M] |
| **Analytique** | Axes, sections, clés, ventilation contrôlée ; coût de revient séparé ; pas de ventilation obligatoire | Analytique et budgétaire [E] | Axes, modèles de ventilation, déversements [P] | Plans et sous-plans, distribution en %, plan obligatoire ou optionnel [D] | Dimensions illimitées, combinaisons bloquées, priorités par défaut [D] | Centres de profit, dimensions [P] |
| **Budget** | Par compte et par mois, contrôle bloquant possible, engagé = commandes ; pas d'axe ni de révision | [E] | Budgétaire [P] | Budgets analytiques avec engagé ; dépassement signalé, **pas de blocage** [D] | Budgets, comptabilité des coûts [D] ; contrôle d'engagement NT | Budgets [D] |
| **Rapprochement bancaire** | Moteur à 4 passes, règles en table avec tolérances, import CSV / OFX / MT940 / CFONB ; pas de connexion bancaire | Manuel et automatique [E] | Module dédié [E] | Modèles de rapprochement ordonnés, synchronisation bancaire [D] ; banques marocaines non vérifiées | Rapprochement automatique + Copilot [D] | Relevés et rapprochements [P] |
| **Prévision de trésorerie** | 13 semaines, multi-sources | NT | NT | NT | Oui [D] | NT |
| **Immobilisations** | Linéaire, dégressif, cession ; pas de plafond véhicules ni de composants | Module existe [M] | Module, multi-normes [E] | Oui [D] | Oui [D] | Oui [P] |
| **Multi-devises** | Factures en devise, écarts réalisés, réévaluation de clôture ; pas de banque en devise | NT | NT | Oui [D] | Oui [D] | Oui |
| **Multi-sociétés, consolidation** | Un jeu de livres par base ; consolidation d'établissements | NT | Multi-plans [E] | Multi-sociétés et consolidation, plan Custom [D] | Intersociétés et consolidation [D] | Solution intersociétés [D blog] |
| **IA** | OCR de factures planifié (`docs/PLAN_OCR_FACTURATION.md`), rien en comptabilité | Assistant annoncé, disponibilité Maroc non confirmée [E, P] | NT | OCR + IA des factures fournisseurs [D] | Copilot pour le rapprochement, agents fournisseurs et notes de frais, SaaS seulement [D] | NT |
| **Intégration aux métiers** | Caisse, production, stock, paie, achats, ventes dans la même base, écriture dans la transaction du document | Suite modulaire | Suite | Suite intégrée | Suite intégrée | Suite intégrée |
| **Prix public** | — | Sur devis | Sur devis | 31,10 à 46,70 USD par utilisateur et par mois [E] | 80 à 110 USD par utilisateur et par mois, prix US [D] | Sur devis |

Autres solutions citées au Maroc : Experio (liasse, TVA pré-remplie, IA et OCR selon l'éditeur [P]), Sage 50 (dès 1 455 MAD HT par an [P]), EBP Maroc en SaaS [P]. Cegid et Khabir sont cités comme répandus, sans fiche fonctionnelle trouvée.

Facture électronique : décret d'application toujours attendu en avril 2026, modèle de type « clearance » [P]. Aucun éditeur n'affiche de connecteur DGI livré.

Critères demandés et non renseignés faute de source : performances mesurées, délais d'implémentation, coût total de possession.

## 3. Lecture

### Où Kalum est en retard

1. **Détermination des comptes.** C'est l'écart le plus net. SAP Business One et Business Central ont un moteur structuré, lisible et auditable ; Sage FRP 1000 annonce des schémas d'écriture avec simulation. Kalum a une table que le code ignore à moitié.
2. **Multi-sociétés et consolidation.** Présent chez Odoo, Business Central et SAP ; absent chez Kalum.
3. **Complétude fiscale.** Pas de liquidation de TVA, pas de tableau de financement ni d'ETIC, paie comptabilisée sous condition.
4. **Ergonomie comptable.** Pas de drill-down, pas de vues enregistrées, pas de saisie au kilomètre.
5. **IA.** Odoo et Microsoft livrent déjà OCR et rapprochement assisté.

### Où Kalum est à niveau ou devant (constaté, pas annoncé)

1. **Localisation marocaine dans le cœur du produit.** Liasse et trois formats EDI DGI natifs. Chez Odoo ce sont des modules tiers ; chez Microsoft, un partenaire.
2. **Inaltérabilité active par défaut.** Chez Odoo, la chaîne est une option par journal.
3. **Contrôle budgétaire bloquant.** Odoo signale le dépassement sans bloquer.
4. **Intégration métier.** Caisse, production, pesage, paie et comptabilité partagent la même transaction.

### Opportunités de différenciation réalistes

| Opportunité | Pourquoi elle est crédible |
|---|---|
| Moteur de règles avec dates de validité, simulation et comparaison avant/après | Aucun des concurrents documentés ne réunit les trois ; SAP a les dates, Sage FRP la simulation |
| Fiscalité marocaine tenue à jour par paramètres datés et sourcés | La table `tax_codes` datée existe déjà ; il faut y accrocher les comptes et les régimes |
| Clôture guidée avec contrôles bloquants et preuves | La checklist de clôture existe ; elle peut devenir le fil conducteur du mois |
| Explication de chaque écriture : quelle règle, quelle version, quelle pièce | Conséquence directe du moteur de règles ; aucun concurrent ne le met en avant |
| Assistant qui propose et ne valide jamais | À construire sur un socle fiable, donc après les correctifs |

## 4. Sources

- Odoo : documentation 19.0 (positions fiscales, inaltérabilité, analytique, budget, modèles de rapprochement, numérisation des factures, localisations fiscales), manifeste `l10n_ma`, page de prix, boutique d'applications.
- Microsoft : learn.microsoft.com (groupes de comptabilisation, dimensions, rapprochement avec Copilot, disponibilité par pays, plan de versions 2026), page de prix.
- SAP : aide technique de la détermination avancée des comptes, note 3388229, blog Seidor.
- Sage : pages produit fr-ma (extraits), Médias24 des 27 octobre 2023 et 11 avril 2026.
- Contexte : Médias24 du 16 avril 2026 (facturation électronique), fnh.ma, upsilon-consulting.com.

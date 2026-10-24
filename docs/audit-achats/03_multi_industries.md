# 03 — Module Achats : lecture multi-industries (SaaS)

Date : 2026-10-12. Entrées : `02_benchmark_erp.md` (127 capacités `C-Dx-nn`), `01_existant.md`, `ecarts/D1..D10.md` (fiches `G-Dx-nn`), code et base locale (lecture seule). Données machine : `03_multi_industries.json`, avec un objet par capacité.

Cible révisée : un ERP SaaS pour des PME de 10 à 500 salariés, au Maroc puis en Afrique francophone, quel que soit le secteur (distribution et négoce, industrie légère, agro-transformation, services, BTP, pharma et cosmétique), et non plus la seule boulangerie. Ce document applique les décisions SaaS déjà prises sans les rediscuter : `tenant_id` + RLS, hiérarchie tenants → stores, packs pays (`country_packs`), modules par tenant (`tenant_modules`), jeu de données boulangerie optionnel, pas de drapeau global par variable d'environnement.

## 1. Synthèse

1. **Le module Achats est presque entièrement générique.** 97 capacités sur 127 relèvent du **noyau**, 17 sont **mixtes** (moteur générique, contenu fourni par un pack), 7 relèvent du **pays** et 6 seulement d'un **secteur**. L'idée selon laquelle un module Achats « boulangerie » se distinguerait par ses fonctions est fausse. La spécificité tient à trois choses : le **modèle d'article** (ingrédient ou consommable), le **modèle de stock** (zones économat/pesage en colonnes, lots réservés aux ingrédients) et des **règles marocaines écrites dans le code**.
2. **Pertinence SaaS** : 85 capacités essentielles (contre 77 pour la boulangerie), 32 utiles, 9 optionnelles, 1 hors-sujet. **22 capacités montent** : multi-devises, multi-tenant, coût rendu, acomptes, service fait, demande de prix, analyse des dépenses, API/import, tests de bout en bout, e-facturation, retenue à la source, RIB à 4 yeux, etc. **7 descendent**, toutes liées à l'alimentaire ou au circuit marché : besoins issus du plan de production, poids pesé, achat au marché, rappel de lots, exigences DLC sur la ligne, poids variable, allergènes. Elles ne disparaissent pas : elles passent en **pack sectoriel** ou en **pack pays**.
3. **Activation** : 84 capacités toujours actives, 17 en module activable, 10 en paramètre par tenant, 10 en pack pays, 6 en pack sectoriel. Le nombre de modules activables reste faible : pas d'usine à options.
4. **Code câblé en dur** : 24 points bloquants relevés (§5). Les cinq plus graves :
   - les **deux modèles d'articles** `ingredients` / `packaging_items`, avec CHECK d'exclusivité sur chaque ligne de pièce, et le routage par **3 UUID de catégories** (`fn_purchasable_kind`, mig 207, dupliqué côté client) ;
   - les **zones de stock en colonnes** (`ingredient_lots.economat_quantity/pesage_quantity`, mig 111), avec lots et DLC réservés aux ingrédients ;
   - les **unités, contenants et densité portés par l'ingrédient** (CHECK `unit IN ('kg','g','l','ml','unit')`, `container_size`, mig 226/227) ;
   - les **rôles métier boulangerie** dans `shared/src/constants/roles.ts`, avec des routes gardées par groupes de rôles et non par permission ;
   - la **fiscalité marocaine codée** : comptes TVA 3455x/4455x par taux, 4411, 5161/5141, liste `TVA_RATES` côté client, ICE comme colonne, devise « DH » dans 44 fichiers.
5. **Écarts à re-concevoir** : sur 167 fiches examinées, **120 ont une conception cible à généraliser** (§6). Les priorités ne changent pas. Le défaut est presque toujours le même : la fiche ajoute des colonnes à `ingredients`/`packaging_items`, s'appuie sur `fn_purchasable_kind`, code un compte CGNC ou un seuil en MAD, crée une table de paramètres sans `tenant_id`, ou appelle le module production (BSI/pesage) depuis le noyau achats. Une poignée de décisions transverses (§7) corrige d'un coup la majorité de ces fiches.
6. **Recommandation** : faire de la refonte Achats l'occasion d'introduire **dès maintenant** les objets suivants :
   - un **article générique** `items`, avec type, politique de suivi et unités/conversions par article ;
   - un **stock générique** `stock_lots` / `stock_moves` / `stock_locations` ;
   - des **rôles comptables** résolus par le pack pays ;
   - des **codes de taxe et seuils fiscaux** par pack ;
   - des **permissions par action** ;
   - `module_parameters` / `document_sequences` avec `tenant_id`.

   Prévoir sans l'implémenter : séries, poids variable, multi-devises complet, e-facturation, budgets. Reporter : portail fournisseur, appels d'offres, IA, ASN. Les P0 restent les P0. Seule leur DDL change, et elle n'est pas plus coûteuse si on la change avant d'écrire la migration.

## 2. Conventions

- **Couche** : `noyau` = toute entreprise qui achète en a besoin, à l'identique. `secteur` = n'a de sens que pour certains secteurs (cités). `pays` = règle légale ou fiscale, portée par le pack pays. `mixte` = moteur générique du noyau dont le contenu (listes, taux, comptes, gabarits) vient d'un pack pays ou sectoriel (précisé).
- **Pertinence SaaS** (même échelle que 02) : jugée pour une PME de 10 à 500 salariés, au Maroc puis en Afrique francophone, tous secteurs confondus. Une capacité vitale pour un seul secteur est notée `utile` ou `optionnel` au niveau SaaS et activée par pack sectoriel.
- **Changement** : comparaison avec la colonne « Pertinence » de 02 (boulangerie). Pour C-D4-02, noté « essentiel (échéancier : utile) » dans 02, on retient `essentiel`.
- **Activation** :
  - `toujours actif` : dans le socle de tout tenant ;
  - `module activable` : ligne `tenant_modules` ;
  - `paramètre par tenant` : actif, comportement réglé dans `module_parameters(tenant_id, …)` ;
  - `pack sectoriel` : livré avec un pack métier (agro, distribution, pharma…) ;
  - `pack pays` : règles et données du `country_pack`.

  Pour une capacité `mixte` dont le moteur est toujours actif, la colonne indique `toujours actif` et le motif précise ce que fournit le pack.

## 3. Les 127 capacités

**D1**

| ID | Capacité | Couche | Boulangerie → SaaS | Changement | Activation | Motif |
|---|---|---|---|---|---|---|
| C-D1-01 | Fiche fournisseur légale + sites/contacts | mixte (pays : identifiants légaux (ICE/IF/RC/TP au Maroc, NINEA/RCCM/NIU ailleurs)) | essentiel → **essentiel** | = | toujours actif | Identité générique ; identifiants fiscaux en table typée party_identifiers fournie par le pack pays |
| C-D1-02 | Conditions par défaut en cascade | noyau | essentiel → **essentiel** | = | toujours actif | Universel ; compte collectif et devise résolus via pack pays / tenant |
| C-D1-03 | Blocages fournisseur différenciés | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D1-04 | RIB historisés, validation 4 yeux | mixte (pays : format RIB 24 chiffres (MA), IBAN, RIB UEMOA/CEMAC) | utile → **essentiel** | ↑ monte | toujours actif | Fraude au changement de RIB = risque n°1 de toute PME ; format validé par le pack pays |
| C-D1-05 | Fiche article × fournisseur, prix datés | noyau | essentiel → **essentiel** | = | toujours actif | Universel ; porte sur l'article générique (item_id), pas sur ingredient/packaging |
| C-D1-06 | Triplet d'unités et conversions par article | noyau | essentiel → **essentiel** | = | toujours actif | Universel ; la densité devient un type de conversion parmi d'autres (item_uom_conversions) |
| C-D1-07 | Catégories d'achat hiérarchiques | noyau | essentiel → **essentiel** | = | toujours actif | Universel ; le routage stock se fait par type d'article, pas par UUID de catégorie |
| C-D1-08 | Sources autorisées / préférées / bloquées | noyau | utile → **utile** | = | paramètre par tenant | Utile partout ; bloquant en pharma/agro (fournisseurs agréés) via paramètre |
| C-D1-09 | Documents fournisseur à échéance | mixte (pays (attestation fiscale, CNSS) + secteur (ONSSA, halal, CoA, BPF pharma, ISO)) | utile → **utile** | = | toujours actif | Moteur générique ; types de documents apportés par packs pays et sectoriels |
| C-D1-10 | Contrats cadres / accords de prix | noyau | utile → **utile** | = | module activable | Universel, valeur forte en distribution et industrie |
| C-D1-11 | Portail fournisseur | noyau | optionnel → **optionnel** | = | module activable | Fournisseurs PME peu outillés au Maroc/Afrique ; différenciant SaaS plus tard |
| C-D1-12 | Typologie fournisseur locale, inactif DGI | pays | essentiel → **essentiel** | = | pack pays | Régime TVA, contribuable inactif, informel : règles du pays, à porter par le pack |
| C-D1-13 | Allergènes / fiche technique / origine | secteur (agro-alimentaire, restauration, cosmétique) | utile → **optionnel** | ↓ descend | pack sectoriel | Sans objet hors alimentaire ; fiche technique générique = pièce jointe |

**D2**

| ID | Capacité | Couche | Boulangerie → SaaS | Changement | Activation | Motif |
|---|---|---|---|---|---|---|
| C-D2-01 | Demande d'achat en-tête/lignes | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D2-02 | Couverture par ligne de DA | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D2-03 | Origine typée de la DA | mixte (industrie/agro : origine plan de production) | essentiel → **essentiel** | = | toujours actif | Origines extensibles par les modules actifs (manuel, réappro, MRP, production) |
| C-D2-04 | Point de commande / min-max | noyau | essentiel → **essentiel** | = | toujours actif | Cœur de la distribution ; exclusion des lots périmant = paramètre si DLC |
| C-D2-05 | Besoins depuis le plan de production | secteur (industrie, agro-transformation, BTP (devis)) | essentiel → **utile** | ↓ descend | pack sectoriel | Sans objet en distribution et services ; fourni par le module Production |
| C-D2-06 | Regroupement DA → BC | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D2-07 | Modèles récurrents / liste du jour | mixte (agro/restauration : liste du jour des frais) | utile → **utile** | = | paramètre par tenant | Modèles = noyau ; « liste du jour » = gabarit sectoriel |
| C-D2-08 | Transferts internes / ruptures sans fournisseur | noyau | utile → **utile** | = | module activable | Utile dès le multi-dépôt |
| C-D2-09 | Achat guidé, catalogue, politiques | noyau | optionnel → **utile** | ↑ monte | module activable | À 50-500 salariés, les demandeurs non acheteurs sont nombreux (services) |
| C-D2-10 | Prévision statistique de la demande | noyau | hors-sujet → **optionnel** | ↑ monte | module activable | Utile en distribution (rotation, saisonnalité) ; hors-sujet en boulangerie |

**D3**

| ID | Capacité | Couche | Boulangerie → SaaS | Changement | Activation | Motif |
|---|---|---|---|---|---|---|
| C-D3-01 | Moteur de règles d'approbation | noyau | essentiel → **essentiel** | = | toujours actif | Universel ; seuils en devise du tenant |
| C-D3-02 | Historique des actions append-only | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D3-03 | Re-approbation sur champ contrôlé | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D3-04 | Délégation, escalade, réassignation | noyau | utile → **utile** | = | paramètre par tenant | Utile dès plusieurs approbateurs |
| C-D3-05 | Demande de prix et comparatif | noyau | utile → **essentiel** | ↑ monte | toujours actif | Règle des 3 devis courante en industrie, services, ONG, filiales de groupes ; comparatif par unité de base et devise |
| C-D3-06 | Appels d'offres formels, enchères | noyau | hors-sujet → **optionnel** | ↑ monte | module activable | Pertinent pour BTP et PME de 200-500 salariés soumis à des procédures |
| C-D3-07 | Engagements et contrôle budgétaire | noyau | optionnel → **utile** | ↑ monte | module activable | Services, ONG, BTP, filiales pilotées par budget |
| C-D3-08 | Référentiel de codes motif | noyau | essentiel → **essentiel** | = | toujours actif | Universel ; codes légaux ajoutés par pack pays |
| C-D3-09 | Verrouillage du BC confirmé | noyau | essentiel → **essentiel** | = | toujours actif | Universel |

**D4**

| ID | Capacité | Couche | Boulangerie → SaaS | Changement | Activation | Motif |
|---|---|---|---|---|---|---|
| C-D4-01 | Types de BC paramétrables | noyau | essentiel → **essentiel** | = | toujours actif | Universel ; type « achat comptant/marché » apporté par pack |
| C-D4-02 | En-tête / lignes / échéancier | noyau | essentiel → **essentiel** | = | toujours actif | Universel ; échéancier multi-dates fréquent en industrie |
| C-D4-03 | Ligne en double unité, facteur figé | noyau | essentiel → **essentiel** | = | toujours actif | Universel (carton/pièce, rouleau/mètre, sac/kg) |
| C-D4-04 | Compteurs de ligne dérivés d'événements | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D4-05 | Axes de statut orthogonaux | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D4-06 | Confirmation = engagement | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D4-07 | Versions / avenants du BC | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D4-08 | PDF conforme et journal d'envoi | mixte (pays : mentions légales acheteur, langues) | essentiel → **essentiel** | = | toujours actif | Gabarit générique ; mentions et identifiants par pack pays, langue par tenant |
| C-D4-09 | AR fournisseur et relances | noyau | utile → **utile** | = | paramètre par tenant | Universel |
| C-D4-10 | Clôture de reliquat, annulation partielle | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D4-11 | Contrôles à la saisie du BC | noyau | utile → **utile** | = | paramètre par tenant | Universel ; sévérités paramétrables |
| C-D4-12 | Numérotation sans trou | mixte (pays : exigence de continuité des pièces) | essentiel → **essentiel** | = | toujours actif | Format par tenant ; exigence sans trou portée par le pack pays |
| C-D4-13 | Copie, modèles, BC récurrent | noyau | utile → **utile** | = | toujours actif | Universel |
| C-D4-14 | Frais sur BC (transport, consigne, douane) | noyau | utile → **utile** | = | toujours actif | Universel ; douane critique pour les importateurs |
| C-D4-15 | Multi-devises | noyau | optionnel → **essentiel** | ↑ monte | toujours actif | Importateurs (EUR/USD/CNY), Afrique francophone (XOF/XAF) ; devise de base = tenant |
| C-D4-16 | Exigences qualité sur la ligne | secteur (agro, pharma, chimie) | utile → **optionnel** | ↓ descend | pack sectoriel | DLC minimale et température sans objet hors produits périssables |
| C-D4-17 | Achat comptant sans BC (marché) | pays | essentiel → **utile** | ↓ descend | pack pays | Circuit informel fréquent au Maroc et en Afrique mais marginal en industrie/services structurés ; générique « bon d'achat comptant » + règles du pack |
| C-D4-18 | Articles à poids variable | secteur (agro (viande, poisson, fromage), métaux, recyclage) | utile → **optionnel** | ↓ descend | pack sectoriel | Drapeau article générique ; sans objet pour la plupart des secteurs |
| C-D4-19 | Consignation, sous-traitance, drop ship, back-to-back | noyau | hors-sujet → **utile** | ↑ monte | module activable | Sous-traitance (industrie), drop ship et commande client liée (distribution, négoce) |

**D5**

| ID | Capacité | Couche | Boulangerie → SaaS | Changement | Activation | Motif |
|---|---|---|---|---|---|---|
| C-D5-01 | Réception référencée au BC | noyau | essentiel → **essentiel** | = | toujours actif | Universel ; destination = emplacement générique |
| C-D5-02 | Journal de réception immuable | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D5-03 | Réceptions partielles et tolérances | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D5-04 | Correction ≠ annulation | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D5-05 | Retour fournisseur et attente d'avoir | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D5-06 | Lot / série / DLC à la réception | mixte (agro, pharma, cosmétique (DLC) ; électronique, équipements (série)) | essentiel → **essentiel** | = | toujours actif | Politique de suivi none/lot/série + DLC optionnelle par article ; obligatoire selon pack sectoriel |
| C-D5-07 | Poids réel pesé à la réception | secteur (agro, vrac, métaux, recyclage) | essentiel → **utile** | ↓ descend | pack sectoriel | Sans objet hors marchandises au poids ; intégration balance = module optionnel |
| C-D5-08 | Quarantaine / libération | noyau | utile → **utile** | = | paramètre par tenant | Universel ; obligatoire en pharma |
| C-D5-09 | Contrôle qualité à la réception | mixte (checklists par secteur (agro : température ; pharma : CoA ; industrie : cotes)) | utile → **utile** | = | module activable | Moteur générique de checklists ; contenus par pack sectoriel |
| C-D5-10 | Réception sans BC rapprochée | noyau | utile → **utile** | = | toujours actif | Universel |
| C-D5-11 | Service fait (charges, prestations) | noyau | utile → **essentiel** | ↑ monte | toujours actif | Sociétés de services et industrie : la part des achats de prestations est majoritaire |
| C-D5-12 | Réception aveugle | noyau | utile → **utile** | = | paramètre par tenant | Universel, au choix du tenant |
| C-D5-13 | ASN, expédition entrante groupée | noyau | hors-sujet → **optionnel** | ↑ monte | module activable | Importateurs (conteneurs, connaissement) et distribution |
| C-D5-14 | Réception → mouvement valorisé | noyau | essentiel → **essentiel** | = | toujours actif | Universel ; routage par classe d'article (stocké, consommable, immobilisation, service) |

**D6**

| ID | Capacité | Couche | Boulangerie → SaaS | Changement | Activation | Motif |
|---|---|---|---|---|---|---|
| C-D6-01 | Facture structurée | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D6-02 | Facture depuis les réceptions | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D6-03 | Politique de facturation par ligne | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D6-04 | Rapprochement 2/3/4 voies par ligne | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D6-05 | Tolérances de rapprochement | noyau | essentiel → **essentiel** | = | toujours actif | Universel ; montants dans la devise du tenant |
| C-D6-06 | Holds par ligne | noyau | essentiel → **essentiel** | = | toujours actif | Universel ; codes de hold extensibles par pack |
| C-D6-07 | Validation ⊥ approbation ⊥ paiement | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D6-08 | Factures sans BC | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D6-09 | Avoirs et débits/crédits ultérieurs | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D6-10 | Anti-doublon facture | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D6-11 | TVA par ligne, taux datés | mixte (pays : taux, exonérations ; secteur : listes d'exonération (produits de base)) | essentiel → **essentiel** | = | pack pays | Moteur tax_codes générique ; taux et exonérations seedés par pack pays |
| C-D6-12 | Contrôle des mentions légales | pays | essentiel → **essentiel** | = | pack pays | Règles de mentions déclarées par le pack pays, vérificateur générique |
| C-D6-13 | Capture de factures (import, OCR) | noyau | optionnel → **utile** | ↑ monte | module activable | Volume de factures élevé à 100-500 salariés ; argument commercial SaaS |
| C-D6-14 | Auto-facturation sur réception (ERS) | noyau | hors-sujet → **optionnel** | ↑ monte | module activable | Collecte agricole (lait, olives), fournisseurs réguliers de l'industrie |
| C-D6-15 | Retenue à la source | pays | utile → **essentiel** | ↑ monte | pack pays | Retenues sur prestations répandues en Afrique francophone et au Maroc ; paramètres par pack |
| C-D6-16 | E-facturation entrante | pays | utile → **essentiel** | ↑ monte | pack pays | Obligation en cours de déploiement (Maroc 2026-2028, déjà en place dans plusieurs pays d'Afrique de l'Ouest) ; adaptateur par pays |

**D7**

| ID | Capacité | Couche | Boulangerie → SaaS | Changement | Activation | Motif |
|---|---|---|---|---|---|---|
| C-D7-01 | Conditions de paiement → échéancier | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D7-02 | Lettrage N:N | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D7-03 | Moyens de paiement typés | mixte (pays : chèque barré, LCN, mobile money) | essentiel → **essentiel** | = | toujours actif | Classes génériques (cash, chèque, virement, effet, carte, compensation) ; liste par pack pays |
| C-D7-04 | Plafond espèces par fournisseur | pays | essentiel → **essentiel** | = | pack pays | Règle fiscale marocaine ; moteur générique « plafond par mode de paiement » activé par pack |
| C-D7-05 | Proposition de paiement en lot | noyau | utile → **utile** | = | paramètre par tenant | Universel |
| C-D7-06 | Blocages avant règlement, 4 yeux | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D7-07 | Annulation de paiement | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D7-08 | Acomptes fournisseur | noyau | utile → **essentiel** | ↑ monte | toujours actif | Acomptes systématiques en import, équipement, BTP, sous-traitance |
| C-D7-09 | Postes ouverts, balance âgée, prévision | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D7-10 | Effets à payer (LCN, traites) | mixte (pays : LCN (MA), lettre de change OHADA) | utile → **utile** | = | pack pays | Instrument « effet » générique ; nom, comptes et règles par pack |
| C-D7-11 | Rapprochement bancaire | noyau | utile → **utile** | = | module activable | Universel, souvent porté par le module Trésorerie |
| C-D7-12 | Escompte dynamique, crédit bloquant | noyau | hors-sujet → **hors-sujet** | = | module activable | Grands comptes |

**D8**

| ID | Capacité | Couche | Boulangerie → SaaS | Changement | Activation | Motif |
|---|---|---|---|---|---|---|
| C-D8-01 | Pièce = écriture, idempotence | noyau | essentiel → **essentiel** | = | toujours actif | Universel ; plan de comptes via pack pays |
| C-D8-02 | GR/IR lettré par ligne | mixte (pays : compte (4081/4487 PCM, 408 SYSCOHADA)) | essentiel → **essentiel** | = | toujours actif | Mécanisme générique ; compte résolu par rôle comptable du pack |
| C-D8-03 | Accrual de période | noyau | utile → **utile** | = | paramètre par tenant | Universel |
| C-D8-04 | Écarts de prix facture/BC isolés | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D8-05 | Détermination automatique des comptes | mixte (pays : plan comptable (CGNC, SYSCOHADA)) | essentiel → **essentiel** | = | toujours actif | Moteur par rôles comptables ; mapping rôle → compte dans le pack pays |
| C-D8-06 | Méthode de valorisation, couches | noyau | essentiel → **essentiel** | = | toujours actif | Méthode par tenant/classe d'article (PMP, FIFO, lot, standard) ; coût recette = consommateur |
| C-D8-07 | Coût rendu / frais d'approche | noyau | utile → **essentiel** | ↑ monte | module activable | Importateurs et distributeurs : douane, transit, fret = part majeure du coût |
| C-D8-08 | Immobilisations depuis les achats | noyau | utile → **utile** | = | module activable | Universel ; plus fréquent en industrie/services |
| C-D8-09 | TVA récupérable (règle de naissance) | pays | essentiel → **essentiel** | = | pack pays | Naissance du droit (paiement au Maroc, facture/livraison ailleurs) = paramètre du pack |
| C-D8-10 | Périodes et verrous comptables | noyau | essentiel → **essentiel** | = | toujours actif | Universel ; exercice décalé à prévoir |
| C-D8-11 | Rapprochements sous-ledger ↔ GL | noyau | utile → **utile** | = | toujours actif | Universel |

**D9**

| ID | Capacité | Couche | Boulangerie → SaaS | Changement | Activation | Motif |
|---|---|---|---|---|---|---|
| C-D9-01 | Tableau d'exceptions actionnables | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D9-02 | Suivi d'exécution par ligne | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D9-03 | Reçu non facturé / engagements | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D9-04 | Analyse des dépenses | noyau | utile → **essentiel** | ↑ monte | toujours actif | Argument de vente SaaS n°1 auprès des dirigeants de PME ; données multi-catégories |
| C-D9-05 | Historique des prix par unité de base | noyau | essentiel → **essentiel** | = | toujours actif | Universel ; « MAD/kg » devient devise/unité de base de l'article |
| C-D9-06 | Performance fournisseur calculée | noyau | utile → **utile** | = | toujours actif | Universel ; écart de poids = indicateur sectoriel |
| C-D9-07 | États réglementaires et de clôture | mixte (pays : états TVA, relevé des déductions ; secteur : registre des entrées (ONSSA)) | essentiel → **essentiel** | = | pack pays | Journal et balance âgée = noyau ; états fiscaux déclarés par le pack pays ; registre sanitaire par pack sectoriel |
| C-D9-08 | Conformité processus, délais de cycle | noyau | optionnel → **utile** | ↑ monte | toujours actif | Audit interne et contrôle de gestion à 100-500 salariés |
| C-D9-09 | Rapports ad hoc et alertes | noyau | utile → **utile** | = | toujours actif | Universel |

**D10**

| ID | Capacité | Couche | Boulangerie → SaaS | Changement | Activation | Motif |
|---|---|---|---|---|---|---|
| C-D10-01 | Rôles, SoD, permissions par action | noyau | essentiel → **essentiel** | = | toujours actif | Rôles définis par tenant ; modèles (magasinier, acheteur…) fournis par packs sectoriels |
| C-D10-02 | Piste d'audit complète | noyau | essentiel → **essentiel** | = | toujours actif | Universel ; durée de conservation par pack pays |
| C-D10-03 | Flux de documents unifié | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D10-04 | Notifications et tâches | noyau | essentiel → **essentiel** | = | toujours actif | Universel ; canaux (WhatsApp, e-mail) par tenant |
| C-D10-05 | Pièces jointes typées | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D10-06 | Intégration stock / production | mixte (industrie, agro (production, pesage)) | essentiel → **essentiel** | = | toujours actif | Stock = noyau ; production/BSI/pesage branchés par événements via module activable |
| C-D10-07 | Paramétrage centralisé et versionné | noyau | essentiel → **essentiel** | = | toujours actif | A fortiori par tenant ; jamais de variable d'environnement |
| C-D10-08 | API, idempotence, import CSV | noyau | utile → **essentiel** | ↑ monte | toujours actif | Reprise de données à chaque onboarding client et intégrations tierces |
| C-D10-09 | UX orientée processus | noyau | essentiel → **essentiel** | = | toujours actif | Universel |
| C-D10-10 | Multi-entité / multi-dépôt / tenant | noyau | optionnel → **essentiel** | ↑ monte | toujours actif | Prérequis d'un SaaS (tenant_id + RLS) et des PME multi-sites |
| C-D10-11 | Traçabilité amont/aval, rappel | secteur (agro, pharma, cosmétique, automobile) | essentiel → **utile** | ↓ descend | pack sectoriel | Généalogie de lots générique utile ; rappel réglementaire obligatoire seulement dans les secteurs régulés |
| C-D10-12 | Impression multilingue | mixte (pays : langues (FR/AR, FR/EN)) | utile → **utile** | = | paramètre par tenant | Langues et gabarits par tenant, mentions par pack |
| C-D10-13 | Tests de bout en bout | noyau | utile → **essentiel** | ↑ monte | toujours actif | Une régression touche tous les clients : phase 0 du plan SaaS |
| C-D10-14 | Assistance IA | noyau | hors-sujet → **optionnel** | ↑ monte | module activable | Différenciation SaaS (classification des dépenses, anomalies) ; mutualisable |

## 4. Ce qui change de priorité, et pourquoi

### 4.1 Les 22 capacités qui montent

| Capacité | Boulangerie → SaaS | Pourquoi |
|---|---|---|
| **C-D10-10** Multi-entité / tenant | optionnel → **essentiel** | C'est la condition d'existence du SaaS (tenant_id + RLS). Les PME clientes ont aussi souvent plusieurs sites ou dépôts. |
| **C-D4-15** Multi-devises | optionnel → **essentiel** | Les importateurs achètent en EUR, USD ou CNY. En Afrique francophone, la devise de base change (XOF, XAF). Une devise « MAD » codée en dur empêche de vendre hors du Maroc. |
| **C-D8-07** Coût rendu / frais d'approche | utile → **essentiel** | Pour un distributeur ou un importateur, douane, transit et fret représentent 10 à 40 % du coût de revient. Sans eux, la marge est fausse. |
| **C-D7-08** Acomptes fournisseur | utile → **essentiel** | L'acompte est la norme pour l'équipement, l'import, le BTP et la sous-traitance. |
| **C-D5-11** Service fait | utile → **essentiel** | Dans une société de services, la majorité des achats sont des prestations sans stock. |
| **C-D3-05** Demande de prix / comparatif | utile → **essentiel** | La règle des 3 devis est courante en industrie, chez les filiales de groupe et dans les structures financées par des bailleurs. |
| **C-D9-04** Analyse des dépenses | utile → **essentiel** | C'est le premier tableau que regarde un dirigeant de PME, et donc un argument de vente. |
| **C-D10-08** API, idempotence, import CSV | utile → **essentiel** | Chaque nouveau client arrive avec ses fournisseurs, articles et tarifs à reprendre. Les intégrations tierces passent par l'API. |
| **C-D10-13** Tests de bout en bout | utile → **essentiel** | Une régression touche tous les tenants à la fois. C'est déjà la phase 0 du plan SaaS. |
| **C-D1-04** RIB historisés, 4 yeux | utile → **essentiel** | La fraude au changement de RIB est le risque de paiement n°1 dans toutes les PME. Le format du RIB vient du pack pays. |
| **C-D6-15** Retenue à la source | utile → **essentiel** | Les retenues sur prestations sont répandues en Afrique francophone et existent au Maroc. Les paramètres viennent du pack. |
| **C-D6-16** E-facturation entrante | utile → **essentiel** | Déploiement au Maroc entre 2026 et 2028, déjà en place dans plusieurs pays d'Afrique de l'Ouest. Un adaptateur par pays. |
| C-D4-19 Sous-traitance, drop ship, back-to-back | hors-sujet → utile | Sous-traitance en industrie ; achat lié à une commande client en négoce. |
| C-D2-09 Achat guidé / catalogue interne | optionnel → utile | Au-delà de 50 salariés, beaucoup de demandeurs ne sont pas acheteurs. |
| C-D3-07 Budget / engagements | optionnel → utile | Services, ONG, BTP, filiales pilotées par budget. |
| C-D6-13 Capture de factures (import, OCR) | optionnel → utile | Volume de factures élevé ; argument commercial du SaaS. |
| C-D9-08 Conformité processus, délais | optionnel → utile | Audit interne et contrôle de gestion à partir de 100 salariés. |
| C-D2-10 Prévision statistique | hors-sujet → optionnel | Distribution : rotation et saisonnalité. |
| C-D3-06 Appels d'offres formels | hors-sujet → optionnel | BTP, grosses PME soumises à des procédures. |
| C-D5-13 ASN / conteneurs | hors-sujet → optionnel | Importateurs. |
| C-D6-14 Auto-facturation (ERS) | hors-sujet → optionnel | Collecte agricole (lait, olives) en agro-transformation. |
| C-D10-14 Assistance IA | hors-sujet → optionnel | Différenciation mutualisable : classification des dépenses, anomalies. |

### 4.2 Les 7 capacités qui descendent (vers un pack, pas vers la poubelle)

| Capacité | Boulangerie → SaaS | Où elle va |
|---|---|---|
| C-D2-05 Besoins depuis le plan de production | essentiel → utile | Module Production (industrie, agro). Le noyau Achats expose seulement « créer/remplacer des lignes de DA par origine ». |
| C-D4-17 Achat comptant au marché, bon interne | essentiel → utile | Pack pays (Maroc, Afrique) sous le nom générique « achat comptant / bon de caisse ». Indispensable en agro et restauration, marginal ailleurs. |
| C-D5-07 Poids pesé à la réception | essentiel → utile | Pack sectoriel (agro, vrac, métaux). La balance WebSerial devient une intégration optionnelle. |
| C-D10-11 Traçabilité amont/aval, rappel | essentiel → utile | La généalogie de lots générique reste au noyau stock. Le registre et la procédure de rappel réglementaires vont dans le pack agro ou pharma. |
| C-D1-13 Allergènes / fiche technique | utile → optionnel | Module « conformité alimentaire » du pack agro. |
| C-D4-16 Exigences DLC / température sur la ligne | utile → optionnel | Pack agro / pharma ; s'appuie sur la politique de suivi de l'article. |
| C-D4-18 Poids variable (catch weight) | utile → optionnel | Drapeau d'article générique, activé par le pack agro. |

Pour la boulangerie elle-même, rien ne change : le tenant Ofauria active le pack sectoriel « boulangerie-pâtisserie » (agro + production + pesage) et retrouve les 7 capacités au niveau essentiel.

## 5. Points câblés en dur pour la boulangerie (périmètre achats/stock)

Gravité : **B** = bloque la vente à un autre secteur ou pays ; **G** = gêne, corrigeable au fil de l'eau.

### 5.1 Modèle d'article et routage

| # | Où (fichier:ligne) | Ce qui est câblé | Pourquoi c'est un frein | Généralisation recommandée | Grav. |
|---|---|---|---|---|---|
| H1 | `server/migrations/110_packaging_po_bsi.sql:15,30` ; `207_purchase_consumable_routing.sql:22-27` ; CHECK `purchase_order_items` / `reception_voucher_items` (`ingredient_id XOR packaging_id`) ; `invoice_items.ingredient_id/packaging_id` | Deux modèles d'articles séparés (`ingredients`, `packaging_items`), chaque ligne de pièce porte deux FK exclusives | Un distributeur a des marchandises, un industriel des matières, composants et pièces de rechange, une société de services des prestations. Aucun ne rentre dans « ingrédient ou emballage ». Chaque nouveau type ajouterait une 3e, puis une 4e FK sur toutes les lignes. | Table unique `items(id, tenant_id, code, name, item_type ∈ stock/consumable/service/asset, category_id, base_uom_id, tracking ∈ none/lot/serial, expiry_tracked, shelf_life_days, costing_method, default_tax_code, attributes jsonb)`. Toutes les lignes portent `item_id`. `ingredients` et `packaging_items` deviennent des vues de compatibilité (`item_type` + catégorie), puis disparaissent. | B |
| H2 | `server/migrations/207_purchase_consumable_routing.sql:44-66` (`fn_purchasable_kind`) ; `client/src/features/stock/useStockCategories.ts:152-156` (`kindOf`) ; `client/src/components/CategoryCascadeSelector.tsx:10-24` (`STOCKABLE_ROOT_IDS`, `CONSUMABLE_ROOT_IDS`) | Routage ingrédient/consommable par **3 UUID racines** de `expense_categories` (Emballages, Entretien, Équipements), dupliqué serveur et client | Les UUID n'existent que dans le seed Ofauria (mig 059). Un autre tenant, avec son propre arbre, est routé par défaut en « ingrédient ». | Routage par `items.item_type` (et non par la catégorie). Si une catégorie doit imposer un type : attribut `item_categories.default_item_type`. Supprimer les constantes d'UUID. | B |
| H3 | `server/src/repositories/reception-voucher.repository.ts:9-12, 29-57` (`CAT_MATIERES_PREMIERES`, `CAT_INGREDIENTS`, `CAT_EMBALLAGES` ; jointure `ec.code = ing.category` l. 38) | Catégorie de la facture auto déduite de 3 UUID et d'un code texte `ingredients.category` | Même cause que H2. La jointure sur un code texte dépend du seed boulangerie (26 codes). | Catégorie portée par la ligne (`item.category_id` copié, mig 194 déjà). En-tête = catégorie dominante calculée, sans constante. | B |
| H4 | `server/migrations/109_packaging_items.sql:15`, `195_consumable_families.sql:18` | CHECK `packaging_items.category IN ('caissettes','boites','sachets','films','etiquettes','rubans','supports','produits_nettoyage',…)` | Liste fermée du métier boulangerie. | Supprimer le CHECK : la famille est une catégorie du référentiel du tenant. | B |
| H5 | `server/src/repositories/purchase-request.repository.ts:25-32` ; table `purchase_requests(ingredient_id, reason)` (raisons `production`/`manual`) | DA limitée aux ingrédients ; origine « production » | Impossible de demander une prestation, une pièce ou un consommable. | `purchase_request_lines.item_id` ou ligne par catégorie (charge) ; `origin_type` venant d'un registre alimenté par les modules actifs. | B |

### 5.2 Unités, contenants, densité

| # | Où | Ce qui est câblé | Pourquoi c'est un frein | Généralisation | Grav. |
|---|---|---|---|---|---|
| H6 | `shared/src/constants/units.ts:1-17` ; `server/migrations/004_create_ingredients.sql:4` (CHECK `unit IN ('kg','g','l','ml','unit')`, élargi à `piece`) ; `server/src/utils/units.ts:20-30` (`FACTORS` masse/volume) | Cinq unités en dur, conversions limitées à g↔kg et ml↔cl↔l | Il manque m, m², m³, rouleau, carton, palette, heure, jour, forfait. Un industriel ou un prestataire ne peut pas décrire ses articles. | Table `uoms(tenant_id NULL = système, code, label, kind ∈ mass/volume/length/area/count/time/packaging, ratio_to_kind_base)`, seedée par le noyau et extensible par le tenant. `item_uom_conversions(item_id, from_uom_id, to_uom_id, factor)` pour les conversions propres à l'article. Règle maison conservée : affichage dans l'unité saisie. | B |
| H7 | `server/migrations/226_ingredient_container_type.sql:7-8` ; `225_container_types_referentiel.sql:7-24` ; `server/src/services/container-rule.ts:1-17` ; `purchase-order.repository.ts:147-154, 408` (`applyContainerRule`) | Un seul contenant par **ingrédient** (`container_type_id`, `container_size`), avec arrondi au contenant entier | Le conditionnement dépend du **fournisseur** (carton de 6 chez l'un, de 12 chez l'autre) et existe pour tous les articles. La règle « contenant entier » n'est pas universelle (vrac, prestations). | `supplier_items.purchase_uom_id` + `qty_per_purchase_uom` + `min_qty` + `multiple`. Les types de contenant deviennent des `uoms` de nature `packaging`. Arrondi = attribut `rounding ∈ none/up_to_multiple` de `supplier_items`. Facteur toujours figé sur la ligne (P3). | B |
| H8 | `server/migrations/227_ingredient_densite.sql:30` ; `server/src/utils/units.ts:32-60` (`isCrossTypeConversion`, `densiteKgL`) | Densité kg/L sur l'ingrédient comme seule conversion inter-nature | La densité est un cas particulier de conversion d'article (chimie, peinture, carburant). Le principe est sain mais localisé. | Une ligne `item_uom_conversions` (kg ↔ L) remplace la colonne. `fn_unit_conv` lit cette table. | G |

### 5.3 Stock, lots, zones

| # | Où | Ce qui est câblé | Pourquoi c'est un frein | Généralisation | Grav. |
|---|---|---|---|---|---|
| H9 | `server/migrations/111_economat_pesage.sql:17-23` ; vue `v_ingredient_stock` ; `reception-voucher.repository.ts:431-438` | Zones de stock **en colonnes** (`ingredient_lots.economat_quantity`, `pesage_quantity`) | Un 3e emplacement (quai, chambre froide, dépôt 2, rayon) impose une migration. Les emplacements d'un distributeur se comptent par dizaines. | `stock_locations(tenant_id, store_id, code, kind)` + `stock_quants(lot_id, location_id, qty)` ou `stock_moves(item_id, lot_id, from_location_id, to_location_id, qty_base)`. Économat et pesage deviennent deux emplacements du store. | B |
| H10 | `reception-voucher.repository.ts:399-427` (consommable : `packaging_store_stock`, ni lot ni DLC) vs `:429-470` (ingrédient : `ingredient_lots` + `inventory` + `inventory_transactions`) ; tables `inventory(ingredient_id)`, `packaging_store_stock(packaging_id)` | Deux chemins d'écriture de stock. Lot et DLC réservés aux ingrédients ; consommables sans lot. | La politique de suivi dépend de l'article et non de la table : un médicament ou un composant électronique est loti ou sérialisé, une vis non. | Un seul chemin `stock_moves` pour tous les articles. `items.tracking` (none/lot/serial) et `expiry_tracked` décident s'il faut un lot (`stock_lots`) et une DLC. Les séries sont prévues dans le schéma (`stock_serials`) et non implémentées. | B |
| H11 | `reception-voucher.repository.ts:420-424, 461-466` (`UPDATE … SET unit_cost = dernier prix`) | Coût catalogue = dernier prix payé, écrasé à chaque réception | Méthode de valorisation implicite et non paramétrable. Les clients industriels et distributeurs exigent PMP ou FIFO. | `items.costing_method` (par tenant, surchargeable par catégorie). Couches de valorisation (C-D8-06). Le dernier prix devient une vue. | G |
| H12 | `ingredients.allergens text[]` (`004_create_ingredients.sql:7`) ; `ingredients.weighing_tolerance_pct/abs` (mig 270) ; `ingredient_lots.opening_history`, `effective_expiry_after_opening` | Attributs alimentaires et de pesée au cœur de l'article | Sans objet hors alimentaire. Ils encombrent le modèle commun. | `items.attributes jsonb`, ou tables du module « conformité alimentaire » / « pesage » activées par `tenant_modules`. | G |

### 5.4 Rôles, permissions, paramétrage

| # | Où | Ce qui est câblé | Pourquoi c'est un frein | Généralisation | Grav. |
|---|---|---|---|---|---|
| H13 | `shared/src/constants/roles.ts:1-15` (`baker`, `pastry_chef`, `viennoiserie`, `beldi_sale`, `magasinier`), `:21-41` (`ROLE_GROUPS`), `:58-63` (`ROLE_CATEGORY_SLUGS` = slugs de produits boulangerie) | Rôles et visibilités codés en TypeScript | Un tenant ne peut ni créer « acheteur », « comptable fournisseurs » ou « chef de chantier », ni renommer un rôle. | `roles(tenant_id, code, label, template_code)` + `role_permissions(role_id, module, action, amount_limit, currency)`. Modèles de rôles par pack sectoriel (boulangerie : chef, magasinier ; distribution : acheteur, préparateur). | B |
| H14 | `server/src/routes/purchase-order.routes.ts:9-25`, `reception-voucher.routes.ts:9-12`, `purchase-request.routes.ts:13-21`, `ingredient-lot.routes.ts:15-30` (`authorize(...ROLE_GROUPS.ADMIN_MANAGER / WAREHOUSE)`) | Routes gardées par groupes de rôles | Même cause. La séparation des tâches (C-D10-01) est impossible à paramétrer. Le masquage des prix pour le magasinier est décidé par rôle. | `requirePermission('purchasing', 'po.approve')`, etc. La table `user_permissions(module, can_*)` existe déjà : l'étendre en actions et la rattacher aux rôles du tenant. | B |
| H15 | `server/src/config/feature-flags.ts:33-44` (`LEDGER_AUTOGEN`, `LEDGER_BACKED_DEBTS`, `LEDGER_SHADOW_MODE` lus dans `process.env`) | Drapeaux globaux par variable d'environnement | Contraire à la décision SaaS : le comportement doit varier par tenant. | `module_parameters(tenant_id, module, key, value)` avec un défaut dans `parameter_definitions`. | B |
| H16 | `company_settings` (colonnes `production_*`, `taux_main_oeuvre_defaut_dh_h`, `default_articles_per_sachet`, `staff_discount_percent`…) ; `shared/src/constants/modules.ts` (alias `economat`, `pesage`) | Paramètres sectoriels dans une ligne unique de réglages globaux | Ligne unique, donc pas de tenant. Le préfixe `dh` dans un nom de colonne fige la devise. | Paramètres par module dans `module_parameters` ; identité légale dans `tenant_legal_entities`. | G |

### 5.5 Règles Maroc et identité codées en dur

| # | Où | Ce qui est câblé | Pourquoi c'est un frein | Généralisation | Grav. |
|---|---|---|---|---|---|
| H17 | `server/src/services/journal-generator.service.ts:79-93` (`tvaAccountForRate` : 20→34552, 14→34553, 10→34554, 7→34555, idem 4455x) | Comptes de TVA du CGNC par taux | Ce mapping est faux pour le SYSCOHADA (445x) et pour tout nouveau taux. | `tax_codes(country_pack, code, rate, kind, recoverable, valid_from/to)` + rôle comptable `vat_deductible:<tax_code>` résolu par `account_roles(country_pack, role, account_code)`. | B |
| H18 | `journal-generator.service.ts:137` (fallback 6181/7585), `:211, 456` (4411), `:329-342, 401-403, 486, 500-509, 561, 573` (5161/5141/5111/4415, journaux CA/BQ/OD), `:660, 679, 755` | Plan comptable marocain littéral dans le générateur d'écritures | Le SaaS ne peut pas tenir une comptabilité SYSCOHADA. Chaque client marocain avec un plan personnalisé casse. | Rôles comptables (`ap_control`, `cash`, `bank`, `cheques_in_transit`, `bills_payable`, `grir_clearing`, `misc_expense`…) dans `posting_profiles`. Le pack pays fournit `role → compte`. Le tenant peut surcharger. | B |
| H19 | `client/src/features/purchasing/PurchasingPage.tsx:1518` (`TVA_RATES = ['0','7','10','14','20']`) ; `invoice_items.tva_rate` numérique libre ; `server/src/utils/tva.ts` | Taux de TVA marocains en liste client ; taux libre sur la ligne | Sans date de validité ni pays. 7 et 14 % sont en cours de suppression au Maroc. | Liste issue de `GET /tax-codes?date=` (pack pays). La ligne porte `tax_code_id` + taux figé (snapshot). | B |
| H20 | Table `suppliers(ice)` ; `customers(ice, if_fiscal, rc, rc_ville, tp, cnss)` (`customer.repository.ts:64-102`) ; `accounting.repository.ts:323-336` ; `invoice-pdf.service.ts:260, 456`, `purchase-order-pdf.service.ts:308` | Identifiants fiscaux marocains en colonnes fixes | Au Sénégal on attend NINEA/RCCM, au Cameroun NIU, en Côte d'Ivoire NCC. Chaque pays ajouterait des colonnes. | `party_identifiers(party_id, id_type_code, value)` + `country_id_types(country_pack, code, label, regex, checksum_fn, required_on_invoice, print_on_documents)`. Idem pour l'identité du tenant. | B |
| H21 | 44 fichiers client contiennent le suffixe « DH » (ex. `client/src/features/accounting/CaisseImportModal.tsx:150-155`) ; `server/src/utils/units.ts:139` ; aucune colonne `currency` sur `purchase_orders`/`invoices` | Devise implicite MAD / « DH » | Il est impossible d'afficher XOF ou EUR et impossible d'acheter en devise. | `tenants.base_currency` + `currency_code` sur chaque pièce. Formateur unique `formatMoney(amount, currency, locale)` côté client. | B |
| H22 | `server/src/utils/timezone.ts:6, 13, 56` (`Africa/Casablanca` par défaut) | Fuseau horaire par défaut du Maroc | Dakar et Abidjan sont en UTC+0, Douala en UTC+1. Les dates de réception et de pièce seraient décalées. | `tenants.timezone` / `stores.timezone`, sans valeur par défaut codée. | G |
| H23 | `server/src/repositories/purchase-order.repository.ts:100-122` (`BC-YYYY-NNNN` par `MAX()+1`) | Format et préfixe de numérotation codés | Les préfixes et formats varient par client. Le `MAX()+1` sans tenant entre en collision dès deux tenants. | `document_sequences(tenant_id, store_id NULL, doc_type, fiscal_year, last_no)` + `numbering_schemes(tenant_id, doc_type, pattern)`. Le caractère « sans trou » vient du pack pays. | B |
| H24 | `server/src/services/purchase-order-pdf.service.ts:14` (chemin absolu `/Users/anissbouida/…/logo-ofauria.png`), `:71` (charte « Ofauria ») ; `printer.controller.ts:130`, `cash-register.controller.ts:227` (défaut `'Ofauria'`) | Marque et chemin local en dur dans les documents | Le PDF d'un autre tenant porterait la marque Ofauria, voire échouerait en production. | Logo et charte par tenant (data URI en base, déjà la règle « uploads Cloud Run éphémère »). Aucun nom de marque par défaut. | B |

Hors périmètre achats mais du même type, à signaler au plan SaaS : barème IR codé dans `server/src/repositories/employee.repository.ts:790-793` (paie → pack pays).

## 6. Écarts dont la conception cible doit être généralisée

Méthode : les 10 fichiers d'écarts ont été relus fiche par fiche. On a examiné 167 fiches, dont 4 sous forme de ligne de tableau seulement. D5 annonce 21 fiches mais n'en contient que 11 (G-D5-12 à 21 absentes du fichier). D4 n'a de fiche que pour 14 de ses 24 écarts. D10 s'arrête à G-D10-15 (16 à 19 seulement en tableau). Les écarts sans fiche n'ont été jugés que lorsque leur ligne de tableau suffisait. **Résultat : 120 fiches à re-concevoir** (D1 13, D2 14, D3 11, D4 7, D5 11 + le socle commun §2, D6 11, D7 10, D8 14, D9 16, D10 13) ; les autres sont déjà génériques. **Aucune priorité n'est modifiée.**

### 6.1 Sept corrections transverses qui règlent la majorité des fiches

| # | Défaut récurrent dans les conceptions cibles | Correction à appliquer dans toutes les fiches | Fiches touchées (principales) |
|---|---|---|---|
| T1 | `purchasable_kind IN ('ingredient','packaging')` + `purchasable_id`, `COALESCE(ingredient_id, packaging_id)`, appui sur `fn_purchasable_kind` | `item_id → items` (H1). Le type d'article décide du routage. | G-D1-07/08/09/10/17, G-D2-01/05/09/15, G-D3-05/07/09/12, G-D4-01/03, G-D5-02/11, G-D6-02/05/06/16, G-D8-05/06/12, toutes les vues D9 |
| T2 | `lot_id REFERENCES ingredient_lots`, zones `economat`/`pesage` (colonnes ou CHECK `zone IN ('economat','pesage','quai')`) | `stock_lots` + `stock_locations` + `stock_moves` génériques (H9-H10) | Socle D5 §2, G-D4-04, G-D5-02/04/05/06/09, G-D2-06, G-D8-05/07/12/13, G-D9-01/04/10, G-D10-08/15 |
| T3 | Comptes littéraux CGNC (4411, 4417/4081, 3455x, 5141, 5161, 4415, 3411, 6119, 3121…) dans les fonctions et vues | `account_roles(country_pack, role_code, account_code)` + `posting_profiles(event, role_code, item_class, tax_code, category…)` | G-D1-04, G-D5-05, G-D7-02/03/09/10/12/13/16/17, G-D8-03/05/06/07/09/10/12/13/14/16/17, G-D9-03/08 |
| T4 | Règles et données marocaines en CHECK ou en seed du noyau : ICE `^[0-9]{15}$`, RIB `char(24)`, `vat_rates` sans pays (T20/EXO_SDD), `exonere_sdd`, `fiscal_thresholds` 5 000/50 000 sans pays, `supplies_unprocessed_agri`, `is_dgi_inactive`, art. 101 (TVA au paiement), conservation 10 ans | Tables du pack pays : `country_id_types`, `country_bank_formats`, `tax_codes`, `tax_exemption_reasons`, `fiscal_thresholds(country_pack…)`, `fiscal_rules(country_pack, rule_code, params)`, `non_deductible_reasons`, `legal_mention_rules`, `document_retention_rules`, paramètre `vat_recovery_basis ∈ invoice/payment/receipt` | G-D1-01/06/10/14, G-D3-02/08/11, G-D4-08/17, G-D6-11/12/13/14/17/18, G-D7-03/04/16, G-D8-11/15, G-D9-09/12, G-D10-07/09/10/19 |
| T5 | `module_parameters(module, key)`, `document_sequences(doc_type, year)`, `reason_codes`, `payment_terms.code`, `match_tolerances`, `sod_rules`, `notification_rules` **sans `tenant_id`** ; montants sans devise | `tenant_id` (+ `store_id` NULL) dans la clé et RLS partout. Catalogue `parameter_definitions` pour les défauts. `currency_code` à côté de chaque montant de seuil. | Presque toutes les fiches ; explicitement G-D3-01/03, G-D4-12, G-D5 socle/01/03/04, G-D6-06/07/11, G-D7-02, G-D9-06/11/15, G-D10-01/04/09 |
| T6 | Rôles nommés (`magasinier`, chefs, `ROLE_GROUPS.WAREHOUSE ∪ PRODUCTION`), prix masqués par rôle | Permissions par action (`purchasing.po.approve`, `receiving.post`, `price.view`), rôles du tenant, modèles de rôles par pack sectoriel | G-D1-18, G-D2-13, G-D3-10/14, G-D4-21, G-D5 socle/01, G-D10-01/02 |
| T7 | Le noyau Achats **appelle** la production : `bonSortieRepository.completePending/reallocateRuptures`, `origin_ref_type='bsi_line'`, `syncProductPrice`/`recalcParents`, `v_recipe_total_cost`, `fn_current_actor = fn_production_current_actor` | Le noyau publie des événements (outbox : `gr.posted`, `request_line_received`, `item_cost_changed`). Le module Production s'y abonne s'il est activé. Registres `document_origin_types` / `document_types` et vues de demande enfichables (`v_demand_<module>`). | G-D1-08, G-D2-02/04/06/07/12/14, G-D3-12/14, G-D9-13, G-D10-03/05/08 |

### 6.2 Liste des fiches à re-concevoir

Format : **ID (priorité)** — élément spécifique → version générique. Les fiches couvertes uniquement par T1 à T7 sans autre spécificité sont listées en fin de domaine.

**D1 — Référentiel fournisseurs**
- **G-D1-01 (P0)** — colonnes `ice`, `if_number`, `rc_number`, `rc_city`, `tp_number`, `cnss_number`, CHECK ICE et `vat_status … exonere_sdd` → `party_identifiers` + `country_id_types` (T4) ; `vat_regime` et `legal_form` issus de listes du pack.
- **G-D1-07 (P0)** — `supplier_items` polymorphe ingrédient/consommable, lecture par les chefs → `supplier_items.item_id` FK réelle (T1) ; permissions `purchasing.supplier_items.*` (T6).
- **G-D1-08 (P0)** — `currency DEFAULT 'MAD'` ; la mise à jour du coût appelle `syncProductPrice` (recettes) → devise du tenant/fournisseur ; événement `item_cost_changed` (T7) ; routes `/items/:id`.
- **G-D1-14 (P0)** — `supplier_type CHECK (… 'marche_especes','producteur_agricole')`, `invoice_required` généré, seuils 5 000/50 000 → table `supplier_types(tenant_id, code, invoice_required, cash_ceiling_applies, cash_voucher_allowed)` seedée par pack ; seuils dans `fiscal_thresholds(country_pack…)` ; `tax_authority_status` au lieu de `is_dgi_inactive`.
- **G-D1-09 (P1)** — contenant hérité de `ingredients.container_*`, densité comme règle centrale → `supplier_items.purchase_uom_id` + `item_uom_conversions` (H7-H8).
- **G-D1-10 (P1)** — `vat_rates` global seedé T20/T10/EXO_SDD, repli `'T20'` littéral, backfill farine/lait → `tax_codes` du pack ; code par défaut = paramètre du tenant ; mapping boulangerie dans le jeu de données optionnel.
- **G-D1-03 (P1)**, **G-D1-04 (P1)**, **G-D1-06 (P2)** — devise MAD, `TRAITE60`, compte 4411 et format `4411-FOUR-…`, RIB 24 chiffres → pack pays (T3, T4).
- **G-D1-12 (P2)** — `doc_type CHECK` mélangeant pièces marocaines et agro → `supplier_document_types(tenant_id, code, has_expiry, country_pack, sector_pack)`.
- **G-D1-15 (P2)** — 14 allergènes du décret 2-12-389 dans le noyau → module « conformité alimentaire » ; le noyau ne garde que `origin_country` et `item_attributes`.
- Couvertes par T1/T5/T6 : G-D1-17 (P1), G-D1-18 (P2).

**D2 — Besoins & DA**
- **G-D2-02 (P0)** — règle `already_ordered` câblée sur `bsi_line` → `fn_open_coverage(origin_ref_type, id)` dans le noyau ; adaptateur BSI dans Production (T7).
- **G-D2-01 (P1)** — `kind 'rupture'`, `origin IN ('production_plan','rupture')` → `kind ∈ purchase/internal_transfer/shortage`, origine via le registre `document_origin_types`.
- **G-D2-04 (P1)** — la réception appelle `completePending` du BSI → événement `request_line_received` (T7).
- **G-D2-05 (P1)** — `reorder_rules` sur ingrédient/emballage, seed farine/œufs → `reorder_rules(item_id, location_id, min, max, multiple)` ; seuils boulangerie dans le jeu de données.
- **G-D2-06 (P1)** — prévision = `economat_quantity + pesage_quantity` + besoins production → `v_item_stock_by_location` + union de vues de demande enregistrées par les modules (T2, T7).
- **G-D2-07 (P1)** — génération des besoins dans `confirmPlan` → module Production/MRP ; le noyau expose `POST /purchase-requests/lines` idempotent par origine.
- **G-D2-08 (P1)** — arrondi « 1 kg poudres, 1 L liquides » → `fn_purchase_qty(item, supplier, qty)` sur `supplier_items` puis `item_uom_conversions`.
- **G-D2-09 (P1)**, **G-D2-13 (P1)**, **G-D2-15 (P1)** — prix depuis `ingredient_lots`, rôles chefs/magasinier, fiche née de la scission consommables → T1, T6 (G-D2-15 est absorbée par `items`).
- **G-D2-11 (P2)** — « liste du jour / frais quotidiens » depuis la consommation BSI → « modèles de demande récurrente » ; consommation depuis `stock_moves` ; gabarit boulangerie dans le jeu de données.
- **G-D2-12 (P2)**, **G-D2-14 (P2)** — rupture créée par le BSI, transfert économat→pesage, destinataires câblés → API générique, emplacements, `notification_rules`.
- **G-D2-18 (P3)** — saisonnalité Ramadan/Aïd, marché, sacs → `seasonal_profiles(tenant_id…)` avec calendrier fourni par le pack pays ; FEFO selon `items.expiry_tracked`.

**D3 — Sourcing & approbation**
- **G-D3-02 (P0)** — seuil « BC requis » 2 000 DH et condition plafond espèces 5 000 DH dans la règle → paramètre tenant en devise de base ; plafond lu dans `fiscal_thresholds` du pack.
- **G-D3-03 (P0)** — `module_parameters(key PRIMARY KEY)` global → T5 (correction réutilisée par D3-06/10/12, D4-01/20).
- **G-D3-05 (P0)** — verrou sur `ingredient_id/packaging_id`, justifié par l'ONSSA, statuts legacy → verrou sur `item_id`/`uom_id` et `lifecycle_status` ; traçabilité selon la politique de suivi de l'article.
- **G-D3-01 (P1)** — seeds `min_amount 5000/20000` et `approver_role 'manager'` → montants en devise du tenant, seuils seedés par gabarit d'onboarding, approbateurs par permission.
- **G-D3-08 (P1)** — `cash_exception_agri` (art. 106-II) et `dlc_short` dans le seed du noyau → motifs génériques au noyau, motifs légaux dans le pack pays, motifs DLC dans les packs agro/pharma.
- **G-D3-10 (P1)**, **G-D3-14 (P1)** — `ROLE_GROUPS`, auto-approbation des DA « production » < 2 000 DH, affichage du BSI → T6, T7 ; `source_type` générique.
- **G-D3-11 (P1)** — « ICE vide » = nouveau fournisseur, art. 228 bis → identifiant requis selon `country_id_types.required_for_purchasing` ; contrôle « contribuable inactif » = crochet de validation optionnel du pack.
- **G-D3-12 (P1)** — prix de référence depuis `ingredient_lots` et impact recette → `fn_reference_price(item, supplier, uom)` ; impact recette côté Production.
- **G-D3-07 (P2)** — comparatif « MAD/unité de base » avec densité → `price_per_base` via le facteur de la ligne ; devis en devise convertie en devise de base.
- **G-D3-09 (P3)** — engagements par `ingredients.category_id` → `purchase_order_items.category_id`.

**D4 — Commande**
- **G-D4-03 (P0)** — `num_nonnulls(ingredient_id, packaging_id)=1`, facteur depuis `ingredients.container_size`, `tva_rate` libre par défaut depuis l'ingrédient → `item_id`, `purchase_uom_id`, `uom_factor` figé, `tax_code_id` (pack), `currency_code` en en-tête.
- **G-D4-04 (P0)** — `po_line_events.lot_id → ingredient_lots`, rôle SQL `ofauria_app` codé → `stock_lots`, nom de rôle en configuration.
- **G-D4-01 (P1)** — types seedés globalement, dont `internal_voucher` « marché » au noyau → `purchase_order_types(tenant_id…)` ; noyau = stock / charge / retour ; « achat comptant » apporté par pack.
- **G-D4-08 (P1)** — `company_settings.ice char(15) …`, `suppliers.lang IN ('fr','ar')` → `company_legal_identifiers` + `country_id_types` ; langue = locale BCP-47 ; gabarit de mentions par pack.
- **G-D4-12 (P1)** — `document_sequences(doc_type, year)`, CHECK regex du numéro → H23.
- **G-D4-17 (P1)** — bon d'achat interne marché, `supplier_type` fermé, plafonds, TVA forcée à 0 → module « achat comptant / petite caisse » ; récupérabilité via `tax_codes.recoverable` ; gabarit « marché » dans le jeu de données.
- **G-D4-21 (P1)** — groupes de rôles sur les routes → `requirePermission` + contrôle du `tenant_id` avant `store_id`.
- À la marge (tableau seulement) : G-D4-16 (DLC minimale selon `items.expiry_tracked`), G-D4-18 (poids variable = drapeau d'article, indépendant de la balance WebSerial).

**D5 — Réception & qualité** (les 11 fiches présentes, plus le socle §2)
- **Socle D5 §2** — `zone CHECK ('economat','pesage','quai')`, `lot_id → ingredient_lots`, double chemin d'écriture, `requires_dlc` sur `expense_categories`, `lot_number_seq` global, rôle WAREHOUSE, écrans « Économat » → T2, `items.tracking`, `module_parameters` par tenant, permissions `receiving.post` / `price.view`, libellés d'emplacements configurables.
- **G-D5-02 (P0)**, **G-D5-03 (P0)**, **G-D5-04 (P0)** — backfill du facteur depuis `ingredients.container_size`, correction qui décrémente `economat_quantity` et refuse « ce qui est au pesage », paramètres sans tenant → `stock_quants(lot, location)`, facteur depuis `supplier_items`/`item_uom_conversions`, T5.
- **G-D5-06 (P0)** — préfixe `LI-` codé sur une séquence globale, étiquette avec allergènes → numérotation par tenant ; champs d'étiquette fournis par le pack agro.
- **G-D5-07 (P0)** — `requires_dlc` seedé sur produits laitiers, levures, beurre, œufs ; « emballages jamais » ; trigger réservé aux ingrédients → `item_categories.tracking_policy` + surcharge par article, pour tout type d'article ; seeds dans les packs sectoriels ; référence réglementaire en métadonnée du pack.
- **G-D5-01 (P1)** — `AT TIME ZONE 'Africa/Casablanca'`, `zone DEFAULT 'economat'` → fuseau du store, `stores.default_receiving_location_id`.
- **G-D5-05 (P1)** — décrément des zones, comptes 4417/4411 → T2, T3.
- **G-D5-08 (P1)** — réutilise la tolérance de pesée BSI (mig 270), `ingredients.weigh_at_receipt`, balance WebSerial → `items.catch_weight` + `receipt_tolerances(tenant, scope)` ; intégration balance = module `device_integrations`.
- **G-D5-10 (P1)** — `qc_templates` sur `expense_categories`, seeds « frais ≤ 4 °C », justification ONSSA → `qc_templates(tenant_id, scope)` ; contenus par pack (agro : température ; pharma : CoA, libération de lot ; industrie : cotes).
- **G-D5-09 (P2)**, **G-D5-11 (P2)** — routage et statuts sur `ingredient_lots`, `sync_inventory_from_lots`, lignes ingrédient/emballage → T1, T2.

**D6 — Facture & rapprochement**
- **G-D6-05 (P0)** — `fn_match_tolerance(po, p_ingredient, p_packaging)` → `fn_match_tolerance(po_line_id)` résolu sur article/catégorie.
- **G-D6-07 (P0)** — `hold_code CHECK` fermé (`LEGAL_MENTIONS`, `TAX_VARIANCE`…) → table `hold_codes` (noyau + codes ajoutés par pack).
- **G-D6-11 (P0)** — `rib char(24)`, `sod_mode` sans tenant → `bank_accounts(account_number, iban, bic, country)` validé par `country_bank_formats`.
- **G-D6-12 (P0)** — `vat_rates.code` global (N20/R10/R7/R14/EXO_SDD), `vat_exempt_reason 'art91_sdd'`, `default_vat_rate_code` sur ingrédient et emballage, seed farine/lait/beurre/levure → `tax_codes(pack_id, tenant_id NULL, code, rate, kind ∈ standard/reduced/zero/exempt_with_credit/exempt_without_credit/out_of_scope, recoverable, valid_from/to)`, `tax_exemption_reasons` du pack, `items.default_tax_code`.
- **G-D6-13 (P0)** — `checkInvoiceLegalMentions` avec codes `SUPPLIER_ICE_*`, `TP_MISSING`, `DGI_INACTIVE` → vérificateur générique piloté par `legal_mention_rules(pack_id, code, handler, severity)`.
- **G-D6-02 (P1)**, **G-D6-16 (P1)** — vues sur `ingredient_id/packaging_id`, résolution par `fn_purchasable_kind` → T1.
- **G-D6-06 (P1)** — `match_tolerances` sur `purchasable_kind`, montants 0,50 / 1,00 / 2 000 sans devise ni tenant → portée global/fournisseur/catégorie/article par tenant, `currency_code`, défaut fourni par le pack.
- **G-D6-17 (P1)** — `retention_until = +10 ans` (art. 211) → `document_retention_rules(pack, owner_type, years)`.
- **G-D6-18 (P1)** — seed `CASH_DAILY 5000 / CASH_MONTHLY 50000`, TVA forcée non récupérable pour le bon interne → `fiscal_thresholds(pack…)`, règle « bon interne non récupérable » = paramètre du pack.
- **G-D6-14 (P2)** — `withholding_tax_types` global seedé Maroc, compte 4452x → par pack, comptes par rôle.

**D7 — Paiements**
- **G-D7-03 (P0)** — `ENUM payment_mode` marocain, RIB modulo 97, comptes et journaux littéraux, « chèque non barré > 5 000 DH » → `payment_methods(pack, code, instrument_class, requires_reference, two_step_clearing, deductibility_flag)` + `tenant_payment_methods` ; `bank_account_identifiers(scheme RIB_MA/IBAN/RIB_UEMOA)` ; comptes par rôle.
- **G-D7-04 (P0)** — compteur espèces codé sur `payment_mode='cash'`, `supplies_unprocessed_agri` → déclenché seulement si la règle `CASH_LIMIT` est active pour le pack ; exemptions via `supplier_tax_attributes` du pack.
- **G-D7-17 (P0)** — virements internes 5141/5161/5115/1481/6311 → rôles `internal_transfer_clearing`, `loan_principal`, `loan_interest`.
- **G-D7-02 (P1)** — écart de règlement en dur sur 6581/7581, seuil « 5 DH » → rôles + seuil tenant en devise.
- **G-D7-10 (P1)** — tranches de la balance âgée codées, auxiliaire « 4411 » → `aging_buckets` paramétrables, rôle `ap_control`.
- **G-D7-16 (P1)** — droit à déduction au paiement posé comme fixe, transfert 34552→34551 → `vat_recovery_basis` du pack ; transfert généré seulement si la base est `payment`.
- **G-D7-06 (P2)** — export « CSV, pas de SEPA au Maroc » → registre `bank_file_formats` par pack/banque.
- **G-D7-09 (P2)**, **G-D7-12 (P2)**, **G-D7-13 (P2)** — 3411, LCN `effet`, 4415/5141, OD frais 6147, mappings Attijari/BP/CIH → `instrument_class='bill'` (couvre aussi la lettre de change OHADA), rôles, `bank_statement_formats` par pack.

**D8 — Comptabilité des achats**
- **G-D8-03 (P0)**, **G-D8-05 (P0)**, **G-D8-09 (P0)** — seed 6588/7588, GR/IR filtré sur `a.code='4417'`, accrual déclenché par `fn_purchasable_kind`, `posting_profiles.account_code` littéral, `purchasable_kind` → `account_roles` + `posting_profiles(event, role_code, item_class…)`, `item_class` générique, lots `stock_lots`.
- **G-D8-15 (P0)** — art. 101 fixe, `non_deductible_reason` en CHECK marocain, `suppliers.ice char(15)` → T4 (`vat_recovery_basis`, `non_deductible_reasons`, `party_identifiers`, état des déductions déclaré par le pack).
- **G-D8-16 (P0)** — périodes calendaires, checklist avec 3121/4417 → `fiscal_years(tenant, start_month)` (exercice décalé) ; items de checklist contribués par les modules actifs.
- **G-D8-07 (P1)**, **G-D8-12 (P1)** — ajustements sur `ingredient_lots`, `v_recipe_direct_cost`, « inventaire intermittent CGNC » → `stock_lots`/`stock_moves`, `costing_method` par tenant ou classe d'article, `stock_accounting_mode` du pack ; coût recette = consommateur optionnel.
- **G-D8-10 (P1)**, **G-D8-14 (P1)**, **G-D8-17 (P1)** — RRR 6119/6129, immobilisations 23xx/28xx et seuil 2 000 DH, lettrage 4411/3421 → rôles, seuil en devise du tenant, `depreciation_methods` par pack.
- **G-D8-06 (P2)**, **G-D8-11 (P2)**, **G-D8-13 (P2)**, **G-D8-19 (P2)** — accrual 4417, `vat_rates` sans pays, frais d'approche vers `ingredient_lots` et `CoutReelPanel`, export « FEC-like » → T3/T4, `accounting_export_formats` par pack (CGNC, SYSCOHADA).

**D9 — Pilotage**
- **G-D9-03 (P0)** — vue sur ingrédient/emballage, provision 4417 → T1, T3.
- **G-D9-09 (P0)** — état des déductions TVA codé en SQL (art. 101, ICE obligatoire, `LIKE 'FR-%'`) → état déclaré par le pack (`report_definitions`), `vat_nondeductible_rules`, `invoices.is_internal_number`.
- **G-D9-10 (P0)** — registre des entrées ONSSA au noyau, sur `ingredient_lots`, écran Économat → `v_goods_entry_register` sur `stock_lots` dans un module « traçabilité » ; mise en forme réglementaire par pack (agro-MA = ONSSA).
- **G-D9-01 (P1)**, **G-D9-02 (P1)**, **G-D9-07 (P1)**, **G-D9-08 (P1)** — cartes sur `ingredient_lots`, `/dashboard/warehouse`, tranches et compte 4411 codés → registre `dashboard_cards` filtré par modules et permissions ; paramètres et rôles.
- **G-D9-04 (P1)** — « MAD/kg », union `ingredient_lots` + `packaging_stock_transactions`, onglet sur `IngredientDetailPage` → `mv_purchase_price_history(tenant, item, supplier, month, base_uom, currency)`, libellé « {devise}/{unité} ».
- **G-D9-12 (P1)** — plafond espèces Maroc → T4.
- **G-D9-13 (P2)** — sensibilité du coût des recettes dans le module Achats → module Production/BOM, via l'événement `item_cost_changed`.
- **G-D9-05 (P2)**, **G-D9-06 (P2)**, **G-D9-14 (P2)**, **G-D9-15 (P2)**, **G-D9-16 (P2)**, **G-D9-11 (P3)** — fournisseurs génériques repérés par leur nom, poids sans tenant, `LIKE 'FR-%'`, règles ICE, délai 3 j codé, `report_definitions.roles` → colonnes booléennes, paramètres tenant, permissions.

**D10 — Transverse**
- **G-D10-01 (P0)**, **G-D10-02 (P1)** — nouveaux rôles ajoutés dans `roles.ts`, `amount_limit` en MAD → `roles(tenant_id…)` + `role_templates` par pack sectoriel ; montants avec devise.
- **G-D10-03 (P0)** — `fn_current_actor()` alias de `fn_production_current_actor` → l'acteur courant appartient au noyau, Production le réutilise ; `tenant_id` sur `audit_log` / `document_actions`.
- **G-D10-04 (P0)** — séquences sans tenant, préfixes `BC-/BR-/LI-` codés, « sans trou » justifié par la DGI → H23 ; drapeau `gapless` venant du pack.
- **G-D10-07 (P0)** — `doc_type CHECK` fermé, conservation art. 211 → `attachment_doc_types(tenant_id NULL = pack)`, `retention_years` du pack.
- **G-D10-08 (P0)** — `v_stock_position.reserved` lit le BSI, `gr.posted` appelle `reallocateRuptures` → `stock_reservations(item, store, source_doc_type, source_id, qty)` alimentées par les modules ; abonnement par événement (T7).
- **G-D10-10 (P0)** — zod `ice ^\d{15}$` et CHECK `chk_ice` → raffinement zod partagé lisant `country_id_types.regex`.
- **G-D10-15 (P0)** — chaîne de traçabilité `ingredient_lots → production_lot_usage → semi_finished_lots → product_lots` câblée, `recalls.lot_type CHECK` → `lot_genealogy(parent_lot_id, child_lot_id, qty, uom, doc_type, doc_id)` écrite par chaque module ; `fn_trace_up/down` génériques.
- **G-D10-05 (P1)**, **G-D10-06 (P1)**, **G-D10-09 (P1)** — `source_type CHECK ('bsi_line','plan_need')`, canal `whatsapp` en CHECK, `company_settings.ice/if/rc/tp/cnss`, langue `fr` par défaut → registres `document_types` et `event_catalog` contribués par les modules, `notification_channels` enfichables, `company_legal_ids`, locale du tenant.
- **G-D10-19 (P1)**, **G-D10-16 (P2)** (tableau seulement) — 10 ans, export FEC, FR/AR seulement → `retention_years` / `export_formats` par pack ; `print_templates(tenant_id NULL = pack, doc_type, locale)`.

## 7. Principes d'architecture : multi-industries dès la refonte, sans sur-ingénierie

Règle d'arbitrage : **on généralise maintenant ce qui figerait le schéma des pièces** (lignes, lots, comptes, taxes, clés de tenant), parce que le corriger après coup coûte une migration de données sur chaque ligne de chaque pièce. **On se contente de prévoir** ce qui s'ajoute plus tard sans toucher aux tables existantes. **On reporte** ce qui n'a pas d'acheteur identifié.

### 7.1 À généraliser maintenant, dans les migrations de la refonte (avant les P0)

1. **Article générique `items`**, avec `item_type` (stock, consumable, service, asset), `category_id`, `base_uom_id`, `tracking` (none/lot/serial ; seuls none et lot sont implémentés), `expiry_tracked`, `shelf_life_days`, `costing_method`, `default_tax_code_id` et `attributes jsonb`.
   - Migration : `ingredients` et `packaging_items` reçoivent un `item_id` 1:1, puis les lignes de pièces basculent sur `item_id`.
   - Les anciennes tables deviennent des vues jusqu'à leur suppression. C'est le préalable à G-D1-07 et G-D4-03, deux P0.
2. **Unités et conversions par article** : `uoms` (système + tenant), `item_uom_conversions`, `supplier_items.purchase_uom_id/qty_per_purchase_uom/multiple`. Le facteur reste figé sur chaque ligne (P3). La densité devient une conversion, les contenants des unités de type « packaging ».
3. **Stock générique** : `stock_locations` (économat et pesage deviennent deux lignes), `stock_lots(item_id…)`, `stock_moves` comme chemin d'écriture unique, `lot_genealogy`. Les colonnes `economat_quantity/pesage_quantity` deviennent une vue de compatibilité pour la Production.
4. **Comptabilité par rôles** : `account_roles(country_pack, role_code, account_code)` + `posting_profiles`. Le pack Maroc (CGNC) est le seul seedé. Le générateur `journal-generator.service.ts` ne contient plus aucun code de compte.
5. **Taxes et seuils fiscaux par pack** : `tax_codes` datés (taux, nature, récupérabilité), `fiscal_thresholds(country_pack…)`, `fiscal_rules(country_pack, rule_code, enabled, params)`, `party_identifiers` + `country_id_types`, `legal_mention_rules`. Seul le pack MA est rempli : TVA, ICE/IF/RC/TP, plafond espèces, TVA au paiement, mentions, conservation 10 ans.
6. **Clés de tenant partout** : `tenant_id` + RLS sur toute nouvelle table. `module_parameters(tenant_id, store_id NULL, module, key, value)` avec catalogue `parameter_definitions` ; `document_sequences(tenant_id, store_id NULL, doc_type, year)` + `numbering_schemes`. Plus aucun drapeau par variable d'environnement (H15).
7. **Permissions par action** : extension de `user_permissions` en `roles` / `role_permissions(module, action, amount_limit, currency)`. Les rôles actuels deviennent un modèle de rôles « boulangerie » appliqué à Ofauria.
8. **Devise et fuseau** : `currency_code` sur chaque pièce et chaque seuil, `tenants.base_currency`, `tenants.timezone`. Un formateur monétaire unique côté client remplace les « DH » en dur.
9. **Découplage Achats ↔ Production** : table outbox `domain_events` (`gr.posted`, `request_line_received`, `item_cost_changed`). La Production s'abonne. Les registres `document_origin_types` / `document_types` sont alimentés par les modules. Aucun import de `bon-sortie.repository` dans le code achats.

Ce lot remplace des choix déjà prévus dans les fiches (`purchasable_kind`, `vat_rates`, `fiscal_thresholds`, `module_parameters`) par leur version générique. Il **n'ajoute pas** de nouvelles fonctionnalités et ne décale aucune P0. Seule G-D1-07 / G-D4-03 grossit, de la création de `items`.

### 7.2 À prévoir dans le schéma, sans l'implémenter

- `tracking = 'serial'` et la table `stock_serials` (électronique, équipements).
- `items.catch_weight` et `qty_secondary` sur les lignes (poids variable).
- `fx_rate` figé sur la pièce et compte d'écart de change par rôle (multi-devises complet : C-D4-15 monte en essentiel, mais le premier client hors MAD n'est pas encore signé).
- Colonnes `einvoice_*` et `vat_recovery_basis` (déjà prévues pour le Maroc).
- `purchase_order_items.sales_order_line_id` (achat lié à une commande client) et `subcontracting` en `order_type`.
- `budget_id` nullable sur la ligne de BC (C-D3-07).
- Un pack pays « SYSCOHADA » vide : rôles comptables, `tax_codes`, `country_id_types` déclarés mais non seedés, pour tester que le moteur ne suppose pas le Maroc.

### 7.3 À reporter

Portail fournisseur (C-D1-11), appels d'offres et enchères (C-D3-06), ASN et conteneurs (C-D5-13), ERS (C-D6-14), OCR (C-D6-13 : l'import CSV suffit d'abord), escompte dynamique (C-D7-12), prévision statistique (C-D2-10), IA (C-D10-14). Côté packs sectoriels : seul le pack « boulangerie-pâtisserie » (agro + production + pesage + allergènes + registre ONSSA) est livré. Les packs distribution, industrie et pharma ne se construisent qu'au premier client signé, sur les points d'extension ci-dessus.

### 7.4 Garde-fous contre la sur-ingénierie

- Pas de table par famille d'articles, pas d'EAV généralisé : `items.attributes jsonb` suffit pour les attributs sectoriels non requêtés.
- Pas de moteur de règles fiscales scriptable : des tables datées et des règles nommées (`CASH_LIMIT`, `VAT_ON_PAYMENT`) codées une seule fois en TypeScript et activées par pack.
- Un seul pack pays réel (MA) tant qu'il n'y a pas de client ailleurs. Le pack vide sert de test.
- Les vues de compatibilité (`ingredients`, `packaging_items`, zones) permettent de migrer module par module. La Production n'est pas réécrite dans la refonte Achats.
- Chaque généralisation de §7.1 doit être vérifiable par un test de bout en bout (C-D10-13) qui fait tourner le flux DA → BC → réception → facture → paiement pour deux tenants : l'un boulangerie au Maroc, l'autre négoce sans lot ni pesage.

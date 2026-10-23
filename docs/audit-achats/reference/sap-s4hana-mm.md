# Référentiel de capacités Achats (procure-to-pay) — SAP S/4HANA Sourcing & Procurement (MM) + SAP Ariba

Document de référence pour la refonte du module Achats d'un ERP de boulangerie-pâtisserie (Maroc, ~40 fournisseurs, ~300 BC/an, ingrédients achetés en sacs/cartons/bidons convertis en kg/L, consommables d'emballage, charges). Lecteur principal : développeur Oracle Forms / PL*SQL. Les analogies Oracle sont volontaires.

Date : 2026-10-11. Vérifications web effectuées sur SAP Learning, SAP Help, SAP Community, KBA SAP, documentation Ariba (voir §5). Les noms de champs/tables SAP cités sont stables depuis ECC et restent valables en S/4HANA (compatibility views) ; les IDs d'apps Fiori proviennent de sources SAP ou secondaires et sont marqués comme tels.

Légende des niveaux :
- **socle** = tout ERP sérieux le fait ; l'absence est un défaut.
- **standard** = attendu d'un ERP moderne ; différencie un module « pro » d'un module « artisanal ».
- **avancé** = différenciant ; rarement justifié en dessous d'un certain volume, mais le pattern de données mérite d'être prévu.

Niveau de confiance : **H** (vérifié sur source SAP), **M** (vérifié sur source secondaire ou cohérent avec plusieurs forums), **B** (connaissance générale non re-vérifiée). Sauf mention contraire : H.

---

## 0. Lecture rapide pour un développeur Oracle Forms / PL*SQL

| Concept SAP | Analogie Oracle / PL*SQL | Ce que ça impose au schéma PostgreSQL maison |
|---|---|---|
| Document (DA, BC, réception, facture) = en-tête + postes + échéancier | Master-detail-detail Forms (bloc en-tête, bloc lignes, bloc dates) | 3 niveaux : `purchase_orders`, `purchase_order_lines`, `purchase_order_schedules` |
| Historique de BC (EKBE) | Table d'historique append-only alimentée par trigger, jamais mise à jour | `po_line_events` (type, signe, qté, valeur, pièce liée) ; les cumuls sont des vues |
| Change documents (CDHDR/CDPOS) | Triggers d'audit `:OLD` / `:NEW` sur chaque colonne | `change_log(table, pk, field, old, new, who, when, tx)` générique |
| Stratégie de libération / flexible workflow | Package PL*SQL d'approbation + table `APPROVAL_STEPS` | `approval_rules` (conditions) → `approval_tasks` (étapes ordonnées) → statut dérivé |
| Compte d'attente GR/IR | Compte de passage « marchandises reçues non facturées » lettré par ligne de BC | solde par ligne = Σ valeur reçue − Σ valeur facturée ; lettrage par `po_line_id`, pas par montant |
| Clés de tolérance (OMR6) | Table de paramètres `TOLERANCES(KEY, LOWER_ABS, LOWER_PCT, UPPER_ABS, UPPER_PCT, CHECK_FLAG)` | même chose, avec surcharge par fournisseur/article dans la fiche info |
| Fiche info-achat (EINA/EINE) | Table d'association `ARTICLE_FOURNISSEUR` avec prix datés | `supplier_items` + `supplier_item_prices` (validité de/à) |
| Type de mouvement (101/102/122/161) | Code transaction stock qui décide signe, compte, motif obligatoire | `stock_movement_types` paramétrés : signe, requires_reason, reverses |

---

## 1. Le processus procure-to-pay tel que SAP le modélise

### 1.1 Chaîne de documents et statuts

```
Besoin                      Demande d'achat (PR, table EBAN)
 ├─ MRP (point de commande, PD)      statut poste : N non traitée → (libération FRGKZ) → B BC créé / A RFQ / K contrat / L prog. livraison
 ├─ manuel / self-service            indicateurs : EBAKZ clôturée, LOEKZ supprimée, ESTKZ origine (R manuel, B MRP, F ordre prod.)
 └─ Guided Buying (Ariba)
        │
        ▼ (optionnel) Appel d'offres RFQ (EKKO type AN) → Devis (quotation, conditions) → comparatif → attribution → fiche info / contrat
        │
        ▼ Détermination de la source : quota → liste de sources → contrat / fiche info-achat
        │
        ▼ Bon de commande (EKKO en-tête, EKPO postes, EKET échéancier, EKKN imputation)
           PROCSTAT : 01 version en cours → 02 actif → 03 en libération → 04 partiellement libéré → 05 libération terminée → 08 refusé
           sortie (message) : imprimé / mail / EDI / Ariba Network → statut message
           confirmations (EKES) : AB accusé de réception, LA avis d'expédition (livraison entrante)
           poste : qté commandée / reçue / facturée ; ELIKZ livraison terminée ; EREKZ facture finale ; LOEKZ supprimé
           versions (EREV) : toute modification « relevante impression » après envoi crée une version avec motif
        │
        ▼ Entrée marchandises MIGO 101 (document article MATDOC ; ex-MKPF/MSEG) + document comptable
           lot (MCH1/MCHA) + DLC (SLED) ; stock : libre / contrôle qualité / bloqué réception (103→105)
           QM : lot de contrôle (QALS) origine 01 → décision d'emploi → libre / bloqué / retour / rebut
           annulation 102 ; retour 122 (motif obligatoire) ; poste de retour 161
           → EKBE (historique du BC) : une ligne par mouvement, par facture, par avoir
        │
        ▼ Facture fournisseur MIRO (RBKP en-tête, RSEG postes) → pièce comptable (BKPF/ACDOCA)
           3-way match par poste : qté facturée vs reçue non facturée ; prix facturé vs prix BC
           hors tolérance (OMR6) → motif de blocage par poste → blocage paiement R en-tête → libération MRBR
           variantes : GR-based IV, ERS (auto-facturation), débit/crédit ultérieur, avoir, frais non planifiés
        │
        ▼ Compte d'attente GR/IR (clé WRX) : débité à la réception, crédité à la facture ; lettrage F.13 ; apurement MR11 ; reclassement F.19
        │
        ▼ Paiement F110 (REGUH/REGUP) : échéance = date de base + jours (ZTERM), escompte, exclusion des blocs, avis de paiement, lettrage
```

### 1.2 Objets et tables (nomenclature stable ECC → S/4HANA)

| Objet | Tables | Clé | Points à retenir |
|---|---|---|---|
| Fournisseur (Business Partner) | BUT000 (général), rôles FLVN00 (compta, par société, ex-LFB1), FLVN01 (achats, par org. achats, ex-LFM1) ; LFA1 conservé en vue | BP number = n° fournisseur | une identité, plusieurs rôles ; les blocages sont par rôle |
| Fiche info-achat | EINA (général : article × fournisseur), EINE (par org. achats/site : prix, délai, tolérances, qtés) | article + fournisseur + org. achats + site | conditions de prix datées via KONP/KONH (A017/A018) |
| Demande d'achat | EBAN (postes), EBKN (imputation) | BANFN + BNFPO | la DA est un document par postes, le statut est par poste |
| RFQ / devis | EKKO/EKPO type AN + conditions | EBELN | le devis est le même document enrichi des prix |
| Contrat / programme de livraison | EKKO/EKPO types MK/WK (contrat qté/valeur), LP/LPA (prog. livraison) + EKET | EBELN | consommation cumulée (release documentation) vs cible |
| Bon de commande | EKKO, EKPO, EKET, EKKN, EKES (confirmations), EREV (versions), EKBE (historique) | EBELN + EBELP (+ ETENR) | EKBE est la source de vérité des quantités reçues/facturées |
| Document article (réception, retour) | MATDOC (S/4) ; vues MKPF/MSEG | MBLNR + MJAHR + ZEILE | type de mouvement (BWART) décide du sens et des comptes |
| Lot | MCH1 / MCHA / MCHB | article + lot | DLC (VFDAT) et date de fabrication (HSDAT) sur le lot |
| Lot de contrôle QM | QALS, QAVE (décision d'emploi) | PRUEFLOS | origine 01 = réception sur BC |
| Facture fournisseur | RBKP (en-tête), RSEG (postes), RBKP_BLOCKED | BELNR + GJAHR | lien poste facture → poste BC (+ réception si GR-based) |
| Pièce comptable | BKPF + ACDOCA (Universal Journal) ; BSEG en compatibilité | BELNR + GJAHR + société | une ligne par imputation ; GR/IR lettré par EBELN/EBELP |
| Paiement | REGUH / REGUP (proposition et run), lettrage dans ACDOCA | n° run + date | plusieurs factures → un paiement ; avis de paiement |
| Audit | CDHDR / CDPOS | objet + n° de changement | ancien/nouveau par champ, utilisateur, transaction |

### 1.3 Le volet Ariba

SAP Ariba couvre l'amont (sourcing, cycle de vie fournisseur, contrats), l'achat indirect guidé (Guided Buying, Buying & Invoicing) et la collaboration fournisseur (Ariba Network, aujourd'hui SAP Business Network) : transmission du BC, confirmation d'ordre, avis d'expédition, facture créée depuis le BC (« PO flip »), rapprochement des factures avec exceptions. S/4HANA reste le système d'enregistrement (stock, comptabilité, paiement) ; Ariba est le système d'engagement (fournisseur et demandeur). Pour une boulangerie, Ariba n'est pas un modèle à copier ; c'est une source de patterns UX (politiques affichées avant soumission, fournisseurs préférés, formulaires guidés) et de collaboration (le fournisseur confirme, annonce, facture à partir du BC).

---

## 2. Capacités par domaine

Colonnes : **Comment ça marche** (objets, statuts, règles, champs clés) ; **Pourquoi** (le problème métier ou financier évité) ; **Niveau**.

### D1 — Référentiel fournisseurs & données d'achat

| # | Capacité | Comment ça marche | Pourquoi c'est important | Niveau |
|---|---|---|---|---|
| C01 | Fournisseur = Business Partner à rôles | Une identité unique (BUT000 : nom, adresses, contacts, identifiants fiscaux) porte des **rôles** : 000000 général (créé automatiquement), FLVN00 « fournisseur comptable » avec données **par société** (compte collectif, modes de paiement, conditions de paiement), FLVN01 « fournisseur achats » avec données **par organisation d'achats** (devise de commande, incoterms, conditions de paiement proposées au BC, indicateur ERS, clé de contrôle de confirmation, groupe acheteur). Un même BP peut aussi être client. | Évite les doublons fournisseur et la confusion entre « qui on paie » et « chez qui on commande » ; permet d'ajouter une société/un site sans dupliquer la fiche. | socle |
| C02 | Blocages différenciés | Trois blocages indépendants : **blocage achats** (plus de BC, mais réceptions et factures sur BC ouverts possibles), **blocage comptable** (plus aucune facture ni paiement), **statut central Bloqué/Archivé**. Un blocage achats seul n'empêche pas la saisie d'une facture ; SAP avertit si des documents sont ouverts au moment du blocage. Apps Fiori : Block Supplier (Purchasing), Block Supplier (Centrally). | Un fournisseur litigieux doit pouvoir être gelé côté commande sans casser la clôture des BC en cours, et inversement. | socle |
| C03 | Fiche info-achat article × fournisseur (purchasing info record) | EINA/EINE : par (article, fournisseur, org. achats, site) : **prix net et conditions à validité**, **délai de livraison planifié** (APLFZ), **qté minimale** (MINBM) et **qté standard** de commande (NORBM), **tolérances de sous/sur-livraison** (UNTTO/UEBTO) et « sur-livraison illimitée » (UEBTK), **unité de commande** et facteur de conversion vers l'unité de base, n° article chez le fournisseur, textes BC, indicateur « pas d'ERS », jours de relance 1/2/3. Les champs sont **copiés dans chaque poste de BC** (puis modifiables). Historique des prix commandés (ME1P) ; app *Monitor Purchasing Info Records Price History* (F2988) ; *Mass Changes to Purchasing Info Records* (F2667). | C'est la mémoire d'achat : sans elle, chaque BC ressaisit prix, conditionnement et délai, et il n'existe aucune base pour détecter une dérive de prix ou un délai anormal. | socle |
| C04 | Conditions de prix datées, échelles, unité de prix | Les prix sont des **conditions** (type PB00 prix brut, RA01 remise %, FRA1/FRB1/FRC1 frais) avec **validité de/à**, **échelles de quantité** (prix dégressif), **unité de prix** (prix pour 1, 10, 100…) et **unité de prix de commande** (OPUn) distincte de l'unité de commande. À la création du BC, la condition valide à la date de livraison est tirée ; le BC conserve ses propres conditions (snapshot). | Un tarif « 1 250 MAD le sac de 25 kg valable du 1/10 au 31/12 » doit être historisé sans écraser l'ancien ; les BC passés ne doivent jamais changer de prix quand le tarif évolue. | standard |
| C05 | Triplet d'unités : commande / base / prix, avec conversions | Chaque poste porte **unité de commande** (MEINS, ex. sac), **unité de base** (LMEIN, ex. kg) avec numérateur/dénominateur (UMREZ/UMREN), et **unité de prix de commande** (BPRME) avec sa propre conversion (BPUMZ/BPUMN). Le stock et la valorisation sont en unité de base ; la réception et la facture saisissent en unité de commande ; les tolérances BR/BW surveillent la variation du rapport OPUn/OUn à la facture. | Les achats « en sacs, cartons, bidons » convertis en kg/L sont exactement ce cas : si la conversion n'est pas portée par le poste (snapshot), un changement de conditionnement chez le fournisseur fausse rétroactivement stock et coût. | socle |
| C06 | Contrats cadres et programmes de livraison | **Contrat quantité (MK)** ou **valeur (WK)** : prix négociés + cible + validité ; les BC d'appel (release orders) y font référence et la **consommation cumulée** est suivie (release documentation) ; alerte d'expiration et de dépassement. **Programme de livraison (LP/LPA)** : un seul document avec **lignes d'échéancier** (dates/quantités) au lieu de BC répétés ; les réceptions se font contre l'échéancier. Apps : Manage Purchase Contracts, Contract Expiry, Off-Contract Spend. | Fige un prix annuel (farine, sucre, beurre) et permet de mesurer les achats « hors contrat » ; le programme de livraison modélise les livraisons récurrentes sans 52 BC. | standard |
| C07 | Liste de sources et répartition de quotas | **Liste de sources** par (article, site) : fournisseurs autorisés avec validité, **source fixe**, **source bloquée**, pertinence MRP (1 = utilisable par le MRP ; 2 = génère des lignes de programme de livraison). **Répartition de quotas** : % par source sur une période ; priorité maximale lors de la détermination automatique ; peut plafonner un contrat (cible = quantité max). App *Manage Sources of Supply*. | Interdit d'acheter un article critique chez un fournisseur non référencé, répartit le volume, et permet au MRP de proposer directement le bon fournisseur. | standard |
| C08 | Clé de valeur d'achat : cascade des valeurs par défaut | La **purchasing value key** (fiche article) regroupe : jours de relance 1/2/3, tolérances sous/sur-livraison, **obligation d'accusé de réception**, qté minimale. Cascade de défaut : fiche article → fiche info-achat → poste de BC (chaque niveau surcharge le précédent ; la valeur finale est **copiée** dans le poste). | Les règles (relancer à J+3, tolérer 5 %) sont saisies une fois et héritées ; le poste garde la valeur appliquée au moment de la commande (auditable). | standard |
| C09 | Cycle de vie fournisseur (Ariba SLP) | Demande de création (formulaire) → **enregistrement** (questionnaire rempli par le fournisseur, pièces : RC, attestation fiscale, certificats) → **qualification** par **matrice catégorie × région** (× département optionnel) avec questionnaires ciblés → **segmentation / fournisseur préféré** sur 5 niveaux (1 = le plus préféré) → **re-qualification** périodique ; disqualification retire automatiquement le statut préféré ; statut partagé avec Guided Buying et Sourcing. Scorecards KPI (qualité, prix, OTD) par fournisseur. | Donne un statut opposable (« qualifié pour les produits laitiers, région X ») au lieu d'un simple actif/inactif ; documente pourquoi un fournisseur est préféré. | avancé |

Transposition boulangerie : C01, C02, C03, C05 sont incontournables (un fournisseur unique avec données compta et achats ; une fiche article × fournisseur qui porte prix daté, conditionnement et conversion). C06 se réduit à « tarif annuel négocié » avec suivi du hors-tarif ; C07 à « fournisseurs autorisés / préféré / bloqué par article » ; C09 à un statut de qualification avec pièces et date de revue.

### D2 — Besoins & demandes d'achat

| # | Capacité | Comment ça marche | Pourquoi c'est important | Niveau |
|---|---|---|---|---|
| C10 | Demande d'achat par postes avec statut de traitement | EBAN : un poste = article (ou texte libre), qté, date de besoin, site, imputation, groupe acheteur, source éventuelle. **Statut de traitement par poste** (STATU) : N non traitée, A RFQ créée, B BC créé, K contrat créé, L prog. livraison créé ; **qté commandée** (BSMNG) vs demandée ; **indicateur de clôture** (EBAKZ, manuel : « on ne commandera pas le reste ») ; **indicateur de suppression** (LOEKZ, logique) ; **indicateur de libération** (FRGKZ/FRGZU) si approbation requise. Reliquat = demandé − commandé tant que non clôturé. | Une DA partiellement convertie reste visible avec son reliquat ; une DA abandonnée est clôturée avec trace, jamais effacée. | socle |
| C11 | Origine et traçabilité de la DA | **Indicateur de création** (ESTKZ) : R manuelle, B MRP, F ordre de production, U transfert, etc. ; demandeur (AFNAM), n° de suivi (BEDNR), lien vers l'ordre/plan d'origine ; une DA MRP est **écrasée/recalculée** au prochain run tant qu'elle n'est pas « fixée » (fixing indicator) ; une DA manuelle ne l'est jamais. | Permet de distinguer « le système l'a proposé » de « quelqu'un l'a demandé », et d'empêcher le MRP d'effacer une décision humaine. | socle |
| C12 | Réapprovisionnement par point de commande (MRP VB/VM) | Type MRP **VB** (point de commande manuel) ou **VM** (automatique, calculé depuis les consommations) : quand stock disponible + réceptions attendues < point de commande, création d'une DA pour atteindre la qté de lot (EX exact, FX fixe, HB « jusqu'au stock max »). Point de commande = stock de sécurité + conso journalière × **délai de réapprovisionnement** (délai de traitement achat [paramètre site] + délai planifié fournisseur [fiche article ou info-achat] + délai de contrôle réception). App *Monitor Material Coverage* : vue des ruptures prévisionnelles multi-sites, lancement MRP. | Remplace la « rupture constatée » par une « rupture anticipée » : la DA est émise quand il reste exactement le temps de livrer. | standard |
| C13 | MRP déterministe lié à la production et lot sizing | Type **PD** : les besoins viennent des ordres/plans de production (BOM éclatée) ; ordres planifiés → DA à la date « besoin − délai ». Régimes de lot : EX, FX, HB, périodique (TB/WB) ; **horizon de planification** ; **MRP Live** sur HANA en temps réel. | Les ingrédients à faible rotation ou coûteux sont commandés pour le plan réel, pas sur un seuil. | standard |
| C14 | Détermination automatique de la source et regroupement DA → BC | Ordre de priorité : **quota** → **liste de sources** → **contrat / programme** → **fiche info-achat** (unique ou choix). Un poste de DA affecté à une source peut être converti automatiquement (ME59N) ; les postes d'un même fournisseur / org. achats / devise / conditions sont **regroupés dans un BC** ; les postes sans source tombent dans une corbeille « à affecter ». | Un BC propre par fournisseur sans ressaisie ; les DA « orphelines » sont visibles. | standard |
| C15 | Achat guidé (Ariba Guided Buying) : catalogue, non-catalogue, politiques, fournisseurs préférés | Le demandeur voit un **catalogue** (interne ou punch-out OCI/cXML) ; à défaut, un **formulaire non-catalogue** (description, qté, prix estimé, fournisseur suggéré) ; les **politiques** (ex. « au-delà de X MAD, 3 devis », « fournisseur non préféré → justification ») sont **affichées avant soumission** et peuvent bloquer ou exiger une exception ; les fournisseurs **préférés/qualifiés** (SLP) sont mis en avant ; une demande peut déclencher un **RFQ tactique** automatique vers N fournisseurs préférés. | Déplace le contrôle au moment de la saisie plutôt qu'au rejet a posteriori ; réduit les achats sauvages. | avancé |

Transposition boulangerie : C10 et C11 structurent les « demandes d'achat / ruptures » existantes ; C12 est la cible réaliste (point de commande par ingrédient avec délai fournisseur depuis la fiche info) ; C13 correspond aux besoins issus des plans de production (déjà présents côté production) ; C15 inspire la saisie côté demandeur (politiques visibles, fournisseur préféré proposé).

### D3 — Sourcing & approbation

| # | Capacité | Comment ça marche | Pourquoi c'est important | Niveau |
|---|---|---|---|---|
| C16 | Appel d'offres → devis → comparatif → attribution | **RFQ** (document type AN) créé depuis une DA ou à vide, envoyé à N fournisseurs (une RFQ par fournisseur, liées par un **n° collectif**) ; le **devis** est la même RFQ complétée des prix/conditions/délai ; **comparatif des prix** (ME49 / *Compare Supplier Quotations*) classe par prix net total, met en évidence la moins chère ligne à ligne ; attribution → BC ou contrat ; **lettre de refus** aux autres ; option « mettre à jour la fiche info-achat » avec le prix retenu. | Le prix négocié entre dans la mémoire d'achat ; la décision est documentée (qui a proposé quoi, pourquoi retenu). | standard |
| C17 | Stratégie de libération classique (release strategy) | Classification par **caractéristiques** (type de document, org. achats, groupe acheteur, valeur nette totale, site, imputation…) → **stratégie** = suite ordonnée de **codes de libération** (ex. 01 responsable achats, 02 DG > 50 000) ; statut : bloqué / partiellement libéré / libéré ; **effet** : le BC ne peut être **imprimé/envoyé** qu'une fois libéré ; toute **modification significative** après libération **réinitialise** la libération (paramétrable : à partir de quel % de hausse de valeur). Pour les DA : libération par poste ou globale. | Séparation des tâches et plafond d'engagement ; aucune commande ne part chez le fournisseur sans l'approbation prévue. | socle |
| C18 | Flexible workflow S/4HANA | Activé **par type de document** (sinon retour à la stratégie classique). App *Manage Workflows for Purchase Orders / Requisitions / Contracts* : **conditions de démarrage** (société, org. achats, groupe acheteur, type doc, devise, **montant net total**, imputation centre de coûts/projet, groupe de marchandises sur au moins un poste) combinables ET/OU ; **étapes** séquentielles ou parallèles, approbateur = utilisateur(s), rôle, responsable hiérarchique, ou règle custom (BAdI) ; **préconditions par étape** ; les workflows sont évalués **de haut en bas, un seul démarre** ; les brouillons ne déclenchent rien ; tâches dans *My Inbox* avec approuver / refuser / renvoyer ; réinitialisation sur modification. | Le circuit d'approbation devient paramétrage (table de règles) plutôt que code ; un seul moteur pour DA, BC, contrats, factures. | standard |
| C19 | Engagements et contrôle budgétaire | Une DA/BC imputée (centre de coûts, ordre, projet) crée un **engagement** (commitment) dans le contrôle de gestion, réduit à la réception/facture ; en Funds Management, **contrôle de disponibilité** : avertissement ou blocage si le budget de la période est dépassé. | Le budget « emballages » ou « maintenance » est consommé dès la commande, pas découvert à la facture. | standard |
| C20 | Délégation / substitution d'approbateur | Dans *My Inbox* : **substitut** actif/planifié (dates), reprise des tâches ; l'historique conserve qui a réellement approuvé pour le compte de qui ; relances automatiques de tâches en attente (deadline). | Un BC n'est pas bloqué parce que l'approbateur est absent, et l'audit reste exact. | standard |
| C21 | Événements de sourcing (Ariba Sourcing) | RFI / RFP / **enchère inverse** ; grilles de **scoring pondéré** (prix, qualité, délai, questionnaire), pièces jointes, Q&A, dates d'ouverture/fermeture, **award** soumis à approbation ; politiques type « bid competitif à ≥ 3 fournisseurs » définies par l'acheteur ; résultat → contrat / BC. | Formalise les mises en concurrence et leur justification. | avancé |

Transposition boulangerie : C17/C18 se réduisent à une table de règles (type de BC, montant, catégorie) → étapes d'approbation, avec reset sur modification ; C16 à un « comparatif de devis » simple rattaché à la DA et alimentant la fiche info ; C19 à un suivi d'engagement par catégorie de charge si un budget existe.

### D4 — Commande fournisseur (BC) : cycle de vie

| # | Capacité | Comment ça marche | Pourquoi c'est important | Niveau |
|---|---|---|---|---|
| C22 | Types de document, catégories de poste, numérotation | **Types** (BSART) : NB standard, **FO commande cadre** (limite de valeur + période de validité, pas de réception, factures directes jusqu'à la limite, clôture par « facture finale »), UB transfert inter-sites, retour ; chaque type a sa **tranche de numéros** (interne séquentielle ou externe), ses champs obligatoires, sa stratégie de libération, ses sorties. **Catégories de poste** (PSTYP) : standard, **K consignation** (stock fournisseur chez nous, réglé à la consommation via MRKO), L sous-traitance, D service, B limite ; **poste de retour** (RETPO). | Les règles diffèrent par nature de commande (ingrédient stocké, charge, abonnement) ; la numérotation par type est lisible et jamais réutilisée. | socle |
| C23 | Structure en-tête / postes / échéancier | **En-tête** (EKKO) : fournisseur, org. achats, groupe acheteur, devise + taux figé, conditions de paiement, incoterms, date. **Poste** (EKPO) : article, qté, unités (C05), prix net, imputation, site, tolérances, indicateurs GR attendu / IR attendu / GR-based IV / ERS, code taxe. **Échéancier** (EKET) : **plusieurs dates de livraison par poste** avec qté par date et qté reçue par date. | Une commande « 40 sacs : 20 lundi, 20 jeudi » est un poste à deux lignes d'échéancier, pas deux postes ni deux BC. | socle |
| C24 | Statut de poste dérivé des quantités + indicateurs explicites | Par poste : **qté commandée**, **qté reçue** (Σ EKBE type E, signée), **qté facturée** (Σ EKBE type Q), **à recevoir** = commandée − reçue (si non ELIKZ), **à facturer** = reçue − facturée (GR-based) ; valeurs idem. Indicateurs : **ELIKZ livraison terminée** (auto si dans tolérance, ou manuel), **EREKZ facture finale** (manuel), **LOEKZ supprimé**, blocage poste. Le statut d'en-tête (ouvert / partiellement livré / livré / facturé / clôturé) est une **agrégation** des postes, jamais saisi. Onglet « Status » du poste et apps *Monitor Purchase Order Items*. | Évite le champ « statut » unique mis à jour à la main : la réalité est reconstruite depuis les mouvements, et un reliquat de 2 sacs ne bloque pas la clôture si on le déclare terminé. | socle |
| C25 | Gestion des versions (version management) | Activée par type de document. Version 0 = création. Après **libération terminée et envoi des messages**, toute modification d'un **champ relevant pour l'impression** (prix net si paramétré, qté, date, adresse, affectation) crée une **nouvelle version** (EREV) avec **motif de modification** (table de motifs), texte, demandeur, et indicateur **« terminé »** que l'utilisateur coche quand ses modifications sont finies ; la **réimpression / renvoi** au fournisseur n'est possible qu'après complétion ; une version en cours (PROCSTAT 01) bloque l'enregistrement si le motif obligatoire manque. Pas de version pour un BC en attente (hold). | Un avenant au fournisseur est un objet traçable (version 2 du BC 4500001234, motif « hausse prix farine »), pas une mise à jour silencieuse. | standard |
| C26 | Change documents (journal des modifications) | CDHDR/CDPOS : pour chaque sauvegarde, une entrée par champ modifié : **ancienne valeur / nouvelle valeur**, utilisateur, date-heure, transaction ; visibles depuis le BC (en-tête / poste) ; indépendants de l'historique des mouvements (EKBE) et des versions (EREV). | Répond à « qui a changé la quantité de 40 à 60 et quand » sans dépendre de la mémoire des gens. | socle |
| C27 | Sortie et envoi au fournisseur (output management) | **Détermination de message** : type (NEU nouveau BC, AEND modification, MAHN relance, AUFB relance AR), **support** (impression, mail PDF, EDI/cXML vers Ariba Network), destinataire (contact fournisseur, langue), **condition : libéré uniquement** ; statut du message (non traité / envoyé / erreur) et horodatage ; le renvoi après modification porte le n° de version. S/4 : Output Management BRF+ / Adobe Forms. | Le fournisseur reçoit exactement la version approuvée ; on sait quand il l'a reçue. | socle |
| C28 | Confirmations fournisseur (clé de contrôle de confirmation) | Par poste, une **clé de contrôle** (BSTAE) définit la **séquence de confirmations attendues** : **AB accusé de réception** (n° AR, date et qté confirmées), **LA avis d'expédition** (= **livraison entrante**, inbound delivery, avec n° de lot/colis), chacune **pertinente MRP** (les dates confirmées remplacent les dates du BC dans le calcul de couverture) et la dernière **pertinente réception** (la réception se fait contre la livraison entrante). Indicateur **« AR obligatoire »** (KZABS) ; table EKES ; app *Monitor Supplier Confirmations* (non confirmés, écart date/qté). | Distingue « commandé » de « promis » ; la rupture se calcule sur ce que le fournisseur a confirmé ; un AR manquant est relançable. | standard |
| C29 | Relances fournisseur (expediting / urging) | Poste : **jours de relance 1/2/3** (MAHN1-3, hérités C08) relatifs à la **date de livraison** (ou de l'AR attendu). Programme **ME91F / ME91FF (BRF+)** : sélectionne les postes en retard sans réception complète, génère message **MAHN** niveau 1, 2, 3 (ton croissant), mémorise le niveau atteint ; relance d'**AR manquant** (AUFB). Pré-requis : message initial envoyé. | Le retard est détecté par le système à J+1, pas par la production à l'ouverture du frigo. | standard |
| C30 | Mise en attente, suppression logique, blocage, clôture / réouverture, modifications de masse | **Hold** (brouillon sans contrôle complet, pas de n° définitif de version), **Park**. **Suppression logique** de poste (LOEKZ ; réactivable ; interdite si réceptions/factures existent au-delà), **blocage** de poste (plus de réception), **clôture** = ELIKZ + EREKZ (manuel si reliquat accepté), **réouverture** = retrait de ELIKZ (à condition de ne pas dépasser la qté commandée). Jamais de DELETE physique d'un BC envoyé. App *Mass Changes to Purchase Orders* (dates, groupe acheteur, indicateurs). | Les cas réels (fournisseur ne livrera pas le reste, livraison supplémentaire après clôture) ont une action explicite et auditable. | socle |
| C31 | Collaboration fournisseur (Ariba / SAP Business Network) | Le BC est transmis en cXML ; le fournisseur **confirme** (total/partiel, avec dates et prix → crée AB), émet un **avis d'expédition** (→ LA / livraison entrante), puis **crée la facture depuis le BC (« PO flip »)** : lignes pré-remplies, **quantité facturable ≤ reste à facturer**, **prix non modifiable** sauf règle acheteur ; les lignes peuvent être exclues et facturées plus tard ; statuts de facture visibles par le fournisseur (reçue, en rapprochement, rejetée avec motif, approuvée, payée) ; une facture rejetée est corrigée et **resoumise**, jamais annulée par le fournisseur. | Supprime la ressaisie des factures et les écarts de forme ; le fournisseur voit où en est son paiement et appelle moins. | avancé |

Transposition boulangerie : C22-C24, C26, C27, C30 sont le cœur de la refonte (types de BC, échéancier, statut dérivé, journal, envoi PDF/WhatsApp/mail horodaté, clôture avec reliquat). C25 se réduit à un compteur de version + motif + snapshot des postes à chaque envoi. C28/C29 : un AR fournisseur (date promise) et une relance automatique à J+N suffisent. C31 : un portail fournisseur minimal (confirmer, annoncer, téléverser la facture) est envisageable plus tard.

### D5 — Réception & qualité

| # | Capacité | Comment ça marche | Pourquoi c'est important | Niveau |
|---|---|---|---|---|
| C32 | Entrée marchandises référencée au BC (MIGO, mouvement 101) | Sélection du BC (ou de la livraison entrante) → proposition des **postes ouverts avec reliquat** ; saisie **en unité de commande** (sacs) convertie en unité de base (kg) via le poste ; **lot**, **date de fabrication / DLC**, **zone de stockage**, n° de bon de livraison fournisseur, **date de livraison réelle** (vs date prévue : base du score délai) ; crée **document article** (stock +) et **document comptable** (Dt stock ou charge, Ct GR/IR) au **prix du BC** ; une ligne EKBE par poste. Réception possible **sans BC** (501) mais identifiée comme telle. | La réception est la seule porte d'entrée du stock et de la dette fournisseur provisoire ; sa référence au BC rend le 3-way match possible. | socle |
| C33 | Livraisons partielles, tolérances de sous/sur-livraison, clôture automatique | Une réception peut être partielle : le reliquat reste ouvert, visible et relançable. **Sous-livraison tolérée %** (UNTTO) : si la réception est ≥ commandé × (1 − tol), le système coche **ELIKZ automatiquement** (paramétrable par site). **Sur-livraison** : au-delà de UEBTO %, message d'**erreur** (ou avertissement), sauf « illimitée ». Réception d'un **reliquat après ELIKZ** possible si l'indicateur est retiré. | 24,6 kg livrés pour 25 kg commandés ne doit pas laisser un reliquat fantôme de 0,4 kg ; 60 sacs pour 40 commandés ne doit pas passer sans alerte. | socle |
| C34 | Annulation (102) vs retour fournisseur (122 / 161) | **102** = annulation d'une réception (erreur de saisie) : écriture inverse exacte, référence au document annulé. **122** = **retour fournisseur** sur une réception existante : même effet stock/compta, mais **motif obligatoire** (table de motifs : abîmé, DLC courte, non conforme…) et statistiques de retours ; **123** annule un 122. **161** = poste de retour sur BC (RETPO) : le BC prévoit le retour, la « réception » le sort. 124/125 pour le stock bloqué réception. Le retour alimente l'évaluation qualité et déclenche un **avoir** attendu. | Un retour n'est pas une annulation : il pèse sur le fournisseur, crée une créance (avoir) et doit être justifié. | socle |
| C35 | Lots et DLC (shelf life) | Article géré par lot : **lot** = n° fournisseur ou interne ; **DLC** (SLED/VFDAT) soit saisie, soit calculée = **date de fabrication + durée de vie totale** (fiche article) ; contrôle à la réception de la **durée de vie restante minimale** (fiche article ou poste de BC) → message 12 007 « shortfall of N days » en **avertissement ou erreur** (paramétrage site/mouvement) ; la DLC est stockée **sur le lot** et contrôlée en cohérence à chaque réception du même lot ; sortie FEFO possible. | Refuser (ou tracer l'acceptation d') une matière qui périme avant usage ; retrouver tous les produits fabriqués avec le lot L123 en cas de rappel. | standard |
| C36 | Stock bloqué réception (103 → 105) | **103** : réception en « stock bloqué réception » (non valorisé, non disponible, pas dans le stock du site) en attente de décision ; **105** : libération vers le stock (valorisation à ce moment) ; **124** : retour depuis le stock bloqué. Le BC voit la qté « en bloqué ». | Permet de décharger le camion sans accepter : la marchandise est tracée mais ni utilisable ni payée. | standard |
| C37 | Contrôle qualité à la réception (QM) | Fiche article avec **type de contrôle 01 actif** : la réception 101 crée un **lot de contrôle** (origine 01) et le stock va en **« contrôle qualité »** (non disponible pour la production) ; saisie de **résultats** (caractéristiques : température, aspect, poids net, certificat) ; **décision d'emploi** : accepté → stock libre ; refusé → **bloqué**, **retour fournisseur**, **rebut**, ou autre lot ; la décision alimente le **score qualité** du fournisseur (C63). | Rend le contrôle à la réception opposable (qui a contrôlé quoi) et empêche l'usage d'une matière non validée. | avancé |
| C38 | Historique du BC (EKBE) et document flow | Table **append-only** : une ligne par événement lié à un poste : **E réception** (101/102/122, signée), **Q facture** (avec qté et montant), **débit/crédit ultérieur**, acompte, livraison entrante ; chaque ligne porte **n° de pièce / exercice / ligne**, lot, date, montant en devise BC et société, et pour GR-based IV la **référence à la réception** (LFBNR). Les cumuls (reçu, facturé, à facturer) sont **calculés** depuis EKBE. Navigation **document flow** : BC → réceptions → factures → paiements, et inverse. | Un seul journal explique toutes les quantités et valeurs d'un poste ; aucun compteur dénormalisé à resynchroniser. | socle |

Transposition boulangerie : C32-C34 et C38 sont le socle (réception en contenants, partielle, tolérances, annulation vs retour avec motif, historique append-only) ; C35 est déjà partiellement couvert (lots/DLC en pesage) et doit être branché à la réception ; C36/C37 se réduisent à un statut de réception « à contrôler / accepté / refusé » avec motif et photo.

### D6 — Facturation fournisseur & rapprochement

| # | Capacité | Comment ça marche | Pourquoi c'est important | Niveau |
|---|---|---|---|---|
| C39 | Saisie de facture référencée au BC (MIRO) | Référence : **BC**, livraison entrante, bon de livraison, ou fournisseur (toutes réceptions non facturées) → **proposition des postes** avec qté et montant **à facturer** (reçu − facturé) ; saisie **montant total TTC facture**, date facture, **date comptable**, **référence fournisseur** (n° facture) avec **contrôle de doublon** (fournisseur + référence + date + montant, paramétrable) ; **solde = 0** obligatoire pour comptabiliser (écart → petite différence BD ou blocage) ; **code taxe par poste** (TVA 20/14/10/7/0 % au Maroc) avec calcul auto et contrôle du total TVA ; pièce jointe (scan) ; **frais non planifiés** (C48). | Rend impossible la saisie d'une facture qui ne « tombe pas juste » ou qui a déjà été saisie ; la TVA par ligne suit les taux réels. | socle |
| C40 | Rapprochement 3-way match par poste (BC / réception / facture) | Pour chaque poste facturé : **écart quantité** = qté facturée − (qté reçue − qté déjà facturée) ; **écart prix** = (prix facturé − prix BC) × qté ; **écart unité de prix** (BR/BW) ; **écart date** (ST : facture avant date prévue). Les écarts sont évalués contre les **tolérances** (C42) et produisent des **motifs de blocage par poste** (C43). Le rapprochement est **par poste**, jamais par total. | Une facture conforme en total peut cacher +10 % sur la farine et −10 % sur le sucre ; le match par ligne les voit. | socle |
| C41 | Facturation sur réception (GR-based IV) vs sur BC | Indicateur **WEBRE** sur le poste (hérité du fournisseur/fiche info) : la facture se rapproche **réception par réception** (chaque réception = une ligne facturable avec son n° de bon de livraison), ce qui impose qu'une **réception existe avant la facture** et permet d'identifier quelle livraison est facturée ; sans l'indicateur, le rapprochement est **cumulé** par poste (facture possible avant réception → compte GR/IR en « facturé non reçu »). Pré-requis de l'ERS. | Avec des livraisons hebdomadaires et une facture mensuelle, seul le GR-based IV dit quelle livraison manque sur la facture. | standard |
| C42 | Clés de tolérance (OMR6) | Par société et **clé** : limite **inférieure / supérieure**, chacune en **absolu** et/ou en **%**, avec options **ne pas contrôler** / **contrôler la limite** ; **0 + contrôler** = toujours bloquer. Clés : **PP** écart prix (vs BC), **PS** écart prix avec prix estimé, **KW** écart sur valeur de condition (frais), **DQ** écart quantité (valorisé au prix BC) et **DW** quantité quand réception = 0, **BR/BW** écart unité de prix (facture avant / après réception), **ST** écart de date (jours), **AN/AP** montant de poste sans / avec référence BC, **BD** petites différences (comptabilisées automatiquement en écart, jamais bloquantes), **LA/LD** limites de commande cadre (montant / jours hors validité), **VP** variation du prix moyen pondéré. Sous la limite inférieure : message sans blocage ; au-dessus de la limite supérieure : **comptabilisée mais bloquée pour paiement**. | Le « on accepte 2 % ou 50 MAD » devient un paramètre par type d'écart, auditable, au lieu d'un jugement au cas par cas. | standard |
| C43 | Blocage de paiement : motifs par poste → blocage R en-tête → libération | Chaque poste hors tolérance reçoit un **motif de blocage** (Q quantité, P prix, D date, M qté/prix unité, I montant, G commande cadre) ; dès qu'un poste est bloqué, **toute la facture** reçoit **blocage paiement R** (sur la ligne fournisseur de la pièce comptable). **MRBR** : libération **automatique** si le motif a disparu (ex. la réception manquante est arrivée) ou **manuelle** par un rôle habilité, avec option **« décaler la date d'escompte »** pour ne pas perdre l'escompte à cause du blocage. Aussi : **blocage stochastique** (seuil + % de probabilité, contrôle aléatoire), **blocage manuel** en-tête, blocage issu des conditions de paiement. Table RBKP_BLOCKED, app *Release Blocked Invoices*. | La facture est enregistrée (TVA, dette, charge) mais ne sera pas payée tant que l'écart n'est pas résolu ; le blocage se lève tout seul quand la cause disparaît. | socle |
| C44 | Factures sans BC (charges, abonnements) | **FB60 / Create Supplier Invoice sans référence** : imputation directe compte de charge + centre de coûts (ou **commande cadre FO** avec limite), code taxe par ligne, mêmes contrôles de doublon, mêmes conditions de paiement, même workflow d'approbation (montant, catégorie), mêmes échéances. Catégorisation par **catégorie de dépense** pour l'analytique. | Les charges (loyer, électricité, maintenance) restent dans le même flux paiements/échéances que les achats, avec approbation. | socle |
| C45 | Avoirs : avoir référencé vs débit / crédit ultérieur | **Avoir (credit memo)** : annule quantité **et** valeur, référencé au BC et typiquement à un **retour 122** ; passe par le compte GR/IR. **Débit ultérieur** : coût additionnel sur un poste **déjà facturé** sans changement de quantité (transport facturé après coup, ajustement de prix) ; **crédit ultérieur** : ristourne / correction de prix, quantité inchangée ; ni l'un ni l'autre ne référence une facture précise ; qté max = qté déjà facturée ; apparaissent comme lignes distinctes dans EKBE et modifient le **statut valeur** du poste. | « Le fournisseur reprend 2 sacs » (avoir, qté) et « le fournisseur accorde 500 MAD » (crédit ultérieur, valeur) ne sont pas la même opération comptable ni stock. | socle |
| C46 | Auto-facturation sur réception (ERS) | Fournisseur flagué **ERS** (rôle achats) + poste **ERS** + **GR-based IV** + **conditions de paiement** en-tête + **code taxe** poste + prix non « estimé ». Le run **MRRL** crée automatiquement la facture pour chaque réception non réglée, au prix BC, et émet au fournisseur un **relevé / note de crédit informative** ; exclusion possible par fiche info (« pas d'ERS »). | Zéro facture à saisir pour les fournisseurs réguliers de confiance : la réception vaut facture ; les écarts disparaissent par construction. | avancé |
| C47 | Pré-enregistrement, workflow facture, rapprochement Ariba | **Park / Hold** : facture saisie sans comptabilisation (incomplète, en attente d'approbation) ; **workflow d'approbation facture** (montant, imputation, absence de BC) ; pièces jointes, OCR (SAP Document & Reporting Compliance / Ariba). Ariba Network : la facture reçue est **conservée intacte** et une **copie « Invoice Reconciliation »** porte les **exceptions** (prix hors tolérance, unité incorrecte, BC épuisé, réception manquante) ; traitement **touchless** si aucune exception ; exceptions résolues par ajustement du BC, paiement partiel, ou **rejet avec motif** → fournisseur corrige et resoumet. | La facture originale n'est jamais altérée ; ce qui est modifié est une copie de travail avec journal des exceptions. | standard |
| C48 | Frais de livraison planifiés et non planifiés (landed cost côté facture) | **Planifiés** : conditions **FRA1/FRB1/FRC1** (transport %, fixe, par qté) sur le poste de BC → à la réception, provisionnés sur un **compte d'attente frais** dédié (par type de frais) et **inclus dans la valeur d'entrée en stock** ; la facture du transporteur (**tiers différent du fournisseur**) apure le compte d'attente ; écart traité comme écart de prix. **Non planifiés** : montant saisi en en-tête de facture, **réparti au prorata de la valeur (ou qté) des postes** sur le stock, ou **comptabilisé sur un compte dédié**, ou en débit ultérieur (BAdI de répartition). | Le coût d'un kg de farine inclut le transport ; les frais découverts à la facture ne restent pas « en charge diverse ». | standard |

Transposition boulangerie : C39, C40, C43, C44, C45 sont indispensables (facture référencée, match par ligne, blocage automatique avec motif, factures de charges dans le même flux, avoir vs crédit ultérieur). C42 se réduit à 4-5 clés (prix %, prix absolu, quantité, petites différences, montant sans BC). C41 est à prévoir dès le schéma (lien facture → réception) même si l'écran reste simple. C46 est pertinent pour 2-3 fournisseurs réguliers. C48 : au minimum répartir un transport au prorata de la valeur.

### D7 — Paiements & trésorerie fournisseurs

| # | Capacité | Comment ça marche | Pourquoi c'est important | Niveau |
|---|---|---|---|---|
| C49 | Conditions de paiement (ZTERM) | Clé de conditions : **date de base** (date facture / date comptable / date de saisie, ± jours fixes, « fin de mois »), **jours nets**, jusqu'à **3 paliers d'escompte** (ex. 2 % à 10 j, 1 % à 20 j, net 30), **paiement échelonné** (installments %), blocage paiement par défaut. Héritée : BP compta (par société) → proposée au BC (rôle achats) → copiée sur la facture (modifiable). Échéance = f(date de base, conditions). | Le calcul d'échéance et d'escompte est systématique et identique pour tous ; la facture conserve les conditions appliquées. | socle |
| C50 | Modes de paiement, coordonnées bancaires, blocages fournisseur | Par fournisseur et société : **modes autorisés** (virement, chèque, LCN, espèces), **RIB** multiples avec contrôle (RIB/IBAN), **blocage paiement** au niveau fournisseur (indépendant des blocages facture), **regroupement des paiements** (une facture = un paiement ou regroupé), bénéficiaire alternatif (payeur différent). | Évite le virement sur un mauvais RIB et permet de geler un fournisseur sans toucher ses factures. | socle |
| C51 | Programme de paiement automatique (F110 / Schedule Payment Proposals) | Paramètres du run : date d'exécution, **date de prochain run** (pour décider « payer maintenant ou au prochain »), sociétés, modes, fournisseurs ; **proposition** : factures échues ou dont l'**escompte** serait perdu avant le prochain run, **exclusion des blocs** (R, manuel, stochastique), log des exceptions (RIB manquant, bloqué) ; **édition de la proposition** (retirer, débloquer) ; **run** : pièce de paiement, **lettrage** des factures, fichier bancaire / chèques, **avis de paiement** (remittance advice) au fournisseur. | Le « quoi payer cette semaine » est une proposition calculée et révisable, avec trace de ce qui a été retiré et pourquoi. | standard |
| C52 | Échéancier, balance âgée, analyse d'escompte | **Postes non lettrés** par fournisseur (*Manage Supplier Line Items*) : échéance, jours de retard, bloqué/non ; **balance âgée** par tranches (non échu, 0-30, 31-60, 61-90, > 90) et par fournisseur ; **prévision de décaissement** par semaine ; *Supplier Payment Analysis* (F1750), *Cash Discount Forecast* (F1735) et *Utilization* (F1736, IDs : source secondaire) : escompte disponible vs pris. | La trésorerie se pilote sur une courbe d'échéances, pas sur une pile de factures. | standard |
| C53 | Acomptes fournisseur | **Demande d'acompte** (down payment request, poste statistique) rattachée au **BC** → **acompte** payé (compte spécial, visible dans l'historique du BC) → à la facture finale, **compensation** de l'acompte (clearing) ; blocage si acompte non compensé. | Un acompte versé pour un four ou une grosse commande de matière est suivi jusqu'à la facture qui l'absorbe. | standard |
| C54 | Escompte dynamique (Ariba Payables / Discount Management) | Le fournisseur propose ou accepte un **escompte proportionnel à l'anticipation** (courbe jours → %) sur les factures approuvées ; l'acheteur paie plus tôt en échange ; intégration au run de paiement. | Transforme la trésorerie excédentaire en marge ; pattern utile même en manuel (« si on paie à 10 j, −1,5 % »). | avancé |

Transposition boulangerie : C49, C50, C52 sont le socle d'un vrai suivi fournisseurs (échéance calculée, RIB, balance âgée) ; C51 se réduit à une « proposition de paiement de la semaine » éditable avec exclusion des factures bloquées ; C53 si acomptes sur équipements ; C54 à ignorer.

### D8 — Comptabilité des achats

| # | Capacité | Comment ça marche | Pourquoi c'est important | Niveau |
|---|---|---|---|---|
| C55 | Compte d'attente GR/IR (WRX) : provision, lettrage, apurement | **Réception** : Dt stock (ou charge) / Ct **GR/IR** au prix BC. **Facture** : Dt GR/IR / Ct fournisseur (+ TVA) ; écart prix → stock ou écart de prix (C57). Le GR/IR est lettré **par poste de BC** (EBELN/EBELP), jamais par montant : **F.13** lettre automatiquement les postes dont réceptions et factures s'équilibrent ; les reliquats sont soit « **reçu non facturé** » (solde créditeur = provision fournisseur à payer) soit « **facturé non reçu** » (solde débiteur = marchandise due). **MR11** apure les reliquats de quantité quand plus rien n'est attendu (surplus livraison / surplus facture) avec pièce de régularisation ; **F.19** reclasse le solde au bilan à la clôture. Apps *Reconcile GR/IR Accounts* (F3302), *Monitor GR/IR Account Reconciliation* (F3303, filtre surplus réception / surplus facture, write-off, notes), *GR/IR Process Insights* (F5796), propositions ML. | La charge d'achat est reconnue à la réception (comptabilité d'engagement), la dette à la facture ; le solde du compte d'attente **est** la liste des écarts ouverts entre réceptions et factures. | socle |
| C56 | Détermination automatique des comptes (OBYC) | Clés de transaction par événement : **BSX** stock, **WRX** GR/IR, **PRD** écart de prix, **FR1/FR2/FR3** frais planifiés, **KBS** imputation (charge selon catégorie), **GBB** consommation/rebut ; comptes choisis selon **classe de valorisation** de l'article (ingrédients, emballages, pièces) × société × type de mouvement. Aucun compte saisi à la main dans un flux stock. | Une réception d'emballages et une de farine tombent sur les bons comptes sans intervention ; le paramétrage est testable. | standard |
| C57 | Valorisation du stock et écarts de prix | Contrôle de prix **V** (prix moyen pondéré glissant, recalculé à chaque réception et facture) ou **S** (standard, écarts en PRD). Facture ≠ BC : si la quantité est encore en stock, l'écart **ajuste le stock** (et donc le PMP) ; sinon il va en **écart de prix** ; tolérance **VP** limite la variation du PMP par une seule facture. Historique des prix (MBEW/MBEWH par période). | Le coût matière utilisé par les recettes reflète ce qui a réellement été payé, sans sauts aberrants dus à une facture erronée. | standard |
| C58 | Coût d'acquisition complet (landed cost) dans le prix d'entrée | Valeur d'entrée en stock = prix BC + **frais planifiés** (C48) ventilés au prorata (valeur / qté / poids) + droits/taxes non récupérables ; les frais non planifiés peuvent être répartis sur les postes ; le PMP intègre tout ; les écarts frais planifiés/réels sont traités comme écarts de prix. | Le coût de revient d'une recette inclut le transport et les frais ; sinon la marge est surestimée. | standard |
| C59 | Imputation : stock vs consommation, immobilisations, imputation multiple, réception non valorisée | **Sans catégorie d'imputation** : entrée en stock valorisé. **Avec catégorie** (KNTTP) : **K** centre de coûts (charge à la réception), **F** ordre, **P** projet, **A immobilisation** (la réception **valorisée capitalise l'immobilisation à la date de réception** ; la facture ajuste), consommables non stockés (type NLAG). **Imputation multiple** : répartition % ou qté entre plusieurs objets (impose réception **non valorisée** : comptabilisation à la facture seulement). Commande cadre FO : pas de réception, valorisation à la facture. Engagements (C19) et Universal Journal (ACDOCA) : une ligne par imputation avec toutes les dimensions analytiques. | Décide à la commande si l'achat va au stock, en charge, ou à l'actif, et où ; la comptabilité suit sans ressaisie. | socle |
| C60 | Clôture : provisions, réconciliation GR/IR assistée, analytique | Clôture mensuelle : **provision marchandises reçues non facturées** = solde GR/IR par poste (C55) ; **factures non parvenues** ; régularisation des surplus (MR11) ; réconciliation GR/IR Fiori avec **propositions ML** et **Situation Handling** (« GR/IR deviation exceeds threshold ») ; analytique : dépenses par centre de coûts / catégorie / fournisseur dans ACDOCA (une source unique FI/CO). | La clôture ne dépend pas d'un fichier Excel « ce qu'on a reçu mais pas encore payé » : c'est une requête. | standard |

Transposition boulangerie : C55 est le pattern comptable central à reproduire (compte d'attente lettré par ligne de BC ; solde = provision) ; C56 se réduit à une table (catégorie article × événement → compte) ; C57 au PMP recalculé à la facture ; C58 à la répartition du transport ; C59 à « stock / charge (catégorie) / immobilisation » choisi sur la ligne de BC.

### D9 — Pilotage & analytique

| # | Capacité | Comment ça marche | Pourquoi c'est important | Niveau |
|---|---|---|---|---|
| C61 | Page d'aperçu achats et listes de travail | *Procurement Overview* (F1990) : **cartes actionnables** — DA urgentes / non affectées, **BC en retard de livraison**, **confirmations manquantes**, contrats expirant, factures bloquées, dépenses du mois, performance fournisseur ; chaque carte ouvre une **liste de travail** filtrable (*Monitor Purchase Order Items*, *Monitor Purchase Requisition Items*, *Monitor Supplier Confirmations*, *Supplier Invoices List*) avec actions de masse ; **Situation Handling** pousse des alertes ciblées (poste en retard, écart GR/IR). | L'acheteur commence sa journée par les exceptions, pas par une liste de 300 BC. | standard |
| C62 | Analyse des dépenses (spend) | *Purchasing Spend* par fournisseur / groupe de marchandises / catégorie / période / site ; **Off-Contract Spend** (achats hors contrat alors qu'un contrat existe), **Contract Consumption**, **Spend Variance** (vs période précédente), **Purchase Order Value** ; drill-down jusqu'au poste ; comparaison prix BC vs facture (purchase price variance). | Savoir chez qui et sur quoi part l'argent, et ce qui a échappé aux tarifs négociés. | standard |
| C63 | Évaluation opérationnelle des fournisseurs (score pondéré) | Critères **opérationnels calculés** : **temps** (date de réception réelle vs date prévue, par poste), **quantité** (qté reçue vs commandée, livraisons partielles), **prix** (prix facture vs BC, vs moyenne), **qualité** (décisions d'emploi QM, retours 122, réclamations) ; chacun noté sur une échelle (1-100 par défaut, jusqu'à 999) via **courbes de scoring** ; **pondération** par critère (*Supplier Evaluation Weighting and Scoring*, F2551) ; **score global** par fournisseur et période ; **questionnaires** (évaluation subjective : réactivité, service) combinés au score opérationnel ; *Operational Supplier Evaluation* (F1662A), cartes *Supplier Performance Monitoring* (bulle : score opérationnel × score questionnaire, taille = montant). Classique ME61 : critères prix / qualité / livraison / service avec sous-critères. | Le choix d'un fournisseur repose sur des faits mesurés par le système (retards, écarts, retours), pas sur l'impression du dernier incident. | standard |
| C64 | OTIF défini précisément | **On-time** : réception dans la fenêtre [date confirmée (AB) ou prévue − N j, + M j] ; **in-full** : qté reçue dans la tolérance du poste ; mesuré **par ligne d'échéancier**, agrégé par fournisseur / mois ; les retards dus à une modification du BC par l'acheteur (version) sont exclus ou marqués. | Un OTIF calculé sur la date promise par le fournisseur (et non la date souhaitée) est le seul qui lui soit opposable. | standard |
| C65 | Historique et volatilité des prix | **Prix commandés** par article × fournisseur dans le temps (ME1P, F2988), **prix facturés** (RSEG), **écarts BC/facture** ; alerte à la saisie du BC si le prix s'écarte du **dernier prix** ou du **prix fiche info** au-delà d'un seuil ; comparaison **inter-fournisseurs** pour un même article (en unité de base : MAD/kg, pas MAD/sac) ; impact sur le **PMP** et sur le coût des recettes. | Détecter une hausse de 8 % sur le beurre à la commande, pas au bilan ; comparer des sacs de 25 kg et de 50 kg sur une même base. | standard |

Transposition boulangerie : C61 (tableau d'exceptions : retards, confirmations manquantes, factures bloquées, DA non traitées), C63/C64 (score temps/qté/prix/qualité par fournisseur depuis les données de réception/facture/retours) et C65 (prix au kg dans le temps, alerte à la saisie) sont les trois livrables analytiques à viser.

### D10 — Transverse

| # | Capacité | Comment ça marche | Pourquoi c'est important | Niveau |
|---|---|---|---|---|
| C66 | Rôles métier et séparation des tâches | **Business roles** : demandeur, acheteur opérationnel (DA/BC), acheteur stratégique (contrats, sourcing, évaluation), approbateur, magasinier/réceptionnaire, comptable fournisseurs (factures), trésorier (paiements), administrateur données de base (BP, fiche info). Autorisations par **org. achats, groupe acheteur, type de document, site, société, montant**. Règle : celui qui commande ne réceptionne pas, celui qui réceptionne ne saisit pas la facture, celui qui saisit ne paie pas. | Réduit la fraude et l'erreur ; rend chaque étape attribuable à un rôle. | socle |
| C67 | Piste d'audit complète, pas de suppression physique, contre-écriture | **Change documents** sur tous les objets (C26), **historique append-only** (C38), **versions** (C25) ; **aucun DELETE** : indicateurs de suppression, clôture, annulation par **écriture inverse** référençant l'original (102, reversal de facture avec motif) ; horodatage et utilisateur sur toute pièce ; numéros de pièces sans trou par exercice (exigence légale dans de nombreux pays). | Le contrôle fiscal, l'audit qualité et la recherche d'un incident reposent sur une chaîne non altérée. | socle |
| C68 | Notifications, boîte de tâches, gestion des situations | *My Inbox* : tâches d'approbation (DA, BC, facture) avec contexte, substitution (C20), délais ; **Situation Handling** : situations paramétrées (BC en retard, confirmation manquante, contrat expirant, écart GR/IR) → notification aux rôles concernés avec lien direct ; mail / push / in-app. | Le système prévient la bonne personne au bon moment ; les écrans d'aperçu ne suffisent pas si personne ne les ouvre. | standard |
| C69 | Intégration stock / production / pesage | La **réception** crée le stock par lot et met à jour la couverture (MRP) ; la **consommation** (ordres de production, prélèvements/pesage) réduit le stock et déclenche le réapprovisionnement ; les **réservations** de production sont des besoins pour le MRP ; le lot réceptionné est celui prélevé (traçabilité amont/aval) ; le **prix d'entrée** alimente le coût des recettes ; les écarts d'inventaire corrigent le stock par mouvement (701/702), pas par mise à jour. | Les Achats ne sont pas un module isolé : chaque réception change le disponible, le coût et la traçabilité de ce qui sera produit. | socle |
| C70 | Document flow unifié | Depuis n'importe quel document, navigation vers tous les documents liés : DA → RFQ → BC → confirmations → livraison entrante → réception(s) → lot de contrôle → facture(s) → avoir(s) → paiement(s), et inverse ; les liens sont des **données** (références croisées par n° de pièce / ligne), pas des recalculs. | Répondre en un clic à « cette facture correspond à quelles livraisons et quel BC ? ». | socle |
| C71 | API et événements métier | OData **API_PURCHASEORDER_PROCESS_SRV**, **API_PURCHASEREQ_PROCESS_SRV**, **API_SUPPLIERINVOICE_PROCESS_SRV**, Business Partner API ; **événements** (PurchaseOrder.Created/Changed, SupplierInvoice.Posted) pour l'intégration ; BAPI classiques (BAPI_PO_CREATE1/CHANGE) ; EDI/cXML (Ariba Network). | Permet au portail fournisseur, au pesage, à la compta externe de parler au module sans passer par les écrans. | standard |
| C72 | Conventions UX (Fiori) | **Liste de travail → page objet** (en-tête + sections postes / échéancier / historique / versions / notes / pièces jointes) ; **brouillon** (draft) sauvegardé automatiquement ; **statuts colorés** cohérents (ouvert / en approbation / envoyé / partiellement livré / livré / facturé / clôturé / bloqué) ; **actions de masse** ; **navigation croisée** (fournisseur ↔ BC ↔ facture) ; champs techniques masqués ; mêmes gabarits pour DA, BC, facture. | Une même grammaire visuelle pour tout le flux réduit la formation et les erreurs. | standard |
| C73 | Tests de bout en bout (scope items) | SAP livre des **processus de test** par scénario (ex. 2V7 GR/IR reconciliation, J45 procurement of direct materials, 18J requisitioning, 22Z procurement of services) : données de référence (fournisseur, article, fiche info), **étapes** (DA → BC → réception → facture → paiement) avec résultats attendus (postes EKBE, soldes GR/IR, blocages). Les cas limites font partie du jeu : réception partielle, sur-livraison, retour, facture hors tolérance, avoir, annulation de réception après facture. | Un module Achats se valide sur des chaînes complètes et des cas limites, pas sur des écrans isolés. | standard |

---

## 3. Patterns de modélisation réutilisables (PostgreSQL)

Chaque pattern reprend un choix SAP et le traduit en schéma. Les DDL sont des esquisses (types et contraintes principales), pas des migrations prêtes.

### P1 — Fiche info article × fournisseur avec prix datés et conditionnement

```sql
-- EINA/EINE : la "mémoire d'achat"
create table supplier_items (
  id                  bigserial primary key,
  supplier_id         bigint not null references suppliers(id),
  item_kind           text   not null check (item_kind in ('ingredient','packaging')),
  item_id             bigint not null,                 -- ingredients.id ou packaging_items.id
  supplier_item_ref   text,                            -- référence chez le fournisseur
  order_unit          text   not null,                 -- 'sac', 'carton', 'bidon', 'kg'
  qty_per_order_unit  numeric(14,4) not null check (qty_per_order_unit > 0), -- 25 (kg par sac)
  base_unit           text   not null,                 -- 'kg', 'L', 'pièce'
  planned_lead_days   int    not null default 0,
  min_order_qty       numeric(14,4),                   -- en unité de commande
  std_order_qty       numeric(14,4),
  under_delivery_pct  numeric(5,2) default 0,
  over_delivery_pct   numeric(5,2) default 0,
  over_delivery_unlimited boolean default false,
  ack_required        boolean default false,
  reminder_days       int[]  default '{}',             -- {3,7,14}
  gr_based_iv         boolean default true,
  ers                 boolean default false,
  is_blocked          boolean default false,
  is_preferred        boolean default false,
  unique (supplier_id, item_kind, item_id)
);

-- conditions de prix à validité (KONP/KONH) ; jamais d'UPDATE du prix : on ferme et on ouvre
create table supplier_item_prices (
  id               bigserial primary key,
  supplier_item_id bigint not null references supplier_items(id),
  valid_from       date not null,
  valid_to         date not null default 'infinity',
  price            numeric(14,4) not null,            -- prix pour price_unit_qty unités de prix
  price_unit       text not null,                     -- 'sac' ou 'kg' (OPUn)
  price_unit_qty   numeric(14,4) not null default 1,  -- prix pour 1, 10, 100
  scale_min_qty    numeric(14,4) default 0,           -- échelle : à partir de N
  currency         char(3) not null default 'MAD',
  source           text,                              -- 'devis 2026-09', 'facture 1234', 'manuel'
  exclude using gist (supplier_item_id with =, daterange(valid_from, valid_to, '[]') with &&)
    where (scale_min_qty = 0)
);
```

Règle : au moment de créer la ligne de BC, on **copie** prix, unité de commande, facteur de conversion, tolérances et délai dans la ligne (snapshot). La fiche peut évoluer, le BC ne bouge pas.

### P2 — Triplet d'unités porté par la ligne

```sql
-- sur purchase_order_lines, goods_receipt_lines, supplier_invoice_lines :
order_unit          text          not null,           -- 'sac'
qty_ordered_ou      numeric(14,4) not null,           -- 40 sacs
qty_per_order_unit  numeric(14,4) not null,           -- 25 kg/sac (copié de P1 au moment T)
base_unit           text          not null,           -- 'kg'
qty_ordered_base    numeric(14,4) generated always as (qty_ordered_ou * qty_per_order_unit) stored,
price_unit          text          not null,           -- 'sac' ou 'kg'
price_unit_qty      numeric(14,4) not null default 1,
unit_price          numeric(14,4) not null,
net_value           numeric(14,2) not null            -- calculé côté service, stocké (snapshot)
```

Le stock, le PMP et les recettes travaillent en `base_unit` ; la saisie (réception, facture) et l'affichage restent dans l'unité saisie (règle déjà adoptée dans le projet : 420 g reste 420 g).

### P3 — Historique de ligne append-only (EKBE) et cumuls en vue

```sql
create table po_line_events (
  id            bigserial primary key,
  po_line_id    bigint not null references purchase_order_lines(id),
  event_type    text   not null check (event_type in
                 ('GR','GR_REVERSAL','RETURN','RETURN_REVERSAL','IR','CREDIT_MEMO',
                  'SUBSEQUENT_DEBIT','SUBSEQUENT_CREDIT','DOWN_PAYMENT')),
  sign          smallint not null check (sign in (-1, 1)),
  qty_base      numeric(14,4) not null default 0,     -- 0 pour débit/crédit ultérieur
  qty_ou        numeric(14,4) not null default 0,
  amount        numeric(14,2) not null default 0,     -- HT, devise société
  ref_doc_type  text not null,                        -- 'goods_receipt','supplier_invoice',...
  ref_doc_id    bigint not null,
  ref_doc_line  int,
  gr_event_id   bigint references po_line_events(id), -- IR → GR facturée (GR-based IV, LFBNR)
  lot_id        bigint,
  posted_at     timestamptz not null default now(),
  posted_by     bigint not null
);
-- interdiction d'UPDATE/DELETE par trigger ; une correction = un nouvel événement de signe opposé

create view po_line_status as
select l.id as po_line_id,
       l.qty_ordered_base,
       coalesce(sum(case when e.event_type in ('GR','GR_REVERSAL','RETURN','RETURN_REVERSAL')
                         then e.sign * e.qty_base end), 0) as qty_received,
       coalesce(sum(case when e.event_type in ('IR','CREDIT_MEMO') then e.sign * e.qty_base end), 0) as qty_invoiced,
       coalesce(sum(case when e.event_type in ('GR','GR_REVERSAL','RETURN','RETURN_REVERSAL')
                         then e.sign * e.amount end), 0) as value_received,
       coalesce(sum(case when e.event_type in ('IR','CREDIT_MEMO','SUBSEQUENT_DEBIT','SUBSEQUENT_CREDIT')
                         then e.sign * e.amount end), 0) as value_invoiced,
       l.delivery_completed, l.final_invoice, l.deleted
from purchase_order_lines l
left join po_line_events e on e.po_line_id = l.id
group by l.id;
-- à recevoir  = case when delivery_completed then 0 else qty_ordered_base - qty_received end
-- à facturer  = qty_received - qty_invoiced  (GR-based) ; solde GR/IR = value_received - value_invoiced
```

Analogie : c'est la table d'historique alimentée par trigger qu'on écrivait en PL*SQL, sauf qu'ici elle est la source de vérité et que les compteurs sont des vues (plus de `current_quantity` qui dérive).

### P4 — Statut de ligne dérivé, statut d'en-tête agrégé, indicateurs explicites

```sql
-- indicateurs saisis (jamais calculés) :
alter table purchase_order_lines add column delivery_completed boolean not null default false; -- ELIKZ
alter table purchase_order_lines add column final_invoice      boolean not null default false; -- EREKZ
alter table purchase_order_lines add column deleted            boolean not null default false; -- LOEKZ
alter table purchase_order_lines add column blocked            boolean not null default false;

-- statut de ligne dérivé (fonction SQL) :
--  'deleted' | 'open' | 'partially_received' | 'received' | 'partially_invoiced' | 'invoiced' | 'closed'
-- statut d'en-tête = agrégation : min/max des statuts de lignes non supprimées
--  + états propres à l'en-tête : 'draft' (hold), 'pending_approval', 'approved', 'sent', 'rejected', 'cancelled'
```

Deux familles de statut distinctes : **cycle de vie de l'en-tête** (brouillon → approbation → envoyé → clôturé/annulé : saisi par transitions contrôlées) et **avancement logistique/financier des lignes** (dérivé des événements). Ne jamais mélanger les deux dans une seule colonne.

### P5 — Versions de BC (EREV) avec motif et snapshot

```sql
create table purchase_order_versions (
  id              bigserial primary key,
  po_id           bigint not null references purchase_orders(id),
  version_no      int    not null,                    -- 0 = création
  reason_code     text   references po_change_reasons(code),
  reason_text     text,
  created_by      bigint not null,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,                        -- indicateur "terminé" : prêt à renvoyer
  sent_at         timestamptz,                        -- envoi effectif au fournisseur
  snapshot        jsonb  not null,                    -- en-tête + lignes + échéancier au moment T
  unique (po_id, version_no)
);
-- règle : modification d'un champ "relevant impression" (qté, prix, date, article, adresse)
-- sur un BC déjà envoyé → version_no + 1 obligatoire, reason_code obligatoire, renvoi bloqué tant que completed_at est null
```

### P6 — Journal des modifications générique (CDHDR/CDPOS)

```sql
create table change_log (
  id          bigserial primary key,
  table_name  text not null,
  row_id      bigint not null,
  parent_table text, parent_id bigint,                -- pour remonter ligne → en-tête
  field_name  text not null,
  old_value   text, new_value text,
  changed_by  bigint not null,
  changed_at  timestamptz not null default now(),
  tx_id       uuid not null,                          -- regroupe les champs d'une même sauvegarde
  tx_label    text                                    -- 'PO.update', 'PO.approve', 'GR.post'
);
```

Un trigger `AFTER UPDATE` par table métier compare `OLD`/`NEW` colonne par colonne (comme un trigger d'audit Oracle), ou le service applicatif écrit le diff dans la même transaction.

### P7 — Échéancier de livraison par ligne (EKET)

```sql
create table purchase_order_schedules (
  id            bigserial primary key,
  po_line_id    bigint not null references purchase_order_lines(id),
  seq           int not null,
  delivery_date date not null,                         -- date demandée
  confirmed_date date,                                 -- date promise (AB)
  qty_ou        numeric(14,4) not null,
  unique (po_line_id, seq)
);
-- la réception référence la ligne (et optionnellement l'échéance) ; OTIF se mesure sur confirmed_date ou delivery_date
```

### P8 — Confirmations fournisseur attendues (EKES + clé de contrôle)

```sql
create table po_line_confirmations (
  id            bigserial primary key,
  po_line_id    bigint not null references purchase_order_lines(id),
  kind          text not null check (kind in ('ACK','ASN')),  -- AB / LA
  supplier_ref  text,                                         -- n° AR, n° BL annoncé
  confirmed_date date,
  qty_ou        numeric(14,4),
  received_at   timestamptz not null default now(),
  mrp_relevant  boolean not null default true
);
-- "confirmation manquante" = ack_required et aucune ligne ACK après N jours
```

### P9 — Tolérances paramétrées avec surcharge

```sql
create table invoice_tolerances (
  company_id   bigint not null,
  key          text   not null,   -- 'PP','DQ','BD','AN','ST'...
  lower_abs    numeric(14,2), lower_pct numeric(5,2), check_lower boolean not null default true,
  upper_abs    numeric(14,2), upper_pct numeric(5,2), check_upper boolean not null default true,
  primary key (company_id, key)
);
-- surcharge par fournisseur/article : colonnes price_tol_pct / qty_tol_pct nullable sur supplier_items ;
-- résolution : supplier_items → invoice_tolerances(company). 0 + check = toujours bloquer ; null + check=false = ne pas contrôler.
```

### P10 — Motifs de blocage par ligne, blocage paiement en-tête, libération tracée

```sql
create table supplier_invoice_line_blocks (
  invoice_line_id bigint not null references supplier_invoice_lines(id),
  reason          text not null check (reason in ('QTY','PRICE','DATE','UNIT','AMOUNT','BLANKET','MANUAL')),
  variance_abs    numeric(14,2), variance_pct numeric(7,2),
  set_at          timestamptz not null default now(),
  released_at     timestamptz, released_by bigint, release_mode text, -- 'auto' | 'manual'
  primary key (invoice_line_id, reason)
);
alter table supplier_invoices add column payment_block text;        -- 'R' tant qu'il reste un bloc actif, 'M' manuel, 'S' stochastique
-- job "MRBR" : pour chaque bloc QTY actif, re-tester (qté facturée ≤ reçue non facturée) ; si résolu → released_at, release_mode='auto' ; si plus aucun bloc → payment_block = null
```

### P11 — Compte d'attente GR/IR lettré par ligne de BC

```sql
-- écritures : à la réception  Dt stock/charge   Ct GRIR (po_line_id, +valeur)
--             à la facture    Dt GRIR (po_line_id, −valeur)   Ct fournisseur, Dt TVA
create view grir_open_items as
select po_line_id, value_received, value_invoiced,
       value_received - value_invoiced as balance,  -- > 0 : reçu non facturé (provision) ; < 0 : facturé non reçu
       qty_received  - qty_invoiced     as qty_gap
from po_line_status
where value_received <> value_invoiced or qty_received <> qty_invoiced;
-- F.13 ≈ marquer "lettré" les lignes où balance = 0 et qty_gap = 0 ; MR11 ≈ événement de régularisation (type 'GRIR_WRITE_OFF') quand delivery_completed et final_invoice
```

Toute la comptabilité d'achat passe par `po_line_id` comme clé de lettrage ; les montants ne servent qu'à calculer le solde.

### P12 — Frais de livraison (landed cost) planifiés / non planifiés

```sql
create table po_line_planned_costs (        -- conditions FRA1/FRB1/FRC1
  id bigserial primary key,
  po_line_id bigint not null references purchase_order_lines(id),
  cost_type  text not null,                 -- 'freight','customs','handling'
  basis      text not null check (basis in ('pct_value','per_order_unit','fixed')),
  rate       numeric(14,4) not null,
  payee_supplier_id bigint                  -- transporteur ≠ fournisseur
);
create table landed_cost_allocations (      -- frais réels (facture transporteur ou frais non planifiés) ventilés
  id bigserial primary key,
  source_invoice_id bigint not null,
  po_line_id        bigint not null,
  gr_event_id       bigint,                 -- réception concernée
  allocation_basis  text not null,          -- 'value' | 'qty' | 'weight'
  amount            numeric(14,2) not null
);
-- coût d'entrée de la réception = valeur BC + Σ planifiés provisionnés ; l'écart réel/planifié s'applique au stock restant sinon en écart de prix
```

### P13 — Types de mouvement paramétrés (101/102/122/161)

```sql
create table stock_movement_types (
  code            text primary key,         -- '101','102','122','123','161','103','105','124'
  label           text not null,
  direction       smallint not null check (direction in (-1,1)),
  requires_reason boolean not null default false,  -- 122 : oui ; 102 : non
  reverses_code   text references stock_movement_types(code),
  counts_as_return boolean not null default false, -- alimente le score qualité fournisseur
  target_stock    text not null check (target_stock in ('free','quality','gr_blocked','none'))
);
```

### P14 — Lots et DLC à la réception

```sql
-- sur goods_receipt_lines : lot_id (nouveau ou existant), production_date, expiry_date (saisie ou calculée = production_date + shelf_life_days),
-- contrôle : expiry_date - receipt_date >= min_remaining_shelf_life_days (fiche article, surchargeable sur la ligne de BC) → warning ou erreur selon paramètre
-- la DLC vit sur le lot (ingredient_lots.expiry_date) ; une réception ultérieure du même lot avec une DLC différente lève une alerte
```

### P15 — Approbation paramétrée (flexible workflow) avec reset

```sql
create table approval_rules (
  id bigserial primary key, document_type text not null,      -- 'PR','PO','INVOICE'
  priority int not null,                                       -- évaluation top-down, une seule règle démarre
  conditions jsonb not null,                                   -- {"po_type":["NB"],"min_amount":5000,"category_in":[...]}
  steps jsonb not null,                                        -- [{"seq":1,"approver_role":"purchasing_manager"},{"seq":2,"approver_user":42}]
  active boolean not null default true
);
create table approval_tasks (
  id bigserial primary key, document_type text, document_id bigint, rule_id bigint, step_seq int,
  assigned_role text, assigned_user bigint, substitute_user bigint,
  status text not null check (status in ('pending','approved','rejected','returned','cancelled')),
  decided_by bigint, decided_at timestamptz, comment text
);
-- règle : modification "significative" d'un document approuvé (montant +X %, nouvelle ligne) → tâches annulées, nouveau cycle
```

### P16 — Fournisseur à rôles et blocages séparés

```sql
-- suppliers (identité : raison sociale, ICE, IF, RC, adresses, contacts)
-- supplier_finance (par société si multi) : compte collectif, conditions de paiement, modes, RIBs (table fille), posting_blocked
-- supplier_purchasing : devise, incoterms, conditions de paiement proposées, groupe acheteur, ers, ack_required, purchasing_blocked
-- suppliers.status : 'active' | 'blocked' | 'archived' (central) ; qualification : qualified_until, preferred_level 1..5, documents (table fille)
```

### P17 — Avoirs, débit/crédit ultérieur et liens de documents

```sql
alter table supplier_invoices add column kind text not null default 'INVOICE'
  check (kind in ('INVOICE','CREDIT_MEMO','SUBSEQUENT_DEBIT','SUBSEQUENT_CREDIT'));
-- CREDIT_MEMO : lignes avec qty > 0 (référence retour) ; SUBSEQUENT_* : qty = 0, amount ≠ 0, qty_max = déjà facturée
create table document_links (                 -- document flow
  from_type text, from_id bigint, from_line int,
  to_type   text, to_id   bigint, to_line   int,
  link_kind text,                              -- 'converted_to','received_against','invoiced_against','returned_from','paid_by','credits'
  primary key (from_type, from_id, coalesce(from_line,0), to_type, to_id, coalesce(to_line,0))
);
```

### P18 — Cascade des valeurs par défaut

Résolution à la création d'une ligne de BC, dans cet ordre, le premier non nul gagne : **ligne saisie** → **fiche info article × fournisseur** → **fiche article (clé de valeur d'achat)** → **fournisseur (rôle achats)** → **paramètre société**. La valeur résolue est **copiée** dans la ligne (snapshot) avec, si utile, la provenance (`tolerance_source = 'supplier_item'`).

### P19 — Jamais de suppression physique

Indicateur `deleted`/`cancelled` + `cancelled_reason` + contre-écriture pour tout ce qui a eu un effet (stock, compta). Les contraintes d'intégrité (ex. interdire la suppression d'une ligne ayant des événements) se mettent en trigger `BEFORE UPDATE OF deleted`.

---

## 4. Ce qu'il faut retenir pour un ERP de boulangerie (~40 fournisseurs, ~300 BC/an)

Priorité 1 (socle, à faire dans la refonte) :
1. **Fiche article × fournisseur** avec prix datés, conditionnement (sac → kg), délai, tolérances, préféré/bloqué (P1, P2, P18).
2. **BC en trois niveaux** (en-tête, lignes, échéancier), types de BC (stock / charge / cadre), lignes avec triplet d'unités et snapshot des conditions (C22-C23).
3. **Historique append-only par ligne** et statuts dérivés + indicateurs « livraison terminée » / « facture finale » (P3, P4) ; fin des compteurs dénormalisés.
4. **Réception référencée** partielle, tolérances, annulation ≠ retour avec motif, lot/DLC branchés au pesage (C32-C35, P13, P14).
5. **Facture référencée** avec 3-way match par ligne, 4-5 clés de tolérance, blocage automatique avec motif et libération auto, avoir vs crédit ultérieur, TVA par ligne, factures de charges dans le même flux (C39-C45, P9, P10, P17).
6. **GR/IR lettré par ligne de BC** = provision « reçu non facturé » et détection « facturé non reçu » (C55, P11).
7. **Journal des modifications**, versions de BC avec motif à chaque renvoi, envoi horodaté (C25-C27, P5, P6).
8. **Conditions de paiement, RIB, échéancier, balance âgée** (C49, C50, C52).

Priorité 2 (standard) : approbation paramétrée avec reset (P15), AR fournisseur + relances à J+N (C28, C29, P7, P8), point de commande avec délai fournisseur (C12), tableau d'exceptions (C61), score fournisseur temps/qté/prix/qualité et prix au kg dans le temps (C63-C65), répartition du transport (C48, P12), proposition de paiement hebdomadaire (C51).

Priorité 3 (avancé, à prévoir dans le schéma mais pas dans les écrans) : ERS pour 2-3 fournisseurs réguliers (C46), contrôle qualité formalisé (C37), portail fournisseur minimal (C31), qualification fournisseur avec pièces et date de revue (C09).

Pièges à éviter (constatés dans d'autres ERP maison, confirmés par la façon dont SAP les traite) :
- Un seul champ « statut » saisi à la main sur le BC.
- Prix et conversion non copiés dans la ligne (changement de tarif qui réécrit l'historique).
- Rapprochement par total de facture au lieu de par ligne.
- Retour fournisseur saisi comme annulation de réception (perte du motif et de la créance).
- Réception non référencée au BC « parce que c'est plus rapide » (3-way match impossible).
- Compte « fournisseurs » mouvementé à la réception ou compte « stock » à la facture (pas de compte d'attente : impossible de distinguer reçu non facturé de facturé non reçu).

---

## 5. Sources consultées (2026-10-11)

SAP Learning (S/4HANA) :
- Invoice Verification in SAP S/4HANA : Entering Invoices with Variances (clés de tolérance DQ/DW, KW/PP/PS, BR/BW, ST, AN/AP, BD, LA/LD, VP ; blocage facture entière) ; Releasing Blocked Invoices ; Use Further Blocking Reasons (stochastique) ; Performing Receipt Settlements (ERS) ; Entering Subsequent Debits/Credits ; Using Fiori Apps for GR/IR Reconciliation (F3302, F3303, F5796, scope item 2V7).
- Purchasing in SAP S/4HANA : Setting Up Flexible Workflows in Purchasing ; Controlling Source Determination with Source Lists ; Evaluating Suppliers Using Logistics Information System ; Blocking Sources of Supply ; Creating Business Partners.
- Detailing Intelligent Procurement and Procurement Analytics : Defining Workflows in Sourcing and Procurement ; Introducing Procurement Overview Page ; Explain Supplier Evaluation.
- Inventory Management in SAP S/4HANA : Setting Up Date Checks to Goods Receipt for Purchase Order (SLED, message 12 007) ; Posting Goods Movements for Material Types UNBW and NLAG.
- Configuring SAP S/4HANA Quality Management : Describing Quality Management at Goods Receipt (lot origine 01, décision d'emploi).
- Cross-Functional Customizing in MM : Adjusting Account Determination for Special Cases (FRA1/FRB1/FRC1, comptes d'attente frais) ; Defining Settings for Business Partners.
- Asset Accounting Integration Aspects : Procurement of Fixed Asset Process for Valuated Goods.
- Customizing Core Settings in FI : Configuring Payment Terms and Cash Discounts.
- Consumption-Based Planning and Forecasting : Planning Using MRP Live ; Monitor / Manage Material Coverage.
- SAP Ariba : Invoice Reconciliation ; Creating Invoices ; Reviewing Supplier Lifecycle & Performance ; Characterizing Preferred Supplier Management ; Creating Scorecards ; Describing Indirect Materials Procurement in SAP Ariba.

SAP Help / Notes / KBA :
- Version Management (help.sap.com, 4.70 : champs relevants impression, indicateur terminé, version 0).
- Delivery Costs / Planned Delivery Costs (help.sap.com 4.6C).
- Invoice Release, Blocking Invoices, Stochastic Block (help.sap.com 4.6C/4.70).
- Procurement Using Vendor Confirmations (help.sap.com 4.6C : AB/LA, pertinence MRP/GR).
- Making the Usage Decision (help.sap.com 4.6C).
- KBA 2050268 (F.13 et comptes WRX), KBA 2989413 et 2619325 (flexible workflow non déclenché), KBA 3001518 (débit/crédit ultérieur = valeur seule), KBA 2818366 (imputation multiple → GR non valorisée), KBA 2981227 (rôles FLVN00/FLVN01), KBA 3769479 (ELIKZ grisé après facture), KBA 2570334 (escompte sur facture échue), KBA 2449160 (tolérances).

Communauté SAP / sources secondaires (M) :
- Blogs SAP : Flexible Workflow for Sourcing and Procurement in SAP S/4HANA (2023) ; Purchase Order Flexible Workflow start conditions ; Unplanned delivery costs field / direct posting / subsequent debit (2022) ; Automatic reorder point MRP type V2/VM ; Situation Handling use cases 2005 (GR/IR Deviation Exceeds Threshold) ; S/4HANA 1909 finance innovations (Monitor GR/IR).
- PIKON : Fiori apps in SAP S/4HANA for Materials Management (F1990, F1662A, F2551, F2988, F2667) ; Supplier evaluation in SAP (échelle 1-999, pondération).
- Michael Management : GUI transactions for S/4HANA (F1750, F0593, F1735/F1736) ; Understanding the goods and invoice receipt process.
- sapdocs.info : Version Management Process for Purchase Orders ; SLED in SAP MM ; Handling Unplanned Delivery Costs.
- masteringsap.com : An analysis of simplified sourcing on SAP S/4HANA (liste de sources, quota).
- Fils SAP Community sur : différences 122/161, MR11 vs F.13, ME91F/ME91FF et jours de relance, EBAN STATU/EBAKZ, ME23N Item Changes / CDHDR-CDPOS, consignation 101K/411K/MRKO, GR-based IV et ERS.
- Guides utilisateurs Ariba Network (PASSHE, Atmus « PO Flip Guide », Thomson Reuters, Umicore) ; guides Ariba Sourcing (État de l'Arkansas : Competitive Bid ≥ 3 fournisseurs) ; blog SAP « Preferred & Qualified Suppliers » (SLP ↔ Guided Buying) ; blog Ariba Guided Buying landing pages & policies (2018).

Points à confiance moyenne (M) signalés dans le texte : IDs d'apps Fiori financières (F1750, F1735, F1736, F0593), détail des sous-critères ME61, codes exacts des motifs de blocage par poste (Q/P/D/M/I/G), comportement précis de LA/LD sur commande cadre. Tout le reste est à confiance haute (H).

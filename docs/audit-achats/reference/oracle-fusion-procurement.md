# Référentiel de capacités — Module Achats (procure-to-pay) selon Oracle Fusion Cloud Procurement & Oracle EBS

**Objet** : inventaire des capacités « canoniques » d'un module Achats tel qu'implémenté par Oracle Fusion Cloud Procurement (Purchasing, Self Service Procurement, Supplier Portal, Sourcing, Supplier Qualification, Payables, Receipt Accounting / Cost Management) et Oracle E-Business Suite (iProcurement, Purchasing, Payables), pour servir de grille de référence à la refonte du module Achats de l'ERP interne (boulangerie-pâtisserie, Maroc, ~40 fournisseurs, ~300 BC/an).

**Date** : 2026-10-11.

**Niveau de confiance** : les noms de fonctionnalités Fusion ont été recoupés avec la documentation Oracle Help Center (Receipt Accounting 25c/26a, Purchasing FAQ 26R1, solution brief 2026) et des sources EBS (Payables User's Guide). Les noms de tables EBS cités sont ceux du schéma standard R12 (haute confiance). Les détails de comportement Fusion marqués *(à vérifier)* proviennent de la connaissance générale du produit, non d'une page officielle consultée aujourd'hui.

**Légende des niveaux** :
- **Socle** : indispensable à tout module Achats crédible ; à implémenter en premier.
- **Standard** : attendu d'un ERP de PME mature ; à prévoir dans la refonte.
- **Avancé** : pertinent pour grands comptes ; à ne retenir que si un besoin métier précis le justifie (≈40 fournisseurs, 300 BC/an : la plupart ne le justifient pas).

**Convention de lecture pour l'ancien développeur Forms/PL/SQL** : chaque domaine commence par un rappel des tables EBS correspondantes. Le modèle EBS (PO → lignes → shipments/line locations → distributions ; RCV_TRANSACTIONS ; AP_INVOICES / AP_INVOICE_DISTRIBUTIONS ; matching PO/AP) reste la meilleure carte mentale : Fusion en a conservé la structure logique (PO_HEADERS_ALL, PO_LINES_ALL, PO_LINE_LOCATIONS_ALL, PO_DISTRIBUTIONS_ALL existent toujours dans Fusion, avec quelques colonnes supplémentaires).

---

## Vue d'ensemble du cycle procure-to-pay

```
Besoin (plan de production / stock mini / consommables / charges)
   │
   ▼
D2  Demande d'achat (requisition)  ──► D3 approbation (seuils, groupes) ──► D3 sourcing (RFQ, comparaison)
   │                                                                              │
   ▼                                                                              ▼
D4  Bon de commande (PO) : en-tête ─ lignes ─ échéances/livraisons ─ distributions comptables
   │        ▲ change orders / révisions                               (accord-cadre BPA/CPA en amont)
   ▼
D5  Réception (receipt) ─ contrôle qualité (inspect) ─ mise en stock (deliver) ─ retour fournisseur ─ correction
   │                                                      │
   │                                                      ▼  D10 intégration stock (kg/L, lots, DLC, zones)
   ▼
D6  Facture fournisseur ─ rapprochement 2/3/4-way ─ tolérances ─ holds ─ validation
   │
   ▼
D7  Paiement (échéances, lots de paiement, avances/acomptes, retenues) ─ trésorerie
   │
   ▼
D8  Comptabilité : accrual à la réception (compte d'attente « réceptions non facturées »), écarts de prix (PPV),
    landed cost (transport, douane), immobilisations ; D9 pilotage ; D10 transverse (rôles, audit, notifications, API)
```

Principe cardinal, hérité d'EBS et repris par Fusion : **les quantités commandée / reçue / facturée / payée vivent au niveau le plus fin (ligne de livraison et distribution), jamais à l'en-tête**. L'en-tête ne porte qu'un statut dérivé.

---

## D1 — Référentiel fournisseurs & données d'achat

**Tables EBS** : `AP_SUPPLIERS` (ex `PO_VENDORS`), `AP_SUPPLIER_SITES_ALL`, `HZ_PARTIES` (TCA, R12), `AP_SUPPLIER_CONTACTS`, `IBY_EXTERNAL_PAYEES_ALL` + `IBY_EXT_BANK_ACCOUNTS` (banques, R12), `PO_APPROVED_SUPPLIER_LIST` (ASL), `PO_ASL_ATTRIBUTES`, `MTL_SYSTEM_ITEMS_B` (article), `MTL_UNITS_OF_MEASURE` / `MTL_UOM_CONVERSIONS` / `MTL_UOM_CLASS_CONVERSIONS`, `PO_ATTRIBUTE_VALUES` (catalogue iProcurement), `AP_TERMS` (conditions de paiement), `AP_TOLERANCE_TEMPLATES` (R12).

**Fusion** : Supplier Model (Supplier → Addresses → Sites par BU → Contacts), Supplier Registration (externe/interne), Supplier Qualification Management (questionnaires, initiatives, qualifications, assessments), Supplier Item Catalog (Agreement lines, Punchout, Smart Forms), Approved Supplier List, Item Master (Product Hub).

| # | Capacité | Description précise (objets, statuts, règles, champs clés) | Pourquoi c'est important | Niveau |
|---|---|---|---|---|
| D1.1 | Fiche fournisseur multi-niveaux (Supplier / Site / Contact) | Un **fournisseur** (raison sociale, ICE/IF/RC/patente au Maroc, type : marchandises, services, intérimaire), N **adresses/sites** (facturation, commande, remise de paiement ; un site est « Purchasing », « Pay », ou les deux), N **contacts**. Statut fournisseur : `prospectif`, `brouillon`, `actif`, `inactif/bloqué` (`hold_all_payments`, `hold_unmatched_invoices`, `hold_future_invoices` en EBS). Date d'inactivation (`END_DATE_ACTIVE`). | Sépare l'identité juridique (unique) du comportement opérationnel (par site : conditions, compte comptable, devise). Évite les doublons fournisseurs, fléau de l'économat. | Socle |
| D1.2 | Conditions commerciales par défaut au niveau fournisseur/site | Conditions de paiement (`AP_TERMS` : 30 j fin de mois, comptant, acompte 50 %), mode de paiement par défaut (virement, chèque, espèces, effet), devise, **compte fournisseur (401 auxiliaire, 4411 au PCG marocain)**, compte de charge par défaut, taux de TVA par défaut, **niveau de rapprochement par défaut (2/3/4-way)** et **tolérances par défaut**, quantité/minimum de commande, délai de livraison standard (lead time). Héritage : fournisseur → site → ligne de BC (surchargeable). | Le défaut au niveau site alimente automatiquement BC et facture ; le pattern « héritage en cascade avec surcharge » est le cœur de la saisie rapide. | Socle |
| D1.3 | Coordonnées bancaires fournisseur avec validation et traçabilité | RIB (24 caractères Maroc), banque, titulaire ; dates de validité ; **historique des changements** et approbation d'un changement de RIB par un rôle distinct de celui qui l'a saisi (Fusion 2026 : « bank account ownership verification » automatisée). | Le changement de RIB est le vecteur n° 1 de fraude au paiement. Séparation des tâches obligatoire. | Standard |
| D1.4 | Enregistrement / onboarding fournisseur (Supplier Registration) | Demande d'enregistrement (interne ou via portail), pièces jointes (RC, attestation fiscale, attestation CNSS), workflow d'approbation, promotion `prospectif → actif` ; référencement bloqué si pièces expirées. | Formalise l'entrée d'un fournisseur et évite de créer un BC vers un fournisseur « hors la loi ». Pour 40 fournisseurs, une version allégée (checklist + dates d'expiration) suffit. | Standard |
| D1.5 | Qualification fournisseur (Supplier Qualification Management) | Questionnaires (HACCP, agrément ONSSA, certificat halal, fiche technique produit), **initiatives** d'évaluation, **qualifications** par domaine avec date d'expiration, **assessments** notés ; alertes avant expiration. | Pour l'agroalimentaire, la qualification sanitaire du fournisseur est une exigence d'audit (ONSSA, traçabilité). | Avancé (version allégée : Standard) |
| D1.6 | Article achetable (Purchasable Item) et liste des fournisseurs approuvés (ASL) | Article (ingrédient / consommable / service / charge) avec attributs achat : **unité d'achat (sac 25 kg, carton 12 × 1 L, bidon 20 L)**, **unité de stock (kg, L)**, **facteur de conversion article-spécifique** (`MTL_UOM_CONVERSIONS` : intra-classe ; `MTL_UOM_CLASS_CONVERSIONS` : poids↔volume via densité), taxable, catégorie d'achat, compte de charge. **ASL** : couples (article, fournisseur, site) avec statut `approuvé / nouveau / sous surveillance / interdit`, référence article fournisseur (`VENDOR_PRODUCT_NUM`), délai, quantité minimale. | C'est la table de référence qui permet qu'un BC en « sacs » se transforme en « kg » en stock sans ressaisie. L'ASL interdit de commander un ingrédient chez un fournisseur non qualifié. | Socle |
| D1.7 | Catalogue d'articles fournisseur et formulaires (Supplier Item Catalog, Smart Forms) | Catalogue interne (lignes d'accord-cadre, articles libres avec prix), **catalogue chargé par le fournisseur** (CIF/CSV via portail), **Smart Forms** (formulaires guidés pour achats non catalogués : « prestation d'entretien », « frais divers »), recherche par catégorie/mot-clé, **comparaison de prix inter-fournisseurs par article**. | Le demandeur choisit dans un catalogue au lieu de saisir du texte libre ; le prix se propage au BC. | Standard |
| D1.8 | Listes de prix et tarifs fournisseur (Price Lists / Agreement pricing) | Prix par (fournisseur, article, unité d'achat, date d'effet début/fin), **paliers de quantité (price breaks)**, remises, prix par site de livraison. Historique conservé (jamais d'écrasement). **Dernier prix payé** et **prix moyen** disponibles pour contrôle. | Base du contrôle d'écart de prix (A1 de l'audit formats) et de la proposition de prix sur BC. | Socle |
| D1.9 | Catégories d'achat hiérarchiques et taxonomie | Arborescence de catégories (ingrédients > farines ; consommables > emballages ; charges > énergie) utilisée pour : compte comptable par défaut, routage article↔stock (ingrédient vs consommable, cf. mig 207 `fn_purchasable_kind`), approbateur par catégorie, analytique de dépense. En EBS : `MTL_CATEGORIES_B` + `MTL_CATEGORY_SETS` (« Purchasing » set). | Une taxonomie unique partagée par l'économat, les BC et les charges évite trois classifications parallèles. | Socle |
| D1.10 | Portail fournisseur (Supplier Portal) | Le fournisseur consulte ses BC, **accuse réception/accepte un BC** (acknowledgement), propose un changement (prix, date), envoie un **ASN** (avis d'expédition), **dépose ses factures** (ou les crée à partir d'un BC — « invoice from PO »), suit paiements et litiges. | Déporte la saisie vers le fournisseur et crée une trace contradictoire. Pour une PME : rarement rentable ; alternative = envoi du BC PDF par e-mail/WhatsApp + accusé enregistré manuellement. | Avancé |

---

## D2 — Besoins & demandes d'achat

**Tables EBS** : `PO_REQUISITION_HEADERS_ALL`, `PO_REQUISITION_LINES_ALL`, `PO_REQ_DISTRIBUTIONS_ALL` ; interface `PO_REQUISITIONS_INTERFACE_ALL` (alimentée par MRP/min-max : `MTL_SUPPLY`, `MRP_RECOMMENDATIONS`) ; `PO_REQEXPRESS_HEADERS` (templates). Statuts d'en-tête : `INCOMPLETE`, `IN PROCESS`, `PRE-APPROVED`, `APPROVED`, `REJECTED`, `RETURNED`, `CANCELLED`, `FINALLY CLOSED`.

**Fusion** : Self Service Procurement (panier, requisition, approval), Requisition Import (planning, min-max), Internal Material Transfers.

| # | Capacité | Description précise | Pourquoi | Niveau |
|---|---|---|---|---|
| D2.1 | Demande d'achat structurée (requisition) en-tête / lignes / distributions | En-tête : demandeur, service, date de besoin, justification, **statut** (brouillon → soumis → approuvé → en commande partielle → commandé → clos / rejeté / annulé / retourné au demandeur). Ligne : article ou description libre, catégorie, quantité en **unité demandée**, prix estimé, fournisseur suggéré, date de besoin, lieu de livraison, **type de ligne** (quantité / montant / service). Distribution : imputation comptable, % ou quantité, projet/atelier. | La DA est le point d'entrée unique du besoin ; sans elle le BC ne porte pas la justification. Déjà présent (statut `received`, mig 271) : la refonte doit surtout clarifier le statut ligne vs en-tête. | Socle |
| D2.2 | Génération automatique de besoins (min-max, point de commande, plan de production) | Règles par article × zone : stock min / max, point de commande, délai, **quantité en commande déjà ouverte (on-order)** déduite ; import depuis le **calcul des besoins du plan de production** (nomenclature → besoins nets − stock − en commande). Création de DA avec source `AUTO` et lien vers le plan/lot d'origine. En EBS : Min-Max Planning Report → `PO_REQUISITIONS_INTERFACE_ALL` → Requisition Import. | Évite les ruptures et les doubles commandes ; le lien besoin ↔ plan sert la traçabilité production (lots, coût réel). | Standard |
| D2.3 | Regroupement et scission de demandes vers des BC (AutoCreate) | Vue « lignes de DA approuvées non commandées » (**Demand Workbench** / AutoCreate) : filtrer par fournisseur suggéré, catégorie, date ; **regrouper** N lignes de DA de N demandeurs en 1 BC fournisseur ; **scinder** une ligne (2 fournisseurs) ; **ajouter à un BC existant ouvert** ; conserver `req_line_id` ↔ `po_line_location_id` pour la traçabilité et pour mettre à jour le statut de la DA. | C'est l'opération métier centrale de l'acheteur. Le lien DA-ligne ↔ BC-ligne (N:N via tables de lien) est l'un des patterns à reproduire. | Socle |
| D2.4 | Panier / achat en libre-service (Self Service Procurement, iProcurement) | Interface « e-commerce » pour les non-acheteurs : recherche catalogue, panier, favoris, **requisition templates** (liste récurrente « commande hebdo emballages »), copie d'une DA antérieure, demande non cataloguée via Smart Form. | Réduit la friction pour chefs d'atelier et caissières ; la liste récurrente est très pertinente pour les consommables. | Standard |
| D2.5 | Statut de DA dérivé des BC et réceptions | Statut de ligne de DA recalculé : `commandé partiellement` (qté BC < qté DA), `commandé`, `reçu partiellement`, `reçu`, `clos` ; champs `quantity_delivered`, `quantity_cancelled` sur la ligne de DA (EBS : `PO_REQUISITION_LINES_ALL.QUANTITY_DELIVERED`). Le demandeur voit la progression sans ouvrir le BC. | Ferme la boucle demandeur → réception ; évite le « déjà commandé » bloquant à vie (problème corrigé par mig 271). | Socle |
| D2.6 | Transferts internes et demandes de rupture | Demande interne entre zones/dépôts (économat → atelier, boutique → labo) traitée comme une DA de type `TRANSFERT` sans fournisseur (Fusion : Internal Material Transfer ; EBS : Internal Requisition → Internal Sales Order). Demande de « rupture » (urgence) avec priorité et SLA. | Le module existant a déjà `TransferRequestsList` / `RuptureRequestsList` : les rattacher à un modèle de demande unifié plutôt que deux flux parallèles. | Standard |

---

## D3 — Sourcing & approbation

**Tables EBS** : approbation : `PO_APPROVAL_LIST_HEADERS/LINES`, `PO_ACTION_HISTORY` (historique des actions : SUBMIT, APPROVE, REJECT, FORWARD, CANCEL, avec `ACTION_DATE`, `EMPLOYEE_ID`, `NOTE`), `PO_POSITION_CONTROLS_ALL`, `PO_CONTROL_GROUPS_ALL` / `PO_CONTROL_RULES` (approval groups : plafond par montant, compte, catégorie, article, site), `PO_DOCUMENT_TYPES_ALL`. Sourcing EBS : `PO_HEADERS_ALL` type `RFQ` / `QUOTATION`, `PO_RFQ_VENDORS`, Oracle Sourcing (`PON_AUCTION_HEADERS_ALL`, `PON_BID_HEADERS`).

**Fusion** : Approval Management (BPM/AMX : règles par montant, catégorie, centre de coût, projet ; approbation en série/parallèle/premier répondant ; délégation, vacation rules, escalade, re-approbation sur modification), Oracle Sourcing (Negotiations : RFI, RFQ, Auction ; Award ; conversion en PO/Agreement), Procurement Contracts.

| # | Capacité | Description précise | Pourquoi | Niveau |
|---|---|---|---|---|
| D3.1 | Règles d'approbation paramétrables (approval groups & seuils) | Règles : **par montant** (0–2 000 MAD : chef d'atelier ; 2 000–20 000 : responsable achats ; > 20 000 : gérant), **par catégorie** (immobilisations : toujours gérant), **par compte/centre de coût**, par fournisseur **hors ASL**, par **écart prix vs tarif** (> 5 % → approbation supplémentaire). Chaînes : en série, parallèle (tous), premier répondant. Résultat stocké comme **liste d'approbation figée** à la soumission (`PO_APPROVAL_LIST_LINES`), ré-évaluée si le document change. | Transforme une procédure orale en règle vérifiable ; la liste figée garantit la reproductibilité à l'audit. | Socle |
| D3.2 | Historique des actions (action history) | Table append-only : `(document_type, document_id, revision, sequence, action, actor, delegate_of, action_date, note)` ; actions : SUBMIT, APPROVE, REJECT, RETURN, FORWARD, CANCEL, REOPEN, CHANGE_SUBMITTED ; consultable en pied de document. | Pièce maîtresse de l'audit trail : qui a approuvé quelle version et quand. | Socle |
| D3.3 | Délégation, remplacement et escalade | Règles de vacance (vacation rules : « du 1 au 15, transférer à X »), délégation permanente par type de document et plafond, **escalade automatique après N heures** sans réponse vers le supérieur, réassignation par l'administrateur. Trace « approuvé par X **pour** Y ». | Sans délégation, l'approbation bloque les commandes du lundi ; la trace « pour » préserve la responsabilité. | Standard |
| D3.4 | Re-approbation sur modification (change order approval) | Après approbation, toute modification d'un champ « contrôlé » (quantité, prix, fournisseur, imputation, date au-delà d'une tolérance) crée une **révision** et redéclenche l'approbation ; les champs non contrôlés (note interne, contact) ne la déclenchent pas. Liste des champs contrôlés paramétrable. Fusion : Change Order avec « Reapproval rules » ; EBS : `PO_HEADERS_ALL.REVISION_NUM` + archive `PO_HEADERS_ARCHIVE_ALL`. | Empêche de contourner l'approbation en modifiant le BC après signature. | Socle |
| D3.5 | Demande de devis (RFQ) et comparaison d'offres | Objet **négociation** : lignes (article, quantité, unité), fournisseurs invités, date limite ; **devis** par fournisseur (prix unitaire, délai, validité, remarques) saisi par l'acheteur ou via portail ; **tableau comparatif** (prix, prix converti en unité de stock, délai, score qualité) ; **attribution** (award) partielle ou totale → création de BC ou d'accord-cadre ; motif de choix si ce n'est pas le moins cher. | Pour une boulangerie : utile 2 fois par an (farine, beurre, emballages) ; la comparaison **au kg/L** est le point clé. | Standard |
| D3.6 | Enchères inversées, RFI, scoring pondéré | Enchères inversées en ligne, RFI (information), **critères pondérés** (prix 60 %, délai 20 %, qualité 20 %) avec notation d'équipe, multi-rondes. | Hors périmètre d'une PME ; cité pour complétude. | Avancé |
| D3.7 | Contrats et accords-cadres (Blanket & Contract Purchase Agreements) | **BPA** (Blanket Purchase Agreement) : en-tête fournisseur + lignes article × prix × période de validité × **paliers de quantité** + **montant/quantité engagé (agreed amount)** ; les **releases** (BC d'appel) consomment l'accord ; `released_amount`, `remaining`. **CPA** (Contract Purchase Agreement) : conditions générales et montant plafond **sans lignes d'articles** ; les BC standard y font référence. Statuts : brouillon, approuvé, ouvert, **expiré**, clos, annulé. Alertes à 80 % de consommation et avant expiration. EBS : `PO_HEADERS_ALL.TYPE_LOOKUP_CODE IN ('BLANKET','CONTRACT')`, `PO_RELEASES_ALL`, `PO_LINES_ALL.QUANTITY_COMMITTED`, `AMOUNT_LIMIT`. | Le prix négocié annuel (farine, sucre) vit dans la BPA ; chaque BC hérite le prix et on mesure la consommation de l'engagement. Très pertinent même à petite échelle. | Standard |
| D3.8 | Approbation mobile / par e-mail avec jeton | Notification (e-mail, WhatsApp, push) contenant le résumé du document et des actions « Approuver / Rejeter » authentifiées (jeton à usage unique, expiration) ; l'action est enregistrée dans l'historique avec le canal. | Le gérant approuve depuis le téléphone ; sinon la DA attend. | Standard |

---

## D4 — Commande (bon de commande)

**Tables EBS (R12)** :
- `PO_HEADERS_ALL` : `PO_HEADER_ID`, `SEGMENT1` (numéro BC), `TYPE_LOOKUP_CODE` (STANDARD, PLANNED, BLANKET, CONTRACT, RFQ, QUOTATION), `VENDOR_ID`, `VENDOR_SITE_ID`, `AGENT_ID` (acheteur), `CURRENCY_CODE`, `RATE`, `TERMS_ID`, `SHIP_TO_LOCATION_ID`, `BILL_TO_LOCATION_ID`, `REVISION_NUM`, `AUTHORIZATION_STATUS` (INCOMPLETE/IN PROCESS/APPROVED/REJECTED/REQUIRES REAPPROVAL/PRE-APPROVED), `CLOSED_CODE` (OPEN/CLOSED/CLOSED FOR RECEIVING/CLOSED FOR INVOICE/FINALLY CLOSED), `CANCEL_FLAG`, `APPROVED_DATE`, `PRINT_COUNT`, `ACCEPTANCE_REQUIRED_FLAG`.
- `PO_LINES_ALL` : `PO_LINE_ID`, `LINE_NUM`, `ITEM_ID`, `ITEM_DESCRIPTION`, `CATEGORY_ID`, `UNIT_MEAS_LOOKUP_CODE` (unité d'achat), `UNIT_PRICE`, `QUANTITY`, `LINE_TYPE_ID` (quantité/montant), `CLOSED_CODE`, `CANCEL_FLAG`, `QUANTITY_COMMITTED` (BPA), `PRICE_BREAK_LOOKUP_CODE`, `VENDOR_PRODUCT_NUM`.
- `PO_LINE_LOCATIONS_ALL` (« shipments » = échéances de livraison) : `LINE_LOCATION_ID`, `SHIPMENT_NUM`, `SHIP_TO_ORGANIZATION_ID`, `SHIP_TO_LOCATION_ID`, `QUANTITY`, **`QUANTITY_RECEIVED`, `QUANTITY_ACCEPTED`, `QUANTITY_REJECTED`, `QUANTITY_BILLED`, `QUANTITY_CANCELLED`**, `PRICE_OVERRIDE`, `NEED_BY_DATE`, `PROMISED_DATE`, `RECEIVING_ROUTING_ID` (direct / standard / inspection), **`MATCH_OPTION`** (P = PO, R = receipt), **`INSPECTION_REQUIRED_FLAG`, `RECEIPT_REQUIRED_FLAG`** (déterminent 2/3/4-way), **`QTY_RCV_TOLERANCE`, `QTY_RCV_EXCEPTION_CODE`** (NONE/REJECT/WARNING), `DAYS_EARLY_RECEIPT_ALLOWED`, `DAYS_LATE_RECEIPT_ALLOWED`, `RECEIPT_DAYS_EXCEPTION_CODE`, **`ACCRUE_ON_RECEIPT_FLAG`**, `CLOSED_CODE`, `TAX_CODE_ID`.
- `PO_DISTRIBUTIONS_ALL` : `PO_DISTRIBUTION_ID`, `DISTRIBUTION_NUM`, `LINE_LOCATION_ID`, `CODE_COMBINATION_ID` (compte de charge), **`ACCRUAL_ACCOUNT_ID`**, `VARIANCE_ACCOUNT_ID`, `QUANTITY_ORDERED`, **`QUANTITY_DELIVERED`, `QUANTITY_BILLED`, `QUANTITY_CANCELLED`**, `AMOUNT_BILLED`, `DESTINATION_TYPE_CODE` (INVENTORY / EXPENSE / SHOP FLOOR), `DELIVER_TO_PERSON_ID`, `REQ_DISTRIBUTION_ID` (lien vers la DA), `PROJECT_ID`/`TASK_ID`, `ENCUMBERED_FLAG`.
- Archive de révisions : `PO_HEADERS_ARCHIVE_ALL`, `PO_LINES_ARCHIVE_ALL`, `PO_LINE_LOCATIONS_ARCHIVE_ALL`, `PO_DISTRIBUTIONS_ARCHIVE_ALL` (une copie par `REVISION_NUM`, `LATEST_EXTERNAL_FLAG`).
- Numérotation : `PO_UNIQUE_IDENTIFIER_CONTROL` (automatique/manuelle, numérique/alpha, par type de document).

**Fusion** : Purchase Order (document styles, Purchase Agreements, Change Orders avec numéros de change order et comparaison de versions, Communication (PDF e-mail/fax/B2B), Acknowledgment, Close/Final Close/Cancel, Hold, Freeze).

| # | Capacité | Description précise | Pourquoi | Niveau |
|---|---|---|---|---|
| D4.1 | Structure BC à 4 niveaux : en-tête / ligne / échéance de livraison / distribution | **En-tête** : fournisseur + site, acheteur, devise, conditions, lieu de facturation, type/style, révision, statut d'approbation, statut de clôture. **Ligne** : quoi (article/description), combien (quantité en **unité d'achat**), à quel prix. **Échéance (shipment / schedule)** : où et quand (lieu de livraison, date demandée, date promise), **quantités reçue/acceptée/rejetée/facturée/annulée**, paramètres de réception et de rapprochement. **Distribution** : qui paie (compte, atelier, projet, %) et **quantités livrée/facturée par imputation**. Pour une PME : l'échéance est souvent 1:1 avec la ligne ; conserver le niveau quand même (livraisons fractionnées, deux dépôts). | C'est LE pattern à reproduire : les compteurs vivent au niveau échéance/distribution, les statuts d'en-tête sont dérivés. Permet réceptions partielles, factures partielles et imputations multiples sans ambiguïté. | Socle |
| D4.2 | Styles / types de documents (document styles) | Types : **BC standard**, **BC de services / montant** (ligne « amount-based » : quantité = montant, prix = 1), **accord-cadre (BPA)**, **contrat (CPA)**, **release/appel**, **BC de charges** (énergie, loyer : sans réception physique, 2-way), **BC d'immobilisation** (destination = immo). Un style active/désactive des fonctionnalités (réception requise, inspection, paliers de prix) et impose la numérotation. | Évite de forcer les charges dans le moule « marchandise à réceptionner en kg ». | Socle |
| D4.3 | Numérotation de documents paramétrable | Par type et par entité : séquence automatique ou manuelle, préfixe/année (`BC-2026-00042`), sans trou (gapless, séquence réservée à la validation, pas au brouillon) ; numéro de **révision** séparé (`BC-2026-00042 rév. 2`). Réservation transactionnelle (`SELECT ... FOR UPDATE` sur table de compteurs). | Exigence légale/fiscale (continuité), et pratique (recherche). Le numéro ne doit pas être le `serial` technique. | Socle |
| D4.4 | Type de ligne : quantité vs montant vs service récurrent | `line_type` : **QUANTITY** (qté × prix, unité d'achat, réceptionnable en stock), **AMOUNT** (montant, réception en montant ou pas de réception), **FIXED_PRICE_SERVICE** (forfait), **RATE_BASED** (taux × heures). Détermine le rapprochement (quantité ou montant) et la nature de la réception. | Les charges (électricité, maintenance) n'ont pas de kg. | Socle |
| D4.5 | Unité d'achat ≠ unité de stock avec conversion figée sur la ligne | La ligne porte `uom_achat` (sac), `qty_achat` (10), **`conversion_to_stock`** (25 kg/sac, copié de l'article **au moment de la commande**, surchargeable), `qty_stock_equivalent` (250 kg) et **prix par unité de stock calculé** (MAD/kg). La réception peut saisir en sacs **ou** en kg (pesée). Changement de conditionnement chez le fournisseur → nouvelle ligne, pas de modification du facteur historique. | Mémoire « Contenants par ingrédient » (mig 226) et « unités d'affichage » : on affiche l'unité saisie, on calcule en interne. Figer la conversion sur la ligne protège l'historique. | Socle |
| D4.6 | Révisions et avenants (change orders) avec versionnage complet | Toute modification après approbation = **change order** : `revision_num + 1`, **snapshot immuable** de la version précédente (tables `*_archive` ou JSONB `po_revisions`), **diff** lisible (champ, ancienne valeur, nouvelle valeur, auteur, motif), re-approbation si champ contrôlé (D3.4), **réimpression/renvoi** au fournisseur, numéro de change order séquentiel. Interdits : réduire la quantité sous la quantité déjà reçue ; changer le fournisseur après réception ; modifier le prix d'une échéance déjà facturée (créer un avoir/complément à la place). | Audit, litiges fournisseur (« quelle version a-t-il reçue ? »), et cohérence des compteurs. | Socle |
| D4.7 | Statut de clôture distinct du statut d'approbation, à chaque niveau | Deux axes orthogonaux : **`approval_status`** (brouillon, en cours, approuvé, rejeté, à ré-approuver) et **`closed_code`** (ouvert, **clos pour réception**, **clos pour facturation**, **clos**, **clos définitivement**), plus `cancel_flag`. `closed_code` calculé automatiquement par les tolérances de clôture (reçu ≥ 100 % − tolérance → clos pour réception ; facturé ≥ reçu − tolérance → clos pour facturation) ; clôture manuelle possible avec motif ; **clôture définitive (final close)** irréversible, interdit toute réception/facture ultérieure. Le statut d'en-tête = agrégat des lignes (toutes lignes closes → en-tête clos). | Évite le BC « approuvé » ambigu ; permet d'afficher un BC « reçu, facture attendue » sans champ booléen bricolé. | Socle |
| D4.8 | Annulation partielle (ligne/échéance) avec quantité annulée | `cancel_flag` + **`quantity_cancelled`** au niveau échéance et distribution ; annuler ne supprime jamais ; la quantité restante attendue = `ordered − received − cancelled` ; interdiction d'annuler en dessous de la quantité reçue ; motif obligatoire ; impact sur les engagements de l'accord-cadre et sur la DA d'origine (ré-ouverture possible). | « Relance plan de production » débloque les annulations : il faut un compteur dédié, pas un `status='cancelled'` destructeur. | Socle |
| D4.9 | Communication et accusé de réception du BC | Génération PDF (logo en data URI, cf. mémoire Cloud Run), envoi e-mail/WhatsApp avec **journal d'envoi** (date, canal, destinataire, révision envoyée, `print_count`), **accusé de réception fournisseur** (`acknowledgment_status` : requis / accepté / refusé / accepté avec modifications, date), promesse de livraison (`promised_date` vs `need_by_date`). | Le fournisseur ne pourra pas prétendre ne pas avoir reçu la rév. 2 ; la date promise alimente le suivi de retard. | Standard |
| D4.10 | Blocages (hold / freeze) et contrôles de saisie | **Hold** : suspend réception et facturation d'un BC (litige) ; **Freeze** : interdit toute modification tout en permettant réception/facture. Contrôles bloquants/avertissements : fournisseur inactif, hors ASL, écart prix vs tarif > tolérance, dépassement du plafond d'accord-cadre, date de besoin passée, doublon probable (même fournisseur, même article, même semaine). | Les contrôles au moment de la saisie coûtent moins qu'une correction après réception. | Standard |
| D4.11 | Copie, modèles et commande récurrente | Dupliquer un BC (sans compteurs ni révision), modèles de BC par fournisseur (« commande emballages hebdo »), génération depuis la dernière commande avec prix actualisés depuis la liste de prix. | 300 BC/an avec 40 fournisseurs = beaucoup de répétition. | Standard |
| D4.12 | Engagements et contrôle budgétaire (encumbrance / budgetary control) | À l'approbation du BC : écriture d'**engagement** par distribution (compte, période) ; libération à la facture ; contrôle de disponibilité budgétaire bloquant ou avertissant. EBS : `ENCUMBERED_FLAG`, `GL_BC_PACKETS`. | Utile pour les charges à budget (marketing, travaux) ; avancé pour une PME. | Avancé |

---

## D5 — Réception & qualité

**Tables EBS** : `RCV_SHIPMENT_HEADERS` (en-tête de réception : `RECEIPT_NUM`, `SHIPMENT_NUM` = n° BL fournisseur, `VENDOR_ID`, `SHIPPED_DATE`, `RECEIPT_SOURCE_CODE` VENDOR/INVENTORY/CUSTOMER, `ASN_TYPE`), `RCV_SHIPMENT_LINES` (ligne attendue/reçue, `PO_LINE_LOCATION_ID`, `QUANTITY_SHIPPED`, `QUANTITY_RECEIVED`, `ITEM_ID`, `UNIT_OF_MEASURE`), **`RCV_TRANSACTIONS`** (journal de toutes les transactions : `TRANSACTION_TYPE` ∈ RECEIVE, ACCEPT, REJECT, TRANSFER, DELIVER, RETURN TO VENDOR, RETURN TO RECEIVING, CORRECT, MATCH ; `PARENT_TRANSACTION_ID` (arbre), `QUANTITY`, `UNIT_OF_MEASURE`, `PRIMARY_QUANTITY`, `PRIMARY_UNIT_OF_MEASURE`, `PO_DISTRIBUTION_ID`, `DESTINATION_TYPE_CODE`, `SUBINVENTORY`, `LOCATOR_ID`, `ROUTING_HEADER_ID` (1 standard, 2 inspection, 3 direct), `PO_UNIT_PRICE`, `CURRENCY_CONVERSION_RATE`, `ACCRUAL ACCOUNT`), `RCV_LOTS_SUPPLY`, `RCV_RECEIVING_SUB_LEDGER` (écritures), `RCV_TRANSACTIONS_INTERFACE` (ASN, import), `RCV_RECEIVING_PARAMETERS` (paramètres par organisation : tolérances, routage, blind receiving).

**Fusion** : Receiving (Receive Expected Shipments, Inspect, Put Away/Deliver, Return, Correct, Receipt Advice, ASN/ASBN via Supplier Portal), Quality Inspection Plans (Fusion Quality Management).

| # | Capacité | Description précise | Pourquoi | Niveau |
|---|---|---|---|---|
| D5.1 | Réception contre BC avec journal de transactions immuable | Réception = **en-tête** (n° interne séquentiel, n° BL fournisseur, date, fournisseur, réceptionnaire, transporteur, remarques) + **transactions** append-only : `RECEIVE` (quai) → `ACCEPT`/`REJECT` (inspection) → `DELIVER` (mise en stock dans zone/sous-dépôt) ; chaque transaction porte `parent_transaction_id`, quantité en **unité de transaction** et en **unité primaire (kg/L)**, `po_line_location_id`, `po_distribution_id`, prix BC au moment de la réception, horodatage, auteur. Jamais de UPDATE sur une transaction : corriger = nouvelle transaction (D5.6). | `RCV_TRANSACTIONS` est le grand livre physique ; c'est ce qui rend la traçabilité (QA, audits) et la comptabilité (D8) possibles. | Socle |
| D5.2 | Routage de réception : direct / standard / inspection | Par article × fournisseur × BC : **direct** (RECEIVE + DELIVER en une action : farines du fournisseur habituel), **standard** (réception au quai puis rangement différé), **inspection** (RECEIVE → ACCEPT/REJECT → DELIVER ; obligatoire pour 4-way). Routage par défaut hérité (article → fournisseur → échéance BC), surchargeable à la réception. | Permet la réception rapide du quotidien et le contrôle renforcé sur les matières sensibles (beurre, crème, œufs). | Standard |
| D5.3 | Réception partielle, multiple, en excédent avec tolérances | Plusieurs réceptions pour une échéance ; **tolérance de surlivraison** (`qty_rcv_tolerance` % + `exception_code` NONE/WARNING/REJECT) ; tolérance de date (`days_early/late_allowed`) ; **quantité restante** = `ordered − received − cancelled` affichée et proposée par défaut ; blocage si BC clos/en hold/non approuvé. | Le fournisseur livre 11 sacs pour 10 : accepter jusqu'à +5 %, refuser au-delà (ou avertir), sans contourner le système. | Socle |
| D5.4 | Saisie par contenant avec conversion, pesée, lots et DLC | À la réception : quantité en **contenants** (sacs, cartons, bidons), conversion en kg/L via facteur de la ligne, **pesée réelle optionnelle** (écart conditionnement affiché), **numéro de lot fournisseur**, **DLC/DDM**, température à l'arrivée (chaîne du froid), zone de destination ; création de **lots internes** (`ingredient_lots`) liés à la transaction de réception (`rcv_transaction_id`). Écart contenant théorique vs pesé stocké. | Cœur de la traçabilité alimentaire (lot fournisseur → lot interne → production → produit vendu). Déjà partiellement en place (mig 226, audit pesage W-x) ; le lien transaction de réception ↔ lot doit être explicite. | Socle |
| D5.5 | Inspection qualité (accept / reject) et plan de contrôle | Transactions `ACCEPT` / `REJECT` avec **code de motif** (température hors norme, emballage abîmé, DLC trop courte, corps étranger), quantité par motif, photos, **plan d'inspection** par article (critères, échantillonnage), décision : accepté / accepté avec dérogation / rejeté → retour (D5.7). `quantity_accepted` / `quantity_rejected` remontent sur l'échéance BC (4-way). | Exigence HACCP / ONSSA ; la quantité acceptée (pas reçue) sert le rapprochement 4-way et la décision de payer. | Standard |
| D5.6 | Correction de réception (CORRECT) | Transaction `CORRECT` (quantité positive ou négative) rattachée à la transaction corrigée, avec motif ; recalcule les compteurs BC et le stock ; interdite si la quantité à corriger est déjà facturée/rapprochée (ou alors avertissement + hold facture) ; interdite si le lot est déjà consommé en production (au-delà de la quantité disponible). Fenêtre de correction paramétrable (ex. 7 jours). | On s'est trompé de 2 sacs hier : on ne modifie pas la ligne, on corrige par delta ; le stock et la compta suivent. | Socle |
| D5.7 | Retour fournisseur (Return to Supplier / RTV) | Transaction `RETURN TO VENDOR` (ou `RETURN TO RECEIVING` d'abord si déjà rangé) : quantité, lot, motif, **bon de retour** imprimable, référence au BL d'origine ; décrémente `quantity_received` (ou `quantity_accepted`), **remet la quantité « à recevoir »** sur le BC (ou pas, selon option « réapprovisionner / annuler »), génère une **attente d'avoir** (debit memo) en facturation (D6.9). | Clôt la boucle qualité ; sans RTV, les rejets finissent en « casse » et le fournisseur est payé pour rien. | Standard |
| D5.8 | Avis d'expédition (ASN / ASBN) et réception attendue | Le fournisseur annonce l'expédition (lignes, quantités, lots, date, n° BL ; ASBN = avec facture) via portail ou import ; crée une **réception attendue** (`RCV_SHIPMENT_HEADERS` avec `ASN_TYPE`) ; la réception consiste à confirmer/ajuster ; l'écart ASN vs reçu est tracé. | Avancé pour une PME ; alternative : l'acheteur saisit le BL « attendu » à la réception de la confirmation du fournisseur (WhatsApp). | Avancé |
| D5.9 | Réception sans BC (unordered receipt) puis rapprochement | Réception d'une livraison surprise ou d'un BC oublié : transaction `RECEIVE` avec `po_line_location_id NULL`, statut `à rapprocher` ; opération **match unordered receipt** ultérieure vers un BC créé/approuvé a posteriori ; bloque la facture tant que non rapproché ; indicateur de « non-conformité processus » en reporting. | La réalité du terrain (le livreur arrive, pas de BC) ne doit pas forcer à contourner le système ; elle doit être tracée comme exception. | Standard |
| D5.10 | Réception de services et de charges (par montant / par confirmation) | Pour lignes `AMOUNT`/service : « réception » = **attestation de service fait** (montant, période, attestant) ; pour les charges 2-way, pas de réception, la facture suffit. | Formalise le « service fait » exigé avant paiement d'une prestation (maintenance, nettoyage). | Standard |
| D5.11 | Réception aveugle (blind receiving) et contrôles de saisie | Option : l'écran de réception **ne montre pas la quantité attendue** ; le réceptionnaire compte, saisit, puis le système révèle l'écart. Alertes : BC déjà totalement reçu, article non attendu, lot déjà connu, DLC inférieure au seuil. | Fiabilise le comptage (sinon on « confirme » la quantité affichée). Simple à implémenter, fort effet. | Standard |
| D5.12 | Réception → mouvement de stock et valorisation au prix BC | Chaque `DELIVER` crée un mouvement de stock (`+qty_primary`, zone, lot, DLC) **valorisé au prix de la ligne BC converti en unité de stock** (puis ajusté à la facture, D8.3) ; stock « en quai » (reçu non rangé) visible séparément. Sens inverse pour RTV/CORRECT. | Le coût matière du plan de production dépend de ce prix ; la séparation quai/stock explique les écarts d'inventaire. | Socle |

---

## D6 — Facturation & rapprochement

**Tables EBS** : `AP_INVOICES_ALL` (`INVOICE_ID`, `INVOICE_NUM` (unique par fournisseur), `INVOICE_TYPE_LOOKUP_CODE` STANDARD / CREDIT / DEBIT / PREPAYMENT / MIXED / EXPENSE REPORT, `VENDOR_ID`, `VENDOR_SITE_ID`, `INVOICE_DATE`, `GL_DATE`, `INVOICE_AMOUNT`, `AMOUNT_PAID`, `PAYMENT_STATUS_FLAG` N/P/Y, `TERMS_ID`, `TERMS_DATE`, `SOURCE`, `PO_HEADER_ID` (si « match to PO » global), `CANCELLED_DATE`), `AP_INVOICE_LINES_ALL` (R12 : `LINE_TYPE_LOOKUP_CODE` ITEM / FREIGHT / MISCELLANEOUS / TAX / PREPAY ; `MATCH_TYPE` ITEM_TO_PO / ITEM_TO_RECEIPT / PRICE_CORRECTION / QTY_CORRECTION ; `PO_LINE_LOCATION_ID`, `RCV_TRANSACTION_ID`, `QUANTITY_INVOICED`, `UNIT_PRICE`, `AMOUNT`), `AP_INVOICE_DISTRIBUTIONS_ALL` (`PO_DISTRIBUTION_ID`, `RCV_TRANSACTION_ID`, `DIST_CODE_COMBINATION_ID`, `LINE_TYPE_LOOKUP_CODE` ITEM / IPV (invoice price variance) / ERV (exchange rate variance) / TAX / NONREC_TAX / FREIGHT ; `MATCH_STATUS_FLAG`, `POSTED_FLAG`), **`AP_HOLDS_ALL`** (`HOLD_LOOKUP_CODE` : QTY ORD, QTY REC, PRICE, AMT ORD, AMT REC, QUALITY, MAX QTY ORD, MAX QTY REC, MAX RATE AMOUNT, TAX VARIANCE, DIST VARIANCE, PO NOT APPROVED, CANT FUNDS CHECK, NO RATE, DIST ACCT INVALID, INSUFFICIENT INFORMATION, VENDOR (hold manuel) ; `RELEASE_LOOKUP_CODE`, `HELD_BY`, `RELEASE_REASON`), `AP_TOLERANCE_TEMPLATES` (R12 : `QTY_ORD_TOLERANCE`, `MAX_QTY_ORD_TOLERANCE`, `QTY_REC_TOLERANCE`, `MAX_QTY_REC_TOLERANCE`, `PRICE_TOLERANCE`, `SHIPMENT_AMT_TOLERANCE`, `TOTAL_AMT_TOLERANCE`…), `AP_INVOICES_INTERFACE` / `AP_INVOICE_LINES_INTERFACE` (Payables Open Interface), `AP_INVOICE_PAYMENTS_ALL`.

**Fusion** : Payables Invoices (Create Invoice, Import Invoices, Scan/IDR – Intelligent Document Recognition), Matching (to PO, to Receipt, to Consumption Advice), Invoice Validation (holds), Invoice Approval (BPM), Supplier Portal invoice entry, Self-Billing / ERS (Evaluated Receipt Settlement / Pay on Receipt).

| # | Capacité | Description précise | Pourquoi | Niveau |
|---|---|---|---|---|
| D6.1 | Facture fournisseur structurée : en-tête / lignes / distributions, types de facture | **En-tête** : fournisseur + site, `invoice_num` **unique par fournisseur**, dates (facture, réception facture, comptable/GL date), montant TTC déclaré, devise, conditions, **type** (standard, **avoir / credit memo**, **note de débit**, **acompte / prepayment**, mixte), source (saisie, portail, import, scan), statut (`saisie`, `à valider`, `validée`, `en hold`, `approuvée`, `payée partiellement`, `payée`, `annulée`). **Lignes** : type (ARTICLE, FRAIS DE PORT, DIVERS, TAXE), quantité facturée, prix, montant, **TVA par ligne** (mig 189), référence au BC/réception. **Distributions** : imputation comptable par ligne (compte de charge ou **compte d'attente réception** si 3-way), type ITEM / **IPV** / TAX / FREIGHT. Total des lignes doit = montant d'en-tête (sinon hold `DIST VARIANCE`). | La structure à 3 niveaux et le type de ligne (ITEM vs IPV) sont ce qui permet d'isoler l'écart de prix en compta au lieu de le noyer dans la charge. | Socle |
| D6.2 | Rapprochement 2-way / 3-way / 4-way paramétrable par ligne | Niveau porté par l'**échéance de BC** (hérité du site fournisseur / article / style de document) : **2-way** = facture vs BC (qté, prix) ; **3-way** = + facture ≤ **reçu** ; **4-way** = + facture ≤ **accepté** (inspection). Options de match : **au BC** (`match_option = 'P'`, qté facturée cumulée sur l'échéance) ou **à la réception** (`'R'`, la ligne de facture référence une `rcv_transaction_id` précise — recommandé pour les ingrédients : prix figé à la réception, lot identifié). Charges (électricité) : 2-way ou pas de BC. | Le 3-way « à la réception » est la protection standard contre « facturé plus que livré » ; le 4-way protège contre « facturé le rejeté ». Choix **par ligne**, pas global. | Socle |
| D6.3 | Tolérances de rapprochement (quantité, prix, montant) et holds automatiques | Modèle de tolérances (par fournisseur/site, défaut global) : **quantité commandée** (% et plafond absolu `MAX_QTY_ORD`), **quantité reçue** (%, plafond), **prix** (% : facturé > BC × (1 + tol) → hold `PRICE` ; en dessous → pas de hold, IPV favorable), **montant d'échéance**, **montant total**, **taux de change**, **taxe**. Chaque dépassement crée **un hold distinct** (`QTY ORD`, `QTY REC`, `PRICE`, `AMT ORD`, `QUALITY`) ; la facture est bloquée en paiement tant qu'un hold subsiste. Holds **systèmes** (levés automatiquement à la re-validation si la cause disparaît : réception saisie, BC modifié) vs **manuels** (`VENDOR`, levés par un utilisateur avec motif). Journal des holds (posé le, par, levé le, par, motif). | Rend le contrôle **mécanique et traçable** : l'acheteur voit « hold QTY REC : 240 kg facturés, 225 reçus ». Mémoire « réconciliation » : l'écart prix facturé/BC existe déjà (mig 263) ; le hold formalise le blocage. | Socle |
| D6.4 | Validation de facture (Invoice Validation) et séparation validation / approbation / paiement | **Validation** (mécanique) : contrôles de cohérence (totaux, distributions, taxes, période ouverte, BC approuvé, fournisseur actif, doublon `invoice_num`), rapprochement, pose/levée des holds → statut `validée` ou `en hold`. **Approbation** (humaine, workflow D3) : pour factures sans BC ou avec écarts résiduels, selon seuils. **Paiement** : D7, uniquement si validée + approuvée + sans hold + échéance atteinte. Trois états indépendants stockés séparément (`validation_status`, `approval_status`, `payment_status`). | La confusion « validée = payable » est la source classique d'erreurs ; trois axes = trois colonnes. | Socle |
| D6.5 | Correction de prix et de quantité (price / quantity correction) et avoirs rapprochés | Ligne de facture de type **PRICE_CORRECTION** (référence la ligne facturée d'origine, modifie le prix sans toucher la quantité : avoir ou complément) ou **QTY_CORRECTION** ; **avoir (credit memo) rapproché** au BC/réception → décrémente `quantity_billed`/`amount_billed` ; avoir **non rapproché** affecté au fournisseur. Lien `corrected_invoice_line_id`. | Un avoir « en l'air » casse le rapprochement ; un avoir rapproché remet les compteurs d'aplomb et libère le hold. | Standard |
| D6.6 | Facture multi-BC / multi-réceptions et facture partielle | Une facture couvre N réceptions de N BC du même fournisseur (lignes rattachées individuellement) ; une réception peut être facturée en plusieurs fois ; **assistant de rapprochement** : lister « réceptions non facturées » du fournisseur, cocher, quantités proposées = reçu − déjà facturé ; saisie **rapide « montant total puis ventilation »**. | Les fournisseurs marocains facturent souvent à la semaine/au mois pour plusieurs BL : le rapprochement 1 facture = 1 BC est irréaliste. | Socle |
| D6.7 | Détection de doublons et contrôles anti-fraude | Unicité `(supplier_id, invoice_num)` stricte (variantes de casse/espaces normalisées), détection « probable doublon » (même fournisseur, même montant, ±5 jours, numéro différent), vérification RIB vs RIB validé (D1.3), **séparation des tâches** : saisie ≠ validation ≠ paiement. | Le double paiement est l'erreur la plus coûteuse en AP. | Socle |
| D6.8 | Acomptes / avances (prepayments) et leur application | Facture de type **PREPAYMENT** (acompte 50 % à la commande : payée avant la facture définitive, compta 3411 « fournisseurs débiteurs, avances »), **application** sur la facture définitive (ligne négative de type PREPAY, réduit le montant à payer), reste à appliquer visible par fournisseur ; lien à un BC. | Les acomptes aux fournisseurs d'équipement/emballage personnalisé sont courants ; sans mécanisme ils finissent en charge. | Standard |
| D6.9 | Attente d'avoir sur retour fournisseur (debit memo automatique) | Un RTV (D5.7) génère une **note de débit attendue** (ou automatique en ERS) : fournisseur, montant = qté retournée × prix facturé, statut `attendu` → `reçu` (avoir du fournisseur rapproché) ; relance si non reçu sous N jours ; compense en paiement. | Boucle qualité → finance ; sans cela, le retour est payé. | Standard |
| D6.10 | Capture de factures (scan / OCR / import / portail) | Import CSV/Excel, scan + reconnaissance (Fusion IDR), e-mail dédié, saisie par le fournisseur sur portail avec **« créer facture depuis BC »** (lignes pré-remplies : le fournisseur ne peut facturer que du reçu). Toute facture importée passe par le même moteur de validation. | Réduit la saisie et le risque d'erreur de frappe sur `invoice_num`/montant ; justifiable à 300 BC/an ? OCR : non ; import depuis photo + pré-remplissage depuis BC : oui. | Avancé (import simple : Standard) |
| D6.11 | Auto-facturation / paiement à la réception (ERS, Pay on Receipt) | Pour fournisseurs/BC flagués `pay_on_receipt`, la réception génère automatiquement une facture rapprochée (qté reçue × prix BC) ; le fournisseur reçoit un relevé au lieu d'émettre une facture. | Rare au Maroc (facture fiscale fournisseur obligatoire) ; cité pour complétude. | Avancé |
| D6.12 | Taxes : TVA par ligne, récupérable / non récupérable, retenue à la source | Code TVA par ligne (20 %, 14 %, 10 %, 7 %, 0 %, exonéré), montant calculé vs **TVA déclarée** sur la facture (tolérance d'arrondi 0,01–0,10 MAD, sinon hold `TAX VARIANCE`), TVA non récupérable imputée en charge, **retenue à la source** (RAS sur prestations, honoraires) calculée au paiement, période de déductibilité (date de paiement pour la TVA sur débits/encaissements). | Conformité fiscale marocaine ; mig 189 a déjà posé la TVA par ligne. | Socle |

---

## D7 — Paiements & trésorerie fournisseurs

**Tables EBS** : `AP_INVOICE_PAYMENTS_ALL`, `AP_CHECKS_ALL` (tout paiement, pas seulement chèque : `CHECK_NUMBER`, `PAYMENT_METHOD_CODE`, `BANK_ACCOUNT_ID`, `STATUS_LOOKUP_CODE` NEGOTIABLE/VOIDED/CLEARED/RECONCILED), `AP_PAYMENT_SCHEDULES_ALL` (**échéancier** par facture : `DUE_DATE`, `AMOUNT_REMAINING`, `GROSS_AMOUNT`, `DISCOUNT_DATE`, `HOLD_FLAG`, `PAYMENT_PRIORITY`), `AP_SELECTED_INVOICES_ALL` (lot de paiement), `AP_INV_SELECTION_CRITERIA_ALL`, `IBY_PAY_SERVICE_REQUESTS` / `IBY_PAYMENTS_ALL` (R12 Payments), `CE_STATEMENT_LINES` (relevés bancaires, Cash Management).

**Fusion** : Payables Payments (Payment Process Requests, Payment Methods, Payment Terms with installments & discounts, Bank Accounts, Positive Pay, Electronic Payment Files, Payment Approval), Cash Management (bank reconciliation, cash forecasting).

| # | Capacité | Description précise | Pourquoi | Niveau |
|---|---|---|---|---|
| D7.1 | Échéancier par facture (payment schedules) avec conditions multi-échéances | À la validation, génération de **1..N échéances** depuis les conditions (`30 j`, `30 j fin de mois`, `50 % à 30 j + 50 % à 60 j`), chacune avec `due_date`, `gross_amount`, **`amount_remaining`**, `discount_date`/`discount_amount` (escompte), `hold_flag`, priorité ; la facture est `payée` quand toutes les échéances ont `amount_remaining = 0`. | Le `paid_amount` atomique de la mémoire « réconciliation » devient une somme d'échéances : plus robuste pour les paiements partiels et les effets à 30/60/90. | Socle |
| D7.2 | Paiement multi-factures, partiel, multi-modes, et lots de paiement | Un **paiement** (`payment_id`, date, mode : virement / chèque n° / effet / espèces / compensation, compte bancaire, référence, montant) règle **N échéances** de N factures (table de ventilation `payment_applications`) ; paiement partiel d'une échéance ; **lot de paiement** (Payment Process Request) : sélection par critères (échéance ≤ date, fournisseur, priorité, montant max de trésorerie), revue, validation, génération des ordres (fichier virement bancaire / impression chèques), confirmation. | Un virement de 48 350 MAD couvre 3 factures d'un fournisseur et un acompte : la ventilation N:N est indispensable au lettrage. | Socle |
| D7.3 | Blocages de paiement et contrôles avant règlement | Hold de facture (D6.3) ⇒ non sélectionnable ; hold fournisseur « tous paiements » ; **approbation de paiement** au-dessus d'un seuil ou pour tout changement de RIB récent ; contrôle double saisie/validation (4 yeux) ; contrôle solde bancaire prévisionnel. | Dernière barrière avant la sortie de cash. | Socle |
| D7.4 | Annulation (void), rejet bancaire et ré-émission | `void` d'un paiement avec motif : rouvre les échéances (`amount_remaining` restauré), option « mettre la facture en hold » ou « annuler la facture » ; chèque perdu / virement rejeté → ré-émission tracée (`replaces_payment_id`) ; impossibilité d'annuler un paiement rapproché en banque sans contre-écriture. | Sans void propre, le lettrage se fait à la main dans la compta. | Standard |
| D7.5 | Avances / acomptes et compensations (avoirs, retenues) | Paiement d'une facture d'acompte (D6.8) ; **compensation** d'avoirs avec factures du même fournisseur dans un paiement (montant net ≥ 0) ; **retenue de garantie** (travaux) comme échéance différée ; avance sur salaire ≠ périmètre (RH), mais même pattern créance/retenue (mig 228). | Mécanique commune aux acomptes fournisseurs et aux retenues ; évite les paiements « en l'air ». | Standard |
| D7.6 | Prévision de trésorerie fournisseurs et calendrier d'échéances | Vue « à payer par semaine » (échéances ouvertes × probabilité), ancienneté des dettes (aging 0–30/30–60/60–90/>90), engagements (BC approuvés non reçus, reçus non facturés) comme **décaissements prévisionnels**, par fournisseur et par catégorie ; export vers trésorerie. | Pilotage cash d'une PME ; les BC et réceptions non facturées sont la partie « cachée » de la dette. | Standard |
| D7.7 | Rapprochement bancaire des paiements | Import relevé bancaire (CSV/MT940/CFONB), lettrage automatique (montant + référence), statut paiement `émis` → `encaissé/compensé` → `rapproché` ; écarts de frais bancaires. | Ferme le cycle P2P côté banque ; indispensable pour certifier le « solde cash » (mémoire compta). | Standard |
| D7.8 | Fichiers de paiement électroniques et formats bancaires | Génération d'ordres de virement groupés (format banque marocaine / SEPA-like), lettres-chèques, « positive pay » (liste des chèques émis transmise à la banque). | Avancé ; 40 fournisseurs → virements manuels sur portail bancaire restent acceptables. | Avancé |

---

## D8 — Comptabilité des achats (GR/IR, landed cost, immobilisations)

**Tables EBS** : `RCV_RECEIVING_SUB_LEDGER` (écritures de réception), `PO_DISTRIBUTIONS_ALL.ACCRUAL_ACCOUNT_ID` / `VARIANCE_ACCOUNT_ID`, `PO_ACCRUAL_RECONCILE_TEMP_ALL` (Accrual Reconciliation Report R11) / **`CST_RECONCILIATION_SUMMARY`, `CST_AP_PO_RECONCILIATION`, `CST_MISC_RECONCILIATION`** (R12 AP/PO Accrual Reconciliation), `CST_WRITE_OFFS`, `AP_INVOICE_DISTRIBUTIONS_ALL` (IPV/ERV), `MTL_MATERIAL_TRANSACTIONS` + `MTL_TRANSACTION_ACCOUNTS`, Landed Cost Management R12 (`INL_SHIP_HEADERS_ALL`, `INL_SHIP_LINES_ALL`, `INL_CHARGE_LINES`, `INL_ALLOCATIONS`), `FA_MASS_ADDITIONS` (Mass Additions depuis AP vers Fixed Assets), `XLA_AE_HEADERS` / `XLA_AE_LINES` (Subledger Accounting).

**Fusion** : Receipt Accounting (Create Receipt Accounting Distributions, Create Uninvoiced Receipt Accruals, Accrual Clearing rules, Match Receipt Accruals, Audit Receipt Accrual Clearing Balances, Accrue at Receipt vs Period End), Cost Accounting (Cost Management), Landed Cost Management (Trade Operations, Charges, Allocation, Estimated vs Actual), Fixed Assets (Mass Additions depuis Payables), Subledger Accounting (SLA rules).

| # | Capacité | Description précise | Pourquoi | Niveau |
|---|---|---|---|---|
| D8.1 | Schéma comptable à la réception : compte d'attente « réceptions non facturées » (GR/IR, accrual) | **Accrue at receipt** (défaut pour les articles stockés) : à `DELIVER`, écriture **Débit stock / charge** (qté × prix BC) **– Crédit compte d'attente « réceptions à facturer »** (`4081 Fournisseurs – factures non parvenues` au PCG marocain ; EBS : `ACCRUAL_ACCOUNT_ID`, « AP Accrual »). À la facture rapprochée : **Débit compte d'attente** (qté × prix BC) **+ Débit IPV** (écart prix) **– Crédit fournisseur 4411** (qté × prix facturé + TVA). Le solde du compte d'attente = valeur des réceptions non encore facturées : il doit tendre vers zéro par (BC, échéance, distribution). | Le cœur comptable du P2P : le stock est valorisé dès la réception (coût matière juste à la production), la dette est reconnue dès la réception, et l'écart de prix est isolé. Sans ce compte, charges et dettes dépendent de la date de la facture. | Socle |
| D8.2 | Accrual à la période (period-end accrual) pour les charges non stockées | **Accrue at period end** (défaut EBS pour destination `EXPENSE`) : aucune écriture à la réception ; en clôture, le job **Create Uninvoiced Receipt Accruals** calcule (reçu − facturé) × prix BC par distribution, passe une écriture **charge / fournisseurs factures non parvenues**, **contre-passée automatiquement** à l'ouverture de la période suivante (`Create Accrual Reversal Accounting`). Mode « rapport » (prévisualisation) ré-exécutable ; mode « comptable » une seule fois après fermeture AP, avant fermeture GL (séquence documentée Oracle : Transfer Costs → Create Uninvoiced Receipt Accruals → Uninvoiced Receipt Accrual Report → Create Accounting). Le choix accrual-à-réception / période est **porté par l'échéance de BC** (`accrue_on_receipt_flag`) ; changer la valeur par défaut n'affecte pas les BC existants. | Pour les charges (énergie, services), accrue-at-receipt est trop lourd ; l'accrual mensuel reversible donne des comptes mensuels justes sans écritures permanentes. | Standard |
| D8.3 | Écart de prix facture (IPV), écart de change (ERV), ajustement de coût stock | **IPV** (Invoice Price Variance) = qté facturée × (prix facturé − prix BC) → compte d'écart (ou **réévaluation du lot en stock / du coût moyen** si l'article est encore en stock et que la politique est « coût réel ») ; **ERV** si devise ; **PPV** (Purchase Price Variance) à la réception = qté × (prix BC − coût standard) si coût standard. Chaque écart est une distribution typée, jamais noyée dans la charge. Le coût réel du plan de production (snapshot mig 261) peut être recalculé « à la facture » si on le souhaite. | Rend visible la dérive prix fournisseur (A1 de l'audit) et permet de choisir : coût stock = BC (stable) ou = facture (exact). | Standard |
| D8.4 | Rapprochement et apurement du compte d'attente (Accrual Reconciliation & Clearing) | Rapport par (BC, échéance, distribution) : `qté reçue × prix BC` − `qté facturée × prix BC` = solde attendu ; **lignes anormales** : facturé sans réception (match au BC sans 3-way), reçu annulé après facture, arrondis, BC clos définitivement avec solde ; **règles d'apurement automatique** (Accrual Clearing Rules : solde < 5 MAD et BC clos → write-off vers compte d'écart) ; **write-off manuel** avec motif et journal (`CST_WRITE_OFFS`) ; âge des réceptions non facturées. | Un compte 4081 qui gonfle est le symptôme classique d'un P2P mal tenu ; cet outil le maintient propre. Mémoire « réconciliation legacy↔ledger » : même esprit, étendu à la réception. | Standard |
| D8.5 | Coût rendu / frais d'approche (Landed Cost Management) | **Opération d'approche** (trade operation) regroupant N réceptions ; **charges** (transport, douane, assurance, manutention, emballage facturé) estimées puis réelles, facturées par des **tiers** différents du fournisseur de la marchandise ; **règles d'allocation** (au poids, à la valeur, à la quantité, au volume) sur les lignes de réception → **coût unitaire rendu** par lot ; écriture estimée à la réception, ajustement à la facture réelle ; variance estimé/réel. Facture de transport rapprochée à l'opération, pas à un BC marchandise. | Le beurre importé ou la farine livrée avec transport facturé séparément : le coût matière réel inclut le transport. Version allégée : « frais de port » réparti au prorata de la valeur. | Avancé (version allégée : Standard) |
| D8.6 | Immobilisations depuis les achats (Mass Additions) | Distribution de BC/facture avec destination **IMMOBILISATION** (compte d'immobilisation en cours 2397 ou classe d'immo) et `track_as_asset_flag` ; à la validation de la facture, création d'une **immobilisation candidate** (coût, date de mise en service, catégorie, lieu, fournisseur, référence facture) dans le module immos ; fusion de plusieurs lignes en un actif (four + installation) ; rejet vers charge. | Mémoire « économat — consommables » : équipement durable = immos. Le lien facture → actif évite la ressaisie et conserve la traçabilité TVA/garantie. | Standard |
| D8.7 | Moteur d'écritures paramétrable par événement (Subledger Accounting) | Règles « événement comptable → lignes d'écriture » (réception, livraison, retour, correction, facture rapprochée/non rapprochée, avoir, paiement, void, accrual période, write-off) avec **sources** (compte de l'article, de la catégorie, du fournisseur, du site, de la zone) et **priorités de dérivation** ; écritures générées en brouillon puis **comptabilisées** (immuables) ; lien événement ↔ écriture (`event_id`) ; mode « projection » pour vérifier. | Séparer « que s'est-il passé » (transactions) de « comment on le comptabilise » (règles) permet de changer le plan comptable sans toucher au moteur achats. | Standard |
| D8.8 | Clôture de période achats / AP et contrôles de clôture | Statuts de période (ouverte, fermée, fermée définitivement) par sous-module (PO, réception, AP) ; **contrôles de clôture** : factures non validées, factures en hold, réceptions non facturées anciennes, BC approuvés avec date de besoin dépassée, accrual période exécuté, rapprochement 4081 ; impossibilité de dater une transaction dans une période fermée (GL date forcée au premier jour ouvert). | Rend les comptes mensuels défendables ; donne une checklist au gérant. | Standard |

---

## D9 — Pilotage & analytique

**EBS** : rapports standard Purchasing/Payables (Open Purchase Orders, Purchase Order Detail, Receipt Accruals – Period End, **Uninvoiced Receipts Report**, Accrual Reconciliation, Invoice on Hold, Invoice Aging, Supplier Payment History, Matching Hold Detail, Purchase Price Variance, Supplier Performance / Vendor Quality / Delivery), Oracle Purchasing Intelligence (DBI). **Fusion** : Procurement Dashboards (Buyer Work Center, Supplier Performance : on-time delivery, quality, price compliance), OTBI subject areas (Purchasing – Purchase Orders Real Time, Receiving Real Time, Payables Invoices Real Time, Receipt Accounting Real Time), Spend Classification (AI), Procurement AI agents (2026).

| # | Capacité | Description précise | Pourquoi | Niveau |
|---|---|---|---|---|
| D9.1 | Tableau de bord acheteur (Buyer Work Center) | Files de travail : DA approuvées à commander (par âge), BC à approuver / à envoyer / non accusés, **livraisons en retard** (`promised_date < today` et reste à recevoir > 0), réceptions à ranger/inspecter, factures en hold par type, accords-cadres proches d'expiration/plafond, pièces fournisseur expirant. Compteurs cliquables. | Transforme le module en outil de travail quotidien ; les listes « à faire » sont dérivées des statuts fins (D4.7). | Socle |
| D9.2 | Suivi de l'état d'exécution par BC/ligne (ordered / received / invoiced / paid) | Vue de cycle de vie par ligne : commandé, reçu, accepté, rejeté/retourné, facturé, payé, annulé, reste à recevoir, reste à facturer, **en unité d'achat et en unité de stock**, montants ; même vue agrégée par BC et par fournisseur. | La question « où en est le BC 42 ? » doit avoir une réponse en un écran, sans ouvrir 4 modules. | Socle |
| D9.3 | Réceptions non facturées et factures non reçues (Uninvoiced Receipts) | Rapport par fournisseur/âge : réceptions dont `reçu − facturé > 0`, valorisées au prix BC = solde attendu du 4081 ; liste inverse : factures rapprochées à des réceptions inexistantes. Filtres par période, catégorie, seuil d'âge. | Rapport de clôture n° 1 ; base de l'accrual (D8.2) et de la prévision de dette (D7.6). | Socle |
| D9.4 | Performance fournisseur (Supplier Performance) | Indicateurs par fournisseur et période : **taux de livraison à l'heure** (reçu ≤ promised_date ± tolérance), **taux de conformité quantité** (|reçu − commandé| / commandé), **taux de rejet qualité** (rejeté / reçu), **taux de retour**, **conformité prix** (facturé vs BC, % de lignes avec IPV), **délai moyen de livraison réel vs annoncé**, **nombre de holds**, **litiges**, score pondéré ; comparaison inter-fournisseurs pour le même article. | Outil de négociation annuelle et de décision ASL ; pour l'agro, le taux de rejet est aussi un indicateur sanitaire. | Standard |
| D9.5 | Analyse des dépenses (spend analysis) et évolution des prix | Dépense par catégorie / fournisseur / article / atelier / mois ; **courbe de prix unitaire (MAD/kg) par article** dans le temps avec fournisseurs superposés ; part des achats sous accord-cadre vs hors contrat (« maverick spend ») ; concentration fournisseur (top 5 = x %). | Pilotage des marges d'une boulangerie : la farine, le beurre, le sucre et les emballages font 70 % du coût matière. | Standard |
| D9.6 | Écarts de prix et de quantités (PPV / IPV / réception vs facture) | Rapport des lignes de facture avec IPV (montant, %, fournisseur, article, acheteur), des réceptions hors tolérance, des rejets ; cumul par fournisseur ; drill-down vers documents. | Détecte la dérive discrète (+3 % chaque mois) que personne ne voit à l'unité. | Standard |
| D9.7 | Délai de cycle P2P et conformité processus | Mesures : DA → approbation, approbation → BC, BC → livraison, livraison → facture, facture → paiement ; taux de **réceptions sans BC** (D5.9), **factures sans BC**, BC créés après la facture (« BC de régularisation »), modifications post-approbation. | Révèle les contournements ; indicateurs d'audit interne. | Standard |
| D9.8 | Rapports réglementaires et fiscaux fournisseurs | Journal des achats, état de TVA déductible par taux et par période (règle encaissement/débit), état des **retenues à la source**, balance âgée fournisseurs, grand livre auxiliaire fournisseur, état 9421-like des honoraires (selon réglementation), export comptable. | Obligations marocaines ; le module doit produire les états plutôt que de laisser l'expert-comptable les reconstituer. | Socle |

---

## D10 — Transverse (rôles, audit trail, notifications, intégration stock, UX, API)

**EBS** : responsabilités / menus / fonctions (`FND_RESPONSIBILITY`, `FND_MENUS`, `FND_FORM_FUNCTIONS`), sécurité par organisation (`ORG_ID`, MOAC), `PO_ACTION_HISTORY`, colonnes WHO (`CREATED_BY`, `CREATION_DATE`, `LAST_UPDATED_BY`, `LAST_UPDATE_DATE`, `LAST_UPDATE_LOGIN`), Audit Trail (`FND_AUDIT_*`, shadow tables `_A`), Workflow Notifications (`WF_NOTIFICATIONS`), Open Interfaces & APIs (`PO_REQUISITIONS_INTERFACE_ALL`, `PO_HEADERS_INTERFACE`, `RCV_TRANSACTIONS_INTERFACE`, `AP_INVOICES_INTERFACE`, PL/SQL `PO_CHANGE_API1_S`, `PO_DOCUMENT_ACTION_PVT`), pièces jointes (`FND_ATTACHED_DOCUMENTS`), DFF (`ATTRIBUTE1..15`), Approval/Buyer/Receiver roles.

**Fusion** : Security (roles: Buyer, Procurement Manager, Procurement Requester, Receiving Agent, Accounts Payable Specialist/Supervisor, Procurement Catalog Administrator, Supplier Administrator ; data security par BU / inventory org), Audit Policies (audit trail d'attributs), Notifications (bell, e-mail, mobile), Attachments, Descriptive/Extensible Flexfields, REST APIs (purchaseOrders, purchaseRequisitions, receivingReceiptRequests, invoices, suppliers, draftPurchaseOrders…), Procurement Business Events, Redwood UX, Procurement AI agents (Oracle AI Agent Studio).

| # | Capacité | Description précise | Pourquoi | Niveau |
|---|---|---|---|---|
| D10.1 | Rôles métier et séparation des tâches (SoD) | Rôles : **Demandeur**, **Approbateur** (avec plafonds), **Acheteur** (crée BC, ne réceptionne pas), **Réceptionnaire / magasinier** (réception, inspection, retour ; ne voit pas les prix si souhaité, cf. « Pesage = magasinier strict »), **Contrôleur qualité**, **Comptable fournisseurs** (factures, holds), **Trésorier** (paiements), **Administrateur référentiel** (fournisseurs, RIB, tarifs), **Auditeur** (lecture seule + audit trail). Matrice d'incompatibilités vérifiée à l'attribution (créer fournisseur ∧ payer ; commander ∧ réceptionner ∧ facturer). Permissions par **action** (approuver, final-close, lever un hold) pas seulement par écran. | Base du contrôle interne ; une PME peut cumuler des rôles mais le système doit **tracer** le cumul (approbation du gérant sur les cumuls). | Socle |
| D10.2 | Audit trail complet : colonnes WHO + historique d'actions + audit d'attributs | Sur toutes les tables : `created_by, created_at, updated_by, updated_at` ; **historique des actions** de document (D3.2) ; **audit d'attributs sensibles** (RIB, prix de tarif, tolérances, règles d'approbation, compte comptable, statut fournisseur) : table `audit_log(table, row_id, column, old, new, actor, at, reason)` alimentée par trigger ; **snapshots de révision** pour les BC ; conservation ≥ 10 ans ; export. | Exigences audit/QA (mémoire « traçabilité ») ; l'audit d'attribut répond à « qui a changé le RIB ? ». | Socle |
| D10.3 | Notifications et alertes paramétrables | Événements : à approuver, approuvé/rejeté, BC envoyé, livraison en retard, réception effectuée (pour le demandeur), hold posé/levé, facture à échéance J-3, accord-cadre à 80 %, document fournisseur expirant, RIB modifié. Canaux : cloche in-app (existant `NotificationBell`), e-mail, WhatsApp/SMS ; **digest** quotidien ; abonnements par rôle et par utilisateur ; lien profond vers le document. | Fait vivre le workflow ; sans notification, l'approbation prend 3 jours. | Socle |
| D10.4 | Intégration stock bidirectionnelle (réception → stock, stock → besoin) | Réception `DELIVER` → mouvement d'entrée (zone, lot, DLC, qté en kg/L, coût unitaire) ; RTV/CORRECT → mouvement inverse lié ; **stock « en commande » (on-order)** = Σ (commandé − reçu − annulé) par article, visible dans l'économat et déduit du calcul de besoins ; **stock « en quai »** (reçu non rangé) ; routage ingrédient vs consommable (mig 207) ; référence croisée `rcv_transaction_id` ↔ `stock_movement_id` ↔ `ingredient_lot_id`. | Le module Achats n'a pas de valeur sans le stock : le on-order évite la double commande, la réception alimente la traçabilité lot. | Socle |
| D10.5 | Intégration production et coût (besoins, coût réel matière) | Besoins du plan de production → DA auto (D2.2) ; prix BC/facture → coût du lot → **coût réel du plan** (snapshot mig 261, décomposition mix vs prix commit 1ac25c4) ; retour d'information : consommation réelle vs commandée pour ajuster les min-max. | Boucle fermée achat ↔ production ↔ marge. | Standard |
| D10.6 | Pièces jointes, notes et champs additionnels | Pièces jointes typées par document et niveau (BL scanné sur réception, facture PDF, certificat d'analyse sur lot, devis sur DA), **notes internes** vs **notes au fournisseur** (imprimées sur le BC) vs **notes au réceptionnaire**, champs descriptifs additionnels (DFF) par type de document sans migration (JSONB validé par schéma). | La facture scannée attachée à la facture saisie est la pièce justificative de l'audit ; les notes au fournisseur évitent les appels. | Socle |
| D10.7 | UX orientée processus : timeline, tableaux d'actions, saisie rapide | Pour chaque document : **timeline** d'étapes (créé → approuvé → envoyé → reçu partiel → facturé → payé) avec dates/acteurs (ui-timeline), **bandeau de statut** avec actions autorisées selon rôle/état (StatusBanner, odoo-btn-*), tableaux denses triables/filtrables avec totaux (odoo-table), **saisie en grille** avec recherche article/fournisseur, duplication de ligne, raccourcis clavier, défauts intelligents (dernier prix, dernier fournisseur, conversion), affichage **dans l'unité saisie** (mémoire « unités d'affichage »), mode mobile pour réception/approbation. | Conformité à la convention UI du projet (mémoire « UI : processus + tableaux ») ; la productivité de l'acheteur vient des défauts et de la grille. | Socle |
| D10.8 | API et événements métier | API REST par ressource (requisitions, purchase-orders [+ change-orders], receipts [+ transactions], supplier-invoices, payments, suppliers, price-lists) avec **idempotence** (clé d'idempotence sur création), **ETag/version** sur modification (optimistic locking : `revision_num`/`updated_at` attendu), pagination, filtres ; **événements** (`po.approved`, `receipt.delivered`, `invoice.hold_placed`, `payment.issued`) publiés en table outbox pour notifications, stock, compta, BI ; import en masse via tables d'interface + rapport d'erreurs (pattern EBS Open Interface). | Permet d'ajouter portail fournisseur, OCR, BI ou balance connectée sans toucher au cœur ; l'idempotence est la leçon de la mémoire « réconciliation ». | Standard |
| D10.9 | Multi-entité / multi-dépôt et données de référence partagées | Entité juridique (une ou plusieurs : laboratoire central, boutiques, future seconde société) ; **dépôts/zones** de livraison ; fournisseurs partagés, sites par entité ; numérotation et comptes par entité ; sécurité des données par entité (EBS `ORG_ID`/MOAC ; Fusion BU + `tenant_id`/RLS prévu au plan SaaS). | Prépare le plan SaaS multi-industries sans refonte ultérieure du modèle. | Standard |
| D10.10 | Paramétrage centralisé des options achats / réception / AP | Table(s) d'options par entité : numérotation, tolérances par défaut, niveau de match par défaut, routage de réception par défaut, accrual par défaut (réception/période), champs contrôlés déclenchant re-approbation, délais d'escalade, options de clôture automatique (% et tolérance), devise, compte d'attente et compte d'écart par défaut, blind receiving. (EBS : Purchasing Options, Receiving Options, Payables Options, Financials Options.) | Un paramétrage explicite et versionné remplace les constantes dans le code et rend le comportement auditable. | Socle |
| D10.11 | Assistance IA (facultatif, 2026) | Fusion 2026 : rédaction de messages de négociation, classification automatique des dépenses, suggestions de fournisseur, détection d'anomalies de facture, agents procurement (AI Agent Studio). | Cité pour complétude ; non prioritaire. | Avancé |

---

## Patterns de modélisation réutilisables (PostgreSQL maison)

Cette section traduit les capacités ci-dessus en structures de tables, en gardant l'analogie EBS. Les noms sont indicatifs (à adapter aux conventions du dépôt : `purchase_orders`, `purchase_order_items`, `ingredients`, `packaging_items`, `ingredient_lots`, `invoice_items`…).

### P1 — Compteurs au niveau le plus fin, statuts dérivés

```sql
-- Échéance de livraison (EBS PO_LINE_LOCATIONS_ALL). Pour une PME : 1 par ligne par défaut, mais c'est ICI que vivent les compteurs.
CREATE TABLE po_schedules (
  id                  bigserial PRIMARY KEY,
  po_line_id          bigint NOT NULL REFERENCES po_lines(id),
  schedule_num        smallint NOT NULL,
  ship_to_zone_id     bigint REFERENCES stock_zones(id),
  need_by_date        date,
  promised_date       date,
  qty_ordered         numeric(14,4) NOT NULL CHECK (qty_ordered >= 0),   -- en unité d'achat
  qty_received        numeric(14,4) NOT NULL DEFAULT 0,                  -- RECEIVE net des RETURN/CORRECT
  qty_accepted        numeric(14,4) NOT NULL DEFAULT 0,
  qty_rejected        numeric(14,4) NOT NULL DEFAULT 0,
  qty_delivered       numeric(14,4) NOT NULL DEFAULT 0,                  -- mis en stock
  qty_billed          numeric(14,4) NOT NULL DEFAULT 0,                  -- factures rapprochées nettes des avoirs
  amount_billed       numeric(14,2) NOT NULL DEFAULT 0,
  qty_cancelled       numeric(14,4) NOT NULL DEFAULT 0,
  match_level         smallint NOT NULL DEFAULT 3 CHECK (match_level IN (2,3,4)),
  match_option        char(1)  NOT NULL DEFAULT 'R' CHECK (match_option IN ('P','R')), -- P=BC, R=réception
  receipt_routing     text     NOT NULL DEFAULT 'direct' CHECK (receipt_routing IN ('direct','standard','inspection')),
  qty_rcv_tolerance_pct numeric(5,2) NOT NULL DEFAULT 0,
  qty_rcv_exception   text NOT NULL DEFAULT 'warning' CHECK (qty_rcv_exception IN ('none','warning','reject')),
  days_early_allowed  smallint, days_late_allowed smallint,
  accrue_on_receipt   boolean NOT NULL DEFAULT true,
  closed_code         text NOT NULL DEFAULT 'open'
     CHECK (closed_code IN ('open','closed_for_receiving','closed_for_invoice','closed','finally_closed')),
  cancel_flag         boolean NOT NULL DEFAULT false,
  CHECK (qty_received + qty_cancelled <= qty_ordered * (1 + qty_rcv_tolerance_pct/100) + 1e-9),
  UNIQUE (po_line_id, schedule_num)
);
-- Quantité restant à recevoir = qty_ordered - qty_received - qty_cancelled (colonne générée ou vue).
```

Règles : les compteurs ne sont **jamais** modifiés par l'UI directement ; ils sont recalculés par trigger (ou fonction) à partir des transactions de réception et des lignes de facture rapprochées (pattern « ledger → solde », cohérent avec la mémoire réconciliation). Le `closed_code` est recalculé après chaque transaction selon les tolérances de clôture ; une clôture manuelle écrit `closed_by/closed_reason`. Le statut d'en-tête est une **vue** (`MIN`/`MAX` des statuts de lignes), pas une colonne libre.

### P2 — Journal de réception immuable (RCV_TRANSACTIONS)

```sql
CREATE TABLE rcv_transactions (
  id                    bigserial PRIMARY KEY,
  receipt_header_id     bigint NOT NULL REFERENCES rcv_receipts(id),      -- n° réception interne + n° BL fournisseur
  parent_transaction_id bigint REFERENCES rcv_transactions(id),           -- arbre RECEIVE -> ACCEPT -> DELIVER -> RETURN/CORRECT
  transaction_type      text NOT NULL CHECK (transaction_type IN
     ('RECEIVE','ACCEPT','REJECT','DELIVER','RETURN_TO_RECEIVING','RETURN_TO_VENDOR','CORRECT','MATCH_UNORDERED')),
  po_schedule_id        bigint REFERENCES po_schedules(id),               -- NULL pour réception sans BC
  po_distribution_id    bigint REFERENCES po_distributions(id),
  quantity              numeric(14,4) NOT NULL,                           -- signée pour CORRECT ; unité de transaction
  uom_code              text NOT NULL,                                    -- 'sac', 'carton', 'kg'
  primary_quantity      numeric(14,4) NOT NULL,                           -- en kg/L (unité de stock)
  conversion_rate       numeric(14,6) NOT NULL,                           -- figé à l'instant T
  weighed_quantity      numeric(14,4),                                    -- pesée réelle éventuelle
  po_unit_price         numeric(14,4),                                    -- prix BC à l'instant T (pour l'accrual)
  destination_type      text CHECK (destination_type IN ('inventory','expense','asset')),
  zone_id               bigint REFERENCES stock_zones(id),
  ingredient_lot_id     bigint REFERENCES ingredient_lots(id),
  supplier_lot_num      text, expiry_date date, temperature_c numeric(4,1),
  reason_code           text,
  transaction_date      timestamptz NOT NULL DEFAULT now(),
  created_by            bigint NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
-- Pas de UPDATE/DELETE autorisés (REVOKE + trigger). Correction = nouvelle ligne CORRECT avec quantité signée.
```

### P3 — Distribution comptable et quantités par imputation (PO_DISTRIBUTIONS_ALL)

```sql
CREATE TABLE po_distributions (
  id                 bigserial PRIMARY KEY,
  po_schedule_id     bigint NOT NULL REFERENCES po_schedules(id),
  distribution_num   smallint NOT NULL,
  charge_account_id  bigint NOT NULL,         -- compte de charge / stock
  accrual_account_id bigint NOT NULL,         -- 4081 réceptions à facturer
  variance_account_id bigint NOT NULL,        -- écart de prix facture
  cost_center_id     bigint, project_id bigint, -- atelier, plan de production
  destination_type   text NOT NULL CHECK (destination_type IN ('inventory','expense','asset')),
  req_line_id        bigint REFERENCES purchase_request_lines(id),   -- traçabilité DA -> BC
  qty_ordered        numeric(14,4) NOT NULL,
  qty_delivered      numeric(14,4) NOT NULL DEFAULT 0,
  qty_billed         numeric(14,4) NOT NULL DEFAULT 0,
  amount_billed      numeric(14,2) NOT NULL DEFAULT 0,
  qty_cancelled      numeric(14,4) NOT NULL DEFAULT 0,
  UNIQUE (po_schedule_id, distribution_num)
);
-- Solde GR/IR attendu par distribution = (qty_delivered - qty_billed) * prix BC.
```

### P4 — Rapprochement facture et holds (AP_INVOICE_LINES / AP_HOLDS)

```sql
ALTER TABLE invoice_items
  ADD COLUMN match_type        text CHECK (match_type IN ('item_to_po','item_to_receipt','price_correction','qty_correction')),
  ADD COLUMN po_schedule_id    bigint REFERENCES po_schedules(id),
  ADD COLUMN rcv_transaction_id bigint REFERENCES rcv_transactions(id),  -- si match à la réception
  ADD COLUMN corrected_item_id bigint REFERENCES invoice_items(id),
  ADD COLUMN qty_invoiced      numeric(14,4),
  ADD COLUMN unit_price        numeric(14,4),
  ADD COLUMN line_type         text NOT NULL DEFAULT 'item' CHECK (line_type IN ('item','freight','misc','tax','prepay'));

CREATE TABLE ap_holds (
  id            bigserial PRIMARY KEY,
  invoice_id    bigint NOT NULL REFERENCES invoices(id),
  invoice_item_id bigint REFERENCES invoice_items(id),
  hold_code     text NOT NULL,                 -- QTY_ORD, QTY_REC, PRICE, AMT_ORD, QUALITY, TAX_VARIANCE, DIST_VARIANCE, PO_NOT_APPROVED, DUPLICATE_SUSPECT, VENDOR (manuel)
  is_system     boolean NOT NULL,              -- levé automatiquement à la re-validation si la cause disparaît
  details       jsonb,                         -- {invoiced: 240, received: 225, tolerance_pct: 2}
  held_at       timestamptz NOT NULL DEFAULT now(), held_by bigint,
  released_at   timestamptz, released_by bigint, release_reason text
);
CREATE UNIQUE INDEX ap_holds_active ON ap_holds (invoice_id, COALESCE(invoice_item_id,0), hold_code) WHERE released_at IS NULL;

CREATE TABLE ap_tolerance_templates (
  id bigserial PRIMARY KEY, name text,
  qty_ord_pct numeric(5,2), max_qty_ord numeric(14,4),
  qty_rec_pct numeric(5,2), max_qty_rec numeric(14,4),
  price_pct numeric(5,2),
  schedule_amount_pct numeric(5,2), total_amount numeric(14,2),
  tax_amount numeric(10,2)
);
-- supplier_sites.tolerance_template_id, défaut dans purchasing_options.
```

La fonction `validate_invoice(invoice_id)` : recalcule les holds système (insère les manquants, libère ceux dont la cause a disparu), vérifie Σ lignes = en-tête, met `validation_status`. Idempotente, ré-exécutable à volonté (comme Invoice Validation EBS).

### P5 — Versionnage des BC (archive de révisions)

```sql
CREATE TABLE po_revisions (
  id            bigserial PRIMARY KEY,
  po_header_id  bigint NOT NULL REFERENCES po_headers(id),
  revision_num  smallint NOT NULL,
  snapshot      jsonb NOT NULL,                 -- en-tête + lignes + échéances + distributions tels qu'approuvés
  diff          jsonb,                          -- [{path, old, new}] par rapport à la révision précédente
  change_reason text,
  approved_at   timestamptz, approved_by bigint,
  sent_at       timestamptz, sent_channel text, -- journal de communication
  UNIQUE (po_header_id, revision_num)
);
-- po_headers.revision_num = révision courante ; toute modification d'un champ contrôlé après approbation
-- -> approval_status = 'requires_reapproval' ; à l'approbation -> INSERT po_revisions, revision_num+1.
```

Liste des **champs contrôlés** en table `po_controlled_fields(field_path, triggers_reapproval, tolerance)` pour éviter le codage dur.

### P6 — Statut d'approbation ≠ statut de clôture ≠ annulation (trois axes)

| Axe | Colonne | Valeurs | Qui l'écrit |
|---|---|---|---|
| Approbation | `approval_status` | `draft`, `in_process`, `approved`, `rejected`, `requires_reapproval` | Workflow |
| Clôture | `closed_code` (par échéance, dérivé à l'en-tête) | `open`, `closed_for_receiving`, `closed_for_invoice`, `closed`, `finally_closed` | Trigger (tolérances) ou action manuelle |
| Annulation | `cancel_flag` + `qty_cancelled` | booléen + quantité | Action manuelle avec motif |
| Blocage | `hold_flag`, `frozen_flag` | booléens | Action manuelle |

Même séparation sur la facture : `validation_status` / `approval_status` / `payment_status` (+ holds).

### P7 — Historique d'actions et audit d'attributs

```sql
CREATE TABLE document_action_history (
  id bigserial PRIMARY KEY,
  document_type text NOT NULL,          -- 'purchase_request','purchase_order','receipt','supplier_invoice','payment'
  document_id   bigint NOT NULL,
  revision_num  smallint,
  sequence_num  int NOT NULL,
  action        text NOT NULL,          -- SUBMIT, APPROVE, REJECT, RETURN, FORWARD, CANCEL, CLOSE, FINAL_CLOSE, REOPEN, HOLD, RELEASE_HOLD, SEND, ACKNOWLEDGE
  actor_id      bigint NOT NULL, on_behalf_of bigint,
  channel       text,                   -- 'web','email_token','whatsapp','api'
  note          text,
  action_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_type, document_id, sequence_num)
);

CREATE TABLE audit_attribute_log (
  id bigserial PRIMARY KEY,
  table_name text, row_id bigint, column_name text,
  old_value text, new_value text,
  actor_id bigint, changed_at timestamptz DEFAULT now(), reason text
);
-- Trigger générique sur les colonnes sensibles : supplier_bank_accounts.*, price_list_lines.unit_price,
-- ap_tolerance_templates.*, approval_rules.*, suppliers.status, po_distributions.charge_account_id.
```

### P8 — Compte d'attente réceptions non facturées et écritures par événement

```sql
CREATE TABLE accounting_events (
  id bigserial PRIMARY KEY,
  event_type text NOT NULL,       -- 'rcv_deliver','rcv_return','rcv_correct','ap_invoice_matched','ap_invoice_unmatched','ap_credit_memo','ap_payment','ap_payment_void','period_end_accrual','accrual_reversal','accrual_writeoff'
  source_table text, source_id bigint,
  event_date date NOT NULL, gl_date date NOT NULL,
  status text NOT NULL DEFAULT 'unprocessed' CHECK (status IN ('unprocessed','draft','final','error')),
  created_at timestamptz DEFAULT now()
);
CREATE TABLE journal_lines (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES accounting_events(id),
  account_id bigint NOT NULL, debit numeric(14,2) DEFAULT 0, credit numeric(14,2) DEFAULT 0,
  po_distribution_id bigint, supplier_id bigint, ingredient_lot_id bigint,   -- axes analytiques pour le rapprochement
  line_type text   -- 'item','accrual','ipv','tax','liability','cash'
);
```

Écritures type (accrual à la réception, article stocké, prix BC 10 MAD/kg, facturé 10,40) :

| Événement | Débit | Crédit |
|---|---|---|
| `rcv_deliver` 250 kg | Stock 2 500 | 4081 Réceptions à facturer 2 500 |
| `ap_invoice_matched` 250 kg × 10,40 + TVA 20 % | 4081 : 2 500 ; IPV (ou stock) : 100 ; TVA déductible : 520 | 4411 Fournisseur : 3 120 |
| `ap_payment` | 4411 : 3 120 | Banque : 3 120 |

Le rapprochement du 4081 = `SELECT po_distribution_id, SUM(debit) - SUM(credit) FROM journal_lines WHERE account = 4081 GROUP BY 1 HAVING ... <> 0` : chaque distribution doit revenir à zéro ; les résidus (< seuil, BC clos) sont apurés par un événement `accrual_writeoff`.

Pour les charges non stockées (`accrue_on_receipt = false`) : aucun événement à la réception ; en clôture, `period_end_accrual` = Σ (reçu − facturé) × prix BC par distribution, reversé par `accrual_reversal` daté du 1er jour de la période suivante.

### P9 — Unité d'achat / unité de stock / contenant

```sql
-- Sur la ligne de BC (figé à la commande, surchargeable) :
--   uom_purchase text ('sac25'), qty_purchase numeric, conversion_to_primary numeric (25.000), primary_uom ('kg'),
--   unit_price_purchase numeric (MAD/sac), unit_price_primary numeric GENERATED (unit_price_purchase / conversion_to_primary)
-- Sur la transaction de réception : quantity + uom_code + primary_quantity + conversion_rate + weighed_quantity.
-- Sur la ligne de facture : qty_invoiced dans l'unité facturée + conversion ; comparaison des holds en unité primaire.
-- Conversion poids<->volume : ingredients.densite_kg_l (mig 227) utilisée seulement si uom classes différent.
```

Toujours stocker les deux quantités (saisie et primaire) **et** le facteur ; ne jamais recalculer l'historique quand le facteur de l'article change (mémoire « unités d'affichage »).

### P10 — Liens de traçabilité N:N entre niveaux

| Lien | Table de lien / FK | Usage |
|---|---|---|
| Ligne DA → échéance BC | `po_distributions.req_line_id` (ou table `req_line_po_schedule(req_line_id, po_schedule_id, qty)`) | AutoCreate, statut DA dérivé |
| Échéance BC → transactions de réception | `rcv_transactions.po_schedule_id` | compteurs reçu/accepté |
| Transaction de réception → lot interne → mouvement stock | `rcv_transactions.ingredient_lot_id`, `stock_movements.rcv_transaction_id` | traçabilité QA |
| Réception → ligne facture | `invoice_items.rcv_transaction_id` (match R) ou `po_schedule_id` (match P) | 3/4-way, GR/IR |
| Ligne facture → correction/avoir | `invoice_items.corrected_item_id` | avoirs rapprochés |
| Échéance de paiement ↔ paiement | `payment_applications(payment_id, payment_schedule_id, amount)` | lettrage N:N |
| Retour fournisseur → note de débit attendue | `expected_debit_memos.rcv_transaction_id` | boucle qualité → finance |
| Événement comptable → source | `accounting_events.source_table/source_id` | audit compta |

### P11 — Numérotation sans trou

```sql
CREATE TABLE document_sequences (entity_id bigint, doc_type text, year smallint, last_value int, PRIMARY KEY (entity_id, doc_type, year));
-- fn_next_doc_number(entity, type) : UPDATE ... SET last_value = last_value + 1 RETURNING ... (verrou de ligne implicite),
-- appelée uniquement à la transition draft -> submitted/approved, dans la même transaction. Les brouillons n'ont pas de numéro.
```

### P12 — Idempotence et verrouillage optimiste

Toute écriture par API/UI qui crée une transaction (réception, facture, paiement) accepte une **clé d'idempotence** (`idempotency_key UNIQUE`) ; toute modification d'un document porte le `revision_num`/`updated_at` attendu et échoue en conflit sinon. Les recomptes de compteurs (P1, P3) sont des fonctions `recompute_po_schedule(id)` purement dérivées des journaux, ré-exécutables (leçon de la mémoire « réconciliation » : idempotence kind-agnostic, sync atomique).

---

## Priorisation suggérée pour la refonte (lecture rapide)

| Priorité | Capacités | Commentaire |
|---|---|---|
| **Socle (lot 1)** | D1.1, D1.2, D1.6, D1.8, D1.9 ; D2.1, D2.3, D2.5 ; D3.1, D3.2, D3.4 ; D4.1–D4.8 ; D5.1, D5.3, D5.4, D5.6, D5.12 ; D6.1–D6.4, D6.6, D6.7, D6.12 ; D7.1–D7.3 ; D8.1 ; D9.1–D9.3, D9.8 ; D10.1–D10.4, D10.6, D10.7, D10.10 | Modèle à 4 niveaux + journal de réception + holds + GR/IR : tout le reste s'appuie dessus. |
| **Standard (lot 2)** | D1.3, D1.4, D1.7 ; D2.2, D2.4, D2.6 ; D3.3, D3.5, D3.7, D3.8 ; D4.9–D4.11 ; D5.2, D5.5, D5.7, D5.9–D5.11 ; D6.5, D6.8, D6.9 ; D7.4–D7.7 ; D8.2–D8.4, D8.6–D8.8 ; D9.4–D9.7 ; D10.5, D10.8, D10.9 | Accords-cadres, RFQ simple, qualité/RTV, acomptes, accrual période, performance fournisseur. |
| **Avancé (à l'étude)** | D1.5, D1.10 ; D3.6 ; D4.12 ; D5.8 ; D6.10, D6.11 ; D7.8 ; D8.5 ; D10.11 | Portail fournisseur, ASN, landed cost complet, enchères, OCR, ERS, IA. Version allégée recommandée pour D1.5 (dates d'expiration de documents) et D8.5 (frais de port au prorata). |

---

## Sources consultées (vérification des noms de fonctionnalités)

- Oracle, *Oracle Fusion Cloud Procurement — Solution Brief* (2026) : Redwood supplier portal, vérification de propriété de compte bancaire, agents IA procurement — https://www.oracle.com/a/ocom/docs/oracle-fusion-cloud-procurement-solution-brief.pdf
- Oracle Help Center, *Receipt Accounting for Purchase Orders Set to Accrue at Period End* (26a) — https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26a/fapma/receipt-accounting-for-purchase-orders-set-to-accrue-at-period.html
- Oracle Help Center, *What's the implication of changing the accrual setting from at receipt to at period end?* (25c) — https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25c/fapma/what-s-the-implication-of-changing-the-accrual-setting-from-at-receipt-to-at-period-end.html
- Oracle Help Center, *Create Uninvoiced Receipt Accrual* (25a) — https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25a/faspc/create-uninvoiced-receipt-accrual.html
- Oracle Support, *How to Create Period End Accruals and Generate Uninvoiced Receipts Report* (Doc 2382599.1) — https://support.oracle.com/knowledge/Oracle%20Cloud/2382599_1.html
- Oracle Analytics, *Purchasing FAQ* (26R1) — https://docs.oracle.com/en/cloud/saas/analytics/26r1/faiae/scmerp-purchasing-faqs.html
- OATUG, *Resolving Match Exceptions in Oracle Fusion* (2025) — https://www.oatug.org/insight-spring2025/features-archive/resolving-match-exceptions
- Oracle EBS, *Payables User's Guide — Matching holds, tolerances, approval* — https://docs.oracle.com/cd/A60725_05/html/comnls/us/ap/pomatc04.htm
- Capterra / GetApp, fiches produit Oracle Fusion Cloud Procurement (périmètre fonctionnel) — https://www.capterra.com/p/69608/Oracle-Fusion-Procurement/reviews/ ; https://www.getapp.com/operations-management-software/a/oracle-fusion-cloud-procurement/

Les noms de tables EBS (PO_*, RCV_*, AP_*, CST_*, INL_*) et les codes de hold/clôture sont issus du schéma standard R12, connu de l'auteur (haute confiance) ; ils n'ont pas été re-vérifiés en ligne aujourd'hui.

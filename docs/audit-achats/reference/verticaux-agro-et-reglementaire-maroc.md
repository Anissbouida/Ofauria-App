# Référentiel de capacités — Module Achats
## Volet A : verticaux agroalimentaire / boulangerie · Volet B : contexte réglementaire marocain

Date : 2026-10-11. Rédigé pour l'équipe de refonte du module Achats de l'ERP interne (boulangerie-pâtisserie, Maroc, ~40 fournisseurs, ~300 BC/an). Le lecteur cible connaît Oracle Forms / PL*SQL : les analogies « table / trigger / contrainte » sont volontaires.

### Méthode et niveau de confiance

- Recherche web effectuée le 2026-10-11 (WebSearch + WebFetch). Deux pages de fiscamaroc.com (texte brut CGI art. 91 et 106) ont répondu HTTP 503 ; les citations de ces articles s'appuient donc sur les extraits renvoyés par le moteur de recherche et sur des sources secondaires (cabinets, presse). Le texte officiel du CGI 2026 sur tax.gov.ma reste la référence à ouvrir avant tout arbitrage.
- Pour les verticaux ERP, les sources sont majoritairement des pages éditeurs/partenaires (marketing) : les capacités listées sont « ce que ces produits prétendent faire », pas un audit.
- Échelle de confiance : **Haute** (plusieurs sources concordantes dont au moins une citant l'article de loi) / **Moyenne** (une source sérieuse ou sources concordantes mais secondaires) / **Faible** (une seule source, ou sources contradictoires, ou non trouvé).
- Niveaux de capacité : **socle** (sans ça le module ne tient pas), **standard** (attendu d'un ERP agro correct), **avancé** (différenciant, à planifier plus tard).

---

## Partie A — Ce que les verticaux agro / boulangerie apportent de spécifique aux achats

### A.0 Panorama rapide des produits étudiés

| Produit | Positionnement | Apport achats remarquable (sources) |
|---|---|---|
| Sage X3 (+ add-on Catch Weight Greytrix) | ERP mid-market process ; agro via add-ons | Double unité (unité de stock + poids réel), poids réel saisi à la réception avec **seuil d'écart** qui alerte, recalcul de la facture sur le poids reçu, lots/sous-lots, DLC, GS1/GTIN. Sources : [Greytrix – variable weight](https://www.greytrix.com/blogs/sagex3/?p=31605), [brochure Catch Weight](https://www.greytrix.com/new-resources/brochures/Sage_X3-Catch_Weight.pdf), [Folio3 comparatif](https://netsuite.folio3.com/blog/netsuite-vs-sage-x3-catch-weight-management/) |
| Infor M3 Food & Beverage | ERP process grands comptes | Catch weight natif avec **tolérances configurables à la réception**, facture au poids réel, **liste de fournisseurs approuvés** avec statut de qualification et date d'expiration, scorecards, exigence de certificat d'analyse (CoA) par fournisseur, allergènes sur la fiche article, plans d'inspection à la réception par article/fournisseur/lot, blocage automatique hors spécification. Sources : [ERP Research – M3 F&B](https://erpresearch.com/en-gb/infor-m3-for-food-and-beverage), [M3 food safety](https://www.erpresearch.com/en-gb/blog/infor-m3-food-safety), [M3 batch management](https://erpresearch.com/pages/en-gb/infor-m3-batch-management) |
| Aptean Food & Beverage ERP (sur Dynamics 365 BC) | ERP agro mid-market | Catch weight au niveau lot et article, **intégration balances** à la réception, traçabilité bidirectionnelle ingrédient, allergènes intégrés, CoA. Sources : [Aptean food ERP](https://aptean.com/solutions/erp/food-erp), [SoftwareConnect](https://softwareconnect.com/reviews/aptean-food-beverage-erp/) |
| Cybake | Logiciel boulangerie (UK) retail + wholesale | Module achats avec BI : dépenses, **historique du coût des ingrédients**, performance fournisseur, avancement des BC ; **réclamations/avoirs pour écarts de livraison**. Sources : [Snack & Bakery](https://www.snackandbakery.com/articles/107989-cybake-bakery-software-integrates-with-rekki-restaurant-app), [Capterra Cybake vs BakeSmart](https://www.capterra.co.uk/compare/99597/190556/cybake/vs/bakesmart) |
| FlexiBake | ERP boulangerie/confiserie cloud | Suivi des mouvements d'ingrédients de l'achat à la production, multi-sites, **rappel simulé (mock recall)** fournisseur → production → expédition, liaison compta/EDI. Source : [GetApp FlexiBake](https://www.getapp.com/industries-software/a/flexibake/) |
| BakeSmart | Gestion de production boulangerie | Orienté production/coûts de recette ; pas de module achats/fournisseurs documenté. Source : [Capterra](https://www.capterra.ca/compare/99597/190556/cybake/vs/bakesmart) |
| Odoo (standard + guides boulangerie) | ERP généraliste | Unités d'achat distinctes (sac 25 kg → kg via coefficient), **emballages produit (packaging)**, lots avec dates de péremption, **stratégie de sortie FEFO par emplacement**, alertes d'approche de DLC, blocage des lots périmés. Pas de module « boulangerie » officiel. Sources : [Cleverence – acheter dans une autre unité](https://www.cleverence.com/articles/odoo-documentation/acheter-dans-une-unit%C3%A9-de-mesure-diff%C3%A9rente-de-celle-1234/), [Cleverence – UoM/packages/packagings](https://www.cleverence.com/articles/odoo-documentation/units-of-measure-packages-and-packagings-4729), [Quickstart bakery – perishables](https://quickstart-implementation.readthedocs.io/en/latest/industries/bakery/avanced-inventory-management-for-perishables.html), [Octura – traçabilité agro Odoo](https://octurasolutions.com/fr/resources/11-facons-entreprises-agroalimentaires-utilisent-odoo-pour-tracabilite) |

Lecture transverse : les quatre idées qui reviennent partout sont (1) **double unité** achat/stock avec poids réel saisi à la réception, (2) **lot fournisseur + DLC capturés dès la réception** et FEFO en sortie, (3) **fiche fournisseur enrichie** (agrément, allergènes, certificats, scoring), (4) **la réception est un acte qualité** (tolérances, inspection, blocage).

### A.1 — D1 Référentiel fournisseurs

| Capacité | Description précise | Pourquoi c'est important (boulangerie MA) | Niveau | Vu chez |
|---|---|---|---|---|
| Fiche fournisseur légale complète | Raison sociale, forme juridique, adresse, **ICE (15 chiffres), IF, RC + ville, TP (patente)**, RIB, régime TVA (assujetti / non assujetti / exonéré art. 91). Contrôle de format ICE (15 chiffres numériques) et unicité. | Sans ICE/IF corrects sur la facture, la charge et la TVA sont rejetées (voir B.1). C'est la contrainte `NOT NULL` la plus rentable du module. | socle | Tous ERP (adapté MA) |
| Typologie fournisseur | Type : industriel / grossiste / **marché-espèces (pas de facture)** / producteur agricole / prestataire. Pilote les contrôles aval (facture obligatoire ou bon d'achat interne, plafond cash). | Les achats quotidiens de frais (œufs, fruits, lait) au marché existent et doivent être tracés sans casser les règles des autres. | socle | Pratique terrain ; pas natif chez les ERP cités |
| Statut d'approbation / agrément | Fournisseur `prospect → approuvé → suspendu → radié`, avec **date d'expiration de la qualification**, pièces jointes (agrément ONSSA, certificat halal, CoA, fiche technique). Blocage des BC vers un fournisseur non approuvé. | Exigence ONSSA/ISO 22005 de maîtrise de l'amont ; évite d'acheter à un fournisseur dont l'agrément est tombé. | standard | Infor M3 (liste approuvée + expiration), Aptean |
| Articles fournis (catalogue fournisseur) | Lien fournisseur × ingrédient : **référence fournisseur, conditionnement d'achat (sac 50 kg, carton 10 kg, bidon 20 L, plateau 30 œufs), quantité par conditionnement, prix négocié, validité, délai, MOQ**. | C'est la table pivot pour la conversion sac→kg et le prix par conditionnement ; un ingrédient peut avoir plusieurs conditionnements selon le fournisseur. | socle | Sage X3, Odoo (packaging + vendor pricelist), M3 |
| Fiche technique / allergènes fournisseur | Par article fournisseur : liste d'allergènes (gluten, œufs, lait, fruits à coque, soja, sésame…), fiche technique PDF, date de validité, origine. | Décret 2-12-389 (étiquetage) impose la mise en évidence des allergènes ; ils se déclarent **à l'achat** pour remonter dans les recettes. | standard | M3, Aptean |
| Scorecard fournisseur | Taux de service (livré à l'heure, complet), taux de non-conformité à la réception, écart de poids moyen, écart prix facture/BC. Calculé, pas saisi. | Base objective pour renégocier ou sortir un fournisseur ; Cybake le vend comme « pouvoir de négociation ». | avancé | M3, Cybake |
| Fournisseur « inactif » DGI | Drapeau manuel ou import de la liste DGI des contribuables inactifs (art. 228 bis) ; alerte à la facture. | Depuis LF 2023 une facture d'une entreprise inactive n'est pas déductible ([Upsilon art. 146](https://upsilon-consulting.com/pieces-justificatives-des-achats-article-146-du-cgi/)). | avancé | Aucun ERP cité ; spécifique MA |

### A.2 — D2 Besoins & demandes d'achat

| Capacité | Description précise | Pourquoi | Niveau | Vu chez |
|---|---|---|---|---|
| Besoin calculé depuis le plan de production | Explosion nomenclature × plan → besoin net en **unité de base** (kg, L, pièce) après déduction du stock disponible non périmé et des BC en cours. | Cœur du métier : la boulangerie achète pour produire demain. Déjà présent en partie dans l'ERP (fiche de besoin). | socle | Cybake, FlexiBake, Odoo MRP |
| Arrondi au conditionnement d'achat | Le besoin net de 37 kg de farine devient « 1 sac de 50 kg » ou « 2 sacs de 25 kg » selon le fournisseur cible ; conserve le besoin réel et l'arrondi. | Évite les BC en kg non livrables ; le surplus arrondi est visible pour le pilotage. | socle | Odoo (packaging), Sage X3 |
| DA frais quotidiens (cycle court) | Modèle de DA « liste du jour » (œufs, lait, fruits, crème) avec quantités pré-remplies depuis la conso moyenne, validation en un geste, conversion directe en achat espèces. | Fréquence quotidienne : le circuit DA→BC→réception complet est trop lourd ; il faut un raccourci tracé. | standard | Pratique terrain ; Cybake « shop replenishment » |
| Alerte stock mini / point de commande par ingrédient | Seuil en unité de base, délai fournisseur, suggestion de réassort groupée par fournisseur. | Classique mais indispensable pour les secs (farine, sucre, levure). | socle | Tous |
| Prise en compte du FEFO dans le besoin | Les lots qui expireront avant la date de consommation prévue sont exclus du disponible. | Sinon on « voit » du stock qu'on jettera. | standard | Odoo, M3 |

### A.3 — D3 Sourcing & approbation

| Capacité | Description précise | Pourquoi | Niveau | Vu chez |
|---|---|---|---|---|
| Comparaison de prix **par unité de base** | Normaliser prix/sac, prix/carton, prix/pièce en **MAD/kg, MAD/L, MAD/pièce** (via quantité par conditionnement) pour comparer deux fournisseurs. | Les prix fournisseurs sont exprimés en conditionnements hétérogènes ; comparer « sac » à « sac » est faux. | socle | Sage X3, Odoo pricelist |
| Prix pièce vs prix poids | Un même article peut être tarifé à la pièce (plateau d'œufs, pain de beurre) ou au poids (fromage, fruits) ; le mode de tarification est porté par l'article fournisseur. | Détermine la logique de valorisation à la réception (poids réel ou nombre). | socle | Sage X3 catch weight |
| Historique des prix d'achat | Série temporelle prix/unité de base par ingrédient et fournisseur ; graphique ; variation vs dernier achat. | Le prix du beurre et des œufs est volatil au Maroc ; l'historique nourrit le coût de recette (déjà un sujet dans l'ERP : « écart prix »). | standard | Cybake BI, M3 |
| Circuit d'approbation à seuils | Approbation par montant (ex. > X MAD) et par type (nouveau fournisseur, hors catalogue, espèces). Horodatage, approbateur. | Audit interne ; ~300 BC/an : un seul niveau suffit, mais tracé. | standard | Tous ERP |
| Demande de devis multi-fournisseurs | RFQ envoyée à N fournisseurs, saisie des réponses, sélection. | Utile pour emballages et équipements, rare pour les matières quotidiennes. | avancé | Odoo, Sage X3 |

### A.4 — D4 Commande (BC)

| Capacité | Description précise | Pourquoi | Niveau | Vu chez |
|---|---|---|---|---|
| Ligne de BC en **double unité** | Quantité commandée en conditionnement (10 sacs) **et** en unité de base (500 kg) stockées toutes deux ; prix par conditionnement et prix/unité de base dérivés. Analogie : deux colonnes, un trigger de cohérence, jamais de conversion à la volée dans l'affichage (règle maison : « 420 g reste 420 g »). | Toute la chaîne réception/facture/coût s'appuie dessus. | socle | Sage X3, M3, Odoo |
| BC « poids variable » (catch weight) | Pour les articles au poids réel (fruits, fromages, viennoiserie surgelée en cartons non standard) : quantité nominale + poids estimé + **tolérance ±%** attendue à la réception. | Le poids livré ≠ poids commandé ; il faut savoir d'avance ce qui est acceptable. | standard | Sage X3 (seuil d'écart), M3 (tolérances), Aptean |
| Exigences qualité sur la ligne | Spécification attendue : DLC minimale à la livraison (ex. ≥ 30 j), température, certificat exigé. | Prépare le contrôle à la réception ; les ERP agro l'appellent « spec » ou « inspection plan ». | standard | M3 |
| BC récurrent / contrat cadre | Modèle de BC hebdomadaire par fournisseur (farine, sucre) ; appel sur contrat avec prix bloqué et volume cumulé. | ~40 fournisseurs, beaucoup de commandes répétitives. | avancé | Sage X3, Odoo blanket orders |
| Envoi BC (PDF/WhatsApp/e-mail) et accusé | Génération PDF conforme (ICE/IF acheteur), envoi, statut `envoyé → confirmé → livraison partielle → clos`. | Preuve d'engagement ; pièce justificative complémentaire de l'art. 146. | socle | Tous |
| Achat direct sans BC (marché, espèces) | Document « bon d'achat interne » créé a posteriori, lié au fournisseur type marché, plafonné (voir B.3), qui alimente réception et caisse. | Impossible de passer un BC au marché ; il faut une pièce probante interne. | socle | Spécifique MA ; aucun vertical ne le modélise |

### A.5 — D5 Réception & qualité

| Capacité | Description précise | Pourquoi | Niveau | Vu chez |
|---|---|---|---|---|
| Saisie par conditionnement + poids réel | Réception de 10 sacs → 500 kg théoriques ; saisie optionnelle du **poids réel pesé** (bascule connectée déjà présente côté pesage : réutiliser le WebSerial). Écart = réel − théorique. | Base du catch weight et du contrôle fournisseur ; la balance existe déjà dans l'ERP. | socle | Sage X3, M3, Aptean (scales) |
| Tolérance de poids et décision | Tolérance ±% (ou plancher absolu) par article/fournisseur ; hors tolérance → `accepté avec réserve` / `refusé partiel` / `litige`, et génération d'une **demande d'avoir**. | Cybake vend les « credit claims for supply discrepancies » ; c'est de l'argent. | standard | Sage X3, M3, Cybake |
| Lot fournisseur + DLC obligatoires | Par ligne reçue : **numéro de lot fournisseur, DLC/DDM, date de fabrication si disponible, origine**, → création du lot interne avec lien `lot_interne → lot_fournisseur`. Bloquant pour les matières périssables, facultatif pour emballages. | Traçabilité amont ONSSA/ISO 22005 ; sans ça, pas de rappel possible. L'ERP a déjà `ingredient lots` : garantir le champ `supplier_lot_no` NOT NULL par catégorie. | socle | M3, Aptean, Odoo (lots+dates), FlexiBake |
| Contrôle qualité à la réception | Checklist par catégorie : température (camion froid), intégrité emballage, DLC ≥ exigence, aspect ; résultat et photo ; statut `quarantaine` tant que non validé. | Acte qualité exigé par les BPH/HACCP ; M3 bloque automatiquement hors spec. | standard | M3, Aptean |
| Réception partielle / reliquat | Plusieurs réceptions par BC ; reliquat visible ; clôture forcée avec motif. | Livraisons fractionnées fréquentes. | socle | Tous |
| Routage automatique selon catégorie | Consommable → stock emballages ; ingrédient → stock ingrédients ; immobilisation → immos (déjà en place : mig 207 `fn_purchasable_kind`). | Garder la règle unique côté serveur. | socle | Odoo (routes) |
| FEFO dès la mise en stock | Le lot reçu entre avec sa DLC ; la sortie (BSI/pesage) propose le lot le plus proche de l'expiration ; alertes J-x. | Odoo le présente comme « la stratégie la plus importante pour une boulangerie ». | standard | Odoo, M3 |
| Étiquette interne de lot | Impression étiquette (lot interne, lot fournisseur, DLC, article, allergènes) à coller sur le sac/carton. | Lien physique indispensable pour le pesage et le rappel. | standard | FlexiBake, Aptean |

### A.6 — D6 Facturation & rapprochement

| Capacité | Description précise | Pourquoi | Niveau | Vu chez |
|---|---|---|---|---|
| Rapprochement 3 voies BC / réception / facture | Par ligne : quantité facturée vs reçue (en conditionnement **et** en unité de base), prix facturé vs BC, TVA par ligne. Tolérances paramétrables ; écarts → litige ou avoir. | Déjà partiellement présent (TVA par ligne, écart prix) ; le vertical ajoute la dimension poids réel. | socle | Tous ERP |
| Facturation au poids réel | Si article catch weight : le montant attendu = poids réel reçu × prix/kg, pas la quantité commandée. | Sage X3 et M3 recalculent la facture au poids reçu. | standard | Sage X3, M3 |
| Contrôle des mentions légales de la facture fournisseur | Avant validation : ICE/IF/RC/TP fournisseur présents et cohérents avec la fiche, ICE acheteur présent, numéro séquentiel, date, TVA ventilée par taux, mode de paiement. Alerte non bloquante → bloquante au choix. | Condition de déductibilité (B.1, B.2). | socle | Spécifique MA |
| Facture sans TVA / fournisseur non assujetti / exonéré art. 91 | Type de pièce distinct ; pas de TVA récupérable ; mention de l'exonération. | Farine, lait, beurre, levure fraîche sont exonérés sans droit à déduction : la plupart des factures de matières n'ont **pas** de TVA à récupérer. | socle | Spécifique MA |
| Bon d'achat interne (sans facture) | Pièce interne horodatée, lieu, fournisseur type marché, lignes, montant, payeur, signature ; jamais de TVA déductible ; cumul journalier/mensuel surveillé. | Pièce « probante » de substitution ; sa déductibilité IS est **non confirmée** (voir B.3) : au minimum, elle isole ces achats pour l'expert-comptable. | socle | Spécifique MA |
| Pièce jointe et OCR de la facture | Scan/photo liée, extraction ICE/montants pour pré-remplir (optionnel). | Prépare la e-facturation ; réduit la saisie. | avancé | Odoo (OCR), Sage |
| Préparation e-facturation entrante | Champ `invoice_uid_dgi` / identifiant plateforme, format structuré (UBL/XML) stocké, statut de validation plateforme. | Dispositif art. 145-IX en attente de décret (B.4) : prévoir les colonnes, pas l'intégration. | avancé | Spécifique MA |

### A.7 — D7 Paiements

| Capacité | Description précise | Pourquoi | Niveau | Vu chez |
|---|---|---|---|---|
| Moyen de paiement typé | `espèces / chèque barré non endossable / virement / effet / carte / compensation` par règlement ; référence (n° chèque, référence virement). | Art. 11-II et 106-II : seuls les moyens traçables garantissent la déductibilité au-delà du seuil. | socle | Tous (adapté MA) |
| **Compteur espèces par fournisseur et par jour / mois** | Cumul TTC des règlements espèces par fournisseur : alerte à l'approche de **5 000 MAD/jour** et **50 000 MAD/mois**, blocage ou validation exceptionnelle tracée. Détecter aussi le fractionnement (plusieurs factures le même jour). | Au-delà, charge non déductible et TVA perdue ; la DGI recoupe les factures fractionnées ([Bladi](https://www.bladi.net/122301)). | socle | Spécifique MA |
| Échéancier et conditions de paiement | Conditions par fournisseur (comptant, 30 j, fin de mois), échéances, alertes de retard (widget déjà présent). | Trésorerie. | socle | Tous |
| Paiement partiel / acompte / lettrage | Règlement multi-factures, acomptes, lettrage automatique (`paid_amount` atomique déjà en place). | Réconciliation legacy↔ledger déjà traitée. | socle | Tous |
| Caisse achats (petite caisse) | Fonds de caisse dédié aux achats du jour, décaissement par bon d'achat, remise de la monnaie, clôture quotidienne. | Les achats au marché passent par là ; c'est la seule façon de faire coller caisse et bons. | standard | Spécifique terrain |

### A.8 — D8 Comptabilité des achats

| Capacité | Description précise | Pourquoi | Niveau | Vu chez |
|---|---|---|---|---|
| Imputation par catégorie de ligne | Compte de charge (611x achats de marchandises / 612x matières / 613x-614x charges externes / 23xx immos) dérivé de `category_id` de la ligne (déjà : catégorie par ligne, mig 194). | Le plan comptable marocain (CGNC) distingue matières, emballages, charges. | socle | Tous |
| TVA récupérable par taux et par nature | Comptes 3455x par taux (20 %, 10 %, 14 % résiduel, exonéré SDD, exonéré ADD, non assujetti). Génération de l'état de déduction TVA (relevé des déductions) exigé pour la déclaration. | Le relevé des déductions liste chaque facture avec ICE fournisseur, montant, TVA, mode et date de paiement : le modèle doit pouvoir le produire. | socle | Spécifique MA |
| Droit à déduction au paiement | La TVA n'est déductible qu'une fois la facture **payée** (naissance du droit au paiement) : flag `tva_deductible_a_partir_du = date_paiement`. | Règle marocaine différente de l'UE (déduction à la facture) ; impacte la période de déclaration. | socle | Spécifique MA |
| Exclusion automatique de la TVA | Si règlement espèces hors plafond, facture non conforme (ICE manquant), fournisseur inactif → TVA comptabilisée en charge (non récupérable), charge marquée « non déductible IS ». | Évite les réintégrations en contrôle. | standard | Spécifique MA |
| Coût d'achat réel vers coût de recette | Prix/unité de base **au poids réel** réceptionné alimente le coût moyen ou dernier prix de l'ingrédient (déjà : snapshot coût plan, écart mix vs prix). | Cohérence coûts de revient. | standard | Cybake, M3 |

### A.9 — D9 Pilotage

| Capacité | Description précise | Pourquoi | Niveau | Vu chez |
|---|---|---|---|---|
| Dépenses par fournisseur / catégorie / période | Tableaux et courbes ; part espèces vs traçable. | Pilotage et préparation du contrôle fiscal. | socle | Cybake BI |
| Évolution du prix/unité de base | Par ingrédient : prix moyen pondéré mensuel, dernier prix, min/max fournisseur. | Volatilité beurre/œufs/sucre ; nourrit les décisions de recette. | standard | Cybake, M3 |
| Performance fournisseur | Taux de service, écarts de poids, non-conformités, litiges ouverts, délais de paiement respectés. | Base du scorecard D1. | standard | M3, Cybake |
| Suivi des avoirs / litiges | Montant réclamé, obtenu, en attente, par fournisseur. | Cybake « credit claims ». | standard | Cybake |
| Alertes réglementaires | Plafond espèces approché, factures sans ICE, lots sans DLC, fournisseurs dont l'agrément expire. | Transforme la conformité en liste de tâches. | standard | Spécifique MA |
| Taux de pertes amont | Produits refusés/jetés à la réception et périmés avant usage, par fournisseur et article. | Lien avec le module pertes déjà présent. | avancé | Aptean |

### A.10 — D10 Transverse

| Capacité | Description précise | Pourquoi | Niveau | Vu chez |
|---|---|---|---|---|
| Référentiel d'unités et de conversions | Unité de base par ingrédient (kg, L, pièce), densité pour poids↔volume (mig 227 existante), conditionnements multiples avec `qty_per_pack` ; conversions **internes uniquement**, affichage dans l'unité saisie. | Règle maison déjà posée ; c'est le socle de tout le volet A. | socle | Odoo UoM, Sage X3 |
| Traçabilité amont bidirectionnelle | Requête « de ce lot fournisseur, quels lots internes, quelles productions, quels produits vendus ? » et l'inverse. Rappel simulé (mock recall) avec chrono. | ONSSA / ISO 22005 ; FlexiBake en fait un argument commercial. | standard | FlexiBake, Aptean, M3 |
| Journal d'audit immuable | Qui a créé/modifié/validé BC, réception, facture, paiement, exceptions de plafond ; horodatage. | Exigé pour la défense en contrôle fiscal et pour la qualité. | socle | Tous |
| Pièces jointes typées | Facture, BL, CoA, fiche technique, photo de non-conformité ; stockées en base ou bucket (FS Cloud Run éphémère : ne pas stocker sur disque). | Contrainte d'infra déjà connue. | socle | Tous |
| Rôles | Demandeur, acheteur, magasinier (réception stricte), comptable, approbateur ; séparation réception / paiement. | Contrôle interne basique. | socle | Tous |
| Conservation 10 ans | Rétention des pièces et journaux ≥ 10 ans, export. | Obligation comptable/fiscale marocaine (conservation des documents 10 ans) ; sanction art. 211 pour non-conservation. | socle | Spécifique MA |

---

## Partie B — Contexte réglementaire marocain

Convention de lecture : **Exigence** → **Source(s)** → **Confiance** → **Implication modèle de données** (champs, contrôles). « CGI » = Code général des impôts marocain, version 2026 à vérifier sur tax.gov.ma.

### B.1 Mentions obligatoires d'une facture (CGI art. 145-III, VIII)

**Exigence.** Toute facture doit être pré-numérotée dans une série continue (ou éditée par un système informatique) et porter : identité et adresse du vendeur et de l'acheteur ; **IF** et **numéro de TP (article d'imposition à la taxe professionnelle, ex-patente)** du vendeur ; **ICE du vendeur** (obligatoire depuis le 01/01/2016, LF 2016, art. 145-VIII) ; **ICE du client** en B2B (depuis 2019) ; numéro et date ; désignation, quantités et prix unitaires HT ; total HT ; **taux et montant de TVA ventilés par taux** (ou mention de l'exonération) ; total TTC ; **références et mode de paiement**. Les guides pratiques ajoutent RC + ville, forme juridique et capital ; le RC n'est pas cité dans le commentaire de La Vie Éco sur l'art. 145 mais figure dans les usages et dans la synthèse Upsilon de l'art. 146. ICE = 15 chiffres (9 entreprise + 4 établissement + 2 clé).

**Sources.** [La Vie Éco – art. 145](https://www.lavieeco.com/?p=206098) ; [CMS – LF 2016](https://cms.law/fr/fra/a-la-une/maroc-mesures-communes-de-la-loi-de-finances-pour-2016) ; [ClicPaie – modèle de facture (maj 13/05/2026)](https://clicpaie.ma/blogs/modele-facture-maroc/) ; [ClicPaie – ICE](https://clicpaie.ma/blogs/ice-maroc/) ; [Upsilon – art. 146](https://upsilon-consulting.com/pieces-justificatives-des-achats-article-146-du-cgi/) ; [Lookuptax – identifiants MA](https://lookuptax.com/docs/fr/numero-identification-fiscale/maroc-numero-fiscal).

**Confiance.** Haute sur ICE/IF/TP/TVA ventilée/mode de paiement/numérotation ; Moyenne sur RC et capital (usage + guides, pas de texte vu).

**Sanctions.** 100 MAD par omission ou inexactitude d'ICE (art. 198 ter) ; surtout **perte de déductibilité (charge et TVA) côté acheteur** si la facture n'est pas « régulière et probante » (art. 146) ; non-conservation 50 000 MAD/exercice (art. 211) ; factures fictives art. 192.

**Implication modèle.**
- `suppliers` : `ice CHAR(15)` (contrôle numérique + unicité), `if_number`, `rc_number`, `rc_city`, `tp_number`, `legal_form`, `share_capital`, `vat_status ENUM('assujetti','non_assujetti','exonere_sdd')`, `is_dgi_inactive BOOL`, `dgi_inactive_checked_at`.
- `supplier_invoices` : `supplier_invoice_number` (obligatoire, unique par fournisseur), `invoice_date`, `payment_mode`, `buyer_ice_present BOOL`, `legal_mentions_ok BOOL` + `legal_mentions_issues JSONB` (liste des manques), `attachment_id`.
- `supplier_invoice_items` : déjà `tva_rate` par ligne (mig 189) ; ajouter `vat_exempt_reason` (art. 91 / non assujetti) quand `tva_rate = 0`.
- Contrôle : fonction serveur `check_invoice_legal_mentions()` appelée avant passage à `validated` ; blocage paramétrable (non bloquant en phase 1).
- Côté émission de BC (notre PDF) : en-tête avec nos propres ICE/IF/RC/TP ; logo déjà en data URI.

### B.2 Taux de TVA applicables aux intrants d'une boulangerie-pâtisserie

Réforme 2024-2026 (LF 2024/2025/2026) : convergence vers deux taux, **20 % normal (art. 99-A)** et **10 % réduit (art. 99-B)**, le 7 % et le 14 % ayant été résorbés progressivement ; un guide (Wafir, maj 12/06/2026) affiche encore 4 taux (20/14/10/7) ce qui contredit Upsilon : à trancher sur le CGI 2026.

| Intrant | Régime (meilleure lecture) | Source | Confiance |
|---|---|---|---|
| Farine, semoule, céréales de meunerie, pain, couscous | **Exonéré sans droit à déduction (art. 91-I-A-1)**, hors consommation sur place | [Fiscamaroc art. 91](https://www.fiscamaroc.com/la-taxe-valeur-ajoutee-126/article-91-exonerations-sans-droit-a-deduction-136.htm), [Upsilon liste art. 91](https://upsilon-consulting.com/exonerations-tva-sans-droit-deduction-article-91/) | Haute |
| Levure **fraîche** de panification | Exonérée SDD (art. 91) | idem | Haute |
| Levure **sèche** | **20 %** depuis le 01/01/2025 (sortie de l'exonération, LF 2025) | [Upsilon réforme TVA](https://upsilon-consulting.com/reforme-tva-maroc-2024-2026/) | Moyenne-Haute |
| Lait, crème, lait en poudre | Exonérés SDD (art. 91-I-A-2) | Upsilon art. 91 | Haute |
| Beurre d'origine animale | Exonéré SDD depuis 01/01/2024 (ex-14 %), **sauf beurre artisanal/non conditionné selon une lecture ; une autre source dit l'inverse** ; Wafir affiche encore 14 % | Upsilon réforme TVA ; [Wafir](https://wafir.ma/fr/guide/tva-maroc-taux-2026) | Moyenne (contradiction) |
| Sucre brut | Exonéré SDD (art. 91) | Upsilon art. 91 | Haute |
| Sucre raffiné | **8 % (2024) → 9 % (2025) → 10 % (2026)** | Upsilon réforme TVA | Haute |
| Huile de table | 10 % (Wafir) ; non confirmé par une 2e source | Wafir | Faible-Moyenne |
| Œufs | **Non trouvé** dans les sources ; les œufs frais relèvent des produits agricoles non transformés (hors champ / exonération agricole) dans la logique art. 91 ; **à vérifier** | — | Faible |
| Chocolat, fruits secs, arômes, additifs, conserves de fruits | Probablement 20 % (taux normal par défaut) ; conserves de sardines exonérées (non pertinent) | Upsilon (par défaut) | Faible-Moyenne |
| Emballages (boîtes, films, sachets), consommables | 20 % (taux normal, aucune exonération trouvée) | — | Moyenne |
| Électricité conventionnelle | 16 % (2024) → 18 % (2025) → **20 % (2026)** | Upsilon réforme TVA | Haute |
| Eau usage non domestique | 10 % | Upsilon | Moyenne |
| Prestations (transport, maintenance) | 20 %, transport 10 % (art. 99-B) | Upsilon | Moyenne |
| Nos ventes : consommation sur place (salon de thé) | 10 % avec droit à déduction (2026) | Upsilon réforme TVA | Moyenne |

**Conséquence majeure pour les achats** : les intrants de base (farine, lait, beurre, sucre brut, levure fraîche) sont **exonérés sans droit à déduction** : la facture ne porte pas de TVA, rien à récupérer, et la part « TVA récupérable » du module concerne surtout sucre raffiné (10 %), levure sèche, emballages, énergie, prestations (20 %).

**Implication modèle.**
- Table `vat_rates` (`code`, `rate NUMERIC(5,2)`, `kind ENUM('normal','reduit','exonere_sdd','exonere_add','hors_champ')`, `valid_from`, `valid_to`, `legal_ref`) : le taux est **daté** (le sucre a changé trois années de suite).
- `ingredients` / `packaging_items` : `default_vat_rate_code` ; `supplier_items` : surcharge possible.
- `supplier_invoice_items.tva_rate` reste la valeur **facturée** (vérité de la pièce) ; contrôle d'alerte si ≠ taux attendu de l'article à la date de facture.
- Vue de ventilation TVA par taux par facture pour le relevé des déductions.

### B.3 TVA récupérable, conditions de déductibilité et plafond des paiements en espèces (CGI art. 11-II, 101, 102, 106-II, 146)

**Exigence.**
1. **Conditions de fond (art. 101)** : achat affecté à l'exploitation, utilisé pour des opérations taxables ou exonérées avec droit à déduction, fournisseur assujetti, **droit à déduction né au paiement** (total ou partiel) de la facture.
2. **Conditions de forme (art. 102/145/146)** : facture régulière et probante au nom de l'entreprise, TVA mentionnée séparément, ICE/IF du fournisseur ; depuis LF 2016 l'achat doit être « réellement réalisé » ; depuis LF 2023, factures d'entreprises **inactives** (art. 228 bis) exclues.
3. **Plafond espèces** : n'ouvrent pas droit à déduction (TVA, art. 106-II) et ne sont pas déductibles (IS/IR, art. 11-II) les achats dont le règlement **dépasse 5 000 MAD TTC par jour et par fournisseur, dans la limite de 50 000 MAD par mois et par fournisseur**, sauf règlement par chèque barré non endossable, effet de commerce, moyen magnétique, virement, procédé électronique ou compensation documentée. **Exception** : achats d'animaux vivants et de **produits agricoles non transformés** exclus de ces conditions de paiement (lecture du texte art. 106-II via extraits). Les factures fractionnées pour rester sous le seuil sont recoupées par la DGI. Un guide (Upsilon) formule le seuil « par facture » : retenir la formulation légale (par jour et par fournisseur). Un projet de plafonnement légal général des paiements en espèces (50 000 MAD en 2026, 20 000 en 2028) est évoqué mais **n'est pas en vigueur** d'après les sources.
4. **Achats sans facture (marché, particuliers)** : aucune source trouvée n'admet explicitement une auto-facture ou un bon d'achat interne comme pièce probante pour l'IS ; le principe (art. 10/146) exige une pièce justificative, et la charge non justifiée est réintégrée. Pour la TVA, l'autoliquidation sur achats auprès de non-assujettis **exclut les produits agricoles**. Point à valider avec l'expert-comptable ; le modèle doit au moins isoler ces achats.

**Sources.** [Fiscamaroc art. 106 (extraits)](https://www.fiscamaroc.com/la-taxe-valeur-ajoutee-126/article-106-operations-exclues-du-droit-a-deduction-154.htm) ; [Upsilon – déductions TVA 2026](https://upsilon-consulting.com/deductions-tva-maroc/) ; [Upsilon – art. 146](https://upsilon-consulting.com/pieces-justificatives-des-achats-article-146-du-cgi/) ; [Upsilon – charges non déductibles art. 11](https://upsilon-consulting.com/charges-non-deductibles-is-maroc/) ; [Challenge – le cash résiste](https://www.challenge.ma/le-cash-fait-de-la-resistance-au-maroc-315574/) ; [Bladi – le cash coûte cher aux entreprises](https://www.bladi.net/122301) ; [Upsilon – TVA agriculture](https://upsilon-consulting.com/tva-agriculture-maroc/) ; [CMS – LF 2016](https://cms.law/fr/fra/a-la-une/maroc-tva-is-ir-toutes-les-nouveautes-fiscales-de-la-loi-de-finances-2016).

**Confiance.** Haute sur le seuil 5 000/jour/fournisseur et 50 000/mois (plusieurs sources dont extrait du texte) ; Haute sur la naissance du droit au paiement ; Moyenne sur l'exception produits agricoles non transformés (extrait de texte, une source) ; Faible sur le traitement des achats sans facture (non trouvé).

**Implication modèle.**
- `supplier_payments` : `payment_mode ENUM('cash','cheque_barre','virement','effet','carte','compensation')`, `reference`, `paid_at`, `amount_ttc`, `supplier_id`.
- Vue/fonction `fn_cash_cumul(supplier_id, date)` → cumul jour et cumul mois ; trigger/contrôle serveur à l'enregistrement d'un règlement espèces : `WARN` à 80 %, `BLOCK` au-delà sauf `override_reason` + `override_by` (table `cash_limit_overrides`). Paramètres en table `fiscal_thresholds` (`code='CASH_DAILY'`, `value=5000`, `valid_from`) pour suivre la loi sans redéployer.
- `supplier_invoices` : `is_deductible_is BOOL`, `is_vat_recoverable BOOL`, `non_deductible_reason ENUM('cash_over_limit','missing_mentions','inactive_supplier','no_invoice','personal')`, `vat_recoverable_from DATE` (= date du paiement).
- `suppliers.supplies_unprocessed_agri BOOL` pour appliquer l'exception (à confirmer) sur les lignes typées produits agricoles.
- Pièce `internal_purchase_vouchers` (bon d'achat interne) : `supplier_id` (type marché) ou `free_supplier_name`, `lieu`, `buyer_user_id`, `lines`, `total`, `cash_register_id`, `photo_attachment_id`, `signed_by` ; **jamais** de TVA récupérable ; participe au cumul espèces.
- Relevé des déductions TVA : vue avec ICE fournisseur, n° facture, date, HT, TVA, mode et date de paiement.

### B.4 E-facturation / facture électronique DGI (CGI art. 145-IX, X, XI)

**Exigence.** L'art. 145-IX (introduit par LF 2018 selon une source, LF 2024 selon une autre) oblige les entreprises soumises à l'IS, à l'IR régime RNR/RNS et à la TVA à disposer d'un système de facturation répondant à des critères techniques fixés par voie réglementaire. Auto-entrepreneurs et CPU exclus (145-XI) ; obligation d'adresse e-mail (145-X).

**État au 11/10/2026 (contradictoire).**
- Upsilon (article du 21/03/2026, **relu le 28/09/2026**) : **aucun décret ni arrêté d'application publié au BO** ; les annonces de la DGI (avril 2026 : déploiement progressif par les grandes entreprises, plateforme nationale, factures XML structurées) ne sont confirmées par aucun texte ; le « démarrage 2026 » n'a pas eu lieu. Le projet de décret est au Secrétariat général du gouvernement.
- Le360/Challenge (03/06/2026) : plan annoncé — **Phase 1 (2026)** : ~1 655 grandes entreprises CA > 200 MMAD (B2G) ; **Phase 2 (2027-2028)** : PME/ETI ; **Phase 3 (après 2028)** : TPME avec solutions simplifiées. Facture signée électroniquement et horodatée ; plateformes/éditeurs agréés DGI.
- Éditeurs (Inyad, Edicom, Sage) : calendriers plus agressifs (01/01/2026 grandes entreprises, 01/07/2026 moyennes, 01/01/2027 PME < 10 MMAD et auto-entrepreneurs > 500 kMAD), format **UBL**, modèle **clearance** (validation préalable), transmission 24 h, conservation 10 ans — **indicatifs, non confirmés**.

**Sources.** [Upsilon – e-facturation 2026](https://upsilon-consulting.com/facturation-electronique-maroc-2026/) ; [Le360 – calendrier](https://fr.le360.ma/economie/facturation-electronique-le-detail-du-calendrier-de-mise-en-place_2EQSNG2DTVB6PGBBHQ6OCFT6CY/) ; [Challenge – grande bascule](https://www.challenge.ma/facturation-electronique-les-entreprises-face-a-la-grande-bascule-320792/) ; [Inyad – calendrier](https://inyad.com/blog/calendrier-facture-electronique-maroc-2026-2028) ; [Edicom – UBL](https://edicomgroup.com/fr/blog/maroc-obligation-facturation-electronique) ; [Sage MA](https://www.sage.com/fr-ma/blog/facturation-electronique-maroc-2026/) ; [TelQuel 2024](https://telquel.ma/2024/12/05/2026-lannee-du-big-bang-de-la-facturation-electronique-au-maroc_1907224).

**Confiance.** Haute sur l'existence de l'obligation de principe et sur l'absence de décret publié à fin septembre 2026 ; Moyenne sur le phasage « grandes entreprises d'abord, PME 2027-2028 » ; Faible sur toute date précise, seuil, format et délai. **Une boulangerie-pâtisserie (PME) ne sera vraisemblablement concernée qu'en phase 2 ou 3, soit 2027 au plus tôt.**

**Implication modèle (anticipation sans intégration).**
- `supplier_invoices` : `einvoice_uid` (identifiant DGI/plateforme), `einvoice_format ENUM('none','ubl','cii','pdf')`, `einvoice_status`, `einvoice_payload_ref` (stockage du XML reçu), `einvoice_received_at`.
- Côté émission (ventes, hors périmètre achats) : prévoir numérotation strictement séquentielle, signature/horodatage, conservation 10 ans.
- Ne pas coder d'intégration avant publication du décret ; suivre tax.gov.ma et sgg.gov.ma.

### B.5 ONSSA : traçabilité amont, registre des entrées, retrait/rappel (loi 28-07, décret 2-10-473, décret 2-12-389)

**Exigence.**
- **Loi 28-07** (sécurité sanitaire des produits alimentaires) : obligation d'**autocontrôle** et de **traçabilité à toutes les étapes**, liée à l'autorisation/agrément sanitaire de l'établissement ; ~35 textes d'application (10 décrets, 25 arrêtés). Un avant-projet de révision (2022) renforce enquêtes, sanctions, enregistrement de tout fonds de commerce alimentaire et traçabilité ; adoption non confirmée.
- **Décret 2-10-473 (06/09/2011, BO n° 5992)** : mesures de préservation de la qualité et sécurité sanitaire, modalités d'autorisation/agrément, contrôle de conformité ; prévoit enregistrement des exploitations, traçabilité « du producteur au consommateur », autocontrôle, guides de bonnes pratiques d'hygiène, **retrait des produits non conformes**. Le détail « registre des entrées/sorties, mentions du lot » n'a pas pu être lu (texte scanné FAOLEX non fetché).
- **Décret 2-12-389 (22/04/2013)** étiquetage : dénomination, ingrédients, quantité nette, **DLC (« à consommer jusqu'au ») / DDM**, lot, adresse du fabricant/conditionneur/importateur, **allergènes mis en évidence (annexe I : gluten, œufs, lait, fruits à coque, soja, sésame…)**, étiquetage nutritionnel ; alignement progressif sur le règlement UE 1169/2011.
- En pratique (principe « un pas en arrière, un pas en avant » d'ISO 22005, repris par la 28-07) : l'exploitant doit pouvoir dire **de qui** il a reçu chaque matière (fournisseur, lot, date, quantité, DLC) et **vers quoi** elle est partie, et déclencher un retrait/rappel.

**Sources.** [FNH – entretien loi 28-07 traçabilité](https://fnh.ma/article/actualite-economique/entretien-lla-loi-28-07-institue-lobligation-detablir-la-tracabiliter) ; [FNH – coulisses ONSSA](https://fnh.ma/article/actualite-economique/onssa-coulisses-controle-sanitaire-aliments-maroc) ; [Le360 – avant-projet 2022](https://fr.le360.ma/economie/obligation-de-tracabilite-modalites-de-saisie-ce-que-propose-lavant-projet-de-loi-sur-la-securite-253305/) ; [USDA FAS – Morocco Food Safety Decree](https://www.fas.usda.gov/data/morocco-food-safety-decree) ; [FAOLEX – décret 2-10-473 (PDF)](https://faolex.fao.org/docs/pdf/mor106652.pdf) ; [ONSSA – décret 2-12-389 (PDF)](https://www.onssa.gov.ma/wp-content/uploads/2021/11/DEC.2-12-389.FR.c2.pdf) ; [USDA FSIS – Morocco labeling guidance](https://www.fsis.usda.gov/sites/default/files/media_file/2021-02/morocco-labeling-guidance.pdf) ; [NAJFNR – overview food safety & labeling MA](https://najfnr.com/home/article/view/617).

**Confiance.** Haute sur l'obligation générale de traçabilité et de retrait ; Haute sur les mentions DLC/lot/allergènes de l'étiquetage ; Faible sur la forme exacte du « registre des entrées » (non lu dans le texte : à extraire du PDF FAOLEX ou de l'ONSSA).

**Implication modèle.**
- `goods_receipt_lines` : `supplier_lot_no` (NOT NULL pour les catégories périssables ; contrainte conditionnelle par `category.requires_lot`), `dlc DATE`, `ddm DATE`, `manufactured_at`, `origin_country/region`, `temperature_at_receipt NUMERIC`, `qc_status ENUM('pending','accepted','accepted_with_reserve','rejected')`, `qc_notes`, `qc_photo_id`.
- `ingredient_lots` : `goods_receipt_line_id` (lien 1-n vers lot fournisseur), `supplier_id`, `internal_lot_no` généré, `dlc` (déjà présent mais « inerte » selon l'audit pesage : le rendre actif en FEFO et alertes).
- `supplier_items` : `allergens TEXT[]` ou table `supplier_item_allergens` (référentiel annexe I du décret), `tech_sheet_attachment_id`, `tech_sheet_valid_until`.
- Vue « registre des entrées » : date, fournisseur, article, lot fournisseur, lot interne, quantité (conditionnement et unité de base), DLC, résultat contrôle, n° BL/facture — exportable PDF/CSV pour l'inspecteur.
- Procédure rappel : requête descendante `lot_fournisseur → ingredient_lots → bsi/pesées → production_items → ventes`, et ascendante ; table `recalls` (`lot_id`, `opened_at`, `reason`, `scope`, `closed_at`).

### B.6 Norme ISO 22005:2007 — traçabilité dans la chaîne alimentaire

**Exigence (volontaire, cadre de conception).** Principes et exigences de base pour concevoir un système de traçabilité à toute étape de la chaîne ; traçabilité = outil au service d'objectifs définis (sécurité, qualité, rappel, allégations) ; l'organisme définit objectifs, périmètre, **unité traçable** (lot), informations à enregistrer, liens « un pas en arrière / un pas en avant », procédures de vérification et de rappel, conservation des enregistrements. Confirmée en 2022, toujours en vigueur (texte payant, CHF 67).

**Sources.** [ISO 22005:2007](https://www.iso.org/standard/36297.html) ; [AFNOR – ISO 22005](https://www.boutique.afnor.org/en-gb/standard/iso-220052007/traceability-in-the-feed-and-food-chain-general-principles-and-basic-requir/xs115569/113903).

**Confiance.** Haute sur le périmètre et le statut ; le libellé exact du « one step back / one step forward » n'a pas été vérifié dans le texte (connaissance générale).

**Implication modèle.** Ce qui manque le plus souvent n'est pas la donnée mais la **clé de jointure** : chaque mouvement (réception, transfert, pesée, production, vente, perte) doit référencer un `lot_id` et jamais seulement un `ingredient_id`. Exercice de « mock recall » périodique = requête SQL qui doit tourner en quelques secondes ; en faire un écran.

---

## Synthèse pour la refonte : les 12 décisions de modèle qui découlent de ce référentiel

1. **Double unité partout** (conditionnement + unité de base) sur `supplier_items`, lignes de BC, réception, facture ; conversions internes, affichage dans l'unité saisie.
2. **Poids réel à la réception** avec tolérance par article/fournisseur et décision tracée ; réutiliser la balance WebSerial du pesage.
3. **Lot fournisseur + DLC obligatoires** à la réception pour les catégories périssables ; lot interne lié ; FEFO actif en sortie.
4. **Fiche fournisseur légale** (ICE 15, IF, RC, TP, régime TVA) avec contrôles de format ; type « marché/espèces ».
5. **Contrôle des mentions légales** de la facture fournisseur avant validation.
6. **Taux de TVA datés** en table ; alerte si taux facturé ≠ attendu ; exonération SDD modélisée explicitement (la majorité des matières de base).
7. **Droit à déduction TVA au paiement** : date de récupérabilité = date de règlement.
8. **Compteur espèces** par fournisseur jour/mois (5 000 / 50 000 MAD TTC, seuils en table) avec alerte, blocage et override tracé ; détection de fractionnement.
9. **Bon d'achat interne** pour les achats sans facture, isolé, sans TVA récupérable, inclus dans le cumul espèces ; déductibilité IS à valider avec l'expert-comptable.
10. **Drapeaux de non-déductibilité** (IS et TVA) sur la facture avec motif, alimentant la compta (charge vs 3455x).
11. **Colonnes e-facturation** réservées (uid, format, statut, payload) sans intégration tant que le décret n'est pas au BO ; PME concernée au plus tôt en 2027.
12. **Registre des entrées** et **requête de rappel** bidirectionnelle comme écrans de première classe, avec allergènes portés par l'article fournisseur.

## Points à vérifier avant arbitrage (ouverts)

- Texte CGI 2026 art. 91 (beurre : conditionné ou artisanal ?), art. 99 (reste-t-il un 14 % ?), régime des œufs.
- Texte art. 106-II : portée exacte de l'exception « produits agricoles non transformés » pour nos achats de fruits/œufs/lait au marché.
- Position de l'expert-comptable sur la pièce probante pour achats sans facture (bon d'achat interne).
- Décret d'application e-facturation : surveiller BO/DGI ; seuils de CA pour la vague PME.
- Lecture du décret 2-10-473 (PDF FAOLEX) pour la forme du registre et les délais de conservation des enregistrements de traçabilité.

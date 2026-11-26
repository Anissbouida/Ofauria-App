# Audit — cohérence de Kalum avec le profil de la société (2026-11-26)

Déclencheur : une société configurée en BTP voyait encore la caisse (Tickets, Sessions de caisse), le poste de pesée, les bons de sortie, les dates limites, les allergènes… Question posée : le même défaut existe-t-il ailleurs, pour tous les profils ?

Méthode : lecture complète du code client et serveur en cinq domaines (Ventes et caisse ; Stock, Achats, Production, Contrôle ; Comptabilité, Personnel, Projets, Maintenance, Utilisateurs ; accueil, navigation, Paramètres, assistant, rapports ; serveur transversal : garde d'API, tâches planifiées, documents, données de départ). Les constats majeurs ont été revérifiés dans le code et sur une base neuve (`kalum_roadmap`, migrations seules). Aucune modification n'a été faite.

Cinq critères :

| Code | Critère |
|---|---|
| C1 | Écran, menu, tuile, bouton ou point d'API accessible sans le module ou la capacité dont il dépend |
| C2 | Contenu d'un écran (colonnes, filtres, indicateurs, bandeaux, champs, actions) lié à un module ou une capacité éteints |
| C3 | Vocabulaire de boulangerie, de caisse ou nom du client écrit en dur |
| C4 | Serveur : règles métier, écritures, tâches planifiées, notifications, documents, valeurs par défaut qui supposent une boulangerie avec caisse |
| C5 | Réglage ou étape de l'assistant proposés pour un module ou une capacité éteints |

Priorités : **P0** = trompeur ou faux pour un client non alimentaire ou sans caisse (données fausses, flux bloqué, marque d'un autre client) ; **P1** = incohérence visible ; **P2** = texte, exemple, cas rare.

Bilan : **environ 150 constats**, dont **23 P0**, **~85 P1**, **~40 P2**. Ofauria (boulangerie, tous les modules actifs) n'est touché par aucun : tous les défauts apparaissent dès qu'un profil n'a pas la caisse, la production, le stock ou les capacités alimentaires.

---

## 1. Causes racines

1. **Le module n'est contrôlé qu'aux menus, et seulement là où quelqu'un y a pensé.** Le registre des capacités (`capability-screens.ts`) masque les écrans d'une capacité éteinte, mais il n'existe aucun registre « écran → modules requis ». Chaque page écrit sa visibilité à la main, souvent d'après le rôle (magasinier, gérant) et non d'après le profil. Côté client, aucune garde de route par module : une adresse tapée ouvre un écran dont toutes les API répondent 403.
2. **Le code métier ne demande presque jamais si une capacité est active.** `featureOn` n'est appelé que pour 7 capacités (pesage, dlc_jour, vitrine, réservation, ccp_cuisson, fiche masterclass, promotions). Les écrans testent rarement `hasFeature('lots' | 'dlc_ddm' | 'pesage' | 'quarantaine' | 'allergenes')`. Les catalogues transverses (paramètres, questions de l'assistant, sources de rapports, entités d'import, tâches planifiées, règles de notification, recherche) n'ont aucun champ module ou capacité.
3. **Les valeurs par défaut sont celles d'Ofauria.** Identité « OFAURIA / Boulangerie - Patisserie », logo Ôfauria sur les PDF, favicon croissant, `sector_pack = 'boulangerie'`, compte de ventes 7111, `item_kind = 'manufactured'`, `sale_type = 'jour'`, fidélité active, 19 tâches planifiées actives, postes horaires « Vente / Production », centres de coût PROD/MAINT/QUAL, rôles Caissier/Vendeuse/Boulanger proposés partout, replis de vocabulaire « Fournée, Ingrédient, Économat, Pesage ».
4. **Le cycle de caisse de boulangerie est câblé dans la caisse elle-même** (vitrine, invendus, DLC, inventaire d'ouverture, sachets, appro labo) au lieu de dépendre des modules Journée boutique, Réapprovisionnement, Emballages et de la capacité Dates limites.

---

## 2. Constats P0 (vérifiés)

| # | Domaine | Constat | Profils touchés | Où |
|---|---|---|---|---|
| P0-1 | Compta | Toute ligne de facture sans compte de famille est passée en **7111 Ventes de marchandises** : situations de travaux, prestations, ordres de transport. CPC et liasse faux (marchandises au lieu de services). Même constante dans les factures à établir et les avoirs | services, btp, transport | `journal-generator.service.ts:671`, `period-end.repository.ts:91` |
| P0-2 | Compta | Clôture : le contrôle « Jours sans aucune vente en caisse » compte chaque jour de la période (≈ 30 avertissements) ; contrôles de sessions de caisse affichés à 0 | tout profil sans caisse | `fn_close_checklist`, mig 452/665 |
| P0-3 | Ventes | Une commande d'un produit « fabriqué » (valeur par défaut de tout produit) crée un plan de production, passe en « en production » et notifie les chefs d'atelier, sans vérifier le module Production. Même chose par l'API publique | négoce, commerce, santé, transport, e-commerce, btp | `sourcing.helper.ts:205-236`, `order.controller.ts:192-213`, défaut mig 469 |
| P0-4 | Ventes | Remise et avance d'une commande de particulier exigent une **session de caisse ouverte** : flux bloqué sans caisse | e-commerce, agriculture, textile, btp, transport | `order.controller.ts:346, 598-600` |
| P0-5 | Caisse | Fermeture de caisse : inventaire des invendus, décisions « Vitrine J+1 / destruction » et contrôle des périmés imposés sans le module Journée boutique ni la capacité DLC ; le lendemain la caisse peut être bloquée par un inventaire d'ouverture dont l'écran est invisible | négoce, commerce, santé | `cash-register.controller.ts:111-147`, `POSPage.tsx`, trigger mig 251 |
| P0-6 | Caisse | Suggestion « produit du jour non re-exposable — destruction » pour chaque reste (défaut `sale_type = 'jour'`) : pertes comptabilisées à tort | négoce, commerce, santé | `unsold-decision.repository.ts`, mig 061 |
| P0-7 | Caisse | « Approvisionnement vitrine » ouvre un écran du module Réapprovisionnement (403) | négoce, commerce, santé | `POSPage.tsx:1804` |
| P0-8 | Ventes / Compta | Fidélité : chaque vente payée avec un client crédite des points **et passe une écriture** (dette de fidélité) sans vérifier la capacité `promotions_fidelite` ; fidélité active par défaut | tout profil où la capacité est éteinte | `loyalty.ts:115`, `sale.repository.ts:354`, mig 372 |
| P0-9 | Ventes | Menu « Devis » rattaché au module Commandes : le profil Services (ventes + CRM, sans commandes) n'a pas de devis alors que le CRM propose « Créer un devis » | services | `SalesLayout.tsx:40` |
| P0-10 | Ventes | Depuis un devis, « Créer la commande / Voir les commandes » sans le module Commandes : la commande créée est invisible | services | `QuotesPage.tsx:103, 523-553` |
| P0-11 | Identité | Société neuve : `company_name = 'OFAURIA'`, sous-titre « Boulangerie - Patisserie » (en-tête, page de connexion, ticket) ; l'assistant n'écrit que la raison sociale. Non corrigé par `client-install.sh` | tous les nouveaux clients | mig 013, `Header.tsx:52`, `LoginPage.tsx` |
| P0-12 | Documents | Sans logo société, factures, devis, avoirs, BL, relances, bons de commande impriment **le logo Ôfauria « Boulangerie · Pâtisserie »** (et un chemin de fichier propre à Ofauria) ; idem aperçu Apparence et ticket | tous les autres clients | `invoice-pdf*.service.ts`, `delivery-note-pdf`, `dunning-pdf`, `ReceiptModal.tsx:111` |
| P0-13 | Vocabulaire | 9 profils sans héritage n'ont pas les termes `batch`, `ingredient`, `weighing_zone`, `doc_bon_sortie`… : « Ingrédient(s) », « Fournée », « Pesage », « Économat », « Bon de sortie ingrédients » partout (Stock, rapports, recherche) | services, btp, transport, santé, e-commerce, commerce, textile | `vocabulary.ts`, mig 647/691 |
| P0-14 | Stock | Réserve : situations et filtres « DLC dépassée / ≤ 7 j », colonnes Lots et DLC, bandeau « lots expirés » sans tester `lots` ni `dlc_ddm` | btp, services, transport… | `StockPage.tsx:63-610` |
| P0-15 | Stock | Fiche article : bloc « Lots et traçabilité », KPI « Lots actifs », étiquette DLC sur chaque lot sans condition | btp, services | `IngredientDetailPage.tsx:409-951` |
| P0-16 | Stock | Registre des entrées : 100 % des réceptions marquées « incomplètes » (sans lot ni DLC) | btp, services, transport | `GoodsEntryRegisterTab.tsx`, vue mig 312 |
| P0-17 | Achats | Réception d'un bon de commande : colonnes « Réf. lot / DLC / Date de production » sans condition | btp, services… | `PurchaseOrdersTab.tsx:2449-2600` |
| P0-18 | Serveur | Tâches `dlc_alerts` et `lots_expire` : alertes « DLC proche », e-mails et sorties de stock automatiques quel que soit le profil ; `runDueJobs` ne vérifie aucun module | tous | `scheduler.ts:337-416, 563-583` |
| P0-19 | Rapports | KPI « Coût matière / Prime cost » avec cibles de restauration (25-30 %) calculés sur les plans de production : 0 % « Acceptable » sans production ; « Menu Engineering » proposé à tous | btp, services, transport, négoce, santé… | `ReportsPage.tsx`, `ReportsOverview.tsx`, `reports.controller.ts:232-412` |
| P0-20 | Paramètres | Règles de caisse : « Entremets vendus par personne », « inventaire des invendus (journée boutique) », « stock vitrine », sachets « par vendeuse » | négoce, commerce, santé | `parameters-catalog.ts:400-508`, `SachetsTab.tsx` |
| P0-21 | API | `/sales`, `/reports`, `/gestion` listent le module `dashboard` (toujours actif) : ces préfixes ne se ferment jamais (`POST /sales/checkout`, menu engineering…) | tous sans caisse | `module-guard.middleware.ts:41, 82, 83` |
| P0-22 | Contrôle | Vue d'ensemble : écart de caisse, production, HACCP, achats affichés et calculés pour tous | tous sans caisse / production | `ControlePage.tsx`, `controle.repository.ts:250-336` |
| P0-23 | Données | Une installation par migrations seules contient le catalogue, les salariés, les recettes et le fond de caisse d'Ofauria ; `client-install.sh` les retire mais pas l'identité, la fidélité active ni les tâches actives | nouveaux clients | mig 002, 070, 115-303, 128, 214 |

---

## 3. Constats P1 par domaine

### Ventes, caisse, clients
- Caisse : tickets/retours/sessions (**corrigé** c1f08d2d) ; sachets sans module Emballages ; transferts interrogés toutes les 30 s (403 en boucle) ; badges et modale « expirés en vitrine » sans `dlc_ddm`.
- Commandes : étape « En production / en atelier », « Lancer en production », bandeau « production décalée » sans module Production.
- Tableau de bord Ventes : sessions de caisse ouvertes, commandes en retard, BL à facturer sans caisse ni commandes ; anneau « Marge brute » (coût des fiches techniques).
- Tournées sans module Commandes ; « Importer des tickets (CSV) » au format Loyverse en bouton principal.
- Clients : KPI, filtre et colonne Fidélité sans la capacité ; champ « Allergies / restrictions » sans `allergenes`.
- Factures émises : bandeau « une commande de particulier se règle en caisse » ; facture directe refusée pour un produit de type service (transport, btp).
- Portail client : onglet Commandes sans module Commandes.

### Stock, Achats, Production, Contrôle
- Stock : Poste de pesée, Bons de sortie, colonne et actions « Au pesage / Ouvrir », KPI « En réserve / Au pesage », intitulé « Réserve » ; Mouvements (KPI de pesée et de bons de sortie) ; Consommation (« Production ») ; Âge du stock (DLC) ; Emplacements (sonde HACCP, plage de température, appel 403 à `/production-cout`, rôles proposés sans filtre) ; fiche article (productions liées, boutons Ouvrir contenant / Quarantaine / Étiquette) ; formulaire article (fiches techniques, pesage).
- Réceptions : quarantaine et n° de lot fournisseur exigés (erreur bloquante) selon la catégorie, sans tester `quarantaine` ni `controle_qualite` ; avertissements lot/DLC sans `lots` ni `dlc_ddm`.
- Achats : « Réceptions » pour un profil sans stock (services) ; renvoi vers Contrôle même sans module Contrôle.
- Production (textile, atelier, industrie) : colonne DLC et repli « Vente du jour », « Ingrédients à peser / Valider la pesée » sans `pesage`, section Allergènes des nomenclatures toujours affichée, type d'ordre « pesée exigée » par défaut.
- Contrôle : onglets Production et Achats sans leurs modules ; familles de pertes figées (Production, Invendus, Vitrine, DLC) ; critère « lot et DLC lisibles ».

### Comptabilité, Personnel, Projets, Utilisateurs
- Compta : onglet Résumé construit sur la caisse ; onglet Pertes (produits finis) sans stock ; bandeau « Tickets de caisse impayés » de la balance âgée ; bloc « Stock de produits finis » de la clôture ; valorisation de fin de période en 3151/7132 même pour la marchandise revendue (négoce, commerce, santé → 3111/6114) ; centres de coût PROD/MAINT/QUAL créés pour tous et imputation par défaut sur PROD.
- Personnel : postes horaires « Vente matin / Production matin » livrés à tous ; planning « Caissière & Vendeuse » ; libellés de paie « sortie de caisse ».
- Utilisateurs : matrice des droits avec tous les modules ; rôles système Caissier, Vendeur, Opérateur de production, Magasinier disponibles partout (tâche « rôle sans titulaire ») ; ligne « Ateliers de production » ; page d'accueil d'un rôle proposant /pos, /production ; rôle de base par défaut « cashier » ; libellé du rôle dans l'en-tête tiré des constantes boulangerie.
- Projets : seul le titre suit le vocabulaire (« Chantiers ») ; colonnes, boutons, états vides restent « Projet ».

### Accueil, navigation, Paramètres, assistant, rapports
- Aucune garde de route par module ; `/haccp` accessible quand la capacité est éteinte ; caissiers envoyés de force sur `/pos` même sans caisse.
- Descriptions des tuiles de l'accueil écrites pour la boulangerie (« Commandes clients à produire », « Stock scellé, stock entamé », « demandes boutique… HACCP ») ; favicon croissant ; recherche globale sans filtre de module (liens morts, libellé « Ingrédient ») et exemptée de la garde.
- Assistant : questions « Modèle opérationnel / Processus et règles » filtrées par module mais jamais par capacité (HACCP, DLC, quarantaine, vitrine) ; étape Vocabulaire proposant fiche technique, plan de production, bon de sortie sans ces modules ; parcours de production figé (contrôle qualité, « réception par la boutique ») ; « Données de départ » activé avec une liste vide ; **l'assistant enregistre les replis boulangerie comme renommages de la société** (termes figés).
- Paramètres : notifications et tâches planifiées non filtrées (« Stock frigo », « Bon de sortie refusé par le chef », « Alerte HACCP ») ; réglages sans module (`ParamDef`) ; paramètres introuvables (`payment.*`, `hr.documents_due` renvoyés vers la page Production) ; canaux et catégories de produits « en caisse » sans caisse ; qualité des données (fiches techniques) ; points de mise en service requis sur des pages masquées.
- Rapports configurables et imports : sources « Production / Lots produits / Vitrine » et entités « Matières premières / Fiches techniques / Ordres de fabrication » proposées à tous.

### Serveur transversal
- API publique et portail montés avant la garde d'activation (une commande publique crée commande et plan de production) ; `/settings` exempté (simulation de production, import d'ingrédients et de fiches) ; `/cash-register`, `/caisse` ouverts par Ventes ou Comptabilité ; capacités alimentaires sans règle d'API (`/ingredient-lots`, `/label-data`, allergènes du bon de sortie).
- Toutes les tâches planifiées actives par défaut ; relances (`dunning_run`) qui posent des blocages de crédit sans la capacité ; `loyalty_expire`, `quotes_expire`, `crm_activities_due`, `maintenance_due` sans contrôle.
- Tableau de bord `/reports/dashboard` calculé sur les tickets de caisse : CA du jour à 0 pour services, btp, transport.
- « DH » et « dirham(s) » en dur dans le solde de tout compte, l'attestation de salaire, l'ordre de virement, les lettres de relance et des libellés d'approbation (migrations) — hors de portée du test de devise.
- Référentiels sans secteur visibles partout : types de vente « Du jour », types de perte « production / périmé », catégories de dépenses « Matériel POS & Caisse », « Tickets restaurant ».

---

## 4. Constats P2 (résumé)

Exemples de saisie et états vides alimentaires (« Farine T55 », « buffet mariage 120 personnes », « Plateau de mignardises », « Four à sole », « Chambre négative », centres « BOUL ») ; aperçus de modèles de documents avec des lignes de pâtisserie ; « Client comptoir », « Doubles services » sur le bulletin ; charte marron et beige d'Ofauria en dur dans 4 PDF ; « Catalogue Loyverse » ; couleurs par rôle boulanger dans la caisse ; fuseau `Africa/Casablanca` écrit 51 fois alors que la société a un fuseau ; service `invoice-docx` mort ; emplacements « Économat / Zone de pesage » créés pour tous les établissements.

---

## 5. Plan de correction proposé

Le principe : **un écran, un contenu, une tâche, un réglage déclarent ce dont ils ont besoin ; le socle décide.** Plus de condition écrite à la main d'après le rôle ou le secteur.

| Lot | Contenu | Priorités couvertes |
|---|---|---|
| **L0 — Règle unique et garde** | Registre partagé « écran → modules et capacités requis » appliqué par le gabarit de module, la navigation et une garde de route client (écran « Module désactivé ») ; retrait de `dashboard` des règles d'API ; garde d'activation sur l'API publique, le portail, `/search`, `/settings` ; règles d'API des capacités alimentaires ; **test sur les 18 profils** : aucun écran visible sans ses besoins, relevé des menus par profil (Ofauria identique avant/après) | P0-9, 21, 22 ; C1 |
| **L1 — Identité et marque** | Valeurs par défaut neutres (nom, sous-titre, pied de ticket, `sector_pack`), étape Identité de l'assistant qui écrit le nom affiché, aucun logo de repli (raison sociale en texte), favicon Kalum, couleurs des PDF tirées du thème ; `client-install.sh` complété. Ofauria garde ses valeurs | P0-11, 12, 23 |
| **L2 — Caisse découplée de la boulangerie** | Clôture : invendus et inventaire d'ouverture seulement avec Journée boutique et le paramètre, périmés seulement avec Dates limites ; pas de suggestion de destruction sans Journée boutique ; appro et transferts avec Réapprovisionnement ; sachets avec Emballages ; fidélité avec sa capacité ; commandes de particulier encaissées hors caisse sans le module | P0-4 à 8 |
| **L3 — Capacités dans les écrans et règles Stock / Achats / Production / Contrôle** | Lots, DLC, pesage, quarantaine, allergènes, étiquetage testés dans les colonnes, filtres, bandeaux, KPI, actions et exigences de réception ; registre des entrées « incomplet » selon les capacités | P0-14 à 17 ; C2 |
| **L4 — Règles métier et comptables par profil** | Compte de ventes par défaut porté par le profil (712x pour prestations) ; contrôles de clôture conditionnés aux modules ; valorisation de fin de période selon production ; `item_kind` et `sale_type` par défaut selon le profil, pas de plan de production sans Production ; devis rattaché à sa capacité ; facture directe des services ; centres de coût et postes horaires par profil ; rôles système disponibles selon leur module | P0-1 à 3, 10 |
| **L5 — Catalogues transverses** | Champ module/capacité sur les paramètres, questions de l'assistant, sources de rapports, entités d'import, tâches planifiées (`requires`, sautées avec motif), règles de notification, points de mise en service, qualité des données, données de départ ; tâches activées selon le profil | P0-18, 19, 20 ; C4, C5 |
| **L6 — Vocabulaire** | Replis neutres (Lot, Article, Réserve…) et termes boulangerie déplacés dans le profil Boulangerie ; nouvelles clés (boutique, stock du magasin, vendeur, site) ; l'assistant n'enregistre que les termes modifiés ; libellés de rôle lus en base ; Projets entièrement au vocabulaire ; messages serveur au vocabulaire | P0-13 ; C3 |
| **L7 — Textes et exemples** | Exemples, aperçus, libellés de paie, devise et fuseau de la société, référentiels étiquetés par secteur | P2 |

Ordre conseillé : L0 (il donne la règle et le test qui empêchent toute régression), puis L2 et L4 (données fausses et flux bloqués), L1 (marque d'un autre client sur les documents), L3, L5, L6, L7.

Point d'attention pour Ofauria (production) : chaque lot doit laisser son menu, ses écrans et ses écritures inchangés ; le test des 18 profils inclut une comparaison du profil Boulangerie avant/après.


---

## 6. État de la correction (2026-11-26)

Kalum est un ERP multisectoriel : Ofauria a été le point de départ, la boulangerie est désormais un profil parmi d'autres (aucun réglage n'est plus préservé pour un client).

| Lot | État | Commits / migrations |
|---|---|---|
| L0 Règle unique et garde | Fait | registre `shared/screen-needs` (écrans, adresses, réglages), garde de route, points d'API de caisse fermés sans caisse, test des 18 profils (`ecrans-par-profil`) |
| L1 Identité et marque | Fait | aucun logo ni en-tête de repli dans les documents, favicon Kalum, mig 730 (identité neutre : nom, sous-titre, secteur générique, logo d'origine retiré), `client-install.sh` |
| L2 Caisse découplée | Fait | clôture (invendus avec Journée boutique et le paramètre, périmés avec DLC), réapprovisionnement, fidélité avec sa capacité, commandes sans caisse refusées proprement, mig 728 (particulier facturé) |
| L3 Capacités dans Stock / Achats / Production / Contrôle | Fait | Réserve, fiche article, réception de BC, règles de réception serveur, vue d'ensemble et pertes du Contrôle, allergènes des nomenclatures |
| L4 Règles métier et comptables | Fait | compte de ventes par profil (politique `accounting.default_revenue`, mig 729), contrôles de clôture, valorisation 3111/6114 sans production, pas de plan de production sans module, devis sans commandes, facture directe des services, rôles métier selon leur module |
| L5 Catalogues transverses | Fait | tâches planifiées (`JOB_NEEDS`), réglages (`PARAM_NEEDS`), notifications, sources de rapports, imports, recherche, points de mise en service, coût matière de l'analyse |
| L6-L7 Vocabulaire et textes | Fait | replis neutres + termes historiques portés par les profils (mig 731), assistant qui ne fige plus les replis, tuiles d'accueil |
| R1 Écrans restants | Fait | compta (tickets impayés, stock de fin de période, règles carte), stock (mouvements, âge, emplacements), clients (fidélité, allergies), utilisateurs (matrice, ateliers, accueil, libellé du rôle), production (« Sans date limite », pesée par défaut) |
| R2 Contenu par profil | Fait | mig 732 : postes horaires et centres de coût selon le métier |
| R3 Serveur | Fait | API publique et portail gardés par module, tableau de bord sur factures sans caisse, devise des documents RH, notifications de production |
| R4 Assistant | Fait | vocabulaire selon les modules retenus, parcours de production neutre, données de départ sans production si décochée |
| R5 Projets et exemples | Fait | vocabulaire « Chantier / Contrat » dans tout le module, exemples de saisie neutres |

**Restent (à décider ou mineurs)**

- Données d'Ofauria semées par d'anciennes migrations figées (catalogue 128, salariés 070, fond de caisse 214, recettes 115-303) : retirées par `client-install.sh` (chemin officiel d'installation). Décision du 2026-11-26 : pas de purge automatique par migration (elle supprimerait des données saisies sur une base d'essai) ; `client-install.sh` reste le seul chemin d'installation.
- Traités ensuite (2026-11-26) : types de vente « Du jour » / « À date limite » et pertes par métier, produit neuf « Sur stock » (mig 733) ; canal par défaut « Vente directe » (mig 734) ; fuseau de la société (`businessTz()`, 45 occurrences) ; caisse : sachets avec Vitrine, expirés avec DLC ; production : colonnes DLC et « pesée » selon les capacités ; textes (« Client non renseigné », « décaissement », « Journées supplémentaires », aperçus de modèles neutres) ; palette neutre des PDF.
- Reste seulement : catégories de dépenses « Matériel POS & Caisse » / « Tickets restaurant » visibles partout (données de plan de charges, renommables par la société).

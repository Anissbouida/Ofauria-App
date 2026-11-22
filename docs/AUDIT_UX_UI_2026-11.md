# Audit UX/UI et harmonisation des interfaces — novembre 2026

Mission : un seul ERP, une seule identité visuelle, une seule logique de navigation, une seule
hiérarchie graphique. Ce document rassemble l'audit, l'inventaire des incohérences, le rapport de
migration et les anomalies restantes. Les règles elles-mêmes sont dans
[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

Maquettes validées le 2026-11-22 (module Achats, 10 planches) : liste standard, tableau de bord,
fiche, tableau dense avec sélection, formulaire, fondations, demandes d'achat, demande de prix,
approbations, réception.

## 1. Audit de l'existant

### 1.1 Socle technique

- React + TypeScript, Tailwind pour la base, puis des feuilles de style par génération d'écrans.
- 349 fichiers d'écran (`.tsx`), 14 feuilles de style, 18 familles de classes (`kl-`, `odoo-`,
  `prj-`, `sal-`, `pur-`, `ord-`, `bsi-`, `plan-`…) empilées au fil des refontes.
- Trois refontes successives coexistent : « odoo » (tableaux, boutons), « prj/sal » (gabarit Liste
  des Projets puis des Ventes) et « Apple » (cartes, grands titres), cette dernière généralisée à
  tous les modules le 2026-11-19.

L'identité est donc déjà commune (thème, police, cartes, menu latéral par rubriques fixes). Les
écarts viennent de la façon dont chaque écran assemble ses blocs, et des variantes locales.

### 1.2 Constats par thème

| Thème | Constat | Mesure avant |
|---|---|---|
| Styles en ligne | présentation décidée écran par écran, impossible à faire évoluer d'un seul endroit | 11 182 `style={{…}}` |
| Couleurs | couleurs de sens écrites en dur, avec plusieurs rouges et plusieurs verts pour le même sens | 1 053 codes hexadécimaux ; 6 rouges (`#DC3545`, `#C62828`, `#B71C1C`, `#DC2626`…), 3 verts |
| Titres | en-têtes en capitales dans une partie des écrans, en minuscules dans l'autre | 127 occurrences de capitales forcées |
| Fil d'Ariane | deux niveaux (« Module / Page ») sur les pages à barre propre, trois sur les autres ; séparateur « / » ou « › » | 32 fichiers avec « / » |
| Action principale | en haut à droite, dans la barre d'outils, ou absente selon l'écran ; libellés abrégés (« Nouveau BC ») | — |
| Ordre des blocs | barre d'outils avant ou après les étapes ; bascules de vue à trois emplacements | — |
| Indicateurs | trois composants de tuile (`ListKpi`, `Kpi`, tuiles locales), valeur colorée ou non, 3 à 6 par ligne | — |
| Étapes | pastilles numérotées, à icône ou nues ; étape active pleine ou en contour | — |
| Tableaux | 479 tableaux, tous sur la même classe mais avec en-têtes, alignements et unités décidés localement ; unité répétée dans chaque cellule | 479 `<table>` |
| Actions de ligne | jusqu'à 10 boutons icônes par ligne (factures reçues), sans libellé | 237 boutons icônes de ligne |
| Statuts | deux systèmes d'étiquettes | 342 `StatusTag`, 658 `odoo-tag` (catégories comprises) |
| États | chargement et liste vide refaits à la main, trois présentations de l'état vide | 417 indicateurs de chargement faits à la main |
| Confirmations | confirmation du navigateur encore utilisée à côté de la fenêtre commune | 17 `window.confirm` explicites (5 après migration) |
| Formulaires | libellés en style local, obligatoire signalé par « * » dans le texte, erreurs en notification plutôt que sous le champ | — |
| Vue par défaut | Colonnes sur grand écran, Liste sinon ; libellé « Liste » | — |

### 1.3 Constats par module (écrans observés)

- **Achats** : module le plus avancé (poste de travail, circuit, chaîne des pièces). Écarts :
  circuit en 5 + 3 cases, indicateurs en 3 + 1, action principale dans la barre d'outils (Frais
  d'approche), tableau Fournisseurs débordant (colonne d'action coupée), trois états vides, tuiles
  propres aux Demandes d'achat, comparateur de devis en grille hors tableau.
- **Ventes** : gabarit Liste propre, mais fil d'Ariane à deux niveaux, pastilles après la barre
  d'outils, vue Colonnes par défaut.
- **Stock** : fil d'Ariane à trois niveaux, barre d'outils sur deux lignes, pastilles après la
  barre, bascule « Liste / Kanban ».
- **Production** : fil d'Ariane à deux niveaux, plusieurs icônes d'action par ligne dans les plans.
- **Personnel** : tuiles d'indicateur d'un style propre, en 5 + 1 ; filtre « Année » isolé.
- **Comptabilité** : pilotage avec tuiles locales et liste d'échéances hors tableau standard.

## 2. Inventaire des incohérences et décision retenue

| # | Incohérence | Règle commune (Design System) |
|---|---|---|
| 1 | Fil d'Ariane à 2 ou 3 niveaux, séparateurs différents | toujours « Module › Rubrique › Page » |
| 2 | Titre sans description, ou description en bandeau | titre + une ligne de description |
| 3 | Action principale à des endroits différents | une seule, en haut à droite, libellé complet |
| 4 | Ordre des blocs variable | indicateurs → étapes → barre d'outils → tableau |
| 5 | Trois composants de tuile | `KpiCard` ; la valeur reste neutre, le commentaire porte la couleur |
| 6 | Pastilles numérotées ou non | pastilles sans numéro, étape active en contour d'accent |
| 7 | Recherche grise ou blanche, largeur variable | champ bordé de 320 px, à gauche de la barre d'outils |
| 8 | Bascules de vue à plusieurs endroits | à droite de la barre : période, puis affichage |
| 9 | Vue par défaut variable | Tableau par défaut ; « Tableau / Colonnes / Kanban » |
| 10 | Unité dans chaque cellule | unité dans l'en-tête de colonne |
| 11 | Nombreuses icônes par ligne | une action visible, le reste dans le menu de ligne |
| 12 | États vides et chargements multiples | `EmptyState`, `NoResultState`, `LoadingState`, `ErrorState` |
| 13 | Couleurs de sens en dur | jetons `--ds-success`, `--ds-warning`, `--ds-danger`, `--ds-info` |
| 14 | Champs et pieds de formulaire variables | `FormField`, `FormSection`, `FormFooter` |
| 15 | Densité unique | 48 px en standard, 36 px en dense (comptabilité, paie) |

## 3. Rapport de migration

### 3.1 Socle

| Élément | Fichier |
|---|---|
| Jetons et règles communes | `client/src/styles/design-system.css` |
| Composants | `client/src/components/ds/index.tsx` : `Breadcrumb`, `PageHeader`, `SectionHeader`, `KpiGrid`, `KpiCard`, `Toolbar`, `SearchBar`, `Segmented`, `Tabs`, `DataPanel`, `BulkBar`, `TableFooter`, `EmptyState`, `NoResultState`, `LoadingState`, `ErrorState`, `Alert`, `FormField`, `FormSection`, `FormFooter` |
| Activation | classe `kl-ds` sur la zone de contenu (`AppLayout`), sauf la caisse |
| Fil d'Ariane à trois niveaux | `ModuleShell` (contexte `ModuleCrumbContext`) et `SalesPageShell` |
| Briques existantes rebranchées | `ListKpi`, `Kpi`, `ListEmpty`, `NextStep`, `StagePipeline`, `LayoutSwitch`, briques de module (`StockUi`, `KlUi`, `employees/ui`, `boutique/shared`) |

Composants déjà en place et conservés : `StatusTag` (StatusBadge), `RowMenu`, `ConfirmDialog`,
`SearchSelect` (Select), `DateRangePicker`, `ModalBackdrop`, `notify` (Toast), `StatusBanner`.

### 3.2 Écrans migrés, par module

| Module | Écrans | État |
|---|---|---|
| Achats | Poste de travail, À commander, Demandes d'achat, Demandes de prix (liste, fiche, comparatif), Approbations, Bons de commande (liste, fiche, réception), Réceptions, Factures reçues et leurs fenêtres, Frais d'approche, Écarts de prix, Rapprochement, Évaluation, Fournisseurs (liste et fiche) | gabarit complet, contrôlé à l'écran |
| Ventes | Commandes, Devis, Bons de livraison, Factures émises, Créances, Clients, Tickets, Retours, Sessions, Pipeline, Promotions, Relances, Contrats, Ristournes, Objectifs, Tournées, Abonnements, Listes de prix, Canaux | listes au gabarit ; formulaires non repris |
| Stock | Réserve, Poste de pesée, Bons de sortie, Consommables, Inventaires, Lots surgelables, Emplacements, registres et rapports, fiche ingrédient, Demandes boutique | gabarit complet ; écrans d'atelier alignés sans changer le déroulé |
| Production | Plans, Tableau de bord, Atelier, Prévisions, Plan directeur, HACCP, Désassemblage, Fiches techniques, Postes & gammes, Paramétrage, Produits | listes au gabarit ; fiche plan et panneaux d'exécution alignés en surface |
| Personnel | Pilotage, Mon espace, Pointage, Planning, Congés, Avances, Paie (3 rythmes), Déclarations, Commissions, Employés, fiche employé, Utilisateurs et rôles | gabarit complet |
| Comptabilité | 31 écrans (Pilotage, Caisse, Charges, Chèques, Effets, Créances & dettes, Banque, Journal, Lettrage, Immobilisations, Clôture, états et déclarations) | gabarit complet en variante dense ; fenêtres de saisie non reprises |
| Autres | Accueil, Contrôle & qualité, Journée boutique, Maintenance, Projets, Portail client, Connexion ; Paramètres et Contrôle des ventes en surface | voir anomalies |

### 3.3 Mesures avant / après (fichiers d'écran)

| Indicateur | Avant | Après |
|---|---|---|
| Styles en ligne | 11 182 | 7 289 |
| Couleurs écrites en dur | 1 053 | 201 |
| Capitales forcées | 127 | 33 |
| Boutons icônes de ligne | 237 | 104 |
| Indicateurs de chargement faits à la main | 417 | 235 |
| Tableaux dans le panneau standard | 0 | 199 sur 477 |
| Tuiles d'indicateur communes | 0 | 189 |
| États communs (vide, chargement, erreur) | 0 | 542 |
| Menus de ligne | — | 70 |
| Champs de formulaire communs | 0 | 150 |
| Colonnes numériques normalisées | 0 | 1 753 |

Étendue : 291 fichiers modifiés, 13 161 lignes ajoutées, 14 482 retirées.

## 4. Tests

- Types : `npx tsc -b` sans erreur.
- Tests unitaires du client : 74 sur 74.
- Build de production : réussi.
- Contrôle à l'écran (compte gérant, base de développement) : les dix rubriques Achats, puis
  l'écran d'entrée de Ventes (Commandes, Clients), Stock, Production (Plans, Fiches techniques),
  Personnel (Pilotage, Paie), Comptabilité (Pilotage), Contrôle, Journée boutique, Projets,
  Maintenance, Utilisateurs, Accueil ; largeur tablette sur les Bons de commande.
- Non contrôlé à l'écran : les fenêtres et formulaires, les fiches de détail, les sous-écrans
  au-delà de l'écran d'entrée de chaque module, les Paramètres (compte gérant sans accès,
  administrateur sous double authentification), la caisse (non modifiée).
- Non rejoué : les scénarios quotidiens des agents métier. Ils doivent être relancés sur cette
  version avant mise en production (voir § 6).

## 5. Changements de comportement visibles

Aucune règle métier, aucun appel d'API, aucun droit ni calcul n'a été modifié. Les gestes
suivants changent :

- Vue « Tableau » par défaut sur les listes (avant : « Colonnes » sur grand écran).
- Actions de ligne : une action visible, les autres dans le menu « ⋯ » (PDF, modifier, supprimer,
  annuler, litige, etc.). Les boutons de ligne sont secondaires ; le retard se lit dans le statut.
- Actions principales et exports déplacés en haut à droite de la page.
- Demandes d'achat : sélection globale ; « Demander des prix » envoie toutes les demandes cochées
  dans une seule demande de prix.
- Demande de prix : devis retenu par bouton radio, puis un seul bouton d'attribution.
- Approbations : lignes de tableau dépliables au lieu de cartes ; seule la première est dépliée.
- Paie : un bouton « Payer » + menu « Payer par virement » au lieu de deux boutons.
- Confirmations ajoutées là où l'action partait au premier clic (suppression de pièce jointe,
  d'une gamme, d'une saisie de temps, annulation d'une demande boutique, retrait d'une
  délégation…), et confirmations du navigateur remplacées par la fenêtre commune.
- Dates « 21 nov. 2026 », montants sans devise dans les cellules (devise dans l'en-tête).
- Mini-barres d'avancement et points de couleur remplacés par une étiquette de statut.

## 6. Anomalies restantes

| # | Anomalie | Portée |
|---|---|---|
| 1 | Formulaires non convertis aux champs communs : commande, devis, client, facture manuelle, opportunité, promotion (Ventes) ; dépense, règlement, chèque, immobilisation (Comptabilité) ; import, ajustement de stock ; formulaire produit, nomenclature | à faire |
| 2 | 278 tableaux hors panneau standard (fenêtres, fiches, Paramètres, Contrôle des ventes, panneaux d'exécution de production) | à faire |
| 3 | Réception et comparatif de devis restent dans leur conteneur (fiche du BC, tiroir) au lieu d'une page dédiée comme sur les maquettes | décision à prendre : touche au déroulé |
| 4 | Emplacement d'actions d'en-tête dupliqué par module (`PurHeaderSlot`, `StockHeaderSlot`, `HrHeaderSlot`, `AccHeaderActions`) ; à remonter dans `ModuleShell` | dette technique |
| 5 | Composants manquants : fenêtre/tiroir commun (Modal, Drawer), champ de période, dialogue de saisie de motif (6 `prompt` du navigateur subsistent), étiquette de catégorie (les `odoo-tag` non-statut), carte de saisie d'atelier | à créer |
| 6 | Couleurs en dur restantes (201) : palettes catégorielles (shifts, types de commande), documents imprimés, rapport Coûts | à traiter |
| 7 | En-têtes de colonne triables non atteignables au clavier | accessibilité |
| 8 | L'état d'erreur dit « Vérifiez la connexion » aussi quand l'accès est refusé (écran Utilisateurs avec un compte sans droit) | message à préciser |
| 9 | Vues Colonnes et Kanban : fiche de droite avec 5 à 6 boutons, pagination locale | à aligner |
| 10 | Code mort repéré : `RecallPage`, `RuptureRequestsList`, `LowStockOrderList`, `DashboardPage` (branchés nulle part) | à supprimer après confirmation |
| 11 | Paramètres : alignés en surface seulement et non contrôlés à l'écran | à vérifier avec un compte administrateur |
| 12 | Scénarios des agents métier non rejoués sur cette version | à faire avant mise en production |

## 7. Évaluation de la cohérence

| Critère d'acceptation | État |
|---|---|
| Tous les modules utilisent le Design System | oui pour le socle (jetons, barres, pastilles, tuiles, tableaux de liste) ; partiel pour les fenêtres et formulaires |
| Tous les tableaux s'appuient sur le composant standard | 199 sur 477 ; les listes principales sont faites |
| Formulaires cohérents | Achats, Stock, Personnel, Maintenance : oui ; Ventes, Comptabilité, Production : en partie |
| Titres sur la même hiérarchie | oui |
| Boutons et actions sur les mêmes conventions | oui sur les listes ; fiches de détail en partie |
| Couleurs et typographies harmonisées | oui, hors palettes catégorielles |
| Navigation structurée et prévisible | oui (fil d'Ariane à trois niveaux, rubriques fixes) |
| Écrans adaptés au métier | écrans d'atelier et de caisse conservés |
| Aucune fonctionnalité perdue | aucune suppression volontaire ; à confirmer par les scénarios |
| Scénarios des agents fonctionnels | non rejoués |

## 8. Deuxième passe — correction des anomalies (2026-11-22)

### 8.1 Corrigé

| # (§ 6) | Anomalie | Correction |
|---|---|---|
| 1 | Formulaires non convertis | Ventes (commande, devis, client, facture manuelle, opportunité, promotion, contrat-cadre, ristourne, pipeline et ~20 autres), Comptabilité (toutes les fenêtres de saisie), Production (produit, plan, gammes, import, remplacement, lancement), Stock, Contrôle, Personnel, Paramètres, Contrôle des ventes : `Modal` + `FormSection` + `FormField` + `FormFooter`, erreurs sous le champ, anti double envoi |
| 2 | Tableaux hors panneau standard | 412 tableaux sur 499 dans `DataPanel` (contre 199). Les 87 restants sont pour l'essentiel dans des cartes `ds-panel` qui reçoivent le même style (fiche plan, panneaux d'exécution, fiches commande et client) ou des grilles de saisie (Contrôle des ventes) |
| 3 | Réception et comparatif hors page | Réception d'un BC en page dédiée (`?tab=reception&po=…`), demande de prix et comparatif en page dédiée (`?tab=rfq&rfq=…`), conformes aux maquettes ; tous les boutons « Réceptionner » y mènent |
| 4 | Emplacements d'actions dupliqués | Un seul composant `HeaderActions` / `HeaderSlotContext` ; les quatre anciens noms sont des alias |
| 5 | Composants manquants | `Modal`, `Drawer` (fermeture protégée si saisie en cours, Échap sur la fenêtre du dessus seulement), `DateRangeField`, `MonthYearField`, `usePrompt` (saisie de motif), `RowMenu trigger` (bouton à menu), `FormSection collapsible`, `FormFooter danger`, `id` sur `SearchSelect` et `CategoryCascadeSelector` |
| — | Boîtes natives du navigateur | Aucune hors caisse (10 remplacées : renvoi HACCP, budget, annulation de pipeline, ouverture et clôture d'un rappel, type et abandon de BC, conversion en consommable, sortie de nomenclature, détachement de format) |
| 8 | « Vérifiez la connexion » sur un refus d'accès | `ErrorState error={error}` : « Accès refusé » (401/403), « Le serveur a rencontré une erreur » (5xx), sinon problème de connexion ; branché sur toutes les listes principales |
| 9 | Fiches de la vue Colonnes | Une action visible + menu (factures reçues, BC) |
| 11 | Paramètres en surface | Tous les onglets : `DataPanel`, `FormField`, `Modal`, jetons ; structure (groupes, tuiles, onglets, Modifié/Rétablir, ⌘K) conservée |

### 8.2 Mesures (hors caisse)

| Indicateur | Avant mission | Après 1ʳᵉ passe | Après 2ᵉ passe |
|---|---|---|---|
| Tableaux dans le panneau standard | 0 | 199 | 412 sur 499 |
| Fenêtres faites à la main | ~180 | ~170 | 3 (palette ⌘K, caméra photo plein écran, verrou de session) |
| Boîtes natives du navigateur | 178 | 10 | 0 |
| Couleurs écrites en dur | 1 053 | 201 | 146 |
| Styles en ligne | 11 182 | 7 289 | 6 030 |

### 8.3 Changements de comportement visibles (2ᵉ passe)

- Réception et demande de prix : pages, avec bouton Précédent et adresse propre.
- Fenêtres : Échap et clic extérieur ferment ; si un champ a été modifié, une confirmation est demandée ; bloqué pendant un envoi.
- Plusieurs créations auparavant en bloc dans la page s'ouvrent en fenêtre (adresse et exonération client, contrat-cadre, retour pro, transfert, niveau de relance, ristourne) ; demande boutique et assistant de lancement de production passent du plein écran à une grande fenêtre.
- Réclamation, intervention et non-conformité s'ouvrent en tiroir latéral.
- Créances : tableau par client au lieu de cartes.
- Nouvelles confirmations : révoquer une clé d'API, supprimer un webhook, supprimer une gamme, une pièce jointe, une saisie de temps.
- « Ajuster le stock » : la liste « Motif de la perte » n'apparaît plus en double.

### 8.4 Restant

| Point | Raison |
|---|---|
| 87 tableaux hors `DataPanel` | dans des cartes `ds-panel` déjà stylées ou grilles de saisie ; conversion au cas par cas sans gain visible |
| Palette ⌘K, caméra photo, verrou de session | écrans plein écran spécifiques, volontairement hors `Modal` |
| 146 couleurs en dur | palettes catégorielles (shifts, types de commande, colonnes Report/Appro/Reçu), documents imprimés, couleurs venues du référentiel |
| En-têtes de colonne triables au clavier | non traité |
| Scénarios des agents métier | non rejoués sur cette version |
| Caisse | exclue de la mission |

## 9. Troisième passe — restes du § 8.4 (2026-11-22)

| Point | Correction |
|---|---|
| Tri au clavier | Les 41 en-têtes triables sont de vrais boutons (Tab, Entrée), `aria-sort` conservé ; composant commun `SortTh` pour les nouveaux écrans |
| Couleurs en dur | Palette catégorielle commune (`--ds-cat-*`, 8 teintes contrastées, `catTone()`) pour distinguer des familles ; couleurs d'état ramenées à un seul rouge, orange et vert : familles `--prj-*`, étiquettes `odoo-tag-*`, alertes, points de statut, bandeaux et boutons danger pointent sur les jetons. Restent volontairement : préréglages de thème, documents imprimés, étiquettes Niimbot, valeurs par défaut des sélecteurs de couleur |
| Tableaux | Les tableaux restants sont dans un `DataPanel`, en récapitulatif `ds-summary` (totaux, soldes) ou en sous-tableau `ds-nested` ; la seule exception est le tableau Attendu / Saisi / Écart des sessions de caisse, stylé par sa feuille Apple |
| Feuille commune | `design-system.css` chargée dès le démarrage (`main.tsx`) : les jetons existent sur tous les écrans, y compris la connexion |

### 9.1 Parcours de non-régression à l'écran (5173, compte gérant)

Parcours automatique de **140 écrans** : toutes les rubriques des modules à onglets (Achats 13,
Comptabilité 30, Stock 14, Personnel 9, Contrôle 7, Maintenance 3, Projets 6) et toutes les pages à
adresse propre (Ventes, Production, rapports, Journée boutique, administration, accueil). Pour
chacun : rendu non vide, fil d'Ariane, titre, erreurs d'exécution.

Résultat : **140 / 140 affichés, aucune page blanche, aucune erreur d'exécution** (les réponses
403 attendues pour un gérant, par exemple sur Utilisateurs, sont affichées « Accès refusé »).

Corrigé à la suite du parcours :
- actions d'en-tête collées au fil d'Ariane dans la Comptabilité → toujours poussées à droite ;
- fil d'Ariane à deux niveaux sur Tickets, Bons de livraison et tableau de bord Production → trois niveaux.

Ce parcours vérifie l'affichage ; il ne remplace pas les scénarios métier (saisies, validations
de bout en bout), qui restent à rejouer avant une mise en production.

## 10. Quatrième passe — derniers restes (2026-11-22)

| Point | Correction |
|---|---|
| Code mort (§ 6 n° 10) | Supprimés : `RecallPage`, `RuptureRequestsList`, `LowStockOrderList`, `DashboardPage` (aucun import, compilation propre) |
| Menu « Plus » de la fiche plan | Menu commun `RowMenu`, enrichi des séparateurs et des infobulles d'actions désactivées |
| Carte de saisie d'atelier | Composant commun `EntryCard` (grande cible tactile, contour rouge en alerte), appliqué au HACCP |
| Pagination des vues Colonnes et Kanban | Le composant historique `Pager` délègue au pied de tableau commun |
| Tableau des sessions de caisse | Aligné sur les jetons (en-tête, pied, couleurs) |
| Bandeau des échéances fournisseurs | Repliable (clic sur l'en-tête, choix retenu sur le poste) |
| Menu de ligne masqué | Les cellules d'actions des lignes suivantes passaient par-dessus le menu ouvert : corrigé |

### 10.1 Parcours métier rejoué sur 5173 (base de développement)

Réception d'un bon de commande de bout en bout, par la nouvelle page dédiée :
BC-2026-0531 (Laiterie du Gharb, 29 l de lait entier) → « Tout reçu » → n° de facture fournisseur
(champ devenu obligatoire car la réception solde le BC) → « Confirmer la réception ».
Résultat : notification « Réception confirmée — lots LI-261122-00824 », BC retiré des réceptions
attendues (4 → 3), réceptions du mois 67 → 68, facture fournisseur FAC-TEST-0531 créée en
brouillon dans Factures reçues avec son menu d'actions complet. Données de test laissées en base
(BC réceptionné, lot, facture brouillon).

### 10.2 Ce qui reste

| Point | Raison |
|---|---|
| Autres scénarios métier (vente, production, paie, comptabilité) | un seul parcours rejoué ; les autres restent à jouer avant mise en production |
| Caisse (`/pos`), palette ⌘K, caméra, verrou de session | exclus ou plein écran par conception |

### 10.3 Paramètres contrôlés à l'écran (administrateur)

Les 29 pages des Paramètres ont été parcourues sur 5173 avec le compte administrateur (double
authentification levée par l'utilisateur) : aucune erreur d'exécution, aucun appel en échec, aucun
débordement horizontal, aucun champ visible sans libellé.

| Constat | Correction |
|---|---|
| Groupes de paramètres numérotés (1, 2, 3…) dans Règles de caisse, Devis et crédit, Production, Achats, Règles comptables | numéros retirés (`ParametersPanel`), conformément à la règle « pas de numérotation » |
| Approbateurs numérotés « 1. 2. » à la création d'un circuit | flèches entre approbateurs, comme dans le tableau des circuits |
| Tâches planifiées : colonne Résultat écrasée sur 4 lignes | largeur minimale de colonne |
| Référentiel : libellés sans accents (« Categories de depenses », « Categories de revenus », « Categories de produits ») | données en base (migrations 058/059), hors périmètre UI : à corriger par une migration de données |

Restent volontairement hors jetons : l'aperçu du ticket de caisse (rendu papier noir sur blanc) et
les pastilles de couleur des canaux de vente (couleur choisie par l'utilisateur).

# Le secteur pilote-t-il vraiment Kalum ? — audit transversal et premier lot (25 novembre 2026)

Point de départ : une société « Bâtiment et travaux publics » qui crée une commande se voit proposer
« Client / Passager / Professionnel / Personnel (remise 10 %) ». Ces quatre cartes étaient écrites
dans l'écran. L'audit part de cet écran et couvre tous les modules.

Ce document complète `AUDIT_COUPLAGE_SECTORIEL.md` (9 novembre) et l'audit des référentiels
sectoriels (migrations 698 à 700). Il ne les remplace pas.

## 1. Verdict

La configuration sectorielle pilote réellement trois choses :

| Mécanisme | Portée réelle | Appliqué côté serveur ? |
|---|---|---|
| Modules activables | Tous les modules ; menus masqués | Oui pour 58 préfixes d'API ; environ 45 préfixes ne sont jamais fermés (voir § 3.1) |
| Listes de valeurs (référentiels, mig 698-700) | 35 tables : familles, unités, fonctions, équipements, étapes… | Oui : la base synchronise `is_active` à chaque changement de secteur |
| Capacités (`app_features`) | 25 clés, toutes en Production, Stock, Articles, Qualité | 6 gardes de route, 8 lectures métier |

Tout le reste est soit borné à la Production, soit inerte :

| Mécanisme | État |
|---|---|
| Vocabulaire | 26 termes, tous de fabrication. Aucun terme de Ventes, Achats, RH, Projets. Trois clés ne sont lues nulle part |
| Écrans configurables | 4 écrans, tous de Production ; masquage côté écran seulement |
| Niveau « secteur » du résolveur de configuration | Jamais passé par aucun appel : inerte |
| Couches du profil (types d'ordre, politiques, impressions) | Production et Stock seulement ; appliquées une fois, au chargement des données de départ |
| Champs personnalisés | 12 entités ; aucun champ déclaré par un profil ; 4 entités sans écran |
| Modèles de rôles | Aucun modèle pour 9 des 13 profils (dont BTP et services) |

Aucun test direct du secteur n'existe dans le code (`secteur === 'boulangerie'`). Le couplage
passe par trois autres voies : des **typologies à logique métier** écrites en dur, des **rôles
boulangers** utilisés comme règles, et des **données semées** pour toute société.

## 2. Ce qui est corrigé dans ce lot (migration 701)

### 2.1 Principe : le code lit un comportement, jamais un code

Les types de client et les types de commande deviennent deux référentiels du moteur existant
(mig 698 : commun / sectoriel / personnalisé, synchronisés par la base). Chaque valeur porte
ses **comportements** dans `metadata`. Le code ne compare plus `customer_type` à
`'particulier'` : il lit le comportement.

Pour qui vient d'Oracle : c'est une table de paramètres dont chaque ligne porte ses indicateurs,
lue par une fonction (`fn_customer_on_account`) au lieu d'un `DECODE` recopié dans 150 requêtes.

| Référentiel | Comportements | Ce qu'ils décident |
|---|---|---|
| `customer_types` | `settlement` (comptant / compte), `legal_entity`, `requires_tax_id`, `vat_exempt`, `personal_fields` | Parcours de commande, raison sociale sur les pièces, refus de facture sans identifiant fiscal, exonération proposée, champs anniversaire et allergies |
| `order_types` | `party` (client enregistré / de passage / salarié), `settlement`, `auto_discount`, `direction_only` | Étape « pour qui » du formulaire, clients proposés, remise d'office, qui peut prendre la commande |

Le schéma de ces comportements est déclaré une fois (`shared/src/constants/commercial-types.ts`)
et sert au serveur (contrôle de la saisie) comme à l'écran (formulaire du Référentiel).

### 2.2 Résultat par profil

| Profil | Types de commande | Types de client |
|---|---|---|
| Boulangerie, restauration, détail, santé | Client, Passager, Professionnel, Personnel (inchangé) | Particulier, Société, Association, Revendeur (+ santé : établissement, organisme payeur) |
| BTP | Commande de travaux, Commande liée à un marché | Maître d'ouvrage, Promoteur immobilier, Organisme public, Société, Particulier facturé |
| Industrie (et profils enfants) | Commande client | Société, Revendeur, Distributeur, Donneur d'ordre, Particulier facturé |
| Négoce | Commande client, Vente au comptoir | Société, Revendeur, Distributeur, Organisme public, Particulier |
| Services | Commande de prestation | Société, Association, Organisme public, Particulier facturé |
| Générique | Commande client | Particulier, Société |

Un administrateur ajoute, renomme, désactive ou règle un type dans Paramètres › Référentiel,
sans code. Créer « Commande en régie » est une ligne de données.

### 2.3 Changements de code

- **Base** : `customers_customer_type_check` (liste figée) remplacé par le contrôle commun sur le
  référentiel ; nouvelle colonne `orders.order_kind` ; fonctions `fn_customer_on_account` et
  `fn_customer_type_flag`. Une valeur portée par une fiche n'est jamais désactivée.
- **Serveur** : la création de commande valide le type, exige un client enregistré quand le type
  le demande, refuse un client qui ne correspond pas, applique la remise d'office et la
  réservation à la direction d'après les comportements. Promotions, devis, commande publique,
  facture (identifiant fiscal, personne morale), conversion d'un prospect et canal de vente ne
  comparent plus de code.
- **Règle de la vente au comptoir** (« la caisse ne voit ni ne prend les commandes des
  professionnels ») : ne s'applique plus que si la société a un type de commande réservé à la
  direction. En BTP, un commercial prend et voit ses commandes.
- **Écrans** : formulaire de commande (cartes du référentiel ; un seul type = pas d'étape de
  choix), page et fiche Clients, devis, factures, créances, tableau de bord des ventes, caisse,
  listes de prix. Nouvelle lecture ouverte `GET /params/commercial-types`.

### 2.4 Compatibilité

Une boulangerie retrouve exactement ses quatre types de commande et ses quatre types de client.
`orders.type` (custom / staff / online / event) n'est pas modifié. Un type absent du référentiel
garde la règle historique (tout sauf « particulier » est en compte). Une commande créée sans type
(ancien écran, API) suit l'ancienne règle.

### 2.5 Validation

- `types-commerciaux.db.test.ts` : 12 cas — schéma du catalogue, boulangerie à l'identique, BTP,
  **les 18 profils livrés** (chacun a un type de commande et des clients qui lui correspondent),
  aller-retour sans écart, valeur utilisée protégée, type créé par la société.
- Suite unitaire du serveur : 631 réussis. Tests de base Ventes, devis, promotions, clients,
  secteurs : réussis.
- À l'écran, sur une base de test : boulangerie (quatre cartes inchangées), puis BTP (deux
  cartes) ; création d'une commande de travaux pour un maître d'ouvrage ; refus d'un type
  désactivé.
- **Non contrôlé à l'écran** : le formulaire des comportements dans Paramètres › Référentiel
  (le compte de test n'a pas accès aux paramètres) ; sa partie serveur est testée.

## 3. Ce qui reste — par ordre de priorité

### 3.1 Sécurité et cohérence (à faire d'abord)

| # | Constat | Effet |
|---|---|---|
| S1 | Environ 45 préfixes d'API ne sont jamais fermés quand leur module est désactivé : tout le RH (`/employees`, `/payroll`, `/leaves`…), `/quotes`, `/promotions`, `/loyalty`, `/stock-counts`, `/cost-centers`… | Un module masqué reste accessible par l'API |
| S2 | Aucune garde de route par module côté écran | Une adresse saisie à la main affiche l'écran d'un module désactivé |
| S3 | `canCreate`, `canEdit`, `canDelete` ne tiennent pas compte du secteur | Boutons visibles pour un module inactif |

### 3.2 Typologies à logique métier encore en dur

| # | Typologie | Où | Ampleur |
|---|---|---|---|
| T1 | Unité de vente (pièce / poids / personne / carton) | Le référentiel existe (mig 634) mais un contrôle serveur et un CHECK le contredisent | ~47 branches (caisse, tarification, ticket) |
| T2 | Type de ticket (standard / avance / solde / spécial) | CHECK mig 150 | ~22 branches ; fige le modèle « avance en caisse, solde au retrait » |
| T3 | Modes de paiement en caisse | Le référentiel existe mais le serveur fige la liste | Un mode ajouté est refusé en caisse |
| T4 | Cycle de vente d'un article (jour / date limite / commande / stock) | Contrôle serveur + 2 CHECK | ~32 branches |
| T5 | Stock vitrine / réserve des produits finis | Colonnes dédiées, CHECK mig 439-440 | ~151 références |
| T6 | Invendus : destinations et moteur de suggestion, règle des 24 h | CHECK mig 244 | Module entier |
| T7 | Zones Économat / Pesage des bons de sortie | CHECK mig 113 | ~38 usages serveur |
| T8 | Pertes : type et familles | CHECK mig 068 | ~11 branches |
| T9 | Portée client des promotions (particulier / professionnel) | CHECK mig 372 | Le calcul lit désormais le comportement ; les libellés restent |
| T10 | Rythme de facturation (à la livraison / mensuel), canaux `gros` et `commande` écrits dans le SQL | CHECK mig 354 | Faible |
| T11 | « Date de retrait » unique, règle du report à 24 h | Aucun mode de livraison en base | Vocabulaire et règle chiffrée |
| T12 | Projets : pas de situation de travaux ni de facturation à l'avancement | `billing_type` figé | Le profil BTP les annonce |

La méthode de ce lot s'applique à T1, T2, T3, T4, T8 et T10 : valeur de référentiel +
comportements + fonction de lecture. T5, T6 et T7 sont des modèles de données ; ils relèvent
d'une capacité qui masque la fonction hors métiers de bouche (la capacité `vitrine` existe déjà
mais n'est lue qu'à 5 endroits).

### 3.3 Capacités déclarées mais jamais lues

11 des 17 capacités de la migration 632 ne sont testées nulle part : `lots`, `dlc_ddm`,
`allergenes`, `rappel`, `quarantaine`, `releves_temperature`, `rendements_pertes`, `semi_finis`,
`coproduits`, `conditionnement`, `etiquetage`. Les écrans correspondants s'affichent donc quel que
soit le réglage. À l'inverse, le code teste des clés boulangères (`mode_fournee`, `vitrine`,
`dlc_jour`) ; `mode_fournee` sert de fait à répondre à « est-ce une boulangerie ? ».

Aucune capacité n'existe pour Ventes, Caisse, Achats, RH, Comptabilité, Projets, CRM,
Maintenance. Fonctions de boulangerie non conditionnées dans la caisse : sachets, clôture
« passation / fin de journée », produits expirés en vitrine, vente « par personne ».

### 3.4 Rôles

- `BASE_ROLES` écrit dans l'API (`role.controller.ts`) alors que la base a été assouplie.
- Notifications adressées en dur au rôle `magasinier` (8 endroits) ; redirection des rôles
  `cashier` et `saleswoman` vers la caisse, quel que soit le secteur.
- Plus de 100 tests `role === 'admin'` ou `'manager'` : c'est la notion de « direction », à
  remplacer par un droit.
- Droits par défaut citant les rôles boulangers sur 84 clés.

### 3.5 Vocabulaire, écrans, documents, rapports

- Vocabulaire à étendre aux Ventes (« retrait », « ticket », « vitrine », « boutique »), aux
  menus et aux descriptions de modules ; ~60 lignes de Stock écrivent « Pesage » et « Économat »
  en dur malgré les clés existantes.
- Catalogue d'écrans à étendre hors Production (colonnes et sections des listes de Ventes,
  Achats, Clients).
- Documents commerciaux et RH : titres en dur, charte « marron Ofauria » ; gabarits configurables
  limités à 4 documents de production.
- Générateur de rapports : 6 sources figées, non filtrées par module ; cibles « coût matière » et
  « prime cost » en dur ; « Menu Engineering ».
- 56 des 57 notifications ont un titre littéral.

### 3.6 Données semées pour tous

Catégories, recettes et produits de boulangerie joués par les migrations pour toute société ;
sous-titre « Boulangerie - Patisserie » et thème brun par défaut, visibles sur la page de
connexion ; données de départ aiguillées par code de secteur dans le code
(`sector-starter.service.ts`).

## 4. Ordre proposé

1. **S1 à S3** — fermer les modules désactivés partout (API et écran).
2. **T1, T3, T2** — caisse : unité de vente, modes de paiement, type de ticket.
3. **Capacités** — brancher les 11 capacités non lues ; créer celles de la caisse.
4. **Vocabulaire et menus** des Ventes et du Stock.
5. **Rôles** — droit « direction », destinataires des notifications, rôles de base.
6. **Documents et rapports** configurables.
7. **T12** — situations de travaux (fonction nouvelle, pas une configuration).

Le critère « créer un profil sans toucher au code » est tenu aujourd'hui pour les modules, les
listes de valeurs, les types de client et de commande. Il ne l'est pas pour les typologies du
§ 3.2, les rôles et les documents.

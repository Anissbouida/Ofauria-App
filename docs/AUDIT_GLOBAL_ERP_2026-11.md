# Audit global Kalum face aux grands ERP — 2026-11-15

Périmètre : tout le système, `main` @ 620dc67 (235 000 lignes TS/TSX, 517 migrations, 340 tables, 780 routes).
Référentiels : SAP S/4HANA, Oracle Fusion, Dynamics 365, Odoo, Sage Paie Maroc, Workday.

**Méthode.** Six analyses en lecture seule (Finance, Ventes/CRM/Caisse, Achats/Stock, Production/Qualité/Maintenance, RH/Paie/Projets, socle technique). Chacune a relu les audits existants, vérifié dans le code ce qui a changé, puis comparé à une liste de capacités standard.

**Limites.**
- « Absent » signifie « aucune trace trouvée par recherche », pas une preuve formelle.
- Rien n'a été exécuté. La production n'a pas été consultée ; les chiffres de données viennent de la base locale.
- Les pourcentages portent sur des listes de capacités différentes par domaine : ils se comparent dans le temps, pas entre domaines.
- Les constats marqués ✔ ont été relus une seconde fois dans le code. Les autres reposent sur une seule lecture.

---

## 1. Verdict

Kalum a la **largeur fonctionnelle d'un ERP de milieu de gamme** (niveau Odoo / Sage 100 sur la plupart des flux) et la dépasse sur trois points : comptabilité marocaine (inaltérabilité, liasse, EDI, FEC), paie marocaine, et flux matière agroalimentaire (lots, FEFO, pesage, CCP, rappel).

L'écart avec le premier rang n'est plus dans les modules. Il est dans quatre endroits :

1. **Le socle** : pas de multi-société ni de multi-tenant, fichiers sur disque éphémère, pas de MFA, pas de sauvegarde documentée, pas de staging.
2. **Des contrôles livrés mais éteints** : séparation des tâches en avertissement, cloisonnement par établissement désactivé, MRP achats désactivé, drapeaux de production sans effet.
3. **Des traitements périodiques non planifiés** : dotations, charges constatées d'avance, expiration des lots, alertes DLC, échéances RH dépendent d'un clic.
4. **Les données maîtres** : poids cuit, allergènes, étapes et doublons d'ingrédients rendent inopérants des calculs pourtant codés.

### Couverture par domaine

| Domaine | Base | Complet | Partiel | Absent |
|---|---|---|---|---|
| Finance | 49 capacités | 59 % | 25 % | 16 % |
| RH / Paie | 43 | 53 % | 19 % | 28 % |
| Stock | 35 | 43 % | 34 % | 23 % |
| Ventes / CRM / Caisse | 450 (benchmark du 09/11, recalé par estimation) | ~40 % | ~34 % | ~26 % |
| Production / Qualité / Maintenance | 42 | 33 % | 43 % | 24 % |
| Projets | 12 | 33 % | 33 % | 33 % |
| Socle technique | 64 | 27 % | 37 % | 36 % |

Achats : sur les 11 restes de l'audit du 30/10, 4 sont clos, 1 partiel, 6 ouverts. Le benchmark de 127 capacités n'a pas été recompté.

### Documents périmés

Ces documents annoncent des restes qui sont livrés depuis. À mettre à jour ou à marquer « historique » :
`docs/audit-ventes/`, `AUDIT_O2C_GAP_ANALYSIS.md`, `AUDIT_POS.md`, `AUDIT_P2P_GAP_ANALYSIS.md` (annonce L3-L6 restants, ils sont commités), `ARCHITECTURE_LABO_DDD_VS_KALUM.md` (dit « rien construit », les migrations 422-432 existent).

---

## 2. Priorité 0 — à corriger avant toute nouvelle fonction

Défauts de l'existant qui exposent à une perte d'argent, de données ou à un risque légal.

### Sécurité et données

| # | Constat | Où |
|---|---|---|
| 1 ✔ | L'API publique de commande accepte le prix unitaire envoyé par l'appelant (négatif possible), sans validation, sans clé d'idempotence, TVA à 0. Aucun limiteur de débit sur `/public` et `/portal`. | `server/src/services/public-order.service.ts:66`, `server/src/app.ts:125-127` |
| 2 ✔ | Factures fournisseurs et photos écrites sur le disque de Cloud Run : perdues à chaque révision, et servies sans authentification. | `multer.diskStorage` dans `accounting.routes.ts:40`, `products.routes.ts:20`, `upload.routes.ts:12,48` ; `app.ts:168` |
| 3 ✔ | Le déploiement part sur chaque push `main` sans attendre la CI. Pas de staging. Sauvegarde et restauration non documentées. | `.github/workflows/deploy.yml:3-6` |
| 4 ✔ | Pas de MFA. PIN à 4 chiffres vérifié par boucle bcrypt sur tous les utilisateurs. La politique de mot de passe existe pour les nouveaux comptes et les réinitialisations (12 caractères, 4 classes) mais les anciens comptes à mot de passe court ne sont jamais forcés à le changer. *(Corrigé le 2026-11-15 : la première version de ce constat disait à tort qu'aucune politique n'existait.)* | `auth.validator.ts:5-17`, `user.repository.ts:48-57` |
| 5 | Création et modification de facture sans validation d'entrée. Plus largement : 61 mutations sur 420 passent par `validate()`. | `accounting.routes.ts:122-123` |
| 6 | Reliquats de `AUDIT_SECURITE.md` non corrigés : V2, V4, V7 (conteneur root), V9 (`.svg`), V11-V13 ; `xlsx 0.18.5` sur des fichiers téléversés. | `Dockerfile`, `upload.routes.ts:21` |

### Paie (risque légal ou bulletin faux)

| # | Constat | Où |
|---|---|---|
| 7 ✔ | Ré-enregistrer le planning repasse en « attendu » tout pointage sans heure d'arrivée ; ces lignes sont exclues de la paie. | `employee.repository.ts:548`, `payroll-config.repository.ts:279` |
| 8 | Rien n'empêche de générer la paie d'un mois non terminé : bulletin amputé et payable. | `employees.validator.ts:152-155` |
| 9 | Pas de contrôle du SMIG. Pas de livre de paie (obligation légale). | aucune trace |
| 10 | Le barème IR se modifie en place : une nouvelle loi de finances écrase la version courante au lieu d'en créer une datée. | `PUT /tax-scales/:id` |
| 11 | Le paiement d'un bulletin enchaîne trois opérations sans transaction unique, dupliqué dans les trois fréquences. | `employee.repository.ts:919-1052`, `weekly-payroll.repository.ts:244`, `biweekly-payroll.repository.ts:210` |

### Finance et stock

| # | Constat | Où |
|---|---|---|
| 12 ✔ | Amortissement dégressif : la première annuité est entière, étalée sur les mois restants de l'année, sans prorata. Aucun test sur le calcul du plan. | `depreciation.service.ts:94-126` |
| 13 ✔ | TVA collectée déclarée à la date d'écriture (facturation). Le régime « encaissement » existe comme paramètre mais reste informatif. À arbitrer avec l'expert-comptable pour les ventes à crédit. | `ledger.repository.ts:841-866`, `migrations/485*.sql:27-32` |
| 14 | TVA déductible non filtrée par établissement alors que la collectée l'est. | `ledger.repository.ts:873-889` |
| 15 | Sorties de stock écrêtées à zéro en silence : une sortie supérieure au stock disparaît sans trace. | `production.repository.ts:1124,1565`, `product-stock.helper.ts:35`, `product-lot.repository.ts:736,946` |
| 16 ✔ | Remise manuelle en caisse bornée au sous-total seulement, sans plafond par rôle (le plafond existe pour devis et commandes). | `sale.controller.ts:177-183` vs `order.controller.ts:83` |
| 17 ✔ | Compteur d'utilisation des promotions : contrôle puis incrément séparés, sans verrou. | `services/promotions.ts:49` et `:211` |
| 18 ✔ | File hors ligne de la caisse : s'arrête à la première erreur quelle qu'elle soit. Une vente refusée au rejeu bloque toutes les suivantes. | `client/src/features/pos/offlineQueue.ts:41-43` |

### Production (apport de l'audit « Production paramétrable », voir section 8)

| # | Constat | Où |
|---|---|---|
| 19 ✔ | Emballages consommés deux fois quand la production est déclarée par `produceItems` : deux blocs identiques se suivent. Le second n'a pas de point de sauvegarde : une erreur de stock y invalide toute la transaction. | `production.repository.ts:1588-1615` puis `:1617-1646` |
| 20 | Loyer, énergie et autres charges saisis mais non lus par le calcul du coût réel ; le tableau de bord exclut l'énergie, le calcul du plan l'inclut. | constat de l'audit Production, non relu |
| 21 | Observations et quantités de bases saisies au lancement jamais envoyées au serveur ; pertes créées par des appels séparés, hors transaction. | constat de l'audit Production, non relu |
| 22 | Numéro de lot de repli et numéro de bon imprimé fabriqués dans le navigateur. | constat de l'audit Production, non relu |
| 23 | `fn_unit_conv` renvoie 1 pour toute unité hors masse / volume, sans erreur. Sans effet en boulangerie, faux en silence dès qu'un article se compte en mètres ou en pièces. | constat de l'audit Production, non relu |

### Données maîtres (base locale)

- Poids cuit renseigné sur 0 format sur 49 ; allergènes sur 0 ingrédient sur 405 ; étapes sur 14 fiches actives sur 52.
- Doublons : trois « Beurre », deux « Sucre semoule » à des prix différents.
- Conséquence : rendement, coût au gramme et étiquetage tournent à vide.

---

## 3. Contrôles livrés mais éteints

Le code existe ; il manque la décision de bascule et une date pivot.

| Contrôle | État actuel | Où |
|---|---|---|
| Séparation des tâches (achats) | mode avertissement | `migrations/442_sod_document.sql:61` |
| Cloisonnement par établissement (RLS) | drapeau éteint, compta seulement | `feature-flags.ts:62` |
| Suggestions d'achat (MRP) | tâche désactivée | mig 464 |
| Écritures de réévaluation et de frais d'approche | différées | `landed-cost.repository.ts:236` |
| Drapeaux de production (rendement, coût, étapes, frigo, calcul inverse) | enregistrés, lus nulle part | `settings.repository.ts:82-87` |
| Garde des modules | modes off / log / enforce | `module-guard.middleware.ts` |

## 4. Traitements périodiques à planifier

Le planificateur (`scheduler.ts:245-260`) tourne déjà 15 tâches. Il manque :

- dotations aux amortissements, charges constatées d'avance, abonnements d'écritures ;
- expiration des lots de produits finis (`markExpiredLots` n'est appelé nulle part ✔) et alertes DLC ;
- échéances RH (CIN, visite médicale, fin de CDD) ;
- envoi planifié de rapports.

---

## 5. Ce qui manque, par domaine

### Socle (bloque un deuxième client)

| Priorité | Manque |
|---|---|
| P0 | Multi-société et multi-tenant : société unique `company_settings WHERE id = 1`, aucune colonne de tenant |
| P0 | Stockage objet des fichiers, avec accès authentifié |
| P0 | Rôles réellement configurables : 610 `authorize(rôles en dur)` dans les routes |
| P0 | MFA, SSO, changement forcé des anciens mots de passe faibles |
| P1 | Observabilité : ni traces, ni métriques, ni alertes ; `/health` ne teste pas la base |
| P1 | Internationalisation : aucune couche de traduction, 971 « DH/MAD » en dur côté client, Maroc en dur côté fiscal |
| P1 | Piste d'audit générique (33 tables sur 340 aujourd'hui) |
| P1 | API : 3 routes publiques, 1 événement webhook, pas d'OpenAPI |
| P2 | Vues et filtres enregistrés, fil d'activité sur les fiches, pièces jointes génériques |
| P2 | Tests client (0) et e2e navigateur (0) ; lint ; `npm audit` en CI |
| P2 | Droits par champ, signature électronique, SMS / WhatsApp, PWA |

### Finance

| Priorité | Manque |
|---|---|
| P0 | Paiements fournisseurs en lot (fichier de virement ; n'existe que pour les salaires) |
| P0 | Rapprochement bancaire par règles (aujourd'hui : montant exact ± 7 jours) |
| P1 | Prévision de trésorerie avec solde projeté |
| P1 | Provisions générales avec reprises |
| P1 | Approbation et pièces jointes des écritures manuelles |
| P2 | Verrou de période par journal ; inventaire des immobilisations ; amortissement dérogatoire et par composants ; ratios ; consolidation multi-sociétés |

### Ventes / CRM / Caisse

| Priorité | Manque |
|---|---|
| P0 | Caisse hors ligne réelle (catalogue en cache, service worker, écran de traitement des rejets) |
| P1 | Envoi de factures, devis et BL par e-mail (seuls relances et demandes de prix partent aujourd'hui) |
| P1 | Portail client actif (commande, paiement) ; aujourd'hui lecture seule, jeton sans expiration |
| P1 | Variantes, options, kits / menus |
| P1 | Cartes et bons cadeaux, avoir en compte ; échéancier client |
| P1 | Balance en caisse, codes-barres poids-prix, caisse identifiée côté serveur |
| P1 | Preuve de livraison mobile (API prête, pas d'écran) ; date de disponibilité promise |
| P1 → P0 | E-facturation, dès publication du calendrier DGI |
| P2 | Leads, segmentation et campagnes, signature de devis, numéros de série |

### Achats

| Priorité | Manque |
|---|---|
| P0 | TVA, remise et double unité figées sur la ligne de BC |
| P1 | Accords-cadres, prix par palier de quantité, échéancier de livraison par ligne |
| P1 | Avoirs fournisseurs attendus / reçus, document de retour fournisseur |
| P1 | Campagne de paiement ; journal d'envoi du BC |
| P2 | Lecture automatique des factures (un worktree existe, non fusionné), portail fournisseur, sous-traitance |

### Stock

| Priorité | Manque |
|---|---|
| P0 | Stock à la date (valorisation rétroactive au 31/12) et clôture de stock verrouillée |
| P1 | Transferts de matières entre sites, stock en transit |
| P1 | Point de commande et stock de sécurité calculés (seuil manuel aujourd'hui) |
| P1 | Inventaire tournant par classes ABC ; codes-barres / terminal mobile côté stock |
| P1 | Statut « bloqué » générique ; quantité par emplacement |
| P2 | Numéros de série, consignation, kitting, inventaire permanent |

### Production / Qualité / Maintenance

| Priorité | Manque |
|---|---|
| P0 | Étiquetage réglementaire (ingrédients, allergènes, DLC) ; les vues existent, pas l'étiquette |
| P0 | MRP phasé dans le temps : calcul sur une seule date, sans commandes en cours ni stock de semi-finis, un seul niveau (`mrp.repository.ts:345-384`) |
| P1 | Coût standard gelé et écarts matière / rendement |
| P1 | Versions de nomenclature avec date d'effet et approbation |
| P1 | Non-conformités reliées au lot, au fournisseur et à l'ordre, avec actions correctives structurées |
| P1 | Référentiel équipement unique (aujourd'hui trois tables non reliées) ; TRS sans composante qualité et biaisé (`routing.repository.ts:160-190`) |
| P2 | Pièces de rechange, préventif par compteur, plan directeur persisté, capacité finie, sous-traitance, certificats d'analyse, étalonnage, valeurs nutritionnelles |

### RH / Paie / Projets

| Priorité | Manque |
|---|---|
| P1 | Travail de nuit (refusé par l'API : `employees.validator.ts:117-122`) — bloquant pour une boulangerie |
| P1 | Provision pour congés payés |
| P1 | Pointeuse / badge / mobile |
| P1 | Projets : approbation des temps et facturation (`invoice_id` jamais alimenté), dépendances entre tâches |
| P2 | Formation, entretiens, recrutement, accidents du travail, sanctions, notes de frais, organigramme, masse salariale prévisionnelle |

---

## 6. Dette technique mesurée

- **Fichiers géants** : `POSPage.tsx` 5 447 lignes, `AccountingPage.tsx` 4 000, `ReconciliationPage.tsx` 3 581, `PurchaseOrdersTab.tsx` 3 229, `accounting.repository.ts` 3 037, `production.repository.ts` 2 855.
- **Couches** : 257 appels SQL dans 32 contrôleurs, 46 dans les routes.
- **Transactions** : 282 `BEGIN` manuels, aucun helper commun.
- **Migrations** : pas de retour arrière ; 6 numéros en double (051, 264, 265, 426-428).
- **Points forts** : `strict: true`, 213 `any` au total, requêtes paramétrées, 149 fichiers de test serveur dont 107 d'intégration sur PostgreSQL, logs structurés.

---

## 7. Feuille de route proposée

| Lot | Contenu | Pourquoi d'abord |
|---|---|---|
| **G0 — Sécuriser l'existant** | Section 2, points 1 à 18 | Risques ouverts aujourd'hui en production |
| **G1 — Allumer et planifier** | Sections 3 et 4 | Le code est écrit ; reste la bascule et les tâches |
| **G2 — Données maîtres** | Poids cuit, allergènes, étapes, fusion des doublons, puis étiquetage | Débloque rendement, coût et conformité |
| **G3 — Exploitation** | Stockage objet, sauvegarde testée, staging, CI bloquante, observabilité | Prérequis à toute mise à l'échelle |
| **G4 — Trésorerie** | Paiements en lot, rapprochement par règles, prévision de trésorerie | Gain quotidien pour le client pilote |
| **G5 — Planification** | MRP phasé, stock à la date, point de commande calculé | Le maillon faible de la chaîne logistique |
| **G6 — Socle multi-client** | Rôles configurables, MFA, multi-société puis tenant, traductions | Condition de vente à un deuxième client |
| **G7 — Finitions par module** | P1 et P2 de la section 5, selon le secteur visé | À arbitrer client par client |

G0 à G2 ne créent aucune fonction nouvelle. Ce sont eux qui rapprochent le plus Kalum d'un ERP de premier rang, parce qu'ils rendent fiable et opposable ce qui est déjà construit.

La section 8 fusionne cette feuille de route avec le plan M0-M9 du module Production. Le détail tâche par tâche est dans `docs/PLAN_ACTION_GLOBAL_2026-11.md`.

---

## 8. Intégration de l'audit « Production paramétrable » (plan M0-M9)

Un second audit, mené séparément sur le seul module Production (schéma, serveur, écrans), propose dix lots M0 à M9 pour le rendre paramétrable et multi-industrie. Il n'est pas encore enregistré dans le dépôt. Cette section le croise avec l'audit global.

### 8.1 Deux angles différents

| | Audit global | Audit Production paramétrable |
|---|---|---|
| Question posée | La capacité existe-t-elle ? | La capacité est-elle paramétrable hors boulangerie ? |
| Périmètre | Tout le système | Production seulement, en profondeur |
| Verdict Production | 33 % complet, 43 % partiel | « L'enveloppe est neutre, le cœur reste un plan de fournée du jour » |

Les deux verdicts sont compatibles. Le second est plus sévère parce qu'il mesure autre chose : une capacité présente mais câblée pour un seul métier compte « Complet » dans le premier et « à refaire » dans le second.

### 8.2 Ce que les deux audits confirment ensemble

| Constat | Audit global | Plan Production |
|---|---|---|
| Interrupteurs de production sans effet | section 3 | M0 |
| Versions de nomenclature sans validité ni approbation | P1 | M4 |
| Co-produits limités à la coupe | Partiel | M4 |
| Gammes et postes de charge incomplets | Partiel | M5 |
| Inspections sans lien à l'ordre ni au lot | P1 | M7 |
| Rôles en dur dans les routes | socle P0 (610 occurrences) | M2 |
| Calculs faits dans le navigateur | RH (récapitulatif de pointage) | M8 (coût) |
| Jamais de `CREATE OR REPLACE` sur une fonction ancienne en production | — | vigilance M3 |

### 8.3 Ce que l'audit Production apporte de nouveau

- **Un défaut de stock confirmé** : la double consommation d'emballages (point 19). Il entre dans le lot G0.
- **Quatre anomalies de fiabilité** (points 20 à 23), à relire puis corriger en G0.
- **L'ordre de fabrication n'existe pas** : pas de numéro, pas de type, pas de priorité, une seule date. L'audit global ne l'avait pas relevé.
- **Les gammes sont décoratives** : `routing_id` n'est jamais écrit par le serveur. L'audit global les notait « Partiel » ; c'est plus grave.
- **Une vingtaine de constantes métier en dur** (rendement 90/85/70, charges 0,40, 191 h, marge ×3, horizon 14 jours…).
- **Une seule nomenclature par article**, sans alternative ni substitut.

### 8.4 Effet sur la couverture

Estimation, sans recomptage complet.

| Domaine | Avant | Après | Lignes revues |
|---|---|---|---|
| Production / Qualité / Maintenance | 33 % complet · 43 % partiel | ~31 % · ~45 % | Coût réel passe de Complet à Partiel (charges ignorées, énergie incohérente) |
| Stock | 43 % complet · 34 % partiel | ~40 % · ~37 % | Conversions d'unités passe de Complet à Partiel (repli silencieux à 1) |

Les autres domaines ne bougent pas. Le lot G0 passe de 18 à 23 points.

### 8.5 Points de désaccord ou d'ajustement

1. **Calcul des besoins (MRP).** Le plan Production le renvoie en M9 « plus tard ». L'audit global le classe P0. Les deux se concilient en deux temps : corriger tout de suite les défauts du calcul existant (recette choisie par `ORDER BY id LIMIT 1`, génération des demandes d'achat sans transaction, `mrp.repository.ts:345-405`), puis le phasage dans le temps après M2, qui apporte les dates de début et de fin d'ordre dont il dépend.
2. **Données maîtres avant M3 et M4.** Le plan Production ne traite pas les données. Or M4 crée une « version 1 » de chaque fiche et M3 reprend les poids : faits sur des données sales, ils figent les doublons, les poids cuits vides et le chocolat à 6,60 DH. G2 doit passer avant.
3. **Étiquetage réglementaire.** Absent du plan Production. Il reste P0 pour le client actuel et se place après G2.
4. **Paramètres à héritage (M1).** À bâtir sur l'existant (`parameters-catalog.ts`, `company_module_settings`, `store_module_settings`, `config_versions`) plutôt que dans une table propre à la production. Niveau à ajouter dans la chaîne : l'établissement.
5. **Droits par atelier (M2).** Même sujet que les rôles configurables du socle. À traiter une seule fois, au niveau du socle, sinon la production aura son propre système de droits.
6. **Emplacements (M6).** Les tables `stock_locations` et leurs mouvements existent déjà (migrations 424-425, un lot = un emplacement). M6 doit les étendre, pas créer un second modèle. Deux prérequis : supprimer l'écrêtage silencieux du stock (point 15) et disposer du stock à la date, faute de quoi la comparaison « quantités identiques avant / après » n'est pas fiable.
7. **Qualité liée (M7).** À fusionner avec les non-conformités structurées (P1 de l'audit global) : même clé vers l'ordre, l'opération et le lot.
8. **Jeu de référence.** Le garde-fou proposé (coûts, rendements et stocks figés, rejoués à chaque lot) est à étendre aux corrections de G0 qui changent des chiffres : amortissement dégressif, TVA, écrêtage du stock, double consommation d'emballages.

### 8.6 Impact sur la boulangerie en exploitation

L'analyse d'impact du plan Production tient : aucune table supprimée, les valeurs actuelles deviennent le premier paramétrage. Trois compléments tirés de l'audit global :

- **M0 fait bouger des chiffres** : stock d'emballages (il baissera moins) et coût de revient (charges et énergie enfin comptées). À annoncer au client avant la mise en production.
- **M2 (droits)** s'ajoute à un socle où le cloisonnement par établissement est éteint et la séparation des tâches en avertissement. Changer les droits sans staging est le risque principal ; G3 doit précéder M2.
- **M3 et M6** touchent le coût et le stock alors qu'aucun test ne couvre le client et qu'il n'existe pas de test de bout en bout dans le navigateur. Le jeu de référence est une condition, pas une option.

### 8.7 Feuille de route fusionnée

| Ordre | Lot | Contenu | Dépend de |
|---|---|---|---|
| 1 | **G0 + M0** | Points 1 à 23 ; jeu de référence construit en tête | — |
| 2 | **G1 + M1** | Contrôles allumés, traitements planifiés, constantes en paramètres à héritage | G0 |
| 3 | **G2** | Données maîtres, puis étiquetage | — |
| 4 | **G3** | Stockage objet, sauvegarde testée, staging, CI bloquante | — |
| 5 | **G4** | Trésorerie (piste indépendante, peut avancer en parallèle) | — |
| 6 | **M2 + rôles configurables** | Type d'ordre, numéro, priorité, dates ; droits traités au niveau du socle | G3 |
| 7 | **G5** | Stock à la date, point de commande calculé, calcul des besoins phasé | M2 |
| 8 | **M3** | Unités et mesures | G2, jeu de référence |
| 9 | **M4 à M7** | Nomenclature, gamme, consommation, qualité — ordre selon l'industrie visée | G2, G5 pour M6 |
| 10 | **G6** | MFA, multi-société puis tenant, traductions | — |
| en continu | **M8, G7, M9** | Écrans pilotés, finitions par module, sous-traitance, numéros de série | — |

### 8.8 Décision ouverte

L'industrie visée en premier fixe l'ordre de M4 à M7 : le discret (meuble, métal) demande d'abord nomenclatures et gammes ; le process (cosmétique, agroalimentaire) demande d'abord unités, co-produits et qualité. Elle ne change rien aux étapes 1 à 7.

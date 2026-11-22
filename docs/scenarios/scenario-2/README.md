# Scénario 2 — Exploitation du 1er juin au 21 novembre 2026

Prompt : [`../SCENARIO_2_PROMPT_EXPLOITATION_JUIN_NOVEMBRE.md`](../SCENARIO_2_PROMPT_EXPLOITATION_JUIN_NOVEMBRE.md).
Consigne du propriétaire (2026-11-21) : enchaîner toutes les étapes sans demander ; il
vérifiera lui-même dans l'application. Les décisions de l'étape 1 sont donc prises ici,
sur la recommandation du prompt, et consignées ci-dessous.

## Étape 0 — Résumé (lu le 2026-11-21)

**Prêt (base de développement, après le scénario 1)**
- 13 comptes actifs : administrateur + les 12 agents (gérant, commercial, responsable des
  achats, économe, 4 chefs d'atelier, 2 boulangers, 2 caissiers), rôles du scénario 0.
- 5 ateliers, 12 employés (masse brute 81 000 DH/mois), 10 fournisseurs, 38 matières,
  30 fiches techniques, 21 produits (dont « Produit test suppression », à ignorer).
- Paramétrage : TVA, numérotation, canaux de vente, règles d'achat, passation des
  écritures. Manquent : compte bancaire, siège, charges fixes (constat 117 : trésorerie sans
  solde d'ouverture ; constat 124 : aucune TVA d'achat par défaut).

**Écarts du catalogue avec le scénario 1** : Pain rond et Chebakia n'ont pas de fiche
technique ; Quiche au thon, Briouates, Plateau salé, Plateau beldi, Macarons et l'entremets
opéra n'existent pas comme produits (constats 54, 58, 61, 62 : coupe d'un cadre, formats
multiples, plateau assorti, vente à la douzaine non modélisables).

**Constats ouverts qui pèsent sur une journée d'exploitation** (91 non corrigés sur 129)

| N° | Effet attendu sur la simulation |
|---|---|
| 59 | Entremets vendu par personne : coût de l'entremets entier, marge fausse |
| 20 | Grammes d'une matière gérée à la pièce (œufs) comptés en pièces dans les coûts |
| 64 | Contrôles d'achat en simple avertissement (DA obligatoire, séparation des tâches, DLC) |
| 67 | Un article ajouté dans une demande de prix peut être commandé deux fois |
| 75 | Refus du serveur à la réception non affiché à l'écran |
| 83 | Écriture de la facture fournisseur passée dès la réception (brouillon) |
| 90 | Pas d'acompte fournisseur |
| 97, 98 | Fonds de caisse non proposé ; deux sessions ouvertes en même temps sans alerte |
| 117, 124 | Trésorerie sans solde d'ouverture ; achats sans TVA |

**Écrans par agent** : Caisse (caissiers) ; Ventes › Commandes, BL, Factures, Clients
(commercial) ; Achats › À commander, Demandes, Demandes de prix, BC, Réceptions,
Factures reçues (responsable des achats) ; Stock › Économat, Pesage, Inventaires
(économe) ; Production › Plans, Fiches techniques (chefs) ; Boutique (invendus, contrôle) ;
Personnel › Pointage, Paie ; Comptabilité (gérant).

**Leçons de la simulation de février** : la fenêtre « depuis la dernière session fermée »
lit des pièces futures si des données postérieures existent (F-030, F-041) ; produits sans
durée de vie → lots expirés à J+1 (F-022) ; pertes valorisées à 0 (F-020) ; stock de
semi-finis qui gonfle (F-044). D'où la décision D1 : aucune donnée postérieure au 31 mai.

## Étape 1 — Décisions retenues

| # | Décision |
|---|---|
| D1 | Base dédiée `kalum_sim` (conteneur `kalum-sim-db`, port 5437), copie de la base de développement du 2026-11-21 (sauvegarde : `Ofauria-app-sauvegardes/ofauria_dev_20261121_avant_scenario2.dump`). Opérations retirées (59 tables), stocks à 0, dates du référentiel ramenées au 2026-05-15, embauches au 2026-05-01. Mot de passe de test remis à l'Économe dans cette copie seulement. |
| D2 | RH, paie et comptabilité tenues par le Gérant (pas de rôle Comptable créé : le gérant a déjà ces droits). |
| D3 | Ouvert 7 jours sur 7 ; demi-journée le 1er Moharram et le jour du Mawlid ; ouvert les jours de fête nationale. |
| D4 | Vente au-delà du stock : on applique le réglage de l'appli (`POS_ALLOW_NEGATIVE_STOCK=false` : refus). |
| D5 | Corrections par lots en fin de semaine simulée ; un constat bloquant arrête la simulation, la journée est rejouée sur la sauvegarde. |
| D7 | Cible de chiffre d'affaires portée à **8 500 – 13 000 DH par jour** (demande du propriétaire, 2026-11-21) : la demande du jour est tirée autour du modèle puis bornée à 8 800 – 12 700 DH ; juin rejoué depuis le 31 mai. |
| D6 | Écrans : pilote, une journée par semaine, fins de mois, incidents ; autres jours par les endpoints des écrans, avec le compte de chaque agent. |

**Changement du 2026-11-21 au soir (demande du propriétaire)** : la simulation se joue
désormais directement dans la base de développement `ofauria_db` (port 5433), visible sur
l'application habituelle (client 5173, API 3001). Le conteneur `ofauria-db` a été recréé sur le
même volume avec l'horloge truquée (l'original est conservé à l'arrêt sous `ofauria-db-orig`) ;
`ofauria_db` a reçu l'état préparé au 31 mai (opérations du scénario 1 retirées, référentiel
conservé). Sauvegarde avant bascule : `Ofauria-app-sauvegardes/ofauria_dev_20261121_194137_avant_bascule_scenario2.dump`.
Pendant la simulation, la base et l'application affichent la date simulée.

## Environnement initial (étape 2)

| Élément | Valeur |
|---|---|
| Base | `kalum_sim`, PostgreSQL 16 sous libfaketime (horloge pilotée par un fichier de décalage) |
| API | port 3011, horloge Node simulée (préchargement `fake-date.mjs`), clé d'API externe vidée |
| Client | http://localhost:4190 (proxy vers 3011) |
| Agents | 12 comptes de test, une session HTTP par agent ; tout appel d'écriture est journalisé |

Ta base de travail (`ofauria_db`, port 5433) et tes serveurs 3001/5173 ne sont pas touchés
pendant la simulation. À la fin, la base simulée sera rendue visible dans l'application
(bascule comme en février, ancienne base gardée sous un autre nom).

## Avancement

**Terminé le 2026-11-22** : 174 journées jouées (1er juin → 21 novembre 2026) dans `ofauria_db`.
Bilan : [BILAN.md](BILAN.md) · synthèses : [SYNTHESES.md](SYNTHESES.md) · contrôles :
[CONTROLES_GLOBAUX.md](CONTROLES_GLOBAUX.md) · KPI : [KPI_JOURNALIERS.csv](KPI_JOURNALIERS.csv) ·
couverture et incidents : [COUVERTURE.md](COUVERTURE.md) · constats : [CONSTATS.md](CONSTATS.md).
Base revenue à l'heure réelle sur son conteneur d'origine.

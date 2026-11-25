# Feuille de route et tableau de suivi

Date : 24 novembre 2026. Livrables 9 (plan d'amélioration priorisé) et 13 (tableau de suivi).

Statut : **proposition**. Aucun chantier n'est commencé. Aucun déploiement en production sans validation.

## 1. Règles communes à tous les chantiers

- Une migration ne fait qu'ajouter (tables, colonnes nullables). Elle est accompagnée de son script de retour arrière.
- Aucune écriture validée n'est réécrite. Toute reprise passe par extourne et régénération, sur exercice ouvert, après accord.
- Avant tout chantier qui change des chiffres : figer la balance de la base simulée comme jeu de référence, et expliquer chaque écart après le chantier.
- Chaque chantier se termine par ses tests, la suite comptable complète (224 tests) et une vérification à l'écran.
- Les règles fiscales marquées « à valider » dans `02_CONFORMITE_MAROC.md` ne sont pas codées avant l'avis d'un expert-comptable.

## 2. P0 — Critique

### Lot A — Correctifs sans décision à prendre

| Tâche | Constat | Critère d'acceptation | Tests |
|---|---|---|---|
| A1. Refuser tout mode de règlement inconnu au lieu de l'imputer en caisse | C-01 | Un paiement de mode inconnu échoue avec un message explicite | Unitaire sur le générateur |
| A2. Avoir fournisseur : schéma correct (4411 / charge et TVA), document à part entière | C-01 | Un avoir réduit la charge et la TVA, ne touche pas la caisse | Intégration ; reprise par extourne des avoirs existants |
| A3. Une ligne de TVA par taux ; la déclaration lit tous les comptes de TVA mouvementés et échoue sur un compte non classé | C-02 | Ticket à 2 taux : 2 lignes de TVA, total déclaré = total comptabilisé | Intégration POS et facture |
| A4. Retirer 14 % et 7 % des listes en dur ; lire les taux dans `tax_codes` à la date | C-02 | Aucun taux en dur dans `server/src` | Garde automatique |
| A5. Rejeu planifié de la file, alerte, tous les types rejouables, fidélité et production dans le même mécanisme | C-07 | Un échec corrigé est rejoué sans intervention ; une file non vide notifie | Intégration par type |
| A6. État des retenues à la source : filtres appliqués aux sommes | I-07 | Total = solde du compte sur la période | Intégration |
| A7. États lisant `posted` seul : inclure les écritures extournées | I-08 | Chiffre d'affaires RH et prévision inchangés après modification d'une facture | Intégration |
| A8. Conserver la date d'origine et journaliser tout redatage | C-11 | Écriture redatée visible, avec sa date de pièce | Intégration |
| A9. Tests manquants : clôture d'exercice et à-nouveaux, verrou de période, chaîne altérée détectée, fermeture de caisse, invariant global, sécurité HTTP des routes du grand livre | C-12 | Les neuf trous de `01_RAPPORT_AUDIT.md` § C-12 couverts | — |
| A10. Vérification planifiée : triggers comptables actifs, chaîne intacte, avec alerte | C-08 | Un trigger désactivé déclenche une alerte en moins de 15 minutes | Intégration |

Dépendances : aucune entre les tâches. Impact : A2 et A3 modifient des écritures futures ; A2 demande une reprise.

### Lot B — Conformité fiscale et sociale, après avis de l'expert-comptable

| Tâche | Constat | Décision attendue | Critère d'acceptation |
|---|---|---|---|
| B1. Statut fiscal de la société obligatoire ; code de TVA obligatoire sur articles et lignes d'un assujetti ; contrôle de clôture « TVA nulle » | C-05 | — | Impossible de vendre ou d'acheter sans code de taxe pour un assujetti |
| B2. Régime de TVA choisi à l'installation ; comptes de TVA en attente ; reclassement au règlement | C-04 | Schéma comptable | Solde des comptes de TVA exigible = déclaration |
| B3. Liquidation de TVA et crédit reporté | C-03 | Périodicité | Écriture de liquidation ; crédit reporté ; rapprochement avant clôture |
| B4. Prorata de déduction | Conformité § 3 | Méthode | Prorata annuel appliqué aux déductions |
| B5. Paie comptabilisée à la validation du bulletin ; contrôle bloquant à la clôture comptable | C-06 | Moment de comptabilisation | Dettes sociales et fiscales au bilan chaque mois |
| B6. Retenues à la source selon la loi de finances 2026 ; état par bénéficiaire | Conformité § 5 | Taux et cas | Retenue calculée, datée, par type de payeur |
| B7. Droit de timbre sur les règlements en espèces | Conformité § 6 | Applicabilité en caisse | Selon la décision |
| B8. Chèques émis : compte et schéma corrects | I-01 | Schéma | 5111 réservé aux chèques reçus |

Dépendances : B2 avant B3 ; B1 avant B2.

### Lot C — Sécurité et gouvernance

| Tâche | Constat | Critère d'acceptation |
|---|---|---|
| C1. Rôle PostgreSQL applicatif sans propriété des tables, créé au déploiement | C-08 | L'application ne peut ni désactiver un trigger ni modifier une table comptable hors des fonctions prévues |
| C2. Approbation des OD au-delà d'un seuil ; le créateur ne valide pas | C-09 | OD au-dessus du seuil en attente tant qu'un second utilisateur n'a pas validé |
| C3. Changement de RIB fournisseur et salarié : double validation, gel avant paiement, alerte à l'approbateur de la campagne | C-09 | Un RIB modifié depuis moins de N jours bloque le paiement |
| C4. Règles de séparation des tâches bloquantes par défaut ; droits fins à la place de `accounting.delete` et `accounting.cancel` | C-09 | Dix actions, dix droits |
| C5. Journal d'audit branché sur profils, journaux, règles bancaires, comptes de trésorerie | — | Toute modification de paramétrage comptable tracée |

Impact de C1 : opération de déploiement à préparer et à répéter sur une copie de la production. C'est le chantier le plus risqué du lot.

### Lot D — Une seule vérité comptable

| Tâche | Constat | Critère d'acceptation |
|---|---|---|
| D1. Tableaux de bord et écrans Pilotage, Résumé, Créances & dettes lus sur le grand livre | C-10 | Résultat du Résumé = résultat du CPC, au centime |
| D2. Écran Caisse : solde = compte 5161 ; plus de report modifiable à la main | C-10 | Solde affiché = solde comptable |
| D3. Contrôle de cohérence planifié grand livre ↔ pièces, avec alerte | — | Écart signalé le jour même |

## 3. P1 — Haute

| Lot | Contenu | Constats |
|---|---|---|
| **E. Moteur comptable unique** | Résolveur de comptes, événements comptables, un seul point d'écriture (étapes 1 à 3 de `04_ARCHITECTURE_CIBLE.md` § 7). Critère : simulation à 100 % d'écritures identiques sur la base simulée. | I-09, I-10 |
| **F. Trésorerie** | Versement d'espèces en banque guidé, contrôle de solde de caisse et de banque créditrice, régularisation de la commission carte, frais bancaires au rapprochement, plusieurs journaux de banque. | I-02, I-16 |
| **G. Stocks et production** | Méthode d'inventaire explicite par société ; inventaire tournant, emballages, pertes ; compte de vente selon l'activité. | I-03, I-04, I-05 |
| **H. Ventes** | Retour en caisse avec TVA et famille ; escompte ; acompte fournisseur. | I-06 |
| **I. Clôture** | Exercice à dates libres ; assistant d'affectation du résultat ; invitation à clôturer ; limite du nombre de périodes ouvertes. | I-11, I-15 |
| **J. États légaux** | Tableau de financement, ETIC, livre d'inventaire ; liasse bloquée si un compte n'est pas classé ; un seul bilan. | I-12 |
| **K. Fiscal complémentaire** | Contribution sociale de solidarité, déficits reportables, cotisation minimale à 0,15 %, plafond véhicules, régularisation de TVA à la cession, délais de paiement. | I-13, I-14 |
| **L. Écrans du comptable** | Grand livre paginé ; liens balance → grand livre → écriture → pièce et retour ; erreurs visibles ; droits fins à la place du rôle en dur ; menu par parcours (quotidien, fin de mois, fiscal, clôture). | I-17, I-18, I-19 |
| **M. Performance** | Compteur de numérotation sans file d'attente ; centralisation optionnelle des ventes de caisse par session ; test de charge à un an de données, dix magasins. | I-20 |

Ordre conseillé : E d'abord, parce que F, G, H et K ajoutent des schémas et qu'il vaut mieux les écrire une fois, en règles.

## 4. P2 — Moyenne

| Lot | Contenu |
|---|---|
| **N. Règles en table** | Schémas d'écritures en table, écran des règles, simulation et comparaison, circuit de validation, versions datées (étapes 4 et 5). |
| **O. Profils comptables** | Plan comptable complet, règles et contrôles par profil ; assistant d'installation. |
| **P. Multi-sociétés** | Société sur livres, journaux, exercices, règles ; intragroupe ; consolidation de sociétés. |
| **Q. Analytique et budget** | Ventilation obligatoire par compte ; budget par axe, centre, projet ; révisions ; scénarios ; rapprochement garanti analytique ↔ générale. |
| **R. Ergonomie** | Saisie au kilomètre, vues enregistrées, tri, comparatif N / N-1, indicateurs (délais clients et fournisseurs, besoin en fonds de roulement), tableaux de bord par rôle, traduction. |
| **S. Provisions** | Créances douteuses, stocks, produits constatés d'avance, non-valeurs. |

## 5. P3 — Évolution stratégique

| Lot | Contenu | Prérequis |
|---|---|---|
| **T. Factures fournisseurs** | Extraction, proposition d'imputation expliquée, détection de doublons | Lots A, B, E |
| **U. Trésorerie assistée** | Rapprochement proposé avec score, prévision | Lot F |
| **V. Clôture assistée** | Explication des contrôles en échec, écritures inhabituelles, analyse des variations | Lots B, I |
| **W. Questions en langage naturel** | Lecture seule, requête affichée | Lot D |
| **X. Facturation électronique** | Format structuré, connecteur dès publication du texte d'application | Texte réglementaire |

## 6. Tableau de suivi

| Réf. | Constat | Priorité | Lot | État | Commit | Vérifié le |
|---|---|---|---|---|---|---|
| C-01 | Avoir fournisseur en sortie de caisse | P0 | A | Corrigé (écriture) ; document d'avoir à venir | 14ce9913 | 2026-11-25, tests |
| C-02 | TVA multi-taux hors déclaration | P0 | A | Corrigé (par taux, sans taux visible, taux datés) | 14ce9913, b41bb3e1 | 2026-11-25, tests |
| C-03 | Liquidation et crédit de TVA | P0 | B | À valider | | |
| C-04 | Régime de TVA par défaut | P0 | B | À valider | | |
| C-05 | Code de TVA non obligatoire | P0 | B | À faire | | |
| C-06 | Paie comptabilisée sous condition | P0 | B | À valider | | |
| C-07 | File d'écritures non rejouée | P0 | A | Corrigé pour la file ; fidélité et production à convertir | 5543cbed | 2026-11-25, tests |
| C-08 | Triggers désactivables | P0 | A, C | Surveillance livrée ; rôle PostgreSQL (étape 20) à faire | 8acbec2c | 2026-11-25, tests |
| C-09 | Séparation des tâches | P0 | C | Partiel : droits fins, approbation OD (règle désactivée), RIB fournisseur, audit du paramétrage ; RIB salariés et filtre de rôle des écrans restent | voir 07 | 2026-11-25, tests |
| C-10 | Deux comptabilités | P0 | D | À faire | | |
| C-11 | Redatage silencieux | P0 | A | Corrigé (date conservée, tracé, politique) | 14ce9913 | 2026-11-25, tests |
| C-12 | Tests manquants | P0 | A | Partiel : 4 des 7 fichiers prévus | 8acbec2c | 2026-11-25 |
| I-01 | Chèques émis en 5111 | P1 | B | À valider | | |
| I-02 | Caisse jamais versée en banque | P1 | F | À faire | | |
| I-03 | Ventes de production en 7111 | P1 | G | À valider | | |
| I-04 | Inventaire incomplet | P1 | G | À faire | | |
| I-05 | Inventaire permanent incohérent | P1 | G | À faire | | |
| I-06 | Retour en caisse simplifié | P1 | H | À faire | | |
| I-07 | État des retenues faux | P1 | A | Corrigé | 3e7da6f8, 14ce9913 | 2026-11-25, test |
| I-08 | États « posted » seul | P1 | A | Corrigé (2 états ; garde de lecture à ajouter) | 3e7da6f8 | 2026-11-25 |
| I-09 | Profils décoratifs, comptes en dur | P1 | E | À faire | | |
| I-10 | Insertion dupliquée | P1 | E | À faire | | |
| I-11 | Exercice civil en dur | P1 | I | À faire | | |
| I-12 | Liasse partielle | P1 | J | À faire | | |
| I-13 | IS incomplet | P1 | K | À valider | | |
| I-14 | Immobilisations incomplètes | P1 | K | À valider | | |
| I-15 | Aucune clôture | P1 | I | À faire | | |
| I-16 | Commission carte estimée | P1 | F | À faire | | |
| I-17 | Grand livre sans pagination ni liens | P1 | L | À faire | | |
| I-18 | Erreurs masquées | P1 | L | À faire | | |
| I-19 | Écrans réservés à deux rôles | P1 | L | À faire | | |
| I-20 | Contention de numérotation | P1 | M | À faire | | |
| I-21 | Champs de rapprochement modifiables | P1 | E | À faire | | |
| I-22 | Plan à 109 comptes | P1 | O | À faire | | |

## 7. Ce qui reste à produire pour les livrables demandés

| Livrable | État |
|---|---|
| 1, 4, 11, 12 | `01_RAPPORT_AUDIT.md` |
| 2 | `02_CONFORMITE_MAROC.md`, avec dix points à faire valider |
| 3 | `03_BENCHMARK.md`, incomplet pour Sage et SAP faute d'accès à leur documentation |
| 5, 6 | `04_ARCHITECTURE_CIBLE.md`, à valider |
| 7, 8 | `05_SCHEMAS_ET_CONTROLES.md` |
| 9, 13 | Ce document |
| 10. Documentation des fonctionnalités et paramétrages | À écrire avec chaque lot livré |
| 11. Simulation de plusieurs secteurs sur un cycle complet | Une seule entreprise simulée à ce jour, sans clôture annuelle ; à faire après les lots A et B, sinon la simulation reproduira les défauts connus |
| 14. Bilan avant / après | « Avant » = § 7 de `01_RAPPORT_AUDIT.md` ; « après » à la fin de l'intervention |

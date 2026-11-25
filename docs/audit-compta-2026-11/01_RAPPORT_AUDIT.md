# Audit du module comptable et financier de Kalum — rapport détaillé

Date : 24 novembre 2026 · Branche auditée : `main` à `f00c917c` (migrations 001-662).

Ce rapport couvre les livrables 1 (audit de l'existant), 4 (cartographie des anomalies et des risques), 11 (résultats des tests) et 12 (validation de l'intégrité comptable).

## 1. Méthode et limites

| Source | Ce qui a été fait |
|---|---|
| Code | Lecture du moteur d'écritures, des 40 fichiers serveur qui écrivent au grand livre, des migrations qui définissent triggers et contraintes, et des 42 écrans comptables. |
| Base de dev (`ofauria_db`) | Requêtes en lecture seule sur l'exploitation simulée du scénario 2 : 174 jours (1er juin → 21 novembre 2026), 111 397 écritures, 225 510 lignes. |
| Tests | 50 tests unitaires et 174 tests d'intégration comptables exécutés sur `kalum_test`. |
| Web | Sources réglementaires marocaines et documentation des éditeurs concurrents. |

Chaque constat porte la mention **Vérifié** (lu dans le code ou mesuré en base par l'auditeur principal), **Lu** (lu par un auditeur délégué, non relu) ou **Présumé**.

Limites :

- La base de production n'a pas été consultée. Tout ce qui dépend de son état (rôle PostgreSQL utilisé, triggers actifs, mode de comptabilisation) reste à contrôler sur place.
- Une seule entreprise simulée (boulangerie-pâtisserie, un établissement). Les autres secteurs n'ont pas été simulés.
- Aucune règle de droit marocain n'est affirmée ici sans renvoi à `02_CONFORMITE_MAROC.md`, qui indique pour chacune le niveau de confiance de la source.

## 2. Vue d'ensemble

Le socle du grand livre est solide. Les défauts graves se trouvent autour : fiscalité, paie, traitements en échec, séparation des tâches, et une seconde « comptabilité » d'écrans hérités qui ne lit pas le grand livre.

### Ce qui tient

| Point | Preuve |
|---|---|
| Partie double garantie en base | Trigger `check_journal_entry_balance` à la validation, comparaison exacte au centime. Mesuré : 0 écriture déséquilibrée sur 111 397, total débit = total crédit = 4 869 901,19. |
| Écritures validées non modifiables | Triggers de garde sur l'en-tête et les lignes ; toute correction passe par une extourne, jamais par une suppression. |
| Numérotation continue | Compteur transactionnel par journal et par année. Mesuré : aucun trou sur les 5 journaux (ex. CA-2026-00001 à 85683 pour 85 683 écritures). |
| Chaîne d'inaltérabilité | Empreinte SHA-256 chaînée, scellement toutes les 15 minutes. Mesuré : 111 397 écritures scellées sur 111 397. |
| Idempotence | Index unique sur (pièce d'origine, détail) hors écritures extournées. |
| Cohérence pièces ↔ écritures | Mesuré : 0 ticket, 0 facture, 0 paiement sans écriture ; 0 écriture hors de sa période ; file des écritures en échec vide. |
| Tests | 224 tests comptables verts. La CI les exécute. |
| Performance des agrégats | Balance annuelle sur 225 510 lignes : 140 ms. |

### Ce qui ne tient pas

Les 12 constats critiques, détaillés en section 3 :

| N° | Constat | Nature |
|---|---|---|
| C-01 | Un avoir fournisseur déduit d'un règlement est comptabilisé comme une sortie de caisse | Écriture fausse |
| C-02 | La TVA d'un ticket ou d'une facture à plusieurs taux sort de la déclaration | Fiscal |
| C-03 | Aucune écriture de liquidation de TVA, aucun report de crédit | Fiscal |
| C-04 | Régime de TVA « débits » par défaut ; l'encaissement est calculé hors comptabilité | Fiscal |
| C-05 | Six mois d'exploitation simulée sans un dirham de TVA, sans alerte | Fiscal / contrôle |
| C-06 | Les charges sociales et l'IR n'entrent au grand livre qu'à la clôture du mois de paie | Résultat faux |
| C-07 | Une pièce peut exister sans écriture ; la file n'est jamais rejouée automatiquement | Intégrité |
| C-08 | L'inaltérabilité repose sur des triggers que le compte de connexion peut désactiver | Sécurité |
| C-09 | Le même utilisateur crée et valide une OD, modifie un RIB fournisseur et paie | Fraude |
| C-10 | Deux comptabilités côte à côte : les tableaux de bord ne lisent pas le grand livre | Fiabilité |
| C-11 | Une pièce datée d'une période close est redatée sans trace | Cut-off |
| C-12 | Clôture d'exercice, verrou de période et chaîne d'empreintes sans aucun test | Non-régression |

## 3. Constats critiques (P0)

### C-01 — Avoir fournisseur comptabilisé en sortie de caisse · Vérifié

- **Situation.** L'avoir fournisseur n'existe pas comme document. Il est saisi comme un second « paiement » de mode `avoir` au moment du règlement par chèque ou effet (`server/src/repositories/accounting.repository.ts:2720-2740`).
- **Anomalie.** Le générateur ne connaît pas ce mode : le `switch` retombe sur `default → 5161, journal CA` (`server/src/services/journal-generator.service.ts:1076-1078`). L'écriture produite est 4411 débit / 5161 crédit.
- **Risque.** La caisse comptable baisse sans sortie d'argent ; la charge et la TVA déductible ne sont pas réduites. Résultat et TVA faux à chaque avoir.
- **Solution.** Créer le document « avoir fournisseur » avec son schéma (4411 débit / charge et TVA récupérable au crédit), et refuser tout mode de règlement inconnu au lieu de l'envoyer en caisse.
- **Dépendances.** Aucune. Reprise des écritures existantes par extourne et régénération.

### C-02 — TVA multi-taux hors déclaration · Vérifié

- **Situation.** Le compte de TVA est choisi par un `if` sur le taux : 20, 14, 10, 7 → sous-comptes ; tout autre taux → 4455 ou 3455 (`journal-generator.service.ts:104-118`).
- **Anomalie.** Un ticket ou une facture à plusieurs taux est comptabilisé au taux moyen, qui n'est aucun des quatre : il part en 4455 générique. Or la déclaration ne lit que les comptes dont `tva_direction` est renseigné (`server/src/repositories/ledger.repository.ts:853`), ce qui exclut 4455 et 3455.
- **Risque.** TVA collectée sous-déclarée, sans message. Les taux 14 % et 7 %, supprimés au 1er janvier 2026 selon la table `tax_codes`, restent acceptés en dur dans cinq fichiers.
- **Solution.** Porter les comptes de TVA sur `tax_codes` (collectée, récupérable, en attente), comptabiliser une ligne de TVA par taux, et faire échouer la déclaration si un compte de TVA mouvementé n'est pas classé.

### C-03 — Ni liquidation ni crédit de TVA reporté · Lu

- **Situation.** La déclaration calcule « collectée − déductible » sur la période (`ledger.repository.ts:993`). Le compte 4456 (État, TVA due) existe mais n'est jamais mouvementé.
- **Anomalie.** Les comptes 3455 et 4455 ne sont jamais soldés ; un crédit de TVA n'est pas reporté sur la période suivante. La TVA déductible est lue sur les factures, la collectée sur le grand livre : deux sources que rien ne rapproche.
- **Risque.** Déclaration fausse dès qu'un mois est créditeur ; aucun justificatif comptable du montant déclaré.
- **Solution.** Écriture de liquidation mensuelle ou trimestrielle générée et validée par l'utilisateur ; crédit reporté tenu en compte ; rapprochement déclaration ↔ soldes obligatoire avant clôture.

### C-04 — Régime de TVA par défaut · Lu, à valider par un expert-comptable

- **Situation.** Le paramètre de régime vaut « débits » par défaut (migration 485). Le régime de l'encaissement est une option avec date de bascule.
- **Anomalie.** En encaissement, la TVA exigible est calculée hors comptabilité, au prorata des règlements, sans comptes d'attente (TVA facturée / TVA exigible). Un règlement lettré par OD manuelle est ignoré du calcul.
- **Risque.** Voir `02_CONFORMITE_MAROC.md` pour le régime de droit commun. Une installation neuve déclare dans le régime paramétré par défaut sans l'avoir choisi.
- **Solution.** Régime demandé à l'installation, sans défaut silencieux ; comptes d'attente et reclassement au règlement.

### C-05 — Six mois sans TVA et sans alerte · Vérifié en base

- **Situation.** Sur l'exploitation simulée : 1 918 427,51 DH de ventes en caisse, 632 547,88 DH de factures fournisseurs, 0,00 DH de TVA. Aucun mouvement sur les comptes 3455x et 4455x. Les 1 775 lignes de factures ont un taux vide.
- **Anomalie.** Rien n'oblige à renseigner un code de TVA sur un article vendu ou acheté, et rien ne signale une société assujettie qui ne collecte rien. 17 matières portent pourtant le code « TVA 20 % ».
- **Risque.** Une entreprise assujettie peut exploiter Kalum des mois sans s'apercevoir qu'elle ne comptabilise aucune TVA.
- **Solution.** Statut fiscal de la société obligatoire ; code de TVA obligatoire sur les articles et les lignes d'une société assujettie ; contrôle de clôture « TVA nulle sur la période ».

### C-06 — Paie : charges sociales absentes du grand livre · Vérifié en base

- **Situation.** L'écriture de paie complète (6171, 6174 → 4441, 4443, 44525, 4432) n'est posée qu'à la clôture du mois de paie (`server/src/controllers/payroll-config.controller.ts:116`). Sans cette clôture, seul le net passe en 6171 au paiement.
- **Mesure.** 72 bulletins déclarés : brut 436 288,48 DH, charges patronales 83 946,85 DH, cotisations salariales 25 381,61 DH, IR 14 569,71 DH. Au grand livre : 396 337,16 DH en 6171 et rien d'autre. Aucun compte 4441, 4443 ou 4452.
- **Risque.** Charges de personnel sous-évaluées de 123 898 DH sur la période simulée, soit 24 % du coût réel ; dettes sociales et fiscales absentes du bilan.
- **Solution.** Comptabiliser le bulletin à sa validation ; faire de « paie du mois comptabilisée » un contrôle bloquant de la clôture comptable. Les paies hebdomadaires et par quinzaine suivent la même règle.

### C-07 — Pièces sans écriture, file jamais rejouée · Vérifié

- **Situation.** À la création d'une pièce, la comptabilisation est isolée dans un point de sauvegarde. En mode `outbox` (défaut), un échec laisse passer la pièce et inscrit une ligne dans `ledger_outbox` (`server/src/services/ledger-posting.service.ts:32-61`).
- **Anomalies.**
  - Le rejeu n'existe que comme action manuelle (`server/src/controllers/ledger.controller.ts:329`) ; aucune tâche planifiée, aucune notification.
  - Les types `stock_count`, `loyalty`, `advance_repayment` et `shift_entry` sont mis en file mais ne sont pas rejouables (`ledger-posting.service.ts:113-135`). Comme une file non vide bloque la clôture mensuelle, la clôture peut rester bloquée sans issue dans l'application.
  - La fidélité et la production ont leur propre capture d'erreur, sans file : l'échec n'apparaît que dans les journaux du serveur.
- **Risque.** Chiffre d'affaires, achats ou stock sortis du grand livre sans que personne ne le voie.
- **Solution.** Rejeu planifié avec tentatives bornées, alerte au comptable, tous les types rejouables, et un seul mécanisme pour tous les modules.

### C-08 — Inaltérabilité contournable par le compte de connexion · Vérifié en dev, à contrôler en production

- **Situation.** Toutes les protections (équilibre, gel des écritures validées, verrou de période, chaîne) sont des triggers.
- **Anomalie.** En dev, l'application se connecte avec un rôle superutilisateur et propriétaire des tables (`ofauria`, `rolsuper = true`). Ce rôle peut désactiver un trigger ou passer en `session_replication_role = replica`. Le script qui crée un rôle applicatif restreint (`server/scripts/l0-pg-roles-separation.sql`) n'est pas une migration : il se joue à la main. La migration 413 a elle-même constaté un trigger de garde désactivé sans trace.
- **Risque.** L'inaltérabilité n'est pas opposable tant que le compte de l'application peut la couper.
- **Solution.** Rôle applicatif sans droit de propriété, créé au déploiement ; vérification planifiée « tous les triggers comptables sont actifs » et vérification de la chaîne, avec alerte ; empreinte de clôture conservée hors base.

### C-09 — Séparation des tâches inopérante par défaut · Lu

- **Situation.** Les règles existent (`sod_rules`, `sod_document_rules`, `approval_rules`) mais sont en mode `warn` ou sans plafond à l'installation.
- **Anomalies.**
  - Une OD est créée et validée par le même utilisateur (`server/src/routes/ledger.routes.ts:403`) ; aucune approbation d'écriture.
  - Le RIB d'un fournisseur se modifie avec le droit d'édition des fournisseurs, sans double validation ni gel avant paiement ; la campagne de paiement recopie le RIB courant.
  - Une campagne de paiement sans règle applicable est approuvée par celui qui la soumet.
  - Le droit `accounting.delete` protège dix actions sans rapport entre elles.
- **Risque.** Détournement par changement de RIB, écritures de complaisance, absence de preuve de contrôle pour un auditeur.
- **Solution.** Validation à quatre yeux paramétrable sur OD, RIB et paiements ; règles bloquantes par défaut ; droits fins par action.

### C-10 — Deux comptabilités côte à côte · Lu

- **Situation.** Six écrans hérités (Pilotage, Caisse, Charges, Chèques, Créances & dettes, Résumé) vivent dans `client/src/features/accounting/AccountingPage.tsx` (3 714 lignes) et lisent `payments`, `invoices` et les sessions de caisse. Le solde de caisse est recalculé dans le navigateur et son report d'ouverture est modifiable à la main. Les tableaux de bord serveur font de même (`server/src/repositories/dashboard.repository.ts`).
- **Risque.** Le « résultat du mois » du Résumé et celui du CPC peuvent diverger sans que rien ne le montre.
- **Solution.** Tous les indicateurs financiers lus sur le grand livre ; les écrans hérités deviennent des vues du grand livre ou disparaissent.

### C-11 — Redatage silencieux en période close · Lu

- **Situation.** Avant d'écrire, le générateur passe par `fn_accounting_date` (`journal-generator.service.ts:1255`). Si la date de la pièce tombe dans une période close ou verrouillée, l'écriture est datée du premier jour de la première période ouverte.
- **Anomalie.** Aucune trace sur l'écriture, aucun message. La saisie manuelle, elle, refuse.
- **Risque.** Chiffre d'affaires, charges et TVA rattachés à la mauvaise période, voire au mauvais exercice.
- **Solution.** Conserver la date d'origine sur l'écriture, journaliser le redatage, et laisser l'entreprise choisir entre refuser et redater.

### C-12 — Fonctions critiques sans test · Lu

Sans aucun test : clôture d'exercice et à-nouveaux, refus d'écrire en période close, vérification de la chaîne et détection d'une altération, fermeture de caisse → écriture, invariant global après opérations mêlées, cycle complet ouverture → clôture → réouverture, concurrence sur la numérotation, sécurité HTTP des routes `/ledger`.

## 4. Constats importants (P1)

| N° | Constat | Preuve | Statut |
|---|---|---|---|
| I-01 | Chèques émis crédités au 5111 « Chèques à encaisser », compte d'actif des chèques reçus. Mesuré : 5111 créditeur de 208 986,75 DH, 151 chèques jamais soldés. | `journal-generator.service.ts:1072` | Vérifié |
| I-02 | Aucun versement d'espèces en banque sur 174 jours. Mesuré : caisse 5161 débitrice de 1 419 198,98 DH, banque 5141 créditrice de 203 428,39 DH. Aucun contrôle de solde de caisse anormal ni de banque créditrice. | Balance | Vérifié |
| I-03 | Ventes d'une boulangerie en 7111 « Ventes de marchandises » au lieu des ventes de biens produits : l'état des soldes de gestion affiche une marge commerciale à la place d'une production. | Balance | Vérifié |
| I-04 | Inventaire intermittent incomplet : le stock de matières n'est ajusté que sur inventaire complet, les emballages jamais, les produits finis par opération manuelle, les pertes sans écriture. Mesuré : 3121 = 33 771,99 DH (dernier inventaire) contre 19 278,57 DH de stock valorisé à ce jour. | `stock-count.repository.ts:290` | Lu + mesuré |
| I-05 | Politique d'inventaire permanent en production incohérente avec les achats : activée, elle compterait les matières deux fois en charge. Éteinte par défaut. | `production-ledger.ts:39` | Lu |
| I-06 | Retour en caisse : toujours 7111 / 5161, sans reprise de TVA, sans famille, même si la vente était par carte. | `journal-generator.service.ts:566-582` | Lu |
| I-07 | État des retenues à la source faux : les filtres de date et de statut sont dans la jointure et ne filtrent pas les sommes. | `withholding.repository.ts:75-96` | Vérifié |
| I-08 | États qui ne lisent que `posted` : une facture modifiée pèse zéro dans le chiffre d'affaires RH et fausse le solde d'ouverture de la prévision de trésorerie. | `hr-analytics.repository.ts:65`, `cash-forecast.ts:64` | Lu |
| I-09 | Profils de comptabilisation décoratifs : 7 des 17 lignes de `posting_profiles` ne sont lues par aucun code ; environ 60 comptes en dur dans le générateur et 11 autres fichiers. | `journal-generator.service.ts` | Lu |
| I-10 | Insertion d'écriture dupliquée en neuf endroits, avec des règles différentes (période close refusée ici, redatée là). | — | Lu |
| I-11 | Exercice civil en dur ; exercice décalé ou premier exercice ≠ 12 mois impossible ; clôture d'exercice sans réouverture ni assistant d'affectation du résultat. | Migration 416 | Lu |
| I-12 | Liasse : tableau de financement et ETIC absents ; un compte non classé sort des totaux mais le fichier EDI reste téléchargeable ; deux bilans (gestion et liasse) qui reclassent différemment. | `liasse.rules.ts`, `ledger.routes.ts:257` | Lu |
| I-13 | IS : pas de contribution sociale de solidarité, pas de suivi des déficits reportables, exonération de cotisation minimale par case manuelle. | `corporate-tax.rules.ts` | Lu |
| I-14 | Immobilisations : pas de plafond véhicules, pas de taux par catégorie, pas de régularisation de TVA à la cession. | `depreciation.service.ts` | Lu |
| I-15 | Aucune période ni exercice clos après six mois d'activité simulée : rien n'invite à clôturer, donc rien n'empêche d'antidater. | `fiscal_periods` : 36 ouvertes | Vérifié |
| I-16 | Commission carte estimée par taux à chaque ticket, jamais régularisée sur le relevé ; le rapprochement bancaire ne génère aucune écriture de frais. | `journal-generator.service.ts:84-89` | Lu |
| I-17 | Grand livre à l'écran : charge tout l'exercice sans pagination ; aucun lien balance → grand livre → écriture → pièce, ni l'inverse. | `GrandLivreTab.tsx:58-65` | Lu |
| I-18 | Erreurs serveur affichées comme « Aucun mouvement » sur six états légaux. | `BalanceTab.tsx`, `BilanTab.tsx`… | Lu |
| I-19 | 26 des 32 écrans invisibles pour un rôle « comptable » : le filtre est le rôle en dur admin / manager. | `AccountingPage.tsx:361` | Lu |
| I-20 | Numérotation : le verrou du compteur est tenu jusqu'au commit de la vente ; toutes les ventes d'un journal se mettent en file. | Migration 180 | Lu |
| I-21 | Champs de rapprochement réception/facture (`po_line_id`, `receipt_item_id`) modifiables après validation et hors empreinte. | Migration 413 | Lu |
| I-22 | Plan comptable livré : 109 comptes. Toute opération hors de ce jeu demande une création manuelle. | Mesuré | Vérifié |

## 5. Constats secondaires (P2)

- Journaux codés en dur, un seul journal de banque pour toutes les banques, aucun écran de création.
- Multi-société limité à l'identité sur les documents : un plan, un jeu de livres par base. La « consolidation » agrège des établissements, pas des sociétés.
- Profils sectoriels sans aucun effet comptable (ni plan, ni schéma, ni état).
- Deux analytiques séparées (ventilation des lignes d'écriture ; coût de revient) reliées par un état informatif. Pas de ventilation obligatoire par compte.
- Budget par compte et par mois seulement ; ni centre, ni projet, ni révision.
- Écritures par ticket : 85 478 écritures de caisse en six mois pour un établissement. Volume soutenable aujourd'hui, à centraliser pour une chaîne de magasins.
- Aucune traduction des écrans comptables (français en dur) ; `exportCSV` recopié dans dix fichiers ; aucun tableau triable.
- Créances douteuses, dépréciation de stock, produits constatés d'avance : aucune écriture.
- Charges constatées d'avance sur le compte 486, qui est un numéro du plan français.
- Export du fichier des écritures comptables : l'obligation existe bien (CGI art. 210, avis CNC n° 24), mais le format produit est le modèle français à 18 colonnes ; le format attendu par l'avis n° 24 n'a pas pu être lu et reste à confirmer.
- L'avis CNC n° 24 demanderait « deux périodes ouvertes au plus » (source secondaire) : la base simulée en a 36.
- Timbre de quittance paramétré mais jamais appliqué ; déclaration des délais de paiement absente.
- Date des ventes prise en UTC : un ticket entre minuit et 1 h locale est daté de la veille.

## 6. Résultats des tests exécutés

| Suite | Fichiers | Tests | Résultat |
|---|---|---|---|
| Unitaires comptables (TVA, liasse, EDI, consolidation, paie → écriture, éditions, budget, import bancaire) | 9 | 50 | 50 réussis |
| Intégration comptable sur `kalum_test` (saisie, lettrage, balance âgée, FEC, immobilisations, IS, change, liasse, consolidation, plan comptable, analytique, budget, RLS, récurrentes, TVA, banque, campagnes de paiement, parcours pilote, scénarios sectoriels) | 39 | 174 | 174 réussis, 80 s |

Lecture : ce qui est testé fonctionne. Aucun des douze constats critiques n'est dans le périmètre d'un test existant.

## 7. Validation de l'intégrité comptable (base simulée)

| Contrôle | Résultat |
|---|---|
| Écritures déséquilibrées | 0 / 111 397 |
| Total débit − total crédit | 0,00 |
| En-têtes sans ligne ou à une ligne | 0 |
| Écritures hors de leur période | 0 |
| Trous de numérotation | 0 sur 5 journaux |
| Écritures non scellées | 0 |
| Triggers désactivés | 0 |
| Lignes sur compte inactif | 0 |
| Tickets, factures, paiements sans écriture | 0 / 0 / 0 |
| Écart factures ↔ comptes de tiers | 0,00 (4411 = 82 558,14 = factures en attente ; 3421 = 41 519,60 = factures clients en attente) |
| File des écritures en échec | vide |
| TVA comptabilisée | **0,00 — anomalie C-05** |
| Dettes sociales et fiscales de paie | **0,00 — anomalie C-06** |
| Caisse 5161 | **1 419 198,98 débiteur — anomalie I-02** |
| Banque 5141 | **203 428,39 créditeur — anomalie I-02** |
| Chèques 5111 | **208 986,75 créditeur — anomalie I-01** |
| Réceptions non facturées 4417 | 240,59 créditeur résiduel, à justifier |

Conclusion : le grand livre est **formellement intègre** (équilibré, continu, scellé, rapproché des pièces) et **matériellement incomplet** (TVA, charges sociales, mouvements de trésorerie). Un bilan tiré de cette base serait faux.

## 8. Risques de fraude et de contournement

| Risque | Barrière actuelle | Manque |
|---|---|---|
| Détournement par changement de RIB fournisseur | Historique des modifications | Double validation, gel avant paiement, alerte à l'approbateur |
| Écriture de complaisance | Extourne motivée, journal d'audit | Approbation d'OD, seuils |
| Antidatage | Verrou de période | Aucune période close dans les faits ; pas de contrôle date de pièce / date de saisie |
| Facture fournisseur en double | Index unique fournisseur + numéro | Factures sans numéro ou à numéro proche |
| Double paiement | Contrôle du reste à payer, unicité chèque / effet | — |
| Suppression d'un paiement | Interdite par trigger, annulation par contre-pièce | — |
| Altération directe en base | Triggers et chaîne | Compte de connexion propriétaire des tables (C-08) |
| Minoration des recettes de caisse | Écart de fermeture comptabilisé | Report d'ouverture modifiable à la main dans l'écran hérité |

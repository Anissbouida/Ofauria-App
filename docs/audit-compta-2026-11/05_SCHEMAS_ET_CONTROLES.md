# Catalogue des schémas d'écritures et matrice des contrôles

Date : 24 novembre 2026. Livrables 7 (schémas d'écritures automatiques) et 8 (matrice des contrôles).

Ce document décrit l'**existant tel que lu dans le code**, avec en dernière colonne l'écart à corriger. `gen` désigne `server/src/services/journal-generator.service.ts`.

## 1. Schémas d'écritures automatiques

### Ventes

| Événement | Journal | Débit | Crédit | Transaction | Référence | Écart |
|---|---|---|---|---|---|---|
| Ticket de caisse payé | CA ou BQ | 5161 (espèces), 5141 net + 6147 commission (carte), 5111 (chèque), 7129 (remise), 4421 (avance reprise) | 7111 ou compte de la famille, 4455x | Même transaction, file si échec | gen:716-838 | TVA multi-taux en 4455 générique (C-02) |
| Ticket à crédit | VE | 3421 | 7111, 4455x | Idem | gen:727-746 | — |
| Encaissement d'un ticket à crédit | CA / BQ | Trésorerie | 3421, lettré | Idem | gen:609-627 | — |
| Annulation de ticket | Journal d'origine | Lignes inversées | | Bloquant | `sale.repository.ts:835` | — |
| Retour ou échange en caisse | CA | 7111 | 5161 | File si échec | gen:566-582 | Pas de TVA, pas de famille, toujours caisse (I-06) |
| Facture client | VE | 3421 (+ 4421 et 4455x si acompte repris) | 7111 ou famille, 4455x | File si échec | gen:398-450 | — |
| Facture d'acompte | VE | 3421 | 4421, 4455x | Idem | gen:344-365 | — |
| Avoir client | VE | 7111 ou 7129, 4455x | 3421 | Idem | gen:367-396 | — |
| Facture issue d'un ticket | — | Aucune écriture (déjà comptabilisé par le ticket) | | — | gen:264 | — |
| Bon de livraison | — | Aucune ; factures à établir en fin de période : 3427 / 7111, extournée | | Opération manuelle | `period-end.repository.ts:88` | — |
| Avance sur commande | CA / BQ | Trésorerie | 4421 | Même transaction | gen:751-764 | — |
| Avance acquise (commande non retirée) | OD | 4421 | 7111 | Transaction séparée | gen:548-559 | Non atomique |
| Encaissement client réparti | CA / BQ / OD | 5161, 5141, 5111, 5113 | 3421 par facture, reste en 4421, ± 6331 / 7331 | File si échec | gen:984-1055 | Produit sans catégorie → 7585 en silence |
| Affectation d'une avance | OD | 4421 | 3421 | — | gen:1193-1218 | — |
| Remise d'effets à l'encaissement ou à l'escompte | OD / BQ | 5520, 6311, 6147, 34552 | 5113, banque | Bloquant | `bill-portfolio.repository.ts` | — |
| Points de fidélité | OD | Profil `loyalty_cost` | Profil `loyalty_liability` | Erreur avalée | `loyalty.ts:57-76` | Pas de file (C-07) |
| Écart de caisse ou de TPE à la fermeture | OD | 6588 ou trésorerie | Trésorerie ou 7588 | File si échec | gen:1740-1781 | — |
| Escompte de règlement, bon cadeau | — | Fonction absente | | — | — | À créer |

### Achats

| Événement | Journal | Débit | Crédit | Transaction | Référence | Écart |
|---|---|---|---|---|---|---|
| Bon de commande | — | Aucune écriture ; engagement suivi par le budget | | — | `management.repository.ts:65` | — |
| Réception sans facture | AC | Charge de la catégorie, au prix de la commande | 4417 | File si échec | gen:462-517 | — |
| Facture fournisseur | AC | 4417 (réceptions soldées), charge, 3455x | 4411 | File si échec ; modification par extourne | gen:266-342 | Centime de TVA non absorbé |
| Avoir fournisseur | CA | 4411 | **5161** | File si échec | gen:1076-1078 | **Faux (C-01)** : devrait créditer la charge et la TVA |
| Paiement fournisseur | CA / BQ / OD | 4411, ± 6331 / 7331 | 5161, 5141, 5111 (chèque), 4415 (effet), 4452x (retenue) | File si échec ; annulation par extourne | gen:962-973, 1061-1126 | Chèque émis en 5111 (I-01) ; mode inconnu → caisse |
| Encaissement du chèque ou de l'effet émis | BQ | 5111 ou 4415 | 5141 | — | gen:1134-1178 | Jamais déclenché dans la simulation |
| Frais d'approche | AC | Charge (facture de frais) | 4411 | — | `landed-cost.repository.ts:229` | Capitalisation en stock non comptabilisée |
| Acompte fournisseur | — | Fonction absente | | — | — | À créer (3411) |
| Reversement des retenues à la source | OD | 4452x | 5141 ou 5161 | Bloquant | `withholding.repository.ts:150` | Origine marquée « manuelle » |

### Stocks et production

| Événement | Journal | Débit | Crédit | Transaction | Référence | Écart |
|---|---|---|---|---|---|---|
| Entrée, sortie, transfert de stock | — | Aucune écriture (inventaire intermittent) | | — | — | À rendre explicite par paramètre |
| Inventaire physique complet des matières | OD | 3121 ou 6124 | 6124 ou 3121 | File, non rejouable | `stock-count.repository.ts:290-316` | Tournant et emballages ignorés (I-04) |
| Pertes et rebuts | — | Aucune écriture | | — | gen:1707-1711 | Code d'extourne mort |
| Stock de produits finis en fin de période | OD | 3151 | 7132 | Opération manuelle | `period-end.repository.ts:137` | — |
| Production terminée (politique éteinte par défaut) | OD | 3151, 6124 | 7132, 3121 | Après commit, erreur avalée | `production-ledger.ts:34-65` | Incohérent avec les achats (I-05) |

### Paie

| Événement | Journal | Débit | Crédit | Transaction | Référence | Écart |
|---|---|---|---|---|---|---|
| Bulletin mensuel | OD | 6171 brut, 6174 charges patronales | 4441 (CNSS, AMO, allocations, formation), 4443 (CIMR), 44525 (IR), 3431 (retenues), 4432 (net) | **À la clôture du mois de paie seulement** | `payroll-ledger.service.ts:43-90` | C-06 |
| Paiement du salaire | CA / BQ | 6171 | Trésorerie | File si échec | gen:975 | — |
| Reclassement après paiement | OD | 4432 | 6171 | Erreur journalisée seulement | `employee.repository.ts:992` | — |
| Paie hebdomadaire ou par quinzaine | CA / BQ | 6171 | Trésorerie | — | `weekly-payroll.repository.ts` | Charges sociales jamais comptabilisées pour un non-déclaré |
| Avance sur salaire | CA / BQ | 3431 | Trésorerie | Bloquant | gen:980 | — |
| Retenue d'avance | OD | 6171 | 3431 | Bloquant | `salary-advance.repository.ts:357` | — |

### Immobilisations, trésorerie, clôture

| Événement | Journal | Débit | Crédit | Transaction | Référence | Écart |
|---|---|---|---|---|---|---|
| Acquisition | AC | 23xx via la catégorie de la ligne de facture | 4411 | — | `reception-voucher.repository.ts:296` | Fiche d'immobilisation sans lien d'écriture |
| Dotation mensuelle | OD | 619x | 28xx | Tâche planifiée, idempotente | `depreciation.service.ts:144` | — |
| Cession | OD | 28xx, 6513, 3481 | 23xx, 7513, 4455x | Bloquant | `depreciation.service.ts:476-542` | Pas de régularisation de TVA |
| Virement interne | CA / BQ | Compte de destination | Compte source | File si échec | gen:937-953 | — |
| Charge constatée d'avance | OD | 486 puis charge | Charge puis 486 | Bloquant | `prepaid-charge.repository.ts:81` | Numéro de compte du plan français |
| Écriture récurrente ou modèle | OD | Selon le modèle | | Bloquant | `journal-template.repository.ts:179` | Sans identifiant de pièce |
| Impôt sur les sociétés | OD | 6701, 3453 | 4453, banque | Bloquant | `corporate-tax.repository.ts:76` | — |
| Réévaluation des devises | OD | 3701, 3702, 6393 | 4701, 4702, 4506 | Bloquant ; contre-passation au 1er janvier | `fx-revaluation.repository.ts:60` | — |
| Transfert entre établissements | OD × 2 | 1811 | 1811 | Bloquant | `ledger-post.ts` | — |
| Rapprochement bancaire | — | Pointage seul | | — | `bank-reconciliation.repository.ts:350` | Frais bancaires non générés par défaut |
| Clôture d'exercice | AN | Soldes de bilan | Soldes de bilan, 1181 (résultat) | Fonction SQL | Migration 416 | Pas d'écritures de solde des classes 6 et 7 ; pas de réouverture |

### Schémas manquants

Liquidation de TVA, TVA en attente (régime de l'encaissement), avoir fournisseur, acompte fournisseur, escompte, versement d'espèces en banque guidé, pertes et rebuts, variation de stock d'emballages, provisions (créances, stocks), produits constatés d'avance, affectation du résultat, régularisation de commission carte.

## 2. Matrice des contrôles

Colonne « Force » : **Base** = contrainte ou trigger PostgreSQL ; **Appli** = code serveur seulement ; **Absent**.

| Contrôle | Force | Où | Défaut constaté |
|---|---|---|---|
| Débit = crédit par écriture | Base | Trigger `check_journal_entry_balance` | Sain |
| Une ligne n'a qu'un sens, montant positif | Base | Contraintes CHECK | Sain |
| Écriture validée non modifiable, non supprimable | Base | `trg_journal_entry_guard`, `trg_journal_line_guard` | Désactivable par le compte de connexion (C-08) |
| Correction par extourne | Appli | `reverseEntriesForSource` | Sain |
| Période verrouillée | Base | `check_period_lock` | Contourné en amont par le redatage (C-11) |
| Exercice clos définitif | Base | Trigger de la migration 416 | Sain ; aucune réouverture prévue |
| Numérotation continue | Base | `journal_sequences` | Sain ; contention (I-20) |
| Unicité pièce → écriture | Base | Index `uq_je_source` | Sans effet pour les écritures sans identifiant de pièce |
| Chaîne d'empreintes | Base + tâche | `fn_ledger_seal` toutes les 15 min | Vérification non planifiée |
| Journal d'audit des écritures | Base | `ledger_audit_log`, ajout seul | Sain |
| Journal d'audit du paramétrage | Base | `log_config_change` | Non branché sur profils, journaux, règles bancaires |
| Compte actif, tiers obligatoire sur collectif | Appli | `persistEntry` | Sain |
| Lettrage soldé, un compte, un tiers | Base | Trigger différé | Sain |
| Ventilation analytique = montant de la ligne | Base | Trigger différé | Non obligatoire par compte |
| Pièce comptabilisée | Appli | `postOrQueue` | Tolérant par défaut, rejeu manuel (C-07) |
| Doublon de facture fournisseur | Base | Index unique fournisseur + numéro | Factures sans numéro |
| Double paiement | Appli + Base | Reste à payer, unicité chèque / effet | Sain |
| Suppression de paiement | Base | Trigger | Sain |
| Plafond des règlements en espèces | Appli | `fiscal_thresholds` datée | Sain |
| Dépassement budgétaire | Appli | `budget-control.rules.ts` | Par compte seulement |
| Séparation des tâches par document | Base | Triggers de la migration 442 | Mode avertissement par défaut (C-09) |
| Séparation des tâches par rôle | Appli | `governance.ts` | Rapport seulement |
| Approbation | Appli | `approval.service.ts` | Ni OD, ni RIB, ni paiement unitaire |
| Droit par route | Appli | `can(...)` | Présent partout ; droits fourre-tout |
| Cloisonnement par établissement | Base | RLS `p_store_scope` | Éteint par défaut, inopérant en superutilisateur |
| Contrôles de clôture mensuelle | Base | `fn_close_checklist` | Ignore la paie et la TVA |
| Cohérence bilan, CPC, ESG | Appli | `liasse.rules.ts:380` | Non bloquante pour l'EDI |
| Code de TVA obligatoire | Absent | — | C-05 |
| TVA déclarée = soldes comptables | Absent | — | C-03 |
| Paie du mois comptabilisée | Absent | — | C-06 |
| Solde de caisse plausible, banque non créditrice | Absent | — | I-02 |
| Triggers comptables tous actifs | Absent | — | C-08 |
| Rapprochement auxiliaire ↔ général | Appli | `v_reconciliation_check` | À la demande |
| Grand livre = tableaux de bord | Absent | — | C-10 |
| Date de pièce cohérente avec la date de saisie | Absent | — | Antidatage |
| Double validation d'un RIB | Absent | — | C-09 |

### Contrôles à rendre non désactivables

Équilibre, gel des écritures validées, continuité de la numérotation, verrou d'exercice clos, chaîne d'empreintes, journal d'audit, code de TVA d'une société assujettie, comptabilisation de la paie avant clôture, file d'événements vide avant clôture.

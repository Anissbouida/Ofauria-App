# Plan d'action technique — module comptable et financier

Date : 24 novembre 2026. Complète `06_FEUILLE_DE_ROUTE.md` : même découpage en lots, avec pour chaque étape ce qui est modifié, où, et comment on le vérifie.

Statut : **plan à valider**. Rien n'est commencé.

## Avancement au 25 novembre 2026 et écarts par rapport au plan

Branche `claude/kalum-accounting-finance-module-a25fcb`, rebasée sur `main` (migrations 663 et 664 prises par d'autres sessions : les migrations de ce plan sont **665 à 669** (lot A) et **683 à 686** (lot C) (663 et 664 prises par des sessions production)). Rien n'est poussé sur `origin`, `main` n'est pas avancé et la base de dev `ofauria_db` n'est pas migrée.

| Étape | État | Écart par rapport au plan |
|---|---|---|
| 0 Jeu de référence | Livré | — |
| 1 Mode inconnu refusé | Livré | — |
| 2 Avoir fournisseur | **Partiel** | L'écriture est corrigée (4411 D / charge C / TVA récupérable C au prorata de la facture soldée), sans caisse. Le **document d'avoir** (écran, numérotation AVF, imputation) n'est pas fait : le plan a découvert que l'avoir client existe déjà (mig 450, `credit-note.repository.ts`) et qu'il faut le généraliser plutôt que créer une structure parallèle. À reprendre avec ce modèle. Script de reprise `repost-supplier-avoirs.ts` livré (0 avoir en base de dev) |
| 3 TVA par taux | Livré, **variante** | Une ligne par taux sur le ticket ; 4455 / 3455 lus par la déclaration ; contrôle de clôture bloquant. Un taux inconnu **n'est pas refusé** : il retombe sur le compte générique, désormais visible et bloquant à la clôture (refuser aurait empêché de vendre) |
| 4 Taux en dur | Livré | Taux légaux datés dans le pack pays (mig 668), un seul tableau taux → compte, garde automatique |
| 5 File rejouée | Livré | Fidélité et production gardent leur propre capture d'erreur (à convertir) ; écran « À comptabiliser » non fait (le bloc de la clôture reste) |
| 6 Retenues à la source | Livré | `source_kind` des reversements non modifié (la valeur `manual` + `source_detail` suffit à les identifier) |
| 7 Extournes dans les états | Livré pour 2 états | Vue `v_ledger_lines` et garde de lecture non faites |
| 8 Redatage tracé | Livré | — |
| 9 Tests manquants | **Partiel** | Faits : numérotation concurrente, chaîne altérée, verrou de période, invariant aléatoire. Restent : clôture d'exercice et à-nouveaux, fermeture de caisse → écriture, sécurité HTTP des routes |
| 10 Surveillance | Livré | — |
| 19 Droits fins | Livré | Quinze droits fins (dix suppressions, cinq annulations) ; mig 683 recopie rôles et exceptions par utilisateur, aucun accès ne change. Côté écran, le filtre de rôle en dur d'`AccountingPage.tsx` (I-19) n'est pas encore remplacé par les droits |
| 20 Rôle PostgreSQL | **Non fait, à votre demande** | Reste à planifier avec une répétition sur copie de la production |
| 21 Approbation des OD | Livré | Type de pièce `journal_entry`, règle `od_montant_eleve` (50 000 DH) semée **désactivée** (mig 684) ; tant qu'elle ne l'est pas, rien ne change |
| 22 RIB sous contrôle | Livré pour les fournisseurs | Règle `rib_change` **active** : le changement du RIB d'un fournisseur déjà pourvu d'un RIB part à approbation d'un administrateur (mig 685). Gel des paiements livré mais à 0 jour par défaut ; non testé de bout en bout. RIB des salariés non traité |
| 23 SoD et audit | Livré | Audit sur cinq tables de paramétrage ; `purchasing.sod_mode` passe à `block_except_admin` **seulement sur une base sans aucune pièce d'achat** (mig 686), les installations qui travaillent déjà gardent `warn` avec un avertissement dans le bilan de santé. Droits fins aussi pour la SoD par rôle : non fait |
| 11 à 18, 24 à 30 | Non commencés | Lot B (attend l'expert-comptable), lots D et E |

## Comment lire ce plan

- Les étapes sont numérotées dans l'ordre d'exécution. Une étape = un commit, testable seul.
- Les étapes 1 à 30 (lots A à E) sont décrites au niveau du fichier et de la fonction. Les lots suivants sont décrits plus brièvement : leur détail dépend de ce que les premiers lots auront établi.
- `gen` désigne `server/src/services/journal-generator.service.ts`.
- Les numéros de migration partent de **663** (dernier sur `main` : 662). Ils sont à reprendre au moment de chaque commit : d'autres sessions en consomment.
- **[À valider]** : l'étape ne se code pas avant l'avis de l'expert-comptable (questions en fin de `02_CONFORMITE_MAROC.md`).
- **[À confirmer à la lecture]** : le code concerné n'a pas été relu en entier pendant l'audit ; l'étape commence par cette lecture.

### Règles valables pour toutes les étapes

| Règle | Application |
|---|---|
| Migration additive | Nouvelles tables, colonnes nullables ou avec valeur par défaut. Chaque migration a son script inverse dans `server/migrations/rollback/`. |
| Aucune écriture validée réécrite | Toute reprise passe par `reverseEntriesForSource` puis régénération, sur exercice ouvert, après accord explicite. |
| Tests | Test d'intégration dans `server/src/__tests__/db/`, puis `npm run test:db` complet, puis `npx tsc -b` côté client si un écran change. |
| Vérification à l'écran | Sur `localhost:5173`, après commit et avance de `main`. |
| Déploiement | Aucun push sans accord : un push sur `main` déploie en production. |

---

## Étape 0 — Jeu de référence

**But.** Pouvoir prouver, après chaque étape, ce qui a changé dans les chiffres et rien d'autre.

**Ajout.** Script `server/scripts/ledger-baseline.ts` (lecture seule) qui écrit dans un fichier JSON : la balance par compte, le nombre d'écritures par journal et par origine, les totaux débit et crédit, le dernier rang de la chaîne. Paramètre : l'URL de la base.

**Usage.** Exécuté sur `ofauria_db` avant le lot A (valeurs attendues : 111 397 écritures, 4 869 901,19 au débit et au crédit). Rejoué après chaque étape ; tout écart doit être expliqué par l'étape.

**Test.** Deux exécutions successives donnent le même fichier.

---

## Lot A — Correctifs sans décision à prendre

### Étape 1 — Refuser un mode de règlement inconnu (C-01)

**Constat.** Dans `fromPaymentEmission` (`gen:1063-1078`), le `switch` sur `payment_method` a un `default` qui impute en caisse (5161, journal CA). Même repli dans la branche des encaissements.

**Modification.**
- Remplacer les deux `default` par une levée d'erreur : `throw Object.assign(new Error('Mode de règlement non pris en charge : …'), { statusCode: 422 })`.
- Sortir la table de correspondance mode → (compte, journal) dans une constante exportée `PAYMENT_METHOD_POSTING`, pour que le test énumère les modes.
- Vérifier la contrainte CHECK de `payments.payment_method` et l'aligner sur cette table (migration 663 si un mode y figure sans être géré).

**Effet.** Avec le mode `outbox` actuel, une pièce au mode inconnu part dans la file avec un message clair au lieu de fausser la caisse.

**Tests.** Unitaire : chaque mode connu donne son compte ; un mode inconnu lève. Intégration : un paiement `avoir` ne produit plus d'écriture 5161 (échec attendu tant que l'étape 2 n'est pas faite, donc étapes 1 et 2 livrées ensemble).

### Étape 2 — Avoir fournisseur comme document (C-01)

**Constat.** L'avoir est un second `payments` de mode `avoir` (`accounting.repository.ts:2720-2740`), comptabilisé 4411 / 5161.

**Modèle de données — migration 663.**
- `invoices.credit_note_of UUID REFERENCES invoices(id)` et `invoices.document_kind VARCHAR(20) NOT NULL DEFAULT 'invoice' CHECK (document_kind IN ('invoice','credit_note'))`. Un avoir fournisseur = une ligne `invoices` de type `received`, `document_kind = 'credit_note'`, avec ses `invoice_items` (catégorie et code de TVA par ligne). **[À confirmer à la lecture]** : l'avoir client utilise peut-être déjà une colonne équivalente ; dans ce cas la réutiliser.
- Séquence de numérotation `AVF-AAAA-NNNN` dans la table de numérotation existante.
- `payment_allocations` : autoriser l'imputation d'un avoir sur une facture (colonne `credit_note_id`), ce qui remplace le paiement de mode `avoir`.

**Serveur.**
- `gen` : nouvelle fonction `fromSupplierCreditNote(client, invoiceId)`. Schéma : 4411 au débit (auxiliaire fournisseur) ; au crédit, les comptes de charge par ligne (`resolveCategoryAccountCode`) et la TVA récupérable par taux (`tvaGroupsForInvoice(…, 'deductible')`). Si l'avoir porte sur une réception non encore facturée, crédit de 4417 à la place de la charge. Journal AC, `source_kind = 'credit_note'`.
- `fromInvoice` (`gen:250-266`) : aiguiller `document_kind = 'credit_note'` vers cette fonction au lieu de renvoyer `null` quand le total est négatif.
- `accounting.repository.ts` : la branche « avoir déduit » du règlement crée désormais l'avoir (ou rattache un avoir existant) et une `payment_allocation`, sans `payments`. L'imputation ne génère aucune écriture : l'avoir a déjà mouvementé 4411 ; le lettrage facture / avoir / règlement se fait par `autoLettrer`.
- Routes : `POST /invoices/:id/credit-notes`, `GET /credit-notes`, protégées par `can('accounting', 'create')` et un validateur zod.
- `replayOutbox` : `credit_note` rejouable.

**Client.** Écran « Avoirs fournisseurs » (Comptabilité › Opérations) au gabarit Liste + fiche, et bouton « Créer un avoir » sur la fiche de facture fournisseur. La case « avoir déduit » du règlement devient un choix d'avoir existant.

**Reprise.** Script `server/src/scripts/repost-supplier-credit-notes.ts`, à lancer à la main : pour chaque `payments` de mode `avoir`, crée l'avoir correspondant, extourne l'écriture 4411 / 5161 et passe la bonne. Mode simulation par défaut (liste ce qui serait fait). Aucun avoir de ce type dans la base simulée ; à compter en production avant de lancer.

**Tests.** Intégration : avoir multi-lignes à deux taux → écriture équilibrée, charge et TVA réduites, caisse intacte ; avoir puis règlement du solde → facture lettrée ; annulation de l'avoir → extourne.

### Étape 3 — Une ligne de TVA par taux (C-02)

**Constat.** `tvaAccountForRate` (`gen:104-118`) ne connaît que 20, 14, 10 et 7. Un ticket multi-taux est comptabilisé au taux moyen (`gen:805-807`) et part en 4455 générique. Les factures avec détail par ligne passent déjà par `tvaGroupsForInvoice`.

**Modèle de données — migration 664.**
- `tax_codes` : ajout de `collected_account_code VARCHAR(20) REFERENCES accounts(code)` et `deductible_account_code VARCHAR(20) REFERENCES accounts(code)`, remplis pour les codes existants (N20 → 44551 / 34552, R10 → 44553 / 34554, R14 et R7 conservés pour l'historique).
- `accounts` : renseigner `tva_direction` sur 4455 (`collected`) et 3455 (`deductible`), avec `tva_rate` NULL, pour qu'ils n'échappent plus à la déclaration.

**Serveur.**
- `gen` : `tvaAccountForRate(rate, direction)` devient `taxAccount(client, { taxCode?, rate, direction, date })`, qui lit `tax_codes` à la date de l'écriture ; les numéros en dur disparaissent. Un taux absent de la table lève une erreur au lieu de retomber sur le compte générique.
- `gen` : nouvelle fonction `tvaGroupsForSale(client, saleId)` qui regroupe la TVA des lignes du ticket par code de taxe (les lignes de vente portent le code de taxe du produit depuis la migration 480 **[À confirmer à la lecture]**). `fromSale` émet une ligne de TVA par groupe ; le centime d'écart entre la somme des lignes et la TVA d'en-tête est porté sur le groupe le plus élevé, et tracé dans le libellé.
- `ledger.repository.ts` `declaration` : ligne supplémentaire « Sans taux » pour les comptes à `tva_rate` NULL, et champ `unclassified_amount` dans la réponse.
- `fn_close_checklist` (migration 664) : contrôle bloquant `vat_unclassified` si ce montant est non nul sur la période.

**Client.** `TvaTab.tsx` : ligne « Sans taux » en rouge et alerte tant qu'elle n'est pas nulle (planche « Déclaration de TVA » de la maquette).

**Tests.** Ticket à 20 % et 10 % → deux lignes de TVA, total = TVA du ticket ; déclaration = somme des comptes ; taux inconnu → erreur.

### Étape 4 — Plus aucun taux de TVA en dur (C-02)

**Modification.** Remplacer les listes `[7, 10, 14, 20]` par une lecture de `tax_codes` valides à la date : `ledger.repository.ts:966`, `depreciation.service.ts:365`, `dgi-edi.service.ts:156`, `country-pack.ts:50`, et la contrainte de la migration 606 (ligne 88).

**Garde.** Ajouter au test de garde existant (celui qui refuse « DH » en dur) une règle qui refuse un tableau littéral de taux de TVA dans `server/src`.

**Tests.** `tva.test.ts` et `dgi-edi.test.ts` adaptés ; un code de taxe fermé au 31 décembre 2025 est refusé sur une pièce de 2026.

### Étape 5 — File d'écritures rejouée et rejouable (C-07)

**Constat.** `replayOutbox` (`ledger-posting.service.ts:101-146`) n'est appelé que par `ledger.controller.ts:329`. Types non gérés : `stock_count`, `loyalty`, `advance_repayment`, `shift_entry`.

**Modèle de données — migration 665.**
- `ledger_outbox` : `next_attempt_at TIMESTAMPTZ`, `notified_at TIMESTAMPTZ`, `error_code VARCHAR(40)`.
- `scheduled_jobs` : ligne `ledger_outbox_replay`, toutes les 15 minutes, domaine `accounting`.

**Serveur.**
- `ledger-posting.service.ts` : remplacer la chaîne de `if` par un registre `REPLAYERS: Record<string, (client, item, userId) => Promise<void>>`. Ajouter les quatre types manquants (appel des générateurs déjà utilisés par `stock-count.repository.ts:290-316`, `loyalty.ts:57-76`, `salary-advance.repository.ts:354-368` et la saisie par shift).
- Délai croissant entre tentatives (15 min, 1 h, 6 h, puis une fois par jour) via `next_attempt_at`.
- `error_code` : classer l'erreur (`MISSING_ACCOUNT`, `PERIOD_CLOSED`, `MISSING_PRICE`, `MISSING_AUXILIARY`, `OTHER`) pour que l'écran propose la bonne action.
- `scheduler.ts` : `JOBS.ledger_outbox_replay`, qui appelle `replayOutbox` avec l'utilisateur système, puis `createNotification` (`utils/notify.ts`) aux détenteurs du droit `accounting.post` pour les pièces en échec non encore notifiées.
- `loyalty.ts:63-78` et `production-closing.ts:16-25` : remplacer la capture d'erreur locale par `postOrQueue`.
- `listOutbox` : libellé de document pour tous les types.

**Client.** Nouvel écran « À comptabiliser » (planche 2 de la maquette), compteur dans le menu ; le bloc actuel de `ClotureTab.tsx:105-135` devient un renvoi vers cet écran.

**Tests.** Un test par type : mise en file, correction de la cause, rejeu, écriture présente. Test du délai et de la notification unique.

### Étape 6 — État des retenues à la source (I-07)

**Modification.** `withholding.repository.ts:75-96` : passer les deux `LEFT JOIN` en sous-requête filtrée (ou `SUM(…) FILTER (WHERE je.id IS NOT NULL)`), avec `je.status IN ('posted','reversed')`. Dans `persistReversement` (ligne 152), `source_kind = 'withholding_remittance'` au lieu de `manual` (ajout à la contrainte CHECK de `journal_entries.source_kind`, migration 666).

**Tests.** Retenue en septembre, reversement en octobre : l'état de septembre montre le montant retenu, celui d'octobre le reversement ; un brouillon n'est pas compté.

### Étape 7 — États qui ignorent les écritures extournées (I-08)

**Modification.** `hr-analytics.repository.ts:65` et `cash-forecast.ts:64, 80` : `status IN ('posted','reversed')`. `fn_close_checklist` (migration 666) : les `EXISTS … status = 'posted'` des lignes 178, 185 et 250 de la migration 452 excluent les extournes (`reversal_of_entry_id IS NULL`).

**Prévention.** Vue `v_ledger_lines` (lignes des écritures validées et extournées, avec date, journal, magasin) et test de garde qui refuse `status = 'posted'` seul dans une requête sur `journal_entries` hors liste blanche.

**Tests.** Facture modifiée après validation : chiffre d'affaires RH et solde d'ouverture de la prévision inchangés.

### Étape 8 — Redatage tracé (C-11)

**Modèle de données — migration 667.**
- `journal_entries.document_date DATE` : date de la pièce d'origine, renseignée par `persistEntry` pour toute écriture automatique. Hors empreinte de chaîne (colonne ajoutée après scellement ; la garde `trg_journal_entry_guard` l'autorise à l'insertion seulement).
- Événement `redated` dans `ledger_audit_log`.
- Paramètre `ledger.closed_period_policy` dans `parameters-catalog.ts` : `redate` (défaut, comportement actuel) ou `refuse`.

**Serveur.** `persistEntry` (`gen:1255-1256`) : conserver `entry.entry_date` dans `document_date` avant l'appel à `fn_accounting_date` ; si la date change, journaliser, ou lever une erreur 409 en politique `refuse` (la pièce part alors dans la file avec `PERIOD_CLOSED`). Même traitement dans l'extourne (`gen:1523`).

**Client.** `EcrituresTab.tsx` : étiquette « Redatée » et date de la pièce dans le détail (planche 5).

**Tests.** Pièce datée d'un mois fermé : écriture au premier jour ouvert, `document_date` conservée, événement présent ; en politique `refuse`, erreur et mise en file.

### Étape 9 — Tests manquants (C-12)

Ajouts dans `server/src/__tests__/db/` :

| Fichier | Ce qu'il vérifie |
|---|---|
| `fiscal-year-close.db.test.ts` | Clôture d'exercice : à-nouveaux équilibrés, résultat en 1181, mois verrouillés, seconde clôture refusée |
| `period-lock.db.test.ts` | Insertion et validation refusées en période verrouillée ; clôture séquentielle |
| `ledger-chain.db.test.ts` | `fn_ledger_verify` détecte une ligne modifiée triggers coupés, une suppression en milieu de chaîne |
| `cash-closure-ledger.db.test.ts` | Fermeture de caisse : écart espèces et écart TPE comptabilisés, sans écart aucune écriture |
| `ledger-invariant.db.test.ts` | Après 200 opérations tirées au hasard (ventes, achats, paiements, annulations, avoirs) : débit = crédit, comptes de tiers = pièces, aucune pièce sans écriture ni événement en file |
| `ledger-numbering-concurrency.db.test.ts` | 20 validations simultanées sur un journal : numéros uniques et sans trou |
| `ledger-routes-security.test.ts` | Chaque route d'écriture de `/ledger` : 401 sans session, 403 sans le droit |

Le tirage au hasard utilise une graine fixe affichée en cas d'échec, sans nouvelle dépendance.

### Étape 10 — Surveillance des protections (C-08)

**Modèle de données — migration 668.** Fonction `fn_ledger_guards_status()` qui renvoie, pour une liste fixe de triggers comptables (`trg_journal_entry_guard`, `trg_journal_line_guard`, `trg_check_journal_entry_balance`, `trg_check_period_lock`, les deux triggers d'audit), leur état dans `pg_trigger` (`tgenabled`). Ligne `ledger_guards_check` dans `scheduled_jobs` (15 minutes).

**Serveur.** `ledger-integrity.repository.ts` : `checkGuards()` appelle la fonction, lance `fn_ledger_verify` sur les écritures scellées depuis la dernière vérification, écrit le résultat dans `ledger_audit_log` (événement `guards_check`) et notifie en cas d'anomalie. Ajout à `JOBS`.

**Contrôle de clôture.** `fn_close_checklist` : ligne bloquante `ledger_guards` si la dernière vérification date de plus d'une heure ou a échoué.

**Limite.** Un superutilisateur peut aussi désactiver cette tâche : la vraie barrière est l'étape 20 (rôle PostgreSQL).

**Tests.** Trigger désactivé dans une transaction de test : `checkGuards` le signale.

---

## Lot B — Conformité fiscale et sociale

### Étape 11 — Statut fiscal et code de TVA obligatoires (C-05)

**Modèle de données — migration 669.**
- `legal_entities` (ou `company_settings` tant que le multi-sociétés n'est pas livré) : `vat_status VARCHAR(20) CHECK (vat_status IN ('liable','exempt','out_of_scope'))`, NULL tant que non choisi ; `vat_period VARCHAR(10) CHECK (… IN ('monthly','quarterly'))`.
- Contrôle `vat_missing_codes` dans `fn_close_checklist` : nombre d'articles vendus ou achetés sur la période sans code de taxe ; bloquant pour une société `liable`.
- Contrôle `vat_zero` : société `liable`, ventes non nulles, TVA collectée nulle ; bloquant.

**Serveur.** Validateurs des produits, matières, lignes de facture et lignes de commande : code de taxe requis si `vat_status = 'liable'`. `setup-status.ts` : étape « Statut fiscal » dans l'assistant d'installation.

**Client.** Champ obligatoire dans les fiches ; écran de rattrapage « Articles sans code de TVA » (liste avec saisie en masse).

**Migration des données.** Aucune valeur imposée : les articles existants restent sans code et apparaissent dans le rattrapage.

**Tests.** Société assujettie : création d'un produit sans code refusée ; clôture bloquée par un ticket sans TVA.

### Étape 12 — Régime de TVA et comptes d'attente (C-04) **[À valider]**

**Décision attendue.** Régime proposé par défaut, numéros des comptes de TVA en attente, traitement des paiements partiels.

**Modèle de données — migration 670 (esquisse).** `vat_regime` et `vat_regime_since` déplacés du paramètre global vers la société, sans valeur par défaut. `tax_codes` : `collected_pending_account_code`, `deductible_pending_account_code`.

**Serveur (esquisse).** En régime de l'encaissement : `fromInvoice` et le ticket à crédit créditent le compte de TVA en attente ; `fromPaymentEmission` et l'encaissement génèrent une écriture de reclassement vers le compte de TVA exigible, au prorata du montant réglé (`source_detail = 'vat-release:<paymentId>'`, extournée avec le règlement). La déclaration lit alors uniquement les comptes exigibles : le calcul hors comptabilité de `ledger.repository.ts:894-940` est supprimé.

**Tests.** Facture réglée en deux fois sur deux mois : TVA exigible répartie sur les deux déclarations, compte d'attente soldé.

### Étape 13 — Liquidation et crédit reporté (C-03) **[À valider]**

**Modèle de données — migration 671.** Table `vat_returns` : société, période, régime, bases et taxes par taux (JSONB), `credit_brought_forward`, `amount_due`, `credit_carried_forward`, `status` (`draft`, `filed`), `entry_id`, auteur et dates. Unicité (société, période).

**Serveur.** Nouveau `vat-return.repository.ts` : `compute(period)` (à partir des soldes des comptes de TVA, crédit repris de la déclaration précédente), `file(period)` qui passe l'écriture de liquidation par `postManualEntry` (comptes de TVA exigible au débit, récupérable au crédit, solde en 4456 ou en crédit de TVA) avec `source_detail = 'vat-return:<id>'`, `reopen`. Contrôle de clôture `vat_return_missing`.

**Client.** `TvaTab.tsx` : panneau « Liquidation » (planche 3).

**Tests.** Mois créditeur puis mois débiteur : crédit repris ; soldes des comptes de TVA nuls après liquidation.

### Étape 14 — Prorata de déduction **[À valider]**

**Modèle de données — migration 672.** Table `vat_prorata` (société, année, numérateur, dénominateur, taux, statut provisoire ou définitif).

**Serveur.** Le taux de l'année s'applique à la TVA récupérable dans `fromInvoice` : la part non récupérable est ajoutée à la charge (ligne supplémentaire sur le compte de charge). Calcul de fin d'année à partir des ventes par code de taxe ; écriture de régularisation si l'écart entre taux provisoire et définitif le demande.

**Tests.** Prorata de 48 % : 480 récupérables et 520 en charge sur 1 000 de TVA.

### Étape 15 — Paie comptabilisée à la validation (C-06) **[À valider]**

**Constat.** `payrollLedger.postMonth` n'est appelé que par `closePeriod` (`payroll-config.controller.ts:116`).

**Décision attendue.** Moment de comptabilisation : validation du bulletin, ou clôture du mois de paie rendue obligatoire avant la clôture comptable.

**Modification, dans les deux cas.**
- `fn_close_checklist` (migration 673) : contrôle bloquant `payroll_unposted` — bulletins du mois sans écriture `payroll-accrual`, avec le montant des charges non comptabilisées.
- Si « à la validation » : `employee.repository.ts`, à la validation d'un bulletin, appelle `buildAccrualEntry` + `persistEntry` via `postOrQueue` ; `postMonth` devient un rattrapage idempotent.
- Paies hebdomadaires et par quinzaine des salariés non déclarés : hors périmètre des charges sociales ; à documenter dans l'écran.
- `employee.repository.ts:992-995` : le reclassement 4432 / 6171 passe par `postOrQueue` au lieu d'un `try/catch` avec simple journalisation.

**Reprise.** Bouton « Comptabiliser la paie » par mois, sur exercice ouvert (planche 1). Sur la base simulée : 72 bulletins, 123 898 DH de charges à constater.

**Tests.** Bulletin validé : comptes 4441 et 44525 mouvementés ; paiement : 4432 soldé ; clôture bloquée sans écriture de paie.

### Étape 16 — Retenues à la source après la loi de finances 2026 **[À valider]**

**Modèle de données — migration 674.** `withholding_tax_types` : `valid_from`, `valid_to`, `beneficiary_kind` (personne morale, personne physique, non-résident), `payer_condition` (JSONB : qualité du payeur, seuil de chiffre d'affaires), `base` (hors taxe ou TTC). Nouveaux types selon l'avis reçu (5 % sur loyers professionnels, 5 % sur prestations de personnes morales, retenue de TVA à 75 % ou 100 %).

**Serveur.** Calcul de la retenue proposé à la saisie du paiement (aujourd'hui saisie libre, `gen:1097`) ; état par bénéficiaire pour la déclaration annuelle.

### Étape 17 — Droit de timbre sur les règlements en espèces **[À valider]**

Selon la décision : activer `utils/tva.ts:78` dans `fromSale` pour les tickets en espèces (ligne de crédit sur un compte de droits de timbre à payer), ou retirer le paramètre inerte.

### Étape 18 — Chèques émis (I-01) **[À valider]**

**Constat.** Le chèque émis est crédité en 5111 (`gen:1072`), compte des chèques reçus.

**Modification selon l'avis.** Compte dédié aux chèques émis non débités, soldé au rapprochement bancaire ; l'écriture d'encaissement (`gen:1134-1178`) est déclenchée par le pointage du relevé. Reprise des 151 écritures de la base simulée par reclassement.

---

## Lot C — Sécurité et gouvernance

### Étape 19 — Droits fins (C-09)

**Modification.** `shared/src/constants/permissions.ts` : remplacer `accounting.delete` et `accounting.cancel` par des droits par action (`ledger.entry.draft_delete`, `ledger.entry.reverse`, `ledger.lettrage.undo`, `ledger.account.delete`, `ledger.template.delete`, `invoice.delete`, `payment.void`…). Migration 675 : report des droits existants vers les nouveaux pour chaque rôle, afin que personne ne perde un accès. Mise à jour des routes (`accounting.routes.ts:143-193`, `ledger.routes.ts:87-586`) et de l'instantané `route-rights.snapshot.json`.

**Client.** `AccountingPage.tsx:361` : remplacer le test de rôle `admin` / `manager` par les droits, écran par écran (I-19).

### Étape 20 — Rôle PostgreSQL applicatif (C-08)

**Constat.** Le script `server/scripts/l0-pg-roles-separation.sql` existe mais se joue à la main.

**Modification.**
- Le transformer en étape de déploiement : rôle `kalum_owner` (propriétaire, utilisé par les migrations seulement) et rôle `kalum_app` (connexion de l'application : `SELECT/INSERT/UPDATE/DELETE` sur les tables, `EXECUTE` sur les fonctions, sans `ALTER`, sans `TRIGGER`, `NOSUPERUSER`, `NOBYPASSRLS`).
- `server/src/config/database.ts` : deux URL (`DATABASE_URL` pour l'application, `MIGRATION_DATABASE_URL` pour les migrations).
- Tests : les fichiers qui utilisent `session_replication_role = 'replica'` pour nettoyer passent par un rôle de test distinct.

**Risque.** C'est l'étape la plus délicate du plan : à répéter sur une copie de la production, avec retour arrière documenté (rebasculer `DATABASE_URL`). Elle demande une intervention sur Cloud SQL et Secret Manager, donc votre accord explicite au moment de l'exécution.

### Étape 21 — Approbation des écritures manuelles (C-09)

**Modification.** `approval-handlers.ts` : nouveau type de pièce `journal_entry`. `manual-entry.repository.ts:147` : si une règle `approval_rules` s'applique (montant, journal), la validation crée une demande et l'écriture reste en brouillon ; l'approbation la valide avec l'approbateur comme `posted_by`. Le créateur ne peut pas approuver (déjà garanti par `approval.service.ts:297`). Migration 676 : règle par défaut semée, désactivée tant qu'elle n'est pas réglée.

### Étape 22 — Changement de RIB sous contrôle (C-09)

**Modèle de données — migration 677.** Table `bank_detail_changes` (tiers ou salarié, ancien et nouveau RIB, demandeur, approbateur, statut, dates). `suppliers.rib_effective_at`.

**Serveur.** La modification du RIB (`accounting.routes.ts:73` et la fiche salarié) crée une demande au lieu d'écrire le champ ; un second utilisateur l'approuve. `payment-run.repository.ts:127-155` : refuser une ligne dont le RIB a moins de N jours (paramètre `payment.rib_freeze_days`) ou afficher l'avertissement à l'approbateur de la campagne.

### Étape 23 — Séparation des tâches bloquante, audit du paramétrage

Migration 678 : `sod_document_rules` en mode `block` pour les nouvelles installations (les installations existantes gardent leur réglage, avec une alerte dans l'état du paramétrage). Triggers `log_config_change` sur `posting_profiles`, `journals`, `bank_rules`, `treasury_accounts`, `expense_categories.account_code`.

---

## Lot D — Une seule vérité comptable

### Étape 24 — Indicateurs lus sur le grand livre (C-10)

**Serveur.** Nouveau `ledger-kpi.repository.ts` : résultat de la période, trésorerie par compte, créances et dettes, charges par nature, à partir de `v_ledger_lines` et de `fn_ledger_window_start`. `dashboard.repository.ts:33-142, 287-428` et `paymentRepository.summary` (`accounting.repository.ts:3017-3052`) l'appellent au lieu de lire `payments` et `invoices`.

**Critère.** Résultat de l'écran Résumé = résultat du CPC, au centime, testé.

### Étape 25 — Écran Caisse sur le compte 5161

`AccountingPage.tsx:170-212` (`buildDailyData`) et `1894` (`ReportOverrideModal`) : le solde vient du serveur (solde du compte de caisse par jour) ; le report modifiable à la main est supprimé. Les données de surcharge existantes sont conservées en lecture pour l'historique.

### Étape 26 — Contrôle de cohérence planifié

Tâche `ledger_consistency` (quotidienne) : `v_reconciliation_check`, pièces sans écriture ni événement en file, comptes de trésorerie anormaux (caisse créditrice, banque créditrice, caisse au-dessus d'un seuil paramétrable). Résultat sur le tableau de bord comptable et en notification.

---

## Lot E — Moteur comptable unique

Trajectoire décrite dans `04_ARCHITECTURE_CIBLE.md` § 7. Aucune écriture produite ne doit changer pendant ce lot.

### Étape 27 — Résolveur de comptes

**Modèle de données — migration 679.** Tables `posting_rule_sets` et `posting_rules` (colonnes dans `04_ARCHITECTURE_CIBLE.md` § 3). Un jeu « Socle » version 1, actif, semé avec **les valeurs actuellement en dur** : une règle par défaut par couple (type d'événement, rôle de ligne). `posting_profiles` est conservée et lue comme source de repli pendant une version.

**Serveur.** Nouveau `server/src/services/posting-rules.ts` : `resolveAccount(client, { eventType, lineRole, date, storeId?, categoryId?, productId?, partnerId?, paymentMode?, … })`. Résolution : règles actives à la date, critères tous satisfaits, la plus spécifique puis la plus prioritaire ; égalité = erreur de conflit. Cache par transaction.

Dans `gen`, chaque littéral de compte (environ 60) devient un appel au résolveur, événement par événement, dans cet ordre : règlements, ventes, achats, écarts de caisse. Puis les autres fichiers : `payroll-ledger.service.ts`, `production-ledger.ts`, `stock-count.repository.ts`, `salary-advance.repository.ts`, `depreciation.service.ts`, `withholding.repository.ts`, `period-end.repository.ts`, `fx-revaluation.rules.ts`, `corporate-tax.repository.ts`, `bill-portfolio.repository.ts`.

**Critère de fin.** Étape 28.

### Étape 28 — Simulation de non-régression

`server/scripts/simulate-posting.ts` : rejoue en mémoire les générateurs sur toutes les pièces d'une période et compare ligne à ligne aux écritures existantes (hors numéro et date de saisie). Sortie : identiques, différentes, en échec, écart par compte. Rien n'est écrit.

**Critère.** 100 % d'écritures identiques sur les 111 397 de la base simulée, hors celles que les lots A et B ont volontairement changées (listées).

Ce script devient ensuite le service de simulation de l'écran des règles (lot N).

### Étape 29 — Événements comptables

**Modèle de données — migration 680.** Table `accounting_events` (colonnes dans `04_ARCHITECTURE_CIBLE.md` § 3). `journal_entries.event_id` et `journal_entries.rule_set_id`, nullables.

**Serveur.** `postOrQueue` écrit toujours un événement (statut `posted` ou `failed`) dans la transaction du document ; `ledger_outbox` devient une vue sur les événements en échec, pour ne rien casser côté écran. Le registre de rejeu de l'étape 5 est réutilisé tel quel.

### Étape 30 — Un seul point d'écriture

Les neuf insertions directes dans `journal_entries` (`ledger-post.ts:28`, `depreciation.service.ts:241, 389`, `manual-entry.repository.ts:122`, `prepaid-charge.repository.ts:81`, `withholding.repository.ts:150`, `journal-template.repository.ts:179`, `corporate-tax.repository.ts:76`, `fx-revaluation.repository.ts:60`) passent par une fonction unique `postEntry(client, entry, options)` extraite de `persistEntry` : même règle de période, même contrôle des auxiliaires, `source_id` toujours renseigné (ce qui met production, liaisons et bordereaux sous l'index d'unicité). Test de garde : aucun `INSERT INTO journal_entries` hors de ce fichier.

---

## Lots suivants — description technique résumée

Le détail de chaque lot sera écrit au même niveau que ci-dessus au moment de l'engager.

### Lot F — Trésorerie

| Étape | Modification |
|---|---|
| 31. Versement d'espèces en banque | Écran guidé au-dessus du virement interne existant (`gen:937-953`) : montant proposé = solde de caisse moins fond de caisse ; bordereau imprimable. |
| 32. Commission carte régularisée | Au pointage d'un relevé, écart entre commission estimée (`gen:84-89`) et commission réelle passé en 6147 par une règle `bank_rules`. |
| 33. Frais bancaires au rapprochement | `bank-reconciliation.repository.ts:350` : proposer l'écriture pour toute ligne de relevé sans contrepartie. |
| 34. Plusieurs journaux de banque et de caisse | `journals` : écran de création ; `treasury_accounts.journal_id` ; le résolveur renvoie compte et journal. |

### Lot G — Stocks et production

| Étape | Modification |
|---|---|
| 35. Méthode d'inventaire explicite **[À valider]** | Paramètre par société `inventory_method` (intermittent ou permanent), qui pilote les schémas d'achat, de consommation et de production ; supprime l'incohérence de `production-ledger.ts:39`. |
| 36. Inventaire tournant, emballages, pertes | `stock-count.repository.ts:290-296` : écriture par famille de stock, y compris partielle ; schéma des pertes branché sur `product-loss.repository.ts` (le code d'extourne mort devient vivant). |
| 37. Compte de vente selon l'activité **[À valider]** | Règles par famille de produits (7121 pour la production, 7111 pour le négoce) ; pas de reprise sur exercice clos. |

### Lot H — Ventes

Retour en caisse (`gen:566-582`) avec TVA par taux, compte de la famille et mode de remboursement réel ; escompte de règlement ; acompte fournisseur.

### Lot I — Clôture

`fiscal_years` à dates libres (suppression de l'unicité sur l'année, périodes rattachées à l'exercice) ; adaptation de `fn_ledger_window_start`, de la liasse, de l'IS et de l'EDI qui supposent l'année civile ; assistant d'affectation du résultat depuis 1181 ; limite paramétrable du nombre de périodes ouvertes ; rappel de clôture mensuelle.

### Lot J — États légaux

Tableau de financement et ETIC dans `liasse.rules.ts` ; livre d'inventaire dans `ledger-editions.service.ts` ; `ledger.routes.ts:257-264` refuse l'export EDI si un compte n'est pas classé ; un seul calcul de bilan pour l'écran de gestion et la liasse.

### Lot K — Fiscal complémentaire **[À valider]**

Contribution sociale de solidarité, suivi des déficits reportables par exercice d'origine, taux réduit de cotisation minimale, catégories d'immobilisations avec plafond des véhicules de personnes, régularisation de TVA à la cession, déclaration des délais de paiement.

### Lot L — Écrans du comptable

| Étape | Modification |
|---|---|
| Grand livre paginé | `GrandLivreTab.tsx:58-65` : chargement par compte et par page côté serveur ; recherche dans les écritures. |
| Navigation entre pièces et écritures | Route `GET /ledger/entries/by-source/:kind/:id` ; lien depuis factures, tickets, paiements, bulletins ; lien inverse depuis `EcrituresTab.tsx:449` ; balance → grand livre → écriture. |
| Erreurs visibles | `ErrorState` dans les six états qui affichent « Aucun mouvement » sur une erreur serveur. |
| Menu par parcours | Regroupement des 32 écrans : quotidien, fin de mois, fiscal, clôture, paramétrage. |
| Découpage | `AccountingPage.tsx` (3 714 lignes) éclaté par écran ; `exportCSV` mutualisé. |

### Lot M — Performance

Compteur de numérotation attribué en fin de transaction (ou par bloc réservé) pour ne plus sérialiser les ventes ; option de centralisation des ventes de caisse par session ; test de charge à un an de données et dix magasins sur le grand livre, la balance et la clôture.

### Lots N à X

Écran des règles avec simulation et validation à quatre yeux (N) ; profils comptables par secteur (O) ; multi-sociétés (P) ; analytique obligatoire et budgets par axe (Q) ; ergonomie de saisie (R) ; provisions (S) ; fonctions assistées (T à W) ; facturation électronique dès publication du texte d'application (X).

---

## Ordre d'exécution et points d'arrêt

| Ordre | Étapes | Condition pour commencer | Point d'arrêt |
|---|---|---|---|
| 1 | 0 | Votre accord | Jeu de référence produit |
| 2 | 1 à 10 (lot A) | — | Écran et tests, puis votre accord avant push |
| 3 | 19, 21, 22, 23 (lot C hors rôle PostgreSQL) | — | Idem |
| 4 | 24 à 26 (lot D) | Lot A | Résumé = CPC |
| 5 | 11 | — | Rattrapage des codes de TVA par vos soins |
| 6 | 12 à 18 (lot B) | Avis de l'expert-comptable | Une étape à la fois |
| 7 | 20 | Répétition sur copie de production | Votre accord explicite |
| 8 | 27 à 30 (lot E) | Lots A et B stabilisés | Simulation à 100 % |
| 9 | Lots F à M | Lot E | Par lot |

Les lots A, C et D ne dépendent d'aucune décision extérieure. Le lot B attend l'expert-comptable, sauf l'étape 11.

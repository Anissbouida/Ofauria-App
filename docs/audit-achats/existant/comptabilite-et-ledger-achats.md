# Comptabilité des achats et grand livre (D8) — état de l'existant

Lecteur : « comptabilite-et-ledger-achats ». Dépôt `/Users/anissbouida/projets/Ofauria-app`, base locale (copie récente de la prod) interrogée en lecture seule le 2026-10-11. Toutes les références de code sont relatives au dépôt ; les numéros de ligne ont été relevés avec `grep -n` / `sed -n`.

---

## 0. Résumé exécutif

Ofauria possède un **noyau comptable en partie double** (CGNC Maroc) introduit par les migrations 179-187 : plan de comptes (76 comptes), auxiliaires fournisseurs/clients (38), 5 journaux (AC/VE/BQ/CA/OD), périodes fiscales mensuelles (24, toutes `open`), écritures `journal_entries` / `journal_entry_lines` (1 054 / 2 223 en local), trigger d'équilibre D=C, numérotation séquentielle par journal/année, lettrage, extourne, vue de réconciliation legacy↔ledger, états (grand livre, balance, CPC, bilan, déclaration TVA), rapprochement bancaire, immobilisations/amortissements, retenues à la source.

Le générateur `journal-generator.service.ts` convertit les événements métier en écritures :
- **Facture fournisseur** (y compris la facture auto créée à la réception complète d'un BC) → journal AC : `6xxx D` (+ `345xx D` TVA) / `4411 C` (auxiliaire fournisseur).
- **Paiement** → CA/BQ/OD : `4411 D` / `5161|5141|5111|4415 C` (+ `4452x C` si RAS) ; chèque/traite = 2 écritures (émission puis encaissement).
- **Dépense directe** (paiement sans facture) → `6xxx D` / trésorerie `C`.
- **Avance sur salaire**, **vente**, **saisie manuelle de caisse**, **perte produit**, **écart de caisse**, **dotation amortissement**, **reversement RAS**.

**Ce qui n'existe pas** : aucune écriture au BC (pas d'engagement), aucune comptabilité de stock (3121/3122 : 0 ligne ; le stock lots de 131 434 DH n'apparaît pas au bilan), aucune provision marchandises reçues non facturées (4417 : 0 ligne), aucun coût d'acquisition complet (landed cost), aucune détection d'immobilisation depuis un achat, aucune saisie d'OD manuelle, aucun export FEC.

**Les 5 problèmes dominants** :
1. En production, `LEDGER_AUTOGEN` est OFF par défaut (`feature-flags.ts:33`, défaut `isDev`) et aucune configuration de déploiement ne l'active : le grand livre n'est alimenté que par le bouton « Générer » (backfill manuel). Local : 25 factures (20 086,91 DH) et 41 paiements sans écriture, créés entre le 20/07 et le 01/08 ; dernier backfill le 29/07.
2. La migration 253 a réécrit la contrainte CHECK `source_kind` **sans** `advance_repayment` (ajouté en 228) : les 22 retenues d'avances (5 501,97 DH) n'ont aucune écriture ; `3431` est surévalué, `6171` sous-évalué.
3. L'**avoir fournisseur** est comptabilisé comme une sortie de caisse (`4411 D / 5161 C`, écriture CA-2026-00438, 1 200 DH) car `payment_method='avoir'` tombe dans le `default` du générateur.
4. Les **virements internes caisse→banque et remboursements d'emprunt** (8 paiements, 109 500 DH) sont passés en charges `6181` (catégorie « Banque et Dettes » sans compte → fallback) : CPC faussé, `5141` jamais débité (solde −110 984,81).
5. La **charge est imputée d'après la catégorie d'en-tête** alors que la catégorie est portée par ligne depuis la mig 194 : 156/317 factures ont des lignes de catégorie différente, ≈8 637 DH mal imputés entre 61121/61221/6133/6181/6125 ; 10 écritures orphelines (sources supprimées) gonflent 4411 de 30 100 DH.

---

## 1. Schéma de données

### 1.1 Tables du noyau (migrations)

| Table | Migration | Rôle | Volume local | Points clés |
|---|---|---|---|---|
| `accounts` | 179, 186, 209, 210, 228, 258 | Plan CGNC dénormalisé (classe/rubrique/poste), `is_collective` + `auxiliary_kind`, `tva_rate`/`tva_direction` | 76 | Seed ~60 comptes ; 3431 (228), 4481 (258), 4452x RAS (210), 283x relibellés (209) |
| `account_auxiliaries` | 179, 208 | Sous-comptes tiers rattachés à 4411/3421, code `4411-FOUR-XXXXXX-abcd` | 38 (35 fournisseurs) | Unicité par supplier/customer ; provision à la volée dans `persistEntry` depuis la mig 208 |
| `journals` | 180 | AC, VE, BQ, CA, OD + compte de contrepartie par défaut | 5 | |
| `fiscal_periods` | 180 | Mois calendaires, statut `open/closed/locked`, `closed_by/at/note` | 24 (2025-2026, toutes `open`) | Seed uniquement année courante + précédente à l'exécution de la migration ; **aucune création applicative** |
| `journal_sequences` + `next_entry_number()` | 180 | Compteur atomique par journal/année, format `AC-2026-00001` | 5 lignes | |
| `journal_entries` | 181, 185, 211, 228, 253 | En-tête : `entry_number` unique, `source_kind/source_id/source_detail`, `status draft/posted/reversed`, `reversed_by_entry_id`, `store_id` | 1 054 | Index unique partiel `uq_je_source_detail (source_kind, source_id, COALESCE(source_detail,'')) WHERE status != 'reversed'` |
| `journal_entry_lines` | 181 | `account_id`, `auxiliary_id`, `debit XOR credit`, `label`, `lettrage_id` | 2 223 | CHECK une seule colonne > 0 |
| `expense_categories.account_id`, `revenue_categories.account_id` | 182 | Mapping catégorie → compte, hérité par `parent_id` | 10 top-level mappées / 135 | |
| `v_reconciliation_check` (vue) | 183 | `legacy_remaining = total − paid_amount` vs `ledger_remaining = solde non lettré 4411/3421` par facture | 326 lignes | |
| `fixed_assets`, `depreciation_entries` | 186 | Registre immos + dotations mensuelles (unicité asset/année/mois) | 0 / 0 | |
| `bank_statements`, `bank_statement_lines` | 187 | Relevés + lignes rapprochées à `journal_entry_lines` | 1 / 90 | |
| `invoice_items.tva_rate/tva_amount` | 189 | TVA par ligne | 9 factures reçues avec TVA ligne | |
| `invoice_items.category_id`, `reception_voucher_items.category_id` | 194 | Catégorie par ligne | | **Non lue par le générateur** |
| `withholding_tax_types`, `payments.withholding_*` | 210, 212 | RAS : 5 types, comptes 44525-44529 | 5 / 0 paiement avec RAS | |
| `salary_advances`, `salary_advance_repayments`, compte 3431 | 228 | Avances = créance 3431, retenue 6171 D / 3431 C | 24 / 22 | |
| `debts`, `recurring_charges`, `scheduled_payments`, `payments.scheduled_payment_id`, compte 4481 | 258 | Échéancier dettes/charges fixes | 0 / 0 / 0 | |

### 1.2 Triggers et contraintes (vérifiés en base)

```
trg_check_journal_entry_balance  BEFORE UPDATE  → SUM(D)=SUM(C), non vide, auxiliary_id obligatoire sur compte collectif (au passage posted)
trg_check_period_lock            BEFORE INSERT OR UPDATE → refuse locked ; refuse INSERT en closed
journal_entries_source_kind_check CHECK (source_kind IN ('manual','invoice','payment','sale','reversal','backfill','shift_entry','product_loss','closure_diff'))
```

Le trigger de période **ne couvre pas DELETE** : une suppression physique d'écriture n'est jamais bloquée par la base (seule la logique applicative de `reverseEntriesForSource` distingue open/closed/locked).

La contrainte `source_kind` **ne contient plus `advance_repayment`** : la migration 228 l'avait ajouté (`228_salary_advances.sql:78-80`), la migration 253 a redéfini la liste sans lui (`253_z_report_paid_out.sql:53-57`). Ordre d'application vérifié dans `_migrations` : 228 le 2026-07-06, 253 le 2026-07-28.

---

## 2. Plan comptable et paramétrage

### 2.1 Comptes réellement mouvementés (écritures `posted`, base locale)

| Compte | Libellé | Lignes | Débit | Crédit | Solde D−C |
|---|---|---|---|---|---|
| 3421 | Clients | 9 | 19 890,65 | 0 | 19 890,65 |
| 3431 | Avances et acomptes au personnel | 21 | 5 952,00 | 0 | 5 952,00 |
| 34552 | TVA récupérable sur charges 20% | 47 | 19 152,07 | 0 | 19 152,07 |
| 34554 | TVA récupérable sur charges 10% | 5 | 59,55 | 0 | 59,55 |
| 4411 | Fournisseurs | 564 | 247 918,60 | 299 745,26 | −51 826,66 |
| 4415 | Fournisseurs – Effets à payer | 47 | 70 082,40 | 83 867,41 | −13 785,01 |
| 44551 | TVA facturée 20% | 9 | 0 | 3 315,11 | −3 315,11 |
| 5111 | Chèques à encaisser | 33 | 68 942,61 | 85 257,98 | −16 315,37 |
| 5141 | Banques | 94 | 41 467,70 | 152 452,51 | **−110 984,81** |
| 5161 | Caisses | 668 | 363 463,00 | 364 261,11 | −798,11 |
| 61121 | Achats de matières premières | 330 | 279 988,53 | 0 | 279 988,53 |
| 61221 | Achats consommables | 13 | 7 277,00 | 0 | 7 277,00 |
| 6125 | Achats non stockés | 2 | 4 684,26 | 0 | 4 684,26 |
| 6133 | Entretien et réparations | 34 | 18 744,46 | 0 | 18 744,46 |
| 6142 | Transports | 17 | 1 301,00 | 0 | 1 301,00 |
| 6171 | Rémunérations du personnel | 227 | 129 625,26 | 0 | 129 625,26 |
| 6181 | Charges diverses | 34 | **131 856,53** | 0 | 131 856,53 |
| 7111 | Ventes de marchandises | 67 | 0 | 415 046,04 | −415 046,04 |
| 7585 | Autres produits non courants | 2 | 0 | 6 460,20 | −6 460,20 |

Jamais mouvementés : 3121/3122 (stocks), 4417 (factures non parvenues), 4481 (dettes sur immos), 2xxx/28xx/6191 (immos), 34551 (TVA immos), 4452x (RAS), classe 1 (aucun bilan d'ouverture).

### 2.2 Mapping catégories → comptes (mig 182, `expense_categories.account_id`)

| Catégorie top-level | Compte | Observation |
|---|---|---|
| Matières premières | 61121 | |
| Emballages | 61221 | |
| Énergie | 6125 | |
| Loyer & Charges | 6131 | |
| Entretien & Maintenance | 6133 | |
| Transport | 6142 | |
| Charges de personnel | 6171 | |
| Frais administratifs | 6181 | |
| **Équipements & Matériel** | **6181** | Les équipements sont des charges diverses, jamais des immobilisations |
| Divers | 6181 | |
| **Banque et Dettes** | **NULL → fallback 6181** | Seule top-level non mappée (`SELECT ... WHERE parent_id IS NULL AND account_id IS NULL`) |

Résolution : `resolveCategoryAccountCode()` remonte `parent_id` récursivement, fallback `'6181'` (`server/src/services/journal-generator.service.ts:132-166`, fallback l.137).

Conséquence mesurée (paiements `type='expense'` par catégorie racine → compte) :

```
Banque et Dettes        | 6181 (fallback) |   8 | 109 500,00   <- "Virement bancaire" (6 paiements, 106 000 : "versement d'espèces à la banque", "Ibrahim", "said") + "Remboursement emprunt" (2, 3 500)
Charges de personnel    | 6171            | 169 |  81 451,01
Entretien & Maintenance | 6133            |  32 |  25 181,46
Matières premières      | 61121           |  49 |  14 686,52
Équipements & Matériel  | 6181            |  12 |   7 495,00
Frais administratifs    | 6181            |  12 |   5 849,90
Énergie                 | 6125            |   2 |   4 684,26
Emballages              | 61221           |   5 |   1 900,00
Transport               | 6142            |  21 |   1 571,00
Divers                  | 6181            |   1 |     120,00
```

Décomposition du 6181 : `payment:expense` 32 lignes / 122 664,90 DH ; `invoice` 2 lignes / 9 191,63 DH.

---

## 3. Le générateur d'écritures (`server/src/services/journal-generator.service.ts`, 1 186 lignes)

### 3.1 Événements → écritures (tel que codé)

| # | Événement | Fonction | Journal | Débit | Crédit | Hook appelant | Lignes |
|---|---|---|---|---|---|---|---|
| A | Facture fournisseur créée (`invoice_type='received'`, non `cancelled`, `total>0`, `supplier_id` non nul) | `fromInvoice` | AC | `chargeCode` (catégorie **d'en-tête** `inv.category_id`) montant HT ; `345xx` par taux de ligne si `invoice_items.tva_rate` renseigné, sinon une ligne au taux déduit `round(tax/amount*100)` | `4411` + auxiliaire fournisseur, TTC, `lettrage_key=inv-<id>` | `accounting.repository.ts:655-669` (création manuelle), `reception-voucher.repository.ts:190-205` (facture auto BC), `accounting.repository.ts:721-731` (depuis commande client) | 177-247 |
| B | Facture client | `fromInvoice` | VE | `3421` aux. client TTC | `7111` HT + `4455x` | idem | 249-290 |
| C | Vente POS payée | `fromSale` | CA/BQ | `5161`/`5141` | `7111` + `4455x` (+ `7129 D` remise) ; skip si saisie manuelle du jour | `sale.repository.ts:274` | 318-392 |
| G | Saisie manuelle caisse matin/soir | `fromManualShiftEntry` | CA | `5161`/`5141` | `7111` | `manual-shift-entry.repository.ts:102` | 405-437 |
| D | Paiement espèces/virement | `fromPaymentEmission` | CA/BQ | `4411` aux. (type `invoice`) ; `6171` (salary) ; `3431` (advance) ; `6xxx` via catégorie (expense) ; `6181` sinon | `5161`/`5141` ; si RAS : net sur trésorerie + `4452x` retenue | `accounting.repository.ts:1920, 2046` ; update → `regeneratePaymentEntries` l.2094 | 441-552 |
| E | Paiement chèque | `fromPaymentEmission` + `fromPaymentCashing` | OD puis BQ | E1 `4411 D / 5111 C` ; E2 `5111 D / 5141 C` (`source_detail='cashing'`, quand `cashed_at` renseigné) | | `markCashed` l.1790, `unmarkCashed` l.1821 | 494-552, 554-578 |
| F | Paiement traite | idem | OD puis BQ | F1 `4411 D / 4415 C` ; F2 `4415 D / 5141 C` | | idem | |
| — | **Avoir fournisseur** (`payment_method='avoir'`) | `fromPaymentEmission` **branche `default`** | **CA** | `4411 D` | **`5161 C`** | `accounting.repository.ts:2016-2037` | **508-509** |
| H | Revenu direct (`type='income'`) | `fromPaymentEmission` | CA/BQ | `5161`/`5141` | compte revenu catégorie (fallback `7585`) | | 476-491 |
| I | Retenue d'avance sur salaire | inline dans `salary-advance.repository.ts:357-367` | OD | `6171` | `3431` | `source_kind='advance_repayment'` **refusé par la CHECK** | |
| J | Perte produit (hors `production`) | `fromProductLoss` | OD | **`6114`** (compte inexistant) | **`3421`** (Clients, collectif → « Auxiliaire manquant ») | `product-loss.controller.ts:182` (SAVEPOINT) | 1109-1131 |
| K | Écart de caisse > 5 DH | `fromClosureDiff` | OD | `5161` ou **`6588`** (inexistant) | **`7588`** (inexistant) ou `5161` | `cash-register.repository.ts:366` (SAVEPOINT) | 1150-1186 |
| L | Dotation amortissement | `persistDepreciationEntry` (`depreciation.service.ts:200-245`) | OD | `6191` (expense_account_id) | `28xx` | `POST /fixed-assets/run-depreciation` | `source_kind='manual'`, `source_detail='depr:YYYY-MM'` |
| M | Reversement RAS | `persistReversement` (`withholding.repository.ts:131-175`) | OD | `4452x` | `5141`/`5161` | `POST /withholding/reversement` | `source_detail='ras-reversement'`, `source_id` NULL |
| — | **Bon de commande** (création, envoi, accusé) | — | — | — | — | `purchase-order.repository.ts` : aucun appel au générateur (grep `journal|ledger|persistEntry` vide) | |
| — | **Réception sans facture** (BC partiellement livré, prix manquants) | — | — | — | — | La facture auto n'est créée qu'en `livre_complet` avec tous les prix (`reception-voucher.repository.ts:60-75`) ; pas d'écriture 4417 | |

### 3.2 Facture auto issue de la réception (chemin principal des achats BC)

`createInvoiceFromPo` (`server/src/repositories/reception-voucher.repository.ts:77-208`) :
- prix effectif = dernier `reception_voucher_items.unit_price` sinon `purchase_order_items.unit_price` (l.98-110) ;
- `category_id` de ligne = catégorie de l'article (ingrédient/consommable) figée (l.126) ;
- **`tax_amount = 0`, `total_amount = amount`** (l.170-176 : `VALUES (..., $6, 0, $6, ...)`) → aucune TVA récupérable sur les factures BC (263/294 factures issues de BC sans TVA) ;
- `category_id` d'en-tête dérivée par `resolveInvoiceCategoryFromPo` (l.28-58) : feuille unique, ou parent commun, sinon « Matières premières » ;
- l'écriture est générée dans un `SAVEPOINT ledger_gen` (l.190-205) si `FLAGS.LEDGER_AUTOGEN` ; en cas d'échec : `console.error` et la facture reste sans écriture.

### 3.3 `persistEntry` (l.586-741) — persistance et idempotence

1. Idempotence **kind-agnostic** : `SELECT ... WHERE source_id=$1 AND COALESCE(source_detail,'')=COALESCE($2,'') AND status != 'reversed'` (l.601-610). Si trouvé → retourne l'existante (`created:false`).
2. Journal par code ; période fiscale par `entry_date` ; lève `Aucune periode fiscale pour <date>` (l.623) ou `Periode verrouillee` (l.624-626). (`closed` est laissé passer ici mais refusé par le trigger INSERT.)
3. `next_entry_number(journal, year)`.
4. Résolution comptes + auxiliaires en bloc ; **provision à la volée** des auxiliaires manquants (l.646-690, correctif mig 208).
5. INSERT `draft` → lignes → `UPDATE status='posted'` (déclenche le trigger d'équilibre).
6. `markAsBackfill` force `source_kind='backfill'`.

### 3.4 Lettrage (`autoLettrer`, l.746-787)

Pour une facture : collecte les lignes 4411/3421 non lettrées de la facture **et de ses paiements** (`payments.invoice_id`) ; si `|ΣD−ΣC| ≤ 0,01` → même `lettrage_id` UUID pour toutes ; sinon rien (**paiement partiel jamais lettré**, l.770-773). Résultat local : 4411 → 517 lignes non lettrées (D 137 494,67 / C 189 321,33) vs 47 lettrées (110 423,93 / 110 423,93).

### 3.5 Reversion et extourne (`reverseEntriesForSource`, l.801-874 ; `extourneEntry`, l.881-947)

- Période `locked` → exception (aucune correction).
- Période `open` → **`DELETE FROM journal_entries`** (l.849) : suppression physique → trous de numérotation.
- Période `closed` → écriture d'extourne OD (débits/crédits inversés) datée au **1er jour de la période ouverte la plus récente** (pas « aujourd'hui »), `source_kind='reversal'`, `source_detail='rev:<detail|main>'`, originale → `reversed`.
- Délettrage des `lettrage_id` touchés.

Helpers « reverse + regenerate » : `regenerateInvoiceEntry` (l.976-991), `regeneratePaymentEntries` (l.998-1017), `regenerateSaleEntry`, `regenerateShiftEntry`. La régénération réinsère avec la **date d'origine** : pour une facture d'une période `closed`, l'INSERT est refusé par le trigger → toute la transaction métier échoue avec l'erreur brute Postgres (`Periode comptable cloturee`).

### 3.6 Machine à états `journal_entries` (telle que codée)

```
            persistEntry (INSERT)           UPDATE status (même transaction)
   (néant) ─────────────────────► draft ─────────────────────────────────► posted
                                                                            │
                     reverseEntriesForSource, période open : DELETE ◄───────┤  (disparition physique, pas d'état)
                                                                            │
                     reverseEntriesForSource, période closed : ─────────────► reversed  (+ nouvelle écriture OD 'reversal' posted)
                                                                            │
                     période locked : exception, aucune transition ◄────────┘
```

Aucune écriture `draft` persistante n'existe (0 en base) : le `draft` n'est qu'un état transitoire interne à la transaction. Aucun endpoint ne crée/modifie/poste une écriture manuellement.

### 3.7 Machine à états `fiscal_periods` (`ledger.repository.ts:139-168`)

```
open ──closed──► closed ──locked──► locked (terminal, aucune transition)
  ▲                │
  └──── open ──────┘
```
Transitions `PATCH /ledger/fiscal-periods/:id/status` ; aucun contrôle de chronologie (on peut clore septembre avec août ouvert), aucun contrôle de complétude (factures sans écriture, divergences), aucune écriture de clôture, aucun report à nouveau. En local : 24 périodes toutes `open`, aucune clôture jamais effectuée.

---

## 4. Idempotence, réconciliation legacy ↔ ledger, backfill

### 4.1 Vue `v_reconciliation_check` (mig 183)
Par facture non annulée : `legacy_remaining = total − paid_amount` ; `ledger_remaining` = solde non lettré des lignes 4411/3421 des écritures dont `source_id` ∈ {facture, ses paiements} ; `has_ledger_entries`.

État local :
```
total 326 | avec écritures 303 | sans écritures 23 | divergentes 7 | delta total 19 425,73 DH
```
Détail des 7 divergences : toutes expliquées par des écritures **manquantes** côté facture ou côté paiement (créées 20/07→01/08, après le dernier backfill du 29/07), sauf FE-2026-0001/0004 (factures clients payées par un paiement `type='income'` → écriture `5141 D / 7585 C` qui **ne solde pas 3421 et compte le revenu deux fois** : 7585 = 6 460,20 DH exactement).

### 4.2 Les trois causes racines corrigées (mémoire projet) — vérification
1. Auxiliaire manquant → provision à la volée (`persistEntry` l.646-690) + mig 208 : OK, 35 auxiliaires pour 40 fournisseurs (les 5 restants seront créés au premier événement).
2. Idempotence kind-agnostic (l.601-610) : OK.
3. `updatePaidAmount` dans la même transaction que l'écriture (`accounting.repository.ts:2051, 2097, 2130`) : OK.

Suivi prod « 2 factures » : en local, 7 divergentes + 23 sans écriture (voir § 4.1) → le suivi n'est pas soldé sur cette copie.

### 4.3 Backfill
- Service `ledger-backfill.service.ts` (`runFullBackfill`, 196 l.) : factures → paiements (émission+encaissement) → ventes → nettoyage POS/jours manuels → saisies manuelles → **resync des factures divergentes** (`regenerateInvoiceEntry`). Exposé par `POST /ledger/backfill` et le bouton « Générer » (`EcrituresTab.tsx:105`). Ne couvre **pas** : retenues d'avances, pertes, écarts de caisse, dotations, reversements RAS.
- Script CLI `server/src/scripts/backfill-ledger.ts` (dry-run/apply) : logique **dupliquée** et plus ancienne (pas de shift entries, pas de resync ; commentaire obsolète sur l'encaissement l.173-183).
- Script `cleanup-orphan-entries.ts` : détecte les écritures dont la source a disparu ; **jamais exécuté** sur cette base (10 orphelines présentes, § 9).
- Test `test-ledger-e2e.ts` : 7 scénarios (création/paiement/modif/suppression/annulation/chèque) ; hors CI (`server/package.json` : `"test": "vitest"` ; `__tests__/` ne contient aucun test du générateur, seul `tva.test.ts` teste `lineTvaAmount`).

### 4.4 Feature flag
`server/src/config/feature-flags.ts:33` : `LEDGER_AUTOGEN: parseFlag(process.env.LEDGER_AUTOGEN, isDev)` → **OFF en production sauf variable d'environnement**. Aucune occurrence de `LEDGER_AUTOGEN` dans les fichiers yaml/json/Dockerfile/.env du dépôt. `LEDGER_BACKED_DEBTS` et `LEDGER_SHADOW_MODE` sont définis mais **jamais lus** ailleurs (grep vide).

Trace en base cohérente avec un prod sans autogen : `max(created_at)` des écritures `backfill` = 2026-07-29 ; les 60 écritures `invoice`/`payment` datent du 03/10 et 09/10 (activité dev locale) ; tout ce qui a été créé en prod entre le 20/07 et le 01/08 est sans écriture.

---

## 5. Coût d'entrée en stock et valorisation

| Question | Réponse codée | Référence |
|---|---|---|
| Prix d'entrée du lot | prix saisi à la réception, sinon prix BC (`effectiveCost`) | `reception-voucher.repository.ts:386` |
| Répercussion sur le BC | le prix de réception **écrase** `purchase_order_items.unit_price` | l.392-396 |
| Coût catalogue article | `UPDATE ingredients SET unit_cost = $1` / `UPDATE packaging_items SET unit_cost` → **dernier prix payé** (pas de CMP) | l.461-466, 419-424 |
| Coût du lot | `ingredient_lots.unit_cost` figé à la réception | l.431-437 |
| Coût de consommation (sorties) | `ingredients.unit_cost` courant, pas le coût du lot | `inventory.repository.ts:116-155` |
| Frais annexes / transport | aucun mécanisme : « Transport » est une catégorie de charge 6142 séparée | mig 182 |
| Écriture de stock | aucune : l'achat est passé en 611x au moment de la facture ; 3121/3122 jamais mouvementés (0 ligne) ; stock lots restants 131 434,10 DH (401 lots, 29 sans coût) absent du bilan | `fromInvoice` l.194-200 |
| GR/IR (4417) | compte seedé, 0 ligne, aucun code (`grep 4417` vide côté serveur) | |

Autrement dit : comptabilité d'achats en « charges directes » (inventaire intermittent sans écriture de variation de stock), valorisation opérationnelle au dernier prix, aucune provision pour les réceptions non facturées.

---

## 6. Immobilisations et amortissements

- Registre manuel : `POST /fixed-assets` (label, comptes 2xxx/28xx/619x, date, coût, VR, durée, méthode linéaire/dégressif). Le formulaire client (`ImmobilisationsTab.tsx:223-225`) filtre les comptes de classe 2 hors 28, les 28x et les 619x. **Aucun lien** vers une facture, un BC ou un fournisseur dans l'UI (grep `invoice|purchase` vide dans le tab) ; `supplier_id` existe en table mais n'est pas exposé.
- Aucune détection depuis un achat : la catégorie « Équipements & Matériel » (et ses enfants Petit matériel, Matériel cuisine, Informatique & POS) est mappée **6181**. 12 paiements (7 495 DH) y ont été passés en charges.
- `debts.fixed_asset_id` (mig 258) existe mais aucune écriture 2xxx / 4481 n'est générée à la création d'une dette (`payment-schedule.repository.ts` : aucun appel au générateur) ; le règlement d'une échéance de dette est typé `type: 'expense'` (`client/src/features/accounting/EcheancierView.tsx:407-408`) → charge 6xxx au lieu de `4481 D`.
- Dotations : `runDepreciation(year, month)` idempotent par `depreciation_entries` ; écriture OD `source_kind='manual'` → **invisible pour `reverseEntriesForSource`** (qui filtre sur les kinds métier) ; `fixedAssetRepository.delete` fait `DELETE FROM journal_entries WHERE id=$1` **sans vérifier le statut de la période** (`depreciation.service.ts:321-333`).
- Volume : 0 immobilisation, 0 dotation.

---

## 7. Avoirs, annulations, écritures d'annulation

| Cas | Comportement codé | Évaluation |
|---|---|---|
| Annulation facture (`updateStatus('cancelled')`) | `regenerateInvoiceEntry` → reverse (DELETE si open, extourne si closed) et ne régénère pas | OK, mais pas d'avoir comptable, suppression physique si période ouverte |
| Suppression facture (`deleteById`) | reverse paiements liés (si `force`) puis facture, puis `DELETE invoices` | OK (`accounting.repository.ts:1246-1292`) |
| Annulation réception BC (`cancelForPurchaseOrder`) | reverse écriture facture auto + `DELETE invoices` ; bloqué si paiement ou lot consommé | OK (`reception-voucher.repository.ts:560-690`) |
| Modification facture (`update`, `replaceItems`) | reverse + regenerate + re-lettrage | OK ; échoue brutalement si période close |
| **Avoir fournisseur** (`avoirAmount` à la saisie d'un chèque/traite) | 2e `payments` row `payment_method='avoir'` (`accounting.repository.ts:2016-2024`) → `fromPaymentEmission` → `default` → **`4411 D / 5161 C`** (CA-2026-00438, 1 200 DH, 2026-07-12) | **Faux** : un avoir n'est pas une sortie de caisse ; il devrait annuler la charge/TVA (`4411 D / 6xxx C + 345xx C`) |
| Avoir « autonome » (note de crédit reçue sans paiement) | inexistant (ni table, ni type de facture négatif) | Manque |
| Extourne manuelle / OD | inexistant (aucune route POST sur `/ledger/entries`) | Manque |

---

## 8. Clôture de période et verrous

- `PATCH /ledger/fiscal-periods/:id/status` (`ledger.controller.ts:88-104` → `fiscalPeriodRepository.updateStatus`). Rôle ADMIN_MANAGER.
- Garde-fous en base : trigger INSERT/UPDATE (pas DELETE) ; `persistEntry` refuse `locked` ; `persistDepreciationEntry` exige `open` (`depreciation.service.ts:221`) ; `persistReversement` : vérifie seulement l'existence de la période (`withholding.repository.ts:140-146`).
- Manques : création des périodes au-delà de 2026 (seed figé à la migration → **blocage le 01/01/2027** : `Aucune periode fiscale pour 2027-01-xx`), pré-contrôles de clôture, écritures de clôture (résultat 1191), à-nouveaux, bilan d'ouverture (classe 1 vide → 5141 à −110 985 DH), journal d'audit des changements de statut (seulement `closed_by/closed_at/closed_note` écrasés à chaque transition).

---

## 9. Vérifications en base (lecture seule)

Commande : `PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" -Atc "..."`.

### 9.1 Factures fournisseurs vs 4411
```sql
SELECT ROUND(SUM(total_amount),2) FROM invoices WHERE invoice_type='received' AND status<>'cancelled';
-- 319485.97
SELECT ROUND(SUM(l.credit),2), count(DISTINCT je.id) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
JOIN journal_entries je ON je.id=l.journal_entry_id WHERE a.code='4411' AND je.status='posted'
AND je.source_id IN (SELECT id FROM invoices WHERE invoice_type='received');
-- 299399.06 | 292
```
Écart 20 086,91 DH = exactement la somme des 25 factures sans écriture (`SELECT ... NOT EXISTS journal_entries` → 25 | 20086.91, créées du 2026-07-20 au 2026-08-01).

### 9.2 Paiements vs 4411 / trésorerie
```
payments par type/méthode : advance cash 24 (7 352) ; expense cash 311 (252 439,15) ; income 3 (18 998,94) ; invoice avoir 1 (1 200) ;
invoice cash 248 (76 287,09) ; invoice check 15 (68 942,61) ; invoice traite 22 (70 082,40) ; invoice transfer 1 (13 427,50) ; salary cash 64 (51 079,25)
Débit 4411 issu de paiements : 217 818,22 (264 écritures)  vs  SUM(payments type invoice) = 229 939,60  → écart 12 121,38 = 23 paiements cash sans écriture
Crédits trésorerie issus de paiements (émission) : 4415 70 082,40 | 5111 68 942,61 | 5141 13 427,50 | 5161 363 761,11 ; 7585 6 460,20 (income)
Paiements sans écriture : advance 4 (1 500) ; expense 12 (7 575) ; income 1 (12 538,74) ; invoice 23 (12 121,38) ; salary 1 (2 800)
```

### 9.3 Retenues d'avances (CHECK régressée)
```
journal_entries source_kind='advance_repayment' : 0 | salary_advance_repayments : 22 (5 501,97) | salary_advances : 24 (7 352) remaining 1 850,03
3431 : 21 lignes débit 5 952, 0 crédit
```

### 9.4 Pertes / écarts de caisse
```
journal_entries product_loss/closure_diff : 0 | product_losses hors production : 0 | clôtures |diff|>5 : 0
accounts 6114 / 6588 / 7588 : absents (SELECT code FROM accounts → 76 codes, aucun de ces trois)
```

### 9.5 Catégorie ligne vs en-tête (factures reçues non annulées)
```
317 factures | 1 sans catégorie d'en-tête | 156 avec ≥1 ligne de catégorie différente | 9 avec TVA par ligne
Compte ligne vs compte en-tête (résolution au top-level) :
  61221 vs 61121 : 42 lignes 3 723,50 | 6181 vs 61121 : 27 lignes 3 300,62 | 6133 vs 61121 : 38 lignes 1 238,45
  61121 vs 6181 : 3 lignes 218,00 | 6125 vs 61121 : 2 lignes 150,00 | 6133 vs 61221 : 1 ligne 7,00
Lignes consommables (packaging_id) : 133 lignes 14 973,07 DH (factures majoritairement en-tête 61121)
Écritures AC classe 6 : 61121 281 fact. 265 902,01 | 61221 8 fact. 5 377 | 6133 3 fact. 63 | 6181 2 fact. 9 191,63
```

### 9.6 TVA
```
Factures reçues avec tax_amount>0 : 49/317, total 19 985,06 ; 40 d'entre elles sans TVA par ligne (taux déduit en-tête) ; taux implicites : 20 % (45 fact.), 19 % (4 fact., 1 011,30 → compte 3455 générique)
Factures issues d'un BC : 294, dont 31 avec TVA ; factures manuelles : 23, dont 18 avec TVA
Ledger : 34552 19 152,07 + 34554 59,55 = 19 211,62
```

### 9.7 Numérotation et orphelines
```
journal | année | current_seq | nb écritures | trous
AC | 2026 | 295 | 294 | 1      BQ | 2026 | 40 | 40 | 0      CA | 2026 | 670 | 668 | 2
OD | 2026 |  64 |  43 | 21     VE | 2026 | 18 |  9 | 9
Orphelines (source_id absent de invoices/payments/sales/manual_shift_entries, non reversed) : 10 écritures 'backfill'
  OD-2026-00002/00011/00016/00017/00027/00030 « Paiement facture … » (chèques/traites supprimés) ; AC-2026-00073/00089 (factures supprimées) ; CA-2026-00352/00358 (avances)
  Impact : 4411 D 30 100,38 / C 346,20 ; 4415 C 13 785,01 ; 5111 C 16 315,37 ; 3431 D 100 ; 6171 D 400 ; 61121 D 346,20 ; 5161 C 500
```
Le solde 4415 (−13 785,01) et une part du 5111 (−16 315,37) proviennent **entièrement** d'écritures orphelines.

### 9.8 Soldes auxiliaires vs legacy (top écarts)
```
Ecomab      ledger 17 325,87 | legacy 35 614,38 | delta −18 288,51 (factures 2605464 et 26F22927 sans écriture + autres)
RICA MAROC  ledger −13 427,50 | legacy 0 | delta −13 427,50 (OD-2026-00011 orpheline : paiement 515042 supprimé puis recréé en virement)
OVOTEC      −3 104,40 | Abdelilah −2 899,30
```

### 9.9 Stock
```
ingredient_lots quantity_remaining>0 : 401 lots, valeur 131 434,10 DH, 29 sans unit_cost ; lignes 3121/3122/4417/4481/2332/6191 : 0
```

### 9.10 Paramétrage divers
```
stores : 1 ; journal_entries.store_id NULL : 0/1 054 ; debts/recurring_charges/scheduled_payments : 0 ; paiements avec RAS : 0 ; bank_statements 1 / lignes 90 ; fixed_assets 0
```

---

## 10. Endpoints (périmètre D8) et appel client

Toutes les routes exigent `authenticate` + `authorize(ADMIN_MANAGER)` (= admin, manager ; `shared/src/constants/roles.ts:25`). Préfixe `/api/v1`.

| Méthode | Chemin | Handler | Rôle fonctionnel | Appelé par le client |
|---|---|---|---|---|
| GET | /ledger/accounts | planComptableController.list | Plan comptable | oui — `ledger.api.ts:15` → PlanComptableTab, ImmobilisationsTab |
| GET | /ledger/accounts/:code | planComptableController.getByCode | Détail compte | **wrapper seulement** (`ledger.api.ts:18`, aucun écran) |
| GET | /ledger/auxiliaries | accountAuxiliaryController.list | Auxiliaires | **wrapper seulement** (`ledger.api.ts:24`, aucun écran) |
| GET | /ledger/journals | journalController.list | Journaux | oui — EcrituresTab:77 |
| GET | /ledger/fiscal-periods | fiscalPeriodController.list | Périodes | oui — ClotureTab:27 |
| PATCH | /ledger/fiscal-periods/:id/status | fiscalPeriodController.updateStatus | Clôture/réouverture/verrou | oui — ClotureTab:33 |
| GET | /ledger/entries | journalEntryController.list | Journal (liste paginée, filtres) | oui — EcrituresTab:99 |
| GET | /ledger/entries/:id | journalEntryController.getById | Détail écriture | oui — EcrituresTab:419 |
| GET | /ledger/reconciliation | reconciliationController.check | Bandeau legacy↔ledger | oui — EcrituresTab:83 |
| GET | /ledger/general-ledger | financialStatementsController.generalLedger | Grand livre d'un compte | **wrapper seulement** (`ledger.api.ts:174`) |
| GET | /ledger/general-ledger-full | financialStatementsController.generalLedgerFull | Grand livre complet | oui — GrandLivreTab:54 |
| GET | /ledger/balance | financialStatementsController.balance | Balance | oui — BalanceTab:39 |
| GET | /ledger/income-statement | financialStatementsController.incomeStatement | CPC | oui — CpcTab:33 |
| GET | /ledger/tva-declaration | tvaDeclarationController.declaration | TVA CA20 | oui — TvaTab:40 |
| GET | /ledger/balance-sheet | balanceSheetController.balanceSheet | Bilan | oui — BilanTab:47 |
| POST | /ledger/backfill | backfillController.run | Génération historique | oui — EcrituresTab:105 (« Générer ») |
| GET | /fixed-assets | fixedAssetController.list | Immobilisations | oui — ImmobilisationsTab:54 |
| GET | /fixed-assets/:id/schedule | fixedAssetController.schedule | Plan d'amortissement | oui — ImmobilisationsTab:329 |
| POST | /fixed-assets | fixedAssetController.create | Créer immo | oui — ImmobilisationsTab:234 |
| POST | /fixed-assets/run-depreciation | fixedAssetController.runDepreciation | Dotations du mois | oui — ImmobilisationsTab:59 |
| DELETE | /fixed-assets/:id | fixedAssetController.remove | Supprimer immo (+ écritures) | oui — ImmobilisationsTab:73 |
| GET/POST/GET/POST/DELETE | /bank-reconciliation/statements[/:id][/auto-match] | bankReconciliationController.* | Relevés et rapprochement | oui — `bank-reconciliation.api.ts:60-75` → BanqueTab |
| POST | /bank-reconciliation/lines/:id/match, /unmatch | idem | Pointage manuel | oui — idem |
| GET/PATCH | /withholding/types[/:id] | withholdingController | Paramétrage RAS | oui — RetenuesSourceTab:199,203 |
| GET | /withholding/to-remit | withholdingController.toRemit | RAS à reverser | oui — RetenuesSourceTab:66 |
| POST | /withholding/reversement | withholdingController.reversement | Écriture 4452x/5141 | oui — RetenuesSourceTab:157 |

Endpoints absents (comparés à un ERP) : POST/PUT écriture manuelle (OD), POST extourne, GET grand livre auxiliaire / balance âgée fournisseurs, export FEC, POST création de période / clôture d'exercice, GET écritures par source métier (navigation facture → écriture).

---

## 11. Écrans client (`client/src/features/accounting/`)

| Fichier | Lignes | Rôle | Visibilité |
|---|---|---|---|
| AccountingPage.tsx | 3 990 | Conteneur : section « Exploitation » (Pilotage, Caisse, Charges & Dépenses, Chèques et Traites, Dettes, Résumé, Pertes) et section « Comptabilité » (onglets ci-dessous) ; `isAdmin = admin || manager` (l.239-246) | Comptabilité réservée admin/manager |
| PlanComptableTab.tsx | 315 | Arbre CGNC, export CSV ; lecture seule | admin/manager |
| EcrituresTab.tsx | 545 | Journal : filtres date/journal/statut/recherche, pagination, totaux, export CSV, bandeau de réconciliation (`reconciliationApi.check`) + bouton « Générer » (backfill), détail d'écriture (lignes, compte, auxiliaire, lettrage) | admin/manager |
| GrandLivreTab.tsx | 247 | Grand livre complet par période/compte/classe, export CSV | admin/manager |
| BalanceTab.tsx | 174 | Balance par période, CSV | admin/manager |
| CpcTab.tsx | 167 | CPC classes 6/7, CSV | admin/manager |
| BilanTab.tsx | 180 | Bilan actif/passif à date, CSV | admin/manager |
| TvaTab.tsx | 166 | Déclaration TVA mensuelle (collectée/déductible), CSV | admin/manager |
| RetenuesSourceTab.tsx | 267 | Types de RAS (taux modifiables), à reverser, reversement | admin/manager |
| ImmobilisationsTab.tsx | 366 | Registre immos, création, plan d'amortissement, lancement des dotations, suppression | admin/manager |
| BanqueTab.tsx | 350 | Import relevé CSV (`parseCsv` l.121-140 : date;libellé;débit;crédit), auto-match, pointage manuel | admin/manager |
| ClotureTab.tsx | 148 | Liste des périodes, Clôturer / Réouvrir / Verrouiller (confirm) | admin/manager |
| EcheancierView.tsx | 973 | Échéancier dettes/charges fixes/factures échelonnées ; règle une échéance via `paymentsApi.create` (type `invoice` ou `expense`) | exploitation |

Le reste de la section « Exploitation » (Charges & Dépenses, Dettes, Résumé) lit les **agrégats legacy** (`/invoices`, `/invoices/line-expenses`, `/payments/summary`, `/invoices/debts`) et non le grand livre : deux sources de vérité coexistent en permanence.

---

## 12. Forces

1. Modèle comptable sérieux : partie double, plan CGNC dénormalisé, journaux, périodes, numérotation atomique, triggers d'équilibre et d'auxiliaire obligatoire, lettrage, extourne, `source_kind/source_id/source_detail` pour la traçabilité métier → écriture.
2. Idempotence robuste (index unique partiel + lookup kind-agnostic) et pattern « reverse + regenerate » systématique sur les mutations facture/paiement, avec `updatePaidAmount` dans la même transaction.
3. Génération protégée par SAVEPOINT : un échec comptable ne bloque jamais l'opération métier.
4. Vue de réconciliation legacy↔ledger + bandeau + bouton de rattrapage + scripts de diagnostic (`diagnose-reconciliation.sql`, `cleanup-orphan-entries.ts`) + test e2e : la dette de double source est outillée.
5. TVA par taux (ligne ou en-tête) ventilée sur 3455x/4455x ; déclaration TVA directement dérivée du ledger.
6. Chèques et traites modélisés en deux temps (5111/4415 puis 5141), cohérents avec le rapprochement bancaire.
7. États financiers complets (grand livre, balance, CPC, bilan, TVA) avec exports CSV ; immobilisations avec plan linéaire/dégressif CGNC ; retenues à la source paramétrables.
8. Documentation inline abondante (chaque migration explique le pourquoi et l'inversion).

---

## 13. Faiblesses (ordonnées par sévérité, étiquetées)

### Critiques

**W1 — Autogen OFF par défaut en production, grand livre alimenté à la main** [D8, D10]
Preuve : `server/src/config/feature-flags.ts:33` (`parseFlag(process.env.LEDGER_AUTOGEN, isDev)`), aucune occurrence de `LEDGER_AUTOGEN` dans la config de déploiement ; base : 25 factures (20 086,91 DH) et 41 paiements (36 535,12 DH) sans écriture, tous créés du 20/07 au 01/08 ; dernière écriture `backfill` le 29/07.
Impact : états comptables faux entre deux clics « Générer » ; aucune planification ; les catégories d'événements non couvertes par le backfill (avances, pertes, écarts, dotations, RAS) ne sont jamais rattrapées.

**W2 — Contrainte `source_kind` régressée : retenues d'avances jamais comptabilisées** [D8]
Preuve : `253_z_report_paid_out.sql:53-57` omet `advance_repayment` ajouté par `228_salary_advances.sql:78-80` ; contrainte vérifiée en base ; `salary-advance.repository.ts:357-367` insère `source_kind:'advance_repayment'` **hors SAVEPOINT** ; 0 écriture / 22 retenues (5 501,97 DH).
Impact : 3431 surévalué, 6171 sous-évalué ; si AUTOGEN est ON, la retenue sur paie échoue (rollback de `markPaid`).

**W3 — Avoir fournisseur comptabilisé en sortie de caisse** [D6, D8]
Preuve : `accounting.repository.ts:2016-2037` crée un paiement `payment_method='avoir'` ; `journal-generator.service.ts:508-509` (`default: creditCode='5161'; journal='CA'`) ; écriture CA-2026-00438 : `4411 D 1 200 / 5161 C 1 200`.
Impact : caisse minorée de 1 200 DH, charge/TVA non corrigées ; aucun modèle d'avoir (RRR obtenus 6119/6129, TVA à reverser).

**W4 — Virements internes et remboursements d'emprunt passés en charges 6181** [D8, D7]
Preuve : catégorie top-level « Banque et Dettes » sans `account_id` → fallback `'6181'` (`journal-generator.service.ts:137`) ; 8 paiements 109 500 DH (« Virement bancaire » ×6 = 106 000 : « versement d'espèces à la banque », « Ibrahim », « said » ; « Remboursement emprunt » ×2 = 3 500) ; 6181 = 131 856,53 dont 122 664,90 issus de paiements `expense`.
Impact : résultat minoré d'≈110 k DH, 5141 jamais débité des versements (solde −110 984,81), emprunts/comptes courants d'associés inexistants au passif.

**W5 — Écritures orphelines toujours comptabilisées** [D8]
Preuve : 10 écritures `backfill` dont la source n'existe plus (OD-2026-00002/00011/00016/00017/00027/00030, AC-2026-00073/00089, CA-2026-00352/00358) ; impact 4411 D 30 100,38 ; 4415 C 13 785,01 ; 5111 C 16 315,37 ; script `cleanup-orphan-entries.ts` jamais exécuté.
Impact : soldes fournisseurs faux (RICA MAROC −13 427,50 au ledger pour 0 legacy), effets à payer et chèques fantômes.

**W6 — Charge imputée par la catégorie d'en-tête, pas par ligne** [D8, D6]
Preuve : `fromInvoice` lit `inv.category_id` (`journal-generator.service.ts:194`) ; mig 194 porte `invoice_items.category_id` ; `updateLineCategory` (`accounting.repository.ts:1014-1021`) ne régénère rien ; 156/317 factures ont ≥1 ligne de catégorie différente ; ≈8 637 DH mal imputés (61221/6181/6133/6125 ↔ 61121) ; 133 lignes consommables (14 973 DH) sur factures en-tête 61121.
Impact : analytique achats (matières vs emballages vs entretien) fausse au grand livre ; l'écran « Charges & Dépenses » (par ligne) et le CPC (par en-tête) racontent deux histoires.

**W7 — Pas de comptabilité de stock, pas de GR/IR, pas de TVA sur les factures BC** [D8, D5, D6]
Preuve : 3121/3122/4417 : 0 ligne ; stock lots 131 434,10 DH ; `createInvoiceFromPo` force `tax_amount=0` (`reception-voucher.repository.ts:170-176`) → 263/294 factures BC sans TVA ; aucune écriture à la réception sans facture ; aucun landed cost.
Impact : bilan sans stock, charges = achats (pas de variation de stock), TVA récupérable perdue (TVA ledger 19 211,62 pour un volume d'achats de 319 k DH), dettes fournisseurs invisibles entre réception et facture.

### Majeurs

**W8 — Périodes fiscales non créées au-delà de 2026** [D8, D10]
Preuve : seed `180_ledger_journals_periods.sql:88-112` (année courante + précédente à l'exécution) ; aucun `INSERT INTO fiscal_periods` dans `server/src` ; `persistEntry` lève `Aucune periode fiscale pour …` (`journal-generator.service.ts:623`).
Impact : à partir du 01/01/2027, toutes les générations échouent silencieusement (SAVEPOINT) → aucune écriture, jusqu'à une migration manuelle.

**W9 — Pertes produits et écarts de caisse : générateurs cassés** [D8]
Preuve : `fromProductLoss` utilise `6114` (absent) et `3421` (Clients, collectif → « Auxiliaire manquant ») (`journal-generator.service.ts:1126-1127`) ; `fromClosureDiff` utilise `7588`/`6588` absents (l.1169, 1172) ; 0 écriture ; échecs avalés par SAVEPOINT (`product-loss.controller.ts:178-193`, `cash-register.repository.ts:355-375`).
Impact : fonctionnalité annoncée (mig 253) inopérante ; pertes et écarts restent absorbés dans le CA.

**W10 — Numérotation « sans trou » rompue par la suppression physique** [D8, D10]
Preuve : `reverseEntriesForSource` fait `DELETE FROM journal_entries` en période ouverte (`journal-generator.service.ts:849`) ; `fixedAssetRepository.delete` idem sans contrôle de période (`depreciation.service.ts:321-333`) ; trous : OD 21, VE 9, CA 2, AC 1 ; le trigger de période ne couvre pas DELETE.
Impact : exigence DGI annoncée en commentaire (mig 180) non tenue ; piste d'audit incomplète (une écriture supprimée ne laisse aucune trace).

**W11 — Immobilisations : aucune détection depuis l'achat, dettes d'équipement en charges** [D8]
Preuve : « Équipements & Matériel » → 6181 (mig 182) ; `ImmobilisationsTab` sans lien facture/BC ; `debts.fixed_asset_id` sans écriture 2xxx/4481 ; règlement d'échéance de dette typé `type:'expense'` (`EcheancierView.tsx:407-408`) ; 0 immo, 34551 jamais utilisé.
Impact : four/frigo/caisse passent en charges l'année de l'achat ; pas d'amortissement réel ; 4481 jamais mouvementé.

**W12 — Clôture de période sans contrôles ni écritures de clôture** [D8, D10]
Preuve : `fiscalPeriodRepository.updateStatus` (`ledger.repository.ts:139-168`) : seule la matrice de transitions est vérifiée ; pas de contrôle chronologique, de brouillons, de factures sans écriture ; pas de résultat/à-nouveaux ; classe 1 vide ; 24 périodes `open`.
Impact : la clôture est un simple drapeau ; le bilan n'a pas de sens sans bilan d'ouverture (5141 négatif, 5161 négatif).

**W13 — Dépenses directes hors circuit fournisseur** [D6, D8, D9]
Preuve : 311 paiements `type='expense'` (252 439,15 DH) sans facture, dont 30 avec `supplier_id` (11 334,80 DH) ; écriture `6xxx D / 5161 C` sans 4411 ni auxiliaire (`fromPaymentEmission` l.470-473) ; aucune TVA.
Impact : plus de 40 % du décaissement échappe au suivi fournisseur, au 3-way match et à la TVA déductible.

**W14 — Double comptage du revenu sur factures clients encaissées en `income`** [D8, hors achats]
Preuve : FE-2026-0001/0004 : écriture VE (`3421 D / 7111 + 44551 C`) + écriture BQ (`5141 D / 7585 C`) ; 7585 = 6 460,20 = somme des deux ; 3421 jamais soldé (solde 19 890,65).
Impact : produits surévalués, créances fictives ; signalé car il touche l'intégrité du même grand livre.

**W15 — Lettrage tout-ou-rien** [D7, D8]
Preuve : `autoLettrer` n'affecte un `lettrage_id` que si ΣD = ΣC (`journal-generator.service.ts:770-773`) ; 517 lignes 4411 non lettrées vs 47 lettrées ; pas de lettrage partiel, pas de lettrage manuel.
Impact : la balance âgée depuis le ledger est impossible ; `v_reconciliation_check` dépend de ce lettrage.

**W16 — Rôles et piste d'audit** [D10]
Preuve : toutes les routes ledger, immos, banque, RAS, backfill, verrouillage = `ADMIN_MANAGER` (`ledger.routes.ts:25-58`) ; côté client `isAdmin = admin || manager` (`AccountingPage.tsx:239`) ; aucun rôle comptable/lecture seule ; `closed_by/closed_at/closed_note` écrasés à chaque transition ; aucune table d'historique.
Impact : la gérante peut verrouiller/réouvrir des périodes et lancer un backfill ; pas de séparation des tâches.

### Mineurs

**W17 — TVA d'en-tête déduite par arrondi** [D6, D8]
Preuve : `computeTvaRate` + `Math.round` (`journal-generator.service.ts:79-103`) ; 4 factures à 19 % implicite (1 011,30 DH) tombent sur `3455` générique ; 40 factures avec TVA d'en-tête sans TVA ligne.
Impact : déclaration TVA par taux approximative.

**W18 — Dette technique du noyau** [D10]
Preuve : deux backfills (`scripts/backfill-ledger.ts` vs `services/ledger-backfill.service.ts`) divergents ; `shared/src/types/ledger.types.ts:70` `JournalEntrySourceKind` ignore `shift_entry/product_loss/closure_diff` ; flags `LEDGER_BACKED_DEBTS`/`LEDGER_SHADOW_MODE` sans usage ; aucun test vitest du générateur ; e2e hors CI ; endpoints `GET /ledger/accounts/:code`, `/ledger/auxiliaries`, `/ledger/general-ledger` sans écran.
Impact : maintenance coûteuse, régressions non détectées (W2 en est l'illustration).

**W19 — Absences fonctionnelles vs ERP** [D8, D9]
Pas d'OD manuelle, pas d'extourne à la demande, pas de grand livre auxiliaire / balance âgée depuis le ledger, pas de navigation facture → écriture, pas d'export FEC/EDI (CSV seulement), pas d'analytique (axe magasin uniquement via `store_id`, 1 magasin).

**W20 — Rapprochement bancaire isolé** [D7, D8]
Preuve : `autoMatch` = montant exact ± 7 jours (`bank-reconciliation.repository.ts:134-178`) ; une ligne de relevé non rapprochée (frais, agios) ne peut pas générer d'écriture ; 1 relevé / 90 lignes.
Impact : 5141 ne peut pas être justifié ; cohérent avec le solde −110 985.

---

## 14. Code mort / jamais appelé

- `fromProductLoss`, `fromClosureDiff` : appelés mais échouent systématiquement (comptes inexistants / auxiliaire manquant) → 0 écriture.
- `persistEntry(... source_kind:'advance_repayment')` : refusé par la contrainte CHECK.
- `FLAGS.LEDGER_BACKED_DEBTS`, `FLAGS.LEDGER_SHADOW_MODE` : définis, jamais lus.
- `accountAuxiliaryRepository.findBySupplierId/findByCustomerId` (`ledger.repository.ts:38-51`) : non utilisés (le générateur fait ses propres lookups en bloc).
- Endpoints sans écran : `GET /ledger/accounts/:code`, `GET /ledger/auxiliaries`, `GET /ledger/general-ledger` (wrappers `ledger.api.ts:18,24,174` uniquement).
- `server/src/scripts/backfill-ledger.ts` : supplanté par le service, logique obsolète.
- `server/src/scripts/cleanup-orphan-entries.ts` : jamais exécuté sur cette base (10 orphelines).
- Comptes seedés jamais mouvementés : 3121, 3122, 3151, 3155, 4417, 4481, 34551, 2xxx/28xx, 6191, 4452x, classe 1.
- `journal_entries.status='draft'` : jamais persistant.

---

## 15. Questions ouvertes

1. `LEDGER_AUTOGEN` est-il activé sur Cloud Run (variable d'environnement hors dépôt) ? Les 25 factures/41 paiements sans écriture du 20/07→01/08 suggèrent que non.
2. Les 6 « Virement bancaire » (106 000 DH) sont-ils des versements d'espèces en banque (écriture attendue `5141 D / 5161 C`) ou des retraits d'associés (compte courant 4463/3488) ?
3. Qui est le destinataire des états (expert-comptable externe ?) et quel format attend-il (FEC, EDI DGI, balance Excel) ?
4. Faut-il une comptabilité de stock permanente (3121/6114 variation) ou un inventaire intermittent avec écriture d'inventaire mensuel (cf. mémoire « Inventaire physique mensuel ») ?
5. Les factures fournisseurs sont-elles majoritairement sans TVA (petits fournisseurs non assujettis) ou la TVA est-elle simplement non saisie à la réception ? Cela conditionne la priorité de W7.
6. Doit-on conserver `paid_amount` legacy comme source de vérité des dettes ou basculer sur le ledger (flag `LEDGER_BACKED_DEBTS` jamais câblé) ?
7. Quel traitement comptable souhaité pour l'avoir fournisseur (RRR obtenus 6119/6129 vs annulation de la charge d'origine) ?

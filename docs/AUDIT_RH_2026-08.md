# Audit du module RH — v2 (03/08/2026)

Périmètre : backend (`employee.repository.ts`, `weekly-payroll.repository.ts`, `biweekly-payroll.repository.ts`, `salary-advance.repository.ts`, `employee.controller.ts`, `employees.routes.ts`, `employees.validator.ts`), frontend (`EmployeesPage.tsx`), migrations 238–241, 254, 256. Fait suite à l'audit du 14/07/2026 (`docs/AUDIT_RH.md`).

## Verdict global

Depuis le 14/07, un vrai travail correctif a été livré : idempotence des paiements, validateurs zod + asyncHandler partout, scoping store sur la majorité des routes, migrations 238 (contraintes), 239 (audit trail + historique salaires), 240 (timestamptz pointage), 241 (barèmes fiscaux). **Mais la bascule « paie mensuelle basée pointage » (mig 256, commits du 03/08) a introduit 4 bugs critiques nouveaux qui produisent des salaires faux sans aucun signal visible**, et le module quinzaine a été retiré à moitié (repository + migration toujours en place = état incohérent).

---

## 1. Ce qui a été corrigé depuis l'audit du 14/07

| Point de l'ancien audit | Statut | Preuve |
|---|---|---|
| Double-clic → double paiement | ✅ Corrigé | `UPDATE … WHERE paid = false RETURNING` sur les 3 variantes (`employee.repository.ts:1067`, `weekly:221`, `biweekly:178`) |
| Rollback sans suppression du paiement | ✅ Corrigé | compensation via `paymentRepository.delete` (reverse compta) |
| Retour `applyDeduction` ignoré | ✅ Corrigé | vérifié à 0.005 près, throw + rollback |
| Repos payé en 3 versions | ✅ Quasi | source unique serveur `reposDaysFor()` ; reste un texte d'aide UI divergent (`EmployeesPage.tsx:2225`, omet le seuil 4 jours) |
| Inputs pointage périmés | ✅ Corrigé | `key` inclut `selectedDate` |
| « Dupliquer S-1 » décalé | ✅ Corrigé | mapping par date (−7 j), congés sautés |
| Validateurs + asyncHandler | ✅ Corrigé | `employees.validator.ts` (195 l.), asyncHandler sur 100 % des routes RH |
| PUT /payroll paid/net | ✅ Corrigé | schema `.strict()` limité à bonuses/deductions/notes, bulletin payé verrouillé, formule complète |
| Hard delete : payments SQL brut | ✅ Corrigé | boucle `paymentRepository.delete`, transaction + FOR UPDATE, weekly_payroll/salary_advances couverts |
| CASCADE destructeurs, CHECK, anti-chevauchement congés | ✅ Corrigé | mig 238 (RESTRICT, salaires ≥ 0, year borné, lundi, GIST anti-chevauchement congés approuvés) |
| Traçabilité | 🟡 Partiel | mig 239 pose colonnes + triggers + `employee_salary_history`, mais voir §4 |

## 2. CRITIQUE — Nouveaux bugs de la paie au pointage (mig 256)

La mig 256 change le contrat : jours non pointés = retenus (base 26). Quatre situations produisent un versement erroné **sans avertissement** :

1. **Congé approuvé = salaire amputé** (`employee.repository.ts:849-883`). Aucune ligne d'attendance n'est créée pour un congé, et l'UI de pointage désactive les boutons quand l'employé est en congé. Un congé payé de 15 jours ⇒ retenue de 15 × base/26 (~58 % du salaire). Idem jours fériés. Avant la 256, salaire plein.
2. **Re-sauvegarder le planning annule le pointage** (`employee.repository.ts:508-514`). `ON CONFLICT … SET is_expected = CASE WHEN attendance.check_in IS NULL THEN true …` : les pointages faits via les boutons de statut n'ont pas de `check_in` → repassés à `is_expected=true` → exclus de la paie. Pointer lundi-samedi puis ajuster le planning dimanche = semaine entière non payée.
3. **Mois pointé uniquement par le planning ⇒ salaire 0** (`employee.repository.ts:861`). Les lignes pré-remplies (`is_expected=true`) affichent le même tag « Présent » bleu que le pointage réel : indiscernables pour l'utilisateur, mais exclues du calcul.
4. **Génération en cours de mois = bulletin amputé payable** (`employees.validator.ts:121-124`). Générer août le 10 août ⇒ ~17 jours « absents », bouton Payer actif, aucune garde mois en cours/futur.

Et transversal :

5. **Aucune garde anti-double paiement entre fréquences** (`employee.repository.ts:826-843`). Changer `pay_frequency` en cours de mois (mensuel payé → weekly, ou l'inverse) permet un double paiement complet du mois ; la purge ne supprime que les bulletins **non payés**. Rien ne matérialise « employé X déjà payé pour la période Y » à travers `payroll`/`weekly_payroll`/`biweekly_payroll`.

## 3. CRITIQUE/MAJEUR — État bâtard du module quinzaine

Le commit 13dbe20 a retiré routes/contrôleur/validateurs/UI quinzaine 30 min après leur ajout (56c1296), mais **`biweekly-payroll.repository.ts` (326 l.) et la migration 254 restent** :

- CHECK DB autorise `pay_frequency='biweekly'` mais le validateur zod ne l'accepte plus → un employé resté en biweekly est **impayable partout** et ses bulletins mensuels non payés sont supprimés par la purge ; le `<select>` du formulaire l'affiche « Mensuelle » et écrase silencieusement sa fréquence au save.
- `hardDelete` et `countDependencies` ne couvrent pas `biweekly_payroll` (FK sans ON DELETE → erreur brute).
- Si le module est réintroduit tel quel : retenue d'avance appliquée **2× par mois** (le plan `monthly_deduction` ne connaît pas le rythme — d'ailleurs en hebdo actif aujourd'hui il est proposé 4-5×/mois, `salary-advance.repository.ts:65-77`), régénération qui corrompt les bulletins payés, `delete()` sans garde `paid`, H.Sup à 125 % vs 100 % en mensuel, et 2 quinzaines ≠ 1 mensuel (repos non payé en quinzaine).

**Décision à prendre** : soit nettoyer (mig 258 : retirer `'biweekly'` du CHECK, statuer sur la table, supprimer le repository), soit finir le module en corrigeant les points ci-dessus avant branchement.

## 4. MAJEUR — Restes de l'ancien audit

- **Pas de transaction PG unique** sur markPaid/unmarkPaid : claim → payment → applyDeduction sur 3 connexions ; un crash entre deux étapes laisse paid=false avec sortie de caisse (re-clic = 2e décaissement) ou paid=true sans caisse. Le code est en outre **triplé** (~100 l. × 3).
- **`payrollRepository.generate` non scopé store** (`employee.controller.ts:420`) : un manager génère/écrase les bulletins de tous les magasins, et la purge `DELETE FROM payroll` est cross-tenant. Weekly/biweekly passent bien `storeId` — asymétrie.
- **Trous de scoping restants** : `salaryAdvance.outstanding` (fuite cross-store, et sans employeeId renvoie tout le monde), `salaryAdvance.update/remove`, `scheduleController.bulkWeek` (batch non vérifié), `employeeRepository.findAll` exclut `store_id IS NULL` alors que toutes les autres requêtes RH l'incluent (employé « global » : présent en paie, absent du pointage ⇒ salaire 0 avec la 256).
- **Migrations posées mais non branchées** :
  - 241 barèmes fiscaux : `grep payroll_tax_scales server/src` = 0 hit, tous les taux encore en dur (`employee.repository.ts:763-806`), `APPLY_SOCIAL_DEDUCTIONS=false`.
  - 240 timestamptz : `check_in_at/check_out_at` jamais lus par le code ; le validateur refuse toujours `checkOut < checkIn` (shift de nuit bloqué à l'API alors que le trigger DB sait le gérer).
  - 239 audit trail : `updated_by` renseigné sur employees et markPaid, **mais pas sur attendance.upsert** (l'objectif « tracer les requalifications absent→present » n'est pas atteint), ni leaves, ni unmarkPaid ; `employee_salary_history` alimentée mais jamais lue (aucun endpoint).
- Hard delete : commentaire périmé sur `employee_commissions` (dit CASCADE, mig 238 = RESTRICT) → échec FK brut non compté par le preview.

## 5. MAJEUR — Frontend : divergences d'affichage

- **Récap mensuel Pointage** : toujours 100 % local (`/attendance/summary` défini mais jamais appelé) et désormais divergent sur 4 points du serveur : `floor(halfDay/2)` vs 0.5/demi-journée, `2×double` vs 1 jour + extra_shift, pas de filtre `is_expected`, salaire = dailyRate×jours **sans plafond 26** ni ancienneté/H.Sup. La colonne « Salaire calculé » annonce systématiquement plus que le bulletin réel. Le commentaire « STRICTEMENT alignée » (`EmployeesPage.tsx:771-778`) est faux.
- **Colonne « J. Trav. » figée à 26/26** (`worked_days=26` en dur serveur) : le rouge conditionnel `<26` ne se déclenche jamais, aucune colonne absences → un net divisé par 3 s'affiche sans explication. Le COMMENT de la mig 256 contredit le code.
- **Bouton de statut efface H.Sup et notes** (`EmployeesPage.tsx:998-1004` + upsert sans COALESCE sur `overtime_minutes/notes`).
- **Blur du champ H.Sup crée un pointage « présent »** involontaire (mutation inconditionnelle, `status: rec?.status || 'present'`) — +1 jour payé depuis la 256.
- Divers : H.Sup affichées en décimal (vue jour) et en `XhMM` (récap) sur le même écran ; totaux du récap recalculés sur la liste filtrée sans le dire ; KPI masse salariale toujours sur les actifs même en vue « Inactifs ».

## 6. Design / UX

État des lieux : **seule feature mono-fichier de l'app** (3 401 l., 0 sous-fichier vs accounting 15 fichiers, production 12, pos 7). 20 useState, 19 useMutation, 3 moteurs de rendu inline (React + jsPDF + HTML d'impression), 0 breakpoint responsive, 0 gestion Échap, 4 attributs aria.

Points forts à préserver : bulletin à l'écran très bien hiérarchisé (sections colorées, net en 3xl, charges patronales dans un `<details>`, taux inline), textes de confirmation pédagogiques (conséquence comptable expliquée), garde-fous planning/congés.

Problèmes :

1. **Perte silencieuse du brouillon de planning** : `draft` vidé à chaque changement de semaine, onglet démonté au changement d'onglet, pas de `beforeunload` — plusieurs minutes de saisie perdues en un clic, sans avertissement (`hasChanges` n'est jamais consulté pour la navigation).
2. **7 backdrops de modale recopiés à la main** au lieu de `components/ui/ModalBackdrop` (utilisé par 15 autres fichiers) → le bug « drag-select ferme la modale et perd la saisie » est actif sur les formulaires employé, avance et paiement.
3. **Extraction d'erreur axios dupliquée 9×** alors que `getApiErrorMessage` est importé et utilisé 3× dans le même fichier.
4. **Sous-charte teal/cyan hors marque** (10 occurrences ; app = ambre `#C4872B`/prune `#714B67`), jusque dans le bandeau du **PDF de bulletin remis au salarié** (`setFillColor(13,148,136)`).
5. **Deux langages visuels mélangés** : tables/boutons Odoo dense (radius 4 px) + modales consumer `rounded-2xl` à dégradés — transition brutale dans le même écran.
6. **Impression planning via `window.open`** avec sa propre barre d'outils et ses couleurs (`#1e40af`), alors que `PrintOverlay` (compatible Capacitor/tablette) existe et est utilisé ailleurs.
7. **~25 chaînes sans accents** visibles à l'écran et dans le PDF (« Impot sur le revenu », « conge », « Generer les bulletins ») mélangées à des chaînes accentuées.
8. **Tablette** : grille planning ~1 110 px min avec 105 `<select>` natifs, cibles < 44 px, scroll horizontal permanent sur iPad portrait — pire cas tactile du produit.
9. États de chargement incohérents (spinner sur 1 onglet, `<p>Chargement...</p>` sur 6), aucun état vide travaillé, 14 `confirm()` natifs non stylés.

---

## Plan d'action recommandé

### P0 — Paie fausse silencieuse (avant la prochaine clôture de paie)
1. **Congés dans le calcul mensuel** : compter les jours de congé approuvé (payé) comme jours couverts dans `generate` — ou générer des lignes d'attendance `leave` à l'approbation.
2. **Fix `bulkUpsertWeek`** : ne jamais repasser `is_expected=true` sur une ligne dont `is_expected=false` (tester `is_expected`, pas `check_in`).
3. **Garde de génération** : refuser (ou avertir explicitement) la génération d'un mois non terminé ; alerte UI quand `coveredDays=0` avec pointages planning présents ; distinguer visuellement pointage réel vs pré-rempli dans la vue jour.
4. **Garde anti-double paiement inter-fréquences** : vue/contrainte « périodes payées par employé » croisant les 3 tables, vérifiée par chaque `generate`/`markPaid` ; bloquer le changement de `pay_frequency` s'il existe une paie payée sur la période courante.
5. **Scoper `payrollRepository.generate` par store** (et sa purge).
6. **Trancher le sort du quinzaine** : mig 258 de nettoyage (CHECK, table, repository) ou finition du module (retenue d'avance au rythme mensuel réel, régénération qui ne touche pas les lignes payées, delete gardé, H.Sup harmonisées, convention repos alignée).
7. Fix pointage : bouton statut qui préserve `overtime_minutes/notes` (COALESCE), blur H.Sup qui ne crée plus de pointage.

### P1 — Cohérence & sécurité
8. Harmoniser H.Sup (100 % partout ou 125 % partout — décision métier) + docblocks.
9. Récap mensuel Pointage : consommer `/attendance/summary` (à scoper + filtrer `is_expected`) et supprimer le calcul local ; colonne absences/jours retenus dans le tableau de paie et le PDF.
10. Boucher les trous de scoping (advances outstanding/update/remove, bulkWeek, `store_id IS NULL` dans findAll).
11. Compléter l'audit trail : `created_by/updated_by` sur attendance.upsert et leaves, trace de l'auteur d'un unmarkPaid ; endpoint de consultation `employee_salary_history`.
12. Hard delete : couvrir `biweekly_payroll` + `employee_commissions` (et le preview).
13. Retenue d'avance : plafonner `monthly_deduction` au mois calendaire (filtrer les repayments du mois courant dans `outstanding`).

### P2 — Dette technique
14. Transaction PG unique (client partagé + FOR UPDATE) sur markPaid/unmarkPaid, et factorisation du triplé mensuel/hebdo/quinzaine.
15. Brancher les barèmes fiscaux (mig 241) dans `generate` — prérequis à l'activation des cotisations ; brancher `check_in_at/check_out_at` (mig 240) et lever le refus API du shift de nuit.
16. Générations en transaction (éviter l'état partiel au 30e employé) + suppression du N+1.

### P3 — Design & UX
17. Quick wins (<1 j chacun) : protéger le brouillon planning (confirm + beforeunload + draft remonté), `ModalBackdrop` partout, `getApiErrorMessage` partout, accents, teal→charte (PDF inclus), spinner uniforme, Échap + aria-labels.
18. Découpage en 6 fichiers d'onglet + `payslip-pdf.ts` + `schedule-print.ts` ; `ConfirmDialog` stylé remplaçant les 14 `confirm()` (en gardant leurs excellents textes) ; `PrintOverlay` pour le planning.
19. Planning tablette : outil « pinceau » de shift + tap sur cellules au lieu de 105 `<select>`.
20. Trancher l'époque visuelle (Odoo dense vs arrondi) au niveau produit.

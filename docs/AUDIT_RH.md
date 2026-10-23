# Audit du module RH (Employés · Pointage · Congés · Paie · Avances · Planning)

Date : 14/07/2026 — Périmètre : backend (`server/src/routes/employees.routes.ts`, `employee.controller.ts`, `employee.repository.ts`, `salary-advance.repository.ts`, `weekly-payroll.repository.ts`), frontend (`client/src/features/employees/EmployeesPage.tsx`, `employees.api.ts`), schéma (16 migrations RH : 009, 014, 018, 070, 071, 073, 074, 123, 124, 149, 151–153, 155, 211, 228–231).

## Verdict global

Le module est fonctionnellement riche (paie mensuelle marocaine complète + paie hebdo, avances avec créance 3431, pointage multi-statuts, planning) et l'authentification/les rôles sont bien appliqués sur 100 % des routes. Mais il présente **trois familles de risques sérieux** :

1. **Intégrité financière** — le flux « marquer payé » n'est pas transactionnel : un double-clic ou une erreur en cours de route peut produire un **double décaissement de salaire** ou une compta désynchronisée.
2. **Divergences de calcul** — trois versions de la règle du « repos payé » coexistent (doc, serveur, frontend) et le récap mensuel de pointage affiche un salaire différent du bulletin réellement généré. C'est de l'argent réel pour l'employé.
3. **Traçabilité nulle** — aucune trace de qui modifie un salaire, requalifie un pointage `absent` → `present`, ou bascule un bulletin payé/non payé. Incompatible avec vos exigences d'audit ([[project_traceability]]).

---

## 1. CRITIQUE — Flux de paiement non transactionnel

*Analogie Oracle : chaque étape de `markPaid` est une transaction autonome (`PRAGMA AUTONOMOUS_TRANSACTION`) alors que tout devrait être un seul bloc PL/SQL avec `SELECT ... FOR UPDATE` et un unique COMMIT.*

- **Double décaissement possible** — `employee.repository.ts:919-995` (mensuel) et `weekly-payroll.repository.ts:181-254` (hebdo) : `UPDATE payroll SET paid=true` → création du paiement (sa propre transaction) → `applyDeduction` (sa propre transaction). Si `applyDeduction` échoue, le catch remet `paid=false` **sans supprimer le paiement créé** : la sortie de caisse reste, et un re-clic en crée une deuxième.
- **Course sur l'idempotence** — `if (current.paid) return` puis `UPDATE ... SET paid=true` sans `WHERE paid=false` ni verrou : deux requêtes concurrentes (double-clic) passent toutes deux → deux paiements.
- **Retenue d'avance non vérifiée** — le montant réellement imputé retourné par `applyDeduction` est ignoré (`employee.repository.ts:977-985`). Si une paie concurrente consomme le solde entre la validation et l'imputation, le cash sort avec la retenue pleine mais la créance 3431 n'est éteinte que partiellement.
- **`unmarkPaid` non transactionnel** (`employee.repository.ts:1003-1025`) : un échec au milieu (ex. période comptable close) laisse un bulletin « payé » sans sortie de caisse.
- Même fragilité sur `salary-advance.repository.ts:94-130` (create : avance orpheline possible) et `remove` (l'ordre réel des suppressions contredit le commentaire l.265-267).

**Recommandation P0** : envelopper tout `markPaid`/`unmarkPaid` dans **une seule transaction PG** (`BEGIN ... COMMIT` via un client partagé passé aux repositories), avec `SELECT ... FOR UPDATE` sur la ligne payroll et `UPDATE ... WHERE paid=false RETURNING` comme garde d'idempotence. Factoriser le code mensuel/hebdo (~100 lignes dupliquées, mêmes bugs dupliqués).

## 2. CRITIQUE — La règle « repos payé » existe en 3 versions

| Où | Règle |
|---|---|
| Règle métier validée (et docblock `weekly-payroll.repository.ts:14-28`) | +1 jour payé dès que l'employé a travaillé (4 travaillés → 5 payés) |
| Code serveur (`weekly-payroll.repository.ts:135-144`) | `< 4 jours travaillés → 0 repos`, sinon `min(wd/6, 1)` (4 travaillés → 4,67 payés) |
| Frontend (`EmployeesPage.tsx:1893-1899`) | `min(wd/6, 1)` sans le seuil de 4 jours |

Les trois convergent uniquement à 6 jours travaillés. **Recommandation P0** : trancher la règle (décision métier), l'implémenter au serveur seulement, et faire afficher au frontend la valeur renvoyée par le serveur — jamais un recalcul local.

## 3. CRITIQUE — Divergences d'affichage frontend vs paie réelle

- **Récap mensuel Pointage** (`EmployeesPage.tsx:657-665, 727-784`) : le calcul local ignore les statuts `repos` (payé) et `double` (2 jours) que le serveur compte (`employee.repository.ts:785-797`). La colonne « Salaire calculé » est fausse dès qu'il y a un repos ou un double shift. Le endpoint serveur `/attendance/summary` existe (`employees.api.ts:41`) mais n'est jamais appelé — l'utiliser et supprimer le calcul local.
- **Pointage : valeurs périmées** (`EmployeesPage.tsx:818, 886-923`) : inputs `defaultValue` keyés par `emp.id` seul → en changeant de jour (◀ ▶), les heures du jour précédent restent affichées et peuvent être **enregistrées sur le mauvais jour**. Fix : `key={emp.id + selectedDate}`.
- **« Dupliquer S-1 » décale le planning** (`EmployeesPage.tsx:2809-2837`) : mapping ordinal sur une map sparse — si l'employé était en repos lundi S-1, toute sa semaine glisse d'un jour. Mapper par date (+7 j), pas par position.

## 4. MAJEUR — Sécurité et validation

- **Aucun validateur RH** (`server/src/validators/` n'a rien pour employees/payroll/attendance/leaves) : salaires négatifs acceptés, `overtimeMinutes` négatif, `checkOut < checkIn`, `leaves.days` fourni par le client sans être confronté aux dates (fausse les soldes), `month/year` bruts vers le SQL.
- **Requêtes qui restent pendantes** — aucune route RH n'utilise `asyncHandler` (qui existe) et Express 4.21 ne route pas les rejets async vers `errorHandler` : toute erreur PG = requête HTTP qui pend jusqu'au timeout. *Analogie : bloc sans `EXCEPTION WHEN OTHERS` — sauf qu'ici l'appelant ne reçoit même pas l'erreur.*
- **Scoping multi-store incohérent (IDOR)** — `list` est filtré par store mais `getById/update/remove` (`employee.controller.ts:13-45`), `payrollRepository.findAll` (`employee.repository.ts:667-684`), `markPaid/unmarkPaid`, attendance/leaves/schedules ne le sont pas : un MANAGER du magasin A peut lire/modifier les employés et bulletins du magasin B.
- **Contournement du flux caisse** — `PUT /payroll/:id` accepte `paid`, `paidAt`, `paymentMethod` (`employee.repository.ts:897-900`) : on peut marquer « payé » sans sortie de caisse ni retenue d'avance. Idem `PUT /weekly-payroll/:id` qui laisse réécrire `net_amount` même quand `paid=true`.
- **Formule de recalcul fausse** — `payrollRepository.update` (`employee.repository.ts:909-911`) recalcule le net en omettant `seniority_bonus` et `extra_shift_amount` : modifier une prime corrompt le net.
- Point positif : aucune injection SQL trouvée (tout est paramétré), JWT avec révocation, rôles partout, anti-CSRF global.

## 5. MAJEUR — Intégrité des données

- **Hard delete employé incomplet** (`employee.repository.ts:92-158`) : la cascade manuelle oublie `weekly_payroll` et `salary_advances` → erreur FK brute pour tout employé hebdo ou avec avance ; et `DELETE FROM payments` en SQL brut (l.128) contourne la reverse comptable → **écritures de journal orphelines**. Le preview `countDependencies` ne compte pas ces tables.
- **Deux CASCADE destructeurs** : `employee_commissions` (mig 123) et `salary_advance_repayments` (mig 228:55) — supprimer une avance efface le lettrage mais laisse les écritures comptables `advance_repayment` → désynchronisation garantie. Passer en RESTRICT.
- **Congés** : aucun `CHECK (end_date >= start_date)`, aucune contrainte anti-chevauchement (deux congés approuvés sur les mêmes dates possibles, `balanceByEmployee` double-compte), `days` non validé. Côté UI : pas de confirmation à l'approbation, aucun moyen d'annuler un congé approuvé (`leavesApi.remove` jamais câblé), année en dur.
- **Pointage de nuit irreprésentable** : `attendance.check_in/check_out` sont des `TIME` sur une seule date (mig 018) alors que le shift NIGHT fait 22h→06h → durée incalculable. Migrer vers `TIMESTAMPTZ`.
- **CHECK manquants** : salaires (`monthly_salary`, `weekly_salary`, `hourly_rate`) sans `>= 0`, `payroll.year` non borné, invariant « week_start = lundi » non contraint (mig 153).
- **`employees.role` texte libre** malgré le référentiel `ref_entries('employee_roles')` (mig 071) — aucune FK/CHECK.
- Divers : `paie hebdo generate` sur semaine payée réécrit `base_amount/worked_days` en préservant `net_amount` (incohérence interne) ; paie mensuelle ne filtre pas `is_expected=false` (les pointages pré-remplis par le planning gonflent les jours travaillés) alors que l'hebdo le fait ; `monthlySalary === 0` silencieusement converti en NULL.

## 6. MAJEUR — Traçabilité (conformité audit)

Sur `employees`, `attendance`, `leaves`, `payroll`, `weekly_payroll` : uniquement `created_at`. Pas de `updated_at/updated_by/created_by` (sauf `salary_advances.created_by`), aucun historique. Concrètement :

- Changer un salaire écrase la valeur **sans historique ni date d'effet**.
- Requalifier un pointage la veille de la paie est invisible (risque de fraude) — alors que le pointage *initial* est bien tracé (`check_in_method/terminal`, migs 123/124).
- `payroll.paid` basculable sans trace de l'auteur (`paid_at` existe, pas `paid_by`).

Le bon pattern existe déjà dans le projet : `manual_shift_entries` (mig 149) a `created_by/updated_by/updated_at`. *Analogie Oracle : il manque le trigger d'audit `:OLD/:NEW` vers une table `_HIST` — en PG, un trigger `AFTER UPDATE` vers une table `employees_salary_history` fait exactement ça.*

## 7. Conformité paie marocaine

- Le bulletin mensuel est complet (CNSS/AMO/IR/CIMR/TFP, charges patronales — migs 073/074) mais **tout le barème est neutralisé** par `APPLY_SOCIAL_DEDUCTIONS = false` (`employee.repository.ts:752`) et la **paie hebdo n'a aucune colonne de cotisation** : les employés hebdo sont payés en brut sans retenue modélisée. Choix assumé, mais risque de conformité à documenter/planifier.
- Aucune table de barèmes : taux CNSS/AMO/IR codés en dur, sans versionnage — un changement de loi de finances réécrirait les recalculs historiques.
- Convention de taux journalier divergente : mensuel = base/26, hebdo = salaire/7. Un employé qui change de fréquence change de valeur de journée.
- `cnss_number` nullable sans garde-fou : bulletin avec cotisations possible pour un employé sans numéro CNSS.
- Points conformes : repos hebdo payé distinct d'absent (mig 155), proratisation jours/6 et demi-journées (mig 231).

## 8. Dette frontend — EmployeesPage.tsx (3 202 lignes)

Un seul fichier : 9 composants inline, 19 `useState`, 12 `useQuery`, 18 `useMutation`, générateur PDF jsPDF (~130 lignes) et template HTML d'impression (~115 lignes) inline, 7 modales qui réimplémentent le même backdrop, extraction du message d'erreur axios copiée-collée 9× (33× dans tout le client), quasi tout typé `Record<string, any>`.

Autres points : mutations congés sans `onError` (échec silencieux), « Générer les bulletins » sans confirmation, invalidation `['attendance-monthly']` manquante après pointage, mutation H.Sup déclenchée à chaque blur même sans modification, impossible d'effacer une heure saisie par erreur, tri/récap recalculés à chaque render (O(n²) par frappe), pas de guard de route côté client (la page se rend pour tout connecté et affiche « Aucun employé trouvé » au lieu d'un refus — les salaires restent protégés par le serveur), APIs mortes (`monthlySummary`, `balance`, `bulkUpsert`, `schedulesApi.*`…), état des onglets perdu à chaque bascule.

**Plan de découpage** : 1 fichier par onglet + `PayrollPayDialog`/`SortableHeader`/`StatCard` partagés, `lib/payslipPdf.ts`, `lib/printSchedule.ts`, helper `getApiErrorMessage()` global.

---

## Plan d'action recommandé

### P0 — Risque financier immédiat (à faire avant tout)
1. Transaction unique + verrou (`FOR UPDATE`, `WHERE paid=false`) sur `markPaid`/`unmarkPaid` mensuel et hebdo ; vérifier le retour d'`applyDeduction`.
2. Trancher la règle du repos payé, l'implémenter au serveur uniquement, supprimer les recalculs frontend (repos + récap mensuel → utiliser `/attendance/summary`).
3. Corriger la formule de `payrollRepository.update` (ou interdire l'édition des composants après génération).
4. Retirer `paid/paidAt/paymentMethod` du mapping de `PUT /payroll/:id` et verrouiller l'édition d'un bulletin payé.
5. Fix des 2 bugs de saisie frontend : inputs pointage périmés (key par date) et « Dupliquer S-1 ».

### P1 — Sécurité & intégrité
6. Validateurs (zod ou pattern existant des autres modules) sur tous les endpoints RH + `asyncHandler` sur toutes les routes.
7. Scoping `store_id` systématique (getById/update/payroll/attendance/leaves).
8. Hard delete : couvrir `weekly_payroll`/`salary_advances`/`repayments`, passer par `paymentRepository.delete` pour reverser la compta, corriger le preview.
9. Migration corrective : RESTRICT sur les 2 CASCADE, CHECK salaires ≥ 0 / dates congés / année, contrainte d'exclusion anti-chevauchement congés, FK `role` → référentiel.

### P2 — Traçabilité & conformité
10. `updated_at/updated_by/paid_by` sur les 5 tables RH + table `employee_salary_history` (trigger) ; tracer les requalifications de pointage.
11. `TIMESTAMPTZ` pour check_in/check_out (prérequis shift de nuit).
12. Table de barèmes versionnée (CNSS/AMO/IR) pour le jour où les cotisations seront activées ; documenter la décision paie hebdo brute.

### P3 — Dette & UX
13. Découpage d'EmployeesPage en fichiers par onglet + helpers partagés.
14. Câbler les APIs mortes utiles (solde de congés, annulation de congé, suppression d'un pointage) et retirer les autres.
15. Confirmations manquantes (génération bulletins, approbation congé), `onError` sur toutes les mutations, guard de route côté client.

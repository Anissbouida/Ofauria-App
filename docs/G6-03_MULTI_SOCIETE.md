# G6-03 — Multi-société

Plan d'action global 2026-11, section 12. Objectif : qu'une même installation Kalum tienne
plusieurs sociétés (entités juridiques), chacune avec son identité légale, sa numérotation,
son plan comptable et ses exercices, et que chaque établissement émette ses pièces au nom
de sa société.

Le chantier se fait en deux phases. La phase 1 (ce lot) pose le socle **sans rien changer**
pour une installation mono-société. La phase 2 sépare la comptabilité.

---

## 1. Phase 1 — livrée

### 1.1 Données (migrations 608 et 609)

| Objet | Rôle |
|---|---|
| `legal_entities` | une ligne par société : code, raison sociale, nom commercial, forme, capital, ICE, IF, RC, patente, CNSS, adresse, ville, code commune DGI, téléphone, e-mail, site, devise, pays, logo facultatif, `is_default`, `is_active` |
| `uq_legal_entities_default` | une seule entité par défaut (index unique partiel) |
| `stores.legal_entity_id` | NOT NULL, FK `ON DELETE RESTRICT` ; un établissement créé sans entité reçoit l'entité par défaut (déclencheur `trg_stores_default_entity`) |
| `fn_default_legal_entity()` | identifiant de l'entité par défaut |
| `document_sequence_entity_series` | variante d'une série de numéros pour une entité (modèle, chiffres, remise à zéro) |
| `document_sequence_entity_counters` | compteurs de ces variantes |
| `next_document_number_v2(type, date, entité)` / `preview_document_number_v2` | numéro de la variante de l'entité, sinon délégation à `next_document_number` (série globale, comportement de la mig 329) |

Une installation existante obtient **exactement une** entité (`PRINCIPALE`), créée depuis
`company_settings` (identité `legal_*`, `company_name`) et `payroll_settings.employer_cnss_number`.
Le pays est repris de `company_settings.country_code` si le pack pays (mig 606-607, travail
parallèle) l'a créé, sinon `MA`. La devise est `fn_base_currency()`.

### 1.2 Sort de `company_settings`

`company_settings` **reste** la source des paramètres applicatifs (thème, ticket, production,
sécurité, secteur…). Ses champs d'identité légale (`legal_*`, `company_name`) deviennent le
**miroir de l'entité par défaut**, tenu par une synchronisation dans les deux sens :

- `trg_company_settings_sync_entity` : une modification de la fiche société (PUT /settings,
  centre de paramètres, import) est recopiée sur l'entité par défaut ;
- `trg_legal_entities_sync_company` : une modification de l'entité par défaut, ou le choix
  d'une autre entité par défaut, est recopiée sur `company_settings` (et le CNSS sur
  `payroll_settings`) ;
- `trg_payroll_settings_sync_entity` : CNSS employeur → entité par défaut.

La boucle s'arrête d'elle-même : chaque côté ne met l'autre à jour que si une valeur diffère.

**Pourquoi une synchronisation plutôt qu'une vue.** Les colonnes `legal_*` sont lues et
écrites à de nombreux endroits (PUT /settings, centre de paramètres, export/import des
données, état de la configuration, mise en route des modules, client). Les remplacer par une
vue imposait de supprimer les colonnes et de réécrire tous ces chemins d'un coup, avec un
risque de régression élevé. La synchronisation laisse ces chemins intacts pendant la
transition ; la phase 2 supprimera les colonnes et les déclencheurs.

Le logo n'est pas recopié : `legal_entities.logo_url` NULL = logo de la société.

### 1.3 Helper serveur

`server/src/services/legal-entity.ts` :

- `entityForStore(storeId)` — entité de l'établissement ; inconnu ou absent → entité par défaut ;
- `currentEntity(req)` / `requestLegalContext(req)` — établissement de l'utilisateur connecté ;
- `resolveLegalEntity({ entityId?, storeId? })` — entité imposée > établissement > défaut ;
- cache court (5 s, `LEGAL_ENTITY_CACHE_MS`, désactivé sous vitest), vidé à chaque écriture
  (`clearLegalEntityCache`, appelé par l'écran des entités et PUT /settings) ;
- avant la mig 608, renvoie `null` : les appelants retombent sur `company_settings`.

`server/src/utils/company-legal.ts` : `loadCompanyLegal(ctx)`, `companyLegalFromEntity`,
`loadEmployerLegal(ctx, cnssPaie)` (bulletins, attestations), `loadLegalLogo`.
`loadDocumentTemplate(type, ctx)` (pied de page légal des PDF) prend aussi le contexte ; pour
une entité autre que celle par défaut, le compte bancaire affiché est cherché parmi les
comptes des établissements de cette entité.

### 1.4 Lectures d'identité désormais par entité

| Pièce | Contexte |
|---|---|
| Facture / avoir PDF (`invoice-pdf-builder`, portail client inclus) | établissement de la facture |
| Devis / proforma PDF | établissement du devis |
| Bon de livraison PDF | établissement du BL |
| Bon de commande fournisseur PDF | établissement du BC |
| Demande de prix (e-mail fournisseurs) | établissement de la demande |
| Lettre de relance (texte et PDF) | établissement de l'utilisateur (une relance n'a pas d'établissement) |
| Lettre d'ordre de campagne de paiement | établissement de la campagne |
| Bulletin de paie, attestations de travail/salaire, reçu de solde, certificat de travail | établissement du salarié (CNSS de l'entité si ce n'est pas l'entité par défaut) |
| Rapport Z imprimé | établissement de la session de caisse |
| Aperçu des modèles de documents | établissement de l'utilisateur |

Lectures **laissées sur l'entité par défaut** (ou sur `company_settings`), car les livres et
les paramètres concernés ne sont pas encore séparés par société :

- FEC (`fec.service.ts`), éditions comptables (`ledger-editions`), liasse fiscale et EDI DGI
  (`liasse.repository`, `dgi-edi.service`) : la comptabilité est unique jusqu'à la phase 2.
  Le FEC lit encore `company_settings` en direct (miroir exact de l'entité par défaut) pour
  garder son repli « — » quand la raison sociale est vide ;
- ordre de virement des salaires : le RIB employeur est dans `payroll_settings` (global) ;
- fiche technique de recette : référentiel commun à la société ;
- tickets de caisse et classeur de contrôle des ventes : ils affichent le **nom commercial**
  (`company_name`, paramètre d'image de marque), pas l'identité légale ;
- toutes les lectures de paramètres applicatifs de `company_settings WHERE id = 1`
  (production, sécurité, gouvernance, secteur, sachets, remise du personnel, logo…).

### 1.5 Écran

Paramètres › Société › **Entités juridiques** : liste des entités, création et modification
d'une entité, choix de l'entité par défaut, rattachement de chaque établissement à une entité.
L'entité par défaut s'édite dans la fiche société en haut de la page (même source). Droit :
section « company » des paramètres, le même que la fiche société.

API : `GET/POST /settings/legal-entities`, `PUT /settings/legal-entities/:id`,
`PUT /settings/legal-entities/stores/:storeId`.

### 1.6 Numérotation par entité

Sans variante (cas de toute installation actuelle), aucun numéro ne change : les appelants
utilisent toujours `nextDocumentNumber(runner, type, date)`. Le quatrième argument
facultatif `{ legalEntityId }` appelle `next_document_number_v2`. Aucun appelant ne le passe
encore : brancher la portée entité sur la création des pièces (facture émise d'abord) fait
partie de la phase 2, avec l'écran des variantes de séries.

Règle d'unicité : le modèle d'une variante doit différer du modèle global (contrôle dans la
fonction) et des autres variantes du même type (index `uq_dses_pattern`), car les numéros
partagent la même table cible et ses contraintes d'unicité.

---

## 2. Phase 2 — à faire

### 2.1 Plan comptable par entité

- `accounts` (plan comptable, mig 429) : ajouter `legal_entity_id uuid NULL REFERENCES legal_entities`.
  NULL = compte du plan commun (PCGE), partagé ; une ligne avec entité = compte propre ou
  surcharge. Unicité : remplacer l'unique sur `code` par
  `UNIQUE (COALESCE(legal_entity_id, '00000000-…'::uuid), code)` (ou deux index partiels).
- Résolution d'un compte : compte de l'entité s'il existe, sinon compte commun.
- Comptes par défaut (journaux, catégories de charges/recettes `family_revenue_accounts`,
  auxiliaires `account_auxiliaries`, taxes) : ajouter une portée entité facultative, même règle.

### 2.2 Écritures, journaux, exercices

- `journal_entries.legal_entity_id NOT NULL` : rempli depuis `stores.legal_entity_id` de
  l'écriture (déclencheur BEFORE INSERT), puis contrainte. Les écritures sans établissement
  prennent l'entité par défaut. Index `(legal_entity_id, entry_date)`.
- `journals` : portée entité (un journal de banque appartient à une société).
- `fiscal_years`, `fiscal_periods`, `fiscal_period_events` : ajouter `legal_entity_id NOT NULL` ;
  l'unique `fiscal_years_year_key (year)` devient `(legal_entity_id, year)` ; clôture, à-nouveaux et verrous
  (`fn_ledger_window_start`, mig 416) calculés par entité.
- Chaînage d'inaltérabilité (mig 413) : une chaîne **par entité** (`chain_seq` et
  `chain_hash` repartent par société) ; nouvelle fonction `_v2`, jamais de `CREATE OR REPLACE`
  sur les fonctions de prod existantes.
- Numérotation des écritures (`entry_number`) par entité, et branchement de la portée entité
  sur les séries de pièces (facture émise, avoir, BL, devis…) via `next_document_number_v2`.

### 2.3 Éditions et déclarations

- FEC, balance, grand livre, journaux, liasse, EDI TVA/IS (9421) : paramètre d'entité
  obligatoire, filtre `legal_entity_id`, identité via `loadCompanyLegal({ entityId })`.
- Consolidation (mig 437) : les entités deviennent les sociétés consolidées (le périmètre
  actuel par établissement se ramène aux entités).

### 2.4 Cloisonnement (RLS)

- Politique RLS par entité sur `journal_entries`, `journal_entry_lines`, `invoices`,
  `payments`, `fiscal_*`, à partir d'un réglage de session `app.legal_entity_id` posé par
  le middleware (même mécanique que `RLS_STORE_SCOPE`, mig 436, encore éteint).
- Utilisateurs : liste des entités accessibles (`user_legal_entities`), contrôle à la
  connexion et à chaque changement d'entité active.

### 2.5 Paramètres encore globaux à répartir

- `payroll_settings` (RIB employeur, CNSS, barèmes) → par entité ;
- `company_bank_accounts` → `legal_entity_id` explicite (aujourd'hui déduit des établissements) ;
- TVA (`tax_codes`), régime de TVA, devise de base → par entité si les sociétés diffèrent ;
- suppression des colonnes `company_settings.legal_*` et des déclencheurs de synchronisation
  une fois que plus aucun code ne les lit (PUT /settings écrira l'entité par défaut).

### 2.6 Écran

- Sélecteur d'entité active dans l'en-tête des modules Comptabilité et Paie.
- Paramètres › Numérotation : variantes de séries par entité.

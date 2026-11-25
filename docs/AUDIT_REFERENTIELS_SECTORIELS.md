# Référentiels pilotés par le secteur — audit et architecture (25 novembre 2026)

Constat de départ : une société configurée « Bâtiment et travaux publics » voyait les familles
Farines, Sucres, Levures…, les fonctions Boulanger et Pâtissier, les équipements Pétrin et Laminoir.

## 1. Audit de l'existant

**Architecture.** 35 tables déclarées dans `ref_tables` : 31 génériques (valeurs dans `ref_entries`)
et 4 natives (`expense_categories`, `revenue_categories`, `categories`, `recipe_categories`). Tous
les écrans lisent `is_active`.

**Cause racine.** Les valeurs étaient posées par les migrations pour toute société, sans aucun
rattachement à un secteur. Le changement de secteur ne touchait que les modules, les capacités et
le vocabulaire. Seule exception : un filtre isolé `metadata.sectors` sur les rôles de composant.

**Classement des tables.**

| Niveau | Tables |
|---|---|
| Communes (aucune valeur métier) | modes de paiement, motifs d'absence, types de contrat, types de congé, motifs achats, motifs de réclamation, devis perdus, causes de non-conformité, sources CRM, types de contenant, cycles de vente, motifs de perte et de rebut |
| Mixtes (tronc commun + valeurs d'un métier) | familles d'articles, unités, fonctions des employés, types d'étape, types d'équipement, paramètres de relevé, rôles de composant, unités de rendement, unités de lancement, types de production, unités de vente, catégories d'emballages, types d'activité des projets |
| Propres à un métier | types de découpe (boulangerie) |
| Natives avec valeurs boulangères | catégories de revenus (Boulangerie, Pâtisserie, Viennoiserie…), catégories de production, deux types de dépense (Fours & Pétrins, Ustensiles pâtisserie) |

**Listes codées en dur (60 constats).** Les plus bloquantes sont corrigées (§ 4) ; le reste est listé au § 5.

## 2. Architecture cible (migration 698)

Trois niveaux, portés par chaque valeur de `ref_entries` :

| Niveau | Définition | Colonnes |
|---|---|---|
| Commun | valable pour tous | `sectors` et `specializations` vides |
| Sectoriel | rattaché à des profils (hérité par leurs profils enfants) et/ou à des spécialités | `sectors`, `specializations` |
| Personnalisé | créé par la société | `origin = 'company'` |

- **Héritage** : `fn_sector_lineage` remonte la chaîne `base_sector` ; un profil enfant reçoit les valeurs de ses parents.
- **Plusieurs activités** : union des profils principal et secondaires (`company_sectors`).
- **Spécialités** : seules comptent celles qui relèvent des profils actifs (`fn_active_specializations`).
- **Surcharge** : le libellé d'une valeur livrée se modifie ; `system_label` garde l'original (action « Rétablir le libellé d'origine »).
- **Activation** : `activation = 'auto'` suit le secteur ; `forced_on` / `forced_off` est un choix de la société, conservé à chaque changement (action « Suivre le secteur » pour y revenir).
- **Versionnement** : `ref_sector_sync_log` garde, pour chaque synchronisation, les profils, les spécialités et les valeurs activées, désactivées ou conservées ; `catalog_version` par valeur.
- **Modules** : `ref_tables.module` et `ref_tables.sectors` masquent, dans l'écran Référentiel, les tables d'un module inactif ou d'un autre métier ; `label_overrides` donne le libellé de la table par profil (« Familles de matériaux » en BTP).

**Mécanisme.** `fn_ref_sync_sectors()` aligne `is_active` sur les profils et spécialités actifs. Elle est
appelée par des déclencheurs sur `company_sectors` et `company_specializations` : quel que soit le
chemin (assistant, Paramètres, restauration d'une version, import), les listes suivent. Aucun écran
n'a besoin de connaître le secteur.

**Intégrité des données.** Rien n'est supprimé. Une valeur utilisée par des données (clé étrangère,
colonne « code » déclarée dans `ref_usage_sources`, catégorie de dépense miroir) n'est jamais
désactivée. Les libellés historiques restent lisibles.

**Catalogue livré.** Familles d'articles, unités, fonctions, types d'équipement, types d'étape et
types d'activité pour les 13 profils de l'assistant (BTP, industrie, textile, négoce, détail,
e-commerce, restauration, agriculture, transport, services, santé…), dont des valeurs par spécialité
(second œuvre, travaux publics, élevage, hôtel, formation…). Ajouter un secteur = des lignes de
données, sans code.

## 3. Intégration

- **Assistant de configuration** : l'étape Révision annonce, par liste, les valeurs proposées et celles retirées ; la publication déclenche la synchronisation dans la même transaction.
- **Paramètres › Référentiel** : bandeau des profils actifs, bouton « Réaligner sur le secteur », étiquettes Secteur / Personnalisée / Libellé modifié, catalogue des autres secteurs consultable (activation à la demande), tables hors secteur masquées par défaut.
- **API** : `GET /params/scope`, `GET /params/scope/preview`, `POST /params/scope/sync`, `PUT /params/:table/:id/follow-sector`, `PUT /params/:table/:id/restore-label`.

## 4. Corrections de code

| Constat | Correction |
|---|---|
| Import Excel des articles : familles boulangères en liste blanche | accepte les familles actives du référentiel |
| Pipeline produit : responsable limité aux rôles boulanger/pâtissier/viennoiserie (liste vide ailleurs) | tous les utilisateurs si aucun de ces rôles n'existe |
| Rôles de composant : filtre sectoriel propre à une table | remplacé par la règle commune |
| Packs de départ et spécialités : valeurs créées sans rattachement | rattachées à leur profil ou à leur spécialité |
| Sélecteur des catégories de production | ne propose que les catégories actives |

## 5. Reste à faire

- **Rôles d'accès** (`ROLES`, `ROLE_GROUPS`, `ROLE_LABELS` dans `shared`) : toujours les rôles boulangers ; plannings, pointage et paies hebdomadaires affichent ces libellés au lieu du référentiel des fonctions.
- **Énumérations serveur qui doublent un référentiel** : unité et cycle de vente d'un article, types de contrat et de congé, familles de perte, types d'emplacement, équipements HACCP.
- **Vocabulaire « fournée »** écrit en dur dans une dizaine d'écrans de production.
- **Contenants de production** (104 lignes) posés par les migrations pour toute société : ils gardent actives les valeurs boulangères qu'ils utilisent (sans effet visible quand le module Production est inactif).
- **Profil Agroalimentaire** : aucune fonction propre (une valeur rattachée à ce profil serait héritée par la boulangerie, dont les listes ne doivent pas changer).
- **Catégories de dépenses** : le libellé « Ingrédients » du niveau 2 reste boulanger ; pas de catégories de dépenses propres aux autres secteurs.
- **Motifs de perte et de rebut** (« Brûlé / trop cuit »…) laissés communs : leurs codes sont utilisés par les traitements.
- Allergènes et HACCP affichés sans condition de capacité.

## 6. Validation

`server/src/__tests__/db/referentiels-sectoriels.db.test.ts` (12 cas) : cohérence du catalogue, les
13 profils, BTP, aller-retour boulangerie sans écart, choix manuels conservés, valeur utilisée
protégée, plusieurs activités, spécialités, héritage, tables natives, aperçu sans écriture.

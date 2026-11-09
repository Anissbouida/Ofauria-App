# Audit Ventes — D1 « Référentiels clients et organisation commerciale »

Date : 2026-11-09 · Branche : `claude/kalum-sales-cycle-o2c-audit-f724ad` · Dernière migration lue : 467.

Audit en lecture seule. Chaque constat est rattaché à une preuve `fichier:ligne` ou à un numéro de migration.
Rien n'a été exécuté (ni serveur, ni base, ni test) : les comportements décrits sont déduits de la lecture du code.

---

## 1. Périmètre et sources lues

**Périmètre.** La fiche client (identité, adresses, contacts, hiérarchie), la segmentation, les conditions
commerciales et fiscales portées par le client, les blocages et statuts, la qualité des données, les pièces
jointes et champs personnalisés, l'assortiment par client, la vue 360°, le lien prospect/CRM, l'organisation
commerciale (sociétés, magasins, canaux, équipes, territoires), la communication et la protection des données,
l'import/export/API/portail, et le rattachement de la fidélité.

Hors périmètre (audités ailleurs) : moteur de prix et de promotions, moteur de fidélité, cycle
commande-livraison-facture, recouvrement. Ils ne sont cités que pour ce qu'ils lisent sur la fiche client.

**Références de comparaison.** SAP S/4HANA (Business Partner, SD), Oracle Fusion (Trading Community
Architecture, Receivables), Microsoft Dynamics 365 (Sales, Finance, SCM, Commerce), NetSuite, Sage X3,
Odoo Enterprise.

**Sources lues.**

| Couche | Fichiers |
|---|---|
| Schéma client | `server/migrations/007_create_customers.sql`, `031_customer_delete_cascade.sql`, `092_customers_enrichment.sql`, `242_customer_types_enrichment.sql`, `243_customer_names_nullable.sql`, `354_commandes_particuliers_pros.sql`, `366_relances_clients.sql`, `369_champs_personnalises.sql`, `441_o2c_flux_livraisons_partielles_l2.sql`, `443_o2c_credit_prix_l3.sql` |
| Schéma voisin | `025_multi_store.sql`, `172_sales_channels.sql`, `173_product_channel_pricing.sql`, `179_ledger_accounts.sql`, `208_provision_missing_auxiliaries.sql`, `210_withholding_taxes.sql`, `304_fournisseurs_identite_legale_audit.sql` (comparaison fournisseurs), `310_paiements_modes_plafond_void.sql`, `326_identite_legale_entreprise.sql`, `328_journal_audit_parametres.sql`, `331_societe_etablissements_tva.sql`, `352_bons_livraison_clients.sql`, `357_reclamations_clients.sql`, `365_devis_clients.sql`, `371_crm_pipeline.sql`, `372_promotions_fidelite.sql`, `387_tournees_livraison.sql`, `431_multidevise_ventes_reevaluation.sql`, `436_rls_etablissement_partitions.sql` |
| Serveur | `server/src/routes/customers.routes.ts`, `controllers/customer.controller.ts`, `repositories/customer.repository.ts`, `repositories/crm.repository.ts`, `repositories/delivery-note.repository.ts`, `repositories/dunning.repository.ts`, `routes/dunning.routes.ts`, `services/credit-control.ts`, `services/data-import.ts`, `services/data-export.ts`, `services/journal-generator.service.ts`, `repositories/sale.repository.ts`, `repositories/audit-log.repository.ts`, `repositories/report-builder.repository.ts`, `controllers/order.controller.ts`, `controllers/accounting.controller.ts`, `controllers/search.controller.ts`, `middleware/{role,error,module-guard,rls-scope,tenant}.middleware.ts`, `routes/{index,sales-channel,store,delivery-route,custom-fields,settings,upload}.routes.ts` |
| Partagé | `shared/src/types/customer.types.ts`, `shared/src/constants/{roles,modules,approvals}.ts` |
| Client | `client/src/features/customers/CustomersPage.tsx` (932 lignes, lu en entier), `client/src/api/customers.api.ts`, `client/src/features/sales/SalesLayout.tsx`, `ReceivablesTab.tsx`, `EmittedInvoicesTab.tsx`, `client/src/features/crm/CrmPage.tsx`, `client/src/features/dunning/DunningPage.tsx`, `client/src/features/pos/UnpaidCustomerPicker.tsx`, `client/src/App.tsx` |

Les documents `docs/AUDIT_O2C_GAP_ANALYSIS.md`, `AUDIT_POS.md`, `AUDIT_PRODUITS.md`, `AUDIT_COUPLAGE_SECTORIEL.md`
n'ont servi que de contexte ; aucun statut n'en est repris sans vérification dans le code.

---

## 2. Ce qui existe (forces, avec preuves)

1. **Fiche client à quatre types** (particulier, société, association, revendeur) avec sections adaptées au
   type : identité de l'entreprise, identifiants légaux, contact principal, conditions commerciales.
   Schéma : mig 092 et 242 ; écran : `CustomersPage.tsx:716-931` ; API : `customers.routes.ts:30-38`.
2. **Identifiants légaux marocains** : ICE (unique quand renseigné, mig 242:38), IF, RC + ville, TP, CNSS,
   forme juridique ; récépissé et président pour les associations (mig 242:15-25, écran `:815-839`).
   Le fichier signale les sociétés sans ICE (bandeau `:296-304`, étape « Fiche à compléter » `:79-84`).
3. **Conditions commerciales réservées à la direction** : plafond de crédit, remise, délai de paiement,
   exonération de TVA, rythme de facturation et type de client ne sont modifiables que par admin/gérant,
   contrôle fait par le serveur (`customer.controller.ts:51-76`) et reflété à l'écran (`:726`, `:896-902`).
4. **Contrôle de crédit complet** : encours unique `fn_customer_exposure` (mig 443:21), décision à chaque
   jalon (création, confirmation, expédition, ticket à crédit), journal `credit_check_events`, dérogation
   motivée à l'expédition (`services/credit-control.ts:44-69`). Situation de compte sur la fiche
   (`customers.routes.ts:32`, `CustomersPage.tsx:489-564`).
5. **Blocage crédit et pause des relances** : `credit_hold`, motif, date, auteur, `dunning_paused_until`
   (mig 366:101-105) ; pose et levée depuis Relances (`dunning.routes.ts:108-118`, `DunningPage.tsx:187-193`).
6. **Rythme de facturation par client** (mensuel regroupé ou à chaque livraison), lu par le BL et par la
   tâche planifiée (mig 354:38, `delivery-note.repository.ts:298`, `scheduler.ts:168-175`).
7. **Relevé de compte** par période avec solde glissant (`customers.routes.ts:33`, `ReceivablesTab.tsx:363`).
8. **Champs personnalisés** sur la fiche client, avec colonnes de liste, import et export
   (mig 369, `CustomersPage.tsx:15-16`, `:161`, `:918`, `data-export.ts:5`).
9. **Import en masse** avec modèle, aperçu, modes créer/mettre à jour/les deux, journal annulable
   (`data-import.ts:67-83`, `settings.routes.ts:68-72`) ; ICE validé à l'import (`data-import.ts:205`).
10. **Prospects et conversion** : une opportunité ou un devis peut porter un prospect sans fiche, puis créer
    la fiche client (`crm.repository.ts:195-208`, `CrmPage.tsx:345`, mig 365 et 371).
11. **Fidélité rattachée au client** : solde, niveau sur 12 mois, onglet dédié, usage en caisse
    (mig 372, `customer.repository.ts:31-37`, `CustomersPage.tsx:650`, `POSPage.tsx:995-1022`).
12. **Organisation** : magasins/établissements avec code, nature, responsable, horaires (mig 025 et 331,
    `StoresPanel.tsx`) ; canaux de vente paramétrables avec prix par canal (mig 172 et 173,
    `SalesChannelsPage.tsx`) et canal porté par les commandes et devis (mig 443:76-77).
13. **Droits** : garde par module devant toutes les routes (`module-guard.middleware.ts`, règle
    `/customers` → modules `customers`, `pos`, `orders`) et limitation de débit sur les écritures et
    statistiques (`customers.routes.ts:11-26`).
14. **Recherche globale** incluant les clients (`search.controller.ts:26-44`).

Constat d'ensemble : le référentiel **fournisseurs** est nettement plus mûr que le référentiel **clients**.
La migration 304 a donné aux fournisseurs des identifiants typés par pays (`identifier_types`,
`supplier_identifiers`), un régime de TVA, une entité mère, des colonnes d'auteur et une piste d'audit
(`purchasing_master_audit`), un contrôle de doublon à la frappe (`supplier.repository.ts:250`) et un
auxiliaire comptable entretenu par trigger. Rien de cela n'existe côté clients. La cible la plus économique
est donc d'aligner `customers` sur ce qui est déjà construit pour `suppliers`.

---

## 3. Tableau des capacités

Légende statut : ✅ complet (serveur et écran câblés) · 🟡 partiel · ❌ absent.
Priorité : P0 bloquant multi-secteur ou obligation légale au Maroc · P1 attendu de tout ERP de milieu de gamme ·
P2 avancé · P3 niche. Pour une capacité ✅, la priorité porte sur le reliquat éventuel.

| ID | Capacité | Référence grands ERP | Statut | Preuve | Écart | Priorité | Secteurs |
|---|---|---|---|---|---|---|---|
| D1-01 | Typologie de tiers (B2B/B2C, groupes de comptes) | SAP BP grouping et rôles ; D365 customer groups ; Odoo société/particulier | 🟡 | mig 242:51-53 (CHECK 4 valeurs) ; `CustomersPage.tsx:36-41` ; `customer.controller.ts:32` | Quatre types en dur dans une contrainte, le contrôleur et l'écran. Pas de référentiel de types ni de comportements paramétrables par type (administration, grande distribution, export, franchisé). | P1 | Tous ; distribution, services |
| D1-02 | Code client et série de numérotation | SAP numéro de BP ; X3 code tiers ; NetSuite entity ID | ❌ | Aucune colonne de code sur `customers` (mig 007, 092, 242) ; aucun type `customer` dans `document_sequences` (mig 329). Cherché : `customer_code`, `client_code`, `account_number`. | Le client n'est identifié que par un UUID et un nom. Pas de matricule lisible pour les documents, l'EDI, les échanges comptables. | P1 | Tous |
| D1-03 | Identifiants légaux (ICE, IF, RC, TP, CNSS) | SAP tax numbers par pays ; Oracle TCA tax registrations ; Odoo n° de TVA validé | 🟡 | mig 242:15-21, 38 ; écran `CustomersPage.tsx:815-829` ; import `data-import.ts:205` | Colonnes marocaines en dur (les fournisseurs ont un pack pays, mig 304:129-150). Format de l'ICE contrôlé par l'écran seulement (`pattern`, `:820`), pas par l'API. L'ICE manquant d'une société est signalé mais non bloquant. La facture n'imprime qu'un identifiant (« ICE / IF », `invoice-pdf.service.ts:291`). | P1 | Tous B2B |
| D1-04 | Adresses multiples typées (siège, livraison, facturation), pays, code postal | SAP adresses par usage ; Oracle sites ; D365 adresses à rôle ; Odoo adresses enfant | ❌ | Une adresse texte et une ville (mig 092:5-6). Aucun pays ni code postal. Aucune adresse sur `orders`, `delivery_notes`, `quotes` : le BL lit `c.address` (`delivery-note.repository.ts:32`). Cherché : `customer_address`, `shipping_address`, `ship_to`, `bill_to`. | Un client ne peut avoir qu'un lieu. Impossible de livrer plusieurs points de vente d'une même société ni de facturer à une adresse différente du lieu livré. | **P0** | Distribution, négoce, industrie, traiteur, services |
| D1-05 | Contacts multiples avec rôles | SAP personnes de contact ; D365 contacts ; Odoo contacts enfant | ❌ | Un seul contact : `first_name`, `last_name`, `contact_role` (mig 242:29) ; un téléphone, un e-mail (mig 007). Cherché : `customer_contacts`, `contact_id`. | Pas d'acheteur, comptable, réceptionnaire distincts. Les relances et les factures partent vers l'unique e-mail. | P1 | Tous B2B |
| D1-06 | Hiérarchie groupe / enseigne / filiales | SAP hiérarchie clients ; D365 comptes parents ; NetSuite sous-clients | ❌ | Aucune colonne parent sur `customers`. Existe côté fournisseurs (`parent_supplier_id`, mig 304:80). Cherché : `parent_customer`, `parent_id`, `enseigne`. | Pas d'encours consolidé par groupe, pas de conditions héritées, pas de reporting par enseigne. | P1 | Distribution, franchise, hôtellerie-restauration |
| D1-07 | Fonctions partenaires (donneur d'ordre, livré, facturé, payeur) | SAP partner functions SP/SH/BP/PY ; Oracle bill-to/ship-to ; D365 compte de facturation | ❌ | Un seul `customer_id` sur commande, BL, facture et règlement (mig 008, 352, 055, 451). Cherché : `payer_id`, `sold_to`, `invoice_to`. | Pas de payeur différent (centrale de paiement, maison mère), pas de facturé différent du livré. | P1 | Distribution, franchise, marchés publics |
| D1-08 | Segmentation, classification, étiquettes, secteur d'activité, origine | D365 segments ; Odoo étiquettes et secteur ; SAP classes de clients ; NetSuite catégorie | ❌ | Aucune colonne ni table. Seuls existent une « situation » calculée à l'écran (`CustomersPage.tsx:98-102`) et le niveau de fidélité. L'origine n'existe que sur l'opportunité (`opportunities.source_code`, mig 371). Cherché : `segment`, `customer_group`, `customer_tags`. | Pas de classement ABC, de segment, de secteur ni d'étiquette ; pas de ciblage ni d'analyse par segment. Le générateur de rapports n'a aucune dimension client (`report-builder.repository.ts:37-56`). | P1 | Tous |
| D1-09 | Groupe tarifaire et liste de prix attitrée | SAP customer pricing group et conditions ; Odoo liste de prix par client ; D365 accords commerciaux ; X3 tarifs par tiers | ❌ | Prix = catalogue moins `remise_pct` (`delivery-note.repository.ts:97-109`). Les seules grilles sont par canal (mig 173) et par poids (mig 171). Cherché : `price_list`, `pricelist`, `customer_price`. | Aucun prix négocié par client ni par groupe de clients. Bloquant dès qu'on vend à des professionnels avec des tarifs distincts. | **P0** | Négoce, distribution, industrie, traiteur |
| D1-10 | Conditions de paiement (référentiel) | SAP payment terms ; D365 terms of payment ; Odoo conditions multi-échéances | 🟡 | `delai_paiement_jours` entier (mig 242:34), lu pour l'échéance (`receivables.repository.ts:94`, `delivery-note.repository.ts:406`) ; saisi à l'écran `:899`. | Un nombre de jours seulement : pas de « fin de mois », « le 10 », échéances multiples, acompte, escompte. Pas de table de conditions. | P1 | Tous B2B |
| D1-11 | Mode de règlement par défaut et coordonnées bancaires du client | SAP payment methods et coordonnées bancaires ; D365 method of payment ; X3 mode de règlement | ❌ | Les modes existent (`payment_modes`, mig 310:18) mais ne sont pas liés au client. Aucun RIB client. Cherché : `default_payment_method`, `customer_bank`, `iban`. | Pas de mode attendu par client (chèque, effet, virement), pas de préparation de remises ou prélèvements. | P1 | Tous B2B |
| D1-12 | Plafond de crédit et contrôle d'encours | SAP credit management ; D365 credit limits ; Odoo limite de crédit | ✅ | mig 242:32 ; mig 443:21-64 ; `credit-control.ts:44-69` ; écran `:896`, `:554-563` | Reliquat : pas d'historique du plafond, pas de date de révision. | P3 | — |
| D1-13 | Classe de risque, notation, assurance-crédit | SAP risk class et scoring ; D365 risk score | ❌ | Cherché : `risk_class`, `credit_rating`, `scoring` (seule la notation des devis fournisseurs répond, mig 458). | Pas de classe de risque pilotant le plafond ou le blocage. | P2 | Négoce, distribution, industrie |
| D1-14 | Remise client par défaut | SAP conditions de remise ; Odoo remise de liste ; X3 remises tiers | 🟡 | `remise_pct` (mig 242:33) appliquée aux commandes et BL (`order.controller.ts:55`, `delivery-note.repository.ts:100`) ; écran `:898` | Un taux unique sur tout le catalogue : pas de remise par famille ou article, pas de période de validité, pas de remise de fin d'année. | P1 | Négoce, distribution |
| D1-15 | Devise du client | SAP devise du domaine commercial ; D365 devise du compte ; NetSuite devise principale | ❌ | La devise est portée par la facture (mig 431, en-tête) ; aucune colonne sur `customers` ; aucune occurrence de `currency` dans `customer.repository.ts`. | Pas de devise par défaut pour un client étranger ; à choisir à chaque pièce. | P1 | Export, négoce, industrie |
| D1-16 | Incoterm et conditions de livraison | SAP incoterms ; D365 delivery terms | ❌ | Seul `quotes.delivery_terms` en texte libre (mig 365). Cherché : `incoterm`. | Pas d'incoterm ni de mode de livraison par défaut. | P2 | Export, industrie, négoce |
| D1-17 | Rythme de facturation | SAP calendrier de facturation ; X3 périodicité | ✅ | mig 354:38 ; `scheduler.ts:168-175` ; écran `:901-906` | Reliquat : deux valeurs seulement (mensuel, à la livraison) ; pas d'hebdomadaire ni de quinzaine. | P3 | Distribution |
| D1-18 | Vendeur attitré / gestionnaire de compte | SAP partner function employé ; D365 propriétaire du compte ; Odoo vendeur | ❌ | Aucune colonne sur `customers`. Le responsable n'existe que sur l'opportunité (`owner_id`, mig 371). Cherché : `salesperson`, `sales_rep`, `account_manager`. | Pas de portefeuille par commercial, pas de filtre « mes clients », commissions non rattachables à un portefeuille. | P1 | Négoce, distribution, services |
| D1-19 | Tournée, zone et créneaux de livraison attitrés | SAP route et calendrier de réception ; D365 modes et créneaux ; X3 tournées | ❌ | Les tournées regroupent des BL datés (mig 387) ; rien sur le client. Cherché : `zone_id`, `delivery_window`, `creneau`, `opening_hours` client. | Pas de tournée ni de jours de livraison par défaut ; chaque BL est affecté à la main. | P1 | Distribution, boulangerie B2B, traiteur |
| D1-20 | Tolérances de livraison par client | SAP tolérances de sur/sous-livraison ; livraison complète exigée | 🟡 serveur seul | `over_delivery_tolerance_pct` (mig 441:83) lu par `delivery-note.repository.ts:214` | Colonne non modifiable : absente de l'API (`customer.repository.ts:98-107`) et de l'écran. Pas d'option « livraison complète exigée ». | P2 | Industrie, distribution |
| D1-21 | Rattachement organisationnel du client (magasin/agence, canal par défaut) | SAP données par domaine commercial ; D365 site et canal | ❌ | `customers` n'a ni `store_id` ni `channel_id` ; le canal des commandes est déduit du type de client (mig 443:80-84). | Fichier commun à tous les magasins, sans agence de rattachement ni canal par défaut. | P2 | Multi-agences, retail |
| D1-22 | Régime de TVA du client | SAP classification fiscale ; D365 groupe de taxe ; Odoo position fiscale | 🟡 | Booléen `tva_exonere` (mig 242:35) qui force le taux à 0 (`order.controller.ts:160`, `delivery-note.repository.ts:109`) ; écran `:840-843` | Un booléen au lieu d'un régime (assujetti, non assujetti, exonéré, export, suspension). Les fournisseurs ont `vat_regime` (mig 304:78). Pas de position fiscale remplaçant les taux. | P1 | Export, négoce, services |
| D1-23 | Exonération avec attestation et dates de validité | SAP licences d'exonération ; D365 certificats d'exonération | ❌ | Aucune colonne de numéro, de dates ni de pièce. Cherché : `attestation`, `exemption`, `exoner` + date. | L'exonération est une case à cocher sans justificatif ni échéance : vente hors taxe non justifiable en cas de contrôle. | **P0** | Export, zones franches, associations, marchés publics |
| D1-24 | Retenue à la source subie par le client | SAP withholding côté client ; Oracle Receivables ; localisation marocaine | ❌ | La retenue n'existe que côté achats (mig 210, 212). Aucune occurrence dans `customer-receipt.repository.ts`, `receivables.repository.ts`, mig 451. | Un client qui retient une part de TVA ou d'impôt laisse un reste dû non soldable proprement. | P1 | Services, BTP, marchés publics |
| D1-25 | Statut actif / inactif, archivage au lieu de suppression | Tous : désactivation, jamais de suppression d'un tiers mouvementé | ❌ | `is_active` créé (mig 092:10) mais jamais lu ni écrit dans `server/src`. Suppression physique (`customer.repository.ts:188-190`) avec `ON DELETE SET NULL` sur commandes et ventes (mig 031). | Aucun moyen d'archiver. La suppression détache l'historique (voir anomalie A1). | **P0** | Tous |
| D1-26 | Blocages distincts (commande, livraison, facturation) avec motif | SAP blocages commande/livraison/facturation ; D365 « invoice and delivery on hold » | 🟡 | Un seul blocage, de crédit : `credit_hold` + motif (mig 366:101-104), appliqué partout (`credit-control.ts:50-55`), géré dans Relances | Pas de blocage par étape, pas de liste de motifs. Le blocage n'apparaît pas sur la fiche client (aucune occurrence dans `CustomersPage.tsx`). | P1 | Tous B2B |
| D1-27 | Prospect contre client, conversion, rattachement CRM | D365 lead → compte ; Odoo piste → client ; SAP prospect BP | 🟡 | Prospect porté par l'opportunité ou le devis (mig 371, 365) ; conversion `crm.repository.ts:195-208`, bouton `CrmPage.tsx:345` | Pas de fiche prospect durable ni de statut sur `customers` ; conversion sans recherche de doublon ni transaction. | P2 | Négoce, services |
| D1-28 | Détection de doublons | SAP contrôle de doublons ; D365 règles de détection ; Odoo suggestion | ❌ | Unicité de l'e-mail (mig 007:5) et de l'ICE (mig 242:38) seulement, non traduite (anomalie A4). `findByPhone` sans appelant (`customer.repository.ts:59`). Les fournisseurs ont `findDuplicates` (`supplier.repository.ts:250`). | Pas d'alerte à la saisie sur nom, téléphone, raison sociale. Le client créé en caisse (nom + téléphone, `UnpaidCustomerPicker.tsx:38-45`) se duplique librement. | P1 | Tous ; retail |
| D1-29 | Fusion de fiches | Odoo fusion de contacts ; D365 merge ; NetSuite duplicate merge | ❌ | Cherché : `merge`, `fusion` dans le code clients : aucun résultat. | Un doublon ne peut être résorbé qu'en base. | P2 | Tous |
| D1-30 | Champs obligatoires par type et validation côté serveur | Tous : champs requis par groupe de comptes | 🟡 écran seul | `required` et `pattern` HTML (`CustomersPage.tsx:792`, `:820`, `:850`) ; aucun validateur serveur (pas de fichier client dans `server/src/validators/` ; `req.body` passé tel quel, `customer.controller.ts:61`, `:74`) | Une requête directe peut créer une société sans raison sociale, avec un ICE ou un e-mail mal formés. Pas de règles paramétrables par type. | P1 | Tous |
| D1-31 | Circuit d'approbation à la création ou au changement de conditions | SAP workflow MDG ; D365 workflow de modification client | 🟡 | Conditions réservées à la direction (`customer.controller.ts:54-72`) ; aucun type « client » dans `shared/src/constants/approvals.ts:27-92` | Pas de demande puis validation (relèvement de plafond, exonération). | P2 | Distribution, industrie |
| D1-32 | Piste d'audit des modifications de la fiche | SAP change documents ; D365 database log ; Odoo historique | ❌ | `customers` n'a ni `created_by`, ni `updated_at`, ni `updated_by` (mig 007, 092, 242). Absent de la liste des tables journalisées (mig 328:130-141). Les fournisseurs ont `purchasing_master_audit` (mig 304). | Aucune trace de qui a changé un plafond, une remise, une exonération ou un ICE. | **P0** | Tous |
| D1-33 | Pièces jointes et notes | Tous : documents attachés au tiers, fil de notes | 🟡 | Un champ `notes` (mig 007:9, écran `:916`). Téléversements limités au logo, aux photos de perte et de réclamation (`upload.routes.ts:59-78`). | Pas de pièce jointe (contrat, attestation, RC, bon de commande client) ; pas de notes datées et signées. | P1 | Tous B2B |
| D1-34 | Champs personnalisés | Tous | ✅ | mig 369 ; `CustomersPage.tsx:161`, `:918` ; `data-import.ts:67` | — | — | — |
| D1-35 | Assortiment par client et codes articles client | SAP listing/exclusion, customer-material info record ; D365 références externes ; X3 référencement | ❌ | Cherché : `assortment`, `listing`, `customer_item`, `customer_sku`, `customer_ref` : aucun résultat côté ventes. | Pas de catalogue restreint par client ni de référence article du client sur les documents. | P2 | Distribution, grande distribution, industrie |
| D1-36 | Vue 360° du client | D365 timeline ; Odoo boutons intelligents ; SAP fact sheet | 🟡 | Fiche : identité, total acheté, 20 dernières ventes et commandes, fidélité, encours (`customer.repository.ts:139-171`, `CustomersPage.tsx:478-671`) | Manquent factures, BL, devis, avoirs, règlements, réclamations, opportunités et activités, abonnements, projets, relances et blocage. Le « CA cumulé » ne compte que la caisse (anomalie A7). | P1 | Tous |
| D1-37 | Relevé de compte | Tous : relevé imprimable et envoyé | 🟡 | `customers.routes.ts:33` ; `ReceivablesTab.tsx:363-400` | Accessible depuis Créances seulement, pas depuis la fiche ; ni PDF ni envoi par e-mail. | P2 | Tous B2B |
| D1-38 | Compte auxiliaire client et comptes collectifs | SAP reconciliation account ; X3 collectifs par tiers ; D365 posting profiles | 🟡 | Auxiliaire 3421 créé à la première écriture (`journal-generator.service.ts:1157-1176`, mig 208:35-48) | Créé à la volée et non à la création du client ; libellé construit sur prénom + nom (anomalie A8) ; pas de collectif par client (douteux, groupe, étranger). | P1 | Tous |
| D1-39 | Sociétés multiples (entités juridiques) | SAP company codes ; D365 legal entities ; NetSuite subsidiaries ; Odoo multi-sociétés | 🟡 | Une société (`company_settings`, mig 013 et 326) et des établissements (`stores`, mig 025 et 331) | Pas de seconde entité juridique ni de client partagé ou cloisonné entre sociétés. | P1 | Groupes, franchise |
| D1-40 | Magasins et agences | D365 sites ; Odoo entrepôts et points de vente | ✅ | mig 025, 331:51-62 ; `store.routes.ts:9-13` ; `StoresPanel.tsx` | — | — | — |
| D1-41 | Canaux de vente | SAP distribution channel ; D365 Commerce channels | ✅ | mig 172, 173, 443:76-77 ; `sales-channel.routes.ts:9-15` ; `SalesChannelsPage.tsx` | Reliquat : canaux semés pour la boutique (« boutique », « événement »), écriture gardée par la section de paramètres « production » (anomalie A14). | P3 | — |
| D1-42 | Équipes de vente, territoires, structure commerciale | SAP sales office/group et organisation commerciale ; D365 territoires ; Odoo équipes | ❌ | Cherché : `sales_team`, `territory`, `territoire`, `secteur_commercial` : aucun résultat. Rôles de vente figés à caissier et vendeuse (`shared/src/constants/roles.ts:27`). | Pas d'équipe, de secteur géographique ni d'objectif par équipe ; pas de rôle « commercial » ou « administration des ventes ». | P2 | Négoce, distribution, services |
| D1-43 | Préférences de communication | D365 préférences de contact ; Odoo désabonnement | 🟡 | `preferred_contact` téléphone/e-mail/WhatsApp (mig 092:8, écran `:871-880`) | Valeur enregistrée mais lue par aucun traitement (seules occurrences : `customer.repository.ts:71`, `:101`). Pas d'accord pour la prospection ni de liste d'opposition. | P2 | Retail, services |
| D1-44 | Langue des documents | SAP langue du BP ; Odoo langue du contact | ❌ | Aucune colonne de langue sur `customers` ; `document_templates` sans langue (mig 332). | Documents en français uniquement, quel que soit le client. | P2 | Export, Maroc (arabe/français) |
| D1-45 | Consentement et protection des données (loi 09-08, RGPD) | SAP ILM et blocage ; D365 consentement ; Odoo anonymisation | ❌ | Cherché : `consent`, `rgpd`, `gdpr`, `09-08`, `cndp`, `anonymi` : seuls des fichiers RH répondent. | Pas de consentement daté, pas d'export des données d'une personne, pas d'anonymisation ; seule existe la suppression physique. La fiche porte des données sensibles (date de naissance, allergies, mig 092:7-9). | **P0** | Tous B2C ; retail, traiteur |
| D1-46 | Import en masse | Tous | ✅ | `data-import.ts:67-83` ; `settings.routes.ts:68-72` ; `ImportSection.tsx` | Reliquat : rapprochement sur e-mail et téléphone, pas sur l'ICE ; colonnes limitées (ni IF, RC, rythme de facturation, exonération). | P3 | — |
| D1-47 | Export | Tous : export de liste | 🟡 | Export global « Clients » (`data-export.ts:77-78`) | Colonnes : prénom, nom, téléphone, e-mail, ville, points, total. Ni raison sociale, ni type, ni ICE, ni conditions (anomalie A11). Pas d'export depuis la liste filtrée. | P2 | Tous |
| D1-48 | API publique, webhooks, portail client B2B | NetSuite SuiteTalk et Customer Center ; Odoo portail ; D365 Dataverse et portails | ❌ | API interne à session uniquement ; cherché : `api_key`, `webhook`, `portal`, `portail` : rien côté ventes. | Pas d'intégration tierce (site marchand, EDI) ni d'accès client à ses commandes, factures et relevés. | P2 | Distribution, négoce, services |
| D1-49 | Rattachement de la fidélité au client | D365 Commerce loyalty card ; Odoo fidélité | ✅ | mig 372:132-134 ; `customer.repository.ts:31-37` ; `CustomersPage.tsx:650` | Reliquat : pas de numéro de carte ni de code à scanner. | P3 | Retail |
| D1-50 | Client occasionnel (de passage) | SAP one-time customer ; D365 one-time customer | 🟡 | Nom et téléphone libres sur la commande (mig 441:92-93), le devis (mig 365) et la réclamation (mig 357:32-33) | La facture manuelle exige une fiche (`EmittedInvoicesTab.tsx:228`). | P3 | Retail, services |

---

## 4. Écarts détaillés P0 et P1

Effort : S = quelques jours · M = une à deux semaines · L = plus de deux semaines.

### P0

**D1-04 — Adresses multiples typées**
- Constat : une adresse texte et une ville par client ; ni pays ni code postal ; aucune adresse portée par la commande, le BL ou la facture.
- Impact : impossible de servir une société à plusieurs sites, de distinguer livraison et facturation, d'imprimer l'adresse réellement livrée. Les tournées n'ont pas de lieu fiable.
- Piste : table `customer_addresses` (client, usage `billing`/`shipping`/`head_office`, libellé, lignes, code postal, ville, région, pays, contact, téléphone, consignes, par défaut, actif). Colonnes `shipping_address_id` et `billing_address_id` sur `orders`, `quotes`, `delivery_notes`, `invoices`, avec copie figée de l'adresse sur le document émis. Onglet « Adresses » sur la fiche ; choix de l'adresse dans les formulaires de commande, devis et BL. Reprise : l'adresse actuelle devient l'adresse par défaut.
- Effort : L.

**D1-09 — Groupe tarifaire et liste de prix attitrée**
- Constat : le prix d'un professionnel est le prix catalogue moins une remise unique.
- Impact : pas de tarif négocié, pas de grille « revendeurs », « hôtels », « export ». Rédhibitoire en négoce et en distribution.
- Piste : `price_lists` (devise, validité, TTC ou HT), `price_list_items` (article, quantité minimale, prix ou remise, dates), `customer_groups` ; colonnes `price_list_id` et `customer_group_id` sur `customers`. Ordre de résolution : prix client, liste du client, liste du groupe, prix du canal, catalogue. À concevoir avec le domaine Prix ; D1 ne porte que le rattachement et l'écran de fiche.
- Effort : L (rattachement seul : S).

**D1-23 — Exonération de TVA avec attestation et validité**
- Constat : `tva_exonere` est une case à cocher, sans numéro d'attestation, ni dates, ni pièce.
- Impact : vente hors taxe sans justificatif opposable ; aucune alerte à l'expiration ; risque de redressement.
- Piste : table `customer_tax_exemptions` (client, motif ou article de loi, numéro d'attestation, date de délivrance, début, fin, pièce jointe, auteur). Le taux 0 ne s'applique que si une attestation couvre la date de la pièce ; mention légale sur la facture ; tâche planifiée d'alerte avant échéance. Dépend de D1-33 pour la pièce jointe.
- Effort : M.

**D1-25 — Statut actif / inactif et archivage**
- Constat : `is_active` existe mais n'est ni lu ni écrit ; la seule sortie est la suppression physique, qui détache commandes et ventes et efface l'historique de points.
- Impact : perte de traçabilité, fichiers pollués par d'anciens clients, incohérence avec l'obligation de conservation des pièces.
- Piste : remplacer la suppression par une désactivation (`is_active`, `archived_at`, `archived_by`, motif) ; interdire la suppression dès qu'une pièce existe (remettre `ON DELETE RESTRICT` sur `orders` et `sales`) ; filtrer les inactifs dans tous les sélecteurs ; filtre « Archivés » sur le fichier.
- Effort : S.

**D1-32 — Piste d'audit de la fiche client**
- Constat : aucune colonne d'auteur ni de date de modification, aucun journal.
- Impact : un plafond relevé, une remise accordée ou une exonération cochée ne laissent aucune trace. Faiblesse de contrôle interne visible au premier audit.
- Piste : reprendre le mécanisme déjà écrit pour les fournisseurs (mig 304 : `created_by`, `updated_by`, `updated_at`, trigger de journal en ajout seul avec différentiel JSON). Généraliser `purchasing_master_audit` en journal des référentiels tiers ou créer `sales_master_audit`. Onglet « Historique » sur la fiche.
- Effort : S à M.

**D1-45 — Consentement et protection des données personnelles**
- Constat : aucune gestion du consentement, du droit d'accès ou de l'effacement ; la fiche d'un particulier contient date de naissance et allergies.
- Impact : non-conformité à la loi 09-08 (et au RGPD pour une clientèle européenne) dès qu'on exploite le fichier pour la fidélité ou la prospection.
- Piste : colonnes `marketing_consent`, `consent_at`, `consent_source`, `do_not_contact` ; action « Exporter les données de ce client » ; action « Anonymiser » qui vide les données d'identité tout en conservant les pièces comptables ; durée de conservation paramétrable et tâche de purge ; journal de ces actions.
- Effort : M.

### P1

**D1-01 — Typologie de tiers paramétrable**
- Constat : quatre types en dur dans la base, le contrôleur et l'écran.
- Impact : chaque secteur impose ses propres types ; une modification de code est nécessaire à chaque fois.
- Piste : référentiel `customer_types` (code, libellé, personne morale ou physique, champs requis, comportements : facturation via BL, crédit autorisé) dans le mécanisme `ref_tables` existant ; remplacer la contrainte par une clé étrangère.
- Effort : M.

**D1-02 — Code client**
- Constat : pas de matricule.
- Impact : documents, exports comptables et échanges avec le client sans référence stable.
- Piste : colonne `code` unique alimentée par `document_sequences` (type `customer`, modèle `CLI-{SEQ}`), affichée sur la fiche, les listes et les documents ; reprise numérotée des clients existants.
- Effort : S.

**D1-03 — Identifiants légaux typés et validés**
- Constat : colonnes marocaines en dur, validées par l'écran seulement.
- Impact : pas d'ouverture à un autre pays ; identifiants mal formés acceptés par l'API.
- Piste : `customer_identifiers` sur le modèle de `supplier_identifiers` (mig 304), réutilisant `identifier_types` ; conserver `customers.ice` en miroir. Paramètre « ICE obligatoire pour facturer une société ».
- Effort : M.

**D1-05 — Contacts multiples**
- Constat : un seul interlocuteur.
- Impact : pas de destinataire distinct pour les factures, les relances ou les livraisons.
- Piste : table `customer_contacts` (nom, fonction, téléphone, e-mail, rôles : commande, facturation, livraison, relance ; principal ; actif). Les envois de devis, factures et relances choisissent le contact du rôle. Lien possible vers `crm_activities`.
- Effort : M.

**D1-06 — Hiérarchie de clients**
- Constat : aucune notion de groupe.
- Impact : pas d'encours ni de chiffre d'affaires consolidés, pas de conditions héritées.
- Piste : `parent_customer_id` (comme `parent_supplier_id`), garde contre les cycles ; option d'encours consolidé dans `fn_customer_exposure` ; ICE partagé au sein d'un groupe ; regroupement par enseigne dans les listes et rapports.
- Effort : M.

**D1-07 — Fonctions partenaires**
- Constat : un seul tiers par pièce.
- Impact : centrales de paiement, facturation au siège et livraison aux filiales impossibles.
- Piste : après D1-04 et D1-06, ajouter `bill_to_customer_id` et `payer_customer_id` sur commande, BL et facture, proposés depuis la fiche (`customer_partners`). L'encours et les relances suivent le payeur.
- Effort : M à L.

**D1-08 — Segmentation, étiquettes, secteur, origine**
- Constat : rien sur la fiche ; la « situation » est calculée dans le navigateur.
- Impact : pas de ciblage, pas d'analyse par segment, pas de promotions par segment.
- Piste : colonnes `segment_code`, `industry_code`, `source_code` sur des référentiels `ref_entries` (la source reprend `crm_sources`) ; table `customer_tags` ; filtres dans le fichier ; dimensions client dans le générateur de rapports.
- Effort : S à M.

**D1-10 — Conditions de paiement**
- Constat : un nombre de jours.
- Impact : échéances « fin de mois » ou fractionnées non calculables ; pas d'escompte.
- Piste : table `payment_terms` avec lignes (pourcentage, jours, fin de mois, jour fixe, escompte) ; `payment_term_id` sur `customers`, copié sur la pièce ; `delai_paiement_jours` conservé comme valeur de repli.
- Effort : M.

**D1-11 — Mode de règlement par défaut et banque du client**
- Constat : aucun lien entre le client et `payment_modes`.
- Impact : pas de mode attendu sur la facture, pas de préparation des remises d'effets.
- Piste : `default_payment_mode` (clé vers `payment_modes`) et table `customer_bank_accounts` (banque, RIB, titulaire).
- Effort : S.

**D1-14 — Remise client**
- Constat : un taux unique.
- Impact : pas de remise par famille ni de validité.
- Piste : à traiter avec D1-09 (lignes de liste de prix exprimées en remise par famille ou article, avec dates) ; `remise_pct` reste la remise générale.
- Effort : inclus dans D1-09.

**D1-15 — Devise du client**
- Constat : devise choisie à la facture.
- Impact : ressaisie, risque d'erreur pour les clients étrangers.
- Piste : `currency_code` sur `customers` (clé vers les devises existantes), proposé sur devis, commande et facture.
- Effort : S.

**D1-18 — Vendeur attitré**
- Constat : aucun responsable de compte.
- Impact : pas de portefeuille, pas de suivi par commercial.
- Piste : `salesperson_id` sur `customers`, repris par défaut sur opportunité, devis et commande ; filtre « mes clients » ; base de calcul possible pour les commissions.
- Effort : S.

**D1-19 — Tournée, zone et jours de livraison**
- Constat : affectation manuelle de chaque BL à une tournée.
- Impact : charge quotidienne, oublis.
- Piste : référentiel `delivery_zones` ; sur l'adresse de livraison (D1-04) : zone, jours de livraison, créneau, rang de passage ; proposition automatique des BL à la création d'une tournée.
- Effort : M.

**D1-22 — Régime de TVA**
- Constat : un booléen.
- Impact : export, suspension et non-assujettis non distingués ; déclarations à retraiter.
- Piste : `vat_regime` aligné sur les fournisseurs, étendu à `export` et `suspension` ; table de correspondance régime → code de taxe (`tax_codes`, mig 331).
- Effort : M.

**D1-24 — Retenue à la source subie**
- Constat : inexistante côté ventes.
- Impact : factures partiellement réglées impossibles à solder sans écriture manuelle.
- Piste : indicateur et taux sur la fiche (`withholding_applicable`, type) ; à l'encaissement, ligne de retenue vers un compte de créance sur l'État, avec suivi de l'attestation reçue. À concevoir avec le domaine Encaissement.
- Effort : M.

**D1-26 — Blocages distincts**
- Constat : un seul blocage, de crédit, invisible sur la fiche.
- Impact : impossible de suspendre les livraisons sans bloquer la facturation, ou de bloquer un client en litige.
- Piste : `order_block`, `delivery_block`, `billing_block` avec motif tiré d'un référentiel ; bandeau sur la fiche et dans les formulaires ; conserver `credit_hold` pour le recouvrement.
- Effort : S à M.

**D1-28 — Détection de doublons**
- Constat : seules deux contraintes d'unicité, dont l'erreur n'est pas traduite.
- Impact : fichier dégradé, surtout par les créations rapides en caisse.
- Piste : point d'accès `GET /customers/duplicates` (téléphone normalisé, e-mail, ICE, raison sociale approchante) appelé à la frappe, comme pour les fournisseurs ; messages clairs pour les contraintes d'unicité.
- Effort : S.

**D1-30 — Validation côté serveur**
- Constat : aucune validation à l'API.
- Impact : données incohérentes dès qu'un autre canal que l'écran écrit (import, conversion de prospect, intégration).
- Piste : `server/src/validators/customer.validator.ts` (schéma par type : raison sociale requise pour une personne morale, format ICE, e-mail, bornes numériques), branché sur `validate.middleware.ts`.
- Effort : S.

**D1-33 — Pièces jointes et notes**
- Constat : un champ de notes, aucune pièce.
- Impact : contrats, attestations et bons de commande client conservés hors du système.
- Piste : table générique `attachments` (entité, identifiant, nom, type, taille, contenu ou emplacement de stockage objet, auteur) et `entity_notes` (texte, auteur, date) ; composant d'onglet réutilisable par les fournisseurs et les pièces. Tenir compte du stockage éphémère en production (pas de disque local).
- Effort : M.

**D1-36 — Vue 360°**
- Constat : la fiche ne montre que la caisse, les commandes et la fidélité.
- Impact : il faut ouvrir cinq écrans pour connaître la situation d'un client professionnel.
- Piste : point d'accès `GET /customers/:id/overview` agrégeant devis, commandes, BL, factures, avoirs, règlements, réclamations, opportunités, abonnements, relances ; onglets correspondants ; indicateurs recalculés à partir des pièces (chiffre d'affaires facturé, délai moyen de paiement) à la place de `total_spent`.
- Effort : M.

**D1-38 — Compte auxiliaire et collectif**
- Constat : auxiliaire créé à la première écriture, libellé erroné pour les sociétés.
- Impact : grand livre auxiliaire illisible pour la clientèle professionnelle.
- Piste : fonction `fn_ensure_customer_auxiliary` et triggers à la création et au renommage (comme la mig 304 pour les fournisseurs), libellé = raison sociale ou nom ; `collective_account_id` facultatif sur la fiche.
- Effort : S.

**D1-39 — Sociétés multiples**
- Constat : une seule entité juridique.
- Impact : un groupe à plusieurs sociétés doit dupliquer l'installation.
- Piste : relève du chantier multi-entités ; côté D1, prévoir que les conditions commerciales du client puissent être surchargées par société (`customer_company_terms`).
- Effort : L (hors D1).

---

## 5. Compteurs

| Mesure | Valeur |
|---|---|
| Capacités auditées | 50 |
| ✅ Complet | 7 (D1-12, 17, 34, 40, 41, 46, 49) |
| 🟡 Partiel | 18 (D1-01, 03, 10, 14, 20, 22, 26, 27, 30, 31, 33, 36, 37, 38, 39, 43, 47, 50) |
| ❌ Absent | 25 (D1-02, 04, 05, 06, 07, 08, 09, 11, 13, 15, 16, 18, 19, 21, 23, 24, 25, 28, 29, 32, 35, 42, 44, 45, 48) |
| P0 | 6 (D1-04, 09, 23, 25, 32, 45) |
| P1 | 22 (D1-01, 02, 03, 05, 06, 07, 08, 10, 11, 14, 15, 18, 19, 22, 24, 26, 28, 30, 33, 36, 38, 39) |
| P2 | 14 (D1-13, 16, 20, 21, 27, 29, 31, 35, 37, 42, 43, 44, 47, 48) |
| P3 | 6 (D1-12, 17, 41, 46, 49, 50 — reliquats ou niche) |
| Sans écart | 2 (D1-34, 40) |

---

## 6. Anomalies rencontrées en chemin

Toutes sont constatées à la lecture du code ; aucune n'a été reproduite à l'exécution.

| N° | Anomalie | Preuve | Gravité |
|---|---|---|---|
| A1 | **La suppression d'un client détache son historique.** `DELETE FROM customers` sans garde ; les commandes et ventes passent à `customer_id NULL`, l'historique de points est supprimé en cascade. L'écran affirme pourtant « Impossible s'il a des commandes ou des ventes ». La suppression n'échoue que si une facture, un BL, un devis ou un auxiliaire comptable référence le client. | `customer.repository.ts:188-190` ; mig 031:3, 6 ; mig 372:134 ; `CustomersPage.tsx:264` | Haute |
| A2 | **Sélecteur de client limité à 20 fiches dans la facture manuelle.** L'appel est fait sans paramètre ; la limite par défaut est 20, triée par date de création décroissante. Les clients plus anciens ne peuvent pas être choisis. | `EmittedInvoicesTab.tsx:134`, `:613-615` ; `customer.controller.ts:30` ; `customer.repository.ts:47` | Haute |
| A3 | **Doublon d'e-mail ou d'ICE renvoyé en erreur 500.** Les deux index uniques ne figurent pas dans la table des messages ; le statut par défaut d'une violation d'unicité non répertoriée est 500. | mig 007:5 ; mig 242:38 ; `error.middleware.ts:15-27` | Moyenne |
| A4 | **« CA cumulé » faux pour les professionnels.** `total_spent` n'est crédité que par les ventes de caisse payées et n'est jamais diminué (retours, annulations). Les factures issues de BL n'y entrent pas. La liste est triée par défaut sur cette valeur et le bandeau l'additionne en « DH de CA ». | `sale.repository.ts:330`, `:405` (seules écritures) ; `CustomersPage.tsx:135`, `:308`, `:536` | Moyenne |
| A5 | **Colonne `is_active` morte.** Créée, jamais lue ni écrite. | mig 092:10 ; aucune occurrence dans `server/src` pour `customers` | Moyenne |
| A6 | **Tolérance de sur-livraison non modifiable.** Lue à la livraison, absente de l'API et de l'écran ; seule une écriture SQL dans un test la renseigne. | mig 441:83 ; `delivery-note.repository.ts:214` ; `customer.repository.ts:98-107` ; `__tests__/db/o2c-l2.db.test.ts:90` | Moyenne |
| A7 | **Libellé de l'auxiliaire 3421 construit sur prénom + nom.** Pour une société sans contact, libellé vide et code `3421-CLI--xxxx` ; la raison sociale est ignorée ; aucun renommage. | mig 208:35-48 ; `journal-generator.service.ts:1163-1169` | Moyenne |
| A8 | **Fichier clients tronqué au-delà de 1 000 fiches.** La liste charge 1 000 lignes puis filtre et trie dans le navigateur ; les sélecteurs des autres écrans s'arrêtent à 500. `limit` n'est pas plafonné côté serveur. | `CustomersPage.tsx:147` ; `OrderFormModal.tsx:155` ; `ProSalesTab.tsx:211` ; `QuotesPage.tsx:178` ; `SubscriptionsTab.tsx:120` ; `customer.controller.ts:31` | Moyenne (bloquante en distribution) |
| A9 | **Contrôle « direction » contournable.** Il ne s'applique qu'aux routes clients et ne lit que le rôle principal. L'import de données écrit plafond, remise et délai ; la conversion d'un prospect crée une fiche « professionnel ». Cette conversion se fait hors transaction et sans recherche de doublon. | `customer.controller.ts:12` ; `role.middleware.ts:14` ; `data-import.ts:79-81` ; `crm.repository.ts:195-208` | Moyenne |
| A10 | **Aucune validation serveur de la fiche.** Le corps de la requête est transmis tel quel au dépôt. | `customer.controller.ts:61`, `:74` ; absence de validateur client dans `server/src/validators/` | Moyenne |
| A11 | **Export « Clients » incomplet.** Ni raison sociale, ni type, ni ICE : une société sans contact sort sans nom. | `data-export.ts:77-78` | Faible |
| A12 | **Code mort.** `GET /customers/global-stats`, `customerRepository.globalStats`, `customersApi.globalStats` et `customerRepository.findByPhone` sans appelant ; deux invalidations d'une clé de requête qui n'existe pas. | `customers.routes.ts:31` ; `customer.repository.ts:59`, `:173` ; `customers.api.ts:14` ; `CustomersPage.tsx:155`, `:172` | Faible |
| A13 | **Types partagés périmés.** `Customer` impose prénom et nom, ignore tous les champs professionnels et n'est importé nulle part. | `shared/src/types/customer.types.ts:1-21` | Faible |
| A14 | **Canaux de vente gardés par la section « production ».** L'écran est dans Ventes, le droit d'écriture dépend des paramètres de production. | `sales-channel.routes.ts:13-15` ; `SalesLayout.tsx:53` | Faible |
| A15 | **Identité du client lue en direct à l'impression de la facture.** Nom, adresse et ICE viennent de la fiche au moment de l'impression ; aucune colonne de copie figée n'a été trouvée sur `invoices` (mig 439, 450). Une facture réimprimée après modification de la fiche change de contenu. À confirmer par le domaine Facturation. | `accounting.controller.ts:600-623` | À confirmer |
| A16 | **Couplage boulangerie sur la fiche.** Champ « Allergies / restrictions », exemple « Pâtisserie du Coin SARL », canaux semés « boutique » et « événement », rôles de base de fournil dans les groupes de droits. | mig 092:9 ; `CustomersPage.tsx:793`, `:913` ; mig 172 ; `shared/src/constants/roles.ts:31-33` | Faible |

---

## Annexe — Ordre de traitement suggéré

1. **Assainir** (S) : A1 et D1-25 (archivage), A2, A3, A5, A6, D1-30 (validateur), D1-28 (doublons), D1-02 (code client).
2. **Aligner sur les fournisseurs** (M) : D1-32 (audit), D1-03 (identifiants typés), D1-38 (auxiliaire), D1-06 (entité mère), D1-22 (régime de TVA).
3. **Structurer le tiers** (L) : D1-04 (adresses), D1-05 (contacts), D1-07 (payeur et facturé), D1-33 (pièces jointes), D1-23 (attestations).
4. **Conditions commerciales** (M à L) : D1-09 et D1-14 (listes de prix), D1-10 (conditions de paiement), D1-11, D1-15, D1-18, D1-19, D1-26.
5. **Pilotage et conformité** (M) : D1-36 (vue 360°), D1-08 (segmentation), D1-45 (données personnelles), D1-01 (types paramétrables).

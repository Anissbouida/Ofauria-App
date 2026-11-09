# Audit Ventes — D7 « Pilotage commercial, force de vente et capacités transverses de plateforme »

> Audit en lecture seule du code (branche `claude/kalum-sales-cycle-o2c-audit-f724ad`, migrations jusqu'à 467), daté du 2026-11-09.
> Référentiel de comparaison : SAP S/4HANA, Oracle Fusion, Microsoft Dynamics 365 (+ Power Platform), Salesforce, NetSuite, Sage X3, Odoo Enterprise.
> Aucun serveur lancé, aucune base interrogée : tout statut repose sur la lecture du code et des migrations. Ce qui n'a pas pu être vérifié est marqué « supposé ».

---

## 1. Périmètre et sources lues

**Périmètre.** Analyse des ventes et des clients, prévisions et objectifs, force de vente (commissions, territoires, tournées, mobile), tableaux de bord et générateur de rapports, puis les capacités transverses de plateforme vues depuis les Ventes : processus (approbations, séparation des tâches, piste d'audit, pièces jointes, notes), communication (notifications, e-mail, SMS, modèles de documents, langues), structure (multi-société, multi-magasin, devises, numérotation, champs personnalisés, import/export), ouverture (API, webhooks, connecteurs, EDI, portail), technique (pagination, recherche, tests, validation, données personnelles, tâches planifiées) et couplage sectoriel.

**Hors périmètre** (traité par les autres domaines de l'audit) : mécanique du cycle commande → livraison → facture → encaissement, tarification et promotions, caisse.

**Sources lues.**

| Zone | Fichiers |
|---|---|
| Rapports | `server/src/routes/reports.routes.ts`, `server/src/controllers/reports.controller.ts`, `server/src/repositories/report-builder.repository.ts`, `server/src/routes/management.routes.ts`, `server/src/repositories/management.repository.ts` (marges), `server/src/repositories/sale.repository.ts` (synthèse), `client/src/features/reports/*` (5 fichiers), `client/src/features/sales/SalesLayout.tsx`, `SalesPage.tsx` |
| Clients / CRM | `server/src/repositories/customer.repository.ts`, `server/src/routes/customers.routes.ts`, `server/src/routes/crm.routes.ts`, `server/src/repositories/crm.repository.ts`, mig 371 |
| Force de vente | `server/src/routes/commission.routes.ts`, `server/src/repositories/commission.repository.ts`, `client/src/features/employees/CommissionsTab.tsx`, mig 123, 393 ; `server/src/routes/delivery-route.routes.ts` ; `mobile/` (Capacitor) |
| Prévision / budget | `server/src/services/demand-forecast.ts`, `server/src/routes/forecast.routes.ts`, `server/src/routes/management.routes.ts` (budget) |
| Processus | `server/src/services/approval.service.ts`, `approval-handlers.ts`, `shared/src/constants/approvals.ts`, `server/src/routes/approval.routes.ts`, `client/src/features/approvals/ApprovalsPage.tsx`, mig 336, 350, 442, 443 ; `server/src/services/document-actions.service.ts` ; `server/src/repositories/audit-log.repository.ts`, mig 328 ; `server/src/routes/upload.routes.ts` |
| Communication | `server/src/services/mailer.ts`, `server/src/routes/automation.routes.ts`, `server/src/utils/notify.ts`, `server/src/utils/document-template.ts`, `server/src/services/{invoice,delivery-note,dunning}-pdf.service.ts`, mig 332, 364, 365 ; `client/src/features/settings/{DocumentsTab,MailTab,NotificationsTab,JobsTab}.tsx` |
| Structure | mig 329 (numérotation), 363 et 431 (devises), 369/370 (`server/src/services/custom-fields.ts`, `data-import.ts`, `data-export.ts`), 436/437 (RLS, consolidation), `server/src/middleware/tenant.middleware.ts`, `server/src/config/feature-flags.ts` |
| Technique | `server/src/app.ts`, `server/src/middleware/*` (12 fichiers), `server/src/utils/pagination.ts`, `server/src/controllers/search.controller.ts`, `server/src/validators/*`, `server/src/__tests__/**` (90 fichiers), `server/vitest.config.ts`, `.github/workflows/ci.yml`, `server/src/services/scheduler.ts` |
| Multi-secteur | `shared/src/constants/roles.ts`, mig 330, 377, `docs/AUDIT_COUPLAGE_SECTORIEL.md` (contexte, recoupé avec le code) |

Recherches par mots-clés (serveur, client, migrations, shared, mobile) restées sans résultat : `rfm|recency`, `webhook`, `api_key|x-api-key` (hors liste de masquage du journal), `shopify|woocommerce|prestashop|marketplace|glovo|jumia`, `openapi|swagger`, `i18n|i18next|react-intl|useTranslation`, `territor|secteur commercial`, `salesperson|sales_rep|commercial_id|account_manager|seller_id`, `cndp|consent|anonymi|rgpd`, `intercompany|inter-soci|intragroupe`, `stripe|payzone|paypal|paiement en ligne`, `tenant_modules`, `socket.io|WebSocket|EventSource`.

---

## 2. Ce qui existe (forces, avec preuves)

1. **Marge sur coût de revient toutes sources** — vue `v_sales_margin_lines` (mig 452:105-129 : caisse + rapprochement + BL pros, coût figé sur la ligne) ; `managementRepository.margins` (`server/src/repositories/management.repository.ts:299-344`) par famille, canal ou produit, avec part du CA dont le coût est fiable ; écran `client/src/features/reports/MarginsTab.tsx`. Le calcul refuse les coûts incohérents plutôt que d'afficher une marge fausse : c'est mieux que beaucoup d'ERP de milieu de gamme.
2. **Générateur de rapports sûr** — registre figé de sources, dimensions et indicateurs ; l'appelant n'envoie que des clés et des valeurs paramétrées (`report-builder.repository.ts:1-10, 190-242`), rapports enregistrés (mig 394) et tableaux de bord à tuiles (mig 395), visualisations table/barres/courbe/KPI (`client/src/features/reports/ReportViz.tsx:3`), export CSV (`ReportBuilder.tsx:91-96`).
3. **Vue d'ensemble des ventes** — CA, nombre de tickets, panier moyen avec écart contre la période précédente (`ReportsOverview.tsx:91-113, 197-199`), synthèse par famille / article / vendeur / mode de paiement avec export CSV (`SalesPage.tsx:359-395`, `sale.repository.ts:502+`).
4. **Commissions** — barèmes versionnés par vendeur (taux global ou par produit, mig 123), contrats-cadres à paliers, relevé par période et versement sur le bulletin de paie via la rubrique COMMISSION (mig 393, `commission.routes.ts`, `commission.repository.ts:184-292`, `CommissionsTab.tsx`).
5. **Pipeline commercial** — opportunités, étapes, probabilité, montant pondéré (`crm.repository.ts:29, 69`), activités avec échéance et tâche planifiée `crm_activities_due`, campagnes (mig 371, `crm.routes.ts`).
6. **Moteur d'approbation générique** — règles à conditions composées, étapes, escalade, délégations, boîte de réception (mig 350, `approval.service.ts`, `ApprovalsPage.tsx:229-255`), plafonds par rôle et délégations de rôle (mig 336).
7. **File d'e-mails robuste** — `email_outbox` avec 5 tentatives espacées, mode journal en développement, secrets hors base (`mailer.ts:1-28`, mig 364), notification → e-mail par trigger (mig 364:62-91), écran `MailTab.tsx`.
8. **Tâches planifiées** — registre `scheduled_jobs`, historique des passages, déclenchement externe par `/api/v1/cron/tick` (`app.ts:119`, `scheduler.ts:259+`, `JobsTab.tsx`) ; tâches ventes : `quotes_expire`, `dunning_run`, `monthly_invoicing`, `loyalty_expire`, `crm_activities_due`, `complaints_overdue`.
9. **Numérotation paramétrable** — `document_sequences` avec modèle, remise à zéro, mode sans trou pour la facture client (mig 329:72-82) ; séries ajoutées pour devis, proforma, BL, avoir, relance, réclamation.
10. **Champs personnalisés et import générique** — définitions typées, valeurs en JSONB (`custom-fields.ts:8-18`, mig 369), import avec correspondance de colonnes, modes et journal annulable (`data-import.ts:50-126`, mig 370), export de la configuration et des référentiels (`data-export.ts`).
11. **Journal d'audit du paramétrage** — `config_audit_log` en ajout seul, avec masquage des secrets, sur une quinzaine de tables de configuration dont `sales_channels`, `document_sequences`, `document_templates`, `approval_rules` (mig 328:125-152, 329, 332, 350) ; écran `AuditLogTab.tsx`.
12. **Gestion d'erreurs homogène** — intergiciel central, erreurs métier levées par la base converties en 409, message générique en 5xx, journal structuré avec masquage (`error.middleware.ts`).
13. **Export comptable** — FEC et éditions du grand livre (mig 417, `fec.service.ts`, `ledger-editions.service.ts`).

---

## 3. Tableau des capacités

Légende : ✅ complet (serveur et écran câblés) · 🟡 partiel · ❌ absent. Priorité de l'écart : P0 bloquant / obligation légale, P1 attendu en milieu de gamme, P2 avancé, P3 niche, « — » sans écart notable.

### A. Analyse des ventes

| ID | Capacité | Référence grands ERP | Statut | Preuve | Écart | Priorité | Secteurs |
|---|---|---|---|---|---|---|---|
| D7-01 | CA par période, tendance | SAP Sales Analytics, Odoo Sales Analysis, NetSuite Sales by Period | 🟡 | `reports.controller.ts:161-182`, `ReportsOverview.tsx:91-113` | Ne lit que la table `sales` (tickets de caisse) : les BL et factures pros en sont absents. Aucun filtre magasin sur `/reports/sales` (voir anomalie A1). Pas de granularité semaine / trimestre / exercice. | P1 | Tous ; négoce et distribution (CA surtout B2B) |
| D7-02 | CA par produit, famille, canal | Odoo pivot, D365 Sales Insights | ✅ | `sale.repository.ts:502-560` (famille, article), `management.repository.ts:299-344` (canal), `SalesPage.tsx:371-379`, `MarginsTab.tsx:14-18` | — | — | Tous |
| D7-03 | CA par client | SAP « Sales Volume by Customer », NetSuite Sales by Customer | 🟡 | `customer.repository.ts:28, 173-183` (cumul à vie `total_spent`, dernier achat) | Aucun rapport par client et par période ; le générateur de rapports n'a pas de dimension client (`report-builder.repository.ts:36-44`). | P1 | Négoce, distribution, industrie, services |
| D7-04 | CA par vendeur | Salesforce, D365 Sales | 🟡 | `SalesPage.tsx:387-388`, dimension `seller` (`report-builder.repository.ts:43`) | Caisse seulement (`sales.employee_id`). Devis, commandes, BL et factures n'ont aucun champ commercial (voir D7-21). | P1 | Négoce, distribution, services |
| D7-05 | CA par magasin, comparaison entre magasins | NetSuite Subsidiary/Location, Odoo multi-entrepôt | 🟡 | `management.routes.ts:94-98` (résultat comptable par magasin) | Pas de dimension magasin dans les rapports de vente ni dans le générateur (le magasin n'est qu'un filtre implicite). | P1 | Retail, chaînes, franchise |
| D7-06 | Comparaison N-1, cumul annuel | SAP, Sage X3 (N / N-1), NetSuite comparative | 🟡 | `ReportsOverview.tsx:91-93` (période précédente de même durée) | Pas de comparaison à la même période de l'année précédente, pas de cumul depuis le début d'exercice, périodes préréglées limitées à 90 jours (`ReportsPage.tsx:57-62`). | P1 | Tous ; activités saisonnières |
| D7-07 | Marges par produit, famille, canal | SAP CO-PA, Odoo Margin Analysis | ✅ | mig 452:105-129, `management.repository.ts:299-344`, `MarginsTab.tsx` | Pas de marge par client ni par vendeur (suite de D7-03/04). | — | Tous |
| D7-08 | Classement ABC / Pareto (produits, clients) | SAP ABC Analysis, Sage X3 | ❌ | Recherche `\babc\b|pareto` : rien hors tests | Aucune classe ABC calculée ni stockée. | P2 | Négoce, distribution, industrie |
| D7-09 | Rentabilité produit (matrice popularité × marge, coûts) | Odoo, logiciels de restauration | ✅ | `reports.controller.ts:213, 389+`, `ReportsPage.tsx:34-44` | **Couplage boulangerie / restauration** : libellé « Menu Engineering », conseils « retirer du menu », « suggestion serveur », cibles « Food 25-30 %, Labor < 30 % » codées en dur. | P2 | Restauration, traiteur ; à renommer pour les autres |
| D7-10 | Analyse du panier et de la fréquentation | D365 Commerce, Odoo POS analysis | 🟡 | `ReportsOverview.tsx:199` (panier moyen) | Pas d'articles par ticket, pas d'associations de produits, pas d'analyse horaire (recherche `hour|hourly|byHour` dans `sale.repository.ts` : rien). | P2 | Retail, restauration |
| D7-11 | Taux de remise, analyse des remises | SAP condition analysis, Salesforce discount reports | 🟡 | Indicateur `discount` (`report-builder.repository.ts:50`) = `sale_items.promo_discount` | Remises manuelles de ticket et de commande non analysées ; pas de taux par vendeur, client ou motif ; dérogations de prix tracées (mig 443:66-72) mais sans rapport. | P1 | Négoce, distribution, retail |
| D7-12 | Analyse des retours et des avoirs | SAP Returns Overview, NetSuite Return Authorization reports | 🟡 | `return.repository.ts:12`, export CSV `SalesPage.tsx:344` | Liste et déduction du CA seulement : pas de taux de retour par produit, motif, vendeur ou client ; avoirs (mig 450) non analysés. | P1 | Retail, e-commerce, distribution |

### B. Analyse client

| ID | Capacité | Référence grands ERP | Statut | Preuve | Écart | Priorité | Secteurs |
|---|---|---|---|---|---|---|---|
| D7-13 | Segmentation RFM | Salesforce, D365 Customer Insights, Odoo Marketing | ❌ | Recherche `rfm|recency|segment` : rien | Aucun score ni segment ; `customer_type` (mig 092) est la seule segmentation. | P2 | Retail, e-commerce, services |
| D7-14 | Clients inactifs / à relancer | Salesforce, NetSuite saved search | 🟡 | `customer.repository.ts:28` (`last_purchase_at` calculé dans la liste) | Donnée disponible, mais ni filtre, ni rapport, ni alerte « sans achat depuis N jours ». | P1 | Négoce, distribution, services |
| D7-15 | Valeur vie client, concentration du CA | Salesforce CLV, SAP customer profitability | 🟡 | `customer.repository.ts:173-183` (CA cumulé, meilleur client) | Pas de part des N premiers clients, pas de valeur vie (marge, fréquence, ancienneté). | P2 | Négoce, industrie, services |

### C. Prévisions et objectifs

| ID | Capacité | Référence grands ERP | Statut | Preuve | Écart | Priorité | Secteurs |
|---|---|---|---|---|---|---|---|
| D7-16 | Prévision des ventes | SAP IBP, D365 Sales forecasting, Salesforce Forecasts | 🟡 | `demand-forecast.ts:1-18`, `forecast.routes.ts`, `ForecastPage.tsx` ; pipeline pondéré `crm.repository.ts:69` | **Couplage boulangerie** : prévision en quantité par produit et par jour pour la production (mêmes jours de semaine, invendus, Ramadan). Pas de prévision de CA par mois, client, famille ou vendeur ; le pondéré du pipeline n'est pas rapproché d'un objectif. | P1 | Tous ; négoce et industrie (S&OP) |
| D7-17 | Objectifs / quotas par vendeur et par période, réalisé contre objectif | Salesforce Quotas, D365 Goals, NetSuite Quotas | ❌ | Recherche `quota|sales_target|objectif` : uniquement heures supplémentaires et achats | Aucune table d'objectifs, aucun écran. | P1 | Négoce, distribution, services, retail |
| D7-18 | Budget des ventes | SAP planning, Sage X3 budgets | 🟡 | `management.routes.ts:36-91` (budget mensuel par compte comptable, contre réel) | Budget par compte de produits seulement ; pas d'axe produit, client, vendeur ou canal. | P2 | Tous |

### D. Force de vente

| ID | Capacité | Référence grands ERP | Statut | Preuve | Écart | Priorité | Secteurs |
|---|---|---|---|---|---|---|---|
| D7-19 | Barèmes de commission | NetSuite Commissions, Odoo Commissions, SAP ICM | ✅ | mig 123:43-61, mig 393:26-55, `commission.routes.ts:17-109`, `CommissionsTab.tsx` | Règle par famille prévue en base mais non exposée (anomalie A8) ; pas de commission sur marge. | P3 | Négoce, distribution, retail |
| D7-20 | Relevé, validation et paiement des commissions | NetSuite, Salesforce Spiff | 🟡 | `commission.repository.ts:184-292`, mig 393:57-71 | Base = tickets de caisse à la date de création, impayés inclus, retours non déduits (anomalie A9) ; ventes B2B exclues ; pas d'étape de validation ni de contestation ; versement direct en paie. | P1 | Négoce, distribution, services |
| D7-21 | Commercial attitré du client et des pièces (portefeuille) | Salesforce Account Owner, SAP Sales Employee, Odoo Salesperson | ❌ | Recherche `salesperson|sales_rep|commercial_id|account_manager|seller_id` : rien ; seul `opportunities.owner_id` existe (mig 371:35) | Ni la fiche client, ni le devis, ni la commande, ni le BL, ni la facture ne portent de commercial. Bloque D7-04, D7-17, D7-20, D7-22. | **P0** | Négoce, distribution, industrie, services |
| D7-22 | Territoires et plan de visites | Salesforce Territory Management, SAP Visit Planning, D365 Field Sales | ❌ | Recherche `territor|visit|visite` : rien de commercial | Pas de secteur géographique, pas de planning ni de compte rendu de visite (les activités CRM ne se rattachent qu'à une opportunité, mig 371:55). | P2 | Distribution, négoce, industrie |
| D7-23 | Tournées | SAP DSD, Sage X3 tournées | 🟡 | `delivery-route.routes.ts:12-20`, `client/src/features/sales/RoutesTab.tsx` | Tournées de livraison de BL seulement ; pas de prévente, de vente au camion, d'optimisation d'itinéraire ni de retour de tournée. | P2 | Distribution, agroalimentaire |
| D7-24 | Application mobile du commercial, hors-ligne | Salesforce Mobile, SAP Sales Cloud, Odoo mobile | 🟡 | `mobile/capacitor.config.ts`, `mobile/package.json` | Simple enveloppe Android du client web complet ; aucune recherche `serviceWorker|indexedDB|workbox` positive, donc pas de hors-ligne ; pas de parcours dédié prise de commande. | P2 | Distribution, négoce |

### E. Tableaux de bord et rapports

| ID | Capacité | Référence grands ERP | Statut | Preuve | Écart | Priorité | Secteurs |
|---|---|---|---|---|---|---|---|
| D7-25 | Tableaux de bord standards et tuiles configurables | SAP Fiori Launchpad, NetSuite dashboards, Odoo Dashboards | ✅ | `reports.routes.ts:68-94`, mig 395, `ReportBuilder.tsx`, `DashboardPage.tsx`, `HomePage.tsx` | Tableaux de bord réservés aux rôles admin et gérant ; pas de tableau de bord personnel par utilisateur. | — | Tous |
| D7-26 | Générateur de rapports | SAP embedded analytics, NetSuite SuiteAnalytics, Odoo Studio, Power BI | 🟡 | `report-builder.repository.ts:26-155` | Cinq sources seulement ; la source « Ventes » ne couvre que la caisse, sans dimension client, canal ni magasin, sans marge, impayés inclus et retours non déduits ; pas de devis, commandes, BL, factures, créances ; pas de tableau croisé, de champ calculé, de filtre multi-valeurs, de champs personnalisés, ni de navigation vers la pièce. | P1 | Tous |
| D7-27 | Rapports enregistrés et partage | NetSuite saved searches, Salesforce report folders | 🟡 | mig 394:16-26, `report-builder.repository.ts:246-279` | Visibilité par magasin uniquement ; pas de rapport privé / partagé à un rôle ; modification et suppression sans contrôle du magasin (anomalie A3). | P2 | Tous |
| D7-28 | Export Excel / PDF / CSV | Tous | 🟡 | `ReportBuilder.tsx:91-96`, `SalesPage.tsx:48, 316-395` | CSV seulement, généré dans le navigateur ; pas d'Excel ni de PDF pour les rapports de vente (les éditions comptables les ont : `ledger-editions.service.ts`). | P1 | Tous |
| D7-29 | Envoi planifié par e-mail, alertes sur seuils | NetSuite scheduled saved search, SAP Situation Handling, Odoo alertes | ❌ | `scheduler.ts:195-254` (aucune tâche de rapport) ; `email_outbox` sans pièce jointe (mig 364:39-57) | Aucun abonnement à un rapport, aucune alerte « CA du jour < seuil », « marge < x % », « remise > y % ». | P1 | Tous |

### F. Transverse — processus

| ID | Capacité | Référence grands ERP | Statut | Preuve | Écart | Priorité | Secteurs |
|---|---|---|---|---|---|---|---|
| D7-30 | Moteur de circuits d'approbation | SAP Flexible Workflow, NetSuite SuiteFlow, D365 Workflow | ✅ | mig 350, `approval.service.ts`, `client/src/features/settings/ApprovalsTab.tsx`, `ApprovalsPage.tsx` | Types de documents figés dans le code (`shared/src/constants/approvals.ts:26-101`). | — | Tous |
| D7-31 | Circuits d'approbation des ventes (remise, crédit, avoir, annulation, devis) | SAP credit / pricing approval, Salesforce Approval Process, Odoo approbation de devis | 🟡 | Seul `invoice_cancel` passe par le moteur (`approvals.ts:78-91`, `accounting.controller.ts:296`) ; remise et prix : plafonds par rôle (`order.controller.ts:92, 149`, `parameters-catalog.ts:127-131`) ; crédit : dérogation motivée (mig 443:50-63) | Remise, dérogation de prix, dépassement de crédit, avoir et devis ne déclenchent aucune demande d'approbation : l'opération est soit autorisée par le rôle, soit refusée. | P1 | Négoce, distribution, industrie, services |
| D7-32 | Séparation des tâches côté ventes | SAP GRC, NetSuite SoD | 🟡 | mig 336:33-61 (règles d'incompatibilité de droits : achats et comptabilité seulement) ; mig 442 (par document : chaîne d'achat seulement) | Aucune règle ventes : créer un client et relever son plafond, saisir une vente et l'annuler, facturer et encaisser, émettre un avoir et rembourser. | P1 | Tous |
| D7-33 | Délégations | SAP substitution, D365 delegation | ✅ | mig 350:100-111, mig 336 (`role_delegations`), `ApprovalsPage.tsx:229-255` | — | — | Tous |
| D7-34 | Piste d'audit / journal des modifications des pièces de vente | SAP Change Documents, NetSuite System Notes, Odoo chatter | 🟡 | `quote_events` (mig 365), `credit_check_events` (mig 443:50), dérogation de prix (mig 443:66-72), `complaint_events` ; `config_audit_log` ne couvre que le paramétrage (mig 328:130-141) | Aucun journal champ par champ sur clients (plafond de crédit, conditions), commandes, BL, prix, promotions ; `document_actions` exclut les pièces de vente (`document-actions.service.ts:14`). Recherche `order_events|order_status_history|sale_events|invoice_events` : rien. | P1 | Tous |
| D7-35 | Pièces jointes / GED sur les pièces de vente | SAP DMS / Attachment Service, NetSuite File Cabinet, Odoo Documents | ❌ | Pièce jointe uniquement sur la facture fournisseur (mig 039) ; photos de réclamation et de perte (`upload.routes.ts:12-55`) ; documents RH | Impossible de joindre un bon de commande client, un contrat, un BL signé ou un justificatif à un devis, une commande, une facture ou une fiche client. | P1 | Négoce, industrie, services |
| D7-36 | Notes, fil de discussion, tâches et rappels | Odoo chatter et activités, Salesforce Chatter / Tasks | 🟡 | `crm_activities` (mig 371:53-68), tâche `crm_activities_due` | Activités rattachées à l'opportunité seulement ; pas de fil ni de tâche sur client, devis, commande, facture ; pas de mention d'un collègue. | P1 | Tous |

### G. Transverse — communication

| ID | Capacité | Référence grands ERP | Statut | Preuve | Écart | Priorité | Secteurs |
|---|---|---|---|---|---|---|---|
| D7-37 | Notifications dans l'application | SAP Fiori notifications, Odoo | ✅ | `notifications.routes.ts:7-10`, `client/src/components/layout/NotificationBell.tsx`, mig 332:50-83, `NotificationsTab.tsx` | Un seul événement ventes semé (`order_ready`) ; pas de préférences par utilisateur ; pas de canal temps réel (interrogation périodique, `NotificationBell.tsx:57, 65`). | — | Tous |
| D7-38 | E-mail : file d'envoi, reprises, journal | NetSuite, Odoo mail queue | ✅ | `mailer.ts:1-28`, mig 364:39-60, `automation.routes.ts:20-85`, `MailTab.tsx` | SMTP unique en variables d'environnement (pas par société ni par magasin). | — | Tous |
| D7-39 | Envoi des pièces de vente par e-mail, modèles d'e-mail | SAP Output Management, Odoo « Envoyer par e-mail », NetSuite email templates | ❌ | `enqueueEmail` n'a que deux appelants : relances et demandes de prix (`dunning.repository.ts:199`, `rfq.repository.ts:57`) ; corps en texte brut (`mailer.ts:76-77`) ; `email_outbox` sans colonne de pièce jointe (mig 364:39-57) | Devis, facture, BL, avoir, relevé de compte : aucun envoi depuis la pièce, aucun PDF joint ; l'action « send » du devis ne change que le statut (`quotes.routes.ts:103`) ; aucun modèle d'e-mail paramétrable ni HTML. | P1 | Tous |
| D7-40 | SMS / WhatsApp | Salesforce Digital Engagement, Odoo SMS / WhatsApp | ❌ | `preferred_contact = 'whatsapp'` est une simple étiquette (`CustomersPage.tsx:586, 873`) ; canal `whatsapp` déclaré mais jamais utilisé (`document-actions.service.ts:31`) | Aucune passerelle. | P2 | Retail, traiteur, services (usage très répandu au Maroc) |
| D7-41 | Modèles de documents PDF personnalisables | SAP Adobe Forms, Odoo Studio reports, NetSuite Advanced PDF | 🟡 | `document-template.ts:11-58`, mig 332:1-48, mig 365:103, `DocumentsTab.tsx` | Trois types (facture, bon de commande, devis) ; seuls les textes sont réglables (conditions, pénalités, pied, banque, logo). Mise en page et couleurs codées en dur (`invoice-pdf.service.ts:106-109`, `delivery-note-pdf.service.ts:13`) ; BL, avoir, relance, ticket hors modèle. | P1 | Tous |
| D7-42 | Langues des documents et de l'interface (FR / AR droite-à-gauche / EN), infrastructure de traduction | Tous (SAP : 40 langues ; Odoo : traduction par terme) | ❌ | Recherche `i18n|i18next|react-intl|useTranslation` : rien ; 222 `fr-FR` et 840 « DH » en dur dans `client/src` ; droite-à-gauche limité aux étapes de recette (`client/src/features/recipes/EtapesSection.tsx:144`) ; PDF en Helvetica, français seul | Aucune couche de libellés : ni langue de l'interface, ni langue du document par client, ni terminologie par secteur. | **P0** | Tous (export, clients arabophones ou anglophones, tout nouveau secteur) |

### H. Transverse — structure

| ID | Capacité | Référence grands ERP | Statut | Preuve | Écart | Priorité | Secteurs |
|---|---|---|---|---|---|---|---|
| D7-43 | Multi-société et ventes inter-sociétés | SAP company codes, NetSuite OneWorld, Odoo multi-company | ❌ | Société unique : `company_settings WHERE id = 1` (`data-export.ts:28`) ; aucune table `companies` / `tenants` ; mig 437 = liaison entre établissements d'une même société (compte 1811) | Pas de seconde entité juridique, pas de vente inter-sociétés ni d'élimination. | P1 | Groupes, franchise, distribution |
| D7-44 | Multi-magasin | NetSuite Locations, Odoo | ✅ | `tenant.middleware.ts:14-30`, `store_id` sur ventes, commandes, rapports ; consolidation mig 437 | Cloisonnement en base éteint par défaut (`feature-flags.ts:62`, `RLS_STORE_SCOPE`) ; voir anomalies A1 et A3. | — | Retail, chaînes |
| D7-45 | Multi-devises côté ventes | SAP, NetSuite Multi-Currency | 🟡 | mig 431 (facture client en devise, écart de change, réévaluation), `EmittedInvoicesTab.tsx:245, 273-274, 730-737` | Facture manuelle seulement : ni client, ni devis, ni commande, ni BL, ni grille de prix en devise (mig 363 ne touche que les achats) ; rapports en dirhams. | P1 | Négoce, export, industrie, services |
| D7-46 | Séquences de numérotation paramétrables | SAP number ranges, Odoo sequences | ✅ | mig 329:72-82 + séries devis, proforma, BL, avoir, relance ; `client/src/features/settings/NumberingTab.tsx` | Pas de série par magasin ni par société. | — | Tous |
| D7-47 | Champs personnalisés sur les pièces de vente | Odoo Studio, NetSuite custom fields, Salesforce | 🟡 | `custom-fields.ts:8-18` (client, produit, commande, opportunité) ; éditeur présent sur clients, produits, opportunités | Commande : entité déclarée mais aucun éditeur à l'écran (anomalie A12) ; devis, BL, facture, avoir non couverts ; champs absents des PDF, des listes et du générateur de rapports. | P1 | Tous (c'est le levier multi-secteur le moins coûteux) |
| D7-48 | Import / export de données, archivage | SAP LTMC, NetSuite CSV Import, Odoo import | 🟡 | `data-import.ts:50-126` (clients, produits en mise à jour), `sales.routes.ts:48` (import d'historique de caisse), `data-export.ts` | Pas d'import de commandes, devis, grilles de prix, soldes clients d'ouverture ; pas d'archivage : suppression physique du client (`customer.repository.ts:188-190`), pas de drapeau « archivé » sur les pièces. | P1 | Tous (reprise de données à chaque nouveau client) |

### I. Transverse — ouverture

| ID | Capacité | Référence grands ERP | Statut | Preuve | Écart | Priorité | Secteurs |
|---|---|---|---|---|---|---|---|
| D7-49 | API publique documentée, clés d'API | SAP API Business Hub, NetSuite REST, Odoo external API | ❌ | API interne `/api/v1` protégée par cookie + contrôle d'origine (`app.ts:119-171`) ; aucune spécification OpenAPI, aucune clé ni compte de service | Aucune intégration tierce possible sans simuler une session utilisateur. | **P0** | Tous |
| D7-50 | Webhooks / événements sortants | NetSuite, Salesforce Platform Events, Odoo | ❌ | Recherche `webhook` : rien | — | P1 | E-commerce, distribution, intégrateurs |
| D7-51 | Connecteurs e-commerce et places de marché | Odoo eCommerce, NetSuite SuiteCommerce, connecteurs Shopify / WooCommerce | ❌ | Recherche `shopify|woocommerce|marketplace|glovo|jumia` : rien ; `orders.type = 'online'` n'est qu'un libellé (mig 011:42, `OrdersPage.tsx:54`) | Les canaux de vente sont des étiquettes tarifaires, sans flux entrant. | P1 | Retail, restauration, traiteur |
| D7-52 | EDI client, facture électronique | SAP EDI / IDoc, Sage X3 EDI | ❌ | « EDI » n'apparaît que pour les télédéclarations fiscales (`dgi-edi.service.ts`) | Pas d'échange de commandes / avis d'expédition / factures avec la grande distribution. Facturation électronique marocaine : calendrier **supposé**, à suivre. | P2 | Distribution, industrie agroalimentaire |
| D7-53 | Export comptable | Tous | ✅ | mig 417, `fec.service.ts`, `ledger-editions.service.ts` | — | — | Tous |
| D7-54 | Portail client B2B, paiement en ligne | SAP Commerce, Odoo Portal, NetSuite Customer Center | ❌ | Recherche `portal|portail` : uniquement portails DGI et bancaires ; `stripe|payzone|cmi` : rien | Ni commande, ni consultation des factures, ni règlement en ligne par le client. | P1 | Négoce, distribution, services |

### J. Transverse — technique

| ID | Capacité | Référence grands ERP | Statut | Preuve | Écart | Priorité | Secteurs |
|---|---|---|---|---|---|---|---|
| D7-55 | Pagination et performance des listes | Tous | 🟡 | Ventes, commandes, devis, clients paginés (`sale.repository.ts:66-76`, `order.repository.ts:24-38`, `quote.repository.ts:107`) | Limite de page non bornée sur les commandes (anomalie A10) ; liste des BL coupée à 500 sans pagination (`delivery-note.repository.ts:73`) ; utilitaire de pagination commun jamais utilisé (anomalie A11) ; tri et filtrage côté navigateur (`SalesPage.tsx:300-309`). | P1 | Tous (volumes de la distribution) |
| D7-56 | Recherche globale | SAP Enterprise Search, Odoo, NetSuite Global Search | 🟡 | `search.controller.ts:18-31` | Quatre référentiels (ingrédients, produits, clients, fournisseurs) ; aucune pièce (devis, commande, BL, facture) ; résultats non filtrés par droit (anomalie A4) ; `ILIKE` sans index trigramme (recherche `trgm|tsvector` : rien). | P1 | Tous |
| D7-57 | Tests automatisés du domaine ventes | — | 🟡 | 526 tests dans 90 fichiers serveur ; environ 79 pour les ventes (`db/o2c-l0…l6` : 39, `db/scenarios-ventes` : 13, `scenarios-ventes-controllers` : 7, `db/promotions-fidelite` : 7, `credit-control` : 4, autres : 9 — décompte par motif `it(` / `test(`) | Aucun test sur rapports, générateur de rapports, commissions, pipeline, relances, devis ; aucun test côté client ; les suites `db/` (les trois quarts des tests ventes) sont ignorées en intégration continue (anomalie A14) ; pas de mesure de couverture. | P1 | — |
| D7-58 | Validation des entrées (zod) sur les routes de vente | — | 🟡 | Validé : encaissement, règlement, retours, devis, relances, promotions, pipeline, commissions, réclamations (`sale.validator.ts`, `quotes.routes.ts`, `dunning.routes.ts`…) | Aucun schéma sur commandes (6 routes d'écriture), clients (3), BL (4), tournées (6), abonnements (3), canaux (3), sessions de caisse (4), définitions de rapports (7) : comptage `safeParse|validate(` = 0 dans ces fichiers de routes et leurs contrôleurs. | P1 | — |
| D7-59 | Gestion d'erreurs | — | ✅ | `error.middleware.ts:9-60`, `asyncHandler.ts` | Messages en français seulement (lié à D7-42). | — | — |
| D7-60 | Protection des données personnelles (loi 09-08) | SAP ILM, Salesforce Privacy Center, Odoo Data Cleaning | ❌ | Recherche `cndp|consent|consentement|anonymi|09-08` : une seule mention, côté RH (`hr-contract.controller.ts:90`) | Pas de consentement ni de finalité sur la fiche client, pas de durée de conservation, pas d'export ni d'anonymisation à la demande, suppression physique sans trace, coordonnées clients ouvertes à tout utilisateur connecté (anomalie A4), pas de journal des consultations. | **P0** | Tous (obligation légale au Maroc dès qu'il y a un fichier clients) |
| D7-61 | Tâches planifiées | SAP Job Scheduling, NetSuite scheduled scripts | ✅ | `scheduler.ts`, mig 364, `JobsTab.tsx`, `app.ts:119` | — | — | Tous |

### K. Multi-secteur

| ID | Capacité | Référence grands ERP | Statut | Preuve | Écart | Priorité | Secteurs |
|---|---|---|---|---|---|---|---|
| D7-62 | Rôles et droits configurables | SAP rôles, NetSuite custom roles | 🟡 | Table `roles` éditable et droits par module (mig 330:33-72), garde de module globale (`routes/index.ts:93`) | **Couplage boulangerie** : tout rôle hérite d'un des neuf rôles de base figés, dont boulanger, pâtissier, viennoiserie, « beldi & salé », vendeuse (mig 330:37-38, `shared/src/constants/roles.ts:1-17`) ; les routes de vente autorisent par groupes de rôles en dur (`ROLE_GROUPS.SALES`, `ADMIN_MANAGER` : 79 lignes `authorize(` dans les 14 fichiers de routes ventes concernés, contre 16 `authorizeModule(` pour le seul pipeline) ; « direction » = admin ou gérant dans l'écran (`SalesLayout.tsx:17`). Pas de rôle commercial, ADV, crédit-manager. | **P0** | Tous les secteurs hors boulangerie |
| D7-63 | Vocabulaire et terminologie par secteur | Odoo (packs sectoriels), SAP industry solutions | ❌ | « Menu Engineering » (`SalesLayout.tsx:45`), « Vendeuse / Caissier » (`SalesPage.tsx:28, 388`), exemples « Pâtisserie du Coin SARL » (`CustomersPage.tsx:793`), « Happy hour viennoiseries » (`PromotionsPage.tsx:376`), couleurs « boulangerie » de l'application mobile (`mobile/capacitor.config.ts:20, 26`) | Libellés métier dans le code, sans couche de substitution (dépend de D7-42). | P1 | Tous les secteurs hors alimentaire |
| D7-64 | Unités de vente | SAP UoM, Odoo UoM categories | 🟡 | Contrainte `sale_unit IN ('unit','weight','person')` (mig 377:12-14), schéma d'encaissement `displayUnit: 'g' | 'kg'` (`sale.validator.ts:19`) | **Couplage boulangerie** : pas de référentiel d'unités (carton, palette, mètre, litre, heure, forfait), pas de conversion vente / stock, « person » = part d'entremets. | **P0** | Négoce, distribution, industrie, services |
| D7-65 | Pays, devise, fuseau et modules activables par offre | NetSuite SuiteApps, Odoo localisations et apps | 🟡 | Devise de base et tables de devises (mig 363), fuseau utilisateur (`utils/timezone.ts`) | « DH » en dur 840 fois dans `client/src`, « Africa/Casablanca » 43 fois côté serveur (dont la vue de marge, mig 452:106), mentions légales marocaines dans les modèles (mig 332:41-44) ; aucun module activable par abonnement (recherche `tenant_modules` : rien). | P1 | Tout déploiement hors Maroc ou hors boulangerie |

---

## 4. Écarts détaillés P0 et P1

### 4.1 Écarts P0

**D7-21 — Commercial attitré du client et des pièces**
- *Constat.* Aucune colonne de commercial sur `customers`, `quotes`, `orders`, `delivery_notes`, `invoices` ; seule l'opportunité a un propriétaire (mig 371:35) et seul le ticket de caisse a un vendeur (`sales.employee_id`).
- *Impact.* Pas de CA, de marge, d'objectif ni de commission par commercial sur le B2B ; pas de portefeuille ni de cloisonnement « mes clients » ; les commissions actuelles ignorent tout le CA facturé.
- *Piste.* Ajouter `customers.salesperson_id` (référence `users` ou `employees`) et `salesperson_id` sur devis, commande, BL, facture, hérité du client et modifiable ; reprise depuis `opportunities.owner_id` et `created_by` ; filtre « mes clients / mes pièces » ; dimension « commercial » dans `v_sales_margin_lines` et dans le générateur ; étendre `commission.repository.statement` aux factures encaissées.
- *Effort.* M.

**D7-42 — Langues et infrastructure de traduction**
- *Constat.* Aucune bibliothèque ni table de traduction ; libellés français dans les composants, les messages d'erreur du serveur et les services PDF ; droite-à-gauche inexistant hors recettes ; polices PDF sans glyphes arabes hors fiche recette.
- *Impact.* Pas de facture en arabe ou en anglais, pas d'interface pour un utilisateur non francophone, et aucun moyen de renommer le vocabulaire métier par secteur (D7-63).
- *Piste.* (1) Introduire une couche de libellés côté client (clés neutres + fichiers par langue + surcharges par secteur) en commençant par le module Ventes ; (2) `customers.document_language` et `users.language` ; (3) dictionnaire de libellés dans les services PDF, police avec glyphes arabes et mise en page miroir (le savoir-faire existe dans `recipe-fiche-pdf.service.ts:210-212`) ; (4) codes d'erreur stables côté serveur, traduits à l'écran ; (5) propriété `dir` au niveau racine et styles logiques.
- *Effort.* L (extraction des chaînes : plusieurs milliers d'occurrences).

**D7-49 — API publique documentée et clés d'API**
- *Constat.* L'API n'est conçue que pour le client web (cookie, contrôle d'origine, jeton anti-CSRF) ; aucune documentation générée ; aucun identifiant machine.
- *Impact.* Pas de site marchand, de caisse tierce, d'outil décisionnel ni d'intégrateur possible : rédhibitoire face à tous les ERP comparés.
- *Piste.* Table `api_keys` (empreinte, portée par module et action, magasin, expiration, dernier usage) + intergiciel d'authentification par en-tête qui court-circuite le contrôle d'origine ; limitation de débit par clé ; génération OpenAPI à partir des schémas zod (ce qui impose d'abord D7-58) ; écran Paramètres › Intégrations ; journal des appels. Étendre l'intergiciel d'idempotence existant (`idempotency.middleware.ts`, aujourd'hui limité aux achats) aux écritures de vente.
- *Effort.* L.

**D7-60 — Protection des données personnelles (loi 09-08)**
- *Constat.* La fiche client stocke nom, téléphone, e-mail, adresse, sans base légale ni consentement enregistré ; suppression physique ; recherche globale ouverte à tout utilisateur connecté ; export complet des clients en Excel sans trace.
- *Impact.* Non-conformité vis-à-vis de la CNDP (déclaration, droit d'accès, de rectification et d'opposition, durée de conservation) ; risque pour tout éditeur qui héberge les données de plusieurs clients.
- *Piste.* Colonnes `marketing_consent`, `consent_at`, `consent_source`, `anonymized_at` sur `customers` ; action « anonymiser » (remplace les données d'identité, conserve les pièces comptables) au lieu de la suppression ; export « mes données » par client ; paramètre de durée de conservation + tâche planifiée ; brancher `customers` sur le trigger d'audit (mig 328) ; filtrer la recherche globale par droit de module ; journaliser les exports.
- *Effort.* M.

**D7-62 — Rôles codés en dur**
- *Constat.* Les rôles de base sont une liste fermée de métiers de boulangerie, répétée dans une contrainte SQL (mig 330:37-38), dans `shared/src/constants/roles.ts` et dans 79 appels `authorize(...)` des routes de vente ; les écrans testent `role === 'admin' || 'manager'`.
- *Impact.* Un négociant ne peut pas créer un rôle « commercial » qui voit ses devis sans hériter de « caissier » ou « vendeuse » ; ajouter un métier exige migration + code.
- *Piste.* Remplacer `authorize(...ROLE_GROUPS.X)` par `authorizeModule(module, action)` et des verbes métier (`requireVerb`, déjà présent dans `module.middleware.ts:51`) sur toutes les routes de vente ; réduire les rôles de base à des profils neutres (administrateur, responsable, opérateur) ; notion de « direction » remplacée par un droit (`orders.pro`, `quotes.manage`) ; modèles de rôles livrés par pack sectoriel.
- *Effort.* M pour les Ventes, L pour l'ensemble de l'application.

**D7-64 — Unités de vente en énumération**
- *Constat.* `products.sale_unit` limité à pièce, poids, personne ; la caisse ne connaît que g et kg.
- *Impact.* Impossible de vendre au carton, à la palette, au mètre, au litre, à l'heure ou au forfait, ni de vendre dans une unité et de stocker dans une autre.
- *Piste.* Référentiel `units_of_measure` (catégorie, facteur de conversion) ; `products.sale_uom_id`, `stock_uom_id`, conditionnements (`product_packagings`) ; quantité et unité sur chaque ligne de devis, commande, BL, facture ; conserver pièce / poids / personne comme valeurs semées. À mener avec le domaine Produits.
- *Effort.* L.

### 4.2 Écarts P1

| ID | Constat | Impact | Piste de solution | Effort |
|---|---|---|---|---|
| D7-01 | Vue d'ensemble = tickets de caisse seulement ; pas de filtre magasin sur deux requêtes | CA affiché faux dès qu'il y a du B2B ou plusieurs magasins | Faire lire à `/reports/sales` et `/reports/products` la vue `v_sales_margin_lines` (déjà toutes sources), avec filtre magasin et granularité jour / semaine / mois | S |
| D7-03 | Pas d'analyse par client | Impossible de piloter un portefeuille B2B | Ajouter `customer_id` à `v_sales_margin_lines` ; onglet « Par client » dans Marges ; dimension client dans le générateur | S |
| D7-04 | CA par vendeur limité à la caisse | Pas de performance commerciale B2B | Découle de D7-21 ; ajouter le regroupement « commercial » | S (après D7-21) |
| D7-05 | Pas de comparaison entre magasins | Chaînes et franchises non pilotables | Dimension magasin dans Marges et dans le générateur ; sélecteur de magasin pour l'administrateur | S |
| D7-06 | Comparaison limitée à la période précédente | Lecture faussée par la saisonnalité | Paramètre `compare = previous | last_year | ytd` ; préréglages mois, trimestre, exercice | S |
| D7-11 | Remises non analysées | Dérive des remises invisible | Vue `v_sales_discount_lines` (remise de ligne, de ticket, de commande, dérogation de prix) ; rapport par vendeur, client, motif | M |
| D7-12 | Retours et avoirs non analysés | Pas de taux de retour ni de cause | Motifs de retour en référentiel ; rapport taux de retour par produit, client, motif ; inclure les avoirs (mig 450) | M |
| D7-14 | Clients inactifs non exploités | Pas de relance commerciale | Filtre « sans achat depuis N jours » sur la liste ; tâche planifiée créant une activité de relance | S |
| D7-16 | Prévision orientée production | Pas de prévision de CA ni de rapprochement avec le pipeline | Prévision mensuelle par famille / client (moyenne mobile + saisonnalité N-1) ; écran « Prévision des ventes » : prévu, pipeline pondéré, commandes fermes, réalisé | M |
| D7-17 | Aucun objectif | Pas de management commercial | Table `sales_targets` (période, commercial / magasin / famille, montant, type CA ou marge) ; tuile « réalisé / objectif » ; lien avec les paliers de commission | M |
| D7-20 | Commissions sur tickets créés, impayés inclus, retours non déduits, B2B exclu, sans validation | Commission versée sur du CA non encaissé ou annulé | Base paramétrable (facturé / encaissé / marge) ; déduire retours et avoirs ; statut du relevé brouillon → validé → versé ; garde contre le chevauchement de périodes | M |
| D7-26 | Générateur limité à la caisse | Outil peu utile hors boulangerie | Ajouter les sources devis, commandes, BL, factures clients, créances, pipeline, retours ; dimensions client, canal, magasin, commercial ; indicateur marge ; filtres multi-valeurs ; champs personnalisés ; lien vers la pièce | M |
| D7-28 | CSV seul | Rapports non présentables | Réutiliser la bibliothèque `xlsx` (déjà présente : `data-export.ts:1`) et PDFKit pour un export serveur Excel / PDF de tout rapport | S |
| D7-29 | Pas d'envoi planifié ni d'alerte | Le dirigeant doit se connecter pour savoir | Table `report_subscriptions` (rapport, fréquence, destinataires, format) + tâche planifiée ; pièces jointes dans `email_outbox` ; règles de seuil sur un indicateur de rapport → notification | M |
| D7-31 | Remise, prix, crédit, avoir, devis hors moteur d'approbation | Refus sec au lieu d'une demande ; pas de trace de décision | Déclarer les types `sales_discount`, `price_override`, `credit_override`, `credit_note`, `quote` dans `APPROVAL_DOC_TYPES` avec leurs champs (taux, montant, marge, client) et brancher `approvalService.submit` dans `order.controller.ts` et le contrôle de crédit | M |
| D7-32 | Aucune règle de séparation des tâches ventes | Fraude interne non détectée | Semer des règles ventes dans `sod_rules` (mig 336) ; étendre les règles par document (mig 442) : auteur de la facture ≠ encaisseur, auteur de l'avoir ≠ rembourseur, créateur du client ≠ valideur du plafond | M |
| D7-34 | Pas de journal des modifications sur les pièces et les clients | Litiges et contrôles non documentés | Étendre `document_actions` aux types de vente et poser un trigger de différences sur `customers`, `orders`, `order_items`, `delivery_notes`, grilles de prix ; onglet « Historique » sur chaque pièce | M |
| D7-35 | Pas de pièces jointes | Dossier client incomplet | Table générique `attachments` (type et identifiant de pièce, nom, type MIME, taille, empreinte, auteur) avec stockage objet ; composant commun sur client, devis, commande, BL, facture | M |
| D7-36 | Notes et tâches limitées aux opportunités | Suivi client éparpillé | Généraliser `crm_activities` (colonnes `ref_type`, `ref_id`) et ajouter un fil de notes par pièce | M |
| D7-39 | Aucun envoi de pièce par e-mail | Ressaisie dans une messagerie externe | Colonnes `body_html` et pièces jointes dans `email_outbox` ; table `email_templates` (par type de pièce et par langue, variables) ; bouton « Envoyer » sur devis, facture, BL, avoir, relevé ; trace dans le journal de la pièce | M |
| D7-41 | Mise en page des PDF figée | Chaque client veut son identité | Paramètres de thème par société (couleurs, police, position du logo, colonnes affichées) lus par un moteur de mise en page commun ; étendre `document_templates` au BL, à l'avoir et à la relance | M |
| D7-43 | Société unique | Groupes et franchises exclus | À traiter avec le chantier SaaS (société = locataire) ; côté ventes : `company_id` sur les pièces et les séries, client interne, facture inter-sociétés miroir | L |
| D7-45 | Devise limitée à la facture manuelle | Export et négoce international impossibles de bout en bout | `customers.currency_code` ; devise et taux sur devis, commande, BL ; grille de prix par devise ; conversion dans les rapports | M |
| D7-47 | Champs personnalisés incomplets sur les pièces | Adaptation sectorielle bloquée | Ajouter les entités devis, BL, facture, ligne de commande ; poser l'éditeur sur l'écran commande ; exposer les champs dans les PDF, les listes et le générateur | M |
| D7-48 | Pas d'import de pièces ni d'archivage | Reprise de données manuelle ; fichier clients qui grossit | Entités d'import « commandes ouvertes », « grilles de prix », « soldes clients » ; `archived_at` sur clients et pièces closes | M |
| D7-50 | Pas de webhooks | Intégrations par interrogation répétée | Tables `webhook_endpoints` et `webhook_deliveries` (signature, reprises), alimentées comme `email_outbox` ; événements commande confirmée, BL livré, facture émise, encaissement | M |
| D7-51 | Pas de connecteur e-commerce | Canal en ligne ressaisi à la main | Point d'entrée « commande externe » (canal, référence externe, client rapproché par e-mail ou téléphone) sur l'API publique ; premier connecteur WooCommerce ou Shopify ; synchronisation stock et prix | L |
| D7-54 | Pas de portail client | Appels et e-mails pour chaque facture | Comptes de contact client, espace lecture (devis à accepter, commandes, BL, factures, relevé) puis commande et paiement en ligne (passerelle marocaine) | L |
| D7-55 | Pagination incomplète | Lenteurs et troncatures silencieuses | Borner `limit` partout ; paginer les BL ; tri et filtre côté serveur ; adopter ou supprimer `utils/pagination.ts` | S |
| D7-56 | Recherche globale partielle et non filtrée | Pièces introuvables ; fuite de données | Ajouter devis, commandes, BL, factures par numéro et par client ; filtrer par droit de module et par magasin ; index trigramme | S |
| D7-57 | Tests ventes incomplets, suites base non exécutées en intégration continue | Régressions non détectées | Service PostgreSQL dans `ci.yml` + `TEST_DATABASE_URL` ; tests du générateur (clés invalides, portée magasin), des commissions, des rapports ; premiers tests d'écran | M |
| D7-58 | Routes de vente sans schéma | Erreurs 500 sur entrée mal formée ; prérequis de la documentation d'API | Schémas zod pour commandes, clients, BL, tournées, abonnements, canaux, caisse, définitions de rapports ; intergiciel `validate` systématique | M |
| D7-63 | Vocabulaire boulangerie dans les écrans de vente | Produit perçu comme logiciel de boulangerie | Clés de terminologie par secteur sur la couche de libellés (D7-42) : « Menu Engineering » → « Rentabilité produit », « Vendeuse » → « Vendeur » ; exemples neutres | S (après D7-42) |
| D7-65 | Devise, fuseau, mentions légales et modules figés pour le Maroc et la boulangerie | Aucun autre pays ni offre modulaire | Symbole de devise lu depuis `currencies` ; fuseau par société dans les vues SQL ; pack pays pour les mentions ; table des modules activés par abonnement croisée avec les droits | M |

---

## 5. Compteurs

| Mesure | Valeur |
|---|---|
| Capacités auditées | **65** |
| ✅ Complet | **14** (D7-02, 07, 09, 19, 25, 30, 33, 37, 38, 44, 46, 53, 59, 61) |
| 🟡 Partiel | **33** |
| ❌ Absent | **18** (D7-08, 13, 17, 21, 22, 29, 35, 39, 40, 42, 43, 49, 50, 51, 52, 54, 60, 63) |
| P0 | **6** (D7-21, 42, 49, 60, 62, 64) |
| P1 | **34** |
| P2 | **12** (D7-08, 09, 10, 13, 15, 18, 22, 23, 24, 27, 40, 52) |
| P3 | **1** (D7-19) |
| Sans écart notable | **12** |
| Capacités marquées « couplage boulangerie » | 5 (D7-09, 16, 62, 63, 64) |

Lecture : la plateforme transverse (approbations, e-mails, tâches planifiées, numérotation, champs personnalisés, journal du paramétrage) est solide mais a été construite pour les achats, la comptabilité et le paramétrage ; les Ventes en profitent peu. Le pilotage commercial reste centré sur la caisse. L'ouverture vers l'extérieur (API, webhooks, portail, connecteurs) est entièrement absente.

---

## 6. Anomalies rencontrées en chemin

Toutes constatées à la lecture du code ; aucune n'a été reproduite en exécution.

| # | Anomalie | Preuve | Gravité |
|---|---|---|---|
| A1 | **Rapports de vente sans filtre magasin.** `sales` et `productPerformance` n'appliquent aucun `store_id`, de même que « produits phares » du tableau de bord, alors que les autres requêtes du même contrôleur filtrent. Un gérant rattaché à un magasin voit le CA de tous. | `reports.controller.ts:161-182`, `184-211`, `76-96` (comparer à `49`, `215-222`) | Haute |
| A2 | **Quatre définitions du chiffre d'affaires.** Vue d'ensemble : tickets encaissés, à la date de règlement, retours déduits. Marges : caisse + rapprochement + BL pros. Générateur « Ventes » : tous les tickets, impayés compris, à la date de création, sans retours. Commissions : tickets créés, types `standard/delivery/special`, impayés compris, sans retours. Les chiffres ne peuvent pas se recouper. | `reports.controller.ts:165-181` ; mig 452:105-129 ; `report-builder.repository.ts:27-51` ; `commission.repository.ts:16, 186` | Haute |
| A3 | **Rapports et tableaux de bord enregistrés modifiables d'un magasin à l'autre.** `update`, `remove`, `getDashboard`, `updateDashboard`, `removeDashboard` ne vérifient ni le magasin ni l'auteur ; la portée n'est appliquée qu'à la liste. Le corps des définitions n'a pas de schéma. | `report-builder.repository.ts:269-279, 293-314` ; `reports.routes.ts:53-66, 74-95` | Moyenne |
| A4 | **Recherche globale ouverte à tout utilisateur connecté.** Elle renvoie clients (téléphone, ville) et fournisseurs sans contrôle de rôle ni de module ; la garde de module n'a pas de règle pour `/search`. | `search.routes.ts:7`, `search.controller.ts:18-31`, `module-guard.middleware.ts` (aucune entrée « search ») | Haute (données personnelles) |
| A5 | **Libellé « CA HT »** sur `SUM(si.subtotal)` dans le générateur. Nature hors taxes du sous-total de caisse **non vérifiée** (la caisse est réputée sans TVA) : libellé à confirmer. | `report-builder.repository.ts:46` | Basse (supposé) |
| A6 | **Synthèse des ventes : retours non filtrés par magasin.** Les ventes sont filtrées par `store_id`, la soustraction des retours ne l'est pas : en multi-magasin, les retours des autres magasins sont déduits. | `sale.repository.ts:510` contre `518-523` | Moyenne |
| A7 | **Canaux de vente protégés par la section de paramètres « production ».** Incohérent depuis que l'écran est dans le module Ventes. | `sales-channel.routes.ts:13-15` | Basse |
| A8 | **Barème de commission par famille mort-né.** La base accepte `applies_to = 'category'` et documente « product > category > all », mais la route n'accepte que `all` ou `product` et le relevé ignore la famille : une règle par famille insérée en base ne s'appliquerait jamais, sans erreur. | mig 123:47-48, 60-61 ; `commission.routes.ts:20` ; `commission.repository.ts:203` | Basse |
| A9 | **Commissions : double versement possible et base contestable.** L'unicité du versement porte sur la période exacte ; deux périodes qui se chevauchent (1-15 puis 1-31) sont versées deux fois. La base inclut les tickets impayés et n'ôte pas les retours ; elle référence encore le type `special`, retiré (réponse 410). | mig 393:71 ; `commission.repository.ts:215-216, 275` ; `sales.routes.ts:38-40` | Moyenne |
| A10 | **Limite de page non bornée sur les commandes.** `parseInt(limit)` sans plafond ni repli : `?limit=1000000` charge tout, `?limit=abc` envoie `NaN` à la requête. Les routes de lecture des commandes n'ont pas non plus de contrôle de rôle (seulement `authenticate` et la garde de module). | `order.controller.ts:223-226` ; `orders.routes.ts:12-14` | Moyenne |
| A11 | **Code mort : utilitaire de pagination.** `parsePagination` et `paginationToSQL` ne sont importés nulle part. | `server/src/utils/pagination.ts` (recherche des deux noms : aucun autre fichier) | Basse |
| A12 | **Champs personnalisés de commande définissables mais non saisissables.** L'entité `order` est déclarée côté serveur ; aucun composant d'édition dans l'écran des commandes. | `custom-fields.ts:14` ; aucun `CustomFields` dans `client/src/features/orders` | Basse |
| A13 | **Photos de réclamation écrites sur le disque local.** Le même fichier explique que le disque est éphémère en production pour justifier le stockage du logo en base ; les photos de réclamation (et de perte) restent sur disque. Perte en production **supposée**, non vérifiée. | `upload.routes.ts:41-55` | Moyenne (supposé) |
| A14 | **Tests d'intégration ventes non exécutés en intégration continue.** Les suites `db/*.db.test.ts` sont ignorées sans `TEST_DATABASE_URL`, que le flux ne définit pas : `o2c-l0…l6`, `scenarios-ventes`, `promotions-fidelite` (environ 59 tests) ne protègent pas la branche principale. | `.github/workflows/ci.yml:38-46` ; `__tests__/db/helpers.ts:6, 13-14` | Moyenne |
| A15 | **Fuseau codé en dur dans la vue de marge** alors que les contrôleurs utilisent `getUserTimezone()`. | mig 452:106 ; `reports.controller.ts:51` | Basse |
| A16 | **Indicateur « Commandes » de la vue d'ensemble = nombre de tickets** (`sales_count`), pas de commandes clients. | `ReportsOverview.tsx:99, 198` | Basse |
| A17 | **Liste des bons de livraison coupée à 500** sans indication à l'écran ni pagination. | `delivery-note.repository.ts:73` | Basse |
| A18 | **Journal des actions de document : canal `whatsapp` déclaré, jamais alimenté**, et aucun type de pièce de vente. | `document-actions.service.ts:14, 31` | Basse |

---

### Ce qui est vérifié et ce qui est supposé

- **Vérifié dans le code** : tous les statuts du tableau, les preuves `fichier:ligne`, les comptages (tests, appels `authorize`, occurrences « DH » et « fr-FR »), les anomalies A1 à A4, A6 à A12, A14 à A18.
- **Supposé** : la nature hors taxes ou toutes taxes de `sale_items.subtotal` (A5) ; la perte effective des photos en production (A13) ; le calendrier de la facturation électronique marocaine (D7-52) ; le comportement réel de la garde de module selon le mode d'application configuré en base (non lu) ; l'absence de hors-ligne sur mobile repose sur l'absence de code correspondant, sans test de l'application.
- **Non couvert** : exécution des écrans, volumétrie réelle, contenu de la base.

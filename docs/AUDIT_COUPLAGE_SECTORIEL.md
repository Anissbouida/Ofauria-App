# Audit du couplage sectoriel — vers un ERP multi-secteur

> Objectif : rendre Kalum indépendant du métier « boulangerie / pâtisserie » pour
> en faire un ERP multi-secteur (négoce, services, industrie, traiteur…), piloté
> par **packs secteur** plutôt que par des hypothèses codées en dur.
>
> Rédigé le 2026-11-09. Même démarche que `AUDIT_P2P_GAP_ANALYSIS.md` et
> `AUDIT_O2C_GAP_ANALYSIS.md` : constats ancrés (fichier:ligne), cible, plan par lots.

---

## 1. Verdict

**Le moteur transactionnel est déjà sectoriellement neutre.** Les cycles
Order-to-Cash (devis → commande → BL/lots → facture → encaissement → relance),
Procure-to-Pay, la comptabilité CGNC, le CRM, les créances, les projets, le SAV,
la maintenance et les commissions ne portent **aucune** hypothèse boulangerie.

Le couplage « boulangerie/pâtisserie » est **concentré, localisé et surtout
config­urable**, réparti sur 6 foyers :

1. **Rôles codés en dur** (le point dur) ;
2. **Accès aux modules piloté par un map rôle→modules en dur** (pas d'abonnement par tenant) ;
3. **Modules de nature alimentaire** (Production, Recettes, HACCP, Pesage, Contrôle, Invendus) ;
4. **Modèle produit & unités** (enums `saleUnit`, recette ≠ nomenclature générique) ;
5. **Vocabulaire & libellés F&B** (Menu Engineering, entremets, fiche technique, pesage) ;
6. **Données de seed sectorielles** (catégories beldi/viennoiserie, recettes démo).

Aucun de ces foyers n'est dans le cœur O2C/P2P. Le chantier est donc **d'externalisation
de configuration**, pas de réécriture fonctionnelle.

---

## 2. État du socle multi-tenant

| Brique | État | Preuve |
|---|---|---|
| Isolation par tenant (`tenant_id`) | **partielle, présente** | `tenant_id` dans 37 migrations |
| RLS / cloisonnement par magasin | présent, drapeau OFF | `server/src/middleware/rls-scope.middleware.ts`, `RLS_STORE_SCOPE` (mig 436) |
| Table « modules par tenant / abonnement » | **absente** | aucune `tenant_modules`/`company_modules` |
| Notion de **secteur / pack** | **absente** | aucun `sector`, `sector_pack` |
| Accès modules | **map rôle→modules en dur** | `shared/src/constants/modules.ts` `DEFAULT_ROLE_MODULES` (≈ ligne 105) |
| Rôles | **enum `CHECK` en dur** | `server/migrations/001_create_users.sql:9`, `046`, `103` |

Conclusion : l'isolation des données existe, mais **la couche « qui a droit à quoi selon
l'abonnement et le secteur » n'existe pas** — elle est remplacée par des constantes
de code. C'est le vrai verrou multi-secteur.

---

## 3. Inventaire du couplage (par foyer)

### A. Rôles codés en dur  — *sévérité : haute*
- `users.role` est un **`VARCHAR CHECK IN (...)`** avec des rôles métier :
  `server/migrations/001_create_users.sql:9`, étendu `046_add_beldi_sale_role.sql`,
  `103_magasinier_role_and_bsi_workflow.sql`.
- Dupliqué côté partagé : `shared/src/constants/roles.ts` (`BAKER`, `PASTRY_CHEF`,
  `VIENNOISERIE`, `BELDI_SALE`, `SALESWOMAN`, groupes `CHEFS`, `STORE_STAFF`…),
  libellés `ROLE_LABELS` (« Boulanger », « Pâtissier »…).
- Référencé dans l'UI : `client/src/features/sales/SalesPage.tsx:27`,
  `client/src/features/pos/POSPage.tsx:4183/4325` (`ROLE_LABELS_MAP`, `ROLE_COLORS_MAP`).
- Jusque dans des données de seed : `responsable_role: "boulanger"` dans le JSON d'étapes
  de recette (`server/migrations/115_seed_recipes_*.sql`).

➡ Ajouter le métier d'un nouveau secteur impose aujourd'hui **une migration + une édition
de l'enum partagé + du code**. Il faut un **référentiel de rôles** (table), par tenant/pack.

### B. Accès modules piloté par le rôle, en dur  — *sévérité : haute*
- `DEFAULT_ROLE_MODULES` (`shared/src/constants/modules.ts`) mappe chaque rôle à une liste
  de modules figée (`baker: ['stock','recipes','production','replenishment']`, etc.).
- Des permissions **par utilisateur** existent (override), mais **rien par tenant/abonnement**.

➡ Cible : `hasModule = (tenant_modules de l'abonnement) ∩ (permissions du rôle/user)`.
Le map en dur devient une valeur par défaut **du pack**, pas une constante de code.

### C. Modules de nature alimentaire  — *sévérité : moyenne*
Modules intrinsèquement F&B (clés dans `APP_MODULES`) : `production`, `recipes`,
`haccp`, `pesage` (fusionné dans `stock`), `controle`, `unsold`, `forecast`,
`replenishment`.
- Certains ont déjà un **équivalent générique** : le module **Contrôle & Qualité** est
  présenté comme générique multi-industries ; Projets (mig 358), SAV (357), Maintenance
  (359) le sont aussi.
- `recipes` = **nomenclature + gamme** d'un métier de transformation : généralisable en
  **BOM générique** (la recette devient un cas particulier).

➡ Cible : ces modules sont **activés par le pack** (un négoce pur n'active ni Production,
ni HACCP, ni Pesage) et, quand c'est pertinent, **renommés/généralisés** (HACCP → Qualité,
recette → nomenclature).

### D. Modèle produit & unités  — *sévérité : moyenne*
- `products.saleUnit` = **enum** `('unit','weight','person')` :
  `server/src/validators/product.validator.ts:52/217`, `server/migrations/377_*`.
  `'person'` (entremets vendus par part) est pâtisserie ; c'est en réalité une **vente à la
  portion** généralisable (traiteur, événementiel).
- Unités de recette : enums `('g','kg','ml','l','cl','unit')`
  (`recipe-component.validator.ts:10`, `recipe.validator.ts:100`).
- Catégories produit = **référentiel** (table `categories`) → OK architecturalement ; seul
  le **seed** est sectoriel (cf. foyer F).

➡ Cible : **unités d'œuvre en référentiel** (UoM libre : pièce, kg, litre, heure, licence,
m², portion…) au lieu d'enums ; `product.type` générique (bien / service / matière /
abonnement) ; `saleUnit` extensible.

### E. Vocabulaire & libellés F&B  — *sévérité : basse (cosmétique mais visible)*
- « **Menu Engineering** » (matrice popularité × marge) : `server/src/controllers/reports.controller.ts`,
  `client/src/features/reports/ReportsPage.tsx` — concept valable partout mais nommé restauration
  → « Rentabilité produit ».
- « **Entremets par personne** » en caisse : `client/src/features/pos/POSPage.tsx:1065…` → « Vente à la portion ».
- « Fiche technique », « Pesage », « Invendus » : termes métier à neutraliser par pack.
- Placeholders cosmétiques : « Pâtisserie du Coin » (`customers/CustomersPage.tsx:793`),
  « Happy hour viennoiseries » (`promotions/PromotionsPage.tsx:376`).

➡ Cible : **libellés par pack** (terminologie), le code référant des clés neutres.

### F. Données de seed sectorielles  — *sévérité : basse (données, pas logique)*
- Catégories et produits boulangerie semés dans des migrations :
  `server/migrations/130_fix_product_categories.sql` (slugs `beldi`, `patisserie-classique`,
  `patisserie-premium`, `viennoiseries`…), recettes de démo (`115`, `273`, `280-295`…).

➡ Cible : sortir les seeds métier des migrations vers des **packs de données chargeables**
(un tenant « négoce » ne reçoit pas les recettes de croissants).

---

## 4. Architecture cible

```
tenant ──▶ sector_pack (boulangerie | negoce | services | industrie | traiteur…)
   │           ├─ modules activés      → tenant_modules (abonnement)
   │           ├─ référentiels défaut  → rôles, catégories, unités, canaux, motifs
   │           └─ terminologie         → libellés par clé neutre
   │
   ├─ roles (table référentielle, plus d'enum CHECK) ─▶ role_modules (droits)
   └─ users ─▶ permissions = tenant_modules ∩ role_modules (+ override user)
```

Principes :
- **Config-driven, pas enum-driven** : tout ce qui varie par métier sort du code.
- **Non destructif** : le pack « boulangerie » reproduit l'existant à l'identique (aucune
  régression pour Ofauria) ; les autres packs s'ajoutent à côté.
- **Réutiliser le générique déjà là** : Contrôle & Qualité, Projets, SAV, Maintenance,
  tout le cycle O2C/P2P et la compta CGNC n'ont rien à changer.

---

## 5. Plan par lots

| Lot | Contenu | Risque | Dépend de |
|---|---|---|---|
| **L0 — Socle secteur** | Table `sector_packs` + `tenant.sector_pack_id` ; pack « boulangerie » = miroir de l'existant. Non destructif, additif. | faible | — |
| **L1 — Rôles configurables** | `users.role` (enum CHECK) → table `roles` référentielle (par tenant/pack) ; retirer les rôles métier de `shared/constants/roles.ts` ; libellés en base. Touche auth/permissions → tests serrés. | **élevé** | L0 |
| **L2 — Modules par abonnement** | Table `tenant_modules` ; `hasModule` = `tenant_modules ∩ role_modules` ; `DEFAULT_ROLE_MODULES` devient défaut **du pack**, plus une constante. | moyen | L0, L1 |
| **L3 — Catalogue générique** | `product.type` (bien/service/matière/abonnement) ; UoM en référentiel (fin des enums `g/kg/person`) ; BOM générique (recette = cas particulier). Le plus lourd. | **élevé** | L0 |
| **L4 — Modules métier gatés** | Production/Recettes/HACCP/Pesage/Contrôle/Invendus activés par le pack ; généralisation des noms (HACCP→Qualité, recette→nomenclature). | moyen | L0, L2 |
| **L5 — Terminologie par pack** | Libellés F&B → clés neutres + table de libellés par pack (Menu Engineering→Rentabilité produit, entremets→portion, fiche technique→gamme). | faible | L0 |
| **L6 — Packs de données** | Sortir les seeds sectoriels des migrations vers des packs chargeables (catégories, recettes démo). | faible | L0 |

**Chemin critique recommandé** : L0 → L1 → L2 (débloquent le multi-secteur côté droits et
abonnement) ; puis L3 (catalogue, le gros morceau) ; L4–L6 en finition.

---

## 6. Ce qui est DÉJÀ générique (à ne pas toucher)

- Cycle **O2C** complet (devis, commande, BL/lots, facture, avoirs, encaissements, créances,
  relances, lettrage) — cf. `AUDIT_O2C_GAP_ANALYSIS.md`.
- Cycle **P2P** (DA, appels d'offres, BC, réception, facture, SoD) — cf. `AUDIT_P2P_GAP_ANALYSIS.md`.
- **Comptabilité** CGNC, FEC, liasses, lettrage, analytique, consolidation — sectoriellement neutre.
- **CRM**, **Promotions/Fidélité**, **Abonnements**, **Commissions**, **Projets**, **SAV**,
  **Maintenance**, **Contrôle & Qualité** — déjà conçus génériques.

> En clair : ~80 % du produit (dont tout le transactionnel et la finance) est déjà
> multi-secteur. Le chantier porte sur la **couche d'identité métier** (rôles, modules,
> catalogue, vocabulaire), externalisable par packs.

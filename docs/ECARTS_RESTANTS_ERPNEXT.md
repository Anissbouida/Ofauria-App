# Ce qui reste vs ERPNext — bilan à jour

> **Date :** 2026-10-30 · Mise à jour de [COMPARAISON_ERPNEXT.md](COMPARAISON_ERPNEXT.md) après livraison des **9 lots Production** (migrations 396→403).
> **Méthode :** vérification du code actuel (grep ciblé sur les concepts ERPNext) + inventaire des doctypes ERPNext v16.

---

## 0. Ce qui a changé depuis la première comparaison

Les **9 lots Production** ont fermé l'essentiel de l'écart §A6 (Fabrication). Et la vérification du code a montré que **plusieurs « manques » annoncés existaient déjà** — corrections ci-dessous.

### Production — écart quasi refermé ✅

| Écart ERPNext (origine) | Statut | Livré par |
|---|---|---|
| Job Card / exécution d'atelier | 🟢 Fait | Lot 4 (étape = poste + opérateur + pause + tableau live) |
| Co-produits / scrap valorisés | 🟢 Fait | Lot 2 (allocation coût aux sorties de coupe) |
| Explosion multi-niveaux (BOM Explosion Item) | 🟢 Fait | Lot 5 (`v_recipe_explosion`) |
| Outil de remplacement de composant (BOM Update Tool) | 🟢 Fait | Lot 6 (remplacement A→B annulable) |
| Downtime + TRS/OEE | 🟢 Fait | Lot 7 |
| Capacité & charge par poste | 🟢 Fait | Lot 3 |
| Écart MO standard vs réel | 🟢 Fait | Lot 1 |
| MRP → génération des appros | 🟢 Fait | Lot 8 |
| Réglages production paramétrables | 🟢 Fait | Lot 9 |

**Reste en Production (mineur) :** ordonnancement fin par opération (planning type Gantt, `planned_start/end` par opération), **MPS persisté** (la vue Horizon sert de plan directeur ; point 4 différé), **nomenclature fantôme** (phantom BOM), **désassemblage**, **modes de *backflush*** (le pesage reste la règle).

### Corrections — « manques » qui existaient déjà

| Annoncé comme manquant | Réalité vérifiée | Vrai reste |
|---|---|---|
| Non-conformités (QMS) | ✅ Existe (`/quality/nonconformities`) | Boucle QMS complète (action corrective → revue → réunion → objectif) |
| Contrôle qualité à réception | ✅ Templates + inspections (mig 384) | Lien **structurel** à la réception + blocage ; aujourd'hui `reference_note` est du texte libre |
| Rapprochement bancaire | ✅ `bank_statements` + lignes | **Import** de relevé (CSV/MT940) + **règles** de correspondance auto |
| Lettrage | ✅ `lettrage_id` sur les écritures | **Outil** d'allocation auto paiement↔factures multi-lignes |

---

## 1. Ce qui manque VRAIMENT (vérifié absent dans le code)

### Transversal — les plus structurants
- 🔴 **Moteur de workflow générique** (états → transitions → rôles sur tout document). *Vérifié : 0.*
- 🔴 **Dimensions analytiques génériques** (`accounting_dimension`). On a centres de coûts (386) + projet (390), pas de dimension libre. *0.*
- 🔴 **Scan code-barres** (stock + caisse). *0.*
- 🔴 **Multi-société / inter-sociétés / consolidation**. *0.* (le chantier SaaS multi-tenant est un autre axe)
- 🔴 **Webhooks sortants** / API publique. *0.* (on a e-mail + jobs planifiés mig 364)
- 🔴 **Incoterms**. *0.*

### Stock
- 🔴 **Variantes génériques** (matrice d'attributs couleur/taille). On gère les *formats*. *0.*
- 🔴 **N° de série** sur le stock (on trace par lots). *Le `serial_no` du code est celui des équipements de maintenance, pas du stock.*
- 🔴 **Colisage / pick list / expédition transporteur** (`packing_slip`, `pick_list`, `shipment_parcel`). On a bons de livraison + tournées. *0.*
- 🟡 **Contrôle qualité à réception bloquant** : le module existe, pas l'intégration au flux réception.

### Achats / Ventes
- 🔴 **Commande-cadre (blanket order)** achats et ventes. *Les « contrat-cadre » du code = commissions, pas blanket.*
- 🔴 **Règles d'expédition** (frais de port par palier/pays). *0.*

### Fabrication (reste mineur)
- 🔴 **Nomenclature fantôme** (phantom BOM) · **désassemblage** · **backflush** · **ordonnancement par opération** · **MPS persisté**.

### Comptabilité
- 🔴 **Clôture de période verrouillable** (`period_closing_voucher`, `accounting_period`). *0.*
- 🔴 **Réévaluation de change** (`exchange_rate_revaluation`). *0.*
- 🟡 **Lettrage auto** (outil) · **import relevé bancaire + règles** · **budget** avec distribution mensuelle + blocage au dépassement (mig 317 sans ces options).
- 🔴 **Produits constatés d'avance** (on a les CCA charges, mig 380) · **escompte d'effets / caution** · **actionnariat**.

### Sous-traitance
- 🔴 **Module sous-traitance de fabrication** entièrement absent. *Les « façonnage » du code = étape de pétrissage.*

### Autres modules (profondeur)
- 🟡 **Immobilisations** : cycle de vie partiel (manque capitalisation, cession/rebut, réparation capitalisable, plans parallèles).
- 🟡 **Projets** : feuilles de temps + marge/rentabilité projet consolidée.
- 🟡 **CRM** : prise de RDV en ligne, contrats, campagnes e-mail automatisées.

---

## 2. Priorités conseillées (hors Production, désormais mûr)

| Priorité | Chantier | Pourquoi |
|---|---|---|
| **P0** | Moteur de **workflow générique** | Débloque tous les circuits de validation |
| **P0** | **Dimensions analytiques** génériques | Pilotage multi-axes, base de reporting |
| **P1** | **Scan code-barres** (caisse + inventaire) | Vitesse/fiabilité terrain |
| **P1** | **Clôture de période** verrouillable | Intégrité comptable, audits |
| **P1** | **Contrôle qualité à réception** (lien + blocage) | Le module existe déjà, il reste à le brancher |
| **P2** | **Lettrage auto** + **import relevé bancaire** | Les socles existent (lettrage_id, bank_statements) |
| **P2** | **Immobilisations** — cycle complet | Conformité patrimoniale |
| **P3** | **Sous-traitance** · **commande-cadre** · **variantes/n° série** | Selon besoins métier à venir |

---

## 3. À retenir

- **Production : à parité ERPNext** sur l'essentiel après les 9 lots (reste des points fins : ordonnancement, MPS, backflush).
- Les écarts majeurs restants sont **transversaux** (workflow, dimensions, multi-société, code-barres), pas métier.
- Ofauria conserve ses **atouts qu'ERPNext n'a pas** : pesage, nomenclature par format, CMUP, invendus, contrôle des ventes, paie Maroc + Damancom, traçabilité/rappel de lot.

### Réserve
Bilan fondé sur une vérification par recherche de code + l'inventaire des doctypes ERPNext, pas sur une lecture ligne à ligne. Les items 🟡 (« existe mais partiel ») méritent une confirmation ciblée avant chiffrage.

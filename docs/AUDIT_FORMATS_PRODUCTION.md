# Audit du module Formats de production — comparaison aux standards ERP

*Audit réalisé le 11/08/2026 — périmètre : modèle de données (migrations 082, 157→223), vues de coût (`v_recipe_format_cost` v3, `v_recipe_total_cost` récursive, `v_recipe_compose_cost`, `v_recipe_format_summary`), calcul des besoins (`recipe-composition.helper.ts` + 13 tests), plans multi-format (`production.repository.ts`), coût réel (mig 090). Référentiels comparés : SAP PP/PP-PI, Odoo MRP, Microsoft Dynamics 365 BC, Sage X3, et les verticaux boulangerie (Cybake, FlexiBake, BakeSmart).*

---

## Synthèse

Le module formats est **conceptuellement au niveau d'un ERP de milieu de gamme**, ce qui est remarquable pour un outil interne. Trois choix de conception sont exactement ceux du marché :

1. **Le mode `ratio_poids` est une gestion de co-produits** (une pâte → 3 moules moyens + 3 petits) avec ventilation du coût au prorata du poids — c'est le mécanisme des « coefficients d'équivalence » de SAP PP-PI, que ni Odoo Community ni la plupart des petits outils ne savent faire.
2. **La nomenclature par format** (`recipe_format_components`, mig 200) équivaut à « une BOM par variante d'article » — le modèle SAP/X3, là où Odoo ne le fait proprement que depuis la v15 (BOM « apply on variants »).
3. **Le double costing standard/réel** (vues de coût théorique vs `production_cout_reel`) est la structure de base du contrôle de gestion industriel (coût standard, coût constaté, écarts).

En face, trois écarts structurels avec les standards :

1. **Un format n'est pas un article vendable.** Dans tous les ERP, chaque variante vendue est un SKU avec son prix tarif ; ici `recipe_formats` n'a **aucun lien** vers `products` ni `product_channel_pricing`. Le `prix_vente_unitaire` de la vue est purement indicatif : rien ne garantit qu'il corresponde au prix réellement pratiqué au POS. Deux référentiels de prix peuvent diverger silencieusement.
2. **Trois sources de nomenclature coexistent** (`recipe_ingredients`/`recipe_sub_recipes` legacy, `recipe_components` miroir, `recipe_format_components`) avec une logique de synchronisation applicative. Les ~20 migrations de rattrapage (201, 217→223, dont deux « reactivate_orphaned_formats ») montrent le coût de cette période transitoire. Un ERP n'a qu'une seule table de BOM.
3. **Aucun historique de modification de nomenclature.** `updated_at` seul ; pas de qui/quoi/quand. SAP a l'ECM, Odoo le PLM, X3 les versions de nomenclature. Vu l'exigence de traçabilité produit (audits, normes) déjà actée pour les lots, la BOM devrait être auditée aussi : un coût qui change doit être explicable a posteriori.

Points forts à préserver : contrainte XOR sur la source d'un composant, index uniques partiels pour la coexistence legacy/multi-format (analogie Oracle : index unique sur expression avec `CASE`), anti-cycle + garde de profondeur + warnings remontés jusqu'au plan, conversion d'unités avec densité et drapeau d'incertitude, priorité claire des overrides de prix, backfills idempotents avec note d'inversion, 13 tests sur le helper de composition.

---

## 1. Rappel du modèle (ce qui existe)

| Brique | Table / vue | Migration | Équivalent ERP |
|---|---|---|---|
| Contenant (moule, cadre, Ø) | `production_contenants` | 082 | Ressource / outillage (tooling) |
| Format d'une recette | `recipe_formats` (poids engagé, nb par fournée, emballage, parts, cru/cuit) | 157, 162, 199 | Variante d'article / co-produit |
| Format par défaut | `is_default` + index unique partiel | 199, 201 | Variante principale |
| BOM par format | `recipe_format_components` (recette XOR ingrédient, rôle, qté, unité) | 200 | Nomenclature de variante |
| Coût théorique par format | `v_recipe_format_cost` v3 (matière + MO + énergie + structure + emballage, overrides prix/marge) | 162→170 | Calcul de coût standard (CK11N chez SAP) |
| Coût composé récursif | `v_recipe_total_cost` (profondeur ≤ 12) | 204 | Éclatement multi-niveaux de BOM |
| Contrôle poids engagé vs produit | `v_recipe_format_summary` (perte_kg, perte_pct) | 162 | Bilan matière (PP-PI material quantity calculation) |
| Plan multi-format | `production_plan_items.format_id` (opt-in, NULL = legacy) | 161 | Ordre de fabrication par variante |
| Besoins (calcul inverse) | `recipe-composition.helper.ts` — source unique, compose→fallback legacy | — | Éclatement MRP |
| Coût réel | `production_cout_reel`, équipements, temps travail | 090 | Coût constaté de l'ordre |
| Rendement | `production_rendement`, `v_plan_item_rendement` | 089, 163 | Yield / scrap d'opération |

Deux modes de coût par recette (`mode_cout`) :
- **`ratio_poids`** (défaut) : le coût total de la fournée est ventilé sur les formats au prorata de leur poids engagé (`quantite_par_format × nb_par_defaut`). Co-produits.
- **`compose`** : chaque format a sa propre nomenclature (une tartelette n'est pas une Ø28 réduite). Assemblages.

---

## 2. Comparaison détaillée aux standards

### Là où le module est au niveau (ou au-dessus) du marché

**F1. Co-produits au prorata du poids** — la ventilation à 100 % du coût de fournée sur les formats déclarés (perte incluse, donc coût plein absorbé) est le comportement SAP par défaut. Odoo Community ne gère pas les co-produits (module by-products d'Enterprise seulement, sans ventilation paramétrable). Les verticaux boulangerie (Cybake, FlexiBake) font du « recipe scaling » mais rarement du coût par format simultané.

**F2. BOM par variante avec rôles** — `role` référencé souplement sur `ref_entries` (component_roles) ≈ les « BOM item categories » SAP. La contrainte `chk_rfc_one_source` (recette XOR ingrédient) est plus stricte que le modèle Odoo où le composant est toujours un produit.

**F3. Overrides de prix par format avec priorité documentée** (prix forcé > marge spécifique > marge recette, puis arrondi commercial `apply_price_rounding`, mig 170) — c'est une mini-liste de prix. Le marché fait pareil (price lists), en plus lourd.

**F4. Garde-fous de récursion** — anti-cycle par chemin, `MAX_DEPTH 12` aligné entre la vue SQL et le helper TypeScript, warnings poussés dans `plan.warnings` jusqu'à l'UI. Beaucoup d'ERP se contentent d'une erreur technique.

**F5. Poids cru/cuit** (mig 199) — la perte de cuisson par format est un concept que seuls les verticaux agro (X3 process, Infor food) modélisent nativement.

### CRITIQUE

**A1. Les formats ne sont pas reliés aux articles vendus** — `recipe_formats` sans FK vers `products` ; aucune occurrence de « format » dans `product-channel-pricing.repository.ts` ni `product.repository.ts`.
Le standard ERP : *chaque chose vendue est un article* (SKU), la variante de production et la variante de vente sont le même objet ou sont liées. Ici le cake 300 g et le cake 600 g coûtés par la vue peuvent être vendus au POS sous un produit unique — ou deux produits dont les prix ont été saisis à la main sans lien avec `prix_vente_unitaire`. Conséquences : les marges réelles par format sont inconnaissables ; une mise à jour de coût matière ne remonte jamais jusqu'au prix pratiqué ; le rapprochement ventes/production par format est impossible.
→ **Reco** : ajouter `recipe_formats.product_id` (nullable, FK), afficher l'écart prix calculé vs prix POS dans l'UI formats, et à terme faire du prix POS un consommateur (avec validation humaine) du prix format.

**A2. Trois sources de nomenclature et une synchronisation applicative** — le commentaire du helper le dit lui-même : la sauvegarde d'une composition **vide** `recipe_ingredients` + `recipe_sub_recipes`, et `recipe_components` est maintenu comme **miroir** du format par défaut pour ne pas toucher `v_recipe_total_cost`. C'est une bascule inachevée : chaque nouveau consommateur de nomenclature doit connaître la règle « compose → format → recipe_components → legacy » (4 chemins de lecture dans `getCompositionForNeeds`). Les migrations 222 puis 223 (« v2 ») pour réactiver des formats orphelins montrent que l'état intermédiaire produit déjà des données incohérentes.
→ **Reco** : planifier la fin de la bascule — tout produit en `compose`, `recipe_components` supprimé (la vue lit directement le format par défaut), `recipes.contenant_id` retiré (déjà « deprecated » depuis la mig 157). Analogie Oracle : c'est le passage d'un synonyme + trigger de compat vers la table cible unique.

### MAJEUR

**A3. `fn_unit_conv` retourne 1 en silence pour des unités incompatibles** — mig 203, `ELSE 1`. Un composant saisi en `unit` (pièce) d'une recette de base dont le rendement est en `kg` → facteur 1 → coût et besoins faux **sans aucun signal** dans les vues (le helper TS, lui, pose `conversionUncertain` mais seulement pour poids↔volume sans densité).
→ **Reco** : soit étendre le drapeau d'incertitude aux couples incompatibles (unit↔masse/volume), soit interdire à la saisie un composant dont l'unité n'est pas convertible vers celle de la cible.

**A4. Densité 1 codée en dur dans la conversion du poids de format** — mig 162 convertit `ml`→`g` avec densité 1 « approximation standard en pâtisserie », alors que la mig 227 a introduit `ingredients.densite_kg_l` et que `fn_unit_conv` sait la prendre en 3ᵉ argument. Une crème à 1,05 ou un sirop à 1,3 faussent le prorata des co-produits.
→ **Reco** : le poids de format étant celui d'une **pâte** (pas d'un ingrédient), ajouter une densité optionnelle sur `recipe_formats` (ou sur la recette) utilisée par la vue ; défaut 1 conservé.

**A5. Pas de rebut par ligne de composant** — la perte n'existe qu'au niveau recette de base (`perte_standard_pct`, majoration brut/net dans le helper et la vue 203). Le standard (SAP « component scrap », Odoo « waste % » sur ligne de BOM, X3 « % perte ») met aussi le rebut sur la ligne : 5 % de casse sur les fonds de tarte à l'assemblage, 2 % de coulage sur le nappage. Aujourd'hui ces pertes-là sont invisibles du coût théorique et gonflent les écarts du coût réel sans explication.
→ **Reco** : colonne `perte_pct` sur `recipe_format_components`, appliquée en majoration brut comme pour les recettes de base.

**A6. Aucune trace d'audit sur la nomenclature** — pas de table d'historique, pas de `updated_by`. La mémoire projet exige la traçabilité complète du cycle produit pour les audits/normes ; le coût d'un produit est recalculé en live par les vues, donc **changer une quantité de composant réécrit le passé** (un plan clôturé recosté aujourd'hui ne redonnera pas le coût d'hier).
→ **Reco** : (a) trigger d'audit léger sur `recipe_format_components` / `recipe_formats` (INSERT/UPDATE/DELETE → table `bom_audit` avec diff JSONB, analogie : trigger `FOR EACH ROW` alimentant une table `_JN` comme le journaling Designer) ; (b) figer le coût théorique **au lancement du plan** (snapshot sur `production_plan_items`), comme le fait déjà `production_cout_reel` pour le réel — c'est l'équivalent du « standard cost estimate » daté de SAP.

**A7. Le coût d'une recette utilisée comme sous-recette est toujours celui du format par défaut** — `v_recipe_total_cost` (mig 204) ne développe que la BOM du format `is_default`. Si un entremets consomme le « biscuit — cadre 60×40 » alors que le format par défaut du biscuit est « Ø16 », le coût pris est celui du Ø16. Approximation raisonnable tant que les compositions par format ne divergent que sur les quantités, fausse dès qu'elles divergent sur les composants.
→ **Reco** : accepter l'approximation mais l'afficher (badge « coûté sur format par défaut » dans la Tree View de composition), ou permettre de cibler un format précis dans `recipe_format_components.source_format_id`.

### MINEUR

**A8. `quantite_par_format_g` mal nommée** — contient des kg/ml/l selon `quantite_par_format_unite` (reconnu dans le COMMENT de la mig 162). Dette cosmétique mais chaque nouveau lecteur doit lire le commentaire pour ne pas se tromper.
→ **Reco** : renommer en `quantite_par_format` à l'occasion d'une migration de toute façon lourde (A2).

**A9. Contenant obligatoire → contenant placebo** — `contenant_id NOT NULL` a imposé le contenant générique « Assemblage (format à définir) » à id figé (mig 201). Le référentiel contenants est pollué par un non-contenant, et l'UI doit le traiter à part.
→ **Reco** : rendre `contenant_id` nullable (un format d'assemblage n'a pas de moule) et supprimer le placebo une fois les formats requalifiés.

**A10. Le prorata co-produits est figé sur le mix par défaut** — `nb_par_defaut` détermine `ratio_poids` ; si un plan lance 6 moyens + 0 petits, le coût unitaire théorique reste celui du mix standard. SAP recalcule la ventilation sur les quantités réelles de l'ordre. Le coût réel (mig 090) rattrape partiellement, mais l'écart standard/réel embarque alors un « écart de mix » non isolé.
→ **Reco** : dans `CoutReelPanel`, ventiler le coût réel matière au prorata des quantités **réellement produites** par format (données déjà présentes dans `production_plan_items`), et nommer l'écart de mix.

**A11. Pas de dates d'effet sur les formats/BOM** — les ERP gèrent « valide du/au » (recette d'été/d'hiver, changement fournisseur planifié). Ici `is_active` seulement. Acceptable à cette échelle ; à garder en tête si la saisonnalité des recettes devient réelle.

---

## 3. Tableau de correspondance ERP

| Concept marché | SAP PP/PP-PI | Odoo MRP | Sage X3 | **Ofauria** |
|---|---|---|---|---|
| Variante = article vendable | Oui (matériau par variante) | Oui (variants) | Oui | **Non** (A1) |
| BOM par variante | Oui | Partiel (apply on variants) | Oui | **Oui** (mig 200) |
| Co-produits + ventilation | Oui (coeff. équivalence) | Enterprise, limité | Oui | **Oui, au poids** (ratio_poids) |
| Rebut par ligne de BOM | Oui | Oui | Oui | **Non** (A5) |
| Perte de process (cuisson) | PP-PI | Non | Process | **Oui** (cru/cuit, mig 199) |
| BOM multi-niveaux récursive | Oui | Oui | Oui | **Oui, prof. ≤ 12** (mig 204) |
| Versions / dates d'effet BOM | ECM | PLM | Oui | **Non** (A6, A11) |
| Coût standard daté (figé) | Oui (estimate) | Non (coût courant) | Oui | **Non** — vues live (A6b) |
| Coût réel par ordre | Oui | Oui | Oui | **Oui** (mig 090) |
| Écarts standard/réel décomposés | Oui (prix/qté/mix) | Sommaire | Oui | **Partiel** (A10) |
| Conversion d'unités + densité | Oui | Basique | Oui | **Oui, avec trous** (A3, A4) |
| Prix par variante + arrondi | Listes de prix | Listes de prix | Oui | **Oui** (overrides + mig 170) |

---

## 4. Recommandations priorisées

**P0 — intégrité des chiffres**
1. A3 : signaler (ou bloquer) les conversions d'unités incompatibles dans les vues de coût.
2. A1 (première marche) : FK optionnelle `recipe_formats.product_id` + affichage de l'écart prix calculé / prix POS. Aucun automatisme de prix au départ — juste rendre la divergence visible.
3. A6b : snapshot du coût théorique au lancement du plan (le coût réel a déjà sa table ; il manque le point de comparaison figé).

**P1 — conformité et justesse**
4. A6a : trigger d'audit sur `recipe_formats` + `recipe_format_components` (exigence traçabilité).
5. A5 : `perte_pct` par ligne de composant.
6. A4 : densité sur le poids de format.
7. A2 (préparation) : inventorier les lecteurs restants du legacy (`recipe_ingredients`/`recipe_sub_recipes`/`recipe_components`) pour chiffrer la fin de bascule.

**P2 — finitions**
8. A2 (exécution) : bascule finale, suppression du miroir et de `recipes.contenant_id`.
9. A9 : `contenant_id` nullable, retrait du contenant placebo.
10. A10 : écart de mix dans le coût réel.
11. A7 : badge « coûté sur format par défaut » dans la composition.
12. A8 : renommage `quantite_par_format`.

---

## 5. Conclusion

Le module n'a pas à rougir de la comparaison : co-produits, BOM par variante, coût complet (matière + MO + énergie + structure + emballage), récursivité gardée, double costing — la **structure** est celle d'un ERP. Les écarts sont concentrés sur deux thèmes : la **jonction avec la vente** (un format devrait finir en article, sinon le prix calculé ne sert qu'à décorer) et la **mémoire** (pas d'audit de BOM, pas de coût figé — le système sait ce que les choses coûtent *aujourd'hui*, jamais ce qu'elles coûtaient *le jour du plan*). Ces deux thèmes sont aussi les prérequis des audits de traçabilité déjà identifiés comme exigence du projet. La dette transitoire (3 sources de nomenclature) est bien documentée dans le code lui-même — elle doit maintenant être soldée avant que de nouveaux consommateurs s'y accrochent.

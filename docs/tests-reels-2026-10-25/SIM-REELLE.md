# Simulation réaliste — 2026-10-25

Dans le magasin principal **Ofauria Mohammédia**, avec de vraies entités : fournisseur **Orientines**, ingrédient **Farine Soisson**, produit **Baguette Tradition**, employée **Fatima Zahra**. Aucun nom codé.

- **Achats** — bon de commande à Orientines (Farine Soisson 25 kg à 3,55 DH) envoyé.
- **Production** — plan de 30 Baguette Tradition, BSI-261025-006 pesé (Farine Soisson) et produit — lot fini en réserve.
- **Approvisionnement** — 20 Baguette Tradition passées en vitrine.
- **Caisse (ouverture)** — caisse ouverte (fond 300 DH).
- **Ventes** — vente VNT-20261025-0007 de 4 Baguette Tradition (FEFO vitrine).
- **Ventes (retour)** — retour de 1 Baguette Tradition (lot d'origine recrédité).
- **Caisse (shift + clôture)** — passation puis clôture fin de journée.
- **Personnel** — employée Fatima Zahra embauchée et planifiée ce jour.
- **Contrôle (pertes)** — 2 Baguette Tradition en perte valorisées à 1.77 DH/u (coût matières réel).

## Nettoyage des anciens noms codés
Les entités de test des exécutions précédentes portaient des noms codés (`SIMFournisseur mvnzzgs5zx1c3`, `SIMBaguette …`, `QABaguette …`, `VERIFPain …`). Renommées en libellés lisibles, sans suppression ni perte de lien : **6 fournisseurs** → `Fournisseur d'essai 1…6` ; **10 produits** → `Baguette d'essai 1…7`, `Croissant d'essai 1…2`, `Pain d'essai 1`. Plus aucun code dans les écrans (vérifié : 0 produit / 0 fournisseur codé).

## Limite — 5 magasins de simulation non supprimables
5 magasins `SIMULATION …` subsistent. Leur suppression est **bloquée par l'audit comptable en ajout-seul** (triggers `po_no_delete` / `purchasing_master_audit_append_only` sur leurs bons de commande), que je ne contourne pas. Retrait possible uniquement par les flux de l'app (annulation) ou par toi, hors de la piste d'audit.

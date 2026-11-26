-- 721 — Mentions de documents par profil (feuille de route, étape 3.6).
--
-- Couche « document_mentions » du contenu de profil (industry-profile.ts) : mention de pied
-- des devis, factures et bons de commande propre au métier. À l'activation, elle n'est posée
-- que si la société n'a encore saisi aucune mention pour ce document (rien n'est écrasé).
-- Formulations générales, à adapter par chaque société (conditions de son marché, de son
-- contrat de transport, de son autorisation pharmaceutique).

UPDATE sector_packs SET profile = jsonb_set(COALESCE(profile, '{}'::jsonb), '{document_mentions}', '[
  {"doc_type": "quote", "footer_note": "Devis établi par lots et ouvrages. Retenue de garantie et avance de démarrage selon les conditions du marché."},
  {"doc_type": "invoice", "footer_note": "Facture établie sur situation de travaux validée. Retenue de garantie et remboursement de l''avance déduits conformément au marché."}
]'::jsonb)
 WHERE code = 'btp' AND NOT (COALESCE(profile, '{}'::jsonb) ? 'document_mentions');

UPDATE sector_packs SET profile = jsonb_set(COALESCE(profile, '{}'::jsonb), '{document_mentions}', '[
  {"doc_type": "quote", "footer_note": "Prix calculés selon la grille tarifaire en vigueur ; minimum de facturation applicable."},
  {"doc_type": "invoice", "footer_note": "Prestation facturée sur preuve de livraison signée. Responsabilité du transporteur selon les conditions générales de transport."}
]'::jsonb)
 WHERE code = 'transport' AND NOT (COALESCE(profile, '{}'::jsonb) ? 'document_mentions');

UPDATE sector_packs SET profile = jsonb_set(COALESCE(profile, '{}'::jsonb), '{document_mentions}', '[
  {"doc_type": "invoice", "footer_note": "Numéros de lot et dates de péremption indiqués sur le bon de livraison correspondant."}
]'::jsonb)
 WHERE code = 'sante' AND NOT (COALESCE(profile, '{}'::jsonb) ? 'document_mentions');

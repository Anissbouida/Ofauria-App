-- Rythme de production, canal de vente principal, organisation du stock.
-- Valeurs initiales neutres : canal multicanal (accueil du secteur inchangé), stock par
-- établissement (achats inchangés), rythme artisanal enregistré sans être appliqué (le
-- rythme ne règle horizon et capacité que lorsqu'il est modifié).
INSERT INTO module_parameters (key, value, description) VALUES
  ('production.rhythm', '{"mode": "artisanal"}',
   'Rythme de production : règle l''horizon du plan directeur et le contrôle de capacité quand il change.'),
  ('sales.channel', '{"channel": "multi"}',
   'Canal de vente principal : écran d''accueil « Selon le secteur ».'),
  ('stock.organization', '{"mode": "per_store"}',
   'Organisation du stock : par établissement ou centralisée (achats livrés au dépôt central).')
ON CONFLICT (key) DO NOTHING;

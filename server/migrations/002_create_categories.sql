CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  display_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default categories
INSERT INTO categories (name, slug, description, display_order) VALUES
  ('Pains', 'pains', 'Pains traditionnels et spéciaux', 1),
  ('Viennoiseries', 'viennoiseries', 'Croissants, pains au chocolat, brioches...', 2),
  ('Pâtisseries', 'patisseries', 'Tartes, éclairs, mille-feuilles...', 3),
  ('Gâteaux', 'gateaux', 'Gâteaux sur commande et en vitrine', 4),
  ('Gâteaux sur mesure', 'gateaux-sur-mesure', 'Gâteaux personnalisés pour événements', 5),
  ('Spécialités de saison', 'specialites-saison', 'Créations saisonnières', 6);

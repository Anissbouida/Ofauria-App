-- Catalogue de relations ; les lecteurs historiques restent en place pendant la comparaison.
CREATE TABLE IF NOT EXISTS module_relations (
  module text NOT NULL, related text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('requires','conflicts','recommends')),
  reason text,
  PRIMARY KEY (module,related,kind), CHECK (module <> related)
);
INSERT INTO module_relations(module,related,kind) VALUES
 ('production','recipes','requires'), ('production','stock','requires'), ('recipes','production','requires'),
 ('unsold','production','requires'), ('replenishment','production','requires'), ('reconciliation','pos','requires')
ON CONFLICT DO NOTHING;

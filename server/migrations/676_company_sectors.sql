-- Activité principale historique + activités complémentaires cumulables.
CREATE TABLE IF NOT EXISTS company_sectors (
  sector_code varchar(40) PRIMARY KEY REFERENCES sector_packs(code) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS company_sectors_one_primary ON company_sectors(is_primary) WHERE is_primary;
INSERT INTO company_sectors(sector_code,is_primary) SELECT sector_pack,true FROM company_settings WHERE id=1 ON CONFLICT(sector_code) DO NOTHING;
CREATE OR REPLACE FUNCTION sync_company_primary_sector() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id=1 THEN
    DELETE FROM company_sectors WHERE is_primary AND sector_code<>NEW.sector_pack;
    INSERT INTO company_sectors(sector_code,is_primary) VALUES(NEW.sector_pack,true)
      ON CONFLICT(sector_code) DO UPDATE SET is_primary=true;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS company_settings_primary_sector ON company_settings;
CREATE TRIGGER company_settings_primary_sector AFTER INSERT OR UPDATE OF sector_pack ON company_settings
FOR EACH ROW EXECUTE FUNCTION sync_company_primary_sector();
DROP TRIGGER IF EXISTS company_sectors_config_audit ON company_sectors;
CREATE TRIGGER company_sectors_config_audit AFTER INSERT OR UPDATE OR DELETE ON company_sectors
FOR EACH ROW EXECUTE FUNCTION log_config_change('sector_code','');

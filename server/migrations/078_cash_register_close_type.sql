-- Add close_type to distinguish shift handover from end-of-day closing
ALTER TABLE cash_register_sessions
  ADD COLUMN IF NOT EXISTS close_type VARCHAR(20) DEFAULT 'fin_journee';

COMMENT ON COLUMN cash_register_sessions.close_type IS 'passation = shift handover (inventory only), fin_journee = end of day (inventory + unsold decisions)';

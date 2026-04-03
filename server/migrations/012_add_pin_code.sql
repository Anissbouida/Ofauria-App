ALTER TABLE users ADD COLUMN pin_code VARCHAR(10) UNIQUE;
CREATE INDEX idx_users_pin_code ON users(pin_code);

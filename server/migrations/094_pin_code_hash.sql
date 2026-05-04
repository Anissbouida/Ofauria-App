-- Extend pin_code column to store bcrypt hashes (60 chars)
ALTER TABLE users ALTER COLUMN pin_code TYPE VARCHAR(255);

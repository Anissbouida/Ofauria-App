-- Migration 039: Add attachment support to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS attachment_url TEXT;

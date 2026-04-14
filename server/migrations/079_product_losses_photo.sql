-- Add photo_url column to product_losses for damage evidence photos
ALTER TABLE product_losses
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

COMMENT ON COLUMN product_losses.photo_url IS 'URL of the photo evidence taken by cashier for damaged/lost products';

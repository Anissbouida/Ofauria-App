-- Promote "Emballages" from level-2 (under Matières premières) to level-1 category
-- Its 5 children (Boites, Sacs, Etiquettes, Papier boulanger, Ficelles) become level-2

-- Step 1: Promote Emballages to level-1 (insert new level-1 record, reuse same ID logic)
-- We'll repurpose the existing level-2 record: change its level to 1, remove parent_id, set display_order

UPDATE expense_categories
SET level = 1,
    parent_id = NULL,
    display_order = 10
WHERE id = '20000000-0000-0000-0000-000000000005';

-- Step 2: Promote its 5 children from level-3 to level-2 (parent stays the same)
UPDATE expense_categories
SET level = 2
WHERE parent_id = '20000000-0000-0000-0000-000000000005';

-- Step 3: Shift Divers to display_order 11 (was 9, now after Emballages)
UPDATE expense_categories
SET display_order = 11
WHERE id = '10000000-0000-0000-0000-000000000009';

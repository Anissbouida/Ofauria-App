-- =============================================================================
-- Inventaire physique du 05/08/2026 (comptage partiel : 36 articles)
-- =============================================================================
--
-- Cale inventory.current_quantity sur le comptage physique et trace l'ecart
-- dans inventory_transactions (type 'adjustment').
--
-- PARTIEL : contrairement a l'inventaire du 06/07, les articles NON comptes ne
-- sont PAS remis a zero. Seuls les articles listes ci-dessous sont touches.
--
-- Doublons de referentiel : quand plusieurs fiches designent le meme article
-- physique, la quantite comptee est portee sur la fiche principale (celle qui
-- recoit les achats) et les fiches doublons sont remises a zero.
--
-- NON TRAITE : "Chocovic 9 kg" du comptage. Le referentiel ne contient que
-- "Beurre de cacao chocovic" (3 kg) qui n'est pas le meme produit. La fiche
-- article doit etre creee avant de pouvoir enregistrer ce comptage.
--
-- Idempotent : ne fait rien si l'inventaire du 2026-08-05 est deja enregistre.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_user_id  UUID := '51db7208-56cc-4ab9-a047-f9ea049f08f8';  -- meme operateur que le 06/07
  v_store_id UUID := '00000000-0000-0000-0000-000000000001';
  v_date     DATE := '2026-08-05';
  r          RECORD;
  v_current  NUMERIC;
  v_delta    NUMERIC;
  v_count    INT := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM inventory_transactions
    WHERE type = 'adjustment' AND note LIKE 'Inventaire physique 2026-08-05%'
  ) THEN
    RAISE NOTICE 'Inventaire 2026-08-05 deja enregistre — aucune action.';
    RETURN;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      -- (ingredient_id, quantite comptee, libelle)
      ('2cbaa3f6-9dbf-469d-87ad-49e782b58dc5'::uuid,  20.0, 'Levure'),
      ('44410d21-6116-475e-96df-70dfe63477c2'::uuid,   5.0, 'Mozzarella'),
      -- Beurre : fiche principale + doublon
      ('bdb4990f-3bfa-4030-a785-7fa2a6321c1c'::uuid, 140.0, 'Beurre'),
      ('f81631d2-eea3-4bb1-8015-3406c2f03fdd'::uuid,   0.0, 'Beurre (doublon)'),
      ('a99b39e5-071a-44b0-bac6-c81be981d180'::uuid,   6.0, 'Batons boulangers DGF (boites)'),
      ('a54fb9d1-693a-43c5-b8d7-62b303e44bc2'::uuid,   5.0, 'Ameliorant viennoiserie (seaux)'),
      ('82c859d3-3954-4f02-aec3-7f014fd3c352'::uuid,  12.0, 'Tegral chocolat'),
      ('3fb93227-db65-49cb-a650-ea4c6c582525'::uuid,   9.0, 'Tegral neutre/vanille'),
      ('541b8e39-9447-417a-afb5-3d3454467b82'::uuid,   1.0, 'Gelatine (boite)'),
      -- Raisin
      ('116670c1-9826-4248-a1fb-58ee856285a0'::uuid,  20.5, 'Raisin'),
      ('b185fab4-7a38-47a7-a810-9488b5992909'::uuid,   0.0, 'Raisins secs golden (doublon)'),
      -- Chocolat de couverture VHP (Van Houten)
      ('09015d0a-1081-4350-a184-c0957be74861'::uuid,   2.5, 'Choc. couv. VHP blanc'),
      ('ae5a5d14-b732-49e9-9557-1c40beda694e'::uuid,   0.0, 'Choc. blanc ven hoten (doublon)'),
      ('f371e612-8fba-4d34-9581-ac8c3264c225'::uuid,   5.0, 'Choc. couv. VHP noir'),
      ('e9f0188f-2dd5-4497-862e-842c7c7c2706'::uuid,   0.0, 'Choc. couv. noir VHP (doublon)'),
      ('9acb3a44-9a42-4028-a1c9-9e94b8739263'::uuid,   0.0, 'Choc. couv. VHP lait'),
      ('212ffa51-a7d8-470c-b7c4-0483475821ab'::uuid,   0.0, 'Choc. couv. lait VHP (doublon)'),
      -- Drops
      ('71fcdde7-0ad6-404c-9959-1d041bb39960'::uuid,   9.0, 'Gouttes drops 50% DGF'),
      ('b00af037-812d-4796-978a-2aa7056a0413'::uuid,   0.0, 'Gouttes Drops 44% (doublon)'),
      -- Chocolat de couverture DGF
      ('c6eefed6-56c2-4a06-9742-9f50bfa1868c'::uuid,   7.0, 'Choc. couv. DGF blanc'),
      ('d7210288-818b-4295-8489-4e60facee501'::uuid,   0.0, 'Choc. blanc DGF (doublon)'),
      ('e2563d8e-7749-43ea-a628-4324f7fefdaa'::uuid,   0.0, 'Choc. couv. blan DGF (doublon)'),
      ('b858af19-bb7d-4f9b-b45c-c75128b94392'::uuid,   1.0, 'Choc. couv. DGF lait'),
      ('cce49b20-87bf-453a-a964-8c2e28401923'::uuid,   0.0, 'Choc. couv. DGF noir'),
      ('2e912a1e-9a20-47c0-84ec-a1c8ca433d98'::uuid,   0.0, 'Choc. noir DGF (doublon)'),
      -- Cremes
      ('8ebec4ef-bee0-4f1c-bea9-d08e7e638f4f'::uuid,   5.0, 'Creme citron'),
      ('b16dc1ac-2885-4d28-b327-8ffc7a36ae29'::uuid,   0.0, 'Creme citron (doublon)'),
      ('99cafb09-6ce1-4772-b9e1-a8293a3dd86c'::uuid,   4.0, 'Creme chocolat'),
      ('c7586e23-e864-42d2-b397-a206deb71e13'::uuid,  15.0, 'Cream cheese'),
      ('c54f73c2-6362-483d-b03d-a1d788848d12'::uuid,   0.0, 'Creme cheese unit (doublon)'),
      ('31fed287-ba51-4c1d-a70e-e6fc9c88f986'::uuid,  30.0, 'Creme fraiche (L)'),
      ('b69ed5f1-13c5-4ad7-b1db-ac9d0ce49c32'::uuid,   0.0, 'Creme fraiche kg (doublon)'),
      ('da7ed89e-c2fb-4046-9349-ca61be1c5f67'::uuid,  12.0, 'Creme patissiere'),
      ('80333648-a399-465b-b7fd-c8abb52a4573'::uuid,   0.0, 'Creme patissiere (doublon)'),
      -- Lait
      ('55abd57d-29b1-4815-94e7-89440c35e7b5'::uuid,  37.0, 'Lait (L)'),
      ('ca642bf7-67bc-4318-ab00-e32908a22abd'::uuid,   0.0, 'Lait (doublon)'),
      -- Amandes
      ('66ae4930-a26f-4969-b342-4215963809d5'::uuid,   4.0, 'Amande effilee'),
      ('791afb50-674c-4469-b310-068591b0df50'::uuid,   6.0, 'Amande hachee/concassee'),
      ('047ae0f5-b143-4c22-a1c3-62a8872ce7d7'::uuid,   0.0, 'Amande hachee (doublon)'),
      ('ff27b264-8f83-462c-98fd-6f31d90786f0'::uuid,   5.0, 'Poudre amande'),
      -- Divers patisserie
      ('1d339a02-229a-4d19-b0c8-e0a9771f5363'::uuid,  15.0, 'Sucre glace'),
      ('6f70c696-1286-4344-99c9-9b2feb765d14'::uuid,  13.0, 'Semoule Kenz'),
      ('e8b2c8ec-65d0-4e63-8ed7-9838a9bffdd8'::uuid,   3.0, 'Poudre de cacao'),
      ('2c69da17-4db1-4fea-938a-68194d49c540'::uuid,   8.0, 'Nappage neutre'),
      ('d2c3756f-e143-483c-94d7-80ed750dfbd0'::uuid,   0.0, 'Nappage (doublon)'),
      ('fdb0f041-3477-47b5-bbbf-c73fb147a9ad'::uuid,  11.0, 'Fondant patissier'),
      ('b159f8b3-ff9c-431d-ad43-0a184ec4525d'::uuid,   8.0, 'Praline amande 50%'),
      ('b480b90b-dde9-4374-b179-eb37e891036e'::uuid,   0.0, 'Praline amande (doublon)'),
      ('6b49c149-83c4-4571-9c4b-47e2a3472c9d'::uuid,   4.0, 'Praline noisette 50%'),
      ('f6746aa5-d7d3-4b6a-a0da-64414d65fd64'::uuid,   7.0, 'Sirop de glucose'),
      ('d8712a89-94de-41cc-82fa-f02c7f7e200c'::uuid,   0.0, 'Sirop de glucose g (doublon)'),
      -- Tablettes Signature
      ('d4224518-6ef8-427f-bec2-7b3d536a5836'::uuid,   2.0, 'Tablette Signature blanc'),
      ('e53bc720-c078-4dd5-955d-f3c5e61f8c7e'::uuid,   4.0, 'Tablette Signature noir'),
      ('348940b8-8b8f-4f3d-912c-c1de8eb1a948'::uuid,   1.0, 'Tablette Signature lait')
    ) AS t(ingredient_id, qty_comptee, libelle)
  LOOP
    SELECT COALESCE(current_quantity, 0) INTO v_current
    FROM inventory WHERE ingredient_id = r.ingredient_id;

    IF NOT FOUND THEN
      INSERT INTO inventory (ingredient_id, current_quantity, minimum_threshold)
      VALUES (r.ingredient_id, 0, 0);
      v_current := 0;
    END IF;

    v_delta := r.qty_comptee - v_current;

    UPDATE inventory
       SET current_quantity = r.qty_comptee,
           updated_at       = v_date + TIME '18:00'
     WHERE ingredient_id = r.ingredient_id;

    IF v_delta <> 0 THEN
      INSERT INTO inventory_transactions
        (ingredient_id, type, quantity_change, note, performed_by, store_id, created_at)
      VALUES
        (r.ingredient_id, 'adjustment', v_delta,
         format('Inventaire physique 2026-08-05 : %s: %s→%s',
                r.libelle, trim(to_char(v_current, 'FM999999990.999')),
                trim(to_char(r.qty_comptee, 'FM999999990.999'))),
         v_user_id, v_store_id, v_date + TIME '18:00');
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Inventaire 2026-08-05 enregistre : % ajustements.', v_count;
END $$;

COMMIT;

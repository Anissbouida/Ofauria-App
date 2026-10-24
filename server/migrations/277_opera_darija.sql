-- Migration 277 : Version arabe (darija) des etapes de l'Opera classique
--
-- POURQUOI
--   La fiche Masterclass Ofauria est BILINGUE : chaque geste y est explique en
--   francais et en darija, et c'est la colonne darija que le labo lit. La mig 276
--   n'a repris que le francais — la moitie du document a ete perdue en route.
--
--   Le darija est stocke DANS l'etape, pas a cote : `nom_ar` et
--   `checklist_items_ar` s'ajoutent a chaque objet du JSONB `recipes.etapes`.
--   Une etape reste ainsi une unite, quelle que soit la langue de lecture.
--
-- PREREQUIS DEJA TRAITE
--   Les schemas zod (recipe.validator, production-contenant.validator) ont ete
--   etendus a ces deux cles. Sans ca, zod depouille les cles inconnues et la
--   PREMIERE sauvegarde depuis l'UI effacerait tout le darija sans un mot.
--
-- PORTEE
--   UPDATE du seul JSONB etapes de l'Opera classique + la note allergenes en
--   arabe. Rejouable : le patch est applique par numero d'ordre.
--
-- INVERSION
--   UPDATE recipes SET etapes = (
--     SELECT jsonb_agg(e - 'nom_ar' - 'checklist_items_ar' ORDER BY (e->>'ordre')::int)
--     FROM jsonb_array_elements(etapes) e)
--   WHERE id = '0be7a000-0000-4000-8000-000000000001';

UPDATE recipes r
SET etapes = (
      SELECT jsonb_agg(
               CASE WHEN patch.val IS NULL THEN e.value ELSE e.value || patch.val END
               ORDER BY (e.value->>'ordre')::int
             )
        FROM jsonb_array_elements(r.etapes) e
        LEFT JOIN LATERAL (
          SELECT p.value AS val
            FROM jsonb_each('{
  "1": {
    "nom_ar": "بيسكوي جوكوند (الخفة والقوام)",
    "checklist_items_ar": [
      "Bec d''oiseau : بياض البيض ماخاصوش يكون قاصح بزاف، خاصو يكون رطب باش مايتفرتتش فالتخلاط (Grainer).",
      "تخلاط الزبدة : عمرك تخوي الزبدة الدايبة ديريكت! هز جوج معالق كبار من العجينة، خلطهم مع الزبدة مزيان، عاد خوي كلشي فالبول. هكا الزبدة ماغتهبطش للقاع وتدقص البيسكوي.",
      "الطياب : 200 درجة فوق طاوات مدوبلة. غير يولي لونو مدهب فاتح، خرجو وحطو فوق شبكة يبرد."
    ]
  },
  "2": {
    "nom_ar": "السيرو بالشعرة والشابلوناج",
    "checklist_items_ar": [
      "شابلوناج شفاف : دهن الشكلاط تحت البيسكوي وكرطو مزيااان بپاليط حتى يولي شفاف. الغرض هو نسدو التقابي د البيسكوي فقط، ماشي نديرو طبقة غليظة قاصحة فالعضة.",
      "حرارة السيرو : السيرو خاصو يكون دافي شوية والبيسكوي بارد باش يتشرب لداخل. عبر السيرو وقسمو على 3 باش كاع الطبقات يجي فيهم نفس العبار د السقيان."
    ]
  },
  "3": {
    "nom_ar": "توجاد الكريمات (لعب د الحرارة)",
    "checklist_items_ar": [
      "كاناش كتشعل : خوي لاكريم على 3 دفعات. حرك بالزربة فالوسط باش دير نواة مطاطية. هبط الميكسور للقاع وماتطلعوش باش مادخلش الهوا وماديرش الكشكوشة.",
      "كريمة الزبدة ملسة : السر هو الحرارة. البيض لي طربتي والزبدة بوماد خاصهم بجوج يكونو فـ 24 درجة. يلا الكريمة خسرات وعزلات الما على الزيت (Grainer)، صهد البول ديال العجانة بشوية د الشاليمو وخليها تطرب غترجع ملسة بوحدها."
    ]
  },
  "4": {
    "nom_ar": "المونطاج فالكادر (القياس الهندسي)",
    "checklist_items_ar": [
      "الضغط (Tassage) : حط طاوة نقية فوق كل بيسكوي جديد حطيتيه وبرك باش يجي مسطح ومايجوش الجناب طالعين.",
      "تجميد الكاناش : خلي الكاناش تشد راسها 15 دقيقة على برا (ماشي فالثلاجة). الثلاجة غدير الما فوق الكاناش والبيسكوي الثالث ماغيلصقش وغيطير فاش تقطع.",
      "التملاط (Lissage) : الكريمة اللخرة كرطها بمسطرة د الألمنيوم ديال 60 سم مدوزة فوق حافة الكادر، باش يجي السطح بحال الزاج."
    ]
  },
  "5": {
    "nom_ar": "الفينيسيون ديال المحترفين (الكلاصاج والتقطاع)",
    "checklist_items_ar": [
      "كلاصاج دقة وحدة : صفي الكلاصاج فصفاية وخويه فـ 32 درجة. جيب پاليط كبر من عرض الكادر وجر دقة وحدة لعندك. يلا عاودتي ديتي وجبتي الپاليط غيخسر اللمعان ويولي مضبب.",
      "تقطاع الجراحين : طراسي بالمسطرة. استعمل موس طويل سخون فما طايب، ونشفووو مزيااااان بسربيتة. أي قطرة د الما أو شكلاط بقات فالموس غتهبط وتجلخ الكريمة البيضا وتخسر الشوفة د الطبقات."
    ]
  }
}'::jsonb) p
           WHERE p.key = e.value->>'ordre'
        ) patch ON true
    ),
    -- La ligne allergenes de la fiche existe aussi en arabe.
    instructions = r.instructions || E'\n\nمسببات الحساسية : الݣلوتين (الفارينة)، البيض، الحليب والزبدة، اللوز، الصوجا (ليسيتين الشكلاط).',
    updated_at = NOW()
WHERE r.id = '0be7a000-0000-4000-8000-000000000001'
  AND NOT (r.etapes @> '[{"nom_ar": ""}]'::jsonb)
  AND r.instructions NOT LIKE '%مسببات%';

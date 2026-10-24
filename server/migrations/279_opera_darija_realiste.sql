-- Migration 279 : Darija realiste sur les etapes de l'Opera classique
--
-- POURQUOI
--   La mig 277 avait recopie la colonne darija du fichier source ; le chef l'a
--   jugee artificielle (calques du francais : « تقطاع الجراحين » pour « coupe
--   chirurgicale »), et la mig 278 l'a retiree. Le chef demande maintenant une
--   version redigee correctement.
--
--   Cette version est ecrite comme on parle au poste :
--     - imperatifs courts, une consigne par ligne ;
--     - les termes techniques restent en francais marocanise, comme au labo :
--       بلاكة (plaque), باليط (palette), ميكسور, شالومو (chalumeau), كلاصاج,
--       شابلوناج, كاناش, كريم أو بور ;
--     - vocabulaire marocain : الشكلاط (jamais الشوكولا), التلاجة, دغيا,
--       نيشان, بزاف, مزيان, ملي, باش, حيت.
--
-- CONTRAINTE DE RENDU ASSUMEE
--   Aucune parenthese ni mot latin DANS les lignes arabes : le rendu PDF actuel
--   (fontkit sans bidi complet) deplace ces segments. « -18 °C » s'ecrit donc
--   « ناقص 18 درجة », « 8 x 3,8 » s'ecrit « 8 على 3.8 » — ce qui est d'ailleurs
--   la facon naturelle de le dire.
--
-- PORTEE
--   Patch du JSONB etapes par numero d'ordre + ligne allergenes en arabe dans
--   les notes. Rejouable (le patch ecrase les cles arabes existantes ; la ligne
--   allergenes est gardee par un NOT LIKE). Le francais n'est pas touche.
--
-- INVERSION
--   Rejouer la mig 278 (retrait de toutes les cles arabes).

UPDATE recipes r
SET etapes = (
      SELECT jsonb_agg(
               CASE WHEN patch.val IS NULL THEN e.value ELSE e.value || patch.val END
               ORDER BY (e.value->>'ordre')::int
             )
        FROM jsonb_array_elements(r.etapes) e
        LEFT JOIN LATERAL (
          SELECT p.value AS val
            FROM jsonb_each('{"1": {"nom_ar": "بيسكوي جوكوند", "checklist_items_ar": ["غربل اللوز المطحون والسكر كلاصي مع بعضياتهم", "طرب البيض الكامل معاهم 10 دقايق حتى يخثر الخليط ويبيض. البيض يكون فحرارة البيت، ماشي خارج من التلاجة", "بياض البيض ماتطلعوش قاصح بزاف، خليه رطب شوية باش مايتفتتش فاش تخلطو مع العجين", "الزبدة المدوبة: خلط جوج معالق ديال العجين معاها بعدا، عاد رد كولشي للعجين، هاكا ماكتهبطش للقاع", "الطياب: 200 درجة، 7 دقايق، فوق جوج بلاكات فوق بعضياتهم، حتى ياخد لون ذهبي خفيف", "ملي يخرج من الفرن، حطو نيشان فوق الشبكة باش يبرد"]}, "2": {"nom_ar": "الشابلوناج والتشريب", "checklist_items_ar": ["دوب الشكلاط الكحل ودهن بيه الوجه ديال البيسكوي اللول", "حك مزيان بالباليط باش تبقى غير طبقة رقيقة شافة. الهدف نسدو الثقوب باش مايهربش السيرو", "السيرو يكون دافي والبيسكوي بارد، هاكا كيتشرب مزيان", "عبر السيرو وقسمو على 3 باش كل طبقة تاخد نفس القدر"]}, "3": {"nom_ar": "الكاناش وكريم أو بور", "checklist_items_ar": ["الكاناش: صب الكريمة السخونة على الشكلاط على 3 مرات، وحرك فالوسط حتى يلصق الخليط ويلمع", "الميكسور يبقى ديما فالقاع، ماتطلعوش، باش مايدخلش الهوا للكاناش", "كريم أو بور: صب السيرو سخون 118 درجة على البيض وهو كيتطرب", "البيض المطروب والزبدة بوماد خاصهم بجوج يكونو ف 24 درجة، هادا هو السر", "إلا تقطعات الكريمة، دوز الشالومو دغيا على البول وكمل الطراب، كترجع بوحدها"]}, "4": {"nom_ar": "المونطاج فالكادر", "checklist_items_ar": ["الترتيب: بيسكوي مشبلون، كريمة، بيسكوي، كاناش، بيسكوي، كريمة", "كل بيسكوي كتحطو، حط فوقو بلاكة نقية وبرك عليها شوية باش يجي مسطح نيشان", "الكاناش خليها تشد 15 دقيقة برا، ماشي فالتلاجة، حيت التلاجة كدير الندى والبيسكوي مايبقاش لاصق", "فاللخر دوز مسطرة الألمنيوم ديال 60 سم على حواف الكادر باش يجي الوجه مستوي"]}, "5": {"nom_ar": "التجميد والكلاصاج والتقطيع", "checklist_items_ar": ["جمد الكاطو مزيان حتى لداخل، ناقص 18 درجة", "صفي الكلاصاج وصبو وهو ف 32 حتى 35 درجة", "خود باليط عرض من الكادر وجر ضربة وحدة لعندك. إلا عاودتي فيها كيمشي البريق ديال الكلاصاج", "غطس الموس فالما السخون ونشفو مزيان قبل كل قطعة. قطرة وحدة ديال الما كتخصر منظر الطبقات", "كيخرجو 70 قطعة ديال 8 على 3.8 سم"]}}'::jsonb) p
           WHERE p.key = e.value->>'ordre'
        ) patch ON true
    ),
    instructions = CASE
      WHEN COALESCE(r.instructions, '') LIKE '%الحساسية%' THEN r.instructions
      ELSE COALESCE(r.instructions, '') || E'\n\nالحساسية: فيه الغلوتين من الفارينة، البيض، الحليب والزبدة، اللوز، والصوجا اللي فالشكلاط.'
    END,
    updated_at = NOW()
WHERE r.id = '0be7a000-0000-4000-8000-000000000001';

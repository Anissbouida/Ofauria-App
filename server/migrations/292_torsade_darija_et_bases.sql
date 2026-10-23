-- Migration 292 : Torsade nature sucre — darija bilingue + désarchivage des bases
--
-- POURQUOI
--   Après la mig 291, trois retours de l'atelier :
--     1. Les composants « fond / decor / nappage » apparaissent VIDES dans l'UI
--        alors qu'ils sont bien insérés en base. Cause : les trois recettes de
--        base référencées (Pâte levée feuilletée fab28000-…-0104, Dorure -0101,
--        Sirop à 30°B -0102) ont été archivées par erreur (archived_at posé).
--        Le front filtre les recettes archivées du dropdown → composant vide.
--        Fix : désarchiver les 3 bases utilisées par le format 227.
--
--     2. La fiche masterclass source est BILINGUE FR/AR (darija) : chaque
--        checklist item et chaque section d'instructions a sa contrepartie
--        arabe. La mig 291 n'avait gardé que le français.
--        Fix : ajouter des items « 🇲🇦 … » à chaque checklist et enrichir les
--        instructions avec la section darija de la fiche source.
--
--     3. La colonne « produits de base » de l'UI ne surface pas ces recettes
--        (même cause que 1 — filtre archived).
--
-- PORTÉE
--   + UPDATE recipes SET archived_at = NULL sur les 3 bases utilisées par le
--     format 227 (Torsade nature sucre).
--   + UPDATE recipes SET etapes = <11 étapes enrichies FR + AR>,
--                        instructions = <instructions FR + AR>
--     sur la recette fab28200-…-127.
--   Idempotent : UPDATE ciblés, mêmes valeurs à chaque exécution.
--
-- NOTA BENE
--   La mig ne désarchive PAS les 23 autres bases fab28000 archivées — s'il
--   s'avère que d'autres fiches (croissant, pain choco, etc.) ont le même
--   problème, une mig séparée traitera le batch avec un critère explicite
--   (« utilisées par un composant actif »).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Désarchiver les 3 bases utilisées par la fiche Torsade nature sucre.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipes
   SET archived_at = NULL,
       updated_at  = NOW()
 WHERE id IN (
   'fab28000-0000-4000-8000-000000000101', -- Dorure
   'fab28000-0000-4000-8000-000000000102', -- Sirop à 30°B
   'fab28000-0000-4000-8000-000000000104'  -- Pâte levée feuilletée
 )
   AND archived_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Étapes bilingues FR + darija. Chaque checklist reprend l'item français
--    suivi de son équivalent darija (préfixé 🇲🇦), tel qu'écrit dans la
--    fiche masterclass source (10009_TORSADE.md V3 août 2026).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipes
   SET etapes = '[
  {"ordre":1,"nom":"Température de l''eau (base 54) · حساب حرارة الما","duree_estimee_min":2,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Mesurer T° du labo et T° de la farine",
     "🇲🇦 قيس السخانة ديال الأتولي والفارينة (مثلاً 26 و24 درجة)",
     "T° des liquides = 54 − (T° labo + T° farine)",
     "🇲🇦 الحساب : 54 ناقص (سخانة الأتولي + سخانة الفارينة) = الرقم لي خاصو يكون فيه الحليب والما",
     "Si < 4 °C, remplacer une part du lait par de la glace pilée PESÉE",
     "🇲🇦 إلا طلع الرقم قريب للصفر، بدل شوية ديال الحليب بالتلج المدقوق — وزنو بالميزان",
     "Objectif : pâte à 22-24 °C en fin de pétrissage",
     "🇲🇦 الهدف : العجينة تخرج من الماكينة ما بين 22 و24 درجة"]},
  {"ordre":2,"nom":"Pétrissage · العجين","duree_estimee_min":12,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Ordre cuve : lait froid + eau glacée + œufs, puis farine + lait poudre + sucre + malt",
     "🇲🇦 الترتيب فالكيوف : الحليب البارد + الما بالتلج + البيض، ومن بعد الفارينة + الحليب دلابودرة + السكر + الأميليوران",
     "Levure émiettée d''un côté, sel de l''autre — JAMAIS en contact",
     "🇲🇦 الخميرة فجيهة والملحة فالجيهة لخرى — الملحة كتقتل الخميرة إلا تلاقاو",
     "Frasage 4 min en 1ʳᵉ vitesse (pâte grumeleuse, normal)",
     "🇲🇦 الفرازاج : ربعة دقايق فالفيتيس لولا. العجينة كتكون قبيحة ولزقة، هادشي عادي",
     "Ajouter sel puis beurre pommade en morceaux",
     "🇲🇦 زيد الملحة، ومن بعدها الزبدة الطرية مقطعة قطع صغار",
     "5-6 min en 2ᵉ vitesse — arrêter dès pâte lisse, PAS de voile élastique",
     "🇲🇦 5-6 دقايق فالفيتيس الثانية — وقف منين تولي ملسة، ماخاصهاش تولي مطاطة بحال الشوينگوم",
     "Sonder : 22-24 °C obligatoire, noter sur la fiche de production",
     "🇲🇦 غرز الطرمومتر : خاصها تكون 22-24 درجة، كتب الرقم فالورقة"]},
  {"ordre":3,"nom":"Pointage et blocage · الراحة والبلوكاج","duree_estimee_min":780,
   "est_bloquante":true,"timer_auto":true,"controle_qualite":false,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Aplatir en rectangle de 4 cm sur plaque, filmer au contact (sans air)",
     "🇲🇦 فرشها بيديك مستطيل سميك 4 صونتيم، غطيها بالفيلم ملصوق نيشان بلا هوا",
     "Pointage : 30 min à 24-26 °C",
     "🇲🇦 البونطاج : 30 دقيقة برا فالأتولي",
     "Blocage : 40 min à −18 °C (stoppe la fermentation à cœur)",
     "🇲🇦 البلوكاج : 40 دقيقة فالسورجيلاتور — كتوقف الخميرة نيشان",
     "Repos : 12 h minimum à 4 °C — sortir ferme et froide (4-6 °C)",
     "🇲🇦 الفريكو : 12 ساعة على الأقل ف 4 درجات — غدا خاصها تكون قاسحة وباردة"]},
  {"ordre":4,"nom":"Beurre de tourage (test 90°) · زبدة التوراج","duree_estimee_min":10,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Sortir le beurre 30 min avant, taper en carré 20 × 20 cm entre 2 feuilles guitare",
     "🇲🇦 خرج الزبدة قبل بـ30 دقيقة، دقها بين ورقتين ديال الگيتار مربع 20×20 سم",
     "Sonder : 13-15 °C",
     "🇲🇦 قيسها بالطرمومتر : خاصها 13-15 درجة",
     "TEST plier à 90° — casse = trop froid (10 min hors froid) ; empreinte doigt = trop chaud (10 min au froid)",
     "🇲🇦 التيست : طويها 90 درجة — تهرست = باردة بزاف (10 دقايق برا) ؛ صباعك دخل فيها = سخونة بزاف (10 دقايق فالفريكو)",
     "OK = se plie sans casser, texture pâte à modeler",
     "🇲🇦 مزيان = كتطوى بلا ما تقطع، بحال الپات أموديلي",
     "RÈGLE D''OR : beurre et pâte à la MÊME dureté au doigt",
     "🇲🇦 القاعدة الذهبية : الزبدة والعجينة خاص يكونو بنفس القساحة بالضبط"]},
  {"ordre":5,"nom":"Enchâssage et tours (1 double + 1 simple) · التوراج","duree_estimee_min":75,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Abaisser détrempe en carré 40 × 40 cm, poser le beurre en losange (45°)",
     "🇲🇦 رقق العجينة مربع 40×40 سم، حط الزبدة فالوسط مدورة 45 درجة (على شكل معين)",
     "Rabattre les 4 pointes au centre, pincer TOUTES les jointures",
     "🇲🇦 جيب الربعة ديال الروس للوسط، قرص كل الجنابات مزيان",
     "Tour DOUBLE : bande 60 × 25 (~8 mm), rabat haut au tiers + bas jusqu''à joindre, fermer en deux → 30 min à 4 °C",
     "🇲🇦 التور دوبل : بند 60×25 سم (~8 مم)، الطرف ديال فوق للثلث + ديال تحت حتى يتلاقاو، ومن بعد طوي على جوج → 30 دقيقة فالفريكو",
     "Tour SIMPLE : bande 60 × 25, rabat haut au tiers puis bas par-dessus → 30 min à 4 °C",
     "🇲🇦 التور سامبل : بند 60×25، الثلث ديال فوق ومن بعد الثلث ديال تحت فوقو → 30 دقيقة فالفريكو",
     "Résultat : 12 couches de beurre",
     "🇲🇦 النتيجة : 12 طبقة ديال الزبدة",
     "Si la pâte se rétracte : STOP, retour 15 min au froid",
     "🇲🇦 إلا رجعات لور : وقف نيشان، رجعها 15 دقيقة فالفريكو"]},
  {"ordre":6,"nom":"Abaisse et détaillage · الترقيق والتقطاع","duree_estimee_min":25,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Détendre 15 min après le dernier tour",
     "🇲🇦 خلي العجينة ترتاح 15 دقيقة من بعد آخر تور",
     "Abaisser par paliers de 2 mm, ¼ de tour à chaque passage, jusqu''à 3,5 mm",
     "🇲🇦 رقق شوية بشوية 2 مم فكل مرة، دور ربع دورة، حتى توصل 3.5 مم",
     "Rectangle final ≈ 52 × 120 cm",
     "🇲🇦 مستطيل تقريباً 52×120 سم",
     "REPOS 20 min à 4 °C, à plat — indispensable, sinon rétraction en étuve",
     "🇲🇦 راحة 20 دقيقة فالفريكو مفروشة — ماكاين فيها والو، بلاها الطورصاد ترجع لور فالشومبر",
     "Parer les 4 bords (1 cm) — bords soudés = étages qui ne s''ouvrent pas",
     "🇲🇦 قص الطراف ديال الجنابات (1 سم) — الجنابات مسدودة = الطبقات ما تفتحش فالفران",
     "Détailler bandes 10 × 26 cm, peser les 3 premières : 90 g ± 2 g",
     "🇲🇦 قطع بنودة 10×26 سم، وزن أول تلاتة : 90 غ زايد ناقص 2"]},
  {"ordre":7,"nom":"Façonnage (30 s/pièce) · التشكيل","duree_estimee_min":15,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":true,"est_repetable":true,
   "nb_repetitions":24,"responsable_role":null,
   "checklist_items":[
     "Bande dans le sens de la longueur, pulvérisation LÉGÈRE d''eau",
     "🇲🇦 حط البند بالطول، رش رشة خفيفة ديال الما بالپولفيريزاتور",
     "Saupoudrer 8 g de sucre semoule sur la moitié basse, 1,5 cm de marge (sinon caramélise sur la plaque)",
     "🇲🇦 رش 8 غ ديال السكر على النص ديال تحت، خلي 1.5 سم فارغين فالجنابات (بلاهم كيتحرق ويلصق)",
     "Rabattre en deux dans la longueur → bande 5 × 26 cm, souder au rouleau",
     "🇲🇦 طوي على جوج بالطول → بند 5×26 سم، مر الرولو بشوية باش يلصق",
     "Fendre dans la longueur, laisser 2 cm non coupés en haut",
     "🇲🇦 شق البند بالطول من الوسط، خلي 2 سم ماشي مقطوعين فالراس",
     "Torsader 3 tours COMPLETS, faces coupées visibles dessus (vitrine)",
     "🇲🇦 لف 3 دورات كاملة، الوجه المقطوع للفوق (هو لي كيبان فيه التوريق فالفيترينة)",
     "Poser sur plaque, PRESSER LES DEUX EXTRÉMITÉS au pouce (sinon la torsade se déroule)",
     "🇲🇦 حطها فالبلاطو، ضغط الجوج ديال الطراف بالإبهام بالقوة (بلاها الطورصاد كتحل راسها)",
     "Espacement 6 cm — ≈ 12 pièces sur plaque 60 × 40",
     "🇲🇦 6 سم بين كل قطعة — تقريباً 12 قطعة فالبلاطو 60×40"]},
  {"ordre":8,"nom":"Apprêt · الشومبر","duree_estimee_min":135,
   "est_bloquante":true,"timer_auto":true,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Étuve 26-27 °C — MAXIMUM 28 °C (le beurre fond à 30)",
     "🇲🇦 الشومبر ما بين 26 و27 درجة — الماكسيموم 28، الزبدة كتذوب ف 30",
     "Hygrométrie 75 %",
     "🇲🇦 الرطوبة 75%",
     "Durée 2 h à 2 h 30",
     "🇲🇦 المدة : ساعتين ل ساعتين ونص",
     "3 repères : volume doublé + pièce qui tremble à la secousse + couches de beurre visibles sur la tranche",
     "🇲🇦 3 علامات : الحجم تضاعف + القطعة كترجرج بحال الجيلي + الطبقات ديال الزبدة باينين فالوجه المقطوع",
     "PLUTÔT LENT que rapide : 3 h à 25 °C >>> 1 h 30 à 30 °C",
     "🇲🇦 الأحسن بطيء ماشي مزروب : 3 سوايع ف 25 درجة خير بزاف من ساعة ونص ف 30"]},
  {"ordre":9,"nom":"Dorure (2 passes) · الدهان","duree_estimee_min":5,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Dorure FINE avant étuve (empêche le croûtage)",
     "🇲🇦 الدهان لول : رقيق قبل الشومبر — باش الوجه ما يجفش",
     "2ᵉ passe après étuve, juste avant le four (3 g/pièce)",
     "🇲🇦 الدهان الثاني : من بعد الشومبر نيشان قبل الفران (3 غ فالقطعة)",
     "Pinceau souple, dans le sens de la torsade",
     "🇲🇦 خدم بشيتا رقيقة، فاتجاه اللفة",
     "JAMAIS sur les tranches coupées — la dorure colle les feuillets et le feuilletage ne s''ouvre pas",
     "🇲🇦 عمرك ما تلمس بالشيتا الوجه المقطوع — البيض كيلصق الطبقات وما كتفتحش فالفران",
     "Pas de flaque dans les creux (points noirs à la cuisson)",
     "🇲🇦 ما تخليش البيض يتجمع فالحفر — كينطاب ويخلي بقع كحلة"]},
  {"ordre":10,"nom":"Cuisson (four ventilé 165-170 °C) · الطياب","duree_estimee_min":18,
   "est_bloquante":true,"timer_auto":true,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Enfourner buée FERMÉE, ouvrir le clapet à 8 min",
     "🇲🇦 دخلهم والكلي (فتحة البخار) مسدودة، حلها من بعد 8 دقايق",
     "Ventilé 165-170 °C : 16-18 min ; sole/voûte 190/180 °C : 18-20 min",
     "🇲🇦 الفران الفونتيلي 165-170 درجة : 16-18 دقيقة ؛ بالسول 190 تحت / 180 فوق : 18-20 دقيقة",
     "Si le four est déséquilibré : tourner les plaques à mi-cuisson",
     "🇲🇦 إلا الفران ماشي متوازن : دور البلاطوات فالنص",
     "Contrôle : dessus acajou uniforme + SOULEVER 1 pièce, le dessous doit être BIEN COLORÉ",
     "🇲🇦 المراقبة : اللون من فوق بحال الأكاجو + هز قطعة وشوف تحتها، خاصها تكون محمّرة",
     "Dessous blanc = intérieur cru — remettre 2-3 min",
     "🇲🇦 القاع بيض = من الداخل ماشي طايب — رجعها 2-3 دقايق"]},
  {"ordre":11,"nom":"Finition (sirop + ressuage) · السيرو والتبريد","duree_estimee_min":35,
   "est_bloquante":true,"timer_auto":false,"controle_qualite":true,"est_repetable":false,
   "nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "À la sortie du four (encore brûlant) : siroper au pinceau (4 g/pièce)",
     "🇲🇦 نيشان منين تخرج من الفران وهي سخونة : دهنها بالسيرو بالشيتا (4 غ فالقطعة)",
     "Transférer IMMÉDIATEMENT sur grille (pas sur plaque : vapeur → dessous mou)",
     "🇲🇦 نقلهم دغيا للشبكة (ماشي فالبلاطو : البخار كيخلي القاع مطاطي)",
     "Refroidir 30 min minimum",
     "🇲🇦 خليهم يبردو نص ساعة على الأقل",
     "Sucre glace éventuel : UNIQUEMENT une fois complètement froid",
     "🇲🇦 السكر الگلاصي (إلا بغيتي) : من بعد ما يبردو نيشان، ماشي دافيين",
     "Ne JAMAIS filmer une pièce tiède",
     "🇲🇦 عمرك ما تغطي ولا تدير فالساشي قطعة دافية"]}
]'::jsonb,
       instructions = 'FICHE MASTERCLASS TORSADE NATURE SUCRE (SKU 10009) — V3 août 2026 · الطورصاد ناتير بالسكر

━━━ FR ━━━

Pâton 90 g cru par pièce, sucre semoule 8 g/pièce à l''intérieur, dorure 3 g/pièce (2 passes), sirop 30°B 4 g/pièce en nappage à la sortie du four. Longueur 13-15 cm.

Rendement : 1 kg de farine (détrempe 1 850 g + tourage 500 g = pâton 2 350 g, ~5 % de chutes) → 24 pièces de 90 g cru. Perte de cuisson 14 % → pièce cuite ~77 g → pièce finie sirotée ~81 g.

Planning J-1 : pétrissage 15 h, pointage 30 min, blocage 40 min à −18 °C, froid 4 °C toute la nuit. Sirop et dorure préparés le J-1 (dorure reposée 2 h au frigo, tamisée).

Planning J : tourage 4 h, abaisse+détaillage+façonnage 5 h 30, étuve 6 h, cuisson+sirop 8 h 15, vitrine 9 h.

Sirop 30°B : 500 g eau + 650 g sucre + 50 g glucose, porté à ébullition, refroidi à 60 °C. Se garde 15 jours au froid.

Conservation : vente le jour même (DLC vitrine 24 h). Ne jamais mettre en sachet une pièce tiède.
Surgélation crue possible après façonnage (−35 °C / 40 min puis bac hermétique, 3 semaines max à −18 °C), remise en étuve directe 3 h à 26 °C.
Surgélation précuite (80 % de cuisson, 12 min) : 6 semaines à −18 °C, finition 7-8 min à 180 °C + sirop.

Défauts rédhibitoires (retirés de la vente) : beurre coulé sur la plaque · torsade détordue · dessous blanc · sucre caramélisé et collé.

Allergènes : gluten (farine), œufs (dorure + détrempe), lait et beurre (détrempe + tourage).

━━━ 🇲🇦 بالدارجة ━━━

الپاتون 90 غرام خاوية فالقطعة، السكر 8 غ فالقطعة داخل، الدهان 3 غ فالقطعة (فجوج بيوس)، السيرو 30°B 4 غ فالقطعة من بعد الفران. الطول 13-15 صونتيم.

التخراج : كيلو ديال الفارينة (العجينة 1850 غ + زبدة التوراج 500 غ = الپاتون 2350 غ، ~5% ديال الطراف) → 24 قطعة ديال 90 غ خاوية. القطعة كتنقص 14% فالفران → القطعة المطيبة ~77 غ → القطعة النهائية بالسيرو ~81 غ.

البلانينگ ديال J-1 : العجين ف 15 ساعة، البونطاج 30 دقيقة، البلوكاج 40 دقيقة ف −18، الفريكو الليل كامل ف 4 درجات. السيرو والدهان كيتوجدو ف J-1 (الدهان كيرتاح ساعتين فالفريكو، مصفي).

البلانينگ ديال النهار : التوراج 4 ساعة، الترقيق+التقطاع+التشكيل 5 ساعة ونص، الشومبر 6 ساعة، الطياب+السيرو 8 ساعة و15، الفيترينة 9 ساعة.

السيرو 30°B : 500 غ ما + 650 غ سكر + 50 غ گليكوز، غليه مرة وحدة وبرّدو حتى ل60 درجة. كيقعد 15 نهار فالفريكو.

التخزين : البيع نفس النهار (الصلاحية فالفيترينة 24 ساعة). عمرك ما تدير قطعة دافية فالساشي.
كتقدر تبرد فالسورجيلاتور بعد التشكيل (−35 درجة / 40 دقيقة ومن بعد صندوق مسدود، 3 سيمانات ماكسيموم ف −18)، دخلها نيشان للشومبر 3 ساعة ف 26 درجة.
التبريد مطيب نص طياب (80% ديال الطياب، 12 دقيقة) : 6 سيمانات ف −18، تكميل 7-8 دقايق ف 180 درجة + السيرو.

العيوب لي كتحيد القطعة من البيع : الزبدة سالت فالبلاطو · الطورصاد حلات راسها · القاع بيض · السكر تحرق ولصق.

المسببات الحساسية : الگلوتين (الفارينة)، البيض (الدهان + العجينة)، الحليب والزبدة (العجينة + التوراج).

Source · المصدر : fiche masterclass Ôfauria V3, août 2026 · ورقة تقنية أوفوريا V3، غشت 2026.',
       updated_at = NOW()
 WHERE id = 'fab28200-0000-4000-8000-000000000127';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Contrôles finaux.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n_bases_actives INT;
BEGIN
  SELECT count(*) INTO n_bases_actives
    FROM recipes
   WHERE id IN (
     'fab28000-0000-4000-8000-000000000101'::uuid,
     'fab28000-0000-4000-8000-000000000102'::uuid,
     'fab28000-0000-4000-8000-000000000104'::uuid
   )
     AND archived_at IS NULL;
  IF n_bases_actives <> 3 THEN
    RAISE EXCEPTION 'Torsade : bases actives = %, 3 attendues (PLF+Dorure+Sirop)', n_bases_actives;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM recipes
     WHERE id = 'fab28200-0000-4000-8000-000000000127'
       AND jsonb_array_length(etapes) = 11
       AND instructions LIKE '%بالدارجة%'
  ) THEN
    RAISE EXCEPTION 'Torsade : darija absente ou etapes != 11';
  END IF;
END $$;

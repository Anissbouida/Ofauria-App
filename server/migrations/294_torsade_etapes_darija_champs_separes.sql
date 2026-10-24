-- Migration 294 : Torsade + PLF — séparation FR/AR dans le JSONB des étapes
--
-- POURQUOI
--   Le PDF (recipe-fiche-pdf.service.ts) et l'UI Étapes attendent DEUX tableaux
--   distincts par étape :
--     - "nom"                (FR)  + "nom_ar"                (AR, optionnel)
--     - "checklist_items"    (FR)  + "checklist_items_ar"    (AR, optionnel)
--   La police Helvetica utilisée par pdfkit ne contient AUCUN glyphe arabe
--   (encodage WinAnsi), donc la fonction safe() du renderer remplace chaque
--   caractère arabe par un point médian « · ». La police Cairo, qui couvre
--   l'arabe, n'est appliquée QUE sur les clés *_ar (contientArabe(checklistAr)).
--
--   Les mig 292/293 avaient concentré FR + AR dans le SEUL tableau
--   "checklist_items" (items AR préfixés « 🇲🇦 ») : le PDF les rend donc en
--   Helvetica → rangées de points sur la fiche imprimée.
--
--   Fix : re-poser les étapes de la PLF (fab28000-…-104) et de la Torsade
--   (fab28200-…-127) avec le bon découpage. Rien de nouveau côté contenu, on
--   redistribue les mêmes lignes dans les bonnes clés (préfixe 🇲🇦 retiré, il
--   ne sert plus à distinguer maintenant que la clé le dit).
--
-- PORTÉE
--   UPDATE recipes.etapes sur les 2 recettes concernées.
--   Rejouable, contenu strictement identique à chaque exécution.
--
-- INVERSION
--   Réappliquer la mig 293 (elle repose la version tout-dans-checklist_items).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Pâte levée feuilletée — 5 étapes avec nom_ar + checklist_items_ar.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipes
   SET etapes = '[
  {"ordre":1,"nom":"Température de l''eau (base 54)","nom_ar":"حساب حرارة الما (القاعدة 54)",
   "duree_estimee_min":2,"est_bloquante":true,"timer_auto":false,"controle_qualite":true,
   "est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Mesurer T° du labo et T° de la farine",
     "T° des liquides = 54 − (T° labo + T° farine)",
     "Si < 4 °C, remplacer une part du lait par de la glace pilée PESÉE",
     "Objectif : pâte à 22-24 °C en fin de pétrissage"],
   "checklist_items_ar":[
     "قيس السخانة ديال الأتولي والفارينة (مثلاً 26 و24 درجة)",
     "الحساب : 54 ناقص (سخانة الأتولي + سخانة الفارينة) = الرقم لي خاصو يكون فيه الحليب والما",
     "إلا طلع الرقم قريب للصفر، بدل شوية ديال الحليب بالتلج المدقوق — وزنو بالميزان",
     "الهدف : العجينة تخرج من الماكينة ما بين 22 و24 درجة"]},

  {"ordre":2,"nom":"Pétrissage","nom_ar":"العجين",
   "duree_estimee_min":12,"est_bloquante":true,"timer_auto":false,"controle_qualite":true,
   "est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Ordre cuve : lait froid + eau glacée + œufs, puis farine + lait poudre + sucre + malt",
     "Levure émiettée d''un côté, sel de l''autre — JAMAIS en contact",
     "Frasage 4 min en 1ʳᵉ vitesse (pâte grumeleuse, normal)",
     "Ajouter sel puis beurre pommade en morceaux",
     "5-6 min en 2ᵉ vitesse — arrêter dès pâte lisse, PAS de voile élastique",
     "Sonder : 22-24 °C obligatoire, noter sur la fiche de production"],
   "checklist_items_ar":[
     "الترتيب فالكيوف : الحليب البارد + الما بالتلج + البيض، ومن بعد الفارينة + الحليب دلابودرة + السكر + الأميليوران",
     "الخميرة فجيهة والملحة فالجيهة لخرى — الملحة كتقتل الخميرة إلا تلاقاو",
     "الفرازاج : ربعة دقايق فالفيتيس لولا. العجينة كتكون قبيحة ولزقة، هادشي عادي",
     "زيد الملحة، ومن بعدها الزبدة الطرية مقطعة قطع صغار",
     "خمسة ولا ستة دقايق فالفيتيس الثانية — وقف منين تولي ملسة، ماخاصهاش تولي مطاطة بحال الشوينگوم",
     "غرز الطرمومتر : خاصها تكون ما بين 22 و24 درجة، كتب الرقم فالورقة"]},

  {"ordre":3,"nom":"Pointage et blocage","nom_ar":"الراحة والبلوكاج",
   "duree_estimee_min":780,"est_bloquante":true,"timer_auto":true,"controle_qualite":false,
   "est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Aplatir en rectangle de 4 cm sur plaque, filmer au contact (sans air)",
     "Pointage : 30 min à 24-26 °C",
     "Blocage : 40 min à −18 °C (stoppe la fermentation à cœur)",
     "Repos : 12 h minimum à 4 °C — sortir ferme et froide (4-6 °C)"],
   "checklist_items_ar":[
     "فرشها بيديك مستطيل سميك 4 صونتيم، غطيها بالفيلم ملصوق نيشان بلا هوا",
     "البونطاج : 30 دقيقة برا فالأتولي",
     "البلوكاج : 40 دقيقة فالسورجيلاتور — كتوقف الخميرة نيشان",
     "الفريكو : 12 ساعة على الأقل ف 4 درجات — غدا خاصها تكون قاسحة وباردة"]},

  {"ordre":4,"nom":"Beurre de tourage (test 90°)","nom_ar":"زبدة التوراج (تيست 90 درجة)",
   "duree_estimee_min":10,"est_bloquante":true,"timer_auto":false,"controle_qualite":true,
   "est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Sortir le beurre 30 min avant, taper en carré 20 × 20 cm entre 2 feuilles guitare",
     "Sonder : 13-15 °C",
     "TEST plier à 90° — casse = trop froid (10 min hors froid) ; empreinte doigt = trop chaud (10 min au froid)",
     "OK = se plie sans casser, texture pâte à modeler",
     "RÈGLE D''OR : beurre et pâte à la MÊME dureté au doigt"],
   "checklist_items_ar":[
     "خرج الزبدة قبل بـ30 دقيقة، دقها بين ورقتين ديال الگيتار مربع 20 × 20 سم",
     "قيسها بالطرمومتر : خاصها 13-15 درجة",
     "التيست : طويها 90 درجة — تهرست = باردة بزاف (10 دقايق برا) ؛ صباعك دخل فيها = سخونة بزاف (10 دقايق فالفريكو)",
     "مزيان = كتطوى بلا ما تقطع، بحال الپات أموديلي",
     "القاعدة الذهبية : الزبدة والعجينة خاص يكونو بنفس القساحة بالضبط"]},

  {"ordre":5,"nom":"Enchâssage et tours (1 double + 1 simple)","nom_ar":"التوراج (تور دوبل + تور سامبل)",
   "duree_estimee_min":75,"est_bloquante":true,"timer_auto":false,"controle_qualite":true,
   "est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Abaisser détrempe en carré 40 × 40 cm, poser le beurre en losange (45°)",
     "Rabattre les 4 pointes au centre, pincer TOUTES les jointures",
     "Tour DOUBLE : bande 60 × 25 (~8 mm), rabat haut au tiers + bas jusqu''à joindre, fermer en deux → 30 min à 4 °C",
     "Tour SIMPLE : bande 60 × 25, rabat haut au tiers puis bas par-dessus → 30 min à 4 °C",
     "Résultat : 12 couches de beurre",
     "Si la pâte se rétracte : STOP, retour 15 min au froid"],
   "checklist_items_ar":[
     "رقق العجينة مربع 40 × 40 سم، حط الزبدة فالوسط مدورة 45 درجة (على شكل معين)",
     "جيب الربعة ديال الروس للوسط، قرص كل الجنابات مزيان",
     "التور دوبل : بند 60 × 25 سم (تقريباً 8 مم)، الطرف ديال فوق للثلث + ديال تحت حتى يتلاقاو، ومن بعد طوي على جوج ← 30 دقيقة فالفريكو",
     "التور سامبل : بند 60 × 25، الثلث ديال فوق ومن بعد الثلث ديال تحت فوقو ← 30 دقيقة فالفريكو",
     "النتيجة : 12 طبقة ديال الزبدة",
     "إلا رجعات العجينة لور : وقف نيشان، رجعها 15 دقيقة فالفريكو"]}
]'::jsonb,
       updated_at = NOW()
 WHERE id = 'fab28000-0000-4000-8000-000000000104';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Torsade nature sucre — 6 étapes avec nom_ar + checklist_items_ar.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipes
   SET etapes = '[
  {"ordre":1,"nom":"Abaisse et détaillage","nom_ar":"الترقيق والتقطاع",
   "duree_estimee_min":25,"est_bloquante":true,"timer_auto":false,"controle_qualite":true,
   "est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Détendre 15 min après le dernier tour",
     "Abaisser par paliers de 2 mm, ¼ de tour à chaque passage, jusqu''à 3,5 mm",
     "Rectangle final ≈ 52 × 120 cm",
     "REPOS 20 min à 4 °C, à plat — indispensable, sinon rétraction en étuve",
     "Parer les 4 bords (1 cm) — bords soudés = étages qui ne s''ouvrent pas",
     "Détailler bandes 10 × 26 cm, peser les 3 premières : 90 g ± 2 g"],
   "checklist_items_ar":[
     "خلي العجينة ترتاح 15 دقيقة من بعد آخر تور",
     "رقق شوية بشوية 2 مم فكل مرة، دور ربع دورة، حتى توصل 3.5 مم",
     "مستطيل تقريباً 52 × 120 سم",
     "راحة 20 دقيقة فالفريكو مفروشة — ماكاين فيها والو، بلاها الطورصاد ترجع لور فالشومبر",
     "قص الطراف ديال الجنابات (1 سم) — الجنابات مسدودة = الطبقات ما تفتحش فالفران",
     "قطع بنودة 10 × 26 سم، وزن أول تلاتة : 90 غرام زايد ناقص 2"]},

  {"ordre":2,"nom":"Façonnage (30 s/pièce)","nom_ar":"التشكيل (30 ثانية فالقطعة)",
   "duree_estimee_min":15,"est_bloquante":true,"timer_auto":false,"controle_qualite":true,
   "est_repetable":true,"nb_repetitions":24,"responsable_role":null,
   "checklist_items":[
     "Bande dans le sens de la longueur, pulvérisation LÉGÈRE d''eau",
     "Saupoudrer 8 g de sucre semoule sur la moitié basse, 1,5 cm de marge (sinon caramélise sur la plaque)",
     "Rabattre en deux dans la longueur → bande 5 × 26 cm, souder au rouleau",
     "Fendre dans la longueur, laisser 2 cm non coupés en haut",
     "Torsader 3 tours COMPLETS, faces coupées visibles dessus (vitrine)",
     "Poser sur plaque, PRESSER LES DEUX EXTRÉMITÉS au pouce (sinon la torsade se déroule)",
     "Espacement 6 cm — ≈ 12 pièces sur plaque 60 × 40"],
   "checklist_items_ar":[
     "حط البند بالطول، رش رشة خفيفة ديال الما بالپولفيريزاتور",
     "رش 8 غرام ديال السكر على النص ديال تحت، خلي 1.5 سم فارغين فالجنابات (بلاهم كيتحرق ويلصق)",
     "طوي على جوج بالطول ← بند 5 × 26 سم، مر الرولو بشوية باش يلصق",
     "شق البند بالطول من الوسط، خلي 2 سم ماشي مقطوعين فالراس",
     "لف 3 دورات كاملة، الوجه المقطوع للفوق (هو لي كيبان فيه التوريق فالفيترينة)",
     "حطها فالبلاطو، ضغط الجوج ديال الطراف بالإبهام بالقوة (بلاها الطورصاد كتحل راسها)",
     "6 سم بين كل قطعة — تقريباً 12 قطعة فالبلاطو 60 × 40"]},

  {"ordre":3,"nom":"Apprêt","nom_ar":"الشومبر",
   "duree_estimee_min":135,"est_bloquante":true,"timer_auto":true,"controle_qualite":true,
   "est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Étuve 26-27 °C — MAXIMUM 28 °C (le beurre fond à 30)",
     "Hygrométrie 75 %",
     "Durée 2 h à 2 h 30",
     "3 repères : volume doublé + pièce qui tremble à la secousse + couches de beurre visibles sur la tranche",
     "PLUTÔT LENT que rapide : 3 h à 25 °C >>> 1 h 30 à 30 °C"],
   "checklist_items_ar":[
     "الشومبر ما بين 26 و27 درجة — الماكسيموم 28، الزبدة كتذوب ف 30",
     "الرطوبة 75 بالمية",
     "المدة : ساعتين ل ساعتين ونص",
     "3 علامات : الحجم تضاعف + القطعة كترجرج بحال الجيلي + الطبقات ديال الزبدة باينين فالوجه المقطوع",
     "الأحسن بطيء ماشي مزروب : 3 سوايع ف 25 درجة خير بزاف من ساعة ونص ف 30"]},

  {"ordre":4,"nom":"Dorure (2 passes)","nom_ar":"الدهان (فجوج بيوس)",
   "duree_estimee_min":5,"est_bloquante":true,"timer_auto":false,"controle_qualite":true,
   "est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Dorure FINE avant étuve (empêche le croûtage)",
     "2ᵉ passe après étuve, juste avant le four (3 g/pièce)",
     "Pinceau souple, dans le sens de la torsade",
     "JAMAIS sur les tranches coupées — la dorure colle les feuillets et le feuilletage ne s''ouvre pas",
     "Pas de flaque dans les creux (points noirs à la cuisson)"],
   "checklist_items_ar":[
     "الدهان لول : رقيق قبل الشومبر — باش الوجه ما يجفش",
     "الدهان الثاني : من بعد الشومبر نيشان قبل الفران (3 غرام فالقطعة)",
     "خدم بشيتا رقيقة، فاتجاه اللفة",
     "عمرك ما تلمس بالشيتا الوجه المقطوع — البيض كيلصق الطبقات وما كتفتحش فالفران",
     "ما تخليش البيض يتجمع فالحفر — كينطاب ويخلي بقع كحلة"]},

  {"ordre":5,"nom":"Cuisson (four ventilé 165-170 °C)","nom_ar":"الطياب (الفران الفونتيلي 165-170 درجة)",
   "duree_estimee_min":18,"est_bloquante":true,"timer_auto":true,"controle_qualite":true,
   "est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "Enfourner buée FERMÉE, ouvrir le clapet à 8 min",
     "Ventilé 165-170 °C : 16-18 min ; sole/voûte 190/180 °C : 18-20 min",
     "Si le four est déséquilibré : tourner les plaques à mi-cuisson",
     "Contrôle : dessus acajou uniforme + SOULEVER 1 pièce, le dessous doit être BIEN COLORÉ",
     "Dessous blanc = intérieur cru — remettre 2-3 min"],
   "checklist_items_ar":[
     "دخلهم والكلي (فتحة البخار) مسدودة، حلها من بعد 8 دقايق",
     "الفران الفونتيلي 165-170 درجة : 16-18 دقيقة ؛ بالسول 190 تحت / 180 فوق : 18-20 دقيقة",
     "إلا الفران ماشي متوازن : دور البلاطوات فالنص",
     "المراقبة : اللون من فوق بحال الأكاجو + هز قطعة وشوف تحتها، خاصها تكون محمّرة",
     "القاع بيض = من الداخل ماشي طايب — رجعها 2-3 دقايق"]},

  {"ordre":6,"nom":"Finition (sirop + ressuage)","nom_ar":"السيرو والتبريد",
   "duree_estimee_min":35,"est_bloquante":true,"timer_auto":false,"controle_qualite":true,
   "est_repetable":false,"nb_repetitions":1,"responsable_role":null,
   "checklist_items":[
     "À la sortie du four (encore brûlant) : siroper au pinceau (4 g/pièce)",
     "Transférer IMMÉDIATEMENT sur grille (pas sur plaque : vapeur → dessous mou)",
     "Refroidir 30 min minimum",
     "Sucre glace éventuel : UNIQUEMENT une fois complètement froid",
     "Ne JAMAIS filmer une pièce tiède"],
   "checklist_items_ar":[
     "نيشان منين تخرج من الفران وهي سخونة : دهنها بالسيرو بالشيتا (4 غرام فالقطعة)",
     "نقلهم دغيا للشبكة (ماشي فالبلاطو : البخار كيخلي القاع مطاطي)",
     "خليهم يبردو نص ساعة على الأقل",
     "السكر الگلاصي إلا بغيتي : من بعد ما يبردو نيشان، ماشي دافيين",
     "عمرك ما تغطي ولا تدير فالساشي قطعة دافية"]}
]'::jsonb,
       updated_at = NOW()
 WHERE id = 'fab28200-0000-4000-8000-000000000127';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Contrôles finaux — les deux tableaux existent sur chaque étape.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r_id UUID; nb INT;
BEGIN
  FOR r_id IN VALUES
    ('fab28000-0000-4000-8000-000000000104'::uuid),
    ('fab28200-0000-4000-8000-000000000127'::uuid)
  LOOP
    SELECT count(*) INTO nb
      FROM recipes r,
           jsonb_array_elements(r.etapes) e
     WHERE r.id = r_id
       AND (e.value ? 'checklist_items_ar')
       AND (e.value ? 'nom_ar');
    IF nb = 0 THEN
      RAISE EXCEPTION 'Recette % : aucune étape avec nom_ar + checklist_items_ar', r_id;
    END IF;
  END LOOP;
END $$;

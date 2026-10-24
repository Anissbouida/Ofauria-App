-- Migration 293 : Torsade nature sucre — split des étapes base ↔ produit
--
-- POURQUOI
--   La mig 292 avait posé les 11 étapes de la masterclass SUR le produit fini
--   Torsade. C'est incorrect : les étapes 1-5 (température d'eau, pétrissage,
--   pointage/blocage, beurre de tourage, enchâssage + tours) fabriquent la
--   PÂTE LEVÉE FEUILLETÉE — pas la Torsade. Cette pâte est la BASE partagée
--   par toutes les viennoiseries feuilletées (torsade, croissant, pain suisse,
--   danish, chausson, jalousie, palmier…).
--
--   Poser ces étapes sur la Torsade veut dire que le pétrisseur qui fabrique la
--   Torsade referait le pétrissage ; en réalité la PLF est pétrie une seule
--   fois pour toute la fournée du matin, puis répartie entre les produits.
--   Les étapes doivent donc vivre sur la RECETTE DE BASE.
--
--   Split correct :
--     PLF (fab28000-…-0104)  : 5 étapes de fabrication de la pâte
--     Torsade (fab28200-…-127): 6 étapes de mise en forme du produit
--
--   Bonus : les autres viennoiseries feuilletées (croissant, pain au chocolat,
--   pain suisse, danish, chausson, jalousie, palmier…) héritent automatique-
--   ment des 5 étapes PLF puisqu'elles pointent sur la même base — plus besoin
--   de dupliquer.
--
-- PORTÉE
--   + recipes.etapes (PLF) ← 5 étapes 1-5 (renumérotées 1-5)
--   + recipes.instructions (PLF) ← notes techniques pétrissage + tourage
--   + recipes.etapes (Torsade) ← 6 étapes 6-11 (renumérotées 1-6)
--   + recipes.instructions (Torsade) ← paramètres produit (rendement, planning,
--     conservation, allergènes) sans redite avec la PLF
--   Bilingue FR/AR conservé, source masterclass V3 août 2026.
--
-- INVERSION
--   Réappliquer la mig 292 : elle repose les 11 étapes sur la Torsade et laisse
--   la PLF sans étapes.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Étapes 1-5 sur la Pâte levée feuilletée (base partagée).
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
     "🇲🇦 إلا رجعات لور : وقف نيشان، رجعها 15 دقيقة فالفريكو"]}
]'::jsonb,
       instructions = 'PÂTE LEVÉE FEUILLETÉE — base viennoiserie sucrée (source masterclass V3 août 2026).

━━━ FR ━━━

Détrempe (1 850 g) : 1 000 g farine T45 (W 280-300) + 350 g lait 4 °C + 100 g eau glacée + 100 g œufs + 120 g sucre + 45 g levure fraîche + 20 g sel + 30 g lait poudre + 80 g beurre pommade + 5 g malt/améliorant.
Tourage : 500 g beurre 84 % MG (jamais de beurre ordinaire à 82 % — trop d''eau, il coupe la pâte).
Total pâton : 2 350 g pour 1 kg de farine. Perte détaillage ≈ 5 % → pâte nette 2 230 g.

Tourage : 1 tour double + 1 tour simple, repos 30 min à 4 °C entre chaque = 12 couches de beurre. Détailler à 3,5 mm.

Timing J-1 : pétrissage 15 h → pointage 30 min → blocage 40 min à −18 °C → froid 4 °C 12 h minimum.
Timing J : sortir à 4 h, laisser détendre 15 min avant tourage.

━━━ 🇲🇦 بالدارجة ━━━

العجينة (1850 غ) : 1 كيلو فارينة T45 قوية + 350 غ حليب بارد + 100 غ ما بالتلج + 100 غ بيض + 120 غ سكر + 45 غ خميرة طرية + 20 غ ملحة + 30 غ حليب دلابودرة + 80 غ زبدة طرية + 5 غ أميليوران.
التوراج : 500 غ زبدة التوراج 84% (عمرك ما تبدلها بالزبدة العادية — فيها الما بزاف وكتقطع العجينة).
المجموع : 2350 غ من كيلو فارينة. الطراف 5% → 2230 غ صافية.

التوراج : تور دوبل + تور سامبل، الراحة 30 دقيقة فالفريكو بين كل واحد = 12 طبقة ديال الزبدة. رقق ل 3.5 مم.

الوقت J-1 : العجين ف 15 ساعة → البونطاج 30 دقيقة → البلوكاج 40 دقيقة ف −18 → الفريكو 4 درجات ل 12 ساعة على الأقل.
الوقت J : خرجها ف 4 ساعة، خليها ترتاح 15 دقيقة قبل التوراج.

Utilisée par : Torsade nature sucre, Croissant, Pain au chocolat, Pain suisse, Danish, Chausson, Jalousie, Palmier, Flan, Beignet, Bostock… (toutes les viennoiseries feuilletées).',
       updated_at = NOW()
 WHERE id = 'fab28000-0000-4000-8000-000000000104';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Étapes 6-11 renumérotées 1-6 sur la Torsade nature sucre.
--    Ne restent que les étapes propres au produit : abaisse+détaillage,
--    façonnage (sucre + torsion), apprêt, dorure, cuisson, finition.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE recipes
   SET etapes = '[
  {"ordre":1,"nom":"Abaisse et détaillage · الترقيق والتقطاع","duree_estimee_min":25,
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
  {"ordre":2,"nom":"Façonnage (30 s/pièce) · التشكيل","duree_estimee_min":15,
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
  {"ordre":3,"nom":"Apprêt · الشومبر","duree_estimee_min":135,
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
  {"ordre":4,"nom":"Dorure (2 passes) · الدهان","duree_estimee_min":5,
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
  {"ordre":5,"nom":"Cuisson (four ventilé 165-170 °C) · الطياب","duree_estimee_min":18,
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
  {"ordre":6,"nom":"Finition (sirop + ressuage) · السيرو والتبريد","duree_estimee_min":35,
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
       instructions = 'TORSADE NATURE SUCRE (SKU 10009) — mise en forme du produit. La fabrication de la pâte est décrite sur la fiche « Pâte levée feuilletée ».

━━━ FR ━━━

Pâton 90 g cru par pièce, sucre semoule 8 g/pièce à l''intérieur, dorure 3 g/pièce (2 passes), sirop 30°B 4 g/pièce en nappage à la sortie du four. Longueur 13-15 cm.

Rendement : 1 kg de farine → 24 pièces de 90 g cru. Perte de cuisson 14 % → pièce cuite ~77 g → pièce finie sirotée ~81 g. Un pétrin remplit 1 plaque 60×40 de 15 pièces (+ chutes).

Sirop 30°B : 500 g eau + 650 g sucre + 50 g glucose, porté à ébullition, refroidi à 60 °C. Se garde 15 jours au froid.

Conservation : vente le jour même (DLC vitrine 24 h). Ne jamais mettre en sachet une pièce tiède.
Surgélation crue possible après façonnage (−35 °C / 40 min puis bac hermétique, 3 semaines max à −18 °C), remise en étuve directe 3 h à 26 °C.
Surgélation précuite (80 % de cuisson, 12 min) : 6 semaines à −18 °C, finition 7-8 min à 180 °C + sirop.

Défauts rédhibitoires (retirés de la vente) : beurre coulé sur la plaque · torsade détordue · dessous blanc · sucre caramélisé et collé.

Allergènes : gluten (farine), œufs (dorure + détrempe), lait et beurre (détrempe + tourage).

━━━ 🇲🇦 بالدارجة ━━━

الپاتون 90 غرام خاوية فالقطعة، السكر 8 غ فالقطعة داخل، الدهان 3 غ فالقطعة (فجوج بيوس)، السيرو 30°B 4 غ فالقطعة من بعد الفران. الطول 13-15 صونتيم.

التخراج : كيلو فارينة → 24 قطعة ديال 90 غ خاوية. القطعة كتنقص 14% فالفران → ~77 غ مطيبة → ~81 غ نهائية بالسيرو. الپترينة كتعمر بلاطو 60×40 ب 15 قطعة (+ الطراف).

السيرو 30°B : 500 غ ما + 650 غ سكر + 50 غ گليكوز، غليه مرة وحدة وبرّدو حتى ل60 درجة. كيقعد 15 نهار فالفريكو.

التخزين : البيع نفس النهار (الصلاحية 24 ساعة). عمرك ما تدير قطعة دافية فالساشي.
كتقدر تبرد بعد التشكيل (−35 درجة / 40 دقيقة، صندوق مسدود، 3 سيمانات ماكسيموم ف −18)، دخلها نيشان للشومبر 3 ساعة ف 26 درجة.
مطيب نص طياب (80%، 12 دقيقة) : 6 سيمانات ف −18، تكميل 7-8 دقايق ف 180 درجة + السيرو.

العيوب لي كتحيد القطعة من البيع : الزبدة سالت فالبلاطو · الطورصاد حلات راسها · القاع بيض · السكر تحرق ولصق.

المسببات الحساسية : الگلوتين، البيض، الحليب والزبدة.

Source · المصدر : fiche masterclass Ôfauria V3, août 2026.',
       updated_at = NOW()
 WHERE id = 'fab28200-0000-4000-8000-000000000127';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Contrôles finaux.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n_plf INT;
  n_tor INT;
BEGIN
  SELECT jsonb_array_length(etapes) INTO n_plf
    FROM recipes WHERE id = 'fab28000-0000-4000-8000-000000000104';
  IF n_plf <> 5 THEN
    RAISE EXCEPTION 'PLF : etapes = %, 5 attendues (pétrissage → tourage)', n_plf;
  END IF;

  SELECT jsonb_array_length(etapes) INTO n_tor
    FROM recipes WHERE id = 'fab28200-0000-4000-8000-000000000127';
  IF n_tor <> 6 THEN
    RAISE EXCEPTION 'Torsade : etapes = %, 6 attendues (abaisse → finition)', n_tor;
  END IF;
END $$;

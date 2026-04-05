#!/usr/bin/env node
/**
 * Script to download food images from Pexels and upload them to products
 * Uses curl for all HTTP requests (more reliable than Node fetch with Pexels)
 */
import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const API_BASE = 'http://localhost:3001/api/v1';
const PEXELS_KEY = 'NNP4x3MpKBXvlh48gDnEmJLzQjHkVy6jCW8E0iqxVlHsJBuvxd6qj9oq';
const TOKEN = process.argv[2] || '';

if (!TOKEN) {
  console.error('Usage: node scripts/upload-product-images.mjs <auth-token>');
  process.exit(1);
}

const SEARCH_TERMS = {
  "TROMPE L'ŒIL FRAMBOISE": "raspberry mousse cake",
  "TROMPE L'OEIL COCO": "coconut mousse cake",
  "TRIO": "french pastry assorted",
  "OPÉRA": "opera cake",
  "OFAURIA": "french pastry cake elegant",
  "NOISETTE": "hazelnut cake",
  "RED VELVET": "red velvet cake",
  "ROYAL": "royal chocolate mousse cake",
  "FRAISIER": "strawberry fraisier cake",
  "FORÊT NOIR": "black forest cake",
  "CHEESECAKE FRAMBOISE": "raspberry cheesecake",
  "CHEESECAKE CITRON": "lemon cheesecake",
  "CASABLANCA": "elegant french pastry",
  "CRUNCHÉ CARAMEL": "caramel crunch dessert",
  "AMANDINE": "almond tart pastry",
  "ÉCLAIRE FRAISE": "strawberry eclair",
  "TARTE POMME ET AMANDE": "apple almond tart",
  "TARTE BANANE AU CHOCOLAT": "banana chocolate tart",
  "TARTE FRAMBOISE": "raspberry tart",
  "TARTE CITRON": "lemon tart",
  "TARTE CHOCOLAT": "chocolate tart",
  "TARTE AUX FRUITS": "fruit tart",
  "TARTE GANACHE CHOCOLAT": "chocolate ganache tart",
  "TARTE CRÈME FRAÎCHE": "cream tart",
  "MILLE-FEUILLE": "mille feuille",
  "MILLE FEUILLES PRALINÉ": "mille feuille pastry",
  "MILLE FEUILLE CHOCOLAT": "chocolate mille feuille",
  "ROULET CITRON": "lemon swiss roll",
  "ÉCLAIR VANILLE": "vanilla eclair",
  "ÉCLAIR FRAMBOISE": "raspberry eclair",
  "ÉCLAIR CHOCOLAT": "chocolate eclair",
  "GÂTEAUX MOELLEUX": "soft cake french",
  "CAKE OREO": "oreo cake",
  "CAKE CAROTTE": "carrot cake",
  "MACARON 6 PS": "box macarons",
  "TORSADE CHOCO/CRÉME PÂTISSIÈRE": "chocolate twist pastry",
  "TORSADE": "twisted pastry bread",
  "QRACHEL": "moroccan pastry traditional",
  "PALMIER SUCRÉ": "palmier pastry cookie",
  "PAINS AU CHOCOLAT BICOLORES": "pain au chocolat",
  "PAIN SUISSE NOIR": "dark pain suisse pastry",
  "PAIN SUISSE": "pain suisse pastry",
  "PAIN DOUBLE CHOCO": "double chocolate bread",
  "PAIN AU RAISIN": "pain raisin pastry",
  "PAIN AU CHOCOLAT NOIR": "dark chocolate pastry",
  "PAIN AU CHOCOLAT COMPLET": "pain au chocolat",
  "PAIN AU CHOCOLAT": "pain au chocolat croissant",
  "DANISH FRUITS": "fruit danish pastry",
  "DANISH FRAMBOISE/CHOCO": "raspberry danish",
  "DANISH CRÈME PÂTISSIÈRE": "custard danish",
  "DANISH CHOCOLAT": "chocolate danish",
  "DANISH ABRICOT": "apricot danish",
  "CROISSANT COMPLET": "whole wheat croissant",
  "CROISSANT BICOLORE CACAO": "chocolate croissant",
  "CROISSANT AU CHOCOLAT NOIR": "dark chocolate croissant",
  "CROISSANT AMÉRICAIN": "croissant new york",
  "CROISSANT SALÉ": "savory croissant cheese",
  "CROISSANT": "butter croissant bakery",
  "CHAUSSON AUX POMMES": "apple turnover pastry",
  "BRIOCHE FLEUR": "brioche bread",
  "BRIOCHE": "french brioche bread",
  "BEIGNETS CHOCO/CITRON/FRAMBOISE": "donut filled",
  "BEIGNETS": "french donut beignet",
  "BOSTOCK CRÈME PÂTISSIÈRE": "almond pastry bostock",
  "BOSTOCK AMANDE": "almond bostock bread",
  "BAGUETTE SUCRÉE": "sweet bread",
  "FOURRÉ AMANDE/CHOCO/CITRON": "filled pastry",
  "FOURRÉ AMANDE": "almond pastry filled",
  "FLAN VANILLE": "vanilla flan custard",
  "FEUILLETÉ FONDANT CHOCO": "chocolate puff pastry",
  "FEUILLETÉ CRÈME CITRON": "lemon cream pastry",
  "JALOUSIE ROND POMME": "apple puff pastry",
  "JALOUSIE ROND CHOCO": "chocolate puff pastry",
  "JALOUSIE ROND AMANDE": "almond puff pastry",
  "JALOUSIE GANACHE CHOCOLAT": "chocolate pastry puff",
  "JALOUSIE AUX POMMES": "apple pastry puff",
  "JALOUSIE AUX AMANDES": "almond pastry",
  "JALOUSIE ABRICOT": "apricot pastry puff",
  "NAVETTE AUX FRAMBOISE": "raspberry pastry",
  "MINI PAIN SUISSE": "mini pastry bread",
  "MINI PAIN AU RAISIN": "mini raisin pastry",
  "MINI PAIN AU CHOCOLAT": "mini pain chocolat",
  "MINI CROISSANT": "mini croissant",
  "TRANCHE CAKE CHOCO/CITRON/NATURE": "cake slice assorted",
  "GÂTEAUX FERRERO ROCHER": "ferrero rocher cake",
  "GÂTEAU FRUITS": "fruit cake layer",
  "CAKE ROCHER FRUITS SECS": "dried fruit cake",
  "CAKE ROCHER FRAMBOISE": "raspberry cake",
  "CAKE ROCHER CHOCOLAT": "chocolate cake",
  "CAKE NATURE": "pound cake plain",
  "CAKE FRUITS SECS": "fruit nut cake",
  "CAKE CITRON": "lemon cake",
  "CAKE CHOCOLAT": "chocolate cake dessert",
  "COOKIES PISTACHE": "pistachio cookie",
  "COOKIES FRAMBOISE": "raspberry cookie",
  "COOKIES CHOCOLAT": "chocolate chip cookie",
  "TIGRÉ MINI": "marble cake pastry",
  "TIGRÉ GRAND": "marble cake",
  "MUFFIN VANILLE": "vanilla muffin",
  "MUFFIN CHOCOLAT": "chocolate muffin",
  "MUFFIN CARAMEL": "caramel muffin",
  "MUFFINS MINI CHOCO /VANILLE": "mini muffins assorted",
  "MADELEINE CITRON": "lemon madeleine",
  "MADELEINE CHOCOLAT": "chocolate madeleine",
  "MADELEINE": "french madeleine cake",
  "FINANCIER MINI": "mini financier cake",
  "FINANCIER GRAND": "financier almond cake",
  "BROWNIE": "chocolate brownie",
  "MACARON VANILLE": "vanilla macaron",
  "MACARON PISTACHE": "pistachio macaron",
  "MACARON FRAMBOISE": "raspberry macaron",
  "MACARON CITRON": "lemon macaron",
  "MACARON CHOCOLAT": "chocolate macaron",
  "MACARON": "french macarons colorful",
  "SHABAKIA AMANDE": "chebakia moroccan honey",
  "SHABAKIA": "chebakia moroccan sesame",
  "SELLOU AMANDE": "moroccan sweet almond",
  "SABLÉ À LA CANELLE": "cinnamon shortbread",
  "SABLÉ": "shortbread cookie butter",
  "NID PISTACHE": "pistachio pastry nest",
  "MAÂMOUL": "maamoul date cookie",
  "MAAMOL": "maamoul semolina cookie",
  "M7ANCHA": "moroccan almond pastry",
  "LOZINE VANILLE": "moroccan pastry",
  "KNIZA AMANDE": "almond pastry moroccan",
  "KAABA": "moroccan almond crescent",
  "KAAB": "moroccan crescent pastry",
  "HARCHA BALBOULA": "moroccan semolina bread",
  "GHRIBA GUERGUAE": "moroccan coconut cookie",
  "GHRIBA ÉFILÉ": "almond cookie crinkle",
  "GHRIBA CAFÉ": "coffee cookie crinkle",
  "GHRIBA AMANDE": "almond crinkle cookie",
  "GHERIBA EFFILÉES": "almond sliced cookie",
  "GHERIBA CAFÉ": "coffee cookie",
  "GHERIBA BAHLA": "traditional cookie",
  "FEKKASS NATURE": "biscotti traditional",
  "FEKKASS COMPLET": "whole wheat biscotti",
  "FEKKAS COMPLET": "biscotti bread",
  "FEKASS COMPLET": "biscotti",
  "CORNE DE GAZELLE SÉSAME": "crescent cookie sesame",
  "CORNE DE GAZELLE": "almond crescent cookie moroccan",
  "BRIOUATE AMANDE": "almond pastry triangle",
  "BRIOUATE": "fried pastry triangle",
  "BOULE DE NEIGE": "snowball cookie coconut",
  "FEUILLETINE FROMAGE": "cheese pastry layers",
  "DORÉ FRAMBOISE": "raspberry pastry golden",
  "CERCLE LUNAIRE AMANDE FRAMBOISE": "almond raspberry pastry",
  "BATBOUT MINI": "moroccan bread mini flatbread",
  "BATBOUT": "moroccan flatbread",
  "SANDWICH THON": "tuna sandwich",
  "SANDWICH POULET": "chicken sandwich",
  "QUICHE SEMON": "salmon quiche",
  "QUICHE ÉPINARD AU FROMAGE": "spinach cheese quiche",
  "QUICHE AUX CHAMPIGNONS OIGNON CARAMÉLISÉ": "mushroom quiche",
  "QUICHE AU JAMBON": "ham quiche",
  "PIZZA VIANDE HACHÉE": "meat pizza",
  "PIZZA POULET/THON": "chicken pizza",
  "PIZZA CARRÉ AU THON": "tuna pizza",
  "PASTILLA AUX FRUITS DE MER": "seafood pie pastry",
  "PASTILLA AU POULET": "chicken pie pastry",
  "CROC MONSIEUR MINI": "mini croque monsieur",
  "CROC MONSIEUR": "croque monsieur",
  "HARSHA OLIVE": "olive bread flatbread",
  "HARSHA FROMAGE": "cheese flatbread",
  "HARSHA": "semolina bread flatbread",
  "MSEMMEN AU OLIVE": "olive flatbread moroccan",
  "MSEMMEN AU KHLII": "moroccan meat flatbread",
  "MINI TACOS": "mini tacos",
  "MINI PASTILLA AUX FRUITS DE MER": "mini seafood pie",
  "MINI PASTILLA AU POULET": "mini chicken pie",
  "MINI MSEMMEN NATURE": "mini flatbread",
  "MINI MSEMMEN AU KHLII": "mini meat flatbread",
  "MINI BURGER": "mini burger slider",
  "MINI BATBOUT FARCÉ": "stuffed flatbread",
  "NID AU FROMAGE ET SOUREMI": "cheese pastry nest",
  "NEMS AUX LÉGUMES": "vegetable spring roll",
  "NEMS AU POULET": "chicken spring roll",
  "ESCARGOT AU GOMBON": "spiral pastry savory",
  "BRIOUTE POULET": "chicken pastry triangle",
  "BRIOUAT VIANDE HACHÉE": "meat pastry fried",
  "BEBE SANDWICH COMPLET": "mini whole wheat sandwich",
  "BEBE MSEMEN OLIVE": "mini olive flatbread",
  "BEBE MSEMEN NATURE": "mini flatbread plain",
  "BEBE MSEMEN FARCÉ VIANDE": "stuffed mini flatbread",
  "BEBE BATBOUT 1PIECE": "mini flatbread bread",
  "BEBE BATBOUT": "mini flatbread batch",
  "BAGHRIR": "moroccan pancake thousand holes",
  "SANDWICH TRADITION": "bread sandwich",
  "SANDWICH NATURE SNAK": "bread roll",
  "SANDWICH NATURE": "sandwich bread loaf",
  "SANDWICH BELDI": "moroccan bread loaf",
  "SANDWICH BELDI1KG": "moroccan traditional bread",
  "PAIN SEMOULE": "semolina round bread",
  "PAIN SANDWICH NORMALE": "sandwich bread white",
  "PAIN SANDWICH COMPLET": "whole wheat bread",
  "PAIN ORIENTAL": "oriental bread",
  "PAIN NATURE SNAK": "bread roll plain",
  "PAIN NATURE": "white bread artisan",
  "PAIN MAISON": "homemade bread artisan",
  "PAIN MAÏS": "cornbread",
  "PAIN D'ORGE MINI": "barley bread",
  "PAIN COMPLET SANS SEL": "unsalted wheat bread",
  "PAIN COMPLET": "whole wheat bread round",
  "PAIN CHOUFANE": "oat bread",
  "MINI PAIN MAISON": "mini artisan bread roll",
  "BAGUETTE CHOFANE": "oat baguette",
  "BAGUETTE CÉRÉALES": "multigrain baguette",
  "BAG TRADITION SÉSAME": "sesame baguette",
  "BAG TRADITION PAVOT": "poppy seed baguette",
  "BAG TRADITION OLIVE": "olive baguette bread",
  "BAG TRADITION CÉRÉALE": "multigrain baguette bread",
  "BAG SEMOULE": "semolina baguette",
  "BAG SANDWICH À L'ANCIENNE": "french baguette sandwich",
  "BAG ORGE": "barley baguette bread",
  "BAG NORMAL": "french baguette traditional",
  "BAG NORM SÉSAME": "sesame french baguette",
  "BAG NORM FARINE": "white french baguette",
  "BAG COMPLET": "whole wheat baguette",
  "BAG À L'ANCIENNE": "french baguette artisan",
  "PLATEAUX MIXTE": "pastry platter assorted",
  "PLATEAU SOIRÉE": "appetizer platter evening",
  "PLATEAU SOIRÉE MINI": "mini appetizer platter",
  "PLATEAU SALÉE": "savory platter appetizer",
  "PLATEAU SALÉ": "savory appetizer tray",
  "PLATEAU SABLÉ GRAND": "cookie platter assorted",
  "PLATEAU SABLÉ": "shortbread platter",
  "PLATEAU PRESTIGE MINI": "mini pastry assortment luxury",
  "PLATEAU PRESTIGE": "luxury pastry platter",
  "PLATEAU BELDI GRAND": "traditional pastry platter",
  "PLATEAU BELDI": "moroccan pastry assortment",
  "SACHET MINI PALMIER": "mini palmier cookie",
  "SACHET MADELEINE MINI": "mini madeleine pack",
  "SACHET MADELEINE GRAND": "madeleine bag",
  "MERINGUE": "meringue cookie",
  "CROQUANTS AUX GINGEMBRE": "ginger cookie",
  "AMUSE-GUEULES SALÉ": "savory snack appetizer",
  "NID D'ANGE": "pastry box gift",
  "FINANCIER AUX DATTES": "date financier cake",
  "FINANCIER ABRICOT": "apricot financier",
  "FEKKASS CRÈME FRAÎCHE": "cream biscuit",
  "FAKKAS DENTELLE": "lace cookie",
  "BOULE CHOCO PRALINÉ": "chocolate truffle praline",
  "FEUILLES D'AUTOMNE": "chocolate layer cake",
  "FEUILLE D'AUTOMNE": "chocolate praline cake",
  "FEUILLE": "layer cake",
  "O FAURIA": "signature bakery cake",
  "CAKE ROCHER TRANCHE": "cake slice",
  "CASABLANCA 8PERSONNES": "elegant cake",
  "CASABLANCA 10 PERSONNES": "large elegant cake",
  "CASABLANCA 6 PERSONNE": "medium elegant cake",
  "LE RESTE DU PLATEAU MIXTE": "pastry assortment",
  "LE RESTE DE LA COMMANDE GÂTEAU ANNIVERSAIRE": "birthday cake",
  "LE RESTE DE LA COMMANDE DES PLATEAUX": "pastry tray",
  "AVANCE SUR GÂTEAUX": "bakery cake display",
  "AVANCE SUR GÂTEAU ROYAL 10 PERSONNES": "royal chocolate cake",
  "AVANCE SUR GÂTEAU O FAURIA 15 PERSONNES": "large bakery cake",
  "AVANCE 2": "moroccan pastry box",
  "AVANCE": "moroccan pastry traditional",
  "NOISETTE 8PERSONNES": "hazelnut cake large",
  "NOISETTE 6 PERSONNES": "hazelnut mousse cake",
  "FRAISIER 15PERSONNES": "large strawberry cake",
  "GÂTEAUX FERRERO ROCHER": "ferrero rocher cake",
  "GÂTEAU FRUITS": "fresh fruit cake",
  "ROYAL 10PERSONNES": "large chocolate cake",
};

function getSearchTerm(name, category) {
  if (SEARCH_TERMS[name]) return SEARCH_TERMS[name];
  for (const [key, val] of Object.entries(SEARCH_TERMS)) {
    if (name.startsWith(key)) return val;
  }
  let term = name.toLowerCase()
    .replace(/\d+\s*(g|kg|p|prs|personnes?)\b/gi, '')
    .replace(/[éèêë]/g,'e').replace(/[àâ]/g,'a').replace(/[ùû]/g,'u')
    .replace(/[ôö]/g,'o').replace(/[îï]/g,'i').replace(/ç/g,'c')
    .replace(/['/]/g,' ').trim();
  const cat = (category || '').toLowerCase();
  if (cat.includes('beldi')) term += ' moroccan pastry';
  else if (cat.includes('viennois')) term += ' french pastry';
  else if (cat.includes('salé') || cat.includes('sale')) term += ' savory food';
  else if (cat.includes('pain') || cat.includes('baguette')) term += ' bread bakery';
  else if (cat.includes('pâtisserie')) term += ' french pastry';
  else term += ' bakery food';
  return term;
}

function baseName(name) {
  return name.replace(/\s+\d+\s*(G|KG|P|PRS|PERSONNES?)\s*$/i, '')
    .replace(/\s+\d+\s*$/,'').trim();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function curlJson(url, headers = {}) {
  const headerArgs = Object.entries(headers).map(([k,v]) => `-H "${k}: ${v}"`).join(' ');
  try {
    const result = execSync(`curl -s "${url}" ${headerArgs} --max-time 10`, { timeout: 15000 });
    return JSON.parse(result.toString());
  } catch (e) {
    return null;
  }
}

function searchPexelsImage(query) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=square`;
  const data = curlJson(url, { 'Authorization': PEXELS_KEY });
  if (data && data.photos && data.photos.length > 0) {
    return data.photos[0].src.medium;
  }
  return null;
}

async function main() {
  console.log('Fetching products...');
  const data = curlJson(`${API_BASE}/products?limit=500`, { 'Authorization': `Bearer ${TOKEN}` });
  if (!data || !data.data) { console.error('Failed to fetch products'); process.exit(1); }

  const products = data.data.filter(p => !p.image_url || !p.image_url.startsWith('/uploads/'));
  console.log(`Found ${products.length} products without real images`);

  const groups = {};
  products.forEach(p => {
    const base = baseName(p.name);
    if (!groups[base]) groups[base] = { products: [], searchTerm: '' };
    groups[base].products.push(p);
    if (!groups[base].searchTerm) {
      groups[base].searchTerm = getSearchTerm(base, p.category_name);
    }
  });

  const groupKeys = Object.keys(groups);
  console.log(`${groupKeys.length} unique product groups\n`);

  let success = 0, failed = 0;
  const tmpFile = join(tmpdir(), 'ofauria_img.jpg');

  for (let i = 0; i < groupKeys.length; i++) {
    const base = groupKeys[i];
    const group = groups[base];
    const term = group.searchTerm;

    process.stdout.write(`[${i+1}/${groupKeys.length}] ${base} → "${term}" ... `);

    try {
      // Search Pexels
      let imgUrl = searchPexelsImage(term);

      // Fallback: try first 2 words
      if (!imgUrl) {
        const fallback = term.split(' ').slice(0, 2).join(' ');
        imgUrl = searchPexelsImage(fallback);
      }

      // Fallback 2: try just first word
      if (!imgUrl) {
        const fallback2 = term.split(' ')[0];
        imgUrl = searchPexelsImage(fallback2);
      }

      if (!imgUrl) {
        console.log('❌ No image');
        failed += group.products.length;
        continue;
      }

      // Download
      execSync(`curl -sL -o "${tmpFile}" "${imgUrl}" --max-time 10`, { timeout: 15000 });
      const size = parseInt(execSync(`wc -c < "${tmpFile}"`).toString().trim());
      if (size < 3000) {
        console.log(`❌ Too small (${size}b)`);
        failed += group.products.length;
        continue;
      }

      // Upload to all variants
      let ok = 0;
      for (const product of group.products) {
        try {
          execSync(`curl -s -X POST "${API_BASE}/products/${product.id}/image" -H "Authorization: Bearer ${TOKEN}" -F "image=@${tmpFile};type=image/jpeg"`, { timeout: 15000 });
          success++;
          ok++;
        } catch {
          failed++;
        }
      }
      console.log(`✅ ${ok} uploaded`);

      // Rate limit respect
      await sleep(350);
    } catch (e) {
      console.log(`❌ ${e.message?.substring(0, 60)}`);
      failed += group.products.length;
    }
  }

  if (existsSync(tmpFile)) unlinkSync(tmpFile);

  console.log(`\n=== DONE ===`);
  console.log(`✅ ${success} images uploaded`);
  console.log(`❌ ${failed} failed`);
}

main().catch(e => { console.error(e); process.exit(1); });

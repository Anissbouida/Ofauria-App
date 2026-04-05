#!/usr/bin/env node
/**
 * V2: Uses Pexels with broader search terms + category-level fallbacks
 * Also uses multiple Pexels search pages to get variety
 */
import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const API_BASE = 'http://localhost:3001/api/v1';
const PEXELS_KEY = 'NNP4x3MpKBXvlh48gDnEmJLzQjHkVy6jCW8E0iqxVlHsJBuvxd6qj9oq';
const TOKEN = process.argv[2] || '';

if (!TOKEN) {
  console.error('Usage: node scripts/upload-product-images-v2.mjs <auth-token>');
  process.exit(1);
}

// Working Pexels terms mapped per product name (based on what actually returns results)
// Pexels working terms: croissant, eclair, pizza, brioche, chocolate, dessert, bakery, food, pancake, waffle
const PRODUCT_TERMS = {
  // Specific matches that work
  "CROISSANT": "croissant",
  "MINI CROISSANT": "croissant",
  "CROISSANT COMPLET": "croissant",
  "CROISSANT BICOLORE CACAO": "croissant",
  "CROISSANT AU CHOCOLAT NOIR": "croissant",
  "CROISSANT AMÉRICAIN": "croissant",
  "CROISSANT SALÉ": "croissant",
  "PAIN AU CHOCOLAT": "croissant",
  "PAIN AU CHOCOLAT NOIR": "croissant",
  "PAIN AU CHOCOLAT COMPLET": "croissant",
  "PAINS AU CHOCOLAT BICOLORES": "croissant",
  "MINI PAIN AU CHOCOLAT": "croissant",
  "ÉCLAIR VANILLE": "eclair",
  "ÉCLAIR FRAMBOISE": "eclair",
  "ÉCLAIR CHOCOLAT": "eclair",
  "ÉCLAIRE FRAISE": "eclair",
  "PIZZA VIANDE HACHÉE": "pizza",
  "PIZZA POULET/THON": "pizza",
  "PIZZA CARRÉ AU THON": "pizza",
  "BRIOCHE": "brioche",
  "BRIOCHE FLEUR": "brioche",
  "PANCAKE": "pancake",
  "BAGHRIR": "pancake",
  "WAFFLE": "waffle",
};

// Category-level fallback terms (working Pexels terms only)
const CATEGORY_TERMS = {
  "PÂTISSERIE PREMIUM": ["dessert", "chocolate"],
  "PÂTISSERIE CLASSIQUE": ["dessert", "chocolate"],
  "VIENNOISERIES": ["croissant", "brioche"],
  "GÂTEAUX & COOKIES🍞": ["dessert", "chocolate"],
  "PIÈCES & PORTIONS": ["dessert", "chocolate"],
  "MACARON": ["dessert", "chocolate"],
  "BELDI": ["bakery", "food"],
  "SALÉ": ["pizza", "food"],
  "SALÉ & SOIRÉE": ["food", "pizza"],
  "PAIN ROND": ["bakery", "food"],
  "PAIN SANDWICH": ["bakery", "food"],
  "BAGUETTE": ["bakery", "food"],
  "BAGUETTE TRADITION": ["bakery", "food"],
  "PLATEAU SALÉ & SUCRÉ": ["food", "bakery"],
  "SACHET MINI": ["bakery", "dessert"],
  "LES BOÎTES": ["chocolate", "dessert"],
};

function baseName(name) {
  return name.replace(/\s+\d+\s*(G|KG|P|PRS|PERSONNES?)\s*$/i, '')
    .replace(/\s+\d+\s*$/,'').trim();
}

async function fetchJson(url, headers = {}) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

// Cache to avoid re-downloading same image
const imageCache = {};

async function searchPexelsImage(query, page = 1) {
  const cacheKey = `${query}_${page}`;
  if (imageCache[cacheKey]) return imageCache[cacheKey];

  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&page=${page}`;
  const data = await fetchJson(url, { 'Authorization': PEXELS_KEY });
  if (data && data.photos && data.photos.length > 0) {
    const urls = data.photos.map(p => p.src.medium);
    imageCache[cacheKey] = urls;
    return urls;
  }
  return [];
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('Fetching products...');
  const data = await fetchJson(`${API_BASE}/products?limit=500`, { 'Authorization': `Bearer ${TOKEN}` });
  if (!data || !data.data) { console.error('Failed to fetch products'); process.exit(1); }

  const products = data.data.filter(p => !p.image_url || !p.image_url.startsWith('/uploads/'));
  console.log(`Found ${products.length} products without real images\n`);

  if (products.length === 0) {
    console.log('All products have images!');
    return;
  }

  let success = 0, failed = 0;
  const tmpFile = join(tmpdir(), 'ofauria_img2.jpg');

  // Pre-fetch image pools for each working term
  const imagePools = {};
  const poolCounters = {};
  const workingTerms = ["croissant", "eclair", "pizza", "brioche", "chocolate", "dessert", "bakery", "food", "pancake", "waffle"];

  console.log('Pre-fetching image pools...');
  for (const term of workingTerms) {
    const urls1 = await searchPexelsImage(term, 1);
    const urls2 = await searchPexelsImage(term, 2);
    const urls3 = await searchPexelsImage(term, 3);
    imagePools[term] = [...urls1, ...urls2, ...urls3];
    poolCounters[term] = 0;
    console.log(`  ${term}: ${imagePools[term].length} images`);
    await sleep(200);
  }
  console.log('');

  function getNextImage(term) {
    if (!imagePools[term] || imagePools[term].length === 0) return null;
    const idx = poolCounters[term] % imagePools[term].length;
    poolCounters[term]++;
    return imagePools[term][idx];
  }

  function getTermForProduct(name, category) {
    const base = baseName(name);

    // Direct product match
    if (PRODUCT_TERMS[base]) return PRODUCT_TERMS[base];
    for (const [key, val] of Object.entries(PRODUCT_TERMS)) {
      if (base.startsWith(key)) return val;
    }

    // Category fallback — pick from category terms rotating
    const cat = category || '';
    const catTerms = CATEGORY_TERMS[cat];
    if (catTerms) {
      // Use product name hash to vary the term
      const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      return catTerms[hash % catTerms.length];
    }

    return 'food';
  }

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const term = getTermForProduct(p.name, p.category_name);

    process.stdout.write(`[${i+1}/${products.length}] ${p.name} → ${term} ... `);

    const imgUrl = getNextImage(term);
    if (!imgUrl) {
      console.log('❌ No pool');
      failed++;
      continue;
    }

    try {
      execSync(`curl -sL -o "${tmpFile}" "${imgUrl}" --max-time 10`, { timeout: 15000 });
      const size = parseInt(execSync(`wc -c < "${tmpFile}"`).toString().trim());
      if (size < 3000) {
        console.log(`❌ Too small`);
        failed++;
        continue;
      }

      execSync(`curl -s -X POST "${API_BASE}/products/${p.id}/image" -H "Authorization: Bearer ${TOKEN}" -F "image=@${tmpFile};type=image/jpeg"`, { timeout: 15000 });
      success++;
      console.log(`✅`);

      // Small delay
      if (i % 10 === 0) await sleep(200);
    } catch (e) {
      console.log(`❌ ${e.message?.substring(0, 50)}`);
      failed++;
    }
  }

  if (existsSync(tmpFile)) unlinkSync(tmpFile);

  console.log(`\n=== DONE ===`);
  console.log(`✅ ${success} images uploaded`);
  console.log(`❌ ${failed} failed`);
}

main().catch(e => { console.error(e); process.exit(1); });

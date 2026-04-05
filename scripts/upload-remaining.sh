#!/bin/bash
# Upload images for remaining products using curl + Pexels API
export PATH="/opt/homebrew/bin:$PATH"

API="http://localhost:3001/api/v1"
TOKEN="$1"
PEXELS="NNP4x3MpKBXvlh48gDnEmJLzQjHkVy6jCW8E0iqxVlHsJBuvxd6qj9oq"
TMP="/tmp/ofauria_img_final.jpg"

if [ -z "$TOKEN" ]; then echo "Usage: bash scripts/upload-remaining.sh <token>"; exit 1; fi

# Pre-download pools of images for each search term
declare -A POOLS
TERMS=("croissant" "eclair" "pizza" "brioche" "chocolate" "dessert" "bakery" "food" "pancake")

echo "=== Pre-fetching image pools ==="
for term in "${TERMS[@]}"; do
  for page in 1 2 3; do
    urls=$(curl -s "https://api.pexels.com/v1/search?query=${term}&per_page=15&page=${page}" \
      -H "Authorization: ${PEXELS}" --max-time 10 | \
      python3 -c "import json,sys; d=json.load(sys.stdin); [print(p['src']['medium']) for p in d.get('photos',[])]" 2>/dev/null)
    POOLS["${term}"]="${POOLS[${term}]}
${urls}"
  done
  count=$(echo "${POOLS[$term]}" | grep -c "https://")
  echo "  $term: $count images"
done

# Function to get Nth image from pool
get_image() {
  local term=$1
  local n=$2
  echo "${POOLS[$term]}" | grep "https://" | sed -n "${n}p"
}

# Counters
declare -A TERM_IDX
for t in "${TERMS[@]}"; do TERM_IDX[$t]=1; done
SUCCESS=0
FAILED=0

# Get remaining products
PRODUCTS=$(curl -s "${API}/products?limit=500" -H "Authorization: Bearer ${TOKEN}" | \
  node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
d.data.filter(p=>!p.image_url||!p.image_url.startsWith('/uploads/')).forEach(p=>{
  let term='food';
  const n=p.name, c=p.category_name||'';
  // Map to search terms
  if(n.includes('CROISSANT')||n.includes('PAIN AU CHOCOLAT')||n.includes('PAIN SUISSE')||n.includes('PAIN AU RAISIN')||n.includes('DANISH')||n.includes('TORSADE')||n.includes('PALMIER')||n.includes('JALOUSIE')||n.includes('FOURRÉ')||n.includes('FEUILLETÉ')||n.includes('NAVETTE')||n.includes('BOSTOCK')||n.includes('BEIGNET')||n.includes('BAGUETTE SUCRÉE')||n.includes('FLAN')) term='croissant';
  else if(n.includes('ÉCLAIR')||n.includes('ÉCLAIRE')) term='eclair';
  else if(n.includes('PIZZA')) term='pizza';
  else if(n.includes('BRIOCHE')) term='brioche';
  else if(n.includes('PANCAKE')||n.includes('BAGHRIR')) term='pancake';
  else if(c.includes('PÂTISSERIE')||n.includes('TARTE')||n.includes('MILLE')||n.includes('CAKE')||n.includes('GÂTEAU')||n.includes('MACARON')||n.includes('COOKIE')||n.includes('MUFFIN')||n.includes('MADELEINE')||n.includes('BROWNIE')||n.includes('FINANCIER')||n.includes('CHEESECAKE')||n.includes('OPÉRA')||n.includes('ROYAL')||n.includes('FRAISIER')||n.includes('FORÊT')||n.includes('AMANDINE')||n.includes('RED VELVET')||n.includes('CASABLANCA')||n.includes('CRUNCHÉ')||n.includes('FEUILLE')||n.includes('TIGRÉ')||n.includes('MOELLEUX')) term='dessert';
  else if(c.includes('MACARON')) term='dessert';
  else if(c.includes('SALÉ')||n.includes('QUICHE')||n.includes('SANDWICH')||n.includes('NEMS')||n.includes('PASTILLA')||n.includes('ESCARGOT')||n.includes('BRIOUAT')||n.includes('HARSHA')||n.includes('CROC')) term='food';
  else if(c.includes('BELDI')||c.includes('SACHET')) term='bakery';
  else term='chocolate';
  console.log(p.id+'|'+term+'|'+n);
});
")

echo ""
echo "=== Uploading images ==="
TOTAL=$(echo "$PRODUCTS" | wc -l | tr -d ' ')
I=0

while IFS='|' read -r id term name; do
  [ -z "$id" ] && continue
  I=$((I+1))
  idx=${TERM_IDX[$term]}
  img_url=$(get_image "$term" "$idx")
  TERM_IDX[$term]=$((idx+1))

  if [ -z "$img_url" ]; then
    # Reset counter and try again
    TERM_IDX[$term]=1
    img_url=$(get_image "$term" 1)
  fi

  if [ -z "$img_url" ]; then
    echo "[$I/$TOTAL] $name → $term ❌ No image in pool"
    FAILED=$((FAILED+1))
    continue
  fi

  # Download
  curl -sL -o "$TMP" "$img_url" --max-time 10 2>/dev/null
  SIZE=$(wc -c < "$TMP" 2>/dev/null | tr -d ' ')

  if [ "$SIZE" -lt 3000 ] 2>/dev/null; then
    echo "[$I/$TOTAL] $name → $term ❌ Too small ($SIZE)"
    FAILED=$((FAILED+1))
    continue
  fi

  # Upload
  result=$(curl -s -X POST "${API}/products/${id}/image" \
    -H "Authorization: Bearer ${TOKEN}" \
    -F "image=@${TMP};type=image/jpeg" --max-time 15 2>/dev/null)

  if echo "$result" | grep -q '"success":true'; then
    echo "[$I/$TOTAL] $name → $term ✅"
    SUCCESS=$((SUCCESS+1))
  else
    echo "[$I/$TOTAL] $name → $term ❌ Upload failed"
    FAILED=$((FAILED+1))
  fi
done <<< "$PRODUCTS"

rm -f "$TMP"
echo ""
echo "=== DONE ==="
echo "✅ $SUCCESS uploaded"
echo "❌ $FAILED failed"

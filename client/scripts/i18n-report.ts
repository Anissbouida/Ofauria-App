/**
 * G6-05 — suivi des traductions « module par module ».
 *
 *   npx tsx scripts/i18n-report.ts           (depuis client/) : tableau dans la console
 *   npx tsx scripts/i18n-report.ts --write   : écrit docs/I18N_AVANCEMENT.md
 *
 * Par dossier de src/features (plus la coquille : components/layout, config) :
 *  - « à extraire » : chaînes françaises encore en dur (approximation par expressions
 *    régulières : textes JSX entre balises, attributs placeholder/title/aria-label/label,
 *    messages notify/toast/confirm) ;
 *  - « extrait » : appels t('…') / useT() déjà posés ;
 *  - clés du domaine (préfixe = nom du dossier, ex. `sales.*`) et combien sont traduites
 *    en arabe et en anglais.
 * Liste ensuite les clés manquantes en ar / en (repli sur le français à l'écran).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fr } from '../src/i18n/fr';
import { ar } from '../src/i18n/ar';
import { en } from '../src/i18n/en';

const CLIENT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(CLIENT, 'src');
const DOC = join(CLIENT, '..', 'docs', 'I18N_AVANCEMENT.md');

/** Domaines de clés du socle, rattachés à la ligne « Coquille ». */
const SHELL_DOMAINS = ['common', 'lang', 'nav', 'module', 'header', 'session'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') out.push(...walk(p)); }
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** Chaîne qui ressemble à un libellé (au moins un mot de 2 lettres), pas à du code. */
function looksLikeLabel(raw: string): boolean {
  const s = raw.trim();
  if (s.length < 2) return false;
  if (!/[A-Za-zÀ-ÿ]{2,}/.test(s)) return false;
  if (/^[a-z][\w.-]*$/.test(s) && !/[À-ÿ]/.test(s)) return false;   // identifiant, clé, classe
  if (/^(https?:|\/|#|[\w-]+\.(png|svg|jpg|pdf))/.test(s)) return false;
  if (/[{};=]|=>|&&|\|\|/.test(s)) return false;                      // fragment de code
  return true;
}

function countHardcoded(code: string): number {
  let n = 0;
  // Textes JSX entre balises : >Texte<
  for (const m of code.matchAll(/>([^<>{}`]+)</g)) if (looksLikeLabel(m[1]) && /\s|[À-ÿ]|^[A-ZÀ-Ý]/.test(m[1].trim())) n++;
  // Attributs textuels
  for (const m of code.matchAll(/\b(?:placeholder|title|aria-label|label|alt)=["']([^"']+)["']/g)) if (looksLikeLabel(m[1])) n++;
  // Messages : notify.x('…'), toast.x('…'), confirm('…'), alert('…')
  for (const m of code.matchAll(/\b(?:notify\.\w+|toast(?:\.\w+)?|confirm|alert)\(\s*(['"`])((?:(?!\1).)+)\1/g)) if (looksLikeLabel(m[2])) n++;
  return n;
}

const countExtracted = (code: string) => (code.match(/\bt\(\s*['"`]/g) ?? []).length;

interface Row { module: string; files: number; hardcoded: number; extracted: number; keys: number; ar: number; en: number }

function keysOf(domains: string[]) {
  const keys = Object.keys(fr).filter(k => domains.includes(k.split('.')[0]));
  return {
    keys: keys.length,
    ar: keys.filter(k => (ar as Record<string, string>)[k]).length,
    en: keys.filter(k => (en as Record<string, string>)[k]).length,
  };
}

function scan(label: string, files: string[], domains: string[]): Row {
  let hardcoded = 0; let extracted = 0;
  for (const f of files) {
    const code = readFileSync(f, 'utf8');
    hardcoded += countHardcoded(code);
    extracted += countExtracted(code);
  }
  return { module: label, files: files.length, hardcoded, extracted, ...keysOf(domains) };
}

const rows: Row[] = [];
rows.push(scan('Coquille (components/layout, config)', [
  ...walk(join(SRC, 'components', 'layout')), ...walk(join(SRC, 'config')),
], SHELL_DOMAINS));
const featuresDir = join(SRC, 'features');
for (const name of readdirSync(featuresDir).sort()) {
  const p = join(featuresDir, name);
  if (!statSync(p).isDirectory()) continue;
  rows.push(scan(`features/${name}`, walk(p), [name]));
}
rows.push(scan('components (hors layout)', walk(join(SRC, 'components')).filter(f => !f.includes(`${join('components', 'layout')}`)), ['components']));

const pct = (a: number, b: number) => (b === 0 ? '—' : `${Math.round((100 * a) / b)} %`);
const frKeys = Object.keys(fr);
const missingAr = frKeys.filter(k => !(ar as Record<string, string>)[k]);
const missingEn = frKeys.filter(k => !(en as Record<string, string>)[k]);
const unknownAr = Object.keys(ar).filter(k => !(k in fr));
const unknownEn = Object.keys(en).filter(k => !(k in fr));
const tot = rows.reduce((a, r) => ({ hardcoded: a.hardcoded + r.hardcoded, extracted: a.extracted + r.extracted }), { hardcoded: 0, extracted: 0 });

const lines: string[] = [];
lines.push('# Traductions — avancement module par module (G6-05)');
lines.push('');
lines.push(`Généré par \`client/scripts/i18n-report.ts\` le ${new Date().toISOString().slice(0, 10)}. Ne pas modifier à la main : relancer \`cd client && npx tsx scripts/i18n-report.ts --write\`.`);
lines.push('');
lines.push('- **À extraire** : chaînes françaises encore en dur (estimation par expressions régulières : textes JSX, attributs `placeholder`/`title`/`aria-label`/`label`/`alt`, messages `notify`/`toast`/`confirm`). Ordre de grandeur, pas un compte exact.');
lines.push('- **Extrait** : appels `t(\'…\')` posés dans le module.');
lines.push('- **Clés** : clés du domaine du module dans `client/src/i18n/fr.ts` (préfixe = nom du dossier ; socle = `common`, `nav`, `module`, `header`, `session`, `lang`), et combien sont traduites en arabe et en anglais (une clé non traduite s\'affiche en français).');
lines.push('');
lines.push(`**Total** : ${tot.hardcoded} chaînes à extraire, ${tot.extracted} appels t() posés, ${frKeys.length} clés (${frKeys.length - missingAr.length} traduites en arabe, ${frKeys.length - missingEn.length} en anglais).`);
lines.push('');
lines.push('| Module | Fichiers | À extraire | Extrait | Avancement | Clés | Traduit ar | Traduit en |');
lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const r of rows) {
  lines.push(`| ${r.module} | ${r.files} | ${r.hardcoded} | ${r.extracted} | ${pct(r.extracted, r.extracted + r.hardcoded)} | ${r.keys} | ${r.keys ? `${r.ar} (${pct(r.ar, r.keys)})` : '—'} | ${r.keys ? `${r.en} (${pct(r.en, r.keys)})` : '—'} |`);
}
lines.push('');
lines.push('## Clés manquantes');
lines.push('');
lines.push(`- Arabe : ${missingAr.length ? missingAr.map(k => `\`${k}\``).join(', ') : 'aucune'}`);
lines.push(`- Anglais : ${missingEn.length ? missingEn.map(k => `\`${k}\``).join(', ') : 'aucune'}`);
if (unknownAr.length || unknownEn.length) lines.push(`- Clés inconnues du français (à retirer) : ${[...unknownAr, ...unknownEn].join(', ')}`);
lines.push('');
lines.push('## Méthode d\'extraction d\'un module');
lines.push('');
lines.push('1. Ajouter les clés `<module>.<libellé>` dans `fr.ts` (référence) ; TypeScript refuse ensuite toute clé `ar`/`en` inconnue.');
lines.push('2. Remplacer les chaînes par `t(\'<module>.<libellé>\')` (`const t = useT()` dans un composant, `t` de `i18n/core` hors React).');
lines.push('3. Traduire dans `ar.ts` puis `en.ts` ; en RTL, préférer les utilitaires logiques Tailwind (`ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`, `text-start`) aux `ml-`/`mr-`/`left-`/`right-`/`text-left`.');
lines.push('4. Montants : `money()` (utils/money.ts, devise de la société + séparateurs de la langue) ; nombres et dates : `formatNumber` / `formatDate` (i18n/core).');
lines.push('5. Relancer ce rapport.');
lines.push('');

// Écarts RTL : propriétés physiques (gauche/droite) qui ne basculent pas en arabe.
const allFiles = walk(SRC);
const cssFiles = (function walkCss(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walkCss(p) : (name.endsWith('.css') ? [p] : []);
  });
})(SRC);
const TW_PHYSICAL = /(?<![\w-])-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)(?:-[\w.[\]/]+)?(?=[\s"'`])/g;
const CSS_PHYSICAL = /\b(?:margin|padding|border)-(?:left|right)\b|(?:^|[\s;{])(?:left|right)\s*:|text-align:\s*(?:left|right)/gm;
const twCount = allFiles.reduce((n, f) => n + (readFileSync(f, 'utf8').match(TW_PHYSICAL)?.length ?? 0), 0);
const cssCount = cssFiles.reduce((n, f) => n + (readFileSync(f, 'utf8').match(CSS_PHYSICAL)?.length ?? 0), 0);
lines.push('## Écarts RTL (arabe)');
lines.push('');
lines.push(`- Utilitaires Tailwind physiques restants (\`ml-\`, \`pr-\`, \`left-\`, \`text-left\`, \`border-l\`…) : **${twCount}** dans les .tsx ; propriétés CSS physiques : **${cssCount}** dans les .css. À convertir en logiques au fil de l'extraction de chaque module (la coquille — barre du haut, menus, lanceur, barre latérale ModuleShell, connexion — est déjà convertie).`);
lines.push('- Textes non encore extraits : affichés en français dans une page RTL (ponctuation finale déplacée à gauche par l\'algorithme bidi).');
lines.push('- Icônes directionnelles (flèches, chevrons lucide) : à retourner en RTL (`rtl:-scale-x-100`) ; fait sur « Changer de personne » de la connexion. Les chevrons texte « › » sont déjà miroités par le navigateur.');
lines.push('- Libellés venant de `shared` ou du serveur (rôles `ROLE_LABELS`, statuts, messages d\'erreur API, vocabulaire sectoriel) : restent en français ; à traiter par une table de traduction côté serveur ou des clés renvoyées par l\'API.');
lines.push('- Documents PDF / tickets : hors périmètre (le PDF bidi des fiches masterclass et les champs `_ar` ne sont pas touchés).');
lines.push('');

const md = lines.join('\n');
if (process.argv.includes('--write')) {
  writeFileSync(DOC, md);
  console.log(`Écrit : ${relative(process.cwd(), DOC)}`);
} else {
  console.log(md);
}

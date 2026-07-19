// Parametres locaux du POSTE de caisse (equivalent des reglages d'app Loyverse).
//
// Stockes en localStorage : ils appartiennent au TERMINAL physique (tablette,
// poste), pas a l'utilisateur ni au magasin. Chaque reglage peut suivre le
// reglage global du back-office ('global') ou le surcharger localement.

export type TriState = 'global' | 'on' | 'off';
export type GridSize = 'compact' | 'normal' | 'large';

const KEYS = {
  autoPrint: 'pos-terminal-auto-print',
  openDrawer: 'pos-terminal-open-drawer',
  printerId: 'pos-terminal-printer-id',
  sounds: 'pos-terminal-sounds',
  keepAwake: 'pos-terminal-keep-awake',
  gridSize: 'pos-terminal-grid-size',
  scanner: 'pos-terminal-scanner',
} as const;

function readTriState(key: string): TriState {
  try {
    const v = localStorage.getItem(key);
    if (v === 'on' || v === 'off') return v;
  } catch { /* localStorage indisponible */ }
  return 'global';
}

function readBool(key: string, defaultValue: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === 'on') return true;
    if (v === 'off') return false;
  } catch { /* noop */ }
  return defaultValue;
}

export interface TerminalSettings {
  autoPrint: TriState;
  openDrawer: TriState;
  printerId: string;
  /** Sons de caisse (bip ajout panier, encaissement, erreur). Defaut : actives. */
  sounds: boolean;
  /** Empeche la mise en veille de l'ecran tant que le POS est ouvert. */
  keepAwake: boolean;
  /** Taille des vignettes de la grille produits. */
  gridSize: GridSize;
  /** Scanner code-barres par camera (bouton a cote de la recherche). */
  scanner: boolean;
}

export function getTerminalSettings(): TerminalSettings {
  let printerId = '';
  let gridSize: GridSize = 'normal';
  try {
    printerId = localStorage.getItem(KEYS.printerId) || '';
    const g = localStorage.getItem(KEYS.gridSize);
    if (g === 'compact' || g === 'large') gridSize = g;
  } catch { /* noop */ }
  return {
    autoPrint: readTriState(KEYS.autoPrint),
    openDrawer: readTriState(KEYS.openDrawer),
    printerId,
    sounds: readBool(KEYS.sounds, true),
    keepAwake: readBool(KEYS.keepAwake, false),
    gridSize,
    scanner: readBool(KEYS.scanner, false),
  };
}

export function setTerminalBool(key: 'sounds' | 'keepAwake' | 'scanner', value: boolean): void {
  try { localStorage.setItem(KEYS[key], value ? 'on' : 'off'); } catch { /* noop */ }
}

export function setTerminalGridSize(value: GridSize): void {
  try {
    if (value === 'normal') localStorage.removeItem(KEYS.gridSize);
    else localStorage.setItem(KEYS.gridSize, value);
  } catch { /* noop */ }
}

export function setTerminalSetting(key: 'autoPrint' | 'openDrawer', value: TriState): void {
  try {
    if (value === 'global') localStorage.removeItem(KEYS[key]);
    else localStorage.setItem(KEYS[key], value);
  } catch { /* noop */ }
}

export function setTerminalPrinter(printerId: string): void {
  try {
    if (!printerId) localStorage.removeItem(KEYS.printerId);
    else localStorage.setItem(KEYS.printerId, printerId);
  } catch { /* noop */ }
}

/** Valeur effective : surcharge locale du poste, sinon reglage global. */
export function resolveTriState(local: TriState, globalValue: boolean): boolean {
  return local === 'global' ? globalValue : local === 'on';
}

/** Imprimante du poste a envoyer au serveur (undefined = defaut du magasin). */
export function getTerminalPrinterId(): string | undefined {
  return getTerminalSettings().printerId || undefined;
}

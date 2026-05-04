import { NiimbotBluetoothClient, ImageEncoder, LabelType, type PrintDirection } from '@mmote/niimbluelib';

export type PrintOptions = {
  copies?: number;
  density?: number;
  labelType?: LabelType;
};

export class NiimbotPrintError extends Error {
  constructor(message: string, public readonly code: 'cancelled' | 'unsupported_model' | 'connect_failed' | 'print_failed') {
    super(message);
    this.name = 'NiimbotPrintError';
  }
}

/**
 * Singleton client NIIMBOT garde en memoire au niveau du module.
 *
 * Strategie de reconnexion (du plus rapide au plus couteux) :
 *
 *   1. Client en cache deja connecte → reutilise directement (ideal)
 *   2. Reconnexion silencieuse via {@link navigator.bluetooth.getDevices}
 *      (Chrome 122+) qui retourne les imprimantes deja autorisees pour cette
 *      origine. On monkey-patch requestDevice pour court-circuiter le picker
 *      du navigateur.
 *   3. Picker du navigateur (premier appairage ou navigateur sans getDevices,
 *      ou imprimante eteinte/hors de portee).
 *
 * La connexion peut tomber pour plusieurs raisons : auto-shutdown imprimante,
 * hors de portee, reload de page. La strategie 2 gere ces cas en silence
 * tant que le navigateur garde la permission et que l'imprimante repond.
 */
let cachedClient: NiimbotBluetoothClient | null = null;

type WebBluetoothExtended = Bluetooth & { getDevices?: () => Promise<BluetoothDevice[]> };

/** Devices NIIMBOT : noms typiques commencent par B (B1, B1_PRO, B21...) ou D (D110, D11...). */
function isNiimbotName(name: string | undefined): boolean {
  if (!name) return false;
  return /^[BD]\d/i.test(name);
}

async function attemptSilentReconnect(client: NiimbotBluetoothClient): Promise<boolean> {
  const bluetooth = navigator.bluetooth as WebBluetoothExtended;
  if (typeof bluetooth.getDevices !== 'function') return false;

  let devices: BluetoothDevice[] = [];
  try {
    devices = await bluetooth.getDevices();
  } catch {
    return false;
  }

  const niimbot = devices.find((d) => isNiimbotName(d.name));
  if (!niimbot) return false;

  // Court-circuiter le picker : niimbluelib appelle requestDevice() en interne,
  // on lui fait croire que l'utilisateur a deja choisi notre device cache.
  const originalRequestDevice = navigator.bluetooth.requestDevice.bind(navigator.bluetooth);
  (navigator.bluetooth as Bluetooth & { requestDevice: (options?: unknown) => Promise<BluetoothDevice> }).requestDevice = async () => niimbot;
  try {
    await client.connect();
    return client.isConnected();
  } catch {
    return false;
  } finally {
    navigator.bluetooth.requestDevice = originalRequestDevice;
  }
}

async function acquireConnectedClient(): Promise<NiimbotBluetoothClient> {
  if (cachedClient && cachedClient.isConnected()) {
    return cachedClient;
  }
  cachedClient = null;

  const client = new NiimbotBluetoothClient();

  // Tentative silencieuse : aucune intervention utilisateur si l'imprimante
  // est deja autorisee et allumee.
  if (await attemptSilentReconnect(client)) {
    cachedClient = client;
    return client;
  }

  // Fallback : picker du navigateur (premier appairage ou imprimante OFF).
  await client.connect();
  cachedClient = client;
  return client;
}

/**
 * Force la deconnexion explicite (utilisable depuis un bouton "Reinitialiser
 * l'imprimante" si jamais l'utilisateur veut changer d'imprimante en cours
 * de session).
 */
export async function disconnectNiimbot(): Promise<void> {
  if (cachedClient) {
    try { await cachedClient.disconnect(); } catch { /* noop */ }
    cachedClient = null;
  }
}

/**
 * Envoie un canvas a l'imprimante NIIMBOT via Web Bluetooth.
 *
 * Premiere impression : dialogue d'appairage natif Chrome.
 * Impressions suivantes : reutilisent la connexion en cache (silencieux).
 */
export async function printOnNiimbot(canvas: HTMLCanvasElement, options: PrintOptions = {}): Promise<void> {
  const copies = options.copies ?? 1;

  let client: NiimbotBluetoothClient;
  try {
    client = await acquireConnectedClient();
  } catch (err) {
    cachedClient = null;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('user')) {
      throw new NiimbotPrintError('Appairage annule', 'cancelled');
    }
    throw new NiimbotPrintError(`Connexion impossible: ${msg}`, 'connect_failed');
  }

  const taskName = client.getPrintTaskType();
  if (!taskName) {
    throw new NiimbotPrintError(
      'Modele d\'imprimante non reconnu par la librairie. La B1 PRO doit utiliser D110M_V4.',
      'unsupported_model'
    );
  }

  const meta = client.getModelMetadata();
  const direction: PrintDirection = (meta?.printDirection as PrintDirection) ?? 'top';

  const encoded = ImageEncoder.encodeCanvas(canvas, direction);

  const printTask = client.abstraction.newPrintTask(taskName, {
    totalPages: copies,
    labelType: options.labelType ?? LabelType.WithGaps,
    density: options.density ?? 3,
  });

  try {
    await printTask.printInit();
    await printTask.printPage(encoded, copies);
    await printTask.waitForPageFinished();
    await printTask.waitForFinished();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new NiimbotPrintError(`Echec de l'impression: ${msg}`, 'print_failed');
  } finally {
    try { await client.abstraction.printEnd(); } catch { /* noop */ }
  }
  // On ne disconnect PAS volontairement : on garde la connexion pour la prochaine impression.
}

// Service d'impression ESC/POS via node-thermal-printer.
//
// Pourquoi backend et pas window.print() ?
// - window.print() passe par le driver OS qui filtre les commandes binaires,
//   donc le pulse tiroir-caisse (\x1B p ...) est avale.
// - Backend ouvre une socket TCP/USB DIRECTE vers l'imprimante, en pur binaire.
//   Le tiroir s'ouvre, le ticket sort, et ca marche depuis n'importe quel
//   poste/tablette du reseau, sans driver a installer.

import { ThermalPrinter, PrinterTypes, CharacterSet } from 'node-thermal-printer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../config/database.js';

const run = promisify(execFile);

/**
 * Interface « cups » (mig 376) : l'imprimante est une file d'impression du système du
 * poste (macOS/Linux), déclarée en mode brut ; le ticket ESC/POS lui est envoyé tel quel
 * avec `lp -o raw`. C'est la voie pour une thermique USB sans agent ni pilote.
 */
async function cupsQueueExists(queue: string): Promise<boolean> {
  try { await run('lpstat', ['-p', queue], { timeout: 5000 }); return true; } catch { return false; }
}
/**
 * `lp` accepte toujours le travail, même imprimante éteinte ou débranchée : il reste alors
 * en file (« offline ») et les suivants s'empilent derrière sans que personne ne le voie.
 * On suit donc nos propres travaux : avant d'envoyer, on annule ceux restés bloqués et on
 * réactive la file ; après l'envoi, on attend la sortie du ticket (quelques secondes), sinon
 * on l'annule et on remonte l'erreur à la caisse, qui pourra réimprimer.
 */
const CUPS_STALE_MS = 30_000;
const CUPS_WAIT_MS = 20_000; // le backend USB de CUPS met ~7 s à ouvrir le périphérique
const cupsPending = new Map<string, number>();

async function cupsQueuedJobs(queue: string): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const { stdout } = await run('lpstat', ['-o', queue], { timeout: 5000 });
    for (const line of stdout.split('\n')) { const m = line.match(/^(\S+)\s/); if (m) ids.add(m[1]); }
  } catch { /* file vide ou lpstat indisponible */ }
  return ids;
}

async function cupsSendRaw(queue: string, data: Buffer): Promise<void> {
  const queued = await cupsQueuedJobs(queue);
  const now = Date.now();
  const stale = [...cupsPending].filter(([id, at]) => queued.has(id) && now - at > CUPS_STALE_MS).map(([id]) => id);
  for (const [id] of cupsPending) if (!queued.has(id)) cupsPending.delete(id);
  if (stale.length) {
    await run('cancel', stale, { timeout: 5000 }).catch(() => undefined);
    await run('cupsenable', [queue], { timeout: 5000 }).catch(() => undefined);
    for (const id of stale) cupsPending.delete(id);
  }

  const file = join(tmpdir(), `kalum-ticket-${process.pid}-${Date.now()}.bin`);
  await writeFile(file, data);
  let jobId: string | null = null;
  try {
    const { stdout } = await run('lp', ['-d', queue, '-o', 'raw', '-t', 'Kalum', file], { timeout: 10000 });
    jobId = stdout.match(/request id is (\S+)/)?.[1] ?? null;
  } finally { await unlink(file).catch(() => undefined); }
  if (!jobId) return;
  cupsPending.set(jobId, Date.now());

  const deadline = Date.now() + CUPS_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 400));
    if (!(await cupsQueuedJobs(queue)).has(jobId)) { cupsPending.delete(jobId); return; }
  }
  await run('cancel', [jobId], { timeout: 5000 }).catch(() => undefined);
  cupsPending.delete(jobId);
  throw new Error(`Imprimante hors ligne ou occupée (file ${queue}) : vérifier qu'elle est allumée et branchée, puis réimprimer`);
}
async function printerReachable(printer: ThermalPrinter, config: PrinterConfigRow): Promise<boolean> {
  return config.interface === 'cups' ? cupsQueueExists(config.connection_string) : printer.isPrinterConnected();
}
async function send(printer: ThermalPrinter, config: PrinterConfigRow): Promise<void> {
  if (config.interface === 'cups') { await cupsSendRaw(config.connection_string, printer.getBuffer()); printer.clear(); return; }
  await send(printer, config);
}

/**
 * Ouverture du tiroir : impulsion sur les deux broches du port tiroir (certaines caisses
 * sont câblées sur la broche 5), avec une impulsion plus longue que celle de la librairie
 * (ESC p m 60 255 : ~120 ms) — des tiroirs à solénoïde lent ne réagissent pas à 50 ms.
 */
function kickDrawer(printer: ThermalPrinter) {
  printer.openCashDrawer();
  printer.raw(Buffer.from([0x1b, 0x70, 0x00, 0x3c, 0xff]));
  printer.raw(Buffer.from([0x1b, 0x70, 0x01, 0x3c, 0xff]));
}

export type SystemPrinter = { kind: 'queue' | 'usb'; name: string; uri: string; status: string | null };

/** Imprimantes vues par le système du serveur : files CUPS et imprimantes USB « direct ». */
export async function listSystemPrinters(): Promise<{ available: boolean; printers: SystemPrinter[] }> {
  const out: SystemPrinter[] = [];
  let available = false;
  try {
    const { stdout } = await run('lpstat', ['-v'], { timeout: 5000 });
    available = true;
    for (const line of stdout.split('\n')) {
      const m = line.match(/^device for ([^:]+): (.+)$/);
      if (m) out.push({ kind: 'queue', name: m[1].trim(), uri: m[2].trim(), status: null });
    }
    try {
      const { stdout: st } = await run('lpstat', ['-p'], { timeout: 5000 });
      for (const line of st.split('\n')) {
        const m = line.match(/^printer (\S+) (.*)$/);
        const q = m && out.find(x => x.name === m[1]);
        if (q) q.status = m[2].replace(/\.$/, '');
      }
    } catch { /* statut facultatif */ }
  } catch { /* lpstat absent : pas de CUPS (Windows, conteneur) */ }
  try {
    const { stdout } = await run('lpinfo', ['-v'], { timeout: 8000 });
    for (const line of stdout.split('\n')) {
      const m = line.match(/^direct (usb:\/\/\S+)/);
      if (!m) continue;
      const uri = m[1];
      if (out.some(x => x.uri === uri)) continue;
      const name = decodeURIComponent(uri.replace(/^usb:\/\//, '').split('?')[0]).replace(/\//g, ' ').trim();
      out.push({ kind: 'usb', name, uri, status: null });
    }
  } catch { /* lpinfo indisponible */ }
  return { available, printers: out };
}

/** Crée la file brute du système pour une imprimante USB détectée (lpadmin). */
export async function attachSystemPrinter(queueName: string, uri: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = queueName.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60);
  if (!name) return { ok: false, error: 'Nom de file invalide' };
  if (!/^usb:\/\//.test(uri)) return { ok: false, error: 'Seule une imprimante USB détectée peut être ajoutée' };
  try {
    await run('lpadmin', ['-p', name, '-E', '-v', uri, '-m', 'raw'], { timeout: 15000 });
    await run('cupsenable', [name], { timeout: 5000 }).catch(() => undefined);
    await run('cupsaccept', [name], { timeout: 5000 }).catch(() => undefined);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `lpadmin a échoué : ${msg.split('\n').pop() || msg}` };
  }
}


export type PrinterConfigRow = {
  id: string;
  store_id: string;
  name: string;
  type: 'receipt' | 'kitchen' | 'label';
  interface: 'tcp' | 'usb' | 'serial' | 'cups';
  connection_string: string;
  printer_model: 'EPSON' | 'STAR' | 'TANCA' | 'DARUMA' | 'BROTHER' | 'CUSTOM';
  character_set: string;
  paper_width: number;
  is_default: boolean;
  is_active: boolean;
  open_drawer_on_cash: boolean;
  notes: string | null;
};

function buildPrinter(config: PrinterConfigRow): ThermalPrinter {
  // Map model -> enum
  const typeMap: Record<string, PrinterTypes> = {
    EPSON: PrinterTypes.EPSON,
    STAR: PrinterTypes.STAR,
    TANCA: PrinterTypes.TANCA,
    DARUMA: PrinterTypes.DARUMA,
    BROTHER: PrinterTypes.BROTHER,
    CUSTOM: PrinterTypes.CUSTOM,
  };
  const printerType = typeMap[config.printer_model] || PrinterTypes.EPSON;

  // Map character_set string -> enum
  const charSet = (CharacterSet as Record<string, CharacterSet>)[config.character_set]
    ?? CharacterSet.PC437_USA;

  return new ThermalPrinter({
    type: printerType,
    // cups : le tampon est envoyé par lp, l'interface de la librairie ne sert pas.
    interface: config.interface === 'cups' ? 'file:///dev/null' : config.connection_string,
    characterSet: charSet,
    removeSpecialCharacters: false,
    lineCharacter: '-',
    width: config.paper_width,
    options: {
      timeout: 5000,  // 5s pour rendre l'echec rapide en cas d'imprimante eteinte
    },
  });
}

export const printerService = {
  async findDefault(storeId: string, type: 'receipt' | 'kitchen' | 'label' = 'receipt') {
    const result = await db.query(
      `SELECT * FROM printer_configs
        WHERE store_id = $1 AND type = $2 AND is_active = true AND is_default = true
        LIMIT 1`,
      [storeId, type]
    );
    return result.rows[0] || null;
  },

  /**
   * Resout l'imprimante a utiliser : celle choisie par le poste (printerId,
   * parametres locaux du terminal POS) si elle est valide pour ce magasin,
   * sinon l'imprimante ticket par defaut du magasin.
   */
  async resolvePrinter(storeId: string, printerId?: string): Promise<PrinterConfigRow | null> {
    if (printerId) {
      const chosen = await this.findById(printerId);
      if (chosen && chosen.store_id === storeId && chosen.is_active && chosen.type === 'receipt') {
        return chosen;
      }
      // Imprimante invalide/supprimee : retombe silencieusement sur le defaut.
    }
    return this.findDefault(storeId, 'receipt');
  },

  async findById(id: string) {
    const result = await db.query(
      `SELECT * FROM printer_configs WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  /**
   * Imprime un ticket de vente sur l'imprimante par defaut du store.
   * Retourne { ok: true } ou { ok: false, error } pour que l'appelant puisse
   * gerer l'echec sans planter (ex: tomber sur impression navigateur fallback).
   */
  async printReceipt(params: {
    storeId: string;
    sale: {
      sale_number: string;
      created_at: string | Date;
      total: number;
      subtotal: number;
      discount_amount: number;
      payment_method: string;
      cashier_name?: string;
      customer_name?: string;
      items: Array<{ name: string; quantity: number; unit_price: number; subtotal: number; unit?: 'unit' | 'g'; display_unit?: 'g' | 'kg' | null }>;
      cash_given?: number;
      change_amount?: number;
      // Ventilation d'un paiement mixte (mig 250)
      cash_part?: number | null;
      card_part?: number | null;
    };
    company: {
      name: string;
      subtitle?: string;
      receipt_header?: string;
      receipt_footer?: string;
      receipt_extra_lines?: string;
    };
    options?: { openDrawer?: boolean; numCopies?: number; printerId?: string };
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const config = await this.resolvePrinter(params.storeId, params.options?.printerId);
    if (!config) {
      return { ok: false, error: 'Aucune imprimante par defaut configuree pour ce magasin' };
    }

    const printer = buildPrinter(config);

    try {
      const isConnected = await printerReachable(printer, config);
      if (!isConnected) {
        return { ok: false, error: `Imprimante injoignable (${config.connection_string})` };
      }

      const copies = Math.max(1, Math.min(5, params.options?.numCopies ?? 1));

      for (let copy = 0; copy < copies; copy++) {
        printer.clear();

        // ─── En-tete : nom magasin centre ───
        printer.alignCenter();
        printer.bold(true);
        printer.setTextDoubleHeight();
        printer.println(params.company.name);
        printer.setTextNormal();
        printer.bold(false);
        if (params.company.subtitle) {
          printer.println(params.company.subtitle);
        }
        if (params.company.receipt_header) {
          printer.println(params.company.receipt_header);
        }
        printer.drawLine();

        // ─── Infos vente ───
        printer.alignLeft();
        printer.println(`Ticket : ${params.sale.sale_number}`);
        const d = new Date(params.sale.created_at);
        const pad = (n: number) => String(n).padStart(2, '0');
        printer.println(`Date   : ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`);
        if (params.sale.cashier_name) {
          printer.println(`Caisse : ${params.sale.cashier_name}`);
        }
        if (params.sale.customer_name) {
          printer.println(`Client : ${params.sale.customer_name}`);
        }
        printer.drawLine();

        // ─── Articles ───
        for (const item of params.sale.items) {
          printer.println(item.name);
          // 2nd ligne : qty x PU (ou poids @ prix/kg)        subtotal.
          // Pour un produit au poids, on affiche dans l'unite saisie au POS
          // (display_unit) : "1 kg @ ..." ou "1000 g @ ...".
          let left: string;
          if (item.unit === 'g') {
            const weight = item.display_unit === 'kg'
              ? `${Number((item.quantity / 1000).toFixed(3))} kg`
              : `${item.quantity} g`;
            left = `  ${weight} @ ${item.unit_price.toFixed(2)}/kg`;
          } else {
            left = `  ${item.quantity} x ${item.unit_price.toFixed(2)}`;
          }
          const right = `${item.subtotal.toFixed(2)} DH`;
          printer.leftRight(left, right);
        }
        printer.drawLine();

        // ─── Totaux ───
        printer.leftRight('Sous-total', `${params.sale.subtotal.toFixed(2)} DH`);
        if (params.sale.discount_amount > 0) {
          printer.leftRight('Remise', `-${params.sale.discount_amount.toFixed(2)} DH`);
        }
        printer.bold(true);
        printer.setTextDoubleHeight();
        printer.leftRight('TOTAL', `${params.sale.total.toFixed(2)} DH`);
        printer.setTextNormal();
        printer.bold(false);
        printer.newLine();

        // ─── Paiement ───
        const payLabel: Record<string, string> = {
          cash: 'Especes', card: 'Carte bancaire', mobile: 'Mobile',
          check: 'Cheque', credit: 'Credit (impaye)', mixed: 'Mixte',
        };
        printer.println(`Paye par : ${payLabel[params.sale.payment_method] || params.sale.payment_method}`);
        // Paiement mixte (mig 250) : detail des deux parts.
        if (params.sale.payment_method === 'mixed') {
          if (params.sale.cash_part != null) printer.println(`  Especes : ${params.sale.cash_part.toFixed(2)} DH`);
          if (params.sale.card_part != null) printer.println(`  Carte   : ${params.sale.card_part.toFixed(2)} DH`);
        }

        if (params.sale.payment_method === 'cash' && params.sale.cash_given != null) {
          printer.println(`Donne    : ${params.sale.cash_given.toFixed(2)} DH`);
          if (params.sale.change_amount != null) {
            printer.bold(true);
            printer.println(`Monnaie  : ${params.sale.change_amount.toFixed(2)} DH`);
            printer.bold(false);
          }
        }
        printer.drawLine();

        // ─── Pied de page ───
        printer.alignCenter();
        if (params.company.receipt_footer) {
          printer.println(params.company.receipt_footer);
        }
        printer.println(`A bientot chez ${params.company.name}`);
        if (params.company.receipt_extra_lines) {
          for (const line of params.company.receipt_extra_lines.split('\n')) {
            if (line.trim()) printer.println(line);
          }
        }
        printer.newLine();

        // ─── Coupe + tiroir si demande ───
        printer.cut();

        if (
          copy === 0 &&
          params.options?.openDrawer &&
          config.open_drawer_on_cash &&
          (params.sale.payment_method === 'cash' || params.sale.payment_method === 'mixed')
        ) {
          kickDrawer(printer);
        }
      }

      await send(printer, config);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Erreur imprimante inconnue' };
    }
  },

  /**
   * Imprime le rapport de cloture (rapport Z ou passation) d'une session de
   * caisse sur l'imprimante ticket par defaut du store. Meme contrat que
   * printReceipt : { ok } ou { ok: false, error } pour laisser l'appelant
   * gerer le fallback.
   */
  async printZReport(params: {
    storeId: string;
    session: {
      close_type: string | null;
      cashier_name?: string;
      opened_at: string | Date;
      closed_at?: string | Date | null;
      opening_amount: number;
      total_sales: number;
      total_revenue: number;
      cash_revenue: number;
      card_revenue: number;
      mobile_revenue: number;
      total_advances: number;
      total_orders: number;
      expected_cash: number;
      actual_amount?: number | null;
      difference?: number | null;
      notes?: string | null;
    };
    company: { name: string };
    options?: { printerId?: string };
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const config = await this.resolvePrinter(params.storeId, params.options?.printerId);
    if (!config) {
      return { ok: false, error: 'Aucune imprimante par defaut configuree pour ce magasin' };
    }

    const printer = buildPrinter(config);
    try {
      const isConnected = await printerReachable(printer, config);
      if (!isConnected) {
        return { ok: false, error: `Imprimante injoignable (${config.connection_string})` };
      }

      const s = params.session;
      const pad = (n: number) => String(n).padStart(2, '0');
      const fmtDT = (v: string | Date) => {
        const d = new Date(v);
        return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };
      const dh = (v: number) => `${(v || 0).toFixed(2)} DH`;

      printer.alignCenter();
      printer.bold(true);
      printer.setTextDoubleHeight();
      printer.println(params.company.name);
      printer.setTextNormal();
      printer.println(s.close_type === 'passation' ? 'RAPPORT DE PASSATION' : 'RAPPORT Z — FIN DE JOURNEE');
      printer.bold(false);
      printer.drawLine();

      printer.alignLeft();
      if (s.cashier_name) printer.println(`Caissier  : ${s.cashier_name}`);
      printer.println(`Ouverture : ${fmtDT(s.opened_at)}`);
      if (s.closed_at) printer.println(`Fermeture : ${fmtDT(s.closed_at)}`);
      printer.drawLine();

      printer.leftRight('Fond de caisse', dh(s.opening_amount));
      printer.leftRight(`Ventes (${s.total_sales || 0})`, dh(s.total_revenue));
      printer.leftRight('  dont especes', dh(s.cash_revenue));
      printer.leftRight('  dont carte', dh(s.card_revenue));
      if ((s.mobile_revenue || 0) > 0) printer.leftRight('  dont mobile', dh(s.mobile_revenue));
      if ((s.total_advances || 0) > 0) printer.leftRight('Avances commandes', dh(s.total_advances));
      if ((s.total_orders || 0) > 0) printer.leftRight('Commandes en attente', String(s.total_orders));
      printer.drawLine();

      printer.leftRight('Especes attendues', dh(s.expected_cash));
      if (s.actual_amount != null) {
        printer.leftRight('Especes comptees', dh(s.actual_amount));
        const diff = s.difference ?? (s.actual_amount - s.expected_cash);
        printer.bold(true);
        printer.leftRight('ECART', `${diff > 0 ? '+' : ''}${diff.toFixed(2)} DH`);
        printer.bold(false);
      }
      printer.drawLine();

      if (s.notes) {
        printer.println(`Notes : ${s.notes}`);
        printer.drawLine();
      }

      printer.alignCenter();
      printer.println(`Imprime le ${fmtDT(new Date())}`);
      printer.newLine();
      printer.cut();

      await send(printer, config);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Erreur imprimante inconnue' };
    }
  },

  /**
   * Ouvre uniquement le tiroir-caisse, sans imprimer de ticket.
   * Utilise pour les operations fond de caisse / verifications.
   */
  async openCashDrawer(printerId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const config = await this.findById(printerId);
    if (!config) return { ok: false, error: 'Imprimante introuvable' };

    const printer = buildPrinter(config);
    try {
      const connected = await printerReachable(printer, config);
      if (!connected) return { ok: false, error: 'Imprimante injoignable' };
      kickDrawer(printer);
      await send(printer, config);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Erreur tiroir' };
    }
  },

  /**
   * Imprime une page de test pour valider la configuration.
   */
  async testPrint(printerId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const config = await this.findById(printerId);
    if (!config) return { ok: false, error: 'Imprimante introuvable' };

    const printer = buildPrinter(config);
    try {
      const connected = await printerReachable(printer, config);
      if (!connected) {
        return { ok: false, error: `Imprimante injoignable (${config.connection_string})` };
      }

      printer.alignCenter();
      printer.bold(true);
      printer.setTextDoubleHeight();
      printer.println('TEST IMPRESSION');
      printer.setTextNormal();
      printer.bold(false);
      printer.drawLine();
      printer.alignLeft();
      printer.println(`Imprimante : ${config.name}`);
      printer.println(`Modele     : ${config.printer_model}`);
      printer.println(`Interface  : ${config.interface}`);
      printer.println(`Connexion  : ${config.connection_string}`);
      printer.println(`Largeur    : ${config.paper_width} car.`);
      const now = new Date();
      printer.println(`Date       : ${now.toLocaleString('fr-FR')}`);
      printer.drawLine();
      printer.alignCenter();
      printer.println('Si vous lisez ce ticket,');
      printer.println('la configuration est valide.');
      printer.newLine();
      printer.cut();

      // Test du tiroir aussi
      kickDrawer(printer);

      await send(printer, config);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Erreur impression test' };
    }
  },
};

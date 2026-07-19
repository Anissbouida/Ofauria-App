// Service d'impression ESC/POS via node-thermal-printer.
//
// Pourquoi backend et pas window.print() ?
// - window.print() passe par le driver OS qui filtre les commandes binaires,
//   donc le pulse tiroir-caisse (\x1B p ...) est avale.
// - Backend ouvre une socket TCP/USB DIRECTE vers l'imprimante, en pur binaire.
//   Le tiroir s'ouvre, le ticket sort, et ca marche depuis n'importe quel
//   poste/tablette du reseau, sans driver a installer.

import { ThermalPrinter, PrinterTypes, CharacterSet } from 'node-thermal-printer';
import { db } from '../config/database.js';

export type PrinterConfigRow = {
  id: string;
  store_id: string;
  name: string;
  type: 'receipt' | 'kitchen' | 'label';
  interface: 'tcp' | 'usb' | 'serial';
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
    interface: config.connection_string,
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
      const isConnected = await printer.isPrinterConnected();
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
          printer.openCashDrawer();
        }
      }

      await printer.execute();
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
      const isConnected = await printer.isPrinterConnected();
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

      await printer.execute();
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
      const connected = await printer.isPrinterConnected();
      if (!connected) return { ok: false, error: 'Imprimante injoignable' };
      printer.openCashDrawer();
      await printer.execute();
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
      const connected = await printer.isPrinterConnected();
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
      printer.openCashDrawer();

      await printer.execute();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Erreur impression test' };
    }
  },
};

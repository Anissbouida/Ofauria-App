import { renderLotLabel, type LotLabelData, type LabelSize } from './labelRenderer';
import { printOnNiimbot } from './printer';

export { isWebBluetoothSupported } from './support';
export { NiimbotPrintError, disconnectNiimbot } from './printer';
export type { LotLabelData, LabelSize };

export type PrintLotLabelOptions = {
  copies?: number;
  size?: LabelSize;
  density?: number;
};

/**
 * Genere une etiquette de lot et l'envoie a la NIIMBOT B1 PRO via Web Bluetooth.
 *
 * Flow :
 *   1. Le navigateur affiche le dialogue d'appairage (premier usage)
 *      ou reconnecte directement sur l'imprimante deja appairee.
 *   2. Rendu du canvas a 300 DPI (50x30mm = 590x354 px par defaut).
 *   3. Encodage en bitmap monochrome puis envoi par paquets BLE.
 *
 * @throws NiimbotPrintError avec un code utilisable par l'UI (cancelled,
 *   connect_failed, unsupported_model, print_failed).
 */
export async function printLotLabel(data: LotLabelData, options: PrintLotLabelOptions = {}): Promise<void> {
  const canvas = await renderLotLabel(data, options.size);
  await printOnNiimbot(canvas, {
    copies: options.copies ?? 1,
    density: options.density,
  });
}

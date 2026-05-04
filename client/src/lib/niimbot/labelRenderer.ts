import QRCode from 'qrcode';

export type LotLabelData = {
  productName: string;
  lotNumber: string;
  quantity: string;
  productionDate: string;
  expirationDate: string | null;
  cycleLabel: string;
  companyName?: string;
};

export type LabelSize = {
  widthMm: number;
  heightMm: number;
};

const DPI = 300;
const mmToPx = (mm: number) => Math.round((mm * DPI) / 25.4);
/**
 * Le bitmap envoye a la NIIMBOT est encode 8 pixels par octet : la largeur
 * effective doit etre un multiple de 8, sinon ImageEncoder.encodeCanvas throw
 * "Column count must be multiple of 8". On arrondit a la valeur inferieure
 * pour ne pas deborder de la largeur de l'imprimante (printheadPixels=567 pour B1 PRO).
 */
const roundWidthForPrinter = (px: number) => Math.floor(px / 8) * 8;

/**
 * Genere un canvas monochrome pret a etre imprime sur une NIIMBOT B1 PRO.
 *
 * Layout pour une etiquette 50x30mm (a 300 DPI = 584x354 px) :
 *
 *   ┌──────────────────────────────┐
 *   │ BROWNIE CARRE          ┌───┐ │
 *   │ LOT-260426-001         │QR │ │
 *   │ Qte: 40                │   │ │
 *   │ Prod: 25/04 20:58      └───┘ │
 *   │ DLC: 28/04/2026              │
 *   │ Vente du jour                │
 *   └──────────────────────────────┘
 *
 * Le QR (20mm carre, centre verticalement a droite) encode le numero de lot
 * pour scanner depuis l'inventaire / POS / declaration de perte.
 *
 * Les noms de produit ou numeros de lot trop longs voient leur taille de police
 * reduite automatiquement (autoShrinkFont) jusqu'a un seuil minimal, puis
 * tronques avec ellipsis si la version la plus petite ne tient toujours pas.
 */
export async function renderLotLabel(data: LotLabelData, size: LabelSize = { widthMm: 50, heightMm: 30 }): Promise<HTMLCanvasElement> {
  const widthPx = roundWidthForPrinter(mmToPx(size.widthMm));
  const heightPx = mmToPx(size.heightMm);

  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context indisponible');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';

  const padding = mmToPx(1.5);
  const qrSizeMm = Math.min(20, size.heightMm - 4);
  const qrSize = mmToPx(qrSizeMm);
  const qrX = widthPx - qrSize - padding;
  const qrY = Math.round((heightPx - qrSize) / 2);

  const qrDataUrl = await QRCode.toDataURL(data.lotNumber, {
    width: qrSize,
    margin: 0,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  });
  const qrImg = new Image();
  await new Promise<void>((resolve, reject) => {
    qrImg.onload = () => resolve();
    qrImg.onerror = () => reject(new Error('Echec du rendu QR code'));
    qrImg.src = qrDataUrl;
  });
  ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

  const textX = padding;
  const textMaxWidth = qrX - padding * 2;
  let y = padding;

  // Nom du produit : auto-shrink de 3.6mm a 2.6mm
  drawAutoSizedText(ctx, data.productName.toUpperCase(), textX, y, textMaxWidth, {
    fontSizesMm: [3.6, 3.2, 2.8, 2.6],
    bold: true,
  });
  y += mmToPx(4);

  // Numero de lot : auto-shrink de 2.8mm a 2.2mm (mais le numero est generalement court)
  drawAutoSizedText(ctx, data.lotNumber, textX, y, textMaxWidth, {
    fontSizesMm: [2.8, 2.5, 2.2],
    bold: true,
  });
  y += mmToPx(3.5);

  ctx.font = `${mmToPx(2.4)}px Arial, sans-serif`;
  drawTruncatedText(ctx, `Qte: ${data.quantity}`, textX, y, textMaxWidth);
  y += mmToPx(3);

  drawTruncatedText(ctx, `Prod: ${data.productionDate}`, textX, y, textMaxWidth);
  y += mmToPx(3);

  if (data.expirationDate) {
    drawTruncatedText(ctx, `DLC: ${data.expirationDate}`, textX, y, textMaxWidth);
    y += mmToPx(3);
  }

  ctx.font = `bold ${mmToPx(2.2)}px Arial, sans-serif`;
  drawTruncatedText(ctx, data.cycleLabel, textX, y, textMaxWidth);

  return canvas;
}

/**
 * Essaie chaque taille de police dans l'ordre, garde la premiere qui tient
 * dans `maxWidth`. Si aucune ne tient, utilise la plus petite avec ellipsis.
 */
function drawAutoSizedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  opts: { fontSizesMm: number[]; bold?: boolean }
) {
  const weight = opts.bold ? 'bold ' : '';
  for (const sizeMm of opts.fontSizesMm) {
    ctx.font = `${weight}${mmToPx(sizeMm)}px Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) {
      ctx.fillText(text, x, y);
      return;
    }
  }
  // Aucune taille ne tient : fallback sur la plus petite avec ellipsis
  const lastSize = opts.fontSizesMm[opts.fontSizesMm.length - 1];
  ctx.font = `${weight}${mmToPx(lastSize)}px Arial, sans-serif`;
  drawTruncatedText(ctx, text, x, y, maxWidth);
}

function drawTruncatedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, x, y);
    return;
  }
  const ellipsis = '…';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  ctx.fillText(text.slice(0, lo) + ellipsis, x, y);
}

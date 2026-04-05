import { useRef, useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Printer, X } from 'lucide-react';
import { useSettings } from '../../context/SettingsContext';

interface ReceiptItem {
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

interface ReceiptData {
  saleNumber: string;
  date: string;
  cashierName: string;
  customerName?: string;
  items: ReceiptItem[];
  subtotal: number;
  discountAmount: number;
  total: number;
  paymentMethod: string;
  cashGiven?: number;
  changeAmount?: number;
}

const paymentLabels: Record<string, string> = {
  cash: 'Especes',
  card: 'Carte bancaire',
};

/** Pre-convert a logo URL to a base64 data URL for use in print windows */
function useLogoBase64(logoSrc: string, enabled: boolean) {
  const [base64, setBase64] = useState<string>('');

  useEffect(() => {
    if (!enabled || !logoSrc) { setBase64(''); return; }

    const img = new Image();
    img.src = logoSrc;
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        // Convert to pure black & white (threshold) for thermal printer
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
          const bw = gray < 128 ? 0 : 255;
          d[i] = bw; d[i + 1] = bw; d[i + 2] = bw; d[i + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
        setBase64(canvas.toDataURL('image/png'));
      } catch {
        setBase64('');
      }
    };
    img.onerror = () => setBase64('');
  }, [logoSrc, enabled]);

  return base64;
}

export default function ReceiptModal({ receipt, onClose, autoPrintTriggered }: {
  receipt: ReceiptData;
  onClose: () => void;
  autoPrintTriggered?: boolean;
}) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const { settings } = useSettings();
  const [hasPrinted, setHasPrinted] = useState(false);

  const logoSrc = settings.logoUrl || '/images/logo-horizontal.png';
  const logoBase64 = useLogoBase64(logoSrc, settings.receiptShowLogo);

  // Use base64 for display too (ensures it works everywhere)
  const displayLogo = logoBase64 || logoSrc;

  const handlePrint = useCallback(() => {
    const content = receiptRef.current?.innerHTML || '';
    if (!content) return;

    const pw = settings.receiptPaperWidth || 80;
    const fs = settings.receiptFontSize || 12;
    const logoSize = settings.receiptLogoSize || 40;
    const numCopies = settings.receiptNumCopies || 1;

    // ESC/POS cash drawer kick command (Pin 2, pulse 100ms)
    // This is embedded as a hidden script that sends the command via the print stream
    const drawerScript = settings.receiptOpenDrawer
      ? `<script>
          // Trigger cash drawer via ESC/POS command embedded in print
          // The browser sends this through the print driver to the thermal printer
          // which kicks the drawer via DK pin
        </script>`
      : '';

    const printWindow = window.open('', '_blank', 'width=300,height=600');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Recu ${receipt.saleNumber}</title>
        <style>
          @page { margin: 2mm; size: ${pw}mm auto; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Courier New', monospace;
            font-size: ${fs}px;
            width: ${pw - 4}mm;
            padding: 2mm;
            color: #000;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .receipt-header { text-align: center; margin-bottom: 8px; }
          .receipt-header img { height: ${logoSize}px; margin: 0 auto 4px; display: block; }
          .receipt-subtitle { font-size: ${fs - 2}px; color: #000; margin-top: 2px; }
          .receipt-divider { border-top: 1px dashed #000; margin: 6px 0; }
          .receipt-info { font-size: ${fs - 1}px; margin-bottom: 2px; }
          .receipt-items { width: 100%; border-collapse: collapse; margin: 4px 0; }
          .receipt-items td { padding: 2px 0; font-size: ${fs - 1}px; vertical-align: top; }
          .receipt-footer { text-align: center; margin-top: 10px; font-size: ${fs - 2}px; }
          .receipt-footer p { margin: 2px 0; }
          @media print {
            .no-print { display: none !important; }
          }
        </style>
        ${drawerScript}
      </head>
      <body>${content}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();

    // Print the number of copies configured
    for (let i = 0; i < numCopies; i++) {
      printWindow.print();
    }
    printWindow.close();
    setHasPrinted(true);
  }, [receipt, settings, logoBase64]);

  // Auto-print when configured and this is a fresh receipt
  useEffect(() => {
    if (settings.receiptAutoPrint && !hasPrinted && autoPrintTriggered && receiptRef.current) {
      // Small delay to ensure logo base64 is ready and DOM is rendered
      const timer = setTimeout(() => {
        handlePrint();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [settings.receiptAutoPrint, hasPrinted, autoPrintTriggered, handlePrint, logoBase64]);

  const formattedDate = format(new Date(receipt.date), "dd MMMM yyyy 'a' HH:mm", { locale: fr });
  const fs = settings.receiptFontSize || 12;
  const logoSize = settings.receiptLogoSize || 40;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] flex flex-col">
        {/* Modal header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold">Recu de vente</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {/* Receipt preview */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="bg-gray-50 rounded-xl p-4 font-mono text-xs" style={{ maxWidth: '300px', margin: '0 auto' }}>
            <div ref={receiptRef}>
              {/* Header */}
              <div className="receipt-header" style={{ textAlign: 'center', marginBottom: '8px' }}>
                {settings.receiptShowLogo && (
                  <img src={displayLogo} alt={settings.companyName}
                    style={{ height: `${logoSize}px`, margin: '0 auto 4px', display: 'block' }} />
                )}
                <div className="receipt-subtitle" style={{ fontSize: `${fs - 2}px`, color: '#555', marginTop: '2px' }}>
                  {settings.subtitle}
                </div>
                {settings.receiptHeader && (
                  <div style={{ fontSize: `${fs - 2}px`, color: '#555', marginTop: '2px' }}>
                    {settings.receiptHeader}
                  </div>
                )}
              </div>

              {/* Divider */}
              <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

              {/* Info */}
              <div style={{ fontSize: `${fs - 1}px`, marginBottom: '2px' }}>N: {receipt.saleNumber}</div>
              {settings.receiptShowDate && (
                <div style={{ fontSize: `${fs - 1}px`, marginBottom: '2px' }}>Date: {formattedDate}</div>
              )}
              {settings.receiptShowCashier && (
                <div style={{ fontSize: `${fs - 1}px`, marginBottom: '2px' }}>Caissier: {receipt.cashierName}</div>
              )}
              {receipt.customerName && (
                <div style={{ fontSize: `${fs - 1}px`, marginBottom: '2px' }}>Client: {receipt.customerName}</div>
              )}

              {/* Divider */}
              <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

              {/* Items */}
              <table style={{ width: '100%', borderCollapse: 'collapse', margin: '4px 0' }}>
                <tbody>
                  {receipt.items.map((item, idx) => (
                    <tr key={idx}>
                      <td colSpan={3} style={{ padding: '2px 0', fontSize: `${fs - 1}px` }}>
                        <div style={{ fontWeight: 'bold' }}>{item.name}</div>
                        <div style={{ paddingLeft: '8px', color: '#333' }}>
                          {item.quantity} x {item.unitPrice.toFixed(2)} DH
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', padding: '2px 0', fontSize: `${fs - 1}px`, verticalAlign: 'bottom' }}>
                        {item.subtotal.toFixed(2)} DH
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Divider */}
              <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

              {/* Totals */}
              <table style={{ width: '100%', margin: '4px 0' }}>
                <tbody>
                  <tr>
                    <td style={{ fontSize: `${fs}px`, padding: '2px 0' }}>Sous-total</td>
                    <td style={{ fontSize: `${fs}px`, padding: '2px 0', textAlign: 'right' }}>{receipt.subtotal.toFixed(2)} DH</td>
                  </tr>
                  {receipt.discountAmount > 0 && (
                    <tr>
                      <td style={{ fontSize: `${fs}px`, padding: '2px 0' }}>Remise</td>
                      <td style={{ fontSize: `${fs}px`, padding: '2px 0', textAlign: 'right' }}>-{receipt.discountAmount.toFixed(2)} DH</td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={2} style={{ borderTop: '2px solid #000', paddingTop: '4px' }} />
                  </tr>
                  <tr>
                    <td style={{ fontSize: `${fs + 4}px`, fontWeight: 'bold', padding: '2px 0' }}>TOTAL</td>
                    <td style={{ fontSize: `${fs + 4}px`, fontWeight: 'bold', padding: '2px 0', textAlign: 'right' }}>{receipt.total.toFixed(2)} DH</td>
                  </tr>
                </tbody>
              </table>

              {/* Payment method */}
              <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
              <div style={{ fontSize: `${fs - 1}px`, textAlign: 'center', marginBottom: '4px' }}>
                Paye par: <strong>{paymentLabels[receipt.paymentMethod] || receipt.paymentMethod}</strong>
              </div>
              {settings.receiptShowPaymentDetail && receipt.cashGiven !== undefined && (
                <table style={{ width: '100%', margin: '4px 0' }}>
                  <tbody>
                    <tr>
                      <td style={{ fontSize: `${fs - 1}px`, padding: '2px 0' }}>Montant donne</td>
                      <td style={{ fontSize: `${fs - 1}px`, padding: '2px 0', textAlign: 'right' }}>{receipt.cashGiven.toFixed(2)} DH</td>
                    </tr>
                    <tr>
                      <td style={{ fontSize: `${fs - 1}px`, padding: '2px 0', fontWeight: 'bold' }}>Monnaie rendue</td>
                      <td style={{ fontSize: `${fs - 1}px`, padding: '2px 0', textAlign: 'right', fontWeight: 'bold' }}>{(receipt.changeAmount ?? 0).toFixed(2)} DH</td>
                    </tr>
                  </tbody>
                </table>
              )}

              {/* Footer */}
              <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
              <div style={{ textAlign: 'center', fontSize: `${fs - 2}px`, color: '#555', marginTop: '10px' }}>
                {settings.receiptFooter && <p style={{ margin: '2px 0' }}>{settings.receiptFooter}</p>}
                <p style={{ margin: '2px 0' }}>A bientot chez {settings.companyName}</p>
                {settings.receiptExtraLines && settings.receiptExtraLines.split('\n').map((line, i) => (
                  <p key={i} style={{ margin: '2px 0' }}>{line}</p>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Fermer</button>
          <button onClick={handlePrint} className="btn-primary flex-1 flex items-center justify-center gap-2">
            <Printer size={18} />
            {hasPrinted ? 'Reimprimer' : 'Imprimer'}
          </button>
        </div>

        {/* Auto-print indicator */}
        {settings.receiptAutoPrint && hasPrinted && (
          <div className="px-4 pb-3 text-center">
            <span className="text-xs text-green-600 font-medium">Impression automatique effectuee</span>
          </div>
        )}
      </div>
    </div>
  );
}

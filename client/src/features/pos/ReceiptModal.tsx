import { useRef } from 'react';
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
}

const paymentLabels: Record<string, string> = {
  cash: 'Especes',
  card: 'Carte bancaire',
  mobile: 'Paiement mobile',
};

export default function ReceiptModal({ receipt, onClose }: { receipt: ReceiptData; onClose: () => void }) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const { settings } = useSettings();

  const handlePrint = () => {
    const printWindow = window.open('', '_blank', 'width=300,height=600');
    if (!printWindow) return;

    const content = receiptRef.current?.innerHTML || '';
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Recu ${receipt.saleNumber}</title>
        <style>
          @page { margin: 2mm; size: 80mm auto; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Courier New', monospace;
            font-size: 12px;
            width: 76mm;
            padding: 2mm;
            color: #000;
          }
          .receipt-header { text-align: center; margin-bottom: 8px; }
          .receipt-logo { font-size: 28px; margin-bottom: 4px; }
          .receipt-title { font-size: 18px; font-weight: bold; letter-spacing: 2px; }
          .receipt-subtitle { font-size: 10px; color: #555; margin-top: 2px; }
          .receipt-divider { border-top: 1px dashed #000; margin: 6px 0; }
          .receipt-info { font-size: 11px; margin-bottom: 2px; }
          .receipt-items { width: 100%; border-collapse: collapse; margin: 4px 0; }
          .receipt-items td { padding: 2px 0; font-size: 11px; vertical-align: top; }
          .receipt-items .item-name { font-weight: bold; }
          .receipt-items .item-detail { padding-left: 8px; color: #333; }
          .receipt-items .item-total { text-align: right; font-weight: bold; }
          .receipt-totals { width: 100%; margin-top: 4px; }
          .receipt-totals td { padding: 2px 0; font-size: 12px; }
          .receipt-totals .total-label { font-weight: bold; }
          .receipt-totals .total-value { text-align: right; font-weight: bold; }
          .receipt-grand-total td { font-size: 16px; padding-top: 4px; border-top: 2px solid #000; }
          .receipt-footer { text-align: center; margin-top: 10px; font-size: 10px; color: #555; }
          .receipt-footer p { margin: 2px 0; }
        </style>
      </head>
      <body>${content}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  };

  const formattedDate = format(new Date(receipt.date), "dd MMMM yyyy 'a' HH:mm", { locale: fr });

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
                <div className="receipt-logo" style={{ fontSize: '28px', marginBottom: '4px' }}>🥐</div>
                <div className="receipt-title" style={{ fontSize: '18px', fontWeight: 'bold', letterSpacing: '2px' }}>{settings.companyName}</div>
                <div className="receipt-subtitle" style={{ fontSize: '10px', color: '#555', marginTop: '2px' }}>{settings.subtitle}</div>
              </div>

              {/* Divider */}
              <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

              {/* Info */}
              <div style={{ fontSize: '11px', marginBottom: '2px' }}>N°: {receipt.saleNumber}</div>
              <div style={{ fontSize: '11px', marginBottom: '2px' }}>Date: {formattedDate}</div>
              <div style={{ fontSize: '11px', marginBottom: '2px' }}>Caissier: {receipt.cashierName}</div>
              {receipt.customerName && (
                <div style={{ fontSize: '11px', marginBottom: '2px' }}>Client: {receipt.customerName}</div>
              )}

              {/* Divider */}
              <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

              {/* Items */}
              <table style={{ width: '100%', borderCollapse: 'collapse', margin: '4px 0' }}>
                <tbody>
                  {receipt.items.map((item, idx) => (
                    <tr key={idx}>
                      <td colSpan={3} style={{ padding: '2px 0', fontSize: '11px' }}>
                        <div style={{ fontWeight: 'bold' }}>{item.name}</div>
                        <div style={{ paddingLeft: '8px', color: '#333' }}>
                          {item.quantity} x {item.unitPrice.toFixed(2)} DH
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', padding: '2px 0', fontSize: '11px', verticalAlign: 'bottom' }}>
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
                    <td style={{ fontSize: '12px', padding: '2px 0' }}>Sous-total</td>
                    <td style={{ fontSize: '12px', padding: '2px 0', textAlign: 'right' }}>{receipt.subtotal.toFixed(2)} DH</td>
                  </tr>
                  {receipt.discountAmount > 0 && (
                    <tr>
                      <td style={{ fontSize: '12px', padding: '2px 0' }}>Remise</td>
                      <td style={{ fontSize: '12px', padding: '2px 0', textAlign: 'right' }}>-{receipt.discountAmount.toFixed(2)} DH</td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={2} style={{ borderTop: '2px solid #000', paddingTop: '4px' }} />
                  </tr>
                  <tr>
                    <td style={{ fontSize: '16px', fontWeight: 'bold', padding: '2px 0' }}>TOTAL</td>
                    <td style={{ fontSize: '16px', fontWeight: 'bold', padding: '2px 0', textAlign: 'right' }}>{receipt.total.toFixed(2)} DH</td>
                  </tr>
                </tbody>
              </table>

              {/* Payment method */}
              <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
              <div style={{ fontSize: '11px', textAlign: 'center', marginBottom: '4px' }}>
                Paye par: <strong>{paymentLabels[receipt.paymentMethod] || receipt.paymentMethod}</strong>
              </div>

              {/* Footer */}
              <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
              <div style={{ textAlign: 'center', fontSize: '10px', color: '#555', marginTop: '10px' }}>
                <p style={{ margin: '2px 0' }}>Merci pour votre visite !</p>
                <p style={{ margin: '2px 0' }}>A bientot chez {settings.companyName}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Fermer</button>
          <button onClick={handlePrint} className="btn-primary flex-1 flex items-center justify-center gap-2">
            <Printer size={18} />
            Imprimer
          </button>
        </div>
      </div>
    </div>
  );
}

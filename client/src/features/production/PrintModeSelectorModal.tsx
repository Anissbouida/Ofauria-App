import { useState } from 'react';
import { X, Printer, Bluetooth, Loader2, AlertCircle } from 'lucide-react';
import { isWebBluetoothSupported, printLotLabel, NiimbotPrintError, type LotLabelData } from '../../lib/niimbot';
import { notify } from '../../components/ui/InlineNotification';

interface Props {
  lotData: LotLabelData;
  onPreviewHtml: () => void;
  onClose: () => void;
}

export default function PrintModeSelectorModal({ lotData, onPreviewHtml, onClose }: Props) {
  const [printing, setPrinting] = useState(false);
  const [copies, setCopies] = useState(1);
  const btSupported = isWebBluetoothSupported();

  const handleNiimbotPrint = async () => {
    setPrinting(true);
    try {
      await printLotLabel(lotData, { copies });
      notify({ type: 'success', title: 'Etiquette imprimee', message: `${copies} etiquette(s) envoyee(s) a la NIIMBOT.` });
      onClose();
    } catch (err) {
      if (err instanceof NiimbotPrintError && err.code === 'cancelled') {
        // Silencieux : l'utilisateur a annule l'appairage
      } else {
        const msg = err instanceof Error ? err.message : 'Erreur inconnue';
        notify({ type: 'error', title: 'Echec impression NIIMBOT', message: msg });
      }
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9998] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">Imprimer le ticket</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg" disabled={printing}>
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
            <span className="font-medium text-gray-700">{lotData.productName}</span>
            <span className="text-gray-400">•</span>
            <span className="font-mono text-xs">{lotData.lotNumber}</span>
          </div>

          <button
            onClick={handleNiimbotPrint}
            disabled={!btSupported || printing}
            className="w-full flex items-center gap-3 p-4 border-2 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 rounded-xl text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-emerald-50"
          >
            <div className="p-2.5 bg-emerald-600 rounded-lg shrink-0">
              {printing ? <Loader2 size={20} className="text-white animate-spin" /> : <Bluetooth size={20} className="text-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-gray-900">Imprimante NIIMBOT B1 PRO</div>
              <div className="text-xs text-gray-600 mt-0.5">
                {btSupported
                  ? 'Etiquette adhesive 50x30mm via Bluetooth'
                  : 'Bluetooth non supporte sur ce navigateur (Safari/Firefox)'}
              </div>
            </div>
          </button>

          {btSupported && (
            <div className="flex items-center gap-2 px-3 text-sm">
              <label className="text-gray-600">Copies :</label>
              <input
                type="number"
                min={1}
                max={20}
                value={copies}
                onChange={(e) => setCopies(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                disabled={printing}
                className="w-16 px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          )}

          <button
            onClick={() => { onPreviewHtml(); onClose(); }}
            disabled={printing}
            className="w-full flex items-center gap-3 p-4 border border-gray-200 hover:bg-gray-50 rounded-xl text-left transition-colors disabled:opacity-50"
          >
            <div className="p-2.5 bg-gray-600 rounded-lg shrink-0">
              <Printer size={20} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-gray-900">Apercu HTML</div>
              <div className="text-xs text-gray-600 mt-0.5">Imprimer sur imprimante PDF/laser/ticket classique</div>
            </div>
          </button>

          {!btSupported && (
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>
                Pour imprimer directement sur la NIIMBOT, ouvrez l'application dans <b>Chrome</b> ou <b>Edge</b>.
                Safari et Firefox ne supportent pas Web Bluetooth.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

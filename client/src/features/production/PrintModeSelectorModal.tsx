import { useState } from 'react';
import { Printer, Bluetooth, Loader2, AlertCircle } from 'lucide-react';
import { Modal, FormField } from '../../components/ds';
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
    <Modal title="Imprimer le ticket" onClose={onClose} locked={printing} width={448}
      subtitle={<>{lotData.productName} · <span className="font-mono">{lotData.lotNumber}</span></>}>
        <div className="space-y-3">
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
            <div className="px-3" style={{ maxWidth: 160 }}>
              <FormField label="Copies" htmlFor="niimbot-copies">
              <input
                id="niimbot-copies"
                type="number"
                min={1}
                max={20}
                value={copies}
                onChange={(e) => setCopies(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                disabled={printing}
                className="ds-input sm"
              />
              </FormField>
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
    </Modal>
  );
}

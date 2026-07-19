// Parametres du poste de caisse — modal ⚙️ du POS.
//
// Reglages LOCAUX au terminal (localStorage), a la maniere des reglages d'app
// Loyverse : impression auto du ticket, ouverture du tiroir, imprimante du
// poste. Chaque reglage peut suivre le reglage global du back-office ou le
// surcharger pour ce poste uniquement.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Printer, Monitor, Volume2, Sun, LayoutGrid, ScanLine } from 'lucide-react';
import { printersApi } from '../../api/printer.api';
import { useSettings } from '../../context/SettingsContext';
import {
  getTerminalSettings, setTerminalSetting, setTerminalPrinter,
  setTerminalBool, setTerminalGridSize, type TriState, type GridSize,
} from './terminal-settings';
import { playPosSound } from './pos-sounds';

function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
      {options.map(o => (
        <button key={o.key} type="button" onClick={() => onChange(o.key)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            value === o.key ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TriStateSelector({ value, globalValue, onChange }: {
  value: TriState;
  globalValue: boolean;
  onChange: (v: TriState) => void;
}) {
  const options: { key: TriState; label: string }[] = [
    { key: 'global', label: `Global (${globalValue ? 'Oui' : 'Non'})` },
    { key: 'on', label: 'Oui' },
    { key: 'off', label: 'Non' },
  ];
  return (
    <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
      {options.map(o => (
        <button key={o.key} type="button" onClick={() => onChange(o.key)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            value === o.key ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function POSSettingsModal({ onClose }: { onClose: () => void }) {
  const { settings } = useSettings();
  const [terminal, setTerminal] = useState(getTerminalSettings());

  // Liste des imprimantes ticket du magasin. 403 possible selon le role :
  // dans ce cas on masque simplement le selecteur.
  const printersQuery = useQuery({
    queryKey: ['printers'],
    queryFn: printersApi.list,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const receiptPrinters = (printersQuery.data || []).filter(p => p.type === 'receipt' && p.is_active);

  const update = (key: 'autoPrint' | 'openDrawer', v: TriState) => {
    setTerminalSetting(key, v);
    setTerminal(getTerminalSettings());
  };
  const updatePrinter = (id: string) => {
    setTerminalPrinter(id);
    setTerminal(getTerminalSettings());
  };
  const updateBool = (key: 'sounds' | 'keepAwake' | 'scanner', v: boolean) => {
    setTerminalBool(key, v);
    setTerminal(getTerminalSettings());
    // Feedback immediat quand on reactive les sons.
    if (key === 'sounds' && v) playPosSound('add');
  };
  const updateGrid = (v: GridSize) => {
    setTerminalGridSize(v);
    setTerminal(getTerminalSettings());
  };
  const ouiNon = (v: boolean): 'on' | 'off' => (v ? 'on' : 'off');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="px-6 pt-5 pb-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Monitor size={18} className="text-primary-600" />
            <h2 className="font-bold text-gray-800">Paramètres du poste</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-5">
          <p className="text-xs text-gray-500">
            Ces réglages s'appliquent uniquement à <strong>ce poste</strong> (cet appareil).
            « Global » suit le réglage du back-office (Réglages → Impression).
          </p>

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-700">Impression automatique</p>
              <p className="text-xs text-gray-400">Imprimer le ticket dès l'encaissement</p>
            </div>
            <TriStateSelector value={terminal.autoPrint}
              globalValue={!!settings.receiptAutoPrint}
              onChange={(v) => update('autoPrint', v)} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-700">Ouverture du tiroir</p>
              <p className="text-xs text-gray-400">À l'encaissement espèces ou mixte</p>
            </div>
            <TriStateSelector value={terminal.openDrawer}
              globalValue={!!settings.receiptOpenDrawer}
              onChange={(v) => update('openDrawer', v)} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2">
              <Volume2 size={15} className="text-gray-500 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-gray-700">Sons de caisse</p>
                <p className="text-xs text-gray-400">Bip à l'ajout, son d'encaissement et d'erreur</p>
              </div>
            </div>
            <Segmented value={ouiNon(terminal.sounds)}
              options={[{ key: 'on', label: 'Oui' }, { key: 'off', label: 'Non' }]}
              onChange={(v) => updateBool('sounds', v === 'on')} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2">
              <Sun size={15} className="text-gray-500 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-gray-700">Écran toujours allumé</p>
                <p className="text-xs text-gray-400">Empêche la mise en veille tant que le POS est ouvert</p>
              </div>
            </div>
            <Segmented value={ouiNon(terminal.keepAwake)}
              options={[{ key: 'on', label: 'Oui' }, { key: 'off', label: 'Non' }]}
              onChange={(v) => updateBool('keepAwake', v === 'on')} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2">
              <LayoutGrid size={15} className="text-gray-500 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-gray-700">Taille des produits</p>
                <p className="text-xs text-gray-400">Vignettes de la grille de vente</p>
              </div>
            </div>
            <Segmented value={terminal.gridSize}
              options={[{ key: 'compact', label: 'Compact' }, { key: 'normal', label: 'Normal' }, { key: 'large', label: 'Grand' }]}
              onChange={updateGrid} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2">
              <ScanLine size={15} className="text-gray-500 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-gray-700">Scanner code-barres</p>
                <p className="text-xs text-gray-400">Caméra du poste — le code doit correspondre au SKU produit</p>
              </div>
            </div>
            <Segmented value={ouiNon(terminal.scanner)}
              options={[{ key: 'on', label: 'Oui' }, { key: 'off', label: 'Non' }]}
              onChange={(v) => updateBool('scanner', v === 'on')} />
          </div>

          {printersQuery.isSuccess && (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Printer size={14} className="text-gray-500" />
                <p className="text-sm font-semibold text-gray-700">Imprimante du poste</p>
              </div>
              {receiptPrinters.length === 0 ? (
                <p className="text-xs text-gray-400">Aucune imprimante ticket configurée pour ce magasin (Réglages → Impression).</p>
              ) : (
                <select value={terminal.printerId}
                  onChange={(e) => updatePrinter(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400">
                  <option value="">Imprimante par défaut du magasin</option>
                  {receiptPrinters.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.is_default ? ' (défaut)' : ''} — {p.connection_string}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        <div className="px-6 pb-5">
          <button onClick={onClose} className="btn-primary w-full py-2.5">Fermer</button>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Printer, Plus, Pencil, Trash2, Zap, CheckCircle2 } from 'lucide-react';
import { printersApi, type PrinterConfig } from '../../api/printer.api';
import { notify } from '../../components/ui/InlineNotification';

const PRINTER_MODELS = ['EPSON', 'STAR', 'TANCA', 'DARUMA', 'BROTHER', 'CUSTOM'] as const;
const TYPES: Array<{ value: PrinterConfig['type']; label: string }> = [
  { value: 'receipt', label: 'Ticket de vente' },
  { value: 'kitchen', label: 'Cuisine' },
  { value: 'label', label: 'Etiquette' },
];

type FormData = {
  name: string;
  type: PrinterConfig['type'];
  interface: PrinterConfig['interface'];
  connectionString: string;
  printerModel: PrinterConfig['printer_model'];
  paperWidth: number;
  isDefault: boolean;
  openDrawerOnCash: boolean;
};

const EMPTY_FORM: FormData = {
  name: '', type: 'receipt', interface: 'tcp', connectionString: '',
  printerModel: 'EPSON', paperWidth: 48, isDefault: true, openDrawerOnCash: true,
};

export default function PrinterSettingsCard() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<PrinterConfig | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);

  const { data: printers = [], isLoading } = useQuery({
    queryKey: ['printers'],
    queryFn: printersApi.list,
  });

  const saveMutation = useMutation({
    mutationFn: () => editing
      ? printersApi.update(editing.id, form)
      : printersApi.create(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['printers'] });
      notify.success(editing ? 'Imprimante mise a jour' : 'Imprimante ajoutee');
      resetForm();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify.error(msg || 'Erreur lors de l\'enregistrement');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => printersApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['printers'] });
      notify.success('Imprimante supprimee');
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => printersApi.test(id),
    onSuccess: () => notify.success('Test imprime — verifier le ticket'),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify.error(msg || 'Test echoue (imprimante injoignable ?)');
    },
  });

  const drawerMutation = useMutation({
    mutationFn: (id: string) => printersApi.openDrawer(id),
    onSuccess: () => notify.success('Tiroir ouvert'),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify.error(msg || 'Echec ouverture tiroir');
    },
  });

  const resetForm = () => {
    setEditing(null);
    setShowForm(false);
    setForm(EMPTY_FORM);
  };

  const startEdit = (p: PrinterConfig) => {
    setEditing(p);
    setShowForm(true);
    setForm({
      name: p.name, type: p.type, interface: p.interface,
      connectionString: p.connection_string,
      printerModel: p.printer_model, paperWidth: p.paper_width,
      isDefault: p.is_default, openDrawerOnCash: p.open_drawer_on_cash,
    });
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
            <Printer size={20} className="text-gray-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Imprimantes physiques</h2>
            <p className="text-sm text-gray-500">
              Connexion directe ESC/POS (TCP ou USB). Necessaire pour ouvrir le tiroir-caisse.
            </p>
          </div>
        </div>
        {!showForm && (
          <button onClick={() => { setShowForm(true); setEditing(null); setForm(EMPTY_FORM); }}
            className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={14} /> Ajouter
          </button>
        )}
      </div>

      {/* Liste */}
      {isLoading ? (
        <p className="text-sm text-gray-400">Chargement...</p>
      ) : printers.length === 0 && !showForm ? (
        <div className="text-center py-6 text-gray-400 text-sm">
          Aucune imprimante configuree. L'impression passera par le navigateur (sans tiroir-caisse).
        </div>
      ) : (
        <div className="space-y-2 mb-4">
          {printers.map(p => (
            <div key={p.id} className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {p.is_default && (
                    <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">Par defaut</span>
                  )}
                  <span className="text-xs text-gray-500">{TYPES.find(t => t.value === p.type)?.label}</span>
                </div>
                <div className="text-xs text-gray-400 truncate">
                  {p.printer_model} - {p.interface}://{p.connection_string} - {p.paper_width} car.
                </div>
              </div>
              <button onClick={() => testMutation.mutate(p.id)} disabled={testMutation.isPending}
                className="p-2 hover:bg-blue-50 rounded-lg" title="Test impression">
                <CheckCircle2 size={16} className="text-blue-500" />
              </button>
              <button onClick={() => drawerMutation.mutate(p.id)} disabled={drawerMutation.isPending}
                className="p-2 hover:bg-amber-50 rounded-lg" title="Ouvrir tiroir">
                <Zap size={16} className="text-amber-500" />
              </button>
              <button onClick={() => startEdit(p)} className="p-2 hover:bg-gray-100 rounded-lg" title="Modifier">
                <Pencil size={16} className="text-gray-500" />
              </button>
              <button onClick={() => { if (confirm(`Supprimer "${p.name}" ?`)) deleteMutation.mutate(p.id); }}
                className="p-2 hover:bg-red-50 rounded-lg" title="Supprimer">
                <Trash2 size={16} className="text-red-400" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Formulaire */}
      {showForm && (
        <div className="border-t pt-4 mt-2">
          <h3 className="font-medium mb-3">{editing ? 'Modifier' : 'Nouvelle imprimante'}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">Nom *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex: Caisse principale"
                className="input" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as PrinterConfig['type'] })}
                className="input">
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Modele</label>
              <select value={form.printerModel} onChange={(e) => setForm({ ...form, printerModel: e.target.value as PrinterConfig['printer_model'] })}
                className="input">
                {PRINTER_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Interface</label>
              <select value={form.interface} onChange={(e) => setForm({ ...form, interface: e.target.value as PrinterConfig['interface'] })}
                className="input">
                <option value="tcp">TCP (reseau)</option>
                <option value="usb">USB</option>
                <option value="serial">Serie</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Largeur (car. par ligne)</label>
              <select value={form.paperWidth} onChange={(e) => setForm({ ...form, paperWidth: parseInt(e.target.value) })}
                className="input">
                <option value={32}>32 (papier 58 mm)</option>
                <option value={42}>42 (intermediaire)</option>
                <option value={48}>48 (papier 80 mm)</option>
                <option value={64}>64 (papier large)</option>
              </select>
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">Chaine de connexion *</label>
              <input value={form.connectionString} onChange={(e) => setForm({ ...form, connectionString: e.target.value })}
                placeholder={
                  form.interface === 'tcp' ? 'tcp://192.168.1.100:9100' :
                  form.interface === 'usb' ? 'usb:///dev/usb/lp0 ou printer://NomImprimanteWindows' :
                  '/dev/ttyUSB0'
                }
                className="input font-mono text-sm" />
              <p className="text-xs text-gray-400 mt-1">
                {form.interface === 'tcp' && 'IP fixe recommandee. Port standard 9100. Tester avec : telnet IP 9100'}
                {form.interface === 'usb' && 'Necessite un agent local sur le poste caisse'}
                {form.interface === 'serial' && 'Port serie RS-232 (rare aujourd\'hui)'}
              </p>
            </div>

            <div className="col-span-2 flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isDefault}
                  onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
                Par defaut pour ce type
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.openDrawerOnCash}
                  onChange={(e) => setForm({ ...form, openDrawerOnCash: e.target.checked })} />
                Ouvrir tiroir sur paiement especes
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <button onClick={resetForm} className="btn-secondary">Annuler</button>
            <button onClick={() => saveMutation.mutate()}
              disabled={!form.name || !form.connectionString || saveMutation.isPending}
              className="btn-primary">
              {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

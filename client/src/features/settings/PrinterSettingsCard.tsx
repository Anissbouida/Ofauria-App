import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Printer, Plus, Pencil, Trash2, Zap, CheckCircle2 } from 'lucide-react';
import { printersApi, type PrinterConfig, type SystemPrinter } from '../../api/printer.api';
import { Search, Usb } from 'lucide-react';
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
  // Détection (mig 376) : files d'impression et imprimantes USB vues par la machine du serveur.
  const [detect, setDetect] = useState(false);
  const systemQuery = useQuery({ queryKey: ['printers-system'], queryFn: printersApi.system, enabled: detect });
  const [attachName, setAttachName] = useState('Caisse');
  const attachMutation = useMutation({
    mutationFn: (p: SystemPrinter) => printersApi.attachSystem(attachName, p.uri),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['printers-system'] }); notify.success('File d\'impression créée : choisissez-la ci-dessous'); },
    onError: (err: unknown) => notify.error((err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'Impossible de créer la file'),
  });
  const useQueue = (p: SystemPrinter) => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, name: form.name || p.name, interface: 'cups', connectionString: p.name });
    setShowForm(true);
  };

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
    <section className="odoo-setting-section" id="set-imprimantes-physiques" data-toc="Imprimantes physiques">
      <div className="odoo-setting-section-head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h3 className="odoo-setting-section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Printer size={17} style={{ color: 'var(--theme-accent)' }} /> Imprimantes physiques
          </h3>
          <p className="odoo-setting-section-help">
            Connexion directe ESC/POS (TCP ou USB). Necessaire pour ouvrir le tiroir-caisse.
          </p>
        </div>
        {!showForm && (
          <button onClick={() => { setShowForm(true); setEditing(null); setForm(EMPTY_FORM); }}
            className="odoo-btn-primary flex items-center gap-2 text-sm">
            <Plus size={14} /> Ajouter
          </button>
        )}
      </div>
      <div style={{ padding: '14px 18px 18px' }}>

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
            <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ border: '1px solid var(--theme-bg-separator, var(--odoo-border))' }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {p.is_default && (
                    <span className="odoo-tag odoo-tag-purple">Par defaut</span>
                  )}
                  <span className="text-xs text-gray-500">{TYPES.find(t => t.value === p.type)?.label}</span>
                </div>
                <div className="text-xs text-gray-400 truncate">
                  {p.printer_model} - {p.interface}://{p.connection_string} - {p.paper_width} car.
                </div>
              </div>
              <button onClick={() => testMutation.mutate(p.id)} disabled={testMutation.isPending}
                className="odoo-btn-secondary" style={{ padding: '6px 9px' }} title="Test impression" aria-label="Test impression">
                <CheckCircle2 size={15} />
              </button>
              <button onClick={() => drawerMutation.mutate(p.id)} disabled={drawerMutation.isPending}
                className="odoo-btn-secondary" style={{ padding: '6px 9px' }} title="Ouvrir tiroir" aria-label="Ouvrir tiroir">
                <Zap size={15} />
              </button>
              <button onClick={() => startEdit(p)} className="odoo-btn-secondary" style={{ padding: '6px 9px' }} title="Modifier" aria-label="Modifier">
                <Pencil size={15} />
              </button>
              <button onClick={() => { if (confirm(`Supprimer "${p.name}" ?`)) deleteMutation.mutate(p.id); }}
                className="odoo-btn-danger" style={{ padding: '6px 9px' }} title="Supprimer" aria-label="Supprimer">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Détection sur le poste serveur (mig 376) */}
      <div className="border-t pt-3 mt-2">
        <button onClick={() => setDetect(true)} className="odoo-btn-secondary flex items-center gap-2 text-sm">
          <Search size={14} /> Détecter les imprimantes du poste
        </button>
        {detect && (
          <div className="mt-3 text-sm">
            {systemQuery.isLoading && <p className="text-gray-400">Recherche…</p>}
            {systemQuery.data && !systemQuery.data.available && (
              <p style={{ color: 'var(--prj-orange)' }}>Aucun système d'impression sur la machine du serveur (CUPS absent). Une thermique USB doit être branchée sur la machine qui fait tourner Kalum, ou être en réseau (TCP).</p>
            )}
            {systemQuery.data?.available && systemQuery.data.printers.length === 0 && <p className="text-gray-500">Aucune imprimante détectée.</p>}
            {systemQuery.data?.printers.map(p => (
              <div key={p.uri} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
                {p.kind === 'usb' ? <Usb size={16} style={{ color: 'var(--theme-accent)' }} /> : <Printer size={16} className="text-gray-500" />}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{p.name}</p>
                  <p className="text-xs text-gray-400 font-mono truncate">{p.uri}{p.status ? ` · ${p.status}` : ''}</p>
                </div>
                {p.kind === 'queue' ? (
                  <button onClick={() => useQueue(p)} className="odoo-btn-secondary text-xs">Utiliser cette file</button>
                ) : (
                  <div className="flex items-center gap-2">
                    <input value={attachName} onChange={e => setAttachName(e.target.value.replace(/[^A-Za-z0-9_-]/g, ''))} className="input text-xs w-28" placeholder="Nom de file" />
                    <button onClick={() => attachMutation.mutate(p)} disabled={attachMutation.isPending || !attachName} className="odoo-btn-primary text-xs">Ajouter au système</button>
                  </div>
                )}
              </div>
            ))}
            {systemQuery.data?.available && (
              <p className="text-xs text-gray-400 mt-2">Une imprimante USB doit d'abord être ajoutée au système (file brute), puis déclarée ici avec l'interface « Système ».</p>
            )}
          </div>
        )}
      </div>

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
                <option value="cups">Système du poste (file d'impression)</option>
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
                  form.interface === 'cups' ? 'Nom de la file (ex. Caisse)' :
                  form.interface === 'usb' ? 'usb:///dev/usb/lp0 ou printer://NomImprimanteWindows' :
                  '/dev/ttyUSB0'
                }
                className="input font-mono text-sm" />
              <p className="text-xs text-gray-400 mt-1">
                {form.interface === 'tcp' && 'IP fixe recommandee. Port standard 9100. Tester avec : telnet IP 9100'}
                {form.interface === 'cups' && 'File d\'impression du système de la machine serveur, créée en mode brut (voir « Détecter »)'}
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
            <button onClick={resetForm} className="odoo-btn-secondary">Annuler</button>
            <button onClick={() => saveMutation.mutate()}
              disabled={!form.name || !form.connectionString || saveMutation.isPending}
              className="odoo-btn-primary">
              {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}
      </div>
    </section>
  );
}

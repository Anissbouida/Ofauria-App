import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { productsApi } from '../../api/products.api';
import { productLossesApi } from '../../api/product-losses.api';
import api, { serverUrl } from '../../api/client';
import { Search, Camera, X, AlertTriangle, CheckCircle, Trash2, Image } from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import { getApiErrorMessage } from '../../utils/api-error';

interface Props {
  onClose: () => void;
  sessionId?: string;
}

const LOSS_REASONS = [
  { value: 'chute', label: 'Chute / Tombé', icon: '💥' },
  { value: 'casse', label: 'Cassé / Écrasé', icon: '💔' },
  { value: 'perime', label: 'Périmé', icon: '⏰' },
  { value: 'qualite_non_conforme', label: 'Qualité non conforme', icon: '⚠️' },
  { value: 'retour_client', label: 'Retour client', icon: '↩️' },
  { value: 'erreur_humaine', label: 'Erreur humaine', icon: '🙁' },
  { value: 'autre', label: 'Autre', icon: '📝' },
];

export default function LossDeclarationModal({ onClose, sessionId }: Props) {
  const [step, setStep] = useState<'product' | 'details' | 'done'>('product');
  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Record<string, unknown> | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: productsData } = useQuery({
    queryKey: ['products', 'pos-loss'],
    queryFn: () => productsApi.list({ limit: '500' }),
  });

  const products = (productsData?.data || []) as Record<string, unknown>[];
  const filtered = products.filter((p) => {
    if (!search) return true;
    const name = (p.name as string || '').toLowerCase();
    return name.includes(search.toLowerCase());
  });

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Preview
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    // Upload
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      const res = await api.post('/upload/loss-photo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPhotoUrl(res.data.data.url);
      notify.success('Photo enregistree');
    } catch (err) {
      console.error('Upload error:', err);
      notify.error('Erreur lors de l\'envoi de la photo');
      setPhotoPreview(null);
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = () => {
    setPhotoUrl(null);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!selectedProduct || !reason || quantity <= 0) return;

    setSaving(true);
    try {
      await productLossesApi.create({
        productId: selectedProduct.id as string,
        quantity,
        lossType: 'vitrine',
        reason,
        reasonNote: reasonNote || undefined,
        photoUrl: photoUrl || undefined,
      });
      notify.success('Perte declaree avec succes');
      setStep('done');
    } catch (err) {
      notify.error(getApiErrorMessage(err, 'Erreur lors de la declaration'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-red-50 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-red-200 flex items-center justify-center">
              <AlertTriangle size={18} className="text-red-700" />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">Declarer une perte</h2>
              <p className="text-xs text-gray-500">
                {step === 'product' ? 'Selectionnez le produit' :
                 step === 'details' ? (selectedProduct?.name as string) :
                 'Declaration enregistree'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/80 rounded-lg text-gray-400">
            <X size={20} />
          </button>
        </div>

        {/* Step 1: Product selection */}
        {step === 'product' && (
          <div className="p-5 flex-1 flex flex-col">
            <div className="relative mb-4">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un produit..."
                className="input pl-9"
                autoFocus
              />
            </div>

            <div className="flex-1 overflow-y-auto max-h-[50vh] space-y-1">
              {filtered.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">Aucun produit trouve</p>
              ) : (
                filtered.map((p) => (
                  <button
                    key={p.id as string}
                    onClick={() => { setSelectedProduct(p); setStep('details'); }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors text-left"
                  >
                    {p.image_url ? (
                      <img src={serverUrl(p.image_url as string)} alt="" className="w-10 h-10 rounded-lg object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 text-xs">N/A</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-900 truncate">{p.name as string}</div>
                      <div className="text-xs text-gray-400">{(p.category_name as string) || 'Sans categorie'} — Stock: {parseInt(String(p.stock_quantity || 0))}</div>
                    </div>
                  </button>
                ))
              )}
            </div>

            <button onClick={onClose} className="btn-secondary w-full mt-4 py-3">Annuler</button>
          </div>
        )}

        {/* Step 2: Details */}
        {step === 'details' && selectedProduct && (
          <div className="p-5 flex-1 flex flex-col gap-4">
            {/* Selected product summary */}
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              {selectedProduct.image_url ? (
                <img src={serverUrl(selectedProduct.image_url as string)} alt="" className="w-12 h-12 rounded-lg object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-gray-200 flex items-center justify-center text-gray-400 text-sm">N/A</div>
              )}
              <div className="flex-1">
                <div className="font-semibold text-gray-900">{selectedProduct.name as string}</div>
                <div className="text-xs text-gray-500">
                  {(selectedProduct.category_name as string)} — {parseFloat(String(selectedProduct.price || 0)).toFixed(2)} DH
                </div>
              </div>
              <button onClick={() => { setStep('product'); setSelectedProduct(null); }}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium">Changer</button>
            </div>

            {/* Quantity */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Quantite perdue</label>
              <div className="flex items-center gap-2">
                <button onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  className="w-10 h-10 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 font-bold text-lg">-</button>
                <input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-20 h-10 text-center text-lg font-bold border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-300"
                />
                <button onClick={() => setQuantity(q => q + 1)}
                  className="w-10 h-10 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 font-bold text-lg">+</button>
              </div>
            </div>

            {/* Reason */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Motif de la perte</label>
              <div className="grid grid-cols-2 gap-2">
                {LOSS_REASONS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setReason(r.value)}
                    className={`flex items-center gap-2 p-2.5 rounded-xl text-sm font-medium border-2 transition-all ${
                      reason === r.value
                        ? 'border-red-400 bg-red-50 text-red-800 ring-1 ring-red-300'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    <span>{r.icon}</span>
                    <span className="truncate">{r.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Note */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Commentaire (optionnel)</label>
              <textarea
                value={reasonNote}
                onChange={(e) => setReasonNote(e.target.value)}
                placeholder="Details supplementaires..."
                className="input"
                rows={2}
              />
            </div>

            {/* Photo capture */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Photo (optionnel)</label>
              {photoPreview ? (
                <div className="relative w-full h-40 rounded-xl overflow-hidden border border-gray-200">
                  <img src={photoPreview} alt="Photo perte" className="w-full h-full object-cover" />
                  <button onClick={removePhoto}
                    className="absolute top-2 right-2 w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg hover:bg-red-600">
                    <Trash2 size={14} />
                  </button>
                  {uploading && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-28 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-gray-400 hover:text-gray-500 transition-colors"
                >
                  <Camera size={28} />
                  <span className="text-sm font-medium">Prendre une photo</span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoCapture}
                className="hidden"
              />
            </div>

            {/* Cost preview */}
            {selectedProduct && reason && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex justify-between items-center">
                <span className="text-sm text-red-700 font-medium">Cout estime de la perte</span>
                <span className="text-lg font-bold text-red-800">
                  {(quantity * (parseFloat(String(selectedProduct.cost_price || selectedProduct.price || 0)))).toFixed(2)} DH
                </span>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 mt-auto pt-2">
              <button onClick={() => { setStep('product'); setSelectedProduct(null); setReason(''); setReasonNote(''); removePhoto(); setQuantity(1); }}
                className="btn-secondary flex-1 py-3">Retour</button>
              <button
                onClick={handleSubmit}
                disabled={!reason || saving || uploading}
                className="btn-primary flex-1 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Enregistrement...' : 'Declarer la perte'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Done */}
        {step === 'done' && (
          <div className="p-8 flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle size={32} className="text-green-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900">Perte declaree</h3>
            <p className="text-sm text-gray-500 text-center">
              {quantity}x {selectedProduct?.name as string} — {LOSS_REASONS.find(r => r.value === reason)?.label}
            </p>
            <div className="flex gap-3 w-full mt-4">
              <button onClick={() => {
                setStep('product');
                setSelectedProduct(null);
                setReason('');
                setReasonNote('');
                setQuantity(1);
                removePhoto();
              }} className="btn-secondary flex-1 py-3">Nouvelle perte</button>
              <button onClick={onClose} className="btn-primary flex-1 py-3">Fermer</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sunrise, Moon, Banknote, CreditCard, Save, AlertTriangle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { manualShiftEntriesApi, type ManualShiftEntry } from '../../api/manual-shift-entries.api';
import { notify } from '../../components/ui/InlineNotification';
import { getApiErrorMessage } from '../../utils/api-error';
import { useAuth } from '../../context/AuthContext';

type Shift = 'matin' | 'soir';
type Kind = 'cash' | 'carte';
type Source = 'reel' | 'systeme';

const FIELDS: { shift: Shift; kind: Kind; source: Source; col: keyof ManualShiftEntry }[] = [
  { shift: 'matin', kind: 'cash', source: 'reel', col: 'matin_cash_reel' },
  { shift: 'matin', kind: 'cash', source: 'systeme', col: 'matin_cash_systeme' },
  { shift: 'matin', kind: 'carte', source: 'reel', col: 'matin_carte_reel' },
  { shift: 'matin', kind: 'carte', source: 'systeme', col: 'matin_carte_systeme' },
  { shift: 'soir', kind: 'cash', source: 'reel', col: 'soir_cash_reel' },
  { shift: 'soir', kind: 'cash', source: 'systeme', col: 'soir_cash_systeme' },
  { shift: 'soir', kind: 'carte', source: 'reel', col: 'soir_carte_reel' },
  { shift: 'soir', kind: 'carte', source: 'systeme', col: 'soir_carte_systeme' },
];

type FormState = Record<string, string>;

function toFormState(row: ManualShiftEntry | null): FormState {
  const out: FormState = {};
  for (const f of FIELDS) {
    const v = row?.[f.col] as string | null | undefined;
    out[f.col] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}

function parseAmount(v: string): number | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function formatDiff(reel: number | null, systeme: number | null): { label: string; tone: 'ok' | 'neutral' | 'warn' | 'danger' } | null {
  if (reel === null || systeme === null) return null;
  const diff = reel - systeme;
  const abs = Math.abs(diff);
  const tone = diff === 0 ? 'ok' : abs <= 5 ? 'neutral' : abs <= 20 ? 'warn' : 'danger';
  const sign = diff > 0 ? '+' : '';
  return { label: `${sign}${diff.toFixed(2)} DH`, tone };
}

const TONE_COLORS: Record<'ok' | 'neutral' | 'warn' | 'danger', string> = {
  ok: '#28a745',
  neutral: 'var(--theme-text-muted)',
  warn: '#b85d1a',
  danger: '#d9534f',
};

export default function ManualShiftEntries({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const { user } = useAuth();
  const isPrivileged = user?.role === 'admin' || user?.role === 'manager';
  const queryClient = useQueryClient();

  const [selectedDate, setSelectedDate] = useState<string>(dateTo);

  useEffect(() => {
    if (parseISO(selectedDate) < parseISO(dateFrom) || parseISO(selectedDate) > parseISO(dateTo)) {
      setSelectedDate(dateTo);
    }
  }, [dateFrom, dateTo, selectedDate]);

  const { data: entries = [] } = useQuery({
    queryKey: ['manual-shift-entries', { dateFrom, dateTo }],
    queryFn: () => manualShiftEntriesApi.list({ dateFrom, dateTo }),
    enabled: isPrivileged,
  });

  const currentEntry = useMemo<ManualShiftEntry | null>(() => {
    return entries.find(e => e.entry_date.slice(0, 10) === selectedDate) || null;
  }, [entries, selectedDate]);

  const [form, setForm] = useState<FormState>(() => toFormState(currentEntry));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setForm(toFormState(currentEntry));
    setDirty(false);
  }, [currentEntry, selectedDate]);

  const upsertMutation = useMutation({
    mutationFn: () => manualShiftEntriesApi.upsert({
      entryDate: selectedDate,
      matin_cash_reel: parseAmount(form.matin_cash_reel),
      matin_cash_systeme: parseAmount(form.matin_cash_systeme),
      matin_carte_reel: parseAmount(form.matin_carte_reel),
      matin_carte_systeme: parseAmount(form.matin_carte_systeme),
      soir_cash_reel: parseAmount(form.soir_cash_reel),
      soir_cash_systeme: parseAmount(form.soir_cash_systeme),
      soir_carte_reel: parseAmount(form.soir_carte_reel),
      soir_carte_systeme: parseAmount(form.soir_carte_systeme),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manual-shift-entries'] });
      queryClient.invalidateQueries({ queryKey: ['manual-shift-entries-summary'] });
      queryClient.invalidateQueries({ queryKey: ['sales-summary'] });
      queryClient.invalidateQueries({ queryKey: ['accounting-register'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      queryClient.invalidateQueries({ queryKey: ['caisse'] });
      notify.success('Saisie enregistrée');
      setDirty(false);
    },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, "Erreur lors de l'enregistrement")),
  });

  if (!isPrivileged) return null;

  const setField = (col: string, v: string) => {
    setForm(prev => ({ ...prev, [col]: v }));
    setDirty(true);
  };

  const renderShiftCard = (shift: Shift) => {
    const title = shift === 'matin' ? 'Shift Matin' : 'Shift Soir';
    const Icon = shift === 'matin' ? Sunrise : Moon;
    const iconColor = shift === 'matin' ? '#f59e0b' : '#6366f1';

    const cashReel = parseAmount(form[`${shift}_cash_reel`]);
    const cashSysteme = parseAmount(form[`${shift}_cash_systeme`]);
    const carteReel = parseAmount(form[`${shift}_carte_reel`]);
    const carteSysteme = parseAmount(form[`${shift}_carte_systeme`]);
    const cashDiff = formatDiff(cashReel, cashSysteme);
    const carteDiff = formatDiff(carteReel, carteSysteme);

    return (
      <div className="odoo-section" style={{ flex: 1, minWidth: 280 }}>
        <div className="odoo-section-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon size={14} style={{ color: iconColor }} />
          <strong>{title}</strong>
        </div>
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Cash */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Banknote size={13} style={{ color: '#28a745' }} />
              <strong style={{ fontSize: '0.8125rem' }}>Espèces</strong>
              {cashDiff && (
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', fontWeight: 600, color: TONE_COLORS[cashDiff.tone], display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  {cashDiff.tone === 'danger' && <AlertTriangle size={10} />}
                  écart {cashDiff.label}
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <NumberInput label="Réel" value={form[`${shift}_cash_reel`]} onChange={v => setField(`${shift}_cash_reel`, v)} />
              <NumberInput label="Système" value={form[`${shift}_cash_systeme`]} onChange={v => setField(`${shift}_cash_systeme`, v)} />
            </div>
          </div>

          {/* Carte */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <CreditCard size={13} style={{ color: 'var(--theme-accent)' }} />
              <strong style={{ fontSize: '0.8125rem' }}>Carte</strong>
              {carteDiff && (
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', fontWeight: 600, color: TONE_COLORS[carteDiff.tone], display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  {carteDiff.tone === 'danger' && <AlertTriangle size={10} />}
                  écart {carteDiff.label}
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <NumberInput label="Réel" value={form[`${shift}_carte_reel`]} onChange={v => setField(`${shift}_carte_reel`, v)} />
              <NumberInput label="Système" value={form[`${shift}_carte_systeme`]} onChange={v => setField(`${shift}_carte_systeme`, v)} />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const lastUpdate = currentEntry?.updated_at ? format(new Date(currentEntry.updated_at), "dd/MM/yyyy 'à' HH:mm", { locale: fr }) : null;

  return (
    <div className="odoo-section" style={{ marginBottom: 12 }}>
      <div className="odoo-section-header" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong>Saisie manuelle journalière</strong>
        <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>
          temporaire — en attendant que le POS soit utilisé en routine
        </span>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
          Date
          <input
            type="date"
            value={selectedDate}
            min={dateFrom}
            max={dateTo}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{ border: '1px solid var(--theme-bg-separator)', borderRadius: 4, padding: '4px 8px', fontSize: '0.75rem' }}
          />
        </label>
        <button
          className="odoo-btn-primary"
          onClick={() => upsertMutation.mutate()}
          disabled={!dirty || upsertMutation.isPending}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Save size={13} />
          {upsertMutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>

      <div style={{ padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {renderShiftCard('matin')}
        {renderShiftCard('soir')}
      </div>

      {lastUpdate && !dirty && (
        <div style={{ padding: '6px 16px 10px', fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontStyle: 'italic' }}>
          Dernière mise à jour : {lastUpdate}
        </div>
      )}
    </div>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{label} (DH)</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
        style={{
          border: '1px solid var(--theme-bg-separator)',
          borderRadius: 4,
          padding: '6px 8px',
          fontSize: '0.8125rem',
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
        }}
      />
    </label>
  );
}

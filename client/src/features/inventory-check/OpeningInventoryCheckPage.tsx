import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardCheck, AlertTriangle, CheckCircle2, XCircle,
  Plus, Minus, Package, RefreshCw,
} from 'lucide-react';
import {
  openingInventoryCheckApi,
  type MissingReason,
  type OpeningCheckSubmitItem,
} from '../../api/opening-inventory-check.api';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { StatusBanner } from '../../components/ui/StatusBanner';
import SalesPageShell from '../sales/SalesPageShell';
import { PageLoading } from '../controle/KlUi';
import { DataPanel } from '../../components/ds';

/** En-tête commun (design Ventes) : barre Inventaire / Contrôle d'ouverture, puis grand titre. */
const SHELL = { icon: ClipboardCheck, parent: 'Inventaire', title: "Contrôle d'ouverture" } as const;

const REASON_LABELS: Record<MissingReason, string> = {
  theft: 'Vol',
  breakage: 'Casse',
  forgotten_recycle: 'Recyclage oublié',
  undeclared_loss: 'Perte non déclarée',
  measurement_error: 'Erreur de comptage',
  other: 'Autre',
};

interface Counts {
  [productId: string]: { found: number; reason?: MissingReason };
}

export default function OpeningInventoryCheckPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [counts, setCounts] = useState<Counts>({});
  const [notes, setNotes] = useState('');
  const [submitMsg, setSubmitMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['opening-check-pending'],
    queryFn: () => openingInventoryCheckApi.getPending(),
  });

  const submitMutation = useMutation({
    mutationFn: openingInventoryCheckApi.submit,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['opening-check-pending'] });
      if (created.status === 'validated') {
        setSubmitMsg({ type: 'success', text: 'Contrôle validé automatiquement. Caisse débloquée.' });
        setTimeout(() => navigate('/pos', { state: { autoOpenCash: true } }), 1500);
      } else {
        setSubmitMsg({
          type: 'success',
          text: 'Contrôle soumis — en attente de validation par un responsable.',
        });
      }
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Erreur lors de la soumission';
      setSubmitMsg({ type: 'error', text: message });
    },
  });

  const items = data?.items || [];
  const existingCheck = data?.existingCheck || null;

  const grouped = useMemo(() => {
    const m: Record<string, typeof items> = {};
    items.forEach((it) => {
      const cat = ((it as Record<string, any>).category_name as string) || 'Sans categorie';
      if (!m[cat]) m[cat] = [];
      m[cat].push(it);
    });
    return m;
  }, [items]);
  const categoryNames = Object.keys(grouped).sort();

  const totals = useMemo(() => {
    let totalExpected = 0;
    let totalFound = 0;
    let withDiscrepancy = 0;
    items.forEach((it) => {
      const found = counts[it.product_id]?.found ?? it.expected_qty;
      totalExpected += it.expected_qty;
      totalFound += found;
      if (found !== it.expected_qty) withDiscrepancy += 1;
    });
    return { totalExpected, totalFound, totalDiscrepancy: totalFound - totalExpected, withDiscrepancy };
  }, [items, counts]);

  const updateCount = (productId: string, found: number) => {
    setCounts((prev) => ({ ...prev, [productId]: { ...prev[productId], found } }));
  };

  const updateReason = (productId: string, reason: MissingReason) => {
    setCounts((prev) => ({ ...prev, [productId]: { ...prev[productId], reason } }));
  };

  const handleSubmit = () => {
    setSubmitMsg(null);
    const payload: OpeningCheckSubmitItem[] = items.map((it) => {
      const c = counts[it.product_id];
      const foundQty = c?.found ?? it.expected_qty;
      const isDiscrepancy = foundQty !== it.expected_qty;
      return {
        productId: it.product_id,
        expectedQty: it.expected_qty,
        foundQty,
        missingReason: isDiscrepancy ? c?.reason || 'other' : undefined,
      };
    });

    const missingReason = payload.find(
      (p) => p.foundQty !== p.expectedQty && !p.missingReason
    );
    if (missingReason) {
      setSubmitMsg({
        type: 'error',
        text: 'Choisir une raison pour chaque écart constaté.',
      });
      return;
    }

    submitMutation.mutate({
      previousCheckId: data?.previousCheckId || null,
      items: payload,
      notes: notes || undefined,
    });
  };

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return <SalesPageShell {...SHELL}><PageLoading /></SalesPageShell>;
  }

  // ─── Cas 1 : aucun controle requis ───────────────────────────────────────
  if (items.length === 0 && !existingCheck) {
    return (
      <SalesPageShell {...SHELL} actions={
        <button onClick={() => navigate('/pos', { state: { autoOpenCash: true } })} className="odoo-btn-primary">
          Aller à la caisse
        </button>
      }>
        <StatusBanner tone="success" icon={CheckCircle2} title="Aucun contrôle requis">
          Pas d'invendus réexposés à recontrôler. Vous pouvez ouvrir la caisse directement.
        </StatusBanner>
      </SalesPageShell>
    );
  }

  // ─── Cas 2 : check deja en cours ─────────────────────────────────────────
  if (existingCheck) {
    const tagTone: StatusTone =
      existingCheck.status === 'awaiting_validation' ? 'todo' :
      existingCheck.status === 'validated' ? 'done' :
      'blocked';
    const tagLabel =
      existingCheck.status === 'awaiting_validation' ? 'En attente de validation' :
      existingCheck.status === 'validated' ? 'Validé' : 'Rejeté';

    return (
      <SalesPageShell {...SHELL} actions={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <StatusTag tone={tagTone} label={tagLabel} />
          {existingCheck.status === 'validated' && (
            <button onClick={() => navigate('/pos', { state: { autoOpenCash: true } })}
              className="odoo-btn-primary">
              Aller à la caisse
            </button>
          )}
        </span>
      }>
        <div>
          <div className="odoo-section" style={{ margin: 0 }}>
            <div className="odoo-section-header">Statut du contrôle</div>
            <div style={{ padding: '1rem', fontSize: '14px', color: 'var(--ds-ink)' }}>
              {existingCheck.status === 'awaiting_validation' && (
                <p>Votre contrôle a été soumis. Un responsable doit valider les écarts avant l'ouverture de la caisse.</p>
              )}
              {existingCheck.status === 'validated' && (
                <p>Le contrôle a été validé. La caisse est ouverte.</p>
              )}
              {existingCheck.status === 'rejected' && existingCheck.rejection_reason && (
                <div>
                  <p style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--ds-danger)' }}>Motif du rejet :</p>
                  <p style={{ color: 'var(--ds-danger)' }}>{existingCheck.rejection_reason}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </SalesPageShell>
    );
  }

  const incCount = (pid: string, expected: number) => {
    const cur = counts[pid]?.found ?? expected;
    updateCount(pid, cur + 1);
  };
  const decCount = (pid: string, expected: number) => {
    const cur = counts[pid]?.found ?? expected;
    updateCount(pid, Math.max(0, cur - 1));
  };

  // ─── Cas 3 : formulaire de saisie ────────────────────────────────────────
  return (
    <SalesPageShell {...SHELL} summary="Vérifiez la présence physique des invendus réexposés depuis la veille avant d'ouvrir la caisse." actions={
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => refetch()} className="odoo-btn-secondary">
          <RefreshCw size={13} /> Recharger
        </button>
        <button onClick={handleSubmit} disabled={submitMutation.isPending}
          className="odoo-btn-primary">
          {submitMutation.isPending ? 'Soumission...' : 'Valider le contrôle'}
        </button>
      </span>
    }>
      {/* Messages */}
      {submitMsg && (
        <StatusBanner tone={submitMsg.type === 'error' ? 'danger' : 'success'} icon={submitMsg.type === 'error' ? XCircle : CheckCircle2}
          title={submitMsg.type === 'error' ? 'Action impossible' : 'Enregistré'}>{submitMsg.text}</StatusBanner>
      )}
      {totals.withDiscrepancy > 0 && (
        <StatusBanner tone="warning" icon={AlertTriangle} title={`${totals.withDiscrepancy} ligne(s) en écart`}>
          Le contrôle nécessitera la validation d'un responsable avant l'ouverture de la caisse.
        </StatusBanner>
      )}

      {/* Chiffres clés */}
      <div className="prj-kpis">
        <div className="prj-kpi">
          <div className="prj-kpi-head"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Package size={13} /> Attendu</span></div>
          <div className="prj-kpi-value">{totals.totalExpected}</div>
          <div className="prj-kpi-sub">unités à recontrôler</div>
        </div>
        <div className="prj-kpi">
          <div className="prj-kpi-head"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ClipboardCheck size={13} /> Compté</span></div>
          <div className="prj-kpi-value">{totals.totalFound}</div>
          <div className="prj-kpi-sub">unités physiques</div>
        </div>
        <div className="prj-kpi">
          <div className="prj-kpi-head"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={13} /> Écart</span></div>
          <div className="prj-kpi-value"
            style={{ color: totals.totalDiscrepancy === 0 ? 'var(--ds-success)' : totals.totalDiscrepancy < 0 ? 'var(--ds-danger)' : 'var(--ds-info)' }}>
            {totals.totalDiscrepancy > 0 ? '+' : ''}{totals.totalDiscrepancy}
          </div>
          <div className="prj-kpi-sub">{totals.totalDiscrepancy === 0 ? 'aucun' : 'unités'}</div>
        </div>
        <div className="prj-kpi">
          <div className="prj-kpi-head"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><XCircle size={13} /> Lignes en écart</span></div>
          <div className="prj-kpi-value"
            style={{ color: totals.withDiscrepancy === 0 ? 'var(--ds-success)' : 'var(--ds-danger)' }}>
            {totals.withDiscrepancy}
          </div>
          <div className="prj-kpi-sub">{totals.withDiscrepancy === 0 ? 'tout conforme' : 'à motiver'}</div>
        </div>
      </div>

      {/* Sections par categorie */}
      {categoryNames.map((catName) => {
        const catItems = grouped[catName];
        const catTotalExpected = catItems.reduce((s, it) => s + it.expected_qty, 0);
        return (
          <DataPanel key={catName} label={catName} bulk={
            <div className="prj-panel-head" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>{catName}</span>
                <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontSize: '12px', color: 'var(--ds-muted)' }}>
                  {catItems.length} article{catItems.length > 1 ? 's' : ''}
                </span>
              </div>
              <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: '12px', color: 'var(--ds-muted)' }}>
                {catTotalExpected} attendu{catTotalExpected > 1 ? 's' : ''}
              </span>
            </div>
          }>
            <table className="odoo-table">
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>Produit</th>
                  <th style={{ width: '12%', textAlign: 'center' }}>Attendu</th>
                  <th style={{ width: '20%', textAlign: 'center' }}>Compté</th>
                  <th style={{ width: '10%', textAlign: 'center' }}>Écart</th>
                  <th style={{ width: '18%', textAlign: 'center' }}>Raison (si écart)</th>
                </tr>
              </thead>
              <tbody>
                {catItems.map((it) => {
                  const pid = it.product_id;
                  const c = counts[pid];
                  const found = c?.found ?? it.expected_qty;
                  const discrepancy = found - it.expected_qty;
                  const hasDiscrepancy = discrepancy !== 0;
                  return (
                    <tr key={pid} className={hasDiscrepancy ? (discrepancy < 0 ? 'row-danger' : 'row-warning') : ''}
                      style={{ cursor: 'default' }}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span className={`odoo-status-dot ${hasDiscrepancy ? (discrepancy < 0 ? 'danger' : 'warning') : 'ok'}`} />
                          <span style={{ fontWeight: 500, color: 'var(--ds-ink)' }}>{it.product_name}</span>
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                        {it.expected_qty}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <button onClick={() => decCount(pid, it.expected_qty)}
                            className="odoo-pager-btn" title="Diminuer" aria-label="Diminuer">
                            <Minus size={12} />
                          </button>
                          <input type="number" min={0}
                            value={found}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === '') {
                                setCounts((prev) => {
                                  const n = { ...prev };
                                  delete n[pid];
                                  return n;
                                });
                              } else {
                                updateCount(pid, Math.max(0, parseInt(v) || 0));
                              }
                            }}
                            style={{
                              width: '52px', height: '26px', textAlign: 'center',
                              fontSize: '13px', fontWeight: 500,
                              fontVariantNumeric: 'tabular-nums',
                              border: '1px solid var(--ds-line)',
                              borderRadius: '3px', backgroundColor: 'var(--ds-card)',
                              color: 'var(--ds-ink)', outline: 'none',
                            }} />
                          <button onClick={() => incCount(pid, it.expected_qty)}
                            className="odoo-pager-btn" title="Augmenter" aria-label="Augmenter">
                            <Plus size={12} />
                          </button>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 600,
                        color: hasDiscrepancy ? (discrepancy < 0 ? 'var(--ds-danger)' : 'var(--ds-info)') : 'var(--ds-muted)',
                      }}>
                        {hasDiscrepancy ? (discrepancy > 0 ? `+${discrepancy}` : discrepancy) : '0'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {hasDiscrepancy ? (
                          <select value={c?.reason || ''}
                            onChange={(e) => updateReason(pid, e.target.value as MissingReason)}
                            style={{
                              fontSize: '12px', padding: '0.125rem 0.375rem',
                              border: c?.reason ? '1px solid var(--ds-line)' : '1px solid var(--ds-danger)',
                              borderRadius: '6px',
                              backgroundColor: c?.reason ? 'var(--ds-card)' : 'color-mix(in srgb, var(--ds-danger) 8%, transparent)',
                              color: c?.reason ? 'var(--ds-ink)' : 'var(--ds-danger)',
                              fontWeight: c?.reason ? 400 : 500, outline: 'none',
                            }}>
                            <option value="">Motif obligatoire</option>
                            {(Object.keys(REASON_LABELS) as MissingReason[]).map((r) => (
                              <option key={r} value={r}>{REASON_LABELS[r]}</option>
                            ))}
                          </select>
                        ) : (
                          <StatusTag tone="done" label="Conforme" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataPanel>
        );
      })}

      {/* Notes */}
      <div className="odoo-section" style={{ margin: 0 }}>
        <div className="odoo-section-header">Notes (optionnel)</div>
        <div style={{ padding: '0.75rem 1rem' }}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder="Observations particulières..."
            style={{
              width: '100%', padding: '0.5rem', fontSize: '14px',
              border: '1px solid var(--ds-line)', borderRadius: '3px',
              backgroundColor: 'var(--ds-card)', color: 'var(--ds-ink)',
              outline: 'none', resize: 'vertical', fontFamily: 'inherit',
            }} />
        </div>
      </div>
    </SalesPageShell>
  );
}

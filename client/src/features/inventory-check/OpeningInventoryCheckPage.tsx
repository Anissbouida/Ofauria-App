import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardCheck, AlertTriangle, CheckCircle2, XCircle, Clock,
  Plus, Minus, Package, RefreshCw,
} from 'lucide-react';
import {
  openingInventoryCheckApi,
  type MissingReason,
  type OpeningCheckSubmitItem,
} from '../../api/opening-inventory-check.api';

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
    return (
      <div className="odoo-scope" style={{ minHeight: '100%' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <ClipboardCheck size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>Inventaire</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span className="odoo-breadcrumb-current">Contrôle d'ouverture</span>
          </div>
        </div>
        <div style={{ padding: '2rem', color: 'var(--odoo-text-muted)', fontSize: '0.875rem' }}>Chargement...</div>
      </div>
    );
  }

  // ─── Cas 1 : aucun controle requis ───────────────────────────────────────
  if (items.length === 0 && !existingCheck) {
    return (
      <div className="odoo-scope" style={{ minHeight: '100%' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <ClipboardCheck size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>Inventaire</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span className="odoo-breadcrumb-current">Contrôle d'ouverture</span>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={() => navigate('/pos', { state: { autoOpenCash: true } })}
            className="odoo-btn-primary">
            Aller à la caisse
          </button>
        </div>
        <div className="odoo-alert" style={{ backgroundColor: '#e9f7ef', color: '#1e6e3a', borderBottomColor: '#c3e6cb' }}>
          <CheckCircle2 size={18} className="flex-shrink-0" />
          <div>
            <div className="odoo-alert-title">Aucun contrôle requis</div>
            <div>Pas d'invendus réexposés à recontrôler. Vous pouvez ouvrir la caisse directement.</div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Cas 2 : check deja en cours ─────────────────────────────────────────
  if (existingCheck) {
    const tagClass =
      existingCheck.status === 'awaiting_validation' ? 'odoo-tag odoo-tag-yellow' :
      existingCheck.status === 'validated' ? 'odoo-tag odoo-tag-green' :
      'odoo-tag odoo-tag-red';
    const tagIcon =
      existingCheck.status === 'awaiting_validation' ? <Clock size={11} /> :
      existingCheck.status === 'validated' ? <CheckCircle2 size={11} /> :
      <XCircle size={11} />;
    const tagLabel =
      existingCheck.status === 'awaiting_validation' ? 'En attente de validation' :
      existingCheck.status === 'validated' ? 'Validé' : 'Rejeté';

    return (
      <div className="odoo-scope" style={{ minHeight: '100%' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <ClipboardCheck size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>Inventaire</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span className="odoo-breadcrumb-current">Contrôle d'ouverture</span>
          </div>
          <div style={{ flex: 1 }} />
          <span className={tagClass}>{tagIcon} {tagLabel}</span>
          {existingCheck.status === 'validated' && (
            <button onClick={() => navigate('/pos', { state: { autoOpenCash: true } })}
              className="odoo-btn-primary">
              Aller à la caisse
            </button>
          )}
        </div>

        <div style={{ padding: '1rem' }}>
          <div className="odoo-section">
            <div className="odoo-section-header">Statut du contrôle</div>
            <div style={{ padding: '1rem', fontSize: '0.875rem', color: 'var(--odoo-text)' }}>
              {existingCheck.status === 'awaiting_validation' && (
                <p>Votre contrôle a été soumis. Un responsable doit valider les écarts avant l'ouverture de la caisse.</p>
              )}
              {existingCheck.status === 'validated' && (
                <p>Le contrôle a été validé. La caisse est ouverte.</p>
              )}
              {existingCheck.status === 'rejected' && existingCheck.rejection_reason && (
                <div>
                  <p style={{ fontWeight: 600, marginBottom: '0.5rem', color: '#721c24' }}>Motif du rejet :</p>
                  <p style={{ color: '#721c24' }}>{existingCheck.rejection_reason}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
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
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      {/* Control bar */}
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          <ClipboardCheck size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Inventaire</span>
          <span className="odoo-breadcrumb-separator">/</span>
          <span className="odoo-breadcrumb-current">Contrôle d'ouverture</span>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => refetch()} className="odoo-btn-secondary">
          <RefreshCw size={13} /> Recharger
        </button>
        <button onClick={handleSubmit} disabled={submitMutation.isPending}
          className="odoo-btn-primary">
          {submitMutation.isPending ? 'Soumission...' : 'Valider le contrôle'}
        </button>
      </div>

      {/* Alerts */}
      {submitMsg && (
        <div className={`odoo-alert ${submitMsg.type === 'error' ? 'danger' : ''}`}
          style={submitMsg.type === 'success' ? { backgroundColor: '#e9f7ef', color: '#1e6e3a', borderBottomColor: '#c3e6cb' } : undefined}>
          {submitMsg.type === 'error' ? <XCircle size={16} className="flex-shrink-0" /> : <CheckCircle2 size={16} className="flex-shrink-0" />}
          <div>{submitMsg.text}</div>
        </div>
      )}
      {totals.withDiscrepancy > 0 && (
        <div className="odoo-alert warning">
          <AlertTriangle size={16} className="flex-shrink-0" />
          <div>
            <span className="odoo-alert-title">{totals.withDiscrepancy} ligne(s) en écart.</span>{' '}
            Le contrôle nécessitera la validation d'un responsable avant l'ouverture de la caisse.
          </div>
        </div>
      )}

      {/* Stat grid */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">
            <Package size={11} style={{ display: 'inline', marginRight: 4 }} />Attendu
          </div>
          <div className="odoo-stat-card-value">{totals.totalExpected}</div>
          <div className="odoo-stat-card-sub">unités à recontrôler</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">
            <ClipboardCheck size={11} style={{ display: 'inline', marginRight: 4 }} />Compté
          </div>
          <div className="odoo-stat-card-value">{totals.totalFound}</div>
          <div className="odoo-stat-card-sub">unités physiques</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">
            <AlertTriangle size={11} style={{ display: 'inline', marginRight: 4 }} />Écart
          </div>
          <div className="odoo-stat-card-value"
            style={{ color: totals.totalDiscrepancy === 0 ? '#28a745' : totals.totalDiscrepancy < 0 ? '#dc3545' : '#1f6391' }}>
            {totals.totalDiscrepancy > 0 ? '+' : ''}{totals.totalDiscrepancy}
          </div>
          <div className="odoo-stat-card-sub">{totals.totalDiscrepancy === 0 ? 'aucun' : 'unités'}</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">
            <XCircle size={11} style={{ display: 'inline', marginRight: 4 }} />Lignes en écart
          </div>
          <div className="odoo-stat-card-value"
            style={{ color: totals.withDiscrepancy === 0 ? '#28a745' : '#dc3545' }}>
            {totals.withDiscrepancy}
          </div>
          <div className="odoo-stat-card-sub">{totals.withDiscrepancy === 0 ? 'tout conforme' : 'à motiver'}</div>
        </div>
      </div>

      {/* Description */}
      <div style={{ padding: '0.75rem 1rem 0', fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
        Vérifiez la présence physique des invendus réexposés depuis la veille avant d'ouvrir la caisse.
      </div>

      {/* Sections par categorie */}
      {categoryNames.map((catName) => {
        const catItems = grouped[catName];
        const catTotalExpected = catItems.reduce((s, it) => s + it.expected_qty, 0);
        return (
          <div key={catName} className="odoo-section">
            <div className="odoo-section-header" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>{catName}</span>
                <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontSize: '0.75rem', color: 'var(--odoo-text-light)' }}>
                  {catItems.length} article{catItems.length > 1 ? 's' : ''}
                </span>
              </div>
              <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>
                {catTotalExpected} attendu{catTotalExpected > 1 ? 's' : ''}
              </span>
            </div>

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
                          <span style={{ fontWeight: 500, color: 'var(--odoo-text)' }}>{it.product_name}</span>
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                        {it.expected_qty}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <button onClick={() => decCount(pid, it.expected_qty)}
                            className="odoo-pager-btn" title="Diminuer">
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
                              fontSize: '0.8125rem', fontWeight: 500,
                              fontVariantNumeric: 'tabular-nums',
                              border: '1px solid var(--odoo-border-strong)',
                              borderRadius: '3px', backgroundColor: 'var(--odoo-bg)',
                              color: 'var(--odoo-text)', outline: 'none',
                            }} />
                          <button onClick={() => incCount(pid, it.expected_qty)}
                            className="odoo-pager-btn" title="Augmenter">
                            <Plus size={12} />
                          </button>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 600,
                        color: hasDiscrepancy ? (discrepancy < 0 ? '#dc3545' : '#1f6391') : 'var(--odoo-text-light)',
                      }}>
                        {hasDiscrepancy ? (discrepancy > 0 ? `+${discrepancy}` : discrepancy) : '0'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {hasDiscrepancy ? (
                          <select value={c?.reason || ''}
                            onChange={(e) => updateReason(pid, e.target.value as MissingReason)}
                            style={{
                              fontSize: '0.75rem', padding: '0.125rem 0.375rem',
                              border: c?.reason ? '1px solid var(--odoo-border-strong)' : '1px solid #dc3545',
                              borderRadius: '3px',
                              backgroundColor: c?.reason ? 'var(--odoo-bg)' : '#fdf0ed',
                              color: c?.reason ? 'var(--odoo-text)' : '#721c24',
                              fontWeight: c?.reason ? 400 : 500, outline: 'none',
                            }}>
                            <option value="">Motif obligatoire</option>
                            {(Object.keys(REASON_LABELS) as MissingReason[]).map((r) => (
                              <option key={r} value={r}>{REASON_LABELS[r]}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="odoo-tag odoo-tag-green">
                            <CheckCircle2 size={11} /> Conforme
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {/* Notes */}
      <div className="odoo-section">
        <div className="odoo-section-header">Notes (optionnel)</div>
        <div style={{ padding: '0.75rem 1rem' }}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder="Observations particulières..."
            style={{
              width: '100%', padding: '0.5rem', fontSize: '0.875rem',
              border: '1px solid var(--odoo-border-strong)', borderRadius: '3px',
              backgroundColor: 'var(--odoo-bg)', color: 'var(--odoo-text)',
              outline: 'none', resize: 'vertical', fontFamily: 'inherit',
            }} />
        </div>
      </div>
    </div>
  );
}

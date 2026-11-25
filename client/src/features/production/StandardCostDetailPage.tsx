/**
 * Coût standard d'un article (mig 661, 2026-11-24) — page pleine, ouverte depuis Production ›
 * Coûts standard ou depuis le cadre « Coût de l'article » de la fiche technique.
 *
 * Lecture : du coût matière au coût de revient, poste par poste (ce que contient chaque poste et
 * comment il est calculé), par pièce ou par fournée ; détail des matières ; prix conseillé en
 * simulation. Validation (gérant) : le calcul du jour devient le coût de référence de l'article.
 */
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Calculator, CheckCircle2, RefreshCw } from 'lucide-react';
import { Alert, Breadcrumb, DataPanel, EmptyState, ErrorState, KpiCard, KpiGrid, LoadingState, PageHeader, SectionHeader, Segmented } from '../../components/ds';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { apiErrorMessage } from '../../api/errors';
import { currencySymbol, money } from '../../utils/money';
import { useActionPermissions } from '../../hooks/useActionPermissions';
import { usePermissions } from '../../context/PermissionsContext';
import { useProdTerms } from '../../hooks/useProdTerms';
import { analyticCostApi, type StandardCostDetail } from '../../api/analytic-cost.api';
import { LOW_MARK, SITUATION } from './StandardCostsPage';
import '../production/production.css';
import '../projects/projects.css';
import '../sales/sales.css';

type Line = StandardCostDetail['lines'][number];

const fmt = (v: number, d = 4) => v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const rate = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 4 });
const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, (mo || 1) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};

/** Ce que contient chaque niveau de centre, dit en mots du métier. */
const LEVEL_CONTENT: Record<string, string> = {
  approvisionnement: 'réception, stockage et achats des matières',
  production: 'charges de l\'atelier : énergie, locaux, encadrement, amortissements',
  administration: 'direction, comptabilité, informatique',
  distribution: 'boutique, vente et commercial',
};

/** Calcul d'un poste de charges indirectes : unités d'œuvre × coût de l'unité d'œuvre. */
function lineCalc(l: Line, unit: string): string {
  if (l.driverLabel === 'Valeur de vente HT') return `prix HT × ${rate(l.rate * 100)} %`;
  if (l.driverLabel === 'Valeur des matières') return `matières × ${rate(l.rate * 100)} %`;
  if (l.driverLabel === 'Quantité produite') return `1 ${unit} × ${rate(l.rate)} ${currencySymbol()}`;
  return `${rate(l.quantity)} × ${rate(l.rate)} ${currencySymbol()} (${l.driverLabel.toLowerCase()})`;
}

/** Quantité lisible : 0,0148 kg → 14,8 g ; 0,0087 l → 8,7 ml. */
function qtyTxt(q: number, unit: string): string {
  const u = unit.toLowerCase();
  if (u === 'kg' && q < 1) return `${q * 1000 < 10 ? fmt(q * 1000, 2) : fmt(q * 1000, 1)} g`;
  if (u === 'l' && q < 1) return `${q * 1000 < 10 ? fmt(q * 1000, 2) : fmt(q * 1000, 1)} ml`;
  if (u === 'unit' || u === 'u') return `${fmt(q, q < 1 ? 2 : 0)} u`;
  return `${fmt(q, 3)} ${unit}`;
}

export default function StandardCostDetailPage() {
  const { recipeId } = useParams<{ recipeId: string }>();
  const [params, setParams] = useSearchParams();
  const formatId = params.get('format');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { sectorLabel } = usePermissions();
  const bLc = useProdTerms().batchLc;
  const { can, isLoading: permLoading } = useActionPermissions();
  // Coûts et marges : gérant (comptabilité analytique), qui valide aussi le coût de référence.
  const allowed = can('production.production_cout.analytique');
  const canValidate = allowed;
  const [mode, setMode] = useState<'piece' | 'lot'>('piece');
  const [marque, setMarque] = useState('30');

  const { data: s, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['standard-cost', recipeId, formatId],
    queryFn: () => analyticCostApi.standardCostDetail(recipeId!, formatId, 30),
    enabled: !!recipeId && allowed,
  });

  const validate = useMutation({
    mutationFn: () => analyticCostApi.validateStandardCost(recipeId!, { formatId: s?.formatId ?? null }),
    onSuccess: () => {
      notify.success('Coût standard validé : il devient le coût de référence de l\'article');
      qc.invalidateQueries({ queryKey: ['standard-cost', recipeId] });
      qc.invalidateQueries({ queryKey: ['standard-costs'] });
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const back = () => navigate('/production/couts-standard');
  const bar = (current?: string, actions?: ReactNode) => (
    <div className="odoo-control-bar">
      <button type="button" onClick={back} className="ds-icon-btn" title="Retour aux coûts standard" aria-label="Retour aux coûts standard">
        <ArrowLeft size={16} aria-hidden="true" />
      </button>
      <Breadcrumb icon={Calculator} items={[
        { label: sectorLabel('production', 'Production') },
        { label: 'Coûts standard', onClick: back },
        ...(current ? [{ label: current }] : []),
      ]} />
      <div style={{ flex: 1 }} />
      {actions}
    </div>
  );

  if (permLoading || (isLoading && allowed)) {
    return <div className="odoo-scope pd">{bar()}<div className="pd-page"><LoadingState label="Calcul du coût standard…" /></div></div>;
  }
  if (!allowed) {
    return (
      <div className="odoo-scope pd">{bar()}<div className="pd-page">
        <EmptyState icon={Calculator} title="Accès réservé" text="Les coûts et les marges des articles sont réservés au gérant (droit « comptabilité analytique »)." />
      </div></div>
    );
  }
  if (error || !s) {
    return <div className="odoo-scope pd">{bar()}<div className="pd-page"><ErrorState error={error} title="Le coût n'a pas pu être calculé" onRetry={() => refetch()} /></div></div>;
  }

  const pieces = s.pieces && s.pieces > 0 ? s.pieces : 1;
  const lot = mode === 'lot' && pieces > 1;
  const f = lot ? pieces : 1;
  const dec = lot ? 2 : 4;
  const amt = (v: number) => fmt(v * f, dec);
  const sym = currencySymbol();
  const unit = 'pièce';
  const name = s.productName ?? s.recipeName ?? 'Article';
  const formatLabel = s.formats.find(x => x.id === s.formatId)?.label ?? name;
  const before = s.lines.filter(l => l.level === 'approvisionnement' || l.level === 'production');
  const after = s.lines.filter(l => l.level === 'administration' || l.level === 'distribution');
  const sit = SITUATION[s.situation];
  const m = Number(marque);
  const mOk = m > 0 && m < 95;
  const d = 1 - m / 100 - s.structureSalesRate;
  const conseille = mOk && d > 0 ? (s.coutProduction + s.structureFixed) / d : null;
  const lowMark = s.tauxMarque != null && s.tauxMarque < LOW_MARK;
  const motif: Record<string, string> = { sans_prix: 'sans prix', conversion: 'conversion d\'unité douteuse', preparation_vide: 'préparation sans composant' };

  const askValidate = async () => {
    const ok = await confirm(
      `Le calcul du jour (coût de production ${money(s.coutProduction, { decimals: 4 })} par pièce) devient le coût de référence du ${name}.${s.validated ? ' Le coût validé actuel passe dans l\'historique.' : ''}`,
      { title: 'Valider le coût standard', confirmLabel: 'Valider' });
    if (ok) validate.mutate();
  };

  const row = (label: string, content: string, calc: ReactNode, value: string, opts: { warn?: boolean; muted?: boolean } = {}) => (
    <tr style={opts.muted ? { color: 'var(--ds-muted)' } : undefined}>
      <td className="ds-strong" style={opts.warn ? { color: 'var(--ds-warning)' } : undefined}>{label}</td>
      <td>{content}</td>
      <td style={opts.warn ? { color: 'var(--ds-warning)', fontWeight: 600 } : undefined}>{calc}</td>
      <td className="ds-num">{value}</td>
    </tr>
  );

  return (
    <div className="odoo-scope pd">
      {bar(formatLabel, <>
        <button type="button" className="odoo-btn-secondary" onClick={() => refetch()} disabled={isFetching}
          title="Recalcule avec les prix et les charges du jour.">
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} aria-hidden="true" /> Recalculer
        </button>
        {canValidate && (
          <button type="button" className="odoo-btn-primary" onClick={askValidate} disabled={validate.isPending || s.situation === 'validated'}
            title={s.situation === 'validated' ? 'Le coût validé est déjà à jour' : 'Le calcul du jour devient le coût de référence de l\'article'}>
            <CheckCircle2 size={14} aria-hidden="true" /> {validate.isPending ? 'Validation…' : 'Valider comme coût standard'}
          </button>
        )}
      </>)}

      <div className="pd-page">
        <PageHeader title={`Coût standard — ${name}`}
          aside={<StatusTag tone={sit.tone} label={sit.label} title={s.reason ?? undefined} />}
          description={<>
            Calculé à partir de la fiche technique{s.recipeVersion ? ` (version ${s.recipeVersion})` : ''}, des prix des lots en cours
            et des charges des centres de {monthLabel(s.month)}.
          </>} />

        <div className="prj-chips" aria-label="Circuit du coût standard">
          {(['calculated', 'validated', 'stale'] as const).map(k => (
            <span key={k} className={`prj-chip${s.situation === k ? ' active' : ''}`} aria-current={s.situation === k ? 'step' : undefined}>
              {k === 'calculated' ? 'Calculé' : k === 'validated' ? 'Validé' : 'À recalculer'}
            </span>
          ))}
        </div>

        {s.situation === 'stale' && (
          <Alert tone="warning" icon={AlertTriangle}>
            {s.reason} Écart avec le coût validé : {s.ecartPct != null ? `${s.ecartPct > 0 ? '+' : ''}${s.ecartPct.toLocaleString('fr-FR')} %` : '—'}.
            {canValidate ? ' Validez le calcul du jour pour mettre à jour le coût de référence.' : ''}
          </Alert>
        )}
        {s.labourMinutes == null && (
          <Alert tone="warning" icon={AlertTriangle} action={<Link to="/production/work-centers">Définir la gamme</Link>}>
            Coût sous-estimé : cet article n'a pas de gamme, la main-d'œuvre directe n'est pas comptée.
          </Alert>
        )}
        {s.costGaps.length > 0 && (
          <Alert tone="warning" icon={AlertTriangle} action={<Link to={`/recipes/${recipeId}/nomenclature`}>Ouvrir la fiche</Link>}>
            Coût incomplet : {s.costGaps.map(g => `${g.composant} (${motif[g.motif] ?? g.motif}${g.via ? `, via ${g.via}` : ''})`).join(' ; ')}.
          </Alert>
        )}

        <KpiGrid label="Coût standard">
          <KpiCard label={`Coût de production ${lot ? `par ${bLc}` : 'par pièce'}`} value={money(s.coutProduction * f)} sub="valeur du stock de produits finis" />
          <KpiCard label={`Coût de revient complet ${lot ? `par ${bLc}` : 'par pièce'}`} value={money(s.coutRevient * f)} sub="avec administration et commercial" />
          <KpiCard label={`Prix de vente HT ${lot ? `par ${bLc}` : 'par pièce'}`} value={s.priceHt != null ? money(s.priceHt * f) : '—'} sub="prix catalogue, fixé dans Produits" />
          <KpiCard label="Taux de marque" value={s.tauxMarque != null ? `${s.tauxMarque.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : '—'}
            sub="(prix − coût de revient) ÷ prix" tone={lowMark ? 'orange' : undefined} />
        </KpiGrid>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: '999 1 640px', minWidth: 0, display: 'grid', gap: 16 }}>
            <SectionHeader title="Du coût matière au coût de revient" note="méthode des coûts complets">
              {s.formats.length > 1 && (
                <select className="ds-input sm" style={{ width: 'auto' }} aria-label="Format" value={s.formatId ?? ''}
                  onChange={e => setParams(p => { const n = new URLSearchParams(p); n.set('format', e.target.value); return n; }, { replace: true })}>
                  {s.formats.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              )}
              {pieces > 1 && (
                <Segmented label="Afficher les montants" value={mode} onChange={setMode}
                  options={[{ key: 'piece', label: 'Par pièce' }, { key: 'lot', label: `Par ${bLc} (${pieces} pièces)` }]} />
              )}
            </SectionHeader>
            <DataPanel label="Décomposition du coût">
              <table className="odoo-table">
                <thead>
                  <tr>
                    <th>Poste</th><th>Ce qu'il contient</th><th>Calcul</th>
                    <th className="ds-num">{`Montant par ${lot ? bLc : 'pièce'} (${sym})`}</th>
                  </tr>
                </thead>
                <tbody>
                  {row('Matières', 'ingrédients de la fiche, au prix du lot en cours', 'détail ci-dessous', amt(s.matiere))}
                  {s.emballage > 0 && row('Emballage', 'emballages de la fiche', 'quantité × prix', amt(s.emballage))}
                  {s.labourMinutes == null
                    ? row('Main-d\'œuvre directe', `temps de la gamme × coût horaire chargé (${money(s.directRate)}/h)`, 'aucune gamme : non comptée', '—', { warn: true, muted: true })
                    : row('Main-d\'œuvre directe', 'temps de la gamme × coût horaire chargé',
                      `${rate(s.labourMinutes * f)} min × ${money(s.directRate)}/h`, amt(s.mainOeuvre))}
                  {before.map(l => <tr key={l.code}>
                    <td className="ds-strong">{l.name}</td><td>{LEVEL_CONTENT[l.level] ?? ''}</td>
                    <td>{lot && l.driverLabel === 'Quantité produite' ? `${pieces} pièces × ${rate(l.rate)} ${sym}` : lineCalc(l, unit)}</td>
                    <td className="ds-num">{amt(l.amount)}</td>
                  </tr>)}
                  <tr className="ds-group"><td>Coût de production</td><td style={{ fontWeight: 400 }}>ce qui valorise le stock de produits finis</td><td /><td className="ds-num">{amt(s.coutProduction)}</td></tr>
                  {after.map(l => <tr key={l.code}>
                    <td className="ds-strong">{l.name}</td><td>{LEVEL_CONTENT[l.level] ?? ''}</td>
                    <td>{lineCalc(l, unit)}</td><td className="ds-num">{amt(l.amount)}</td>
                  </tr>)}
                  <tr className="ds-group"><td>Coût de revient complet</td><td style={{ fontWeight: 400 }}>tout ce que coûte l'article jusqu'à sa vente</td><td /><td className="ds-num">{amt(s.coutRevient)}</td></tr>
                </tbody>
                {s.marge != null && s.priceHt != null && (
                  <tfoot>
                    <tr>
                      <td>Marge</td>
                      <td style={{ fontWeight: 400, color: 'var(--ds-muted)' }}>prix de vente HT {fmt(s.priceHt * f, 2)} − coût de revient</td>
                      <td />
                      <td className="ds-num" style={{ color: s.marge >= 0 ? 'var(--ds-success)' : 'var(--ds-danger)' }}>{amt(s.marge)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </DataPanel>

            <SectionHeader title="Détail des matières" note="quantités lues dans la fiche technique, prix du lot en cours de chaque ingrédient" />
            {s.materials.length === 0 ? (
              <EmptyState icon={Calculator} title="Détail indisponible" text={s.materialsNote ?? 'Aucun ingrédient dans la nomenclature dépliée.'} />
            ) : (
              <DataPanel label="Détail des matières">
                <table className="odoo-table ds-dense">
                  <thead>
                    <tr>
                      <th>Ingrédient</th>
                      <th className="ds-num">{lot ? `Quantité par ${bLc}` : 'Quantité par pièce'}</th>
                      <th className="ds-num">Prix unitaire retenu</th>
                      <th className="ds-num">{`Montant par ${lot ? bLc : 'pièce'} (${sym})`}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.materials.map(x => (
                      <tr key={x.ingredientId}>
                        <td className="ds-strong">{x.name}</td>
                        <td className="ds-num">{qtyTxt(x.qty * f, x.unit)}</td>
                        <td className="ds-num">{x.unitPrice != null ? `${money(x.unitPrice)}/${x.unit === 'unit' ? 'u' : x.unit}` : '—'}</td>
                        <td className="ds-num">{amt(x.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td>Total matières</td><td /><td /><td className="ds-num">{amt(s.matiere)}</td></tr></tfoot>
                </table>
              </DataPanel>
            )}
          </div>

          <div style={{ flex: '1 1 320px', minWidth: 0, display: 'grid', gap: 16 }}>
            <section className="ds-panel" style={{ padding: '14px 20px', display: 'grid', gap: 10 }}>
              <SectionHeader title="Sources du calcul" />
              <dl className="pd-cost-dl">
                <dt>Fiche technique</dt>
                <dd><Link to={`/recipes/${recipeId}/nomenclature`}>{s.recipeName ?? name}{s.recipeVersion ? `, version ${s.recipeVersion}` : ''}</Link></dd>
                <dt>Format</dt><dd>{s.pieces ? `${s.pieces} pièce${s.pieces > 1 ? 's' : ''} par ${bLc}` : '—'}</dd>
                <dt>Prix des matières</dt><dd>lot en cours de chaque ingrédient (premier périmé, premier sorti)</dd>
                <dt>Charges</dt><dd>centres d'analyse de {monthLabel(s.month)}, à la capacité normale</dd>
              </dl>
            </section>

            <section className="ds-panel" style={{ padding: '14px 20px', display: 'grid', gap: 10 }}>
              <SectionHeader title="Prix conseillé" note="simulation, ne change pas le prix" />
              <label htmlFor="cible-marque" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                Taux de marque visé
                <input id="cible-marque" type="number" min="1" max="90" className="ds-input sm" style={{ width: 80, textAlign: 'right' }}
                  value={marque} onChange={e => setMarque(e.target.value)} /> %
              </label>
              <div className="pd-cost-result">
                <span>Prix de vente HT conseillé, par pièce</span>
                <strong>{conseille != null ? money(conseille) : '—'}</strong>
              </div>
              <span style={{ fontSize: 12, color: 'var(--ds-muted)' }}>
                Prix = (coût de production {fmt(s.coutProduction)}{s.structureFixed > 0 ? ` + structure fixe ${fmt(s.structureFixed)}` : ''}) ÷ (1 − {mOk ? m.toLocaleString('fr-FR') : '…'} % − {rate(s.structureSalesRate * 100)} % de structure liée au prix).
                Le prix de vente se change dans Produits.
              </span>
            </section>

            <section className="ds-panel" style={{ padding: '14px 20px', display: 'grid', gap: 10 }}>
              <SectionHeader title="Coût de référence" note={s.history.length ? `${s.history.length} validation(s)` : undefined} />
              {s.validated ? (
                <span style={{ fontSize: 14 }}>
                  Validé le {date(s.validated.validatedAt)}{s.validated.validatedBy ? ` par ${s.validated.validatedBy}` : ''} :
                  coût de production <strong>{money(s.validated.coutProduction, { decimals: 4 })}</strong>,
                  coût de revient <strong>{money(s.validated.coutRevient, { decimals: 4 })}</strong> par pièce.
                </span>
              ) : (
                <span style={{ fontSize: 14 }}>Aucun coût standard validé pour cet article.</span>
              )}
              <span style={{ fontSize: 13, color: 'var(--ds-muted)' }}>
                Le coût validé sert de référence : quand la fiche ou les prix changent, l'écart avec le calcul du jour le signale « à recalculer ».
                Un nouveau calcul validé remplace l'ancien, qui reste dans l'historique.
              </span>
              {s.history.length > 0 && (
                <table className="odoo-table ds-dense">
                  <thead><tr><th>Validé le</th><th className="ds-num">{`Coût de production (${sym})`}</th><th>Statut</th></tr></thead>
                  <tbody>
                    {s.history.map(h => (
                      <tr key={h.id}>
                        <td>{date(h.validatedAt)}</td>
                        <td className="ds-num">{fmt(h.coutProduction)}</td>
                        <td><StatusTag tone={h.status === 'validated' ? 'done' : 'cancelled'} label={h.status === 'validated' ? 'En vigueur' : 'Remplacé'} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

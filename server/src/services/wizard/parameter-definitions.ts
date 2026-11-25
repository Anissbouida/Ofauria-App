import { parameterByKey } from '../parameters-catalog.js';

/** Catalogue de sélection : les définitions, types, valeurs et validations restent
 * ceux du centre de paramètres. Les règles fiscales et bascules de moteur sont exclues. */
const selection = [
  ['operations','production','production.demand_source'],
  ['operations','production','production.mrp_horizon'],
  ['operations','production','production.yield_target'],
  ['operations','production','production.cost_allocation_key'],
  ['operations','stock','stock.negative_policy'],
  ['operations','stock','stock.dlc_alerts'],
  ['operations','stock','stock.low_stock_alerts'],
  ['operations','pos','sales.pos_stock'],
  ['operations','sales','sales.quotes'],
  ['rules','production','production.flow'],
  ['rules','production','production.enforce_declared_steps'],
  ['rules','production','quality.auto_release'],
  ['rules','production','quality.ccp_rule'],
  ['rules','purchasing','purchasing.lot_dlc_enforcement'],
  ['rules','purchasing','purchasing.po_requires_request'],
  ['rules','pos','sales.closure'],
  ['rules','sales','sales.pricing'],
] as const;

export const WIZARD_PARAMETERS = selection.map(([step,module,key])=>{
  const def=parameterByKey(key);
  if(!def||def.storage.kind==='company_settings'||(def.storage.kind==='policy'&&!def.scopes?.includes('company')))throw new Error(`Paramètre assistant non admissible : ${key}`);
  return {step,module,def};
});
export const wizardParameterField = (step:string,key:string) => WIZARD_PARAMETERS.flatMap(p=>p.step===step?p.def.fields.map(field=>({...p,field,id:`${p.def.key}:${field.name}`})):[]).find(p=>p.id===key);
export const WIZARD_MODULE_PARAMETER_KEYS = WIZARD_PARAMETERS.filter(p=>p.def.storage.kind==='module_parameters').map(p=>p.def.key);

import { parameterByKey } from '../parameters-catalog.js';

/** Catalogue de sélection : les définitions, types, valeurs et validations restent
 * ceux du centre de paramètres. Les règles fiscales et bascules de moteur sont exclues. */
const selection = [
  ['operations','production','production.demand_source'],
  ['operations','production','production.rhythm'],
  ['operations','production','production.mrp_horizon'],
  ['operations','production','production.yield_target'],
  ['operations','production','production.cost_allocation_key'],
  ['operations','stock','stock.organization'],
  ['operations','stock','stock.negative_policy'],
  ['operations','stock','stock.dlc_alerts'],
  ['operations','stock','stock.low_stock_alerts'],
  ['operations','pos','sales.pos_stock'],
  ['operations','sales','sales.channel'],
  ['operations','sales','sales.quotes'],
  ['rules','production','production.flow'],
  ['rules','production','production.enforce_declared_steps'],
  ['rules','production','quality.auto_release'],
  ['rules','production','quality.ccp_rule'],
  ['rules','purchasing','purchasing.lot_dlc_enforcement'],
  ['rules','purchasing','purchasing.po_requires_request'],
  ['rules','pos','sales.closure'],
  ['rules','sales','sales.pricing'],
  ['finance','accounting','accounting.vat_periodicity'],
] as const;

/** Aide courte affichée dans l'assistant (une phrase, comme la maquette) ; l'aide
 *  complète reste dans Paramètres › Paramètres métier. */
export const WIZARD_HELP: Record<string, string> = {
  'production.demand_source': 'Ce qui déclenche les ordres : la prévision de vente, les commandes clients, ou les deux.',
  'production.rhythm': 'Artisanal : plan du jour. Industriel : ordonnancement par ligne. En continu : flux permanent, sur stock.',
  'production.mrp_horizon': 'Nombre de jours couverts par le plan directeur.',
  'production.yield_target': 'En dessous de ce rendement, l’article est signalé à la clôture de l’ordre.',
  'production.cost_allocation_key': 'Clé de partage des charges entre les produits d’un même ordre.',
  'stock.organization': 'Centralisée : un dépôt reçoit les achats et approvisionne les établissements.',
  'stock.negative_policy': 'Quand une sortie dépasse le stock disponible.',
  'stock.dlc_alerts': 'Prévenir avant la date limite des lots en stock.',
  'stock.low_stock_alerts': 'Signaler les articles sous leur seuil et proposer les achats.',
  'sales.pos_stock': 'Vendre ou non en caisse un produit dont la vitrine est vide.',
  'sales.channel': 'Les autres canaux restent disponibles ; le canal principal fixe l’écran d’accueil.',
  'sales.quotes': 'Durée de validité proposée sur un nouveau devis.',
  'production.flow': 'Étapes obligatoires d’un ordre.',
  'production.enforce_declared_steps': 'Rendre bloquants la pesée et le contrôle qualité prévus par le type d’ordre.',
  'quality.auto_release': 'Libérer un lot dès que ses contrôles sont faits et conformes.',
  'quality.ccp_rule': 'Ce qu’il faut pour clôturer une étape critique (HACCP).',
  'purchasing.lot_dlc_enforcement': 'Que faire quand le lot ou la date limite manquent à la réception.',
  'purchasing.po_requires_request': 'Exiger une demande d’achat avant d’envoyer un bon de commande.',
  'sales.closure': 'Demander l’inventaire des invendus à la fermeture de caisse.',
  'sales.pricing': 'Remise manuelle maximale accordée sans validation, par profil.',
  'accounting.vat_periodicity': 'Régime de déclaration : l’écran TVA calcule sur un mois ou sur un trimestre.',
};

export const WIZARD_PARAMETERS = selection.map(([step,module,key])=>{
  const def=parameterByKey(key);
  if(!def||def.storage.kind==='company_settings'||(def.storage.kind==='policy'&&!def.scopes?.includes('company')))throw new Error(`Paramètre assistant non admissible : ${key}`);
  return {step,module,def};
});
export const wizardParameterField = (step:string,key:string) => WIZARD_PARAMETERS.flatMap(p=>p.step===step?p.def.fields.map(field=>({...p,field,id:`${p.def.key}:${field.name}`})):[]).find(p=>p.id===key);
export const WIZARD_MODULE_PARAMETER_KEYS = WIZARD_PARAMETERS.filter(p=>p.def.storage.kind==='module_parameters').map(p=>p.def.key);

import { vocabularyFallback } from '@ofauria/shared';
import { VOCABULARY_KEY_SET, INTERFACE_KEYS, WORKSPACES, parseWorkspace, parseTableDensity } from '@ofauria/shared';
import { db } from '../../config/database.js';
import { sectorRepository } from '../../repositories/sector.repository.js';
import type { ConfigLayers } from '../../repositories/config-layers.repository.js';
import type { WizardData,WizardIssue } from './steps.js';
import { companyInterfaceRows, normalizePreference } from '../interface-preferences.js';

export const COMPANY_FIELDS = ['name','legalForm','locale','timezone','size','country','currency'] as const;
export const INTERFACE_FIELDS=['workspace','density'] as const;
export function validateInterfaceData(data:WizardData|undefined,modules:unknown,available:boolean):WizardIssue[]{
  const issues:WizardIssue[]=[];
  const block=(message:string)=>issues.push({step:'interfaces',severity:'blocking',message});
  if(!data)return issues;
  if(INTERFACE_FIELDS.some(f=>data[f]!==undefined)&&!available)block('Stockage des préférences indisponible.');
  if(data.workspace!==undefined){const value=parseWorkspace(data.workspace);const module=WORKSPACES.find(w=>w.value===value)?.module;if(!value)block('Espace de travail inconnu.');else if(module&&(!Array.isArray(modules)||!modules.includes(module)))block('L’espace de travail exige un module sélectionné.');}
  if(data.density!==undefined&&!parseTableDensity(data.density))block('Densité de tableau inconnue.');
  return issues;
}
const isText=(v:unknown):v is string=>typeof v==='string';

export function validateLayerData(company:WizardData|undefined,vocabulary:WizardData|undefined):WizardIssue[] {
  const issues:WizardIssue[]=[];
  const block=(step:string,message:string)=>issues.push({step,severity:'blocking',message});
  if(company){
    for(const [key,max] of [['name',120],['legalForm',30],['locale',10],['timezone',100],['size',80]] as const){
      const v=company[key];if(v!==undefined&&(!isText(v)||v.trim().length>max))block('company',`Champ entreprise invalide : ${key}.`);
    }
    if(isText(company.locale)&&company.locale.trim()&&!['fr','ar','en'].includes(company.locale.trim()))block('company','Langue non prise en charge.');
    if(isText(company.timezone)&&company.timezone.trim())try{new Intl.DateTimeFormat('fr',{timeZone:company.timezone.trim()})}catch{block('company','Fuseau horaire IANA invalide.');}
    if(isText(company.size)&&company.size.trim()&&!['TPE','PME','Grande entreprise'].includes(company.size.trim()))block('company','Taille d’entreprise invalide.');
  }
  for(const [key,value] of Object.entries(vocabulary??{}))if(VOCABULARY_KEY_SET.has(key)&&(!isText(value)||!value.trim()||value.trim().length>80))block('vocabulary',`Terme vide ou trop long : ${key}.`);
  return issues;
}

/** Construire exclusivement les couches effectivement prises en charge. Les identifiants
 *  techniques et les champs légaux de pays/devise ne sont jamais modifiés ici. */
export async function prepareWizardLayers(primary:string,company?:WizardData,vocabulary?:WizardData,interfaces?:WizardData):Promise<ConfigLayers> {
  const layers:ConfigLayers={};
  if(INTERFACE_FIELDS.some(f=>interfaces?.[f]!==undefined)){
    const rows=new Map((await companyInterfaceRows()).map(r=>[r.key,r.value]));
    for(const field of INTERFACE_FIELDS){const value=normalizePreference(field,interfaces?.[field]);if(value)rows.set(INTERFACE_KEYS[field],value);}
    layers.interface_preferences=[...rows].map(([key,value])=>({key,value}));
  }
  if(company&&Object.keys(company).length){
    const {rows}=await db.query(`SELECT id,legal_name,legal_form,default_locale,timezone,company_size FROM company_settings WHERE id=1`);
    if(!rows[0])throw new Error('Société introuvable');
    const c={...rows[0]};
    for(const [key,col] of [['name','legal_name'],['legalForm','legal_form'],['locale','default_locale'],['timezone','timezone'],['size','company_size']] as const){
      const v=company[key];if(isText(v)&&v.trim())c[col]=v.trim();
    }
    layers.company_context=[c];
  }
  if(vocabulary&&Object.keys(vocabulary).length){
    const current=await sectorRepository.labelOverrides();
    const wanted=new Map(current.map(r=>[r.label_key,r.label_value]));
    const defaults=await sectorRepository.sectorLabels(primary);
    for(const [key,v] of Object.entries(vocabulary))if(VOCABULARY_KEY_SET.has(key)&&isText(v)&&v.trim()){
      // Audit des profils (L6) : un terme égal au terme du profil OU au repli du catalogue n'est pas un
      // renommage de la société (sinon il serait figé et ne suivrait plus le profil).
      if(defaults[key]===v.trim()||vocabularyFallback(key)===v.trim())wanted.delete(key);else wanted.set(key,v.trim());
    }
    layers.labels=[...wanted].map(([key,value])=>({key,value}));
  }
  return layers;
}

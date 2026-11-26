import { PARAM_NEEDS } from '@ofauria/shared';
import { WIZARD_HELP } from './parameter-definitions.js';
import { WIZARD_PARAMETERS, wizardParameterField } from './parameter-definitions.js';
import { readAll, write } from '../settings-center.js';
import { validateParameter } from '../parameters-catalog.js';
import { sectorRepository } from '../../repositories/sector.repository.js';
import type { WizardAnswers, WizardIssue } from './steps.js';
import { isDeepStrictEqual } from 'node:util';

export async function wizardParameters(){
  const values=await readAll();
  // Audit des profils (L5) : besoins du réglage (capacités) pour que l'assistant le filtre sur le brouillon.
  return WIZARD_PARAMETERS.map(({step,module,def})=>({step,module,key:def.key,label:def.label,help:WIZARD_HELP[def.key]??def.help,fields:def.fields,value:values.get(def.key)??null,...(PARAM_NEEDS[def.key]?{needs:PARAM_NEEDS[def.key]}:{})}));
}

export function prepareParameterChanges(answers:WizardAnswers,catalog:Awaited<ReturnType<typeof wizardParameters>>){
  const issues:WizardIssue[]=[];
  const changes:{key:string;value:Record<string,unknown>;before:Record<string,unknown>;step:string}[]=[];
  const modules=answers.modules?.data?.selected;
  for(const p of WIZARD_PARAMETERS){
    const input:Record<string,unknown>={};
    for(const [key,raw] of Object.entries(answers[p.step]?.data??{})){
      const field=wizardParameterField(p.step,key);
      if(field?.def.key!==p.def.key)continue;
      if(['number','integer','percent'].includes(field.field.type)&&(typeof raw!=='string'||!raw.trim())){
        issues.push({step:p.step,severity:'blocking',message:`${field.field.label} : nombre attendu`});continue;
      }
      input[field.field.name]=raw;
    }
    if(!Object.keys(input).length)continue;
    const current=catalog.find(c=>c.key===p.def.key)?.value;
    if(!Array.isArray(modules)||!modules.includes(p.module)||!current){issues.push({step:p.step,severity:'blocking',message:`${p.def.label} : module non sélectionné ou paramètre indisponible.`});continue;}
    const checked=validateParameter(p.def,input,current);
    if(typeof checked==='string'){issues.push({step:p.step,severity:'blocking',message:`${p.def.label} : ${checked}`});continue;}
    changes.push({key:p.def.key,value:checked,before:current,step:p.step});
  }
  return {issues,changes};
}

/** Chemin d'écriture commun au centre de paramètres, dans la transaction de simulation. */
export async function applyWizardParameters(answers:WizardAnswers,actor:string){
  const {issues,changes}=prepareParameterChanges(answers,await wizardParameters());
  if(issues.length)throw Object.assign(new Error(issues.map(i=>i.message).join(' ')),{statusCode:409});
  for(const change of changes){
    const def=WIZARD_PARAMETERS.find(p=>p.def.key===change.key)!.def;
    if(!(await write(def,change.value,actor)))throw Object.assign(new Error(`Paramètre indisponible : ${def.label}`),{statusCode:409});
  }
  if(changes.length){
    const actual=await readAll();
    for(const change of changes){
      const persisted=actual.get(change.key);
      if(!persisted||!isDeepStrictEqual(change.value,persisted))throw Object.assign(new Error(`La valeur enregistrée ne correspond pas au paramètre préparé : ${change.key}`),{statusCode:409});
    }
    await sectorRepository.recordVersion('Paramètres métier — assistant',actor);
  }
  return changes;
}

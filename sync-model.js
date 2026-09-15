(function(root) {
  'use strict';
  const M = typeof module !== 'undefined' && module.exports ? require('./model.js') : root.Equilibre;
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const copy = value => value === undefined ? undefined : structuredClone(value);
  function flatten(day) {
    const d = day || M.blankDay(), out = {};
    for (const key of ['plannedIntake','base','target','total','weight','note','intakeMode']) out[key] = d[key];
    out.legacyIntake = d.intakeMode === 'legacy' ? d.intake : null;
    for (const key of Object.keys(M.mealNames)) for (const field of ['kcal','note']) out[`meals.${key}.${field}`] = d.meals[key][field];
    for (const a of d.activities) out[`activity.${a.id}`] = a;
    return out;
  }
  function inflate(fields) {
    const d = M.blankDay();
    for (const key of ['plannedIntake','base','target','total','weight','note','intakeMode']) d[key] = fields[key];
    for (const key of Object.keys(M.mealNames)) for (const field of ['kcal','note']) d.meals[key][field] = fields[`meals.${key}.${field}`];
    d.activities = Object.keys(fields).filter(k=>k.startsWith('activity.') && fields[k] !== undefined).sort().map(k=>fields[k]);
    d.intake = d.intakeMode === 'legacy' ? fields.legacyIntake : M.mealSummary(d).total;
    return M.validateBackup({version:2,days:{'2000-01-01':d}}).days['2000-01-01'];
  }
  function mergeDay(base, local, remote, resolutions = {}) {
    const b=flatten(base), l=flatten(local), r=flatten(remote), result={}, conflicts=[];
    for (const key of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])) {
      if(same(l[key],r[key])) result[key]=copy(l[key]);
      else if(same(l[key],b[key])) result[key]=copy(r[key]);
      else if(same(r[key],b[key])) result[key]=copy(l[key]);
      else if(resolutions[key] === 'local' || resolutions[key] === 'remote') result[key]=copy(resolutions[key] === 'local' ? l[key] : r[key]);
      else { conflicts.push({key,local:copy(l[key]),remote:copy(r[key])}); result[key]=copy(l[key]); }
    }
    return {day:inflate(result),conflicts};
  }
  function label(key) {
    if(key.startsWith('profile.goals.')){const [, ,date,field]=key.split('.');return `Objectif du ${date} · ${label(field)}`;}
    if(key.startsWith('profile.weights.'))return 'Pesée du '+key.slice('profile.weights.'.length);
    const titles={plannedIntake:'Apports prévus',base:'Dépense hors séances',target:'Déficit cible',total:'Dépense totale',weight:'Pesée',note:'Note du jour',intakeMode:'Mode de saisie des apports',legacyIntake:'Ancien total consommé'};
    if(key.startsWith('meals.')) { const [,meal,field]=key.split('.');return `${M.mealNames[meal]} · ${field === 'kcal' ? 'calories' : 'recettes / note'}`; }
    return key.startsWith('activity.') ? 'Activité' : titles[key] || key;
  }
  function mergeProfile(base,local,remote,resolutions={}) {
    const b=base||M.blankProfile(),l=local||M.blankProfile(),r=remote||M.blankProfile(),result=M.blankProfile(),conflicts=[];
    function merge(key,bv,lv,rv){
      if(same(lv,rv))return copy(lv);
      if(same(lv,bv))return copy(rv);
      if(same(rv,bv))return copy(lv);
      if(resolutions[key]==='local')return copy(lv);
      if(resolutions[key]==='remote')return copy(rv);
      conflicts.push({key,local:copy(lv),remote:copy(rv)});return copy(lv);
    }
    for(const date of new Set([...Object.keys(b.goals),...Object.keys(l.goals),...Object.keys(r.goals)])){
      // Distinct effective dates are independent changes; merge fields only within a shared period.
      if(!Object.hasOwn(b.goals,date) && !Object.hasOwn(l.goals,date)){result.goals[date]=copy(r.goals[date]);continue;}
      if(!Object.hasOwn(b.goals,date) && !Object.hasOwn(r.goals,date)){result.goals[date]=copy(l.goals[date]);continue;}
      const bg=M.goalsAt(b,date)||M.blankGoals(),lg=M.goalsAt(l,date)||M.blankGoals(),rg=M.goalsAt(r,date)||M.blankGoals();
      result.goals[date]=Object.fromEntries(Object.keys(M.goalFields).map(key=>[key,merge('profile.goals.'+date+'.'+key,bg[key],lg[key],rg[key])]));
    }
    for(const date of new Set([...Object.keys(b.weights),...Object.keys(l.weights),...Object.keys(r.weights)])){
      const value=merge('profile.weights.'+date,b.weights[date],l.weights[date],r.weights[date]);
      if(value!==undefined)result.weights[date]=value;
    }
    return {profile:M.validateProfile(result),conflicts};
  }
  const api={same,mergeDay,label,mergeProfile};
  if(typeof module !== 'undefined' && module.exports)module.exports=api;else root.EquilibreSync=api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

(function (root) {
  'use strict';
  const sources = {manual: 'Manuelle', garmin: 'Garmin Connect', urevo: 'Urevo', 'google-fit': 'Google Fit', other: 'Autre appareil'};
  const fields = {plannedIntake: 30000, intake: 30000, base: 30000, target: 10000, total: 30000, weight: 600};
  const mealNames = {breakfast: 'Petit déjeuner', lunch: 'Déjeuner', snack: 'Goûter', dinner: 'Dîner'};
  const blankMeals = () => Object.fromEntries(Object.keys(mealNames).map(key => [key, {kcal: null, note: ''}]));
  function validDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s) || s < '1900-01-01' || s > '2100-12-31') return false;
    const d = new Date(s + 'T12:00:00Z');
    return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === s;
  }
  function blankDay() {
    return {plannedIntake: null, intake: null, base: null, target: null, total: null, weight: null, note: '', activities: [], meals: blankMeals(), intakeMode: 'meals'};
  }
  function optionalNumber(value, max, min = 0) {
    return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max);
  }
  const goalFields = {plannedIntake: 30000, base: 30000, target: 10000, maintenance:30000};
  const blankGoals = () => ({plannedIntake:null,base:null,target:null,maintenance:null});
  const blankProfile = () => ({goals:{},weights:{},resting:null});
  function validateProfile(raw) {
    if(!raw || typeof raw!=='object' || !raw.goals || !raw.weights || Array.isArray(raw.goals) || Array.isArray(raw.weights) || typeof raw.goals!=='object' || typeof raw.weights!=='object' || Object.keys(raw.goals).length>20000 || Object.keys(raw.weights).length>20000)throw Error('Profil invalide.');
    const result=blankProfile();
    if(!optionalNumber(raw.resting??null,20000,1))throw Error('Métabolisme de base invalide.');
    result.resting=raw.resting??null;
    for(const date of Object.keys(raw.goals).sort()){
      if(!validDate(date) || !raw.goals[date] || typeof raw.goals[date]!=='object')throw Error('Date d’objectif invalide.');
      const goals=blankGoals();
      for(const [key,max] of Object.entries(goalFields)){
        const value=key==='maintenance'?(raw.goals[date][key]??null):raw.goals[date][key];
        if(!optionalNumber(value,max))throw Error('Objectif invalide : '+key);
        goals[key]=value;
      }result.goals[date]=goals;
    }
    for(const date of Object.keys(raw.weights).sort()){
      if(!validDate(date) || !optionalNumber(raw.weights[date],600,1))throw Error('Pesée du profil invalide.');
      result.weights[date]=raw.weights[date];
    }return result;
  }
  function profileFromDays(days) {
    const profile=blankProfile();
    for(const date of Object.keys(days).sort()){
      const day=days[date];
      profile.goals[date]=Object.fromEntries(Object.keys(goalFields).map(key=>[key,day[key]??null]));
      if(day.weight!==null)profile.weights[date]=day.weight;
    }return validateProfile(profile);
  }
  function goalsAt(profile,date) {
    const from=Object.keys(profile.goals).filter(d=>d<=date).sort().at(-1);
    return from?{...blankGoals(),...structuredClone(profile.goals[from])}:null;
  }
  function effectiveDay(day,profile,date) {
    return {...(day||blankDay()),...(goalsAt(profile,date)||{})};
  }
  function weightOn(profile,days,date) {
    return Object.hasOwn(profile.weights,date)?profile.weights[date]:(days[date]?.weight??null);
  }
  function latestWeight(profile,days,until) {
    for(const date of [...new Set([...Object.keys(profile.weights),...Object.keys(days)])].filter(d=>d<=until).sort().reverse()){
      const weight=weightOn(profile,days,date);if(weight!==null)return {date,weight};
    }return null;
  }
  function validateBackup(raw) {
    if (!raw || ![1, 2, 3].includes(raw.version) || !raw.days || typeof raw.days !== 'object' || Array.isArray(raw.days) || Object.keys(raw.days).length > 20000) throw Error('Format de sauvegarde non reconnu.');
    const result = {version: 3, days: {}};
    for (const [date, day] of Object.entries(raw.days)) {
      if (!validDate(date) || !day || typeof day !== 'object') throw Error('Date ou journée invalide.');
      const clean = blankDay();
      for (const [key, max] of Object.entries(fields)) {
        if (!optionalNumber(day[key], max, key === 'weight' ? 1 : 0)) throw Error('Valeur invalide pour ' + date + ' : ' + key);
        clean[key] = day[key];
      }
      if (raw.version === 1 && !day.meals) clean.intakeMode = 'legacy';
      else {
        if (!['meals', 'legacy'].includes(day.intakeMode) || !day.meals || typeof day.meals !== 'object') throw Error('Repas invalides.');
        clean.intakeMode = day.intakeMode;
        for (const key of Object.keys(mealNames)) {
          const meal = day.meals[key];
          if (!meal || !optionalNumber(meal.kcal, 10000) || typeof meal.note !== 'string' || meal.note.length > 1000) throw Error('Repas invalide : ' + mealNames[key]);
          clean.meals[key] = {kcal: meal.kcal, note: meal.note};
        }
      }
      if (clean.intakeMode === 'meals') clean.intake = mealSummary(clean).total;
      if (clean.intake !== null && clean.intake > 30000) throw Error('Le total des repas dépasse 30 000 kcal.');
      if (typeof day.note !== 'string' || day.note.length > 1000 || !Array.isArray(day.activities) || day.activities.length > 200) throw Error('Note ou activités invalides.');
      clean.note = day.note;
      const ids = new Set();
      clean.activities = day.activities.map(a => {
        if (!a || typeof a.id !== 'string' || a.id.length < 1 || a.id.length > 100 || ids.has(a.id) || typeof a.name !== 'string' || !a.name.trim() || a.name.length > 100 || !optionalNumber(a.minutes, 1440, 1) || a.minutes === null || !optionalNumber(a.kcal, 20000) || !['done', 'planned'].includes(a.state) || !Object.hasOwn(sources, a.source)) throw Error('Activité invalide pour ' + date);
        ids.add(a.id);
        return {id: a.id, name: a.name, minutes: a.minutes, kcal: a.kcal, state: a.state, source: a.source};
      });
      result.days[date] = clean;
    }
    result.profile=raw.version===3?validateProfile(raw.profile):profileFromDays(result.days);
    return result;
  }
  function mealSummary(day) {
    if (day.intakeMode !== 'meals') return {total: day.intake, completed: null};
    const values = Object.values(day.meals).map(m => m.kcal).filter(v => v !== null);
    return {total: values.length ? values.reduce((a,b) => a+b, 0) : null, completed: values.length};
  }
  function sumCalories(activities) {
    return activities.some(a => a.kcal === null) ? null : activities.reduce((sum, a) => sum + a.kcal, 0);
  }
  function balance(day) {
    // Maintenance already includes the usual activity averaged across the week.
    const maintenance=day.maintenance??null;
    const plannedSport = sumCalories(day.activities);
    const doneSport = sumCalories(day.activities.filter(a => a.state === 'done'));
    const plannedExpense = maintenance!==null?maintenance:day.base === null || plannedSport === null ? null : day.base + plannedSport;
    const actualExpense = day.total !== null ? day.total : maintenance!==null?maintenance:day.base === null || doneSport === null ? null : day.base + doneSport;
    const intake = day.intakeMode === 'meals' ? mealSummary(day).total : day.intake;
    return {plannedExpense, actualExpense, planned: plannedExpense === null || day.plannedIntake === null ? null : plannedExpense - day.plannedIntake, actual: actualExpense === null || intake === null ? null : actualExpense - intake};
  }
  function shiftDate(date, delta) {
    const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10);
  }
  function mergeBackup(current, incoming) {
    const merged = validateBackup(current), data = validateBackup(incoming);
    let added = 0, skipped = 0;
    for (const [date, day] of Object.entries(data.days)) {
      if (Object.hasOwn(merged.days, date)) skipped++;
      else { merged.days[date] = day; added++; }
    }
    for(const key of ['goals','weights'])for(const [date,value] of Object.entries(data.profile[key]))if(!Object.hasOwn(merged.profile[key],date))merged.profile[key][date]=structuredClone(value);
    if(merged.profile.resting===null && data.profile.resting!==null)merged.profile.resting=data.profile.resting;
    merged.profile=validateProfile(merged.profile);
    return {data: merged, added, skipped};
  }
  const api = {sources, mealNames, blankMeals, mealSummary, blankDay, validDate, validateBackup, balance, shiftDate, mergeBackup,goalFields,blankGoals,blankProfile,validateProfile,profileFromDays,goalsAt,effectiveDay,weightOn,latestWeight};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Equilibre = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

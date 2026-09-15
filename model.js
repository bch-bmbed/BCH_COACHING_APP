(function (root) {
  'use strict';
  const sources = {manual: 'Manuelle', garmin: 'Garmin Connect', urevo: 'Urevo', 'google-fit': 'Google Fit', other: 'Autre appareil'};
  const fields = {plannedIntake: 30000, intake: 30000, base: 30000, target: 10000, total: 30000, weight: 600};
  function validDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s) || s < '1900-01-01' || s > '2100-12-31') return false;
    const d = new Date(s + 'T12:00:00Z');
    return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === s;
  }
  function blankDay() {
    return {plannedIntake: null, intake: null, base: null, target: null, total: null, weight: null, note: '', activities: []};
  }
  function optionalNumber(value, max, min = 0) {
    return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max);
  }
  function validateBackup(raw) {
    if (!raw || raw.version !== 1 || !raw.days || typeof raw.days !== 'object' || Array.isArray(raw.days) || Object.keys(raw.days).length > 20000) throw Error('Format de sauvegarde non reconnu.');
    const result = {version: 1, days: {}};
    for (const [date, day] of Object.entries(raw.days)) {
      if (!validDate(date) || !day || typeof day !== 'object') throw Error('Date ou journée invalide.');
      const clean = blankDay();
      for (const [key, max] of Object.entries(fields)) {
        if (!optionalNumber(day[key], max, key === 'weight' ? 1 : 0)) throw Error('Valeur invalide pour ' + date + ' : ' + key);
        clean[key] = day[key];
      }
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
    return result;
  }
  function sumCalories(activities) {
    return activities.some(a => a.kcal === null) ? null : activities.reduce((sum, a) => sum + a.kcal, 0);
  }
  function balance(day) {
    const plannedSport = sumCalories(day.activities);
    const doneSport = sumCalories(day.activities.filter(a => a.state === 'done'));
    const plannedExpense = day.base === null || plannedSport === null ? null : day.base + plannedSport;
    const actualExpense = day.total !== null ? day.total : day.base === null || doneSport === null ? null : day.base + doneSport;
    return {plannedExpense, actualExpense, planned: plannedExpense === null || day.plannedIntake === null ? null : plannedExpense - day.plannedIntake, actual: actualExpense === null || day.intake === null ? null : actualExpense - day.intake};
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
    return {data: merged, added, skipped};
  }
  const api = {sources, blankDay, validDate, validateBackup, balance, shiftDate, mergeBackup};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Equilibre = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

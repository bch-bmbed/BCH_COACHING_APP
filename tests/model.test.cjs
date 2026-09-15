const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../model.js');
const activity = (kcal, state = 'done') => ({id: 'a', name: 'Marche', minutes: 30, kcal, state, source: 'urevo'});
test('aucun déficit inventé pour une journée vide', () => {
  assert.deepEqual(M.balance(M.blankDay()), {plannedExpense:null,actualExpense:null,planned:null,actual:null});
});
test('prévision inclut toutes les séances, bilan seulement les réalisées', () => {
  const day = {...M.blankDay(),base:2000,intake:1800,plannedIntake:1900,activities:[activity(200),{...activity(300,'planned'),id:'b'}]};
  assert.deepEqual(M.balance(day), {plannedExpense:2500,actualExpense:2200,planned:600,actual:400});
});
test('le total de la montre remplace la base et les séances', () => {
  const day = {...M.blankDay(),base:2000,total:2400,intake:1800,activities:[activity(200)]};
  assert.equal(M.balance(day).actual,600);
});
test('calories inconnues ne deviennent pas zéro, total peut compléter le bilan', () => {
  const day = {...M.blankDay(),base:2000,intake:1800,plannedIntake:1800,activities:[activity(null)]};
  assert.equal(M.balance(day).actual,null); assert.equal(M.balance(day).planned,null);
  day.total=2400;assert.equal(M.balance(day).actual,600);
});
test('zéro explicite et surplus sont conservés', () => {
  assert.equal(M.balance({...M.blankDay(),base:0,intake:100}).actual,-100);
});
test('validation des dates et transitions mois/année', () => {
  assert.equal(M.validDate('2026-02-30'),false);assert.equal(M.validDate('2024-02-29'),true);
  assert.equal(M.shiftDate('2026-01-01',-1),'2025-12-31');
});
test('fusion des sauvegardes sans écraser les dates existantes et import idempotent', () => {
  const a={version:1,days:{'2026-09-15':{...M.blankDay(),intake:1800}}};
  const b={version:1,days:{'2026-09-15':{...M.blankDay(),intake:2000},'2026-09-14':M.blankDay()}};
  const result=M.mergeBackup(a,b);assert.equal(result.added,1);assert.equal(result.skipped,1);assert.equal(result.data.days['2026-09-15'].intake,1800);
  assert.equal(M.mergeBackup(result.data,b).added,0);
});
test('sauvegardes malformées, versions inconnues et identifiants dupliqués refusés', () => {
  assert.throws(()=>M.validateBackup({version:2,days:{}}));
  for(const value of [-1,Infinity,'2000']) assert.throws(()=>M.validateBackup({version:1,days:{'2026-09-15':{...M.blankDay(),intake:value}}}));
  assert.throws(()=>M.validateBackup({version:1,days:{'2026-09-15':{...M.blankDay(),activities:[activity(20),activity(30)]}}}));
});

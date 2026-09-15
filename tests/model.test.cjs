const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../model.js');
const legacy = () => ({...M.blankDay(),intakeMode:'legacy'});
const activity = (kcal, state = 'done') => ({id: 'a', name: 'Marche', minutes: 30, kcal, state, source: 'urevo'});
test('aucun déficit inventé pour une journée vide', () => {
  assert.deepEqual(M.balance(M.blankDay()), {plannedExpense:null,actualExpense:null,planned:null,actual:null});
});
test('prévision inclut toutes les séances, bilan seulement les réalisées', () => {
  const day = {...legacy(),base:2000,intake:1800,plannedIntake:1900,activities:[activity(200),{...activity(300,'planned'),id:'b'}]};
  assert.deepEqual(M.balance(day), {plannedExpense:2500,actualExpense:2200,planned:600,actual:400});
});
test('le total de la montre remplace la base et les séances', () => {
  const day = {...legacy(),base:2000,total:2400,intake:1800,activities:[activity(200)]};
  assert.equal(M.balance(day).actual,600);
});
test('calories inconnues ne deviennent pas zéro, total peut compléter le bilan', () => {
  const day = {...legacy(),base:2000,intake:1800,plannedIntake:1800,activities:[activity(null)]};
  assert.equal(M.balance(day).actual,null); assert.equal(M.balance(day).planned,null);
  day.total=2400;assert.equal(M.balance(day).actual,600);
});
test('zéro explicite et surplus sont conservés', () => {
  assert.equal(M.balance({...legacy(),base:0,intake:100}).actual,-100);
});
test('validation des dates et transitions mois/année', () => {
  assert.equal(M.validDate('2026-02-30'),false);assert.equal(M.validDate('2024-02-29'),true);
  assert.equal(M.shiftDate('2026-01-01',-1),'2025-12-31');
});
test('fusion des sauvegardes sans écraser les dates existantes et import idempotent', () => {
  const a={version:2,days:{'2026-09-15':{...legacy(),intake:1800}}};
  const b={version:2,days:{'2026-09-15':{...legacy(),intake:2000},'2026-09-14':M.blankDay()}};
  const result=M.mergeBackup(a,b);assert.equal(result.added,1);assert.equal(result.skipped,1);assert.equal(result.data.days['2026-09-15'].intake,1800);
  assert.equal(M.mergeBackup(result.data,b).added,0);
});
test('sauvegardes malformées, versions inconnues et identifiants dupliqués refusés', () => {
  assert.throws(()=>M.validateBackup({version:4,days:{}}));
  for(const value of [-1,Infinity,'2000']) assert.throws(()=>M.validateBackup({version:1,days:{'2026-09-15':{...M.blankDay(),intake:value}}}));
  assert.throws(()=>M.validateBackup({version:1,days:{'2026-09-15':{...M.blankDay(),activities:[activity(20),activity(30)]}}}));
});
test('migration v1 conserve le total sans inventer une répartition',()=>{
  const d={...legacy(),intake:1850};delete d.meals;delete d.intakeMode;
  const migrated=M.validateBackup({version:1,days:{'2026-09-15':d}});
  assert.equal(migrated.version,3);assert.equal(migrated.days['2026-09-15'].intake,1850);assert.equal(migrated.days['2026-09-15'].intakeMode,'legacy');
});
test('somme des quatre repas, repas absents et zéro explicite',()=>{
  const d=M.blankDay();d.meals.breakfast.kcal=400;d.meals.lunch.kcal=650;d.meals.snack.kcal=0;d.meals.dinner.kcal=700;
  assert.deepEqual(M.mealSummary(d),{total:1750,completed:4});
  d.meals.dinner.kcal=null;assert.deepEqual(M.mealSummary(d),{total:1050,completed:3});
  d.base=2200;assert.equal(M.balance(d).actual,1150);
  const saved=M.validateBackup({version:2,days:{'2026-09-15':d}});assert.equal(saved.days['2026-09-15'].intake,1050);
});

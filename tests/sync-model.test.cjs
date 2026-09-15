const test=require('node:test'),assert=require('node:assert/strict'),M=require('../model.js'),S=require('../sync-model.js');
test('un repas sur PC et une activité sur téléphone sont réunis',()=>{
  const base=M.blankDay(),pc=structuredClone(base),phone=structuredClone(base);
  pc.meals.lunch={kcal:640,note:'Pâtes'};phone.activities.push({id:'test-a',name:'Marche',minutes:30,kcal:150,state:'done',source:'manual'});
  const result=S.mergeDay(base,pc,phone);assert.equal(result.conflicts.length,0);assert.equal(result.day.intake,640);assert.equal(result.day.activities.length,1);
});
test('deux repas distincts changent sans conflit',()=>{
  const base=M.blankDay(),pc=structuredClone(base),phone=structuredClone(base);pc.meals.lunch.kcal=650;phone.meals.dinner.kcal=700;
  const result=S.mergeDay(base,pc,phone);assert.equal(result.day.intake,1350);assert.equal(result.conflicts.length,0);
});
test('même repas modifié simultanément : choix explicite sans écrasement',()=>{
  const base=M.blankDay(),pc=structuredClone(base),phone=structuredClone(base);pc.meals.lunch.kcal=650;phone.meals.lunch.kcal=700;
  const result=S.mergeDay(base,pc,phone);assert.equal(result.conflicts[0].key,'meals.lunch.kcal');
  assert.equal(S.mergeDay(base,pc,phone,{'meals.lunch.kcal':'remote'}).day.intake,700);
});
test('suppression de séance propagée sans effacer une nouvelle séance',()=>{
  const base=M.blankDay();base.activities=[{id:'a',name:'Marche',minutes:30,kcal:150,state:'done',source:'manual'}];
  const pc=structuredClone(base),phone=structuredClone(base);pc.activities=[];phone.activities.push({...phone.activities[0],id:'b'});
  const result=S.mergeDay(base,pc,phone);assert.deepEqual(result.day.activities.map(a=>a.id),['b']);assert.equal(result.conflicts.length,0);
});
test('modification contre suppression de séance signale un conflit',()=>{
  const base=M.blankDay();base.activities=[{id:'a',name:'Marche',minutes:30,kcal:150,state:'planned',source:'manual'}];
  const pc=structuredClone(base),phone=structuredClone(base);pc.activities=[];phone.activities[0].state='done';
  const result=S.mergeDay(base,pc,phone);assert.equal(result.conflicts.length,1);
});
test('rejouer une synchronisation ne crée pas de doublons',()=>{
  const base=M.blankDay(),pc=structuredClone(base);pc.meals.breakfast.kcal=400;
  const once=S.mergeDay(base,pc,base).day;assert.deepEqual(S.mergeDay(base,pc,once),{day:once,conflicts:[]});
});
test('les pas et les calories de marche saisis sur deux appareils sont fusionnés par champ',()=>{
  const base=M.blankDay(),pc=structuredClone(base),phone=structuredClone(base);pc.steps=8200;phone.walkingKcal=210;
  const result=S.mergeDay(base,pc,phone);assert.equal(result.conflicts.length,0);assert.equal(result.day.steps,8200);assert.equal(result.day.walkingKcal,210);
});

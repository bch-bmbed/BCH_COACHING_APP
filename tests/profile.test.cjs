const test=require('node:test'),assert=require('node:assert/strict'),M=require('../model.js'),S=require('../sync-model.js');
const goals=(base=2200)=>({plannedIntake:1800,base,target:400});
test('les objectifs s’appliquent chaque jour à partir de leur date, sans recalculer le passé',()=>{
  const p={goals:{'2026-09-10':goals(),'2026-09-15':goals(2400)},weights:{}};
  for(const [date,expected] of [['2026-09-09',null],['2026-09-14',400],['2026-09-15',400],['2026-10-01',400]]){
    assert.equal(M.balance(M.effectiveDay(undefined,p,date)).planned,expected);
  }
});
test('migration des objectifs quotidiens : chaque ancien bilan, y compris inconnu, reste identique',()=>{
  const days={'2026-09-10':{...M.blankDay(),...goals(),weight:80},'2026-09-11':M.blankDay(),'2026-09-12':{...M.blankDay(),...goals(2300)}};
  const v3=M.validateBackup({version:2,days});
  for(const [date,day] of Object.entries(days))assert.deepEqual(M.balance(M.effectiveDay(v3.days[date],v3.profile,date)),M.balance(day));
  assert.equal(M.goalsAt(v3.profile,'2026-09-14').base,2300);
  assert.equal(v3.profile.weights['2026-09-10'],80);
});
test('la dernière pesée est réutilisée dans le profil sans inventer de mesures quotidiennes',()=>{
  const days={'2026-09-10':{...M.blankDay(),weight:80}},p={goals:{},weights:{'2026-09-12':79.5,'2026-09-20':78}};
  assert.deepEqual(M.latestWeight(p,days,'2026-09-15'),{date:'2026-09-12',weight:79.5});
  assert.equal(M.weightOn(p,days,'2026-09-13'),null);
  p.weights['2026-09-10']=null;p.weights['2026-09-12']=null;
  assert.equal(M.latestWeight(p,days,'2026-09-15'),null);
});
test('export et import v3 conservent le profil et les corrections de pesées',()=>{
  const current={version:3,days:{},profile:{goals:{'2026-09-15':goals()},weights:{'2026-09-15':null}}};
  const incoming={version:3,days:{},profile:{goals:{'2026-09-15':goals(2500),'2026-09-14':goals(2100)},weights:{'2026-09-15':80,'2026-09-14':81}}};
  const merged=M.mergeBackup(current,JSON.parse(JSON.stringify(incoming))).data;
  assert.equal(merged.profile.goals['2026-09-15'].base,2200);assert.equal(merged.profile.goals['2026-09-14'].base,2100);
  assert.equal(merged.profile.weights['2026-09-15'],null);assert.equal(merged.profile.weights['2026-09-14'],81);
  assert.deepEqual(M.mergeBackup(merged,incoming).data,merged);
  for(const raw of [{},{goals:[],weights:{}},{goals:{bad:goals()},weights:{}},{goals:{},weights:{'2026-09-15':0}}])assert.throws(()=>M.validateProfile(raw));
});
test('deux champs du profil modifiés le même jour sont réunis',()=>{
  const base={goals:{'2026-09-10':goals()},weights:{}},local=structuredClone(base),remote=structuredClone(base);
  local.goals['2026-09-15']={...goals(),plannedIntake:1900};remote.goals['2026-09-15']={...goals(),base:2400};remote.weights['2026-09-15']=79;
  const merged=S.mergeProfile(base,local,remote);
  assert.equal(merged.conflicts.length,0);assert.deepEqual(M.goalsAt(merged.profile,'2026-09-15'),{plannedIntake:1900,base:2400,target:400,maintenance:null,includedActivity:null,adaptive:false});
  assert.equal(merged.profile.weights['2026-09-15'],79);
});
test('des objectifs prenant effet à des dates différentes gardent leur chronologie',()=>{
  const base={goals:{'2026-09-10':goals()},weights:{}},local=structuredClone(base),remote=structuredClone(base);
  local.goals['2026-09-16']=goals(2500);remote.goals['2026-09-15']=goals(2400);
  const merged=S.mergeProfile(base,local,remote);
  assert.equal(merged.conflicts.length,0);assert.equal(M.goalsAt(merged.profile,'2026-09-15').base,2400);assert.equal(M.goalsAt(merged.profile,'2026-09-16').base,2500);
});
test('même objectif et même pesée modifiés simultanément demandent un choix',()=>{
  const base={goals:{'2026-09-15':goals()},weights:{'2026-09-15':80}},local=structuredClone(base),remote=structuredClone(base);
  local.goals['2026-09-15'].base=2300;remote.goals['2026-09-15'].base=2400;local.weights['2026-09-15']=79;remote.weights['2026-09-15']=null;
  const merged=S.mergeProfile(base,local,remote);assert.equal(merged.conflicts.length,2);
  const resolved=S.mergeProfile(base,local,remote,Object.fromEntries(merged.conflicts.map(c=>[c.key,'remote'])));
  assert.equal(resolved.conflicts.length,0);assert.deepEqual(resolved.profile,M.validateProfile(remote));
});

test('métabolisme fixe : import, export et nouvelles pesées conservent la valeur sans double comptage',()=>{
  const p={goals:{'2026-09-15':goals()},weights:{'2026-09-15':80},resting:1760};
  const backup={version:3,days:{},profile:p};
  const restored=M.validateBackup(JSON.parse(JSON.stringify(backup)));
  const local=structuredClone(restored.profile);local.weights['2026-09-16']=79;
  const merged=S.mergeProfile(p,local,p).profile;
  assert.equal(merged.resting,1760);assert.equal(M.balance(M.effectiveDay(undefined,merged,'2026-09-16')).plannedExpense,2200);
  assert.equal(M.balance(M.effectiveDay(undefined,{...merged,goals:{}},'2026-09-16')).plannedExpense,null);
  assert.equal(M.mergeBackup({version:3,days:{},profile:M.blankProfile()},backup).data.profile.resting,1760);
});
test('métabolisme optionnel : anciennes sauvegardes et validation des valeurs',()=>{
  assert.equal(M.validateProfile({goals:{},weights:{}}).resting,null);
  for(const resting of [0,-1,20001,'1760',Infinity])assert.throws(()=>M.validateProfile({goals:{},weights:{},resting}));
  assert.equal(M.validateProfile({goals:{},weights:{},resting:null}).resting,null);
});
test('deux estimations du métabolisme différentes demandent un choix',()=>{
  const base={...M.blankProfile(),resting:1760},local={...base,resting:1800},remote={...base,resting:1750};
  const result=S.mergeProfile(base,local,remote);assert.equal(result.conflicts[0].key,'profile.resting');
  assert.equal(S.mergeProfile(base,local,remote,{'profile.resting':'remote'}).profile.resting,1750);
});

test('un maintien comprenant le sport ne reçoit pas les séances une deuxième fois',()=>{
  const day={...M.blankDay(),maintenance:2750,plannedIntake:2400,base:null};
  day.meals.lunch.kcal=2400;
  day.activities=[{id:'a',name:'Sport',minutes:40,kcal:350,state:'done',source:'manual'},{id:'b',name:'Marche',minutes:30,kcal:null,state:'planned',source:'manual'}];
  assert.deepEqual(M.balance(day),{plannedExpense:2750,actualExpense:2750,planned:350,actual:350});
  day.total=3100;assert.deepEqual(M.balance(day),{plannedExpense:2750,actualExpense:3100,planned:350,actual:700});
});
test('passer au maintien dès aujourd’hui conserve le calcul des journées précédentes',()=>{
  const profile={...M.blankProfile(),goals:{'2026-09-10':goals(),'2026-09-15':{plannedIntake:2400,base:null,target:350,maintenance:2750}}};
  const day={...M.blankDay(),activities:[{id:'a',name:'Sport',minutes:40,kcal:300,state:'done',source:'manual'}]};
  assert.equal(M.balance(M.effectiveDay(day,profile,'2026-09-14')).plannedExpense,2500);
  assert.equal(M.balance(M.effectiveDay(day,profile,'2026-09-15')).plannedExpense,2750);
  assert.equal(M.balance(M.effectiveDay(day,profile,'2026-09-16')).plannedExpense,2750);
  const restored=M.validateBackup({version:3,days:{},profile});assert.equal(restored.profile.goals['2026-09-15'].maintenance,2750);
});
test('changer de méthode et modifier la base simultanément exige un choix explicite',()=>{
  const base={...M.blankProfile(),goals:{'2026-09-15':{...goals(),maintenance:null}}};
  const pc=structuredClone(base),phone=structuredClone(base);pc.goals['2026-09-15'].base=null;pc.goals['2026-09-15'].maintenance=2750;phone.goals['2026-09-15'].base=2300;
  const result=S.mergeProfile(base,pc,phone);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].key,'profile.goals.2026-09-15.expense');
  const resolved=S.mergeProfile(base,pc,phone,{'profile.goals.2026-09-15.expense':'remote'}).profile;
  assert.equal(resolved.goals['2026-09-15'].maintenance,null);assert.equal(resolved.goals['2026-09-15'].base,2300);
});

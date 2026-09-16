const test=require('node:test'),assert=require('node:assert/strict'),M=require('../model.js'),B=require('../balance-model.js'),S=require('../session-model.js');
const day=(extra={})=>({...M.blankDay(),base:2400,maintenance:null,includedActivity:null,target:250,plannedIntake:2150,adaptive:false,intake:1700,...extra});
const activity=(kcal,state='done')=>({id:'a',name:'Séance',minutes:40,kcal,state,source:'manual'});
const session=(source='test.watch',extra={})=>({id:source,clientId:null,source,start:'2026-01-12T10:00:00Z',end:'2026-01-12T10:40:00Z',modifiedAt:'2026-01-12T12:00:00Z',type:79,kind:'walking',title:'',activeKcal:150,...extra});
const calc=(d=day(),sessions=[],state={available:true})=>B.baseBalance(d,S.dedupe(sessions),1800,state);

test('jour sans sport : base seule, déficit retiré une fois',()=>{
 const r=calc();assert.equal(r.actualExpense,2400);assert.equal(r.intakeTarget,2150);assert.equal(r.planned,250);assert.equal(r.actual,700);
});
test('une activité de moins de 300 kcal augmente intégralement le budget',()=>{
 const r=calc(day(),[session()]);assert.equal(r.actualExpense,2550);assert.equal(r.intakeTarget,2300);assert.equal(r.planned,250);
});
test('copies importées et saisie manuelle ne doublent pas le supplément',()=>{
 const d=day({activities:[activity(150)]}),r=calc(d,[session(),session('com.google.android.apps.fitness')]);assert.equal(r.actualExpense,2550);
});
test('une séance prévue ne crédite le budget qu’une fois réalisée',()=>{
 const d=day({activities:[activity(400,'planned')]});assert.equal(calc(d).intakeTarget,2150);
 d.activities[0].state='done';assert.equal(calc(d).intakeTarget,2550);
});
test('saisies réalisées et marche supplémentaire utilisent le même calcul',()=>{
 const d=day({activities:[activity(200)],walkingKcal:120});assert.equal(calc(d).actualExpense,2720);assert.equal(calc(d).intakeTarget,2470);
});
test('absence de transfert reste inconnue avec une base provisoire, sans inventer zéro',()=>{
 const a=B.activities(day(),[],1800,{}),e=B.expenditure(day(),a);assert.equal(a.kcal,null);assert.equal(e.adjustment,null);assert.equal(e.expense,2400);assert.equal(e.provisional,true);
 const rest=B.expenditure(day(),B.activities(day(),[],1800,{available:true}));assert.equal(rest.adjustment,0);assert.equal(rest.provisional,false);
});
test('séances partiellement chiffrées : seul le supplément connu est retenu et signalé',()=>{
 const rows=S.dedupe([session(),session('other.watch',{activeKcal:null,start:'2026-01-12T12:00:00Z',end:'2026-01-12T12:40:00Z'})]),a=B.activities(day(),rows,1800),e=B.expenditure(day(),a);
 assert.equal(a.missing,1);assert.equal(e.expense,2550);assert.equal(e.provisional,true);
});
test('total quotidien saisi remplace base et séances, zéro compris',()=>{
 for(const total of [0,2800]){const r=calc(day({total}),[session()]);assert.equal(r.actualExpense,total);assert.equal(r.intakeTarget,Math.max(0,total-250));}
});
test('quatre ou cinq entraînements ne créditent aucune séance les jours de repos',()=>{
 for(const count of [4,5]){
  const week=Array.from({length:7},(_,i)=>calc(day(),i<count?[session(undefined,{activeKcal:400})]:[]));
  assert.equal(week.reduce((n,d)=>n+d.actualExpense,0),7*2400+count*400);
  assert.equal(week.reduce((n,d)=>n+d.intakeTarget,0),7*(2400-250)+count*400);
  assert.ok(week.slice(count).every(d=>d.actualExpense===2400));
 }
});
test('profil daté : ancien maintien conservé et nouvelle base synchronisable sans seuil',()=>{
 const profile=M.validateProfile({resting:1800,weights:{},goals:{'2026-01-11':{base:null,maintenance:2700,target:250,plannedIntake:2450,includedActivity:300,adaptive:true},'2026-01-12':{base:2400,maintenance:null,target:250,plannedIntake:2150,includedActivity:null,adaptive:false}}});
 const previous=M.effectiveDay(null,profile,'2026-01-11'),today=M.effectiveDay(null,profile,'2026-01-12');
 assert.equal(B.expenditure(previous,{kcal:150}).expense,2700);assert.equal(B.expenditure(today,{kcal:150}).expense,2550);
 const restored=M.validateBackup({version:4,days:{},profile});assert.deepEqual(restored.profile,profile);
});

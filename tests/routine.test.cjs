const test=require('node:test'),assert=require('node:assert/strict'),R=require('../routine-model.js'),M=require('../model.js'),S=require('../session-model.js'),Sync=require('../sync-model.js'),H=require('../health-model.js'),B=require('../balance-model.js');
const date='2026-09-16',iso=minute=>new Date(Date.parse(date+'T00:00:00Z')+minute*60000).toISOString();
const day=()=>({...M.blankDay(),base:2400,target:300,routine:R.defaults(),routineDate:date});
const bins=(start,n,extra={})=>Array.from({length:n},(_,i)=>({start:iso(start+i),end:iso(start+i+1),steps:90,precisionSeconds:60,sources:['watch'],distanceMeters:null,activeKcal:null,...extra}));
const state=rows=>({available:true,weight:100,zone:'UTC',movement:{version:1,bins:rows}});
const session=(start,n=30,kcal=150,source='watch')=>({id:source,clientId:null,type:79,start:iso(start),end:iso(start+n),source,kind:'walking',title:'Marche',activeKcal:kcal,totalKcal:null,modifiedAt:iso(1300)});
test('deux trajets de 15 minutes comptent dès leur départ ; les petits pas ne créent pas de marche',()=>{
 const rows=[...bins(480,3),...bins(720,15),...bins(780,15)];const a=R.calculate(day(),[],1800,state(rows));
 assert.equal(a.walkCount,2);assert.equal(a.kcal,75);assert.equal(a.rawKcal,103);assert.equal(B.baseBalance(day(),[],1800,state(rows)).intakeTarget,2175);
});
test('les pas distribués depuis un total quotidien ne deviennent jamais une marche',()=>{
 const rows=bins(720,60,{precisionSeconds:86400});const a=R.calculate(day(),[],1800,state(rows));assert.equal(a.kcal,0);assert.equal(a.walkCount,0);assert.equal(a.coarseMinutes,60);
});
test('continuité : pause de deux minutes tolérée, interruption et faible cadence exclues',()=>{
 assert.equal(R.detect([...bins(720,5),...bins(727,5)],10).length,1);
 assert.equal(R.detect([...bins(720,5),...bins(728,5)],10).length,0);
 assert.equal(R.detect(bins(720,20,{steps:20}),10).length,0);
 assert.equal(R.detect(bins(720,9),10).length,0);
});
test('travail mobile : marche de service incluse, pause déjeuner ajoutée, choix modifiable',()=>{
 const d=day();d.routine.type='mobile';d.routine.workMet=2;
 const a=R.calculate(d,[],1800,state([...bins(660,15),...bins(720,15)]));assert.equal(a.kcal,38);assert.equal(a.details[0].added,0);
 d.movementOverrides[a.details[0].key]='extra';assert.equal(R.calculate(d,[],1800,state(bins(660,15))).kcal,20);
 d.movementOverrides[a.details[1].key]='baseline';assert.equal(R.calculate(d,[],1800,state(bins(720,15))).kcal,0);
});
test('copies Garmin/Fit et pas Urevo concomitants : un seul supplément',()=>{
 const sessions=S.dedupe([session(720),session(720,30,150,'fit')]);const a=R.calculate(day(),sessions,1800,state(bins(720,30)));
 assert.equal(a.kcal,123);assert.equal(a.rawKcal,150);assert.equal(a.walkCount,0);assert.equal(a.details.find(d=>d.kind==='walk').blockedMinutes,30);
});
test('une séance sans calories bloque ses pas pour ne pas inventer une compensation',()=>{
 const a=R.calculate(day(),S.dedupe([session(720,30,null)]),1800,state(bins(720,30)));assert.equal(a.kcal,null);assert.equal(a.missing,1);
});
test('une minute traversant une limite de séance est entièrement exclue',()=>{
 const s=session(720.5,14);const a=R.calculate(day(),S.dedupe([s]),1800,state(bins(720,30)));assert.equal(a.details.find(d=>d.kind==='walk').minutes,15);
});
test('distance reçue ou énergie active priment sur une allure supposée ; repos retiré une seule fois',()=>{
 const measured=R.calculate(day(),[],1800,state(bins(720,30,{activeKcal:5,distanceMeters:80})));assert.equal(measured.kcal,123);assert.deepEqual(measured.details[0].bases,['active']);
 const distance=R.calculate(day(),[],1800,state(bins(720,30,{distanceMeters:4000/60})));assert.equal(distance.kcal,85);assert.deepEqual(distance.details[0].bases,['distance']);
 const fast=R.calculate(day(),[],1800,state(bins(720,30,{distanceMeters:200})));assert.equal(fast.kcal,null);assert.equal(fast.missing,1);
 assert.equal(R.calculate(day(),[],1800,state(bins(720,30,{distanceMeters:0}))).kcal,null);
});
test('les horaires suivent le fuseau reçu et les jours de repos changent la base sans toucher au passé',()=>{
 const p=M.validateProfile({resting:1800,weights:{},goals:{'2026-09-15':{...M.blankGoals(),base:2400},[date]:{...M.blankGoals(),base:2400,routine:{...R.defaults(),offBase:2300}}}});
 assert.equal(M.effectiveDay(null,p,'2026-09-15').routine,null);assert.equal(M.effectiveDay(null,p,'2026-09-19').base,2300);assert.equal(M.effectiveDay({...M.blankDay(),routineDay:'work'},p,'2026-09-19').base,2400);
 const d=M.effectiveDay(null,p,date);assert.equal(R.inWork(iso(480),d,'Europe/Paris'),true);assert.equal(R.inWork(iso(660),d,'Europe/Paris'),false);
});
test('absence de transfert ou poids reste explicite ; total manuel remplace tout',()=>{
 assert.equal(R.calculate(day(),[],1800,{weight:100}).kcal,null);
 const a=R.calculate(day(),[],1800,{...state(bins(720,15)),weight:null});assert.equal(a.kcal,null);assert.equal(a.missing,1);
 const d={...day(),total:2700};assert.equal(B.baseBalance(d,[],1800,state(bins(720,30))).intakeTarget,2400);
});
test('classements synchronisés indépendamment des repas, conflits sur le même créneau visibles',()=>{
 const base=day(),local=structuredClone(base),remote=structuredClone(base),key=R.overrideKey('walk',{start:iso(720),end:iso(735)});local.movementOverrides[key]='baseline';remote.meals.lunch.kcal=600;
 const merged=Sync.mergeDay(base,local,remote);assert.equal(merged.conflicts.length,0);assert.equal(merged.day.movementOverrides[key],'baseline');assert.equal(merged.day.meals.lunch.kcal,600);
 remote.movementOverrides[key]='extra';assert.equal(Sync.mergeDay(base,local,remote).conflicts.length,1);
 assert.throws(()=>M.validateBackup({version:4,days:{[date]:{...base,movementOverrides:{bad:'extra'}}}}));
});
test('profil invalide refusé, export puis import conserve horaires et dérogation quotidienne',()=>{
 assert.throws(()=>R.validate({...R.defaults(),periods:[[600,720],[700,800]]}));assert.throws(()=>R.validate({...R.defaults(),workDays:[1,1]}));
 const p={goals:{[date]:{...M.blankGoals(),base:2400,routine:R.defaults()}},weights:{},resting:1800},backup={version:4,profile:p,days:{[date]:{...day(),routineDay:'off'}}};const clean=M.validateBackup(JSON.parse(JSON.stringify(backup)));assert.deepEqual(clean.profile.goals[date].routine,R.defaults());assert.equal(clean.days[date].routineDay,'off');
});
test('protocole minute : ancien APK accepté, limites et chevauchements rejetés',async()=>{
 const s={version:2,day:date,zone:'UTC',source:'health-connect',sources:[],permissions:{steps:true,sessions:true,total:false,activeCalories:true},sessions:[],steps:1000,start:iso(0),end:iso(1440),capturedAt:iso(1400),bins:[],movement:{version:1,bins:bins(720,15)}};
 assert.equal(H.validateSnapshot(s).movement.bins.length,15);
 const {validateUpload}=await import('../supabase/functions/health-bridge/validation.js');assert.equal(validateUpload({snapshots:[s]},Date.parse(s.capturedAt))[0].movement.bins.length,15);
 const old=structuredClone(s);delete old.movement;assert.equal(H.validateSnapshot(old).movement,undefined);
 for(const field of [{steps:401},{end:iso(725)},{activeKcal:-1},{precisionSeconds:NaN}]){const bad=structuredClone(s);Object.assign(bad.movement.bins[0],field);assert.throws(()=>H.validateSnapshot(bad));}
 const bad=structuredClone(s);bad.movement.bins.push(bad.movement.bins[0]);assert.throws(()=>H.validateSnapshot(bad));
});

const test=require('node:test'),assert=require('node:assert/strict'),H=require('../health-model.js'),M=require('../model.js');
function snapshot(day='2026-09-15',hours=16,kcal=100){
 const start=day+'T00:00:00.000Z',end=new Date(Date.parse(start)+86400000).toISOString(),capturedAt=new Date(Date.parse(start)+hours*3600000).toISOString();
 return {version:1,day,zone:'UTC',source:'source.one',start,end,capturedAt,steps:6000,bins:Array.from({length:hours},(_,i)=>({start:new Date(Date.parse(start)+i*3600000).toISOString(),end:new Date(Date.parse(start)+(i+1)*3600000).toISOString(),total:kcal,covered:3600,maxRecordSeconds:3600}))};
}
const history=()=>['2026-09-12','2026-09-13','2026-09-14'].map(d=>snapshot(d,24));
const day=()=>({...M.blankDay(),maintenance:2400,target:300,plannedIntake:2100});
const run=(s,extra={})=>H.project({day:day(),date:'2026-09-15',today:'2026-09-15',snapshot:s,history:history(),now:Date.parse('2026-09-15T16:00:00Z'),...extra});
test('projection remplace la partie écoulée sans ajouter les activités',()=>{
 const s=snapshot(undefined,16,125),d=day();d.activities=[{kcal:500,state:'done'}];d.walkingKcal=150;
 const p=run(s,{day:d});assert.equal(p.observed,2000);assert.equal(p.remaining,800);assert.equal(p.expense,2800);assert.equal(p.status,'projected');
});
test('le total incomplet à midi ne devient pas le total de la journée',()=>{
 const s=snapshot(undefined,12);const p=run(s,{now:Date.parse(s.capturedAt)});assert.equal(p.observed,1200);assert.equal(p.expense,2400);
});
test('trous, retard et absence de données conservent la référence',()=>{
 const s=snapshot();s.bins[0].total=null;s.bins[0].covered=0;assert.equal(run(s).status,'reference');assert.equal(run(s).expense,2400);
 assert.equal(run(snapshot(),{now:Date.parse('2026-09-15T20:00:00Z')}).status,'reference');assert.equal(run(null).expense,2400);
});
test('sans historique suffisant ou avec une autre source on garde le maintien',()=>{
 assert.equal(run(snapshot(),{history:[]}).status,'reference');const other=history().map(s=>({...s,source:'other'}));assert.equal(run(snapshot(),{history:other}).historyCount,0);
});
test('les totaux grossiers ne simulent pas une mesure horaire',()=>{
 const s=snapshot();s.bins.forEach(b=>b.maxRecordSeconds=86400);assert.equal(run(s).status,'reference');
 const full=snapshot('2026-09-14',24);full.bins.forEach(b=>b.maxRecordSeconds=86400);const p=run(full,{date:full.day});assert.equal(p.status,'complete');assert.equal(p.expense,2400);
});
test('une saisie manuelle complète reste prioritaire, y compris zéro',()=>{
 assert.equal(run(snapshot(),{day:{...day(),total:3000}}).expense,3000);assert.equal(run(snapshot(),{day:{...day(),total:0}}).expense,0);
});
test('les données malformées ou une couverture inventée sont rejetées',()=>{
 const s=snapshot();s.bins[0].covered=4000;assert.throws(()=>H.validateSnapshot(s));s.bins[0].covered=0;assert.throws(()=>H.validateSnapshot(s));
});
test('jours de changement d’heure : 23 h et 25 h sont valides',()=>{
 for(const n of [23,25]){const s=snapshot('2026-03-29',n);s.end=s.capturedAt;assert.doesNotThrow(()=>H.validateSnapshot(s));assert.equal(H.complete(s),true);}
});
test('le mode adaptatif est daté et reste optionnel pour les anciens profils',()=>{
 const profile={...M.blankProfile(),goals:{'2026-09-14':{plannedIntake:2100,maintenance:2400,base:null,target:300},'2026-09-15':{plannedIntake:2100,maintenance:2400,base:null,target:300,adaptive:true}}};const p=M.validateProfile(profile);
 assert.equal(M.goalsAt(p,'2026-09-14').adaptive,false);assert.equal(M.goalsAt(p,'2026-09-15').adaptive,true);
});
test('validation serveur : date, répétition et captures futures sont refusées',async()=>{
 const {validateUpload}=await import('../supabase/functions/health-bridge/validation.js');const s=snapshot();const now=Date.parse(s.capturedAt);
 assert.equal(validateUpload({snapshots:[s]},now).length,1);assert.throws(()=>validateUpload({snapshots:[s,s]},now));assert.throws(()=>validateUpload({snapshots:[{...s,day:'2026-09-14'}]},now));assert.throws(()=>validateUpload({snapshots:[s]},now-3600000));
});

const test=require('node:test'),assert=require('node:assert/strict'),M=require('../model.js'),S=require('../session-model.js'),B=require('../balance-model.js'),Sync=require('../sync-model.js');
const session=(source,start,end,activeKcal,extra={})=>({id:source,clientId:null,source,start:`2026-01-12T${start}:00Z`,end:`2026-01-12T${end}:00Z`,modifiedAt:'2026-01-12T20:00:00Z',type:79,kind:'walking',title:'',activeKcal,...extra});
const fit=session('com.google.android.apps.fitness','17:00','18:30',240),watch=session('test.watch','17:30','18:10',240,{type:0,kind:'other'});
test('plage Fit englobante : la même énergie ne déborde plus autour de la séance montre',()=>{
 const groups=S.dedupe([fit,watch]);const result=S.energySummary(groups,1800);
 assert.equal(result.kcal,240);assert.equal(result.count,1);assert.equal(result.excludedCount,1);assert.equal(groups.length,2);
 assert.equal(S.excludedEnergy(groups,1800).get(S.key(groups.find(s=>s.source===fit.source)))[0],'test.watch');
});
test('marche Fit séparée et séance de montre inconnue ne sont pas effacées',()=>{
 assert.equal(S.energySummary(S.dedupe([{...fit,start:'2026-01-12T15:00:00Z',end:'2026-01-12T16:00:00Z'},watch]),1800).kcal,480);
 assert.equal(S.energySummary(S.dedupe([fit,{...watch,activeKcal:null}]),1800).excludedCount,0);
});
test('chevauchement partiel bref : aucune exclusion complète d’une séance Fit',()=>{
 const groups=S.dedupe([fit,{...watch,start:'2026-01-12T18:20:00Z',end:'2026-01-12T19:00:00Z'}]);assert.equal(S.energySummary(groups,1800).excludedCount,0);
});
const day={...M.blankDay(),maintenance:2500,includedActivity:300,target:300,plannedIntake:2200,adaptive:true};
test('seul le dépassement de l’enveloppe entre dans la dépense',()=>{
 for(const [kcal,expense,extra] of [[0,2500,0],[200,2500,0],[300,2500,0],[460,2660,160]]){const e=B.expenditure(day,{kcal});assert.equal(e.expense,expense);assert.equal(e.excess,extra);assert.equal(e.adjustment,extra);}
 assert.equal(B.expenditure(day,{kcal:null}).expense,2500);assert.equal(B.expenditure(day,{kcal:null}).excess,null);
});
test('totaux manuels ou fiables remplacent l’estimation et ne reçoivent pas le supplément',()=>{
 const a={kcal:460};assert.equal(B.expenditure({...day,total:2700},a).expense,2700);
 for(const status of ['complete','projected']){const e=B.expenditure(day,a,{status,expense:2750});assert.equal(e.expense,2750);assert.equal(e.adjustment,250);assert.equal(e.excess,160);}
});
test('repère absent et mode fixe conservent le maintien',()=>{
 assert.equal(B.expenditure({...day,includedActivity:null},{kcal:460}).expense,2500);
 assert.equal(B.expenditure({...day,adaptive:false},{kcal:460}).expense,2500);
});
test('activité incluse datée : le passé ne reçoit pas le nouveau supplément',()=>{
 const goals={base:null,plannedIntake:2200,target:300,maintenance:2500,adaptive:true};const profile=M.validateProfile({goals:{'2026-01-11':goals,'2026-01-12':{...goals,includedActivity:300}},weights:{}});
 assert.equal(B.expenditure(M.effectiveDay(null,profile,'2026-01-11'),{kcal:460}).expense,2500);
 assert.equal(B.expenditure(M.effectiveDay(null,profile,'2026-01-12'),{kcal:460}).expense,2660);
 for(const includedActivity of [-1,2600,'300'])assert.throws(()=>M.validateProfile({goals:{'2026-01-12':{...goals,includedActivity}},weights:{}}));
});
test('le repère est synchronisé avec la référence de dépense sans perdre une autre modification',()=>{
 const base=M.validateProfile({goals:{'2026-01-12':{plannedIntake:2200,target:300,base:null,maintenance:2500,adaptive:true}},weights:{}}),local=structuredClone(base),remote=structuredClone(base);
 local.goals['2026-01-12'].includedActivity=300;remote.weights['2026-01-12']=80;
 const r=Sync.mergeProfile(base,local,remote);assert.equal(r.conflicts.length,0);assert.equal(r.profile.goals['2026-01-12'].includedActivity,300);assert.equal(r.profile.weights['2026-01-12'],80);
});

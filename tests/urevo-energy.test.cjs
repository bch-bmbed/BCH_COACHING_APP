const test=require('node:test'),assert=require('node:assert/strict'),S=require('../session-model.js'),B=require('../balance-model.js');
const session=(source='com.urevo.app',extra={})=>({id:source,clientId:null,source,start:'2026-01-12T10:00:00Z',end:'2026-01-12T11:00:00Z',modifiedAt:'2026-01-12T12:00:00Z',type:79,kind:'walking',title:'Marche de test',activeKcal:null,totalKcal:123.4,...extra});
test('Urevo conserve le chiffre reçu, sans repos ni modification de la source',()=>{
 const s=session(),before=structuredClone(s);
 for(const resting of [null,1800,2400]){const e=S.energy(s,resting);assert.equal(e.kcal,123.4);assert.equal(e.basis,'source');assert.equal(e.estimated,false);}
 assert.deepEqual(s,before);
});
test('zéro Urevo explicite conservé, absence de calories reste inconnue',()=>{
 assert.equal(S.energy(session(undefined,{totalKcal:0}),null).kcal,0);
 assert.equal(S.energy(session(undefined,{totalKcal:null}),1800).kcal,null);
});
test('une copie de source différente ne double pas la valeur Urevo',()=>{
 const groups=S.dedupe([session(),session('com.google.android.apps.fitness',{totalKcal:123.4})]);
 const result=S.energySummary(groups,1800);assert.equal(result.kcal,123);assert.equal(result.count,1);assert.equal(result.unclassified,true);assert.equal(result.restAdjusted,false);
});
test('les calories actives directes gardent la priorité, y compris zéro',()=>{
 for(const activeKcal of [0,110]){
  const group=S.dedupe([session(),session('other.watch',{activeKcal})])[0],e=S.energy(group,1800);
  assert.equal(e.kcal,activeKcal);assert.equal(e.basis,'active');
 }
 assert.equal(S.energy(session('other.watch'),1800).basis,'derived');
});
test('chevauchement : un seul apport par créneau, priorité à la mesure active',()=>{
 const groups=S.dedupe([session(undefined,{totalKcal:120}),session('other.watch',{type:8,kind:'cycling',start:'2026-01-12T10:30:00Z',activeKcal:90})]);
 const result=S.energySummary(groups,1800);assert.equal(result.kcal,150);assert.equal(result.overlap,true);assert.equal(result.unclassified,true);
});
test('repère marche : durée et poids réels, hypothèse 4 km/h à plat explicite',()=>{
 const r=S.walkingReference(24,100,1800);
 assert.equal(r.speed,4);assert.equal(r.incline,0);assert.equal(r.grossLow,120);assert.equal(r.grossHigh,140);assert.equal(r.restKcal,30);
 assert.equal(r.activeLow,90);assert.equal(r.activeHigh,110);
 const longer=S.walkingReference(48,100,1800);assert.equal(longer.activeLow,180);assert.equal(longer.activeHigh,220);
});
test('repère inconnu sans poids ou métabolisme, valeurs invalides refusées',()=>{
 for(const args of [[24,null,1800],[24,100,null],[0,100,1800],[24,-1,1800],[24,100,Infinity]])assert.equal(S.walkingReference(...args),null);
});
test('le repère théorique ne remplace pas les calories source ni les données du journal',()=>{
 const day={activities:[{state:'done',kcal:123.4}],walkingKcal:null},before=structuredClone(day),groups=S.dedupe([session()]);
 S.walkingReference(60,100,1800);const result=B.activities(day,groups,1800);
 assert.equal(result.kcal,123);assert.equal(result.unclassified,true);assert.equal(result.manualCount,1);assert.deepEqual(day,before);
});

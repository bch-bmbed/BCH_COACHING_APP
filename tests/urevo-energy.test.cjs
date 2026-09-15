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
test('repère marche : distance et durée reçues, aucune allure fixe',()=>{
 const s=session(undefined,{end:'2026-01-12T10:24:00Z',distanceMeters:1600}),r=S.walkingReference(s,100,1800);
 assert.equal(r.speed,4);assert.equal(r.incline,0);assert.equal(r.met,3.5);assert.equal(r.grossKcal,140);assert.equal(r.restKcal,30);assert.equal(r.activeKcal,110);assert.equal(r.basis,'distance');
 const faster=S.walkingReference({...s,distanceMeters:2400},100,1800);assert.ok(Math.abs(faster.speed-6)<1e-10);assert.equal(faster.met,4.8);assert.equal(faster.activeKcal,162);
 const longer=S.walkingReference({...s,end:'2026-01-12T10:48:00Z',distanceMeters:3200},100,1800);assert.equal(longer.activeKcal,220);
});
test('repère inconnu sans poids ou métabolisme, valeurs invalides refusées',()=>{
 const s=session(undefined,{distanceMeters:4000});
 for(const args of [[s,null,1800],[s,100,null],[null,100,1800],[s,-1,1800],[s,100,Infinity]])assert.equal(S.walkingReference(...args),null);
});
test('le repère théorique ne remplace pas les calories source ni les données du journal',()=>{
 const day={activities:[{state:'done',kcal:123.4}],walkingKcal:null},before=structuredClone(day),groups=S.dedupe([session(undefined,{distanceMeters:4000})]),original=structuredClone(groups);
 assert.ok(S.walkingReference(groups[0],100,1800));const result=B.activities(day,groups,1800);
 assert.equal(result.kcal,123);assert.equal(result.unclassified,true);assert.equal(result.manualCount,1);assert.deepEqual(day,before);
 assert.deepEqual(groups,original);
});
test('distance complète prioritaire pour le repère, moyenne des points conservée à part',()=>{
 const s=session(undefined,{distanceMeters:4000,speedKmh:6,speedSamples:2}),r=S.walkingReference(s,100,1800);
 assert.equal(r.speed,4);assert.equal(r.met,3.5);assert.equal(r.basis,'distance');assert.equal(S.motion(s).speedKmh,6);
});
test('sans distance, la moyenne reçue peut alimenter une comparaison conditionnelle',()=>{
 const r=S.walkingReference(session(undefined,{speedKmh:5,speedSamples:3}),100,1800);
 assert.equal(r.speed,5);assert.equal(r.met,3.8);assert.equal(r.basis,'samples');assert.equal(r.samples,3);assert.equal(r.distanceMeters,null);
});
test('absence, zéro et allures hors domaine ne deviennent pas un scénario à 4 km/h',()=>{
 for(const extra of [{},{distanceMeters:0,speedKmh:4,speedSamples:5},{speedKmh:0,speedSamples:1},{distanceMeters:1800},{distanceMeters:9000},{kind:'running',distanceMeters:5000}])assert.equal(S.walkingReference(session(undefined,extra),100,1800),null);
});
test('tranches de marche sur tapis : limites arrondies au dixième, pas d’extrapolation',()=>{
 for(const [speedKmh,met] of [[1.9,2.8],[3.1,2.8],[3.2,3],[3.94,3],[3.96,3.5],[4.7,3.5],[4.8,3.8],[5.5,3.8],[5.6,4.8],[6.3,4.8],[6.4,5.8],[7.1,5.8],[7.2,6.8],[7.9,6.8],[8,8.3],[8.9,8.3]])assert.equal(S.walkingReference(session(undefined,{speedKmh,speedSamples:1}),100,1800).met,met);
});
test('copies : le repère garde distance et durée de la même source, pas celles du titre',()=>{
 const copies=[session(undefined,{title:'',end:'2026-01-12T10:24:00Z',distanceMeters:1600}),session('other.watch',{end:'2026-01-12T10:25:00Z',distanceMeters:2200})],group=S.dedupe(copies)[0];
 assert.equal(group.source,'other.watch');const r=S.walkingReference(group,100,1800);
 assert.equal(r.source,'com.urevo.app');assert.equal(r.minutes,24);assert.equal(r.speed,4);assert.equal(r.activeKcal,110);
});

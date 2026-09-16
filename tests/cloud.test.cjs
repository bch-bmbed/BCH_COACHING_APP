const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),M=require('../model.js'),S=require('../sync-model.js');
const date='2026-09-15';
class Element{constructor(){this.children=[];this.textContent='';this.hidden=false;}append(...nodes){this.children.push(...nodes);}replaceChildren(){this.children=[];}querySelector(){return new Element();}}
async function device(server){
  let state={version:3,days:{},profile:M.blankProfile()},base={},profileBase=null,draft=false;const nodes=new Map();
  const doc={hidden:false,getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement(){return new Element();},addEventListener(){},head:{append(node){doc.sdk=node;}}};
  const journal={snapshot:()=>structuredClone(state),base:()=>structuredClone(base),blocked:()=>false,hasDraft:()=>draft,saveDraft:()=>!draft,localData:()=>({version:3,days:{},profile:M.blankProfile()}),profile:()=>structuredClone(state.profile),profileBase:()=>structuredClone(profileBase),applyProfile(p,b){state.profile=structuredClone(p);profileBase=structuredClone(b);},activate:()=>true,apply(next,b){state=structuredClone(next);base=structuredClone(b);}};
  const client={auth:{onAuthStateChange(){},async getSession(){return {data:{session:{user:{id:'owner',email:'test@example.invalid'}}}};}},from(table){return {async maybeSingle(){return server.profileError?{error:server.profileError}:{data:structuredClone(server.profile||null)};},select(){return this;},eq(){return this;},order(){return this;},async range(){return {data:[...server.rows].map(([day,row])=>({day,...structuredClone(row)}))};}};},async rpc(_name,args){
    if(_name==='save_account_profile'){
      if(server.beforeProfileWrite)await server.beforeProfileWrite(args,journal);
      const revision=server.profile?.revision||0;
      if(revision!==args.p_expected_revision)return {data:{saved:false,revision,payload:server.profile?.payload||null}};
      server.profile={revision:revision+1,payload:structuredClone(args.p_payload)};return {data:{saved:true,...structuredClone(server.profile)}};
    }
    if(server.beforeWrite)await server.beforeWrite(args,journal);
    const existing=server.rows.get(args.p_day),revision=existing?.revision||0;
    if(revision!==args.p_expected_revision)return {data:{saved:false,revision,payload:existing?.payload||null}};
    const row={revision:revision+1,payload:structuredClone(args.p_payload)};server.rows.set(args.p_day,row);return {data:{saved:true,...structuredClone(row)}};
  }};
  const context={document:doc,navigator:{onLine:true},location:{origin:'https://example.invalid',pathname:'/'},setTimeout:()=>1,clearTimeout(){},setInterval(){},structuredClone,Map,Set,Date,FormData,console};
  context.window={EQUILIBRE_CONFIG:{supabaseUrl:'test',supabasePublishableKey:'public'},Journal:journal,Equilibre:M,EquilibreSync:S,supabase:{createClient:()=>client},addEventListener(){}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../cloud.js'),'utf8'),context);await doc.sdk.onload();
  return {sync:()=>doc.getElementById('sync-now').onclick(),edit(fn){const d=state.days[date]||M.blankDay();fn(d);d.intake=M.mealSummary(d).total;state.days[date]=d;},editProfile(fn){fn(state.profile);state.profile=M.validateProfile(state.profile);},snapshot:()=>state,base:()=>base,status:()=>doc.getElementById('sync-state').textContent,context,setDraft:v=>{draft=v;}};
}
test('deux appareils partagent les repas et les activités sans écrasement',async()=>{
  const server={rows:new Map()},pc=await device(server),phone=await device(server);
  pc.edit(d=>d.meals.lunch.kcal=650);await pc.sync();await phone.sync();
  phone.edit(d=>d.activities.push({id:'walk',name:'Marche',minutes:30,kcal:150,state:'done',source:'manual'}));
  pc.edit(d=>d.meals.dinner.kcal=700);await pc.sync();await phone.sync();await pc.sync();
  assert.equal(pc.snapshot().days[date].intake,1350);assert.equal(phone.snapshot().days[date].activities.length,1);assert.deepEqual(pc.snapshot(),phone.snapshot());assert.equal(pc.status(),'Synchronisé');
});
test('les pas et les calories de marche se synchronisent sans créer de séance',async()=>{
  const server={rows:new Map()},pc=await device(server),phone=await device(server);
  pc.edit(d=>d.steps=9100);phone.edit(d=>d.walkingKcal=240);
  await pc.sync();await phone.sync();await pc.sync();
  assert.equal(pc.snapshot().days[date].steps,9100);assert.equal(phone.snapshot().days[date].walkingKcal,240);assert.equal(pc.snapshot().days[date].activities.length,0);assert.deepEqual(pc.snapshot(),phone.snapshot());
});
test('une modification de version entre lecture et écriture est fusionnée',async()=>{
  const server={rows:new Map()},pc=await device(server);pc.edit(d=>d.meals.lunch.kcal=650);
  server.beforeWrite=async()=>{server.beforeWrite=null;const d=M.blankDay();d.meals.breakfast.kcal=400;d.intake=400;server.rows.set(date,{revision:1,payload:d});};
  await pc.sync();assert.equal(server.rows.get(date).payload.intake,1050);assert.equal(pc.status(),'Synchronisé');
});
test('un conflit sur le même repas bloque son écrasement',async()=>{
  const server={rows:new Map()},pc=await device(server),phone=await device(server);
  pc.edit(d=>d.meals.lunch.kcal=600);phone.edit(d=>d.meals.lunch.kcal=700);
  await pc.sync();await phone.sync();assert.equal(server.rows.get(date).payload.intake,600);assert.equal(phone.snapshot().days[date].intake,700);assert.equal(phone.status(),'Choix nécessaire');
});
test('la saisie pendant une requête reste intacte',async()=>{
  const server={rows:new Map()},pc=await device(server);pc.edit(d=>d.meals.lunch.kcal=600);
  server.beforeWrite=async()=>{server.beforeWrite=null;pc.edit(d=>d.meals.lunch.kcal=700);};
  await pc.sync();assert.equal(pc.snapshot().days[date].intake,700);assert.equal(pc.status(),'À synchroniser');
});
test('hors ligne, aucune donnée locale ni confirmation ne disparaît',async()=>{
  const server={rows:new Map()},pc=await device(server);pc.edit(d=>d.meals.lunch.kcal=600);pc.context.navigator.onLine=false;
  await pc.sync();assert.equal(server.rows.size,0);assert.equal(pc.snapshot().days[date].intake,600);assert.equal(pc.status(),'Hors ligne');
});

const goals=base=>({plannedIntake:1800,base,target:400});
test('le profil et les pesées se synchronisent même sans journée enregistrée',async()=>{
  const server={rows:new Map()},pc=await device(server),phone=await device(server);
  pc.editProfile(p=>{p.goals[date]=goals(2200);p.resting=1760;});await pc.sync();await phone.sync();
  phone.editProfile(p=>p.weights[date]=79.5);pc.editProfile(p=>p.goals[date].target=500);
  await phone.sync();await pc.sync();await phone.sync();
  assert.deepEqual(pc.snapshot().profile,phone.snapshot().profile);assert.equal(pc.snapshot().profile.weights[date],79.5);assert.equal(phone.snapshot().profile.resting,1760);assert.equal(server.rows.size,0);assert.equal(pc.status(),'Synchronisé');
});
test('une révision concurrente du profil est fusionnée et une seconde synchronisation est idempotente',async()=>{
  const server={rows:new Map()},pc=await device(server);pc.editProfile(p=>p.goals[date]=goals(2200));
  server.beforeProfileWrite=async()=>{server.beforeProfileWrite=null;server.profile={revision:1,payload:{goals:{},weights:{[date]:80}}};};
  await pc.sync();assert.equal(pc.snapshot().profile.weights[date],80);assert.equal(pc.status(),'Synchronisé');
  const revision=server.profile.revision;await pc.sync();assert.equal(server.profile.revision,revision);
});
test('un conflit sur le profil conserve les deux valeurs et suspend les écritures du journal',async()=>{
  const server={rows:new Map()},pc=await device(server),phone=await device(server);
  pc.editProfile(p=>p.goals[date]=goals(2200));phone.editProfile(p=>p.goals[date]=goals(2400));phone.edit(d=>d.meals.lunch.kcal=600);
  await pc.sync();await phone.sync();assert.equal(phone.status(),'Choix nécessaire');assert.equal(phone.snapshot().profile.goals[date].base,2400);assert.equal(server.profile.payload.goals[date].base,2200);assert.equal(server.rows.size,0);
});
test('un profil édité pendant une requête reste local jusqu’à la prochaine synchronisation',async()=>{
  const server={rows:new Map()},pc=await device(server);pc.editProfile(p=>p.goals[date]=goals(2200));
  server.beforeProfileWrite=async()=>{server.beforeProfileWrite=null;pc.editProfile(p=>p.goals[date].base=2400);};
  await pc.sync();assert.equal(pc.snapshot().profile.goals[date].base,2400);assert.equal(pc.status(),'À synchroniser');
  await pc.sync();assert.equal(server.profile.payload.goals[date].base,2400);assert.equal(pc.status(),'Synchronisé');
});
test('une erreur serveur du profil ne confirme pas une synchronisation et conserve les saisies',async()=>{
  const server={rows:new Map(),profileError:{message:'Indisponible'}},pc=await device(server);pc.editProfile(p=>p.weights[date]=80);
  await pc.sync();assert.equal(pc.status(),'Non synchronisé');assert.equal(pc.snapshot().profile.weights[date],80);assert.equal(server.rows.size,0);
});

test('un maintien de compte passe du PC au téléphone sans doubler une activité',async()=>{
  const server={rows:new Map()},pc=await device(server),phone=await device(server);
  pc.editProfile(p=>p.goals[date]={plannedIntake:2400,base:null,target:350,maintenance:2750});await pc.sync();await phone.sync();
  phone.edit(d=>{d.meals.lunch.kcal=2400;d.activities.push({id:'a',name:'Sport',minutes:40,kcal:350,state:'done',source:'manual'});});await phone.sync();await pc.sync();
  assert.deepEqual(pc.snapshot(),phone.snapshot());assert.equal(M.balance(M.effectiveDay(pc.snapshot().days[date],pc.snapshot().profile,date)).actual,350);
});

test('passage daté à la base hors sport : les appareils gardent le passé et leurs repas',async()=>{
 const initial=M.validateProfile({goals:{[date]:{base:null,maintenance:2700,plannedIntake:2450,target:250,adaptive:true,includedActivity:300}},weights:{},resting:1800});
 const server={rows:new Map(),profile:{revision:1,payload:initial}},pc=await device(server),phone=await device(server);
 pc.editProfile(p=>p.goals['2026-09-16']={base:2400,maintenance:null,plannedIntake:2150,target:250,adaptive:false,includedActivity:null});
 phone.edit(d=>d.meals.lunch.kcal=650);
 await pc.sync();await phone.sync();await pc.sync();
 assert.deepEqual(pc.snapshot(),phone.snapshot());assert.equal(pc.snapshot().days[date].intake,650);
 assert.equal(M.goalsAt(pc.snapshot().profile,date).maintenance,2700);
 assert.equal(M.goalsAt(pc.snapshot().profile,'2026-09-16').base,2400);
 assert.equal(M.goalsAt(pc.snapshot().profile,'2026-09-16').includedActivity,null);
});

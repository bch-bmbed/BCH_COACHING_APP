const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),M=require('../model.js'),S=require('../sync-model.js');
const date='2026-09-15';
class Element{constructor(){this.children=[];this.textContent='';this.hidden=false;}append(...nodes){this.children.push(...nodes);}replaceChildren(){this.children=[];}querySelector(){return new Element();}}
async function device(server){
  let state={version:2,days:{}},base={},draft=false;const nodes=new Map();
  const doc={hidden:false,getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement(){return new Element();},addEventListener(){},head:{append(node){doc.sdk=node;}}};
  const journal={snapshot:()=>structuredClone(state),base:()=>structuredClone(base),blocked:()=>false,hasDraft:()=>draft,saveDraft:()=>!draft,localData:()=>({version:2,days:{}}),activate:()=>true,apply(next,b){state=structuredClone(next);base=structuredClone(b);}};
  const client={auth:{onAuthStateChange(){},async getSession(){return {data:{session:{user:{id:'owner',email:'test@example.invalid'}}}};}},from(){return {select(){return this;},eq(){return this;},order(){return this;},async range(){return {data:[...server.rows].map(([day,row])=>({day,...structuredClone(row)}))};}};},async rpc(_name,args){
    if(server.beforeWrite)await server.beforeWrite(args,journal);
    const existing=server.rows.get(args.p_day),revision=existing?.revision||0;
    if(revision!==args.p_expected_revision)return {data:{saved:false,revision,payload:existing?.payload||null}};
    const row={revision:revision+1,payload:structuredClone(args.p_payload)};server.rows.set(args.p_day,row);return {data:{saved:true,...structuredClone(row)}};
  }};
  const context={document:doc,navigator:{onLine:true},location:{origin:'https://example.invalid',pathname:'/'},setTimeout:()=>1,clearTimeout(){},setInterval(){},structuredClone,Map,Set,Date,FormData,console};
  context.window={EQUILIBRE_CONFIG:{supabaseUrl:'test',supabasePublishableKey:'public'},Journal:journal,Equilibre:M,EquilibreSync:S,supabase:{createClient:()=>client},addEventListener(){}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../cloud.js'),'utf8'),context);await doc.sdk.onload();
  return {sync:()=>doc.getElementById('sync-now').onclick(),edit(fn){const d=state.days[date]||M.blankDay();fn(d);d.intake=M.mealSummary(d).total;state.days[date]=d;},snapshot:()=>state,base:()=>base,status:()=>doc.getElementById('sync-state').textContent,context,setDraft:v=>{draft=v;}};
}
test('deux appareils partagent les repas et les activités sans écrasement',async()=>{
  const server={rows:new Map()},pc=await device(server),phone=await device(server);
  pc.edit(d=>d.meals.lunch.kcal=650);await pc.sync();await phone.sync();
  phone.edit(d=>d.activities.push({id:'walk',name:'Marche',minutes:30,kcal:150,state:'done',source:'manual'}));
  pc.edit(d=>d.meals.dinner.kcal=700);await pc.sync();await phone.sync();await pc.sync();
  assert.equal(pc.snapshot().days[date].intake,1350);assert.equal(phone.snapshot().days[date].activities.length,1);assert.deepEqual(pc.snapshot(),phone.snapshot());assert.equal(pc.status(),'Synchronisé');
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

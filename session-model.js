(function(root){
  'use strict';
  const stamp=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
  const text=(s,n)=>typeof s==='string'&&s.length>0&&s.length<=n;
  const labels={walking:'Marche',running:'Course',cycling:'Vélo',swimming:'Natation',strength:'Renforcement',rowing:'Rameur',elliptical:'Elliptique',yoga:'Yoga',pilates:'Pilates',hiking:'Randonnée',other:'Activité sportive'};
  function validate(raw){
    if(!raw||!text(raw.id,200)||!text(raw.source,200)||!stamp(raw.start)||!stamp(raw.end)||!stamp(raw.modifiedAt)||!Number.isInteger(raw.type)||raw.type<0||raw.type>10000||!Object.hasOwn(labels,raw.kind)||typeof raw.title!=='string'||raw.title.length>160||!(raw.clientId===null||text(raw.clientId,200))||!(raw.activeKcal===null||(Number.isFinite(raw.activeKcal)&&raw.activeKcal>=0&&raw.activeKcal<=30000)))throw Error('Séance importée invalide.');
    if(Date.parse(raw.end)<=Date.parse(raw.start)||Date.parse(raw.end)-Date.parse(raw.start)>7*86400000)throw Error('Durée de séance invalide.');
    if(raw.totalKcal!==undefined&&raw.totalKcal!==null&&(!Number.isFinite(raw.totalKcal)||raw.totalKcal<0||raw.totalKcal>30000))throw Error('Calories totales de séance invalides.');
    return {...Object.fromEntries(['id','clientId','source','start','end','modifiedAt','type','kind','title','activeKcal'].map(k=>[k,raw[k]])),totalKcal:raw.totalKcal??null};
  }
  const key=s=>s.source+'|'+(s.clientId||s.id);
  function sameWindow(a,b){
    const a0=Date.parse(a.start),a1=Date.parse(a.end),b0=Date.parse(b.start),b1=Date.parse(b.end),long=Math.max(a1-a0,b1-b0),overlap=Math.max(0,Math.min(a1,b1)-Math.max(a0,b0));
    const tolerance=Math.min(300000,Math.max(60000,long*.1));
    return overlap/long>=.85&&Math.abs(a0-b0)<=tolerance&&Math.abs(a1-b1)<=tolerance;
  }
  function copies(a,b){return a.source!==b.source&&sameWindow(a,b)&&(a.type===b.type||(a.kind===b.kind&&a.kind!=='other'));}
  function dedupe(rows){
    const latest=new Map();
    for(const raw of rows){const s=validate(raw),k=key(s),old=latest.get(k);if(!old||Date.parse(s.modifiedAt)>Date.parse(old.modifiedAt)||(s.modifiedAt===old.modifiedAt&&s.id<old.id))latest.set(k,s);}
    const groups=[];
    // Every member must match: a chain of near matches must not merge two workouts.
    for(const s of [...latest.values()].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)||key(a).localeCompare(key(b)))){
      const g=groups.find(g=>g.every(other=>copies(s,other)));if(g)g.push(s);else groups.push([s]);
    }
    return groups.map(members=>{
      const ordered=[...members].sort((a,b)=>Number(Boolean(b.title))-Number(Boolean(a.title))||Number(b.activeKcal!==null)-Number(a.activeKcal!==null)||key(a).localeCompare(key(b))),representative=ordered[0];
      return {...representative,title:representative.title||labels[representative.kind],activeKcal:ordered.find(s=>s.activeKcal!==null)?.activeKcal??null,members,sources:[...new Set(members.map(s=>s.source))],copies:members.length-1,ambiguous:groups.some(other=>other!==members&&other.some(a=>members.some(b=>a.source!==b.source&&sameWindow(a,b))))};
    });
  }
  function energy(session,resting){
    const members=session.members||[session],direct=members.find(s=>s.activeKcal!==null&&s.activeKcal!==undefined);
    if(direct)return {kcal:direct.activeKcal,estimated:false,start:direct.start,end:direct.end};
    const gross=members.find(s=>s.totalKcal!==null&&s.totalKcal!==undefined);
    if(gross&&Number.isFinite(resting)&&resting>0)return {kcal:Math.max(0,gross.totalKcal-resting*(Date.parse(gross.end)-Date.parse(gross.start))/86400000),estimated:true,start:gross.start,end:gross.end};
    return {kcal:null,estimated:false,start:session.start,end:session.end};
  }
  function energySummary(sessions,resting){
    const values=sessions.map(s=>({...energy(s,resting),key:key(s)})),known=values.filter(v=>v.kcal!==null),boundaries=[...new Set(known.flatMap(v=>[Date.parse(v.start),Date.parse(v.end)]))].sort((a,b)=>a-b);
    let total=0,overlap=false;
    for(let i=1;i<boundaries.length;i++){
      const a=boundaries[i-1],b=boundaries[i],cover=known.filter(v=>Date.parse(v.start)<=a&&Date.parse(v.end)>=b).sort((x,y)=>Number(x.estimated)-Number(y.estimated)||(Date.parse(x.end)-Date.parse(x.start))-(Date.parse(y.end)-Date.parse(y.start))||x.key.localeCompare(y.key));
      if(cover.length>1)overlap=true;
      if(cover.length)total+=cover[0].kcal*(b-a)/(Date.parse(cover[0].end)-Date.parse(cover[0].start));
    }
    return {kcal:known.length?Math.round(total):sessions.length?null:0,count:sessions.length,missing:values.length-known.length,estimated:known.some(v=>v.estimated)||overlap,overlap};
  }
  const api={validate,dedupe,labels,energy,energySummary};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EquilibreSessions=api;
})(typeof globalThis!=='undefined'?globalThis:this);

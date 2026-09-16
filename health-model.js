(function(root){
  'use strict';
  const S=typeof module!=='undefined'&&module.exports?require('./session-model.js'):root.EquilibreSessions;
  const stamp=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
  function validateSnapshot(raw){
    if(!raw||![1,2].includes(raw.version)||!/^\d{4}-\d{2}-\d{2}$/.test(raw.day)||typeof raw.source!=='string'||!raw.source||raw.source.length>200||!stamp(raw.capturedAt)||!stamp(raw.start)||!stamp(raw.end)||!Array.isArray(raw.bins)||raw.bins.length>25)throw Error('Données Santé Connect invalides.');
    try{new Intl.DateTimeFormat('fr-FR',{timeZone:raw.zone}).format();}catch{throw Error('Fuseau Santé Connect invalide.');}
    const start=Date.parse(raw.start),end=Date.parse(raw.end),captured=Date.parse(raw.capturedAt);
    if(end-start<23*3600000||end-start>25*3600000||captured<start)throw Error('Période Santé Connect invalide.');
    let previous=start;
    const bins=raw.bins.map(b=>{
      const a=Date.parse(b.start),z=Date.parse(b.end),seconds=(z-a)/1000;
      if(!stamp(b.start)||!stamp(b.end)||a!==previous||z<=a||z>end||z>captured+1000||seconds>3600.01||!Number.isFinite(b.covered)||b.covered<0||b.covered>seconds+1||!(b.total===null||(Number.isFinite(b.total)&&b.total>=0&&b.total<=10000))||!Number.isFinite(b.maxRecordSeconds)||b.maxRecordSeconds<0)throw Error('Intervalle Santé Connect invalide.');
      if(b.covered===0&&b.total!==null)throw Error('Une absence de données ne vaut pas zéro.');
      previous=z;return {start:b.start,end:b.end,total:b.total,covered:b.covered,maxRecordSeconds:b.maxRecordSeconds};
    });
    if(raw.steps!==null&&(!Number.isInteger(raw.steps)||raw.steps<0||raw.steps>200000))throw Error('Pas Santé Connect invalides.');
    const result={version:raw.version,day:raw.day,source:raw.source,zone:raw.zone,capturedAt:raw.capturedAt,start:raw.start,end:raw.end,bins,steps:raw.steps};
    if(raw.version===2){
      if(raw.bridgeVersion!==undefined&&(!Number.isInteger(raw.bridgeVersion)||raw.bridgeVersion<1||raw.bridgeVersion>1000000))throw Error('Version de passerelle invalide.');
      if(raw.bridgeVersion!==undefined)result.bridgeVersion=raw.bridgeVersion;
      if(raw.source!=='health-connect'||!Array.isArray(raw.sources)||raw.sources.length>100||raw.sources.some(s=>typeof s!=='string'||!s||s.length>200)||!Array.isArray(raw.sessions)||raw.sessions.length>500||!raw.permissions||['sessions','activeCalories','steps','total'].some(k=>typeof raw.permissions[k]!=='boolean'))throw Error('Import multisource invalide.');
      result.sources=[...new Set(raw.sources)].sort();result.permissions=Object.fromEntries(['sessions','activeCalories','steps','total'].map(k=>[k,raw.permissions[k]]));
      for(const key of ['distance','speed'])if(raw.permissions[key]!==undefined){if(typeof raw.permissions[key]!=='boolean')throw Error('Autorisation de mouvement invalide.');result.permissions[key]=raw.permissions[key];}
      result.sessions=raw.sessions.map(s=>{const clean=S.validate(s);if(Date.parse(s.start)<start||Date.parse(s.start)>=end||Date.parse(s.end)>captured+300000)throw Error('Séance hors période.');return clean;});
      if(raw.movement!==undefined){
        const m=raw.movement;if(!m||m.version!==1||!Array.isArray(m.bins)||m.bins.length>1500)throw Error('Détail des pas invalide.');let last=start;
        result.movement={version:1,bins:m.bins.map(b=>{const a=Date.parse(b.start),z=Date.parse(b.end);if(!stamp(b.start)||!stamp(b.end)||a<last||z<=a||z>end||z>captured+1000||z-a>60001||!Number.isInteger(b.steps)||b.steps<0||b.steps>400||!Number.isFinite(b.precisionSeconds)||b.precisionSeconds<0||b.precisionSeconds>7*86400||!Array.isArray(b.sources)||b.sources.length>100||b.sources.some(s=>typeof s!=='string'||!s||s.length>200))throw Error('Créneau de marche invalide.');
          for(const [field,max] of [['distanceMeters',1000],['activeKcal',100]])if(!(b[field]===null||Number.isFinite(b[field])&&b[field]>=0&&b[field]<=max))throw Error('Mesure de marche invalide.');last=z;return {start:b.start,end:b.end,steps:b.steps,precisionSeconds:b.precisionSeconds,sources:[...new Set(b.sources)].sort(),distanceMeters:b.distanceMeters,activeKcal:b.activeKcal};})};
      }
    }return result;
  }
  const total=s=>s.bins.reduce((n,b)=>n+(b.total??0),0);
  const covered=b=>b.total!==null&&b.covered>=((Date.parse(b.end)-Date.parse(b.start))/1000)-1;
  function complete(s){return s.bins.length>0&&s.bins.at(-1).end===s.end&&s.bins.every(covered);}
  function clockMinute(iso,zone){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));return Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);}
  function fractionAt(s,minute){
    // Compare local clock time, not elapsed UTC hours (DST days can have 23/25 hours).
    let before=0;
    for(const b of s.bins){const m=clockMinute(b.start,s.zone),duration=(Date.parse(b.end)-Date.parse(b.start))/60000;before+=b.total*Math.max(0,Math.min(1,(minute-m)/duration));}
    return total(s)>0?Math.min(1,before/total(s)):null;
  }
  function project({day,date,today,snapshot,history=[],now=Date.now()}){
    const reference=day.maintenance??null;
    const out={expense:reference,observed:null,remaining:null,through:null,capturedAt:null,steps:null,status:'reference',reason:'En attente de données Santé Connect.',historyCount:0};
    if(day.total!==null)return {...out,expense:day.total,status:'manual',reason:'Total quotidien saisi manuellement.'};
    if(!snapshot||snapshot.day!==date)return out;
    const s=validateSnapshot(snapshot);out.capturedAt=s.capturedAt;out.steps=s.steps;
    const filled=s.bins.filter(b=>b.total!==null);
    if(!filled.length)return {...out,reason:'La source ne fournit pas de calories totales pour cette journée.'};
    out.observed=Math.round(total(s));out.through=filled.at(-1).end;
    if(day.resting&&out.observed<day.resting*(Date.parse(out.through)-Date.parse(s.start))/(Date.parse(s.end)-Date.parse(s.start))*.7)return {...out,reason:'Total reçu trop faible pour inclure le repos : maintien conservé.'};
    if(complete(s)&&date<today)return {...out,expense:out.observed,remaining:0,status:'complete',reason:'Total de la journée complète, repos et activité inclus.'};
    if(date!==today)return {...out,reason:'Journée incomplète : maintien conservé.'};
    if(now-Date.parse(s.capturedAt)>2*3600000||now-Date.parse(out.through)>2*3600000)return {...out,reason:'Données anciennes (plus de 2 h) : maintien conservé.'};
    const used=s.bins.filter(b=>Date.parse(b.start)<Date.parse(out.through));
    if(!used.every(covered))return {...out,reason:'Des périodes ne sont pas couvertes : maintien conservé.'};
    if(used.some(b=>b.maxRecordSeconds>5400))return {...out,reason:'La source fournit des totaux trop espacés pour une projection horaire.'};
    if(reference===null)return {...out,reason:'Renseigne ton maintien moyen dans Compte.'};
    const prior=history.filter(h=>h.day<date&&h.day>=new Date(Date.parse(date+'T12:00:00Z')-28*86400000).toISOString().slice(0,10)&&h.source===s.source&&h.zone===s.zone&&complete(h)&&h.bins.every(b=>b.maxRecordSeconds<=5400)&&total(h)>0).sort((a,b)=>b.day.localeCompare(a.day)).slice(0,14);
    out.historyCount=prior.length;
    if(prior.length<3)return {...out,reason:`Apprentissage des horaires : ${prior.length}/3 journées complètes disponibles. Maintien conservé.`};
    const minute=clockMinute(out.through,s.zone),fractions=prior.map(h=>fractionAt(h,minute)).sort((a,b)=>a-b),fraction=fractions[Math.floor(fractions.length/2)];
    const remaining=Math.round(reference*(1-fraction));
    return {...out,remaining,expense:out.observed+remaining,status:'projected',reason:`Reste du jour estimé selon les horaires de ${prior.length} journées complètes. Les séances du journal ne sont pas ajoutées au total.`};
  }
  function automatic(snapshots){
    const groups=new Map();for(const s of snapshots){if(!groups.has(s.day))groups.set(s.day,[]);groups.get(s.day).push(s);}
    // Legacy imports cannot safely be added together. Until the companion updates,
    // choose the best-covered existing total automatically, one per date.
    return [...groups.values()].map(rows=>rows.filter(s=>s.version===2).sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt))[0]||rows.sort((a,b)=>Number(complete(b))-Number(complete(a))||b.bins.reduce((n,x)=>n+x.covered,0)-a.bins.reduce((n,x)=>n+x.covered,0)||total(b)-total(a)||a.source.localeCompare(b.source))[0]);
  }
  const api={validateSnapshot,project,complete,total,automatic};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EquilibreHealth=api;
})(typeof globalThis!=='undefined'?globalThis:this);

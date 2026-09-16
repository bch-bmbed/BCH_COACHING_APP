(function(root){
  'use strict';
  const S=typeof module!=='undefined'&&module.exports?require('./session-model.js'):root.EquilibreSessions;
  const types={desk:'Travail principalement assis',standing:'Travail principalement debout',mobile:'Travail avec marche fréquente',physical:'Travail physique'};
  const defaults=()=>({version:1,type:'desk',workDays:[1,2,3,4,5],periods:[[540,720],[840,1080]],workMet:1.3,offBase:null,minWalkMinutes:10});
  function validate(raw){
    if(raw===undefined||raw===null)return null;
    if(raw.version!==1||!Object.hasOwn(types,raw.type)||!Array.isArray(raw.workDays)||raw.workDays.some(d=>!Number.isInteger(d)||d<0||d>6)||new Set(raw.workDays).size!==raw.workDays.length||!Array.isArray(raw.periods)||raw.periods.length>2||!Number.isFinite(raw.workMet)||raw.workMet<1||raw.workMet>6||!(raw.offBase===null||Number.isFinite(raw.offBase)&&raw.offBase>=0&&raw.offBase<=30000)||!Number.isInteger(raw.minWalkMinutes)||raw.minWalkMinutes<5||raw.minWalkMinutes>30)throw Error('Profil de journée invalide.');
    let end=-1;for(const p of raw.periods){if(!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isInteger(n)||n<0||n>1440)||p[1]<=p[0]||p[0]<end)throw Error('Horaires invalides : utilise deux plages successives, sans chevauchement.');end=p[1];}
    return {version:1,type:raw.type,workDays:[...raw.workDays].sort(),periods:raw.periods.map(p=>[...p]),workMet:raw.workMet,offBase:raw.offBase,minWalkMinutes:raw.minWalkMinutes};
  }
  const workDay=(settings,date,choice='auto')=>choice==='work'||choice!=='off'&&settings.workDays.includes(new Date(date+'T12:00:00Z').getUTCDay());
  function inWork(iso,day,zone){
    const r=day.routine;if(!r||!workDay(r,day.routineDate,day.routineDay))return false;
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone||'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));
    const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));if(`${v.year}-${v.month}-${v.day}`!==day.routineDate)return false;
    const minute=Number(v.hour)*60+Number(v.minute);return r.periods.some(([a,b])=>minute>=a&&minute<b);
  }
  const overrideKey=(kind,s)=>`${kind}:${s.start}:${s.end}`;
  function baseline(a,b,day,weight,resting,zone){
    let value=0;for(let at=a;at<b;){const end=Math.min(b,at+60000),met=inWork(new Date((at+end)/2).toISOString(),day,zone)?day.routine.workMet:1.3;
      value+=Math.max(0,met*weight-(resting/24))*(end-at)/3600000;at=end;
    }return value;
  }
  function walkingMet(speed){
    if(speed===null)return 2.8; // Indicative slow walking only; never presented as measured speed.
    if(!Number.isFinite(speed)||speed<=0)return null;
    if(speed<3.2)return 2.3;if(speed<4)return 2.8;if(speed<4.5)return 3;if(speed<5.6)return 3.8;if(speed<=6.3)return 4.8;return null;
  }
  function detect(bins,minMinutes){
    const usable=bins.filter(b=>b.steps>0&&b.precisionSeconds<=120),groups=[];let group=[];
    const flush=()=>{if(group.length){const first=group[0],last=group.at(-1),minutes=(Date.parse(last.end)-Date.parse(first.start))/60000,moving=group.reduce((n,b)=>n+(Date.parse(b.end)-Date.parse(b.start))/60000,0);if(minutes>=minMinutes&&moving>=minutes*.8)groups.push({start:first.start,end:last.end,bins:group,minutes,moving});}group=[];};
    for(const b of usable){const duration=(Date.parse(b.end)-Date.parse(b.start))/60000;if(b.steps/duration<40){continue;}if(group.length&&Date.parse(b.start)-Date.parse(group.at(-1).end)>120000)flush();group.push(b);}flush();return groups;
  }
  function calculate(day,sessions,resting,state){
    const weight=state.weight??null,canCorrect=Number.isFinite(weight)&&weight>0&&Number.isFinite(resting)&&resting>0,zone=state.zone||'Europe/Paris',details=[],overrides=day.movementOverrides||{};
    const legacy=S.energySummary(sessions,resting),segments=S.energyTimeline(sessions,resting);let raw=0,credit=0,deduction=0,uncorrected=false;
    function add(a,b,kcal,key,walking,basis,kind){
      const choice=overrides[key]||'auto';let localRaw=0,localCredit=0,localDeduction=0;
      for(let at=a;at<b;){const end=Math.min(b,at+60000),portion=kcal*(end-at)/(b-a),included=choice==='baseline'||choice==='auto'&&walking&&day.routine.type!=='desk'&&inWork(new Date((at+end)/2).toISOString(),day,zone);
        const correction=included?portion:canCorrect?Math.min(portion,baseline(at,end,day,weight,resting,zone)):0;
        if(!included&&!canCorrect)uncorrected=true;
        localRaw+=portion;localDeduction+=correction;localCredit+=portion-correction;at=end;
      }
      raw+=localRaw;credit+=localCredit;deduction+=localDeduction;
      return {raw:localRaw,added:localCredit,deducted:localDeduction,basis,kind};
    }
    for(const s of sessions){const key=overrideKey('session',s),parts=segments.filter(p=>p.key===S.key(s));let info={raw:0,added:0,deducted:0};
      for(const p of parts){const v=add(Date.parse(p.start),Date.parse(p.end),p.kcal,key,s.kind==='walking',p.basis,'session');for(const k of ['raw','added','deducted'])info[k]+=v[k];}
      details.push({key,start:s.start,end:s.end,kind:'session',title:s.title||S.labels[s.kind],...info,excluded:parts.length===0&&S.energy(s,resting).kcal!==null,missing:S.energy(s,resting).kcal===null,choice:overrides[key]||'auto'});
    }
    const movement=state.movement,walks=movement?detect(movement.bins,day.routine.minWalkMinutes):[];
    for(const walk of walks){const key=overrideKey('walk',walk),bases=new Set();let info={raw:0,added:0,deducted:0},blockedMinutes=0,unknownMinutes=0,minutes=0,steps=0;
      for(const bin of walk.bins){const a=Date.parse(bin.start),b=Date.parse(bin.end),duration=(b-a)/60000;
        // One-minute step bins cannot be divided precisely at a session boundary. Exclude the whole touching bin.
        if(sessions.some(s=>Date.parse(s.start)<b&&Date.parse(s.end)>a)){blockedMinutes+=duration;continue;}
        minutes+=duration;steps+=bin.steps;
        let active=bin.activeKcal,basis='active';
        if(active===null){const speed=bin.distanceMeters===null?null:bin.distanceMeters/1000/(duration/60),met=walkingMet(speed);basis=speed===null?'duration':'distance';
          if(!canCorrect||met===null){unknownMinutes+=duration;continue;}active=Math.max(0,met*weight*duration/60-resting*duration/1440);
        }
        bases.add(basis);const v=add(a,b,active,key,true,basis,'walk');for(const k of ['raw','added','deducted'])info[k]+=v[k];
      }
      details.push({key,start:walk.start,end:walk.end,kind:'walk',title:'Marche détectée hors séance',...info,minutes,steps,blockedMinutes,unknownMinutes,bases:[...bases],choice:overrides[key]||'auto',estimated:true});
    }
    const manual=(day.activities||[]).filter(a=>a.state==='done'),hasImported=sessions.length>0||walks.some(w=>w.bins.length);
    let manualCount=0,missing=legacy.missing+details.filter(d=>d.unknownMinutes>0).length;
    if(hasImported)manualCount=manual.length+(day.walkingKcal!=null?1:0);
    else {
      for(const s of manual){if(s.kcal===null){missing++;continue;}raw+=s.kcal;const d=canCorrect?Math.min(s.kcal,Math.max(0,1.3*weight-resting/24)*s.minutes/60):0;credit+=s.kcal-d;deduction+=d;if(!canCorrect)uncorrected=true;}
      if(day.walkingKcal!=null){raw+=day.walkingKcal;credit+=day.walkingKcal;uncorrected=true;}
    }
    const known=sessions.some(s=>S.energy(s,resting).kcal!==null)||details.some(d=>d.kind==='walk'&&d.minutes>d.unknownMinutes)||!hasImported&&(manual.some(s=>s.kcal!==null)||day.walkingKcal!=null);
    credit=Math.round(credit*1e8)/1e8;raw=Math.round(raw*1e8)/1e8;
    const available=state.available||movement!==undefined;
    return {...legacy,kcal:known?Math.round(credit):missing||details.some(d=>d.unknownMinutes>0)?null:available?0:null,rawKcal:Math.round(raw),deductedKcal:Math.round(deduction),count:legacy.count+details.filter(d=>d.kind==='walk'&&d.minutes>0).length,missing,manualCount,source:hasImported||available?'imported':manual.length?'manual':'none',estimated:legacy.estimated||credit>0&&deduction>0||walks.length>0,details,walkCount:details.filter(d=>d.kind==='walk'&&d.minutes>0).length,walkingAvailable:movement!==undefined,coarseMinutes:movement?.bins.filter(b=>b.precisionSeconds>120).length??0,uncorrected};
  }
  const api={types,defaults,validate,workDay,inWork,overrideKey,baseline,walkingMet,detect,calculate};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EquilibreRoutine=api;
})(typeof globalThis!=='undefined'?globalThis:this);

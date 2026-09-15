(function(root){
  'use strict';
  const S=typeof module!=='undefined'&&module.exports?require('./session-model.js'):root.EquilibreSessions;
  function activities(day,sessions=[],resting=null,state={}){
    const done=(day.activities||[]).filter(a=>a.state==='done'),manual=[...done.map(a=>a.kcal),...(day.walkingKcal!==null&&day.walkingKcal!==undefined?[day.walkingKcal]:[])],known=manual.filter(n=>n!==null);
    if(sessions.length)return {...S.energySummary(sessions,resting),source:'imported',manualCount:manual.length};
    if(manual.length)return {kcal:known.length?Math.round(known.reduce((a,b)=>a+b,0)):null,count:done.length,missing:manual.length-known.length,estimated:false,overlap:false,source:'manual',manualCount:0};
    return {kcal:state.available?0:null,count:0,missing:0,estimated:false,overlap:false,source:state.available?'imported':'none',manualCount:0};
  }
  function progress(intake,target,activity,expense){
    const ratio=intake!==null&&target!==null&&target>0?intake/target:null;
    const activityRatio=activity!==null&&expense!==null&&expense>0&&activity<=expense?activity/expense:null;
    return {ratio,ring:ratio===null?0:Math.min(1,Math.max(0,ratio)),remaining:intake===null||target===null?null:target-intake,activityRatio,inconsistent:activity!==null&&expense!==null&&activity>expense};
  }
  const api={activities,progress};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EquilibreBalance=api;
})(typeof globalThis!=='undefined'?globalThis:this);

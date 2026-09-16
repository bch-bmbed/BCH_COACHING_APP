(function(root){
  'use strict';
  const S=typeof module!=='undefined'&&module.exports?require('./session-model.js'):root.EquilibreSessions;
  const R=typeof module!=='undefined'&&module.exports?require('./routine-model.js'):root.EquilibreRoutine;
  function activities(day,sessions=[],resting=null,state={}){
    if(day.routine&&day.maintenance==null)return R.calculate(day,sessions,resting,state);
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
  function expenditure(day,activity,projection=null){
    const maintenance=day.maintenance??null,base=maintenance===null?(day.base??null):null,included=base===null?(day.includedActivity??null):null,reference=maintenance??base;
    const excess=activity.kcal===null||included===null?null:Math.max(0,activity.kcal-included);
    const result={maintenance,base,reference,included,activity:activity.kcal,excess,expense:reference,adjustment:0,method:'reference',provisional:Boolean(activity.missing||activity.unclassified||activity.estimated||activity.excludedCount||base!==null&&activity.kcal===null)};
    if(day.total!=null)return {...result,expense:day.total,adjustment:reference===null?null:day.total-reference,method:'manual'};
    // A base excludes exercise. Every retained activity calorie counts, even below 300.
    // Missing activity keeps only the provisional base; it is never reported as measured zero.
    if(base!==null)return {...result,expense:base+(activity.kcal??0),adjustment:activity.kcal,method:'base'};
    if(day.adaptive&&['projected','complete'].includes(projection?.status))return {...result,expense:projection.expense,adjustment:maintenance===null?null:projection.expense-maintenance,method:projection.status};
    if(day.adaptive&&maintenance!==null&&included!==null)return {...result,expense:maintenance+(excess??0),adjustment:excess??0,method:'activity'};
    return result;
  }
  function baseBalance(day,sessions=[],resting=null,state={}){
    const activity=activities(day,sessions,resting,state),e=expenditure(day,activity),expense=e.expense;
    const intakeTarget=expense!==null&&day.target!=null?Math.max(0,expense-day.target):(day.plannedIntake??null);
    // Planned sessions stay in the journal; the food budget follows completed activity only.
    return {plannedExpense:expense,actualExpense:expense,planned:expense===null||intakeTarget===null?null:expense-intakeTarget,actual:expense===null||day.intake==null?null:expense-day.intake,intakeTarget};
  }
  const api={activities,progress,expenditure,baseBalance};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EquilibreBalance=api;
})(typeof globalThis!=='undefined'?globalThis:this);

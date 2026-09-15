(function(){
  'use strict';
  const H=window.EquilibreHealth,$=id=>document.getElementById(id);
  let client=null,user=null,epoch=0,busy=false,snapshots=[],devices=[],selectedSource='',cacheKey='',lastError='';
  const sourceLabel=s=>s==='com.google.android.apps.fitness'?'Google Fit':s==='com.garmin.android.apps.connectmobile'?'Garmin Connect':s;
  const fmt=n=>n===null?'—':new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(n);
  const time=s=>s?new Date(s).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
  function refresh(){paintAccount();window.Journal?.refreshHealth();}
  function paintAccount(){
    $('health-pair-form').hidden=!user;$('health-devices').hidden=!user;
    $('health-account-status').textContent=user?(lastError||'Associe ton téléphone pour recevoir les calories totales et les pas.'):'Connecte-toi au compte du dashboard pour associer ton téléphone.';
    const select=$('health-source'),sources=[...new Set(snapshots.map(s=>s.source))].sort();select.replaceChildren();
    for(const s of sources){const option=document.createElement('option');option.value=s;option.textContent=sourceLabel(s);select.append(option);}
    selectedSource=[...snapshots].sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt))[0]?.source||'';select.value=selectedSource;select.disabled=true;
    const box=$('health-device-list');box.replaceChildren();
    for(const d of devices.filter(d=>!d.revoked_at)){
      const row=document.createElement('div');row.className='bridge-device';const text=document.createElement('span');text.textContent=`${d.name} · ${d.last_seen_at?'dernier envoi '+time(d.last_seen_at):'en attente du premier envoi'}`;
      const button=document.createElement('button');button.type='button';button.textContent='Désactiver';button.onclick=async()=>{button.disabled=true;try{await invoke({action:'revoke',deviceId:d.id});await sync();}catch(e){lastError=e.message;paintAccount();}finally{button.disabled=false;}};row.append(text,button);box.append(row);
    }
    $('health-source-note').textContent=sources.length?`${snapshots.length} journées/source reçues. La source du dernier envoi du téléphone est utilisée sur tous les appareils. Change-la dans Équilibre Connect.`:'Aucune donnée reçue. La première synchronisation vérifiera les données réellement disponibles dans Santé Connect.';
  }
  async function invoke(body){
    if(!client||!user)throw Error('Connecte-toi au dashboard.');
    const current=epoch,result=await client.functions.invoke('health-bridge',{body});if(current!==epoch)throw Error('Le compte a changé.');
    if(result.error){let message=result.error.message;try{message=(await result.error.context.json()).error||message;}catch{}throw Error(message);}
    if(result.data.error)throw Error(result.data.error);return result.data;
  }
  async function sync(){
    if(!client||!user||busy||!navigator.onLine)return;
    busy=true;const current=epoch,owner=user.id;
    try{
      const since=new Date(Date.now()-90*86400000).toISOString().slice(0,10);
      const [health,bridge]=await Promise.all([client.from('health_snapshots').select('payload').eq('user_id',owner).gte('day',since).order('day',{ascending:false}).limit(3000),client.from('health_bridge_devices').select('id,name,created_at,revoked_at,last_seen_at').eq('user_id',owner).order('created_at',{ascending:false})]);
      if(current!==epoch)return;if(health.error)throw health.error;if(bridge.error)throw bridge.error;
      const next=health.data.map(r=>H.validateSnapshot(r.payload));snapshots=next;devices=bridge.data;lastError='';
      localStorage.setItem(cacheKey,JSON.stringify({snapshots,selectedSource}));refresh();
    }catch(e){if(current===epoch){lastError='Données Santé Connect non actualisées : '+e.message;refresh();}}
    finally{busy=false;}
  }
  function projection(day,date){
    const s=snapshots.filter(s=>s.day===date&&s.source===selectedSource).sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt))[0];
    return H.project({day,date,today:window.Journal?.today()||new Date().toLocaleDateString('en-CA'),snapshot:s,history:snapshots});
  }
  window.HealthBridge={
    activate(db,account){client=db;user=account;epoch++;snapshots=[];devices=[];selectedSource='';lastError='';$('health-code').value='';$('health-code-box').hidden=true;
      cacheKey=user?'equilibre-health-v1-'+user.id:'';
      if(cacheKey)try{const raw=JSON.parse(localStorage.getItem(cacheKey)||'{}');snapshots=(raw.snapshots||[]).map(H.validateSnapshot);selectedSource=raw.selectedSource||'';}catch{lastError='Copie locale Santé Connect illisible ; nouvelle lecture nécessaire.';}
      paintAccount();refresh();if(user)sync();
    },
    project:projection,
    render(day,date){
      const p=projection(day,date),adaptive=day.adaptive===true;
      $('health-observed').textContent=fmt(p.observed)+' kcal';$('health-remaining').textContent=fmt(p.remaining)+' kcal';
      $('health-projection').textContent=fmt(p.expense)+' kcal';
      $('health-badge').textContent=({reference:'Maintien conservé',manual:'Total saisi',projected:'Projection provisoire',complete:'Journée complète'})[p.status];
      $('health-detail').textContent=(adaptive?p.reason:'Active « Maintien ajusté par Santé Connect » dans Compte pour utiliser ces données dans le bilan.')+(lastError?' '+lastError:'');
      $('health-updated').textContent=`Données jusqu’au ${time(p.through)} · transfert ${time(p.capturedAt)}${selectedSource?' · '+sourceLabel(selectedSource):''}`;
      $('health-steps').textContent=p.steps===null?'Pas importés : non disponibles':`Pas importés, séances incluses : ${fmt(p.steps)}`;
      const budget=adaptive&&p.expense!==null&&day.target!==null?Math.max(0,p.expense-day.target):null;
      $('health-budget').textContent=budget===null?'Objectif indicatif à compléter dans Compte':`Objectif alimentaire indicatif : ${fmt(budget)} kcal · déficit visé ${fmt(day.target)} kcal`;
      return p;
    }
  };
  $('health-pair-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;$('health-code-box').hidden=true;try{const result=await invoke({action:'create',name:$('health-device-name').value.trim()});$('health-code').value=result.code;$('health-code-box').hidden=false;await sync();}catch(e){lastError=e.message;paintAccount();}finally{button.disabled=false;}};
  $('health-copy-code').onclick=async()=>{try{await navigator.clipboard.writeText($('health-code').value);$('health-code-help').textContent='Code copié. Colle-le dans Équilibre Connect sur ton téléphone.';}catch{$('health-code').select();$('health-code-help').textContent='Sélectionne et copie le code affiché.';}};
  $('health-hide-code').onclick=()=>{$('health-code').value='';$('health-code-box').hidden=true;};
  $('health-refresh').onclick=sync;
  $('health-export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,snapshots},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='equilibre-sante-connect.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  window.addEventListener('online',sync);window.addEventListener('focus',sync);document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});setInterval(()=>{if(!document.hidden){sync();window.Journal?.refreshHealth();}},60000);
  refresh();
})();

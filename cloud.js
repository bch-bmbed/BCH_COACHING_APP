(function() {
  'use strict';
  const config=window.EQUILIBRE_CONFIG, J=window.Journal, M=window.Equilibre, S=window.EquilibreSync;
  const $=id=>document.getElementById(id);
  let client=null, account=null, generation=0, running=false, timer=null, pending=new Map();
  function status(label,message){$('sync-state').textContent=label;$('cloud-badge').textContent=label;if(message)$('sync-message').textContent=message;}
  const valueText=value=>value === undefined?'Supprimée':value === null?'Non renseigné':typeof value==='object'?`${value.name} · ${value.minutes} min · ${value.kcal??'?'} kcal · ${value.state==='done'?'réalisée':'prévue'}`:String(value);
  function paintConflicts(){
    const box=$('conflict-items');box.replaceChildren();$('conflicts').hidden=pending.size===0;
    for(const [date,item] of pending){
      const form=document.createElement('form');form.className='conflict-day';
      const title=document.createElement('h4');title.textContent=date==='profile'?'Profil du compte':date.split('-').reverse().join('/');form.append(title);
      for(const conflict of item.conflicts){
        const label=document.createElement('label');label.textContent=S.label(conflict.key);
        const select=document.createElement('select');select.name=conflict.key;select.required=true;
        for(const [value,text] of [['','Choisir…'],['local','Cet appareil : '+valueText(conflict.local)],['remote','Autre appareil : '+valueText(conflict.remote)]]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
        label.append(select);form.append(label);
      }
      const button=document.createElement('button');button.type='submit';button.className='primary';button.textContent='Conserver ces valeurs';form.append(button);
      form.onsubmit=e=>{
        e.preventDefault();if(!J.saveDraft())return;
        const current=J.snapshot();
        if(date==='profile'){
          if(!S.same(J.profile(),item.local)){pending.delete(date);paintConflicts();schedule();return;}
          const result=S.mergeProfile(item.base,item.local,item.remote,Object.fromEntries(new FormData(form)));
          J.applyProfile(result.profile,item.remote);pending.delete(date);paintConflicts();schedule();return;
        }
        if(!S.same(current.days[date],item.local)){pending.delete(date);paintConflicts();schedule();return;}
        const resolutions=Object.fromEntries(new FormData(form));
        const result=S.mergeDay(item.base,item.local,item.remote,resolutions), bases=J.base();
        bases[date]=item.remote;current.days[date]=result.day;
        J.apply(current,bases);pending.delete(date);paintConflicts();schedule();
      };box.append(form);
    }
  }
  const cleanDay=(date,payload)=>M.validateBackup({version:2,days:{[date]:payload}}).days[date];
  async function fetchRows(user){
    const rows=[];
    for(let start=0;;start+=500){
      const result=await client.from('journal_days').select('day,payload,revision').eq('user_id',user.id).order('day').range(start,start+499);
      if(result.error)throw result.error;
      for(const row of result.data)rows.push({...row,payload:cleanDay(row.day,row.payload)});
      if(result.data.length<500)break;
      if(rows.length>=20000)throw Error('Le journal dépasse la limite de synchronisation.');
    }return new Map(rows.map(row=>[row.day,row]));
  }
  async function syncProfile(user,epoch){
    const response=await client.from('account_profiles').select('payload,revision').eq('user_id',user.id).maybeSingle();
    if(response.error)throw response.error;
    if(epoch!==generation)return false;
    if(J.hasDraft()){status('À enregistrer','Enregistre ta saisie pour reprendre la synchronisation.');return false;}
    const local=J.profile(),base=J.profileBase();let row=response.data,remote=row?M.validateProfile(row.payload):undefined;
    for(let attempt=0;attempt<4;attempt++){
      const merged=S.mergeProfile(base,local,remote);
      if(merged.conflicts.length){
        pending.set('profile',{base,local,remote,conflicts:merged.conflicts});paintConflicts();
        status('Choix nécessaire','Ton profil a été modifié sur deux appareils. Départage les champs ci-dessous.');return false;
      }
      if(!S.same(merged.profile,remote)){
        const write=await client.rpc('save_account_profile',{p_payload:merged.profile,p_expected_revision:row?.revision??0});
        if(write.error)throw write.error;
        if(epoch!==generation)return false;
        row=write.data;remote=row.payload?M.validateProfile(row.payload):undefined;
        if(!row.saved){if(attempt===3)throw Error('Le profil change sur un autre appareil. Réessaie la synchronisation.');continue;}
      }
      if(J.hasDraft() || !S.same(J.profile(),local)){
        // Rebase a newly saved edit on our accepted write, without replacing a live form.
        if(!J.hasDraft()){
          const updated=S.mergeProfile(local,J.profile(),remote);
          if(!updated.conflicts.length)J.applyProfile(updated.profile,remote);
        }
        status('À synchroniser','Ta nouvelle saisie du profil est conservée. Enregistre-la pour reprendre la synchronisation.');return false;
      }
      J.applyProfile(remote,remote);pending.delete('profile');return true;
    }
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>sync(),900);}
  async function sync(){
    if(!account || running || J.blocked())return;
    if(J.hasDraft()){status('À enregistrer','Enregistre ta saisie pour la synchroniser.');return;}
    if(!navigator.onLine){status('Hors ligne','Les saisies sont conservées ici. La synchronisation reprendra à la connexion.');return;}
    running=true;const user=account,epoch=generation;
    status('Synchronisation…','Mise à jour de ton journal privé.');
    try{
      if(!await syncProfile(user,epoch))return;
      const rows=await fetchRows(user);
      if(epoch!==generation)return;
      const initial=J.snapshot();
      for(const date of new Set([...Object.keys(initial.days),...rows.keys()])){
        if(epoch!==generation)return;
        if(J.hasDraft()){status('À enregistrer','Enregistre ta saisie pour reprendre la synchronisation.');return;}
        const local=J.snapshot().days[date],base=J.base()[date];let row=rows.get(date),remote=row?.payload;
        // A remote-only day is adopted as-is; new devices do not invent empty meals.
        let merged=local?S.mergeDay(base,local,remote):{day:remote,conflicts:[]};
        for(let attempt=0;attempt<4;attempt++){
          if(merged.conflicts.length){pending.set(date,{base,local,remote,conflicts:merged.conflicts});break;}
          if(!S.same(merged.day,remote)){
            const response=await client.rpc('save_journal_day',{p_day:date,p_payload:merged.day,p_expected_revision:row?.revision??0});
            if(response.error)throw response.error;
            if(epoch!==generation)return;
            const result=response.data;
            if(!result.saved){row={revision:result.revision};remote=result.payload?cleanDay(date,result.payload):undefined;merged=S.mergeDay(base,local,remote);if(attempt===3)throw Error('Cette journée change sur un autre appareil. Réessaie la synchronisation.');continue;}
            remote=cleanDay(date,result.payload);
          }
          // Keep pending edits safe if a user typed or saved during this request.
          if(J.hasDraft() || !S.same(J.snapshot().days[date],local)){status('À synchroniser','Une nouvelle saisie a été conservée. La mise à jour reprendra après enregistrement.');return;}
          const next=J.snapshot(),bases=J.base();next.days[date]=remote;bases[date]=remote;J.apply(next,bases);pending.delete(date);break;
        }
      }
      paintConflicts();
      if(pending.size)status('Choix nécessaire',`${pending.size} journée(s) ont des modifications simultanées. Départage les champs ci-dessous.`);
      else status('Synchronisé','Dernière synchronisation : '+new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})+'. Tes saisies sont accessibles avec ce compte sur tes autres appareils.');
    }catch(error){status('Non synchronisé','Tes saisies restent sur cet appareil. '+(error.message||'Connexion au stockage indisponible.'));}
    finally{running=false;}
  }
  async function activate(user){
    if(account?.id===user?.id)return;
    generation++;pending.clear();paintConflicts();
    if(!J.activate(user?.id)){status('Action nécessaire','Enregistre ou exporte tes modifications avant de changer de compte.');return;}
    account=user;$('login-form').hidden=!!user;$('account-actions').hidden=!user;
    $('account-email').textContent=user?.email||'';
    if(user){const local=J.localData(),count=Object.keys(local.days).length+Object.keys(local.profile.goals).length+Object.keys(local.profile.weights).length+Number(local.profile.resting!==null);$('copy-local').hidden=!count;status('Connecté','Ton journal privé va être récupéré.');schedule();}
    else status('Sur cet appareil','Tu es déconnecté. Les journées locales restent disponibles ; les données du compte sont masquées.');
  }
  $('login-form').onsubmit=async e=>{
    e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;
    try{
      const {error}=await client.auth.signInWithOtp({email:$('email').value.trim(),options:{shouldCreateUser:true,emailRedirectTo:location.origin+location.pathname}});
      if(error)throw error;status('E-mail envoyé','Ouvre le lien reçu sur cet appareil. Vérifie aussi les indésirables.');
    }catch(error){
      if(error.code==='over_email_send_rate_limit' || /email rate limit exceeded/i.test(error.message||'')){
        status('Limite d’e-mails atteinte','Trop de liens de connexion ont été demandés. Attends environ une heure avant de demander un nouveau lien sur cet appareil. Garde tes autres appareils connectés : leurs saisies continuent à se synchroniser.');
      }else status('Connexion impossible',error.message);
    }finally{button.disabled=false;}
  };
  $('sync-now').onclick=()=>{if(J.saveDraft())return sync();};
  $('logout').onclick=async()=>{
    if(!J.saveDraft())return;
    await sync();
    if(running || pending.size || $('sync-state').textContent!=='Synchronisé'){status('À synchroniser','Attends la fin de la synchronisation ou résous les modifications avant de te déconnecter.');return;}
    const {error}=await client.auth.signOut({scope:'local'});if(error)status('Déconnexion impossible',error.message);else await activate(null);
  };
  $('copy-local').onclick=()=>{
    if(!account || !J.saveDraft())return;
    const source=J.localData(),next=J.snapshot(),bases=J.base();let added=0;
    for(const [date,day]of Object.entries(source.days)){
      if(next.days[date]){
        const remote=next.days[date],result=S.mergeDay(undefined,day,remote);
        next.days[date]=result.day;
        // Use an empty ancestor so the next sync detects two independently entered values.
        delete bases[date];
        if(result.conflicts.length)pending.set(date,{base:undefined,local:result.day,remote,conflicts:result.conflicts});
      }else next.days[date]=day;
      added++;
    }
    const remote=J.profile(),result=S.mergeProfile(undefined,source.profile,remote);
    next.profile=result.profile;
    J.apply(next,bases);J.applyProfile(result.profile,null);
    if(result.conflicts.length)pending.set('profile',{base:undefined,local:result.profile,remote,conflicts:result.conflicts});
    paintConflicts();status('Transfert préparé',`${added} journée(s) et profil réunis. Les éventuelles différences seront à départager. Les originaux locaux restent disponibles.`);$('copy-local').hidden=true;schedule();
  };
  window.addEventListener('journal-saved',schedule);window.addEventListener('online',schedule);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
  window.addEventListener('focus',schedule);setInterval(()=>{if(!document.hidden)sync();},30000);
  if(!config?.supabaseUrl || !config?.supabasePublishableKey)return;
  // Local, pinned official SDK: no third-party script runs on this health journal.
  const sdk=document.createElement('script');sdk.src='vendor/supabase.js';
  sdk.onerror=()=>status('Connexion indisponible','Le module de connexion n’a pas chargé. Tes saisies locales restent disponibles.');
  sdk.onload=async()=>{
    try{
      client=window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{storageKey:'equilibre-auth',detectSessionInUrl:true,flowType:'implicit'}});
      client.auth.onAuthStateChange((_event,session)=>setTimeout(()=>activate(session?.user||null),0));
      const {data,error}=await client.auth.getSession();if(error)throw error;
      $('login-form').hidden=!!data.session;
      if(data.session)await activate(data.session.user);else status('Sur cet appareil','Connecte-toi avec la même adresse e-mail sur ton PC et ton téléphone pour retrouver tes repas et activités.');
    }catch(error){status('Connexion indisponible',error.message);}
  };document.head.append(sdk);
})();

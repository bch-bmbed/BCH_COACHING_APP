(function(){
  'use strict';
  const H=window.EquilibreHealth,S=window.EquilibreSessions,$=id=>document.getElementById(id);
  let client=null,user=null,epoch=0,busy=false,snapshots=[],devices=[],combined=[],cacheKey='',lastError='';
  const sourceLabel=s=>s==='health-connect'?'Toutes les sources · Santé Connect':s==='com.urevo.app'?'Urevo':s==='com.google.android.apps.fitness'?'Google Fit':s==='com.garmin.android.apps.connectmobile'?'Garmin Connect':s;
  const fmt=n=>n===null?'—':new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(n);
  const fmtEnergy=n=>n===null?'—':new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1}).format(n);
  const fmtKm=n=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:3}).format(n/1000);
  const time=s=>s?new Date(s).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
  function refresh(){combined=H.automatic(snapshots);paintAccount();window.Journal?.refreshHealth();}
  function paintAccount(){
    $('health-pair-form').hidden=!user;$('health-devices').hidden=!user;
    $('health-account-status').textContent=user?(lastError||(devices.some(d=>!d.revoked_at)?'Téléphone associé. Les envois se retrouvent dans Bilan et Activités.':'Associe ton téléphone pour recevoir tes données sportives.')):'Connecte-toi au compte du dashboard pour associer ton téléphone.';
    const sources=[...new Set(snapshots.flatMap(s=>s.sources||[s.source]))].sort();
    $('health-sources').textContent=sources.length?'Applications reçues : '+sources.map(sourceLabel).join(' · '):'Toutes les applications disponibles seront prises en compte automatiquement.';
    const box=$('health-device-list');box.replaceChildren();
    for(const d of devices.filter(d=>!d.revoked_at)){
      const row=document.createElement('div');row.className='bridge-device';const text=document.createElement('span');text.textContent=`${d.name} · ${d.last_seen_at?'dernier envoi '+time(d.last_seen_at):'en attente du premier envoi'}`;
      const button=document.createElement('button');button.type='button';button.textContent='Désactiver';button.onclick=async()=>{button.disabled=true;try{await invoke({action:'revoke',deviceId:d.id});await sync();}catch(e){lastError=e.message;paintAccount();}finally{button.disabled=false;}};row.append(text,button);box.append(row);
    }
    $('health-source-note').textContent=snapshots.some(s=>s.version===2)?'Collecte automatique active. Santé Connect regroupe les totaux ; le dashboard regroupe les copies de séances.':snapshots.length?'Ancienne passerelle détectée : installe la dernière version de l’APK, actualise les autorisations puis synchronise. Ton code actuel est conservé.':'Aucune donnée reçue. La première synchronisation vérifiera les données réellement disponibles dans Santé Connect.';
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
      localStorage.setItem(cacheKey,JSON.stringify({snapshots}));refresh();
    }catch(e){if(current===epoch){lastError='Données Santé Connect non actualisées : '+e.message;refresh();}}
    finally{busy=false;}
  }
  function projection(day,date){
    const s=combined.find(s=>s.day===date);
    return H.project({day:{...day,resting:window.Journal?.profile().resting},date,today:window.Journal?.today()||new Date().toLocaleDateString('en-CA'),snapshot:s,history:combined});
  }
  const sessionsOn=date=>S.dedupe(combined.find(s=>s.day===date)?.sessions||[]);
  const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  function renderSessions(date){
    const snapshot=combined.find(s=>s.day===date),sessions=sessionsOn(date),box=$('imported-activities');box.replaceChildren();
    const journal=window.Journal?.snapshot(),knownWeight=journal?window.Equilibre.latestWeight(journal.profile,journal.days,date):null,resting=journal?.profile.resting;
    $('imported-steps').textContent=snapshot?.steps===null||snapshot?.steps===undefined?'Pas du jour : aucune donnée importée':`Pas du jour : ${fmt(snapshot.steps)} · séances incluses`;
    const count=sessions.reduce((n,s)=>n+s.copies,0);$('imported-count').textContent=`${sessions.length} séance${sessions.length>1?'s':''}${count?' · '+count+' copie(s) regroupée(s)':''}`;
    $('imported-status').textContent=lastError||(!user?'Connecte-toi pour retrouver tes séances importées.':!snapshot?'Aucun envoi reçu pour cette date.':snapshot.version<2?'La première version ne transmettait pas les séances. Mets à jour Équilibre Connect et autorise les séances, puis synchronise.':!snapshot.permissions.sessions?'Lecture des séances non autorisée. Les imports précédents restent conservés. Dans Équilibre Connect, actualise les autorisations.':!sessions.length?'Aucune séance écrite dans Santé Connect pour cette date lors du dernier envoi. Vérifie Données → Activité → Exercice dans Santé Connect, puis synchronise à nouveau.':`Transfert du ${time(snapshot.capturedAt)} · horaires affichés dans le fuseau ${snapshot.zone}.`);
    const clock=iso=>new Date(iso).toLocaleTimeString('fr-FR',{timeZone:snapshot?.zone,hour:'2-digit',minute:'2-digit'});
    for(const s of sessions){
      const card=node('article');card.className='imported-session';const energy=S.energy(s,resting),motion=S.motion(s),minutes=(Date.parse(s.end)-Date.parse(s.start))/60000;
      const calories=energy.kcal===null?'calories non disponibles':energy.basis==='source'?fmtEnergy(energy.kcal)+' kcal transmises par Urevo':(energy.estimated?'≈ ':'')+fmtEnergy(energy.kcal)+' kcal actives'+(energy.estimated?' estimées':' sur ce créneau');
      card.append(node('h3',s.title),node('p',`${clock(s.start)}–${clock(s.end)} · ${fmtEnergy(minutes)} min · ${calories}`),node('small',s.sources.map(sourceLabel).join(' + ')+(s.copies?` · ${s.copies} copie(s) regroupée(s)`:'')));
      if(energy.basis==='source')card.append(node('p','Nature à confirmer : valeur Urevo conservée sans soustraire le repos.'));
      if(motion){
        const distance=motion.distanceMeters===null?'':`${fmtKm(motion.distanceMeters)} km · `;
        card.append(node('p',`${distance}${fmtEnergy(motion.speedKmh)} km/h · ${motion.basis==='samples'?'moyenne des mesures reçues':'vitesse moyenne calculée'} · ${sourceLabel(motion.source)}`));
        card.append(node('small',motion.basis==='samples'?`${motion.samples} mesure(s) de vitesse ; moyenne des points disponibles, pas nécessairement de toute la séance.`:`Distance ÷ durée : ${fmtKm(motion.distanceMeters)} km ÷ (${fmtEnergy(motion.minutes)} min / 60). Moyenne sur la durée totale, pauses comprises.`));
      } else if(['walking','running','cycling','hiking'].includes(s.kind)){
        const p=snapshot.permissions;
        card.append(node('p',p.distance===undefined||p.speed===undefined?'Vitesse et distance non demandées par cet ancien transfert. Mets à jour Équilibre Connect, autorise Distance et Vitesse, puis synchronise.':!p.distance||!p.speed?'Vitesse ou distance non autorisée : complète les autorisations dans Équilibre Connect, puis synchronise.':'Aucune mesure de vitesse ni distance complète reçue pour cette séance.'));
      }
      if(s.kind==='walking'&&s.sources.some(S.isUnclassifiedSource)){
        const reference=node('div');reference.className='walking-reference';
        reference.append(node('strong','Repère théorique de calories actives'));
        const r=S.walkingReference(minutes,knownWeight?.weight,resting);
        if(r){
          reference.append(node('p',`≈ ${fmt(r.activeLow)}–${fmt(r.activeHigh)} kcal pour ${fmtEnergy(minutes)} min, si la marche est à 4 km/h, à plat.`));
          reference.append(node('small',`Poids : ${fmtEnergy(r.weight)} kg (pesée du ${knownWeight.date.split('-').reverse().join('/')}). ${motion?'La vitesse est affichée ci-dessus ; ce repère reste le scénario à 4 km/h, à plat.':'Allure supposée à 4 km/h.'} La pente n’est pas transmise.`));
          const calculation=node('details');calculation.append(node('summary','Comprendre le calcul'));
          calculation.append(node('p',`Dépense totale théorique : (3 à 3,5) × ${fmtEnergy(r.weight)} kg × (${fmtEnergy(minutes)} min / 60) ≈ ${fmt(r.grossLow)}–${fmt(r.grossHigh)} kcal.`));
          calculation.append(node('p',`Repos estimé : ${fmt(resting)} kcal/j × ${fmtEnergy(minutes)} / 1 440 ≈ ${fmt(r.restKcal)} kcal. Repère actif = total théorique − repos.`));
          calculation.append(node('p','Les facteurs d’intensité de 3 à 3,5 MET correspondent à cette allure sur sol ferme ou sur tapis. Cette plage compare deux repères moyens ; elle ne mesure pas ta dépense et ne permet pas de confirmer la méthode Urevo.'));
          const link=node('a','Références : Compendium des activités physiques');link.href='https://pacompendium.com/walking/';calculation.append(link);reference.append(calculation);
        } else reference.append(node('p','Renseigne une pesée à cette date ou avant, et le métabolisme de base dans Compte, pour afficher la comparaison à 4 km/h, à plat.'));
        card.append(reference);
      }
      if(s.ambiguous)card.append(node('p','Chevauchement à vérifier : type ou enregistrements différents, séances conservées séparément.'));
      if(energy.kcal===null){
        const hasTotal=s.members.some(m=>m.totalKcal!==null&&m.totalKcal!==undefined);
        card.append(node('p',hasTotal?'Le total de séance est disponible. Renseigne ton métabolisme de base dans Compte pour estimer la part active.':snapshot.bridgeVersion>=6?'Aucune calorie de séance exploitable reçue. Vérifie les calories partagées par la source dans Santé Connect.':'Cet envoi ne confirme pas la version installée. Mets à jour Équilibre Connect puis lance Synchroniser maintenant pour récupérer les calories de séance.'));
      }
      const detail=node('details');detail.append(node('summary','Voir les enregistrements source'));
      for(const m of s.members)detail.append(node('p',`${sourceLabel(m.source)} · ${m.title||S.labels[m.kind]} · ${clock(m.start)}–${clock(m.end)} · ${fmtEnergy(m.activeKcal)} kcal actives${m.totalKcal!==null&&m.totalKcal!==undefined?' · '+fmtEnergy(m.totalKcal)+(S.isUnclassifiedSource(m.source)?' kcal transmises (nature à confirmer)':' kcal totales (repos inclus)'):''}${m.distanceMeters!=null?' · '+fmtEnergy(m.distanceMeters)+' m':''}${m.speedKmh!=null?' · '+fmtEnergy(m.speedKmh)+' km/h ('+m.speedSamples+' mesures)':''}`));
      if(energy.estimated)detail.append(node('p','Estimation : total de la séance transmis par la source, moins le repos estimé sur sa durée avec le métabolisme de ton profil.'));
      card.append(detail);box.append(card);
    }
    if(snapshot?.bridgeVersion)$('imported-status').textContent+=` Passerelle 1.0.${snapshot.bridgeVersion}.`;
    return sessions;
  }
  window.HealthBridge={
    activate(db,account){client=db;user=account;epoch++;snapshots=[];combined=[];devices=[];lastError='';$('health-code').value='';$('health-code-box').hidden=true;
      cacheKey=user?'equilibre-health-v1-'+user.id:'';
      if(cacheKey)try{const raw=JSON.parse(localStorage.getItem(cacheKey)||'{}');snapshots=(raw.snapshots||[]).map(H.validateSnapshot);}catch{lastError='Copie locale Santé Connect illisible ; nouvelle lecture nécessaire.';}
      paintAccount();refresh();if(user)sync();
    },
    project:projection,
    sessions:sessionsOn,dates:()=>combined.map(s=>s.day),steps:date=>combined.find(s=>s.day===date)?.steps??null,
    activityState:date=>({available:combined.find(s=>s.day===date)?.permissions?.sessions===true}),
    render(day,date){
      const p=projection(day,date),adaptive=day.adaptive===true;
      renderSessions(date);
      $('health-observed').textContent=fmt(p.observed)+' kcal';$('health-remaining').textContent=fmt(p.remaining)+' kcal';
      $('health-projection').textContent=fmt(p.expense)+' kcal';
      $('health-badge').textContent=({reference:'Maintien conservé',manual:'Total saisi',projected:'Projection provisoire',complete:'Journée complète'})[p.status];
      $('health-detail').textContent=(adaptive?p.reason:'Active « Maintien ajusté par Santé Connect » dans Compte pour utiliser ces données dans le bilan.')+(lastError?' '+lastError:'');
      $('health-updated').textContent=`Données jusqu’au ${time(p.through)} · transfert ${time(p.capturedAt)} · ${sourceLabel(combined.find(s=>s.day===date)?.source||'health-connect')}`;
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
  $('health-export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({version:2,snapshots},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='equilibre-sante-connect.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  window.addEventListener('online',sync);window.addEventListener('focus',sync);document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});setInterval(()=>{if(!document.hidden){sync();window.Journal?.refreshHealth();}},60000);
  refresh();
})();

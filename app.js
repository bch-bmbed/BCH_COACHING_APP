'use strict';
const M = window.Equilibre;
const $ = id => document.getElementById(id);
const LOCAL_KEY = 'equilibre-journal-v4';
let KEY = LOCAL_KEY;
const number = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 2});
const fmt = n => n === null ? '—' : number.format(n);
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const ids = {total: 'total',steps:'steps',walkingKcal:'walking-kcal'};
const profileIds = {plannedIntake:'profile-intake',base:'profile-base',target:'profile-target',maintenance:'profile-maintenance'};
let data = {version: 4, days: {},profile:M.blankProfile()}, selected = localDate(), activities = [], editingActivityId=null, dirty = false, profileDirty=false, profileWeightDirty=false, locked = false, intakeMode = 'meals', legacyIntake = null, cloudBase = {}, cloudProfileBase=null;
const readLocal=()=>localStorage.getItem(LOCAL_KEY)||localStorage.getItem('equilibre-journal-v3')||localStorage.getItem('equilibre-journal-v2')||localStorage.getItem('equilibre-journal-v1');
const viewIds = ['bilan', 'repas', 'activites', 'tendances', 'compte'];
const viewAliases = {journal: 'bilan', sync: 'compte', sources: 'compte'};
function showView(fragment, focus = false) {
  const id = Object.hasOwn(viewAliases, fragment) ? viewAliases[fragment] : (viewIds.includes(fragment) ? fragment : 'bilan');
  for (const name of viewIds) $(name).hidden = name !== id;
  for (const link of document.querySelectorAll('.app-nav a')) {
    if (link.hash === '#' + id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  $('day-toolbar').hidden = id === 'compte'; $('save-bar').hidden = id === 'compte';
  $('save-state').hidden = id === 'activites'; $('activity-save-hint').hidden = id !== 'activites';
  $('save-button').setAttribute('form', id === 'activites' ? 'activity-form' : 'day-form');
  $('save-button').textContent = id === 'activites' ? (editingActivityId?'Enregistrer la séance':'+ Ajouter la séance') : 'Enregistrer la journée';
  if (fragment === 'sources') $('sources').open = true;
  if (focus) { $(id + '-title').focus({preventScroll: true}); window.scrollTo({top: 0, behavior: 'instant'}); }
}
function navigateView(fragment) {
  if (location.hash !== '#' + fragment) history.pushState(null, '', '#' + fragment);
  showView(fragment, true);
}
document.addEventListener('click', e => {
  const link = e.target.closest('a[href^="#"]');
  if (!link || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  const fragment = link.hash.slice(1);
  if (!viewIds.includes(fragment) && !Object.hasOwn(viewAliases, fragment)) return;
  e.preventDefault(); navigateView(fragment);
});
window.addEventListener('hashchange', () => showView(location.hash.slice(1), true));
// Keep an incoming email-login fragment intact until the auth SDK consumes it.
showView(location.hash.slice(1));
function validateDayForm() {
  const invalid = Array.from($('day-form').elements).find(field => field.willValidate && !field.validity.valid);
  if (!invalid) return true;
  const view = invalid.closest('.app-view');
  if (view) navigateView(view.id);
  for (let parent = invalid.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
  invalid.reportValidity(); return false;
}
for (const [key,name] of Object.entries(M.mealNames)) {
  const card = document.createElement('details'); card.className = 'meal-card'; card.open=key==='breakfast';
  const title=document.createElement('summary'),label=document.createElement('strong'),amount=document.createElement('span');label.textContent=name;amount.id='meal-total-'+key;amount.className='meal-total';title.append(label,amount);
  card.addEventListener('toggle',()=>{if(card.open)for(const other of $('meals').children)if(other!==card)other.open=false;});
  const kcalLabel=document.createElement('label');kcalLabel.textContent='Calories consommées · kcal';
  const input=document.createElement('input');input.id='meal-'+key;input.setAttribute('form','day-form');input.type='number';input.min='0';input.max='10000';input.step='1';input.placeholder='À renseigner';input.setAttribute('aria-label',name+' : calories');kcalLabel.append(input);
  const noteLabel=document.createElement('label');noteLabel.textContent='Recettes / aliments';
  const note=document.createElement('textarea');note.id='meal-note-'+key;note.setAttribute('form','day-form');note.maxLength=1000;note.rows=2;note.placeholder='Ce que tu as mangé…';note.setAttribute('aria-label',name+' : recettes ou aliments');noteLabel.append(note);
  const body=document.createElement('div');body.className='meal-body';body.append(kcalLabel,noteLabel);card.append(title,body);$('meals').append(card);
}
function announce(message) { $('status').textContent = message; }
function storageFailure(message) { $('storage-error').hidden = false; $('storage-error').textContent = message; }
try { const saved = readLocal(); if (saved) data = M.validateBackup(JSON.parse(saved)); }
catch { locked = true; storageFailure('La sauvegarde locale est inaccessible ou illisible. Aucun écrasement ne sera effectué. Exporte la sauvegarde existante avant de résoudre ce problème.'); }
$('date').min = '1900-01-01'; $('date').max = '2100-12-31';
function draft() {
  const day = structuredClone(data.days[selected]||M.blankDay());
  for (const [key, id] of Object.entries(ids)) day[key] = $(id).value === '' ? null : Number($(id).value);
  for(const key of Object.keys(M.mealNames))day.meals[key]={kcal:$('meal-'+key).value===''?null:Number($('meal-'+key).value),note:$('meal-note-'+key).value};
  day.intakeMode=intakeMode;day.intake=intakeMode==='legacy'?legacyIntake:M.mealSummary(day).total;
  day.note = $('note').value; day.activities = structuredClone(activities); return day;
}
function persist(next,dayBase=cloudBase,profileBase=cloudProfileBase){localStorage.setItem(KEY,JSON.stringify({...next,cloudBase:dayBase,cloudProfileBase:profileBase}));}
function renderProfileCalculation(){
  const average=$('profile-mode').value!=='base';
  $('profile-maintenance-field').hidden=!average;$('profile-base-field').hidden=average;$('profile-target-field').hidden=average;
  $('profile-maintenance').disabled=!average;$('profile-base').disabled=average;$('profile-target').disabled=average;
  $('profile-goal-fields').classList.toggle('maintenance-mode',average);
  const maintenance=$('profile-maintenance').value===''?null:Number($('profile-maintenance').value),intake=$('profile-intake').value===''?null:Number($('profile-intake').value);
  const gap=maintenance===null||intake===null?null:maintenance-intake;
  const base=$('profile-base').value===''?null:Number($('profile-base').value),target=$('profile-target').value===''?null:Number($('profile-target').value);
  $('profile-calculation').textContent=average?(gap===null?'Renseigne le maintien et les apports pour obtenir le déficit prévu.':gap>=0?`Déficit prévu : ${fmt(gap)} kcal/jour (maintien − apports).`:`Surplus prévu : ${fmt(-gap)} kcal/jour (apports au-dessus du maintien).`):base===null||target===null?'Renseigne la dépense hors séances et le déficit visé pour calculer un objectif d’apports différent chaque jour.':`Jour sans activité ajoutée : objectif de ${fmt(Math.max(0,base-target))} kcal. Les calories des séances et de la marche augmenteront cet objectif.`;
  $('profile-energy-help').textContent=$('profile-mode').value==='adaptive'?'Le maintien sert de départ. Santé Connect fournit la dépense cumulée ; l’historique permet d’estimer le reste jusqu’à minuit. Sans données suffisantes, le maintien est conservé. Les séances et la marche ne sont pas ajoutées une seconde fois.':average?'Le maintien comprend déjà le repos, la digestion, les mouvements et le sport habituels, en moyenne sur la semaine. Les séances et la marche du journal ne sont pas ajoutées une seconde fois. Une dépense totale de montre remplace cette estimation.':'La dépense hors séances exclut les séances et la marche renseignées dans le journal. Objectif du jour = base + calories actives − déficit visé. Les pas seuls sont informatifs : leurs calories doivent être saisies séparément.';
}
function renderProfile(){
  if(profileDirty)return;
  $('profile-resting').value=data.profile.resting??'';
  const goals=M.goalsAt(data.profile,localDate())||M.blankGoals();
  for(const [key,id] of Object.entries(profileIds))$(id).value=goals[key]??'';
  $('profile-mode').value=goals.adaptive?'adaptive':goals.maintenance!==null||goals.base===null?'maintenance':'base';renderProfileCalculation();
  const latest=M.latestWeight(data.profile,data.days,localDate());
  $('profile-weight').value=latest?.weight??'';$('profile-weight-date').value=localDate();
  $('profile-weight-known').textContent=latest?`Dernière pesée : ${fmt(latest.weight)} kg · ${latest.date.split('-').reverse().join('/')}`:'Aucune pesée enregistrée.';
  $('profile-weight-date').min='1900-01-01';$('profile-weight-date').max=localDate();
  $('profile-save-state').textContent='Repères réutilisés chaque jour';
}
function saveProfile(){
  if(locked){announce('Le stockage est bloqué. Exporte tes données avant de recharger.');return false;}
  if(!$('profile-form').checkValidity()){navigateView('compte');$('profile-form').reportValidity();return false;}
  try{
    const next=structuredClone(data),goals=Object.fromEntries(Object.entries(profileIds).map(([key,id])=>[key,$(id).value===''?null:Number($(id).value)]));
    if($('profile-mode').value!=='base'){
      goals.base=null;const gap=goals.maintenance===null||goals.plannedIntake===null?null:goals.maintenance-goals.plannedIntake;
      goals.target=gap!==null&&gap>=0?gap:null;
    }else goals.maintenance=null;
    goals.adaptive=$('profile-mode').value==='adaptive';
    if(JSON.stringify(goals)!==JSON.stringify(M.goalsAt(next.profile,localDate())||M.blankGoals())){
      // A new setting applies from today, including any dates planned in the old journal.
      for(const date of Object.keys(next.profile.goals))if(date>localDate())delete next.profile.goals[date];
      next.profile.goals[localDate()]=goals;
    }
    next.profile.resting=$('profile-resting').value===''?null:Number($('profile-resting').value);
    const date=$('profile-weight-date').value,weight=$('profile-weight').value===''?null:Number($('profile-weight').value);
    if(profileWeightDirty && weight!==M.weightOn(next.profile,next.days,date))next.profile.weights[date]=weight;
    next.profile=M.validateProfile(next.profile);persist(next);data=next;profileDirty=false;profileWeightDirty=false;
    if(!dirty)showDay(selected);else{renderSummary();renderTrends();renderProfile();}
    $('profile-save-state').textContent='Profil enregistré sur cet appareil';announce('Profil enregistré · les nouveaux objectifs s’appliquent à partir d’aujourd’hui.');window.dispatchEvent(new Event('journal-saved'));return true;
  }catch(error){storageFailure('Enregistrement du profil impossible : '+error.message);return false;}
}
function saveAllDrafts(){if(dirty&&!save())return false;return !profileDirty||saveProfile();}
function save(message = 'Journée enregistrée sur cet appareil.') {
  if (locked) { announce('Sauvegarde bloquée : consulte le message au-dessus du journal.'); return false; }
  if (!validateDayForm()) return false;
  try {
    const profile=structuredClone(data.profile),weight=$('weight').value===''?null:Number($('weight').value);
    if(weight!==M.weightOn(profile,data.days,selected))profile.weights[selected]=weight;
    const next = M.validateBackup({version: 3, profile, days: {...data.days, [selected]: draft()}});
    persist(next); data = next; dirty = false;renderProfile();
    $('save-state').textContent = 'Enregistré sur cet appareil'; announce(message); renderSummary(); renderTrends(); window.dispatchEvent(new Event('journal-saved')); return true;
  } catch (error) { storageFailure('Enregistrement impossible : ' + error.message + ' Tes changements restent affichés.'); return false; }
}
function markDirty() { dirty = true; $('save-state').textContent = 'Modifications à enregistrer'; announce('Saisie en cours · pense à enregistrer ta journée.'); renderSummary(); }
function showDay(date) {
  selected = date; $('date').value = date;
  const day = data.days[date] || M.blankDay();editingActivityId=null;
  for (const [key, id] of Object.entries(ids)) $(id).value = day[key] ?? '';
  $('weight').value=M.weightOn(data.profile,data.days,date)??'';
  for(const key of Object.keys(M.mealNames)){$('meal-'+key).value=day.meals[key].kcal??'';$('meal-note-'+key).value=day.meals[key].note;}
  intakeMode=day.intakeMode;legacyIntake=day.intake;$('legacy-intake').hidden=intakeMode!=='legacy';$('legacy-value').textContent=fmt(legacyIntake);
  $('note').value = day.note; activities = structuredClone(day.activities); dirty = false;
  $('day-label').textContent = new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', {weekday:'long',day:'numeric',month:'long'});
  $('save-state').textContent = data.days[date] ? 'Enregistré sur cet appareil' : 'Les champs vides restent inconnus.';
  $('previous').disabled = date === '1900-01-01'; $('next').disabled = date === '2100-12-31';
  setActivityEditor();renderActivities(); renderSummary(); renderTrends();renderProfile();
}
function changeDate(date) {
  if (!M.validDate(date)) { $('date').value = selected; announce('Choisis une date valide entre 1900 et 2100.'); return false; }
  if (dirty && !save()) { $('date').value = selected; return false; }
  showDay(date); announce(data.days[date] ? 'Journée chargée.' : 'Nouvelle journée : renseigne tes valeurs.');
  return true;
}
function metric(id, value) {
  $(id).textContent = fmt(value);
  if (value !== null) { const unit = document.createElement('em'); unit.textContent = 'kcal'; $(id).append(unit); }
}
function balanceFor(day,date){
  const b=M.balance(day);
  if(day.adaptive&&window.HealthBridge){
    const p=window.HealthBridge.project(day,date),expense=p.expense;
    const budget=expense!==null&&day.target!==null?Math.max(0,expense-day.target):day.plannedIntake;
    return {plannedExpense:expense,actualExpense:expense,planned:expense===null||budget===null?null:expense-budget,actual:expense===null||day.intake===null?null:expense-day.intake};
  }return b;
}
function renderSummary() {
  const day = M.effectiveDay(draft(),data.profile,selected), b = balanceFor(day,selected);
  const health=window.HealthBridge?.render(day,selected);
  const goals=M.goalsAt(data.profile,selected)||M.blankGoals();
  $('resting-summary').textContent=data.profile.resting===null?'':`Métabolisme de base du profil : ${fmt(data.profile.resting)} kcal/j · au repos`;
  $('resting-summary').hidden=data.profile.resting===null;
  const average=goals.maintenance!==null;
  $('goals-summary').textContent=average?`Maintien moyen : ${fmt(goals.maintenance)} kcal/j · Apports prévus : ${fmt(goals.plannedIntake)} kcal/j`:`Dépense hors séances : ${fmt(goals.base)} kcal · Déficit cible : ${fmt(goals.target)} kcal · Objectif ajusté selon l’activité du jour`;
  $('activity-calculation').textContent=average?'Ton maintien inclut déjà le sport et la marche habituels. Les saisies restent visibles mais ne sont pas ajoutées au bilan. Un total quotidien de montre remplace cette estimation.':'Les calories des séances et de la marche s’ajoutent à ta dépense hors séances. Modifie-les chaque jour avec les valeurs réellement mesurées.';
  const known=M.latestWeight(data.profile,data.days,selected);
  $('known-weight').textContent=known?`Dernier poids connu : ${fmt(known.weight)} kg · pesée du ${known.date.split('-').reverse().join('/')}`:'Poids à renseigner dans ton profil ou dans Suivi.';
  const meals=M.mealSummary(day);$('intake').textContent=fmt(day.intake);
  for(const [key,meal] of Object.entries(day.meals)) $('meal-total-'+key).textContent=meal.kcal===null?'À renseigner':fmt(meal.kcal)+' kcal';
  $('overview-meals').textContent=meals.completed===null?'Ancien total conservé':`${meals.completed}/4 renseignés`;
  const stepsText=day.steps===null?'pas non renseignés':`${fmt(day.steps)} pas`;
  const imported=window.HealthBridge?.sessions(selected)||[];
  $('day-type').textContent=M.dayType(day)==='sport'||imported.length?'Journée avec sport':'Journée sans séance';
  $('movement-summary').textContent=`${stepsText} · ${day.walkingKcal===null?'calories de marche non renseignées':fmt(day.walkingKcal)+' kcal de marche'}`;
  $('overview-activities').textContent=`${imported.length} importée(s) · ${day.activities.length} saisie(s) · ${window.HealthBridge?.steps(selected)!==null&&window.HealthBridge?.steps(selected)!==undefined?fmt(window.HealthBridge.steps(selected))+' pas importés':stepsText}`;
  $('meal-progress').textContent=intakeMode==='legacy'?'L’ancien total reste utilisé. La répartition est facultative.':`${meals.completed}/4 repas renseignés · ${fmt(meals.total)} kcal${meals.completed < 4 ? ' · total provisoire' : ''}. Saisis 0 pour un repas non pris.`;
  metric('intake-value', day.intake); metric('expenditure-value', b.plannedExpense); metric('planned-value', b.planned); metric('actual-value', b.actual);
  const targetExpense=day.total!==null||!day.activities.some(a=>a.state==='planned')?b.actualExpense:b.plannedExpense;
  const intakeTarget=day.adaptive&&b.plannedExpense!==null&&day.target!==null?Math.max(0,b.plannedExpense-day.target):M.dailyIntakeTarget(day,targetExpense);
  $('intake-detail').textContent = intakeTarget === null ? 'Objectif calorique du jour à compléter' : `Objectif du jour : ${fmt(intakeTarget)} kcal`;
  window.BalanceVisual?.render({day,intakeTarget,expense:b.plannedExpense,sessions:imported,resting:data.profile.resting,state:window.HealthBridge?.activityState(selected)||{},completed:meals.completed});
  $('expenditure-detail').textContent = average?'Maintien moyen · activité habituelle incluse':b.plannedExpense === null ? 'Base ou calories actives à compléter' : 'Base + séances + marche';
  if(day.adaptive)$('expenditure-detail').textContent=health?.status==='projected'?'Projection actualisée pour minuit':health?.status==='complete'?'Total importé de la journée':health?.status==='manual'?'Total saisi manuellement':'Maintien moyen en attente de données';
  const origin = day.total !== null ? 'Total quotidien saisi' : day.adaptive&&health?.status==='projected'?'Projection à minuit':day.adaptive&&health?.status==='complete'?'Total importé':average?'Estimation au maintien moyen':'Base + séances réalisées + marche';
  $('actual-detail').textContent = b.actual === null ? 'Apports ou dépense à compléter' : `${origin}${meals.completed !== null && meals.completed < 4 ? ' · repas incomplets' : ''}${day.target !== null ? ` · cible : ${fmt(day.target)} kcal` : ''}`;
}
function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function renderActivities() {
  const box = $('activities'); box.replaceChildren();
  $('activity-count').textContent = `${activities.length} saisie${activities.length > 1 ? 's' : ''} manuelle${activities.length > 1 ? 's' : ''}`;
  if (!activities.length) { const empty = el('div', undefined, 'empty'); empty.append(el('strong','Aucune saisie manuelle.'),el('span','Ajoute ici une séance prévue ou absente des imports.')); box.append(empty); }
  activities.forEach(a => {
    const row = el('div', undefined, 'activity'), info = el('div', undefined, 'activity-info'), actions = el('div',undefined,'activity-actions');
    info.append(el('strong', a.name), el('small', `${a.minutes} min · ${a.kcal === null ? 'Calories inconnues' : fmt(a.kcal)+' kcal'} · ${M.sources[a.source]}`));
    const toggle = el('button', a.state === 'done' ? '✓ Réalisée' : 'Prévue'); toggle.type = 'button'; toggle.setAttribute('aria-label',`${a.name} : ${a.state === 'done' ? 'réalisée, marquer comme prévue' : 'prévue, marquer comme réalisée'}`);
    toggle.onclick = () => { const previous = a.state; a.state = a.state === 'done' ? 'planned' : 'done'; if (!save('État de l’activité enregistré.')) a.state = previous; renderActivities(); renderSummary(); };
    const edit = el('button', 'Modifier');edit.type='button';edit.setAttribute('aria-label',`Modifier ${a.name}`);edit.onclick=()=>setActivityEditor(a);
    const remove = el('button', '×'); remove.type = 'button'; remove.setAttribute('aria-label',`Supprimer ${a.name}`);
    remove.onclick = () => { const previous = activities; activities = activities.filter(item => item.id !== a.id); if (!save('Activité supprimée.')) activities = previous; else if(editingActivityId===a.id)setActivityEditor(); renderActivities(); renderSummary(); };
    actions.append(toggle,edit,remove); row.append(info,actions); box.append(row);
  });
}
function setActivityEditor(activity=null){
  editingActivityId=activity?.id||null;
  $('activity-form-title').textContent=activity?'Modifier la séance':'Ajouter une séance';
  $('activity-name').value=activity?.name||'';$('activity-minutes').value=activity?.minutes??'';$('activity-kcal').value=activity?.kcal??'';$('activity-state').value=activity?.state||'done';$('activity-source').value=activity?.source||'manual';
  $('activity-cancel').hidden=!activity;if(!$('activites').hidden)$('save-button').textContent=activity?'Enregistrer la séance':'+ Ajouter la séance';
  if(activity)$('activity-name').focus();
}
function emptyChart(host, title, detail) { const node = el('div', undefined, 'empty'); node.append(el('strong',title), el('span',detail)); host.replaceChildren(node); }
function svgEl(tag, attrs, text) { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k,v] of Object.entries(attrs)) node.setAttribute(k,String(v)); if (text !== undefined) node.textContent = text; return node; }
function chart(host, points, mode) {
  const values = points.flatMap(p => mode === 'energy' ? [p.planned,p.actual] : [p.weight]).filter(v => v !== null);
  if (!values.length) { emptyChart(host, mode === 'energy' ? 'Les tendances commencent ici.' : 'Ta première pesée sera le point de départ.', mode === 'energy' ? 'Enregistre une journée avec des apports et une dépense.' : 'Ajoute ton poids dans le journal, quand tu le souhaites.'); return; }
  const svg = svgEl('svg',{viewBox:'0 0 560 215',role:'img','aria-label':mode === 'energy' ? 'Bilans prévus et estimés sur 14 jours. Valeurs exactes dans le tableau historique.' : 'Pesées sur 14 jours. Valeurs exactes dans le tableau historique.'});
  let min = mode === 'energy' ? Math.min(0,...values) : Math.min(...values)-.5;
  let max = mode === 'energy' ? Math.max(0,...values) : Math.max(...values)+.5;
  if (min === max) max = min + 1;
  const y = v => 175 - (v-min)/(max-min)*148, x = i => 64 + i*36;
  for(let i=0;i<3;i++) { const v = min+(max-min)*i/2; svg.append(svgEl('line',{x1:48,x2:548,y1:y(v),y2:y(v),stroke:'#e3eaee'}),svgEl('text',{x:42,y:y(v)+4,'text-anchor':'end'},fmt(Math.round(v*10)/10))); }
  if (mode === 'energy') svg.append(svgEl('line',{x1:48,x2:548,y1:y(0),y2:y(0),stroke:'#a6b9c2'}));
  let previous = null;
  points.forEach((p,i) => {
    if (i%3 === 0 || i === 13) svg.append(svgEl('text',{x:x(i),y:202,'text-anchor':'middle'},p.date.slice(8)+'/'+p.date.slice(5,7)));
    if (mode === 'energy') {
      for (const [key,offset,color] of [['planned',-10,'#b0c1ce'],['actual',2,'#25765c']]) {
        if (p[key] === null) continue;
        const rect = svgEl('rect',{x:x(i)+offset,y:Math.min(y(0),y(p[key])),width:9,height:Math.max(2,Math.abs(y(0)-y(p[key]))),rx:2,fill:color});
        rect.append(svgEl('title',{},`${p.date} · ${key === 'planned' ? 'Prévu' : 'Estimé'} : ${fmt(p[key])} kcal`)); svg.append(rect);
      }
    } else if (p.weight !== null) {
      if (previous) svg.append(svgEl('line',{x1:previous.x,y1:previous.y,x2:x(i),y2:y(p.weight),stroke:'#25765c','stroke-width':2}));
      const dot = svgEl('circle',{cx:x(i),cy:y(p.weight),r:4,fill:'#25765c'}); dot.append(svgEl('title',{},`${p.date} : ${fmt(p.weight)} kg`));svg.append(dot);previous={x:x(i),y:y(p.weight)};
    }
  });host.replaceChildren(svg);
}
function renderTrends() {
  const points = Array.from({length:14},(_,i) => { const date = M.shiftDate(selected,i-13), day = data.days[date]; return {date,...(day ? balanceFor(M.effectiveDay(day,data.profile,date),date) : {planned:null,actual:null}),weight:M.weightOn(data.profile,data.days,date)}; });
  chart($('energy-chart'),points,'energy'); chart($('weight-chart'),points,'weight');
  const weights = points.slice(-7).filter(p => p.weight !== null).map(p => p.weight);
  $('weight-average').textContent = weights.length ? `Moy. 7 j : ${fmt(weights.reduce((a,b)=>a+b,0)/weights.length)} kg · ${weights.length} pesée${weights.length > 1 ? 's' : ''}` : 'Aucune pesée sur 7 jours';
  const body = $('history'); body.replaceChildren();
  const dates = [...new Set([...Object.keys(data.days),...(window.HealthBridge?.dates()||[]),...Object.keys(data.profile.weights).filter(date=>data.profile.weights[date]!==null)])].sort().reverse().slice(0,30);
  if (!dates.length) { const td = el('td','Aucune journée enregistrée pour le moment.');td.colSpan=8; const row=el('tr');row.append(td);body.append(row); }
  dates.forEach(date => {
    const day=M.effectiveDay(data.days[date],data.profile,date),b=balanceFor(day,date),weight=M.weightOn(data.profile,data.days,date),row=el('tr'),td=el('td'),button=el('button',new Date(date+'T12:00:00').toLocaleDateString('fr-FR'));
    const imported=window.HealthBridge?.sessions(date)||[];
    button.type='button'; button.onclick=()=>{if(changeDate(date))navigateView('bilan');};td.append(button);row.append(td,el('td',M.dayType(day)==='sport'||imported.length?'Sport':'Sans séance'));
    [day.intake,b.planned,b.actual].forEach(v=>row.append(el('td',v === null ? '—' : fmt(v)+' kcal')));
    row.append(el('td',weight===null?'—':fmt(weight)+' kg'),el('td',fmt(window.HealthBridge?.steps(date)??day.steps)),el('td',`${imported.length} importées · ${day.activities.length} saisies`));body.append(row);
  });
}
document.addEventListener('input',e=>{if(e.target.form===$('day-form'))markDirty();});
$('profile-form').addEventListener('input',e=>{profileDirty=true;if(['profile-weight','profile-weight-date'].includes(e.target.id))profileWeightDirty=true;$('profile-save-state').textContent='Modifications à enregistrer';renderProfileCalculation();});
$('profile-form').addEventListener('submit',e=>{e.preventDefault();if(dirty&&!save())return;saveProfile();});
$('day-form').addEventListener('submit',e=>{e.preventDefault();if(save())window.dispatchEvent(new Event('journal-saved'));});
$('use-meals').onclick=()=>{intakeMode='meals';$('legacy-intake').hidden=true;markDirty();};
$('activity-form').addEventListener('submit',e=>{
  e.preventDefault();
  if (!$('activity-name').value.trim()) { $('activity-name').setCustomValidity('Renseigne le nom de l’activité.');$('activity-name').reportValidity();return; }
  const a={id:editingActivityId||crypto.randomUUID(),name:$('activity-name').value.trim(),minutes:Number($('activity-minutes').value),kcal:$('activity-kcal').value===''?null:Number($('activity-kcal').value),state:$('activity-state').value,source:$('activity-source').value};
  const previous=structuredClone(activities),index=activities.findIndex(item=>item.id===editingActivityId);if(index>=0)activities[index]=a;else activities.push(a);
  if(save(editingActivityId?'Séance mise à jour.':'Séance et journée enregistrées.')){setActivityEditor();renderActivities();window.dispatchEvent(new Event('journal-saved'));}else{activities=previous;renderSummary();}
});
$('activity-name').addEventListener('input',()=> $('activity-name').setCustomValidity(''));
$('activity-cancel').onclick=()=>setActivityEditor();
$('save-movement').onclick=()=>save('Pas et marche enregistrés.');
$('date').addEventListener('change',()=>changeDate($('date').value));
$('previous').onclick=()=>changeDate(M.shiftDate(selected,-1));$('next').onclick=()=>changeDate(M.shiftDate(selected,1));$('today').onclick=()=>changeDate(localDate());
window.addEventListener('beforeunload',e=>{if(dirty||profileDirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('storage',e=>{if(e.key===KEY || e.key===null){locked=true;storageFailure('Les données ont changé dans un autre onglet. Copie tes champs non enregistrés avant de recharger cette page. L’export récupère la dernière sauvegarde locale, pas les champs non enregistrés.');}});
$('export').onclick=()=>{
  let content;
  if(locked){try{content=localStorage.getItem(KEY)||(KEY===LOCAL_KEY?readLocal():localStorage.getItem(KEY.replace('equilibre-account-v4-','equilibre-account-v3-'))||localStorage.getItem(KEY.replace('equilibre-account-v4-','equilibre-account-')));}catch{}if(!content){announce('La sauvegarde locale ne peut pas être lue.');return;}}
  else{try{if(!saveAllDrafts())return;content=JSON.stringify({...data,exportedAt:new Date().toISOString()},null,2);}catch(error){announce('Export impossible : '+error.message);return;}}
  const url=URL.createObjectURL(new Blob([content],{type:'application/json'})),a=el('a');a.href=url;a.download=`equilibre-${localDate()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);announce('Sauvegarde exportée. Conserve-la dans un emplacement personnel.');
};
$('import').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(locked)throw Error('Le stockage est bloqué. Recharge après avoir sauvegardé les données existantes.');
    if(file.size>10000000)throw Error('Fichier trop volumineux (10 Mo maximum).');
    if(!saveAllDrafts())return;
    const incoming=M.validateBackup(JSON.parse(await file.text()));
    const result=M.mergeBackup(data,incoming);persist(result.data);data=result.data;showDay(selected);window.dispatchEvent(new Event('journal-saved'));
    announce(`${result.added} journée(s) importée(s), ${result.skipped} journée(s) déjà présentes conservées.`);
  }catch(error){announce('Import impossible : '+error.message);}finally{e.target.value='';}
});
showDay(selected);
if (data.days[selected]) announce('Ta dernière saisie a été chargée.');
// Storage boundary shared with cloud.js. Remote updates never replace an unsaved form.
window.Journal={
  today:localDate,refreshHealth(){renderSummary();renderTrends();},
  snapshot:()=>structuredClone(data), base:()=>structuredClone(cloudBase), blocked:()=>locked,
  hasDraft:()=>dirty||profileDirty,
  saveDraft:saveAllDrafts,
  profile:()=>structuredClone(data.profile),profileBase:()=>structuredClone(cloudProfileBase),
  applyProfile(profile,base){
    if(locked)throw Error('Recharge la page avant de synchroniser.');
    const next={...data,profile:M.validateProfile(profile)};persist(next,cloudBase,base);data=next;cloudProfileBase=structuredClone(base);
    if(!dirty)showDay(selected);else{renderSummary();renderTrends();renderProfile();}
  },
  localData:()=>M.validateBackup(JSON.parse(readLocal()||'{"version":2,"days":{}}')),
  activate(userId){
    if(!saveAllDrafts())return false;
    KEY=userId?'equilibre-account-v4-'+userId:LOCAL_KEY;locked=false;cloudBase={};cloudProfileBase=null;$('storage-error').hidden=true;
    $('profile-scope').textContent=userId?'Lié à ton compte':'Sur cet appareil';
    try{const raw=JSON.parse(localStorage.getItem(KEY)||(userId?localStorage.getItem('equilibre-account-v3-'+userId)||localStorage.getItem('equilibre-account-'+userId):readLocal())||'{"version":2,"days":{}}');data=M.validateBackup(raw);if(userId && raw.cloudBase)cloudBase=M.validateBackup({version:2,days:raw.cloudBase}).days;if(userId&&raw.cloudProfileBase)cloudProfileBase=M.validateProfile(raw.cloudProfileBase);else if(userId&&raw.version<3&&raw.cloudBase)cloudProfileBase=M.profileFromDays(cloudBase);}
    catch{locked=true;data={version:4,days:{},profile:M.blankProfile()};storageFailure('La copie locale de ce compte est illisible. Exporte-la avant de poursuivre.');}
    showDay(selected);return !locked;
  },
  apply(next,base){
    if(locked)throw Error('Recharge la page avant de synchroniser.');
    const clean=M.validateBackup(next);persist(clean,base);data=clean;cloudBase=structuredClone(base);
    if(!dirty)showDay(selected);else renderTrends();
  }
};

'use strict';
const M = window.Equilibre;
const $ = id => document.getElementById(id);
const LOCAL_KEY = 'equilibre-journal-v2';
let KEY = LOCAL_KEY;
const number = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 2});
const fmt = n => n === null ? '—' : number.format(n);
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const ids = {plannedIntake: 'planned-intake', base: 'base', target: 'target', total: 'total', weight: 'weight'};
let data = {version: 2, days: {}}, selected = localDate(), activities = [], dirty = false, locked = false, intakeMode = 'meals', legacyIntake = null, cloudBase = {};
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
  $('save-button').textContent = id === 'activites' ? '+ Ajouter l’activité' : 'Enregistrer la journée';
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
try { const saved = localStorage.getItem(KEY) || localStorage.getItem('equilibre-journal-v1'); if (saved) data = M.validateBackup(JSON.parse(saved)); }
catch { locked = true; storageFailure('La sauvegarde locale est inaccessible ou illisible. Aucun écrasement ne sera effectué. Exporte la sauvegarde existante avant de résoudre ce problème.'); }
$('date').min = '1900-01-01'; $('date').max = '2100-12-31';
function draft() {
  const day = M.blankDay();
  for (const [key, id] of Object.entries(ids)) day[key] = $(id).value === '' ? null : Number($(id).value);
  for(const key of Object.keys(M.mealNames))day.meals[key]={kcal:$('meal-'+key).value===''?null:Number($('meal-'+key).value),note:$('meal-note-'+key).value};
  day.intakeMode=intakeMode;day.intake=intakeMode==='legacy'?legacyIntake:M.mealSummary(day).total;
  day.note = $('note').value; day.activities = structuredClone(activities); return day;
}
function save(message = 'Journée enregistrée sur cet appareil.') {
  if (locked) { announce('Sauvegarde bloquée : consulte le message au-dessus du journal.'); return false; }
  if (!validateDayForm()) return false;
  try {
    const next = M.validateBackup({version: 2, days: {...data.days, [selected]: draft()}});
    localStorage.setItem(KEY, JSON.stringify({...next,cloudBase})); data = next; dirty = false;
    $('save-state').textContent = 'Enregistré sur cet appareil'; announce(message); renderSummary(); renderTrends(); window.dispatchEvent(new Event('journal-saved')); return true;
  } catch (error) { storageFailure('Enregistrement impossible : ' + error.message + ' Tes changements restent affichés.'); return false; }
}
function markDirty() { dirty = true; $('save-state').textContent = 'Modifications à enregistrer'; announce('Saisie en cours · pense à enregistrer ta journée.'); renderSummary(); }
function showDay(date) {
  selected = date; $('date').value = date;
  const day = data.days[date] || M.blankDay();
  for (const [key, id] of Object.entries(ids)) $(id).value = day[key] ?? '';
  for(const key of Object.keys(M.mealNames)){$('meal-'+key).value=day.meals[key].kcal??'';$('meal-note-'+key).value=day.meals[key].note;}
  intakeMode=day.intakeMode;legacyIntake=day.intake;$('legacy-intake').hidden=intakeMode!=='legacy';$('legacy-value').textContent=fmt(legacyIntake);
  $('note').value = day.note; activities = structuredClone(day.activities); dirty = false;
  $('day-label').textContent = new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', {weekday:'long',day:'numeric',month:'long'});
  $('save-state').textContent = data.days[date] ? 'Enregistré sur cet appareil' : 'Les champs vides restent inconnus.';
  $('previous').disabled = date === '1900-01-01'; $('next').disabled = date === '2100-12-31';
  renderActivities(); renderSummary(); renderTrends();
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
function renderSummary() {
  const day = draft(), b = M.balance(day);
  const meals=M.mealSummary(day);$('intake').textContent=fmt(day.intake);
  for(const [key,meal] of Object.entries(day.meals)) $('meal-total-'+key).textContent=meal.kcal===null?'À renseigner':fmt(meal.kcal)+' kcal';
  $('overview-meals').textContent=meals.completed===null?'Ancien total conservé':`${meals.completed}/4 renseignés`;
  const completedActivities=day.activities.filter(a=>a.state==='done').length;
  $('overview-activities').textContent=`${day.activities.length} séance${day.activities.length>1?'s':''} · ${completedActivities} réalisée${completedActivities>1?'s':''}`;
  $('meal-progress').textContent=intakeMode==='legacy'?'L’ancien total reste utilisé. La répartition est facultative.':`${meals.completed}/4 repas renseignés · ${fmt(meals.total)} kcal${meals.completed < 4 ? ' · total provisoire' : ''}. Saisis 0 pour un repas non pris.`;
  metric('intake-value', day.intake); metric('expenditure-value', b.plannedExpense); metric('planned-value', b.planned); metric('actual-value', b.actual);
  $('intake-detail').textContent = day.plannedIntake === null ? 'Apports prévus non renseignés' : `Apports prévus : ${fmt(day.plannedIntake)} kcal`;
  $('expenditure-detail').textContent = b.plannedExpense === null ? 'Base ou calories des séances à compléter' : 'Base + toutes les séances du jour';
  const origin = day.total !== null ? 'Dépense totale saisie' : 'Base + séances réalisées';
  $('actual-detail').textContent = b.actual === null ? 'Apports ou dépense à compléter' : `${origin}${meals.completed !== null && meals.completed < 4 ? ' · repas incomplets' : ''}${day.target !== null ? ` · cible : ${fmt(day.target)} kcal` : ''}`;
}
function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function renderActivities() {
  const box = $('activities'); box.replaceChildren();
  $('activity-count').textContent = `${activities.length} séance${activities.length > 1 ? 's' : ''}`;
  if (!activities.length) { const empty = el('div', undefined, 'empty'); empty.append(el('strong','Une marche, une séance, un peu de mouvement.'),el('span','Ajoute une activité prévue ou réalisée.')); box.append(empty); }
  activities.forEach(a => {
    const row = el('div', undefined, 'activity'), info = el('div', undefined, 'activity-info'), actions = el('div',undefined,'activity-actions');
    info.append(el('strong', a.name), el('small', `${a.minutes} min · ${a.kcal === null ? 'Calories inconnues' : fmt(a.kcal)+' kcal'} · ${M.sources[a.source]}`));
    const toggle = el('button', a.state === 'done' ? '✓ Réalisée' : 'Prévue'); toggle.type = 'button'; toggle.setAttribute('aria-label',`${a.name} : ${a.state === 'done' ? 'réalisée, marquer comme prévue' : 'prévue, marquer comme réalisée'}`);
    toggle.onclick = () => { const previous = a.state; a.state = a.state === 'done' ? 'planned' : 'done'; if (!save('État de l’activité enregistré.')) a.state = previous; renderActivities(); renderSummary(); };
    const remove = el('button', '×'); remove.type = 'button'; remove.setAttribute('aria-label',`Supprimer ${a.name}`);
    remove.onclick = () => { const previous = activities; activities = activities.filter(item => item.id !== a.id); if (!save('Activité supprimée.')) activities = previous; renderActivities(); renderSummary(); };
    actions.append(toggle,remove); row.append(info,actions); box.append(row);
  });
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
  const points = Array.from({length:14},(_,i) => { const date = M.shiftDate(selected,i-13), day = data.days[date]; return {date,...(day ? M.balance(day) : {planned:null,actual:null}),weight:day?.weight ?? null}; });
  chart($('energy-chart'),points,'energy'); chart($('weight-chart'),points,'weight');
  const weights = points.slice(-7).filter(p => p.weight !== null).map(p => p.weight);
  $('weight-average').textContent = weights.length ? `Moy. 7 j : ${fmt(weights.reduce((a,b)=>a+b,0)/weights.length)} kg · ${weights.length} pesée${weights.length > 1 ? 's' : ''}` : 'Aucune pesée sur 7 jours';
  const body = $('history'); body.replaceChildren();
  const dates = Object.keys(data.days).sort().reverse().slice(0,30);
  if (!dates.length) { const td = el('td','Aucune journée enregistrée pour le moment.');td.colSpan=6; const row=el('tr');row.append(td);body.append(row); }
  dates.forEach(date => {
    const day=data.days[date],b=M.balance(day),row=el('tr'),td=el('td'),button=el('button',new Date(date+'T12:00:00').toLocaleDateString('fr-FR'));
    button.type='button'; button.onclick=()=>{if(changeDate(date))navigateView('bilan');};td.append(button);row.append(td);
    [day.intake,b.planned,b.actual].forEach(v=>row.append(el('td',v === null ? '—' : fmt(v)+' kcal')));
    row.append(el('td',day.weight===null?'—':fmt(day.weight)+' kg'),el('td',String(day.activities.length)));body.append(row);
  });
}
document.addEventListener('input',e=>{if(e.target.form===$('day-form'))markDirty();});
$('day-form').addEventListener('submit',e=>{e.preventDefault();if(save())window.dispatchEvent(new Event('journal-saved'));});
$('use-meals').onclick=()=>{intakeMode='meals';$('legacy-intake').hidden=true;markDirty();};
$('activity-form').addEventListener('submit',e=>{
  e.preventDefault();
  if (!$('activity-name').value.trim()) { $('activity-name').setCustomValidity('Renseigne le nom de l’activité.');$('activity-name').reportValidity();return; }
  const a={id:crypto.randomUUID(),name:$('activity-name').value.trim(),minutes:Number($('activity-minutes').value),kcal:$('activity-kcal').value===''?null:Number($('activity-kcal').value),state:$('activity-state').value,source:$('activity-source').value};
  activities.push(a);if(save('Activité et journée enregistrées.')){$('activity-form').reset();renderActivities();window.dispatchEvent(new Event('journal-saved'));}else{activities.pop();renderSummary();}
});
$('activity-name').addEventListener('input',()=> $('activity-name').setCustomValidity(''));
$('date').addEventListener('change',()=>changeDate($('date').value));
$('previous').onclick=()=>changeDate(M.shiftDate(selected,-1));$('next').onclick=()=>changeDate(M.shiftDate(selected,1));$('today').onclick=()=>changeDate(localDate());
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('storage',e=>{if(e.key===KEY || e.key===null){locked=true;storageFailure('Les données ont changé dans un autre onglet. Copie tes champs non enregistrés avant de recharger cette page. L’export récupère la dernière sauvegarde locale, pas les champs non enregistrés.');}});
$('export').onclick=()=>{
  let content;
  if(locked){try{content=localStorage.getItem(KEY);}catch{}if(!content){announce('La sauvegarde locale ne peut pas être lue.');return;}}
  else{try{if(dirty&&!validateDayForm())return;const snapshot=M.validateBackup(dirty?{version:2,days:{...data.days,[selected]:draft()}}:data);content=JSON.stringify({...snapshot,exportedAt:new Date().toISOString()},null,2);}catch(error){announce('Export impossible : '+error.message);return;}}
  const url=URL.createObjectURL(new Blob([content],{type:'application/json'})),a=el('a');a.href=url;a.download=`equilibre-${localDate()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);announce('Sauvegarde exportée. Conserve-la dans un emplacement personnel.');
};
$('import').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(locked)throw Error('Le stockage est bloqué. Recharge après avoir sauvegardé les données existantes.');
    if(file.size>10000000)throw Error('Fichier trop volumineux (10 Mo maximum).');
    if(dirty&&!save())return;
    const incoming=M.validateBackup(JSON.parse(await file.text()));
    const result=M.mergeBackup(data,incoming);localStorage.setItem(KEY,JSON.stringify({...result.data,cloudBase}));data=result.data;showDay(selected);window.dispatchEvent(new Event('journal-saved'));
    announce(`${result.added} journée(s) importée(s), ${result.skipped} journée(s) déjà présentes conservées.`);
  }catch(error){announce('Import impossible : '+error.message);}finally{e.target.value='';}
});
showDay(selected);
if (data.days[selected]) announce('Ta dernière saisie a été chargée.');
// Storage boundary shared with cloud.js. Remote updates never replace an unsaved form.
window.Journal={
  snapshot:()=>structuredClone(data), base:()=>structuredClone(cloudBase), blocked:()=>locked,
  hasDraft:()=>dirty,
  saveDraft:()=>!dirty||save(),
  localData:()=>M.validateBackup(JSON.parse(localStorage.getItem(LOCAL_KEY)||localStorage.getItem('equilibre-journal-v1')||'{"version":2,"days":{}}')),
  activate(userId){
    if(dirty&&!save())return false;
    KEY=userId?'equilibre-account-'+userId:LOCAL_KEY;locked=false;cloudBase={};$('storage-error').hidden=true;
    try{const raw=JSON.parse(localStorage.getItem(KEY)||(!userId&&localStorage.getItem('equilibre-journal-v1'))||'{"version":2,"days":{}}');data=M.validateBackup(raw);if(userId && raw.cloudBase)cloudBase=M.validateBackup({version:2,days:raw.cloudBase}).days;}
    catch{locked=true;data={version:2,days:{}};storageFailure('La copie locale de ce compte est illisible. Exporte-la avant de poursuivre.');}
    showDay(selected);return !locked;
  },
  apply(next,base){
    if(locked)throw Error('Recharge la page avant de synchroniser.');
    const clean=M.validateBackup(next);localStorage.setItem(KEY,JSON.stringify({...clean,cloudBase:base}));data=clean;cloudBase=structuredClone(base);
    if(!dirty)showDay(selected);else renderTrends();
  }
};

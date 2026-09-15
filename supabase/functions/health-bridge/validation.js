import * as health from '../../../health-model.js';
const H=globalThis.EquilibreHealth||health.default;
export function validateUpload(body,now=Date.now()){
  if(!Array.isArray(body.snapshots)||body.snapshots.length<1||body.snapshots.length>31)throw Error('Envoi limité à 31 journées.');
  const seen=new Set();return body.snapshots.map(raw=>{
    const s=H.validateSnapshot(raw),key=s.day+'|'+s.source;
    if(seen.has(key))throw Error('Journée envoyée deux fois.');seen.add(key);
    if(Date.parse(s.capturedAt)>now+300000||Date.parse(s.capturedAt)<now-7*86400000||Date.parse(s.start)<now-40*86400000||Date.parse(s.start)>now+86400000)throw Error('Date d’envoi invalide.');
    const actualDay=new Intl.DateTimeFormat('en-CA',{timeZone:s.zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(s.start));
    if(actualDay!==s.day)throw Error('La date ne correspond pas au fuseau.');
    return s;
  });
}

import {createClient} from 'npm:@supabase/supabase-js@2.116.0';
import {validateUpload} from './validation.js';

const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const allowed=new Set(['https://bch-bmbed.github.io','http://127.0.0.1:8766']);
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
function fail(status:number,message:string){throw {status,message};}
Deno.serve(async(req:Request)=>{
  const origin=req.headers.get('origin');
  const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
  if(origin&&allowed.has(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'});
  const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
  if(origin&&!allowed.has(origin))return reply(403,{error:'Origine interdite.'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,{error:'Méthode interdite.'});
  try{
    if(Number(req.headers.get('content-length'))>600000)fail(413,'Envoi trop volumineux.');
    const reader=req.body?.getReader();if(!reader)fail(400,'Envoi vide.');
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const {done,value}=await reader!.read();if(done)break;size+=value.length;if(size>600000){await reader!.cancel();fail(413,'Envoi trop volumineux.');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'JSON invalide.');}
    if(body.action==='sync'){
      if(typeof body.deviceId!=='string'||!/^[0-9a-f-]{36}$/.test(body.deviceId)||typeof body.token!=='string'||!/^[0-9a-f]{64}$/.test(body.token))fail(401,'Association invalide.');
      const {data:device,error}=await db.from('health_bridge_devices').select('user_id,revoked_at').eq('id',body.deviceId).eq('token_hash',await hash(body.token)).maybeSingle();
      if(error)fail(503,'Service indisponible.');if(!device||device.revoked_at)fail(401,'Passerelle révoquée ou code invalide.');
      let snapshots;try{snapshots=validateUpload(body);}catch(e){fail(400,(e as Error).message);}
      const saved=await db.rpc('ingest_health_snapshots',{p_user:device.user_id,p_snapshots:snapshots});if(saved.error)fail(503,'Données non enregistrées. Réessaie.');
      await db.from('health_bridge_devices').update({last_seen_at:new Date().toISOString()}).eq('id',body.deviceId).is('revoked_at',null);
      return reply(200,{saved:saved.data});
    }
    // Creating/revoking a bridge always requires a verified account session.
    const bearer=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];if(!bearer)fail(401,'Connecte-toi au dashboard.');
    const {data:auth,error:authError}=await db.auth.getUser(bearer);if(authError||!auth.user)fail(401,'Session expirée.');
    if(body.action==='create'){
      const name=typeof body.name==='string'?body.name.trim():'';if(!name||name.length>80)fail(400,'Nom de téléphone invalide.');
      const existing=await db.from('health_bridge_devices').select('id',{count:'exact',head:true}).eq('user_id',auth.user!.id).is('revoked_at',null);
      if(existing.error)fail(503,'Service indisponible.');if((existing.count??0)>=5)fail(409,'Désactive une ancienne passerelle avant d’en ajouter une.');
      const token=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join('');
      const inserted=await db.from('health_bridge_devices').insert({user_id:auth.user!.id,name,token_hash:await hash(token)}).select('id').single();if(inserted.error)fail(503,'Association non créée.');
      return reply(200,{code:`EQ1.${inserted.data.id}.${token}`});
    }
    if(body.action==='revoke'){
      const updated=await db.from('health_bridge_devices').update({revoked_at:new Date().toISOString()}).eq('id',body.deviceId).eq('user_id',auth.user!.id).select('id');
      if(updated.error)fail(503,'Désactivation impossible.');return reply(200,{revoked:updated.data.length});
    }
    return reply(400,{error:'Action inconnue.'});
  }catch(e){const err=e as {status?:number;message?:string};return reply(err.status??500,{error:err.status?err.message:'Service momentanément indisponible.'});}
});

import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getStore } from "@/db/raw";
import { ensureSpace,identity,readState,promote,ageAt } from "@/lib/service";
import { z } from "zod";
export const dynamic="force-dynamic";
const profileSchema=z.object({name:z.string().trim().min(2).max(40),dob:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),gender:z.enum(["Woman","Man","Nonbinary"]),city:z.string().trim().min(2).max(60),job:z.string().trim().max(80),bio:z.string().trim().min(10).max(700),intent:z.enum(["Long-term relationship","Open to exploring","Life partner"]),interests:z.array(z.string().trim().min(1).max(30)).max(8),photos:z.array(z.string().max(500)).max(6),prompt:z.string().trim().max(400),paused:z.boolean()});
function json(value:any,status=200){return Response.json(value,{status,headers:{"Cache-Control":"no-store"}});}
export async function GET(request:Request){try{
 const user=await getChatGPTUser();if(!user)return json({error:"Sign in to continue."},401);
 const mode=new URL(request.url).searchParams.get("mode")==="live"?"live":"demo";const db=getStore();
 let filters:unknown={};try{filters=JSON.parse(new URL(request.url).searchParams.get("filters")||"{}");}catch{}
 await ensureSpace(db,user.userId,mode);return json(await readState(db,user.userId,mode,filters));
}catch(e){console.error("DBD state:",e);return json({error:"We couldn't load your connections. Please try again."},503);}}
export async function POST(request:Request){
 let db:ReturnType<typeof getStore>|null=null;let key="",payload="";
 try{
 const user=await getChatGPTUser();if(!user)return json({error:"Sign in to continue."},401);
 if(request.headers.get("origin")!==new URL(request.url).origin)return json({error:"This request must come from Date-By-Date."},403);
 if(!request.headers.get("content-type")?.includes("application/json"))return json({error:"JSON required."},415);
 const raw=await request.text();if(raw.length>20000)return json({error:"That entry is too long."},413);
 const body=JSON.parse(raw);const mode=body.mode==="live"?"live":"demo";
 if(typeof body.requestId!=="string"||!/^[-a-zA-Z0-9]{8,80}$/.test(body.requestId))return json({error:"A request ID is required."},400);
 db=getStore();await ensureSpace(db,user.userId,mode);
 const {scope,id}=identity(user.userId,mode);key=id+":"+body.requestId;payload=JSON.stringify(body);
 const old:any=await db.prepare("SELECT payload FROM requests WHERE id=?").bind(key).first();
 if(old){if(old.payload!==payload)return json({error:"Request ID already used."},409);return json(await readState(db,user.userId,mode,body.filters));}
 const stmts=[db.prepare("INSERT INTO requests(id,payload,created) VALUES(?,?,?)").bind(key,payload,Date.now())];
 const me:any=await db.prepare("SELECT * FROM profiles WHERE id=?").bind(id).first();
 const action=body.action;const target=typeof body.target==="string"?body.target:"";
 const blocked=target?await db.prepare("SELECT id FROM blocks WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)").bind(id,target,target,id).first():null;
 const other:any=target?await db.prepare("SELECT id FROM profiles WHERE id=? AND scope=? AND id<>?").bind(target,scope,id).first():null;
 if(["like","pass","withdraw","block","report"].includes(action)&&(!other||blocked))return json({error:"This profile is unavailable."},404);
 if(!me&&action!=="profile")return json({error:"Create your profile first."},400);
 if(action==="profile"){
  if(!me&&body.consent!==true)return json({error:"Confirm the adult eligibility and dating-activity visibility terms."},400);
  const p=profileSchema.parse(body.profile);const dob=p.dob||me?.dob;
  if(!dob||!Number.isFinite(Date.parse(dob+"T00:00:00Z"))||new Date(dob+"T00:00:00Z").toISOString().slice(0,10)!==dob||ageAt(dob)<18||ageAt(dob)>120)return json({error:"Date-By-Date is for adults 18 and older. Enter a valid birth date."},400);
  if(mode==="live"&&!p.photos.length)return json({error:"Add at least one profile photo."},400);
  const previous:string[]=me?JSON.parse(me.photos):[];
  for(const photo of p.photos){if(previous.includes(photo))continue;const pid=photo.match(/^\/api\/photos\/([a-f0-9-]{36})$/)?.[1];if(!pid||!(await db.prepare("SELECT id FROM photos WHERE id=? AND owner=? AND scope=?").bind(pid,id,scope).first()))return json({error:"Upload your own profile photos."},400);}
  stmts.push(db.prepare("INSERT INTO profiles(id,scope,name,dob,gender,city,job,bio,intent,interests,photos,prompt,paused,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,dob=excluded.dob,gender=excluded.gender,city=excluded.city,job=excluded.job,bio=excluded.bio,intent=excluded.intent,interests=excluded.interests,photos=excluded.photos,prompt=excluded.prompt,paused=excluded.paused").bind(id,scope,p.name,dob,p.gender,p.city,p.job,p.bio,p.intent,JSON.stringify(p.interests),JSON.stringify(p.photos),p.prompt,p.paused?1:0,Date.now()));
  if(!p.paused)for(let i=0;i<5;i++)stmts.push(promote(db,id));
 }else if(action==="like"){
  stmts.push(db.prepare("INSERT OR IGNORE INTO likes(sender,recipient) VALUES(?,?)").bind(id,target));
  stmts.push(db.prepare("DELETE FROM passes WHERE sender=? AND recipient=?").bind(id,target));for(let i=0;i<5;i++)stmts.push(promote(db,target),promote(db,id));
 }else if(action==="pass"){
  stmts.push(db.prepare("INSERT OR IGNORE INTO passes(sender,recipient) VALUES(?,?)").bind(id,target));
  stmts.push(db.prepare("DELETE FROM likes WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)").bind(id,target,target,id));
 }else if(action==="withdraw"){
  stmts.push(db.prepare("DELETE FROM likes WHERE sender=? AND recipient=?").bind(id,target));
 }else if(action==="undo"){
  const current=await readState(db,user.userId,mode);if(!current.plans.capacity)return json({error:"Unlimited undo is included with DBD Plus."},403);if(current.viewer&&current.viewer.activeCount>=current.viewer.capacity)return json({error:"Discovery is paused at capacity."},409);
  stmts.push(db.prepare("DELETE FROM passes WHERE id=(SELECT id FROM passes WHERE sender=? ORDER BY id DESC LIMIT 1)").bind(id));
 }else if(action==="unmatch"||action==="block"||action==="report"){
  if(action==="report"){
   const reason=z.enum(["Inappropriate behavior","Fake profile","Harassment","Under 18","Other"]).parse(body.reason);
   const details=z.string().trim().max(1200).parse(body.details||"");
   stmts.push(db.prepare("INSERT INTO reports(id,reporter,target,reason,details,created) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),id,target,reason,details,Date.now()));
  }
  if(action==="unmatch"){
   const match:any=await db.prepare("SELECT * FROM matches WHERE id=? AND ended IS NULL AND (a=? OR b=?)").bind(String(body.matchId),id,id).first();
   if(match){
    stmts.push(db.prepare("UPDATE matches SET ended=?,operation=? WHERE id=? AND ended IS NULL AND (a=? OR b=?)").bind(Date.now(),key,match.id,id,id));
    stmts.push(db.prepare("DELETE FROM likes WHERE ((sender=? AND recipient=?) OR (sender=? AND recipient=?)) AND EXISTS(SELECT 1 FROM matches WHERE id=? AND operation=?)").bind(match.a,match.b,match.b,match.a,match.id,key));
    for(const person of [match.a,match.b].sort())for(let i=0;i<5;i++)stmts.push(promote(db,person,key));
   }
  }else{
   stmts.push(db.prepare("INSERT OR IGNORE INTO blocks(sender,recipient) VALUES(?,?)").bind(id,target));
   stmts.push(db.prepare("DELETE FROM likes WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)").bind(id,target,target,id));
   stmts.push(db.prepare("UPDATE matches SET ended=?,operation=? WHERE ended IS NULL AND ((a=? AND b=?) OR (a=? AND b=?))").bind(Date.now(),key,id,target,target,id));
   for(const person of [id,target].sort())for(let i=0;i<5;i++)stmts.push(promote(db,person,key));
  }
 }else if(action==="message"||action==="date"||action==="respond-date"||action==="demo-reply"){
  const match:any=await db.prepare("SELECT * FROM matches WHERE id=? AND ended IS NULL AND (a=? OR b=?)").bind(String(body.matchId),id,id).first();
  if(!match)return json({error:"This connection has ended."},409);
  if(action==="message"||action==="demo-reply"){
   if(action==="demo-reply"&&mode!=="demo")return json({error:"Demo only."},403);
   const message=action==="demo-reply"?"Demo reply: A coffee walk sounds lovely. What's your favorite spot?":z.string().trim().min(1).max(2000).parse(body.text);
   const sender=action==="demo-reply"?(match.a===id?match.b:match.a):id;
   stmts.push(db.prepare("INSERT INTO messages(id,match_id,sender,body,created) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(),match.id,sender,message,Date.now()));
  }else if(action==="date"){
   const venue=z.string().trim().min(2).max(160).parse(body.venue),occurs=z.string().datetime().parse(body.occurs);
   if(Date.parse(occurs)<Date.now())return json({error:"Choose a future date and time."},400);
   stmts.push(db.prepare("INSERT INTO dates(id,match_id,sender,venue,occurs) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(),match.id,id,venue,occurs));
  }else{const status=z.enum(["accepted","declined","cancelled"]).parse(body.status);
   stmts.push(db.prepare("UPDATE dates SET status=? WHERE id=? AND match_id=? AND status='pending' AND ((?='cancelled' AND sender=?) OR (?<>'cancelled' AND sender<>?)) AND EXISTS(SELECT 1 FROM matches m WHERE m.id=dates.match_id AND m.ended IS NULL)").bind(status,String(body.dateId),match.id,status,id,status,id));
  }
 }else if(action==="demo-plan"&&mode==="demo"){
  const addon=z.enum(["capacity","queue"]).parse(body.addon);const enabled=z.boolean().parse(body.enabled);
  stmts.push(db.prepare("INSERT INTO plans(id,owner,addon,expires) VALUES(?,?,?,?) ON CONFLICT(owner,addon) DO UPDATE SET expires=excluded.expires").bind(id+":"+addon,id,addon,enabled?Date.now()+30*86400000:0));if(enabled&&addon==="capacity")for(let i=0;i<5;i++)stmts.push(promote(db,id));
 }else if(action==="reset-demo"&&mode==="demo"){
  stmts.push(db.prepare("DELETE FROM plans WHERE owner=?").bind(id));
  stmts.push(db.prepare("DELETE FROM spaces WHERE id=?").bind(scope));
 }else{return json({error:"Unknown action."},400);}
 await db.batch(stmts);
 if(action==="reset-demo")await ensureSpace(db,user.userId,mode);
 return json(await readState(db,user.userId,mode,body.filters));
 }catch(e:any){
  console.error("DBD action:",e);
  if(db&&key){const previous:any=await db.prepare("SELECT payload FROM requests WHERE id=?").bind(key).first();if(previous?.payload===payload){const user=await getChatGPTUser();const b=JSON.parse(payload);if(user)return json(await readState(db,user.userId,b.mode==="live"?"live":"demo",b.filters));}}
  if(e instanceof z.ZodError)return json({error:e.issues[0]?.message||"Check your entries."},400);
  const message=String(e?.message||"")+" "+String(e?.cause?.message||"");
  if(message.includes("Swiping is paused")||message.includes("Match capacity"))return json({error:"Your match slots are full. Unmatch before swiping again."},409);
  if(message.includes("Review your oldest"))return json({error:"Review your oldest incoming like first, or enable Queue Freedom."},409);
  if(message.includes("Already matched"))return json({error:"You are already connected with this person."},409);
  if(message.includes("Profile unavailable"))return json({error:"This profile is no longer available."},409);
  if(message.includes("active connection"))return json({error:"This connection has ended."},409);
  return json({error:"We couldn't save that. Your changes have not been applied. Please try again."},503);
 }
}


import {getChatGPTUser} from "@/app/chatgpt-auth";
import {getStore} from "@/db/raw";
import {ensureSpace,identity,promote} from "@/lib/service";
import {ensureClique,readClique} from "@/lib/clique-service";
import {connectFriendsSql,friendAllowedSql,friendCountSql,groupReadySql,memberSql,replacementSql} from "@/lib/clique-sql";
import {z} from "zod";
export const dynamic="force-dynamic";
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
export async function GET(request:Request){try{const user=await getChatGPTUser();if(!user)return reply({error:"Sign in to continue."},401);const mode=new URL(request.url).searchParams.get('mode')==='live'?'live':'demo',db=getStore();await ensureSpace(db,user.userId,mode);await ensureClique(db,user.userId,mode);return reply(await readClique(db,user.userId,mode));}catch(e){console.error('Clique state',e);return reply({error:"We couldn't load your clique. Please try again."},503);}}
export async function POST(request:Request){try{
 const user=await getChatGPTUser();if(!user)return reply({error:"Sign in to continue."},401);
 if(request.headers.get('origin')!==new URL(request.url).origin)return reply({error:"Use Date-By-Date to make this request."},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:"JSON required."},415);
 const raw=await request.text();if(raw.length>12000)return reply({error:"That entry is too long."},413);
 const b=JSON.parse(raw),mode=b.mode==='live'?'live':'demo',requestId=z.string().regex(/^[-a-zA-Z0-9]{8,80}$/).parse(b.requestId);
 const db=getStore();await ensureSpace(db,user.userId,mode);await ensureClique(db,user.userId,mode);
 const {id,scope}=identity(user.userId,mode),key=id+':clique:'+requestId;
 const previous:any=await db.prepare('SELECT payload FROM requests WHERE id=?').bind(key).first();if(previous){if(previous.payload!==raw)return reply({error:'Request already used.'},409);return reply(await readClique(db,user.userId,mode));}
 if(!await db.prepare('SELECT id FROM profiles WHERE id=?').bind(id).first())return reply({error:'Create your profile first.'},400);
 const target=typeof b.target==='string'?b.target:'',stmts=[db.prepare('INSERT INTO requests(id,payload,created) VALUES(?,?,?)').bind(key,raw,Date.now())];
 if(b.action==='settings'){
  const enabled=z.boolean().parse(b.enabled),groups=z.boolean().parse(b.groupsEnabled);
  stmts.push(db.prepare('INSERT INTO clique_settings(owner,enabled,groups_enabled) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET enabled=excluded.enabled,groups_enabled=excluded.groups_enabled').bind(id,enabled?1:0,enabled&&groups?1:0));
 }else if(b.action==='withdraw'){
  stmts.push(db.prepare('DELETE FROM friend_likes WHERE sender=? AND recipient=?').bind(id,target));
 }else if(['like','pass'].includes(b.action)){
  if(!(await db.prepare(`SELECT id FROM profiles WHERE id=?2 AND scope=?3 AND ${friendAllowedSql('?1','?2')}`).bind(id,target,scope).first()))return reply({error:'This friend profile is unavailable.'},409);
  if(b.action==='like'){
   const replacement=typeof b.replacement==='string'?b.replacement:null;
   if(replacement&&!await db.prepare('SELECT id FROM friendships WHERE (a=? AND b=?) OR (b=? AND a=?)').bind(id,replacement,id,replacement).first())return reply({error:'Choose a current friend to replace.'},409);
   stmts.push(db.prepare('INSERT INTO friend_likes(sender,recipient,replacement,created) VALUES(?,?,?,?) ON CONFLICT(sender,recipient) DO UPDATE SET replacement=excluded.replacement').bind(id,target,replacement,Date.now()));
   stmts.push(db.prepare('DELETE FROM friend_passes WHERE sender=? AND recipient=?').bind(id,target));
   stmts.push(db.prepare(replacementSql()).bind(id,target),db.prepare(replacementSql()).bind(target,id),db.prepare(connectFriendsSql).bind(id,target,crypto.randomUUID(),Date.now()));
  }else{stmts.push(db.prepare('DELETE FROM friend_likes WHERE sender=? AND recipient=?').bind(id,target));if(b.action==='pass')stmts.push(db.prepare('INSERT OR IGNORE INTO friend_passes(sender,recipient) VALUES(?,?)').bind(id,target),db.prepare('DELETE FROM friend_likes WHERE sender=? AND recipient=?').bind(target,id));}
 }else if(b.action==='report'){
  if(!await db.prepare('SELECT id FROM profiles WHERE id=? AND scope=? AND id<>?').bind(target,scope,id).first())return reply({error:'Profile unavailable.'},404);
  const details=z.string().trim().max(1200).parse(b.details||'');
  stmts.push(db.prepare('INSERT INTO reports(id,reporter,target,reason,details,created) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),id,target,'Clique: inappropriate behavior',details,Date.now()));
  stmts.push(db.prepare('INSERT OR IGNORE INTO blocks(sender,recipient) VALUES(?,?)').bind(id,target));
  stmts.push(db.prepare('DELETE FROM likes WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)').bind(id,target,target,id));
  stmts.push(db.prepare('UPDATE matches SET ended=?,operation=? WHERE ended IS NULL AND ((a=? AND b=?) OR (a=? AND b=?))').bind(Date.now(),key,id,target,target,id));
  for(const pid of [id,target].sort())for(let i=0;i<5;i++)stmts.push(promote(db,pid,key));
 }else if(b.action==='remove'){
  stmts.push(db.prepare('DELETE FROM friendships WHERE id=? AND (a=? OR b=?)').bind(String(b.friendshipId),id,id));
 }else if(b.action==='group-like'){
  const mine=z.number().int().nonnegative().parse(b.revision),theirs=z.number().int().nonnegative().parse(b.targetRevision);
  stmts.push(db.prepare('DELETE FROM group_likes WHERE sender=? AND recipient=?').bind(id,target));
  stmts.push(db.prepare('INSERT INTO group_likes(sender,recipient,sender_revision,recipient_revision) VALUES(?,?,?,?)').bind(id,target,mine,theirs));
  stmts.push(db.prepare(`INSERT OR IGNORE INTO group_matches(id,a,b,size,created) SELECT ?3,min(?1,?2),max(?1,?2),${friendCountSql('?1')}+1,?4 WHERE ${groupReadySql('?1','?2')} AND EXISTS(SELECT 1 FROM group_likes WHERE sender=?2 AND recipient=?1)`).bind(id,target,crypto.randomUUID(),Date.now()));
 }else if(b.action==='group-end'){
  stmts.push(db.prepare(`DELETE FROM group_matches WHERE id=?2 AND (?1 IN(${memberSql('group_matches.a')}) OR ?1 IN(${memberSql('group_matches.b')}))`).bind(id,String(b.groupMatchId)));
 }else if(b.action==='message'){
  const body=z.string().trim().min(1).max(2000).parse(b.text),friendship=typeof b.friendshipId==='string'?b.friendshipId:null,groupMatch=typeof b.groupMatchId==='string'?b.groupMatchId:null;
  stmts.push(db.prepare('INSERT INTO clique_messages(id,friendship,group_match,sender,body,created) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),friendship,groupMatch,id,body,Date.now()));
 }else if(b.action==='demo-group-reply'&&mode==='demo'){
  if(!target.startsWith(scope+':')||target===id)return reply({error:'Choose a demo clique.'},400);
  stmts.push(db.prepare('INSERT OR IGNORE INTO group_likes(sender,recipient,sender_revision,recipient_revision) SELECT ?2,?1,(SELECT revision FROM clique_settings WHERE owner=?2),(SELECT revision FROM clique_settings WHERE owner=?1)').bind(id,target));
  stmts.push(db.prepare(`INSERT OR IGNORE INTO group_matches(id,a,b,size,created) SELECT ?3,min(?1,?2),max(?1,?2),${friendCountSql('?1')}+1,?4 WHERE ${groupReadySql('?1','?2')} AND EXISTS(SELECT 1 FROM group_likes WHERE sender=?1 AND recipient=?2)`).bind(id,target,crypto.randomUUID(),Date.now()));
 }else return reply({error:'Unknown clique action.'},400);
 await db.batch(stmts);return reply(await readClique(db,user.userId,mode));
}catch(e:any){console.error('Clique action',e);const message=String(e.message)+' '+String(e.cause?.message||'');if(e instanceof z.ZodError)return reply({error:'Check your selections and try again.'},400);if(/clique|friend|profile|conversation|organizers/i.test(message))return reply({error:'This clique or connection changed. Refresh and review your selection again.'},409);return reply({error:"We couldn't save that. Please try again."},503);}}

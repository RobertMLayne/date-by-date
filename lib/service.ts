import { getStore } from "@/db/raw";
import { env } from "cloudflare:workers";
import { demoPeople } from "./seed";
import { promoteSql,capacitySql,occupancySql } from "./matching-sql";
import {queueEntrySql,normalizeFilters,discoveryFilterSql,messagesSql} from "./state-queries";
import type { AppState,Profile,Match } from "./types";
export type Store=ReturnType<typeof getStore>;
export function identity(user:string,mode:string){const scope=mode==="live"?"live":"demo:"+user;return {scope,id:scope==="live"?"user:"+user:scope+":me"};}
export function promote(db:Store,id:string,operation?:string){const args:any[]=[crypto.randomUUID(),id,Date.now(),id];if(operation)args.push(operation);return db.prepare(promoteSql(!!operation)).bind(...args);}
export async function ensureSpace(db:Store,user:string,mode:string){
 const {scope}=identity(user,mode);
 if(scope==="live"){await db.prepare("INSERT OR IGNORE INTO spaces(id) VALUES(?)").bind(scope).run();return;}
 if(await db.prepare("SELECT id FROM spaces WHERE id=?").bind(scope).first())return;
 const stmts=[db.prepare("INSERT INTO spaces(id) VALUES(?)").bind(scope)];
 for(const p of demoPeople)stmts.push(db.prepare("INSERT INTO profiles(id,scope,name,dob,gender,city,job,bio,intent,interests,photos,prompt,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(scope+":"+p.key,scope,p.name,p.dob,p.gender,p.city,p.job,p.bio,"Long-term relationship",JSON.stringify(p.interests),JSON.stringify(p.photo?["https://images.pexels.com/photos/"+p.photo+"/pexels-photo-"+p.photo+".jpeg?auto=compress&cs=tinysrgb&w=1000"]:[]),p.prompt,Date.now()));
 for(const [a,b] of [["maya","me"],["aria","me"],["maya","aria"],["theo","maya"],["noah","maya"],["elena","me"],["elena","noah"],["noah","elena"]])stmts.push(db.prepare("INSERT INTO likes(sender,recipient) VALUES(?,?)").bind(scope+":"+a,scope+":"+b));
 stmts.push(promote(db,scope+":elena"));
 try{await db.batch(stmts);}catch(e){if(!(await db.prepare("SELECT id FROM spaces WHERE id=?").bind(scope).first()))throw e;}
}
export function ageAt(dob:string){const now=new Date(),d=new Date(dob+"T00:00:00Z");return now.getUTCFullYear()-d.getUTCFullYear()-((now.getUTCMonth()<d.getUTCMonth()||(now.getUTCMonth()===d.getUTCMonth()&&now.getUTCDate()<d.getUTCDate()))?1:0);}
export async function readState(db:Store,user:string,mode:"demo"|"live",preferences:unknown={}):Promise<AppState>{
 const {scope,id}=identity(user,mode);
 const filters=normalizeFilters(preferences);
 const rows=await db.batch([
 db.prepare(`WITH mine AS (SELECT CASE WHEN a=?1 THEN b ELSE a END AS id FROM matches WHERE ended IS NULL AND (a=?1 OR b=?1))
 SELECT p.*,
 ${occupancySql("p.id")} AS activeCount, ${capacitySql("p.id")} AS capacity,
 EXISTS(SELECT 1 FROM likes l WHERE l.sender=p.id AND l.recipient=?1 AND ${queueEntrySql("l")}) AS likesYou,
 EXISTS(SELECT 1 FROM likes WHERE sender=?1 AND recipient=p.id) AS liked,
 (EXISTS(SELECT 1 FROM passes WHERE sender=?1 AND recipient=p.id) OR EXISTS(SELECT 1 FROM matches WHERE ended IS NOT NULL AND ((a=?1 AND b=p.id) OR (b=?1 AND a=p.id)))) AS passed,
 (SELECT count(*) FROM likes l WHERE l.sender=p.id AND ${queueEntrySql("l")}) AS outgoing,
 (SELECT count(*) FROM likes l WHERE l.recipient=p.id AND ${queueEntrySql("l")}) AS incoming,
 (SELECT count(*)+1 FROM likes l WHERE l.recipient=p.id AND ${queueEntrySql("l")} AND l.id<COALESCE((SELECT e.id FROM likes e WHERE e.sender=?1 AND e.recipient=p.id),9223372036854775807)) AS queuePosition
 FROM profiles p WHERE p.scope=?2
 AND NOT EXISTS(SELECT 1 FROM blocks WHERE (sender=?1 AND recipient=p.id) OR (sender=p.id AND recipient=?1))
 AND (p.id=?1 OR p.id IN(SELECT id FROM mine)
 OR EXISTS(SELECT 1 FROM likes WHERE (sender=p.id AND recipient=?1) OR (sender=?1 AND recipient=p.id))
 OR EXISTS(SELECT 1 FROM matches WHERE ended IS NULL AND ((a=p.id AND b IN(SELECT id FROM mine)) OR (b=p.id AND a IN(SELECT id FROM mine))))
 OR EXISTS(SELECT 1 FROM likes WHERE sender=p.id AND recipient IN(SELECT id FROM mine))
 OR p.id IN(SELECT q.id FROM profiles q WHERE q.scope=?2 AND q.id<>?1 AND q.paused=0
 AND NOT EXISTS(SELECT 1 FROM passes WHERE sender=?1 AND recipient=q.id)
 AND NOT EXISTS(SELECT 1 FROM likes WHERE sender=?1 AND recipient=q.id)
 AND NOT EXISTS(SELECT 1 FROM matches WHERE (a=?1 AND b=q.id) OR (b=?1 AND a=q.id))
 ${discoveryFilterSql("q","?1")}
 ORDER BY q.created,q.rowid LIMIT 100))
 ORDER BY p.created,p.rowid`).bind(id,scope,...filters.ages,filters.gender,filters.city,filters.intent,filters.interest),
 db.prepare("SELECT m.* FROM matches m JOIN profiles p ON p.id=m.a WHERE p.scope=? AND m.ended IS NULL ORDER BY m.started,m.id").bind(scope),
 db.prepare(messagesSql).bind(id,id),
 db.prepare("SELECT d.* FROM dates d JOIN matches m ON m.id=d.match_id WHERE m.ended IS NULL AND (m.a=? OR m.b=?) ORDER BY d.occurs").bind(id,id),
 db.prepare(`SELECT l.* FROM likes l JOIN profiles p ON p.id=l.sender WHERE p.scope=? AND ${queueEntrySql("l")} ORDER BY l.id`).bind(scope),
 db.prepare("SELECT addon FROM plans WHERE owner=? AND expires>?").bind(id,Date.now())
 ]);
 const people:Profile[]=rows[0].results.map((p:any)=>({id:p.id,name:p.name,age:ageAt(p.dob),gender:p.gender,city:p.city,job:p.job,bio:p.bio,intent:p.intent,interests:JSON.parse(p.interests),photos:JSON.parse(p.photos),prompt:p.prompt,paused:!!p.paused,busy:p.activeCount>0,activeCount:p.activeCount,capacity:p.capacity,likesYou:!!p.likesYou,liked:!!p.liked,passed:!!p.passed,queuePosition:p.queuePosition,outgoing:p.outgoing,incoming:p.incoming}));
 const viewer=people.find(p=>p.id===id)||null;
 const allMatches:any[]=rows[1].results;const allLikes:any[]=rows[4].results;
 const matches:Match[]=allMatches.filter(m=>m.a===id||m.b===id).map(m=>({...m,partner:people.find(p=>p.id===(m.a===id?m.b:m.a))})).filter(m=>m.partner);
 const plans={capacity:rows[5].results.some((x:any)=>x.addon==="capacity"),queue:rows[5].results.some((x:any)=>x.addon==="queue")};
 const full=!!viewer&&viewer.activeCount>=viewer.capacity;
 const incoming=allLikes.filter(l=>l.recipient===id).map(l=>people.find(p=>p.id===l.sender)).filter(Boolean) as Profile[];
 const outgoing=allLikes.filter(l=>l.sender===id).map(l=>people.find(p=>p.id===l.recipient)).filter(Boolean) as Profile[];
 const unreviewed=incoming.filter(p=>!p.liked&&!p.paused&&!p.passed);
 const candidates=people.filter(p=>p.id!==id&&!p.paused&&!p.passed&&!p.liked&&!matches.some(m=>m.partner.id===p.id));
 const ordered=[...unreviewed,...candidates.filter(p=>!unreviewed.some(q=>q.id===p.id))];
 const transparency:AppState["transparency"]={};
 if(plans.capacity)for(const m of matches){const pid=m.partner.id;transparency[pid]={
 connections:allMatches.filter(x=>(x.a===pid||x.b===pid)&&x.id!==m.id).map(x=>people.find(p=>p.id===(x.a===pid?x.b:x.a))).filter(Boolean) as Profile[],
 queue:allLikes.filter(l=>l.recipient===pid).map(l=>people.find(p=>p.id===l.sender)).filter(Boolean) as Profile[]
 };}
 const secrets=env as unknown as Record<string,string>;
 return {mode,viewer,profiles:full?[]:!plans.queue&&unreviewed.length?[unreviewed[0]]:ordered,incoming:full?[]:plans.queue?incoming:incoming.filter(p=>p.liked||p.id===unreviewed[0]?.id),outgoing:full?[]:outgoing,matches,messages:rows[2].results as any,dates:rows[3].results as any,plans,billingEnabled:!!(secrets.STRIPE_SECRET_KEY&&secrets.STRIPE_WEBHOOK_SECRET&&secrets.STRIPE_CAPACITY_PRICE&&secrets.STRIPE_QUEUE_PRICE&&secrets.APP_ORIGIN),transparency};
}


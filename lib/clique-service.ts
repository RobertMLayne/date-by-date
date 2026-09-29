import {ageAt,identity,type Store} from "./service";
import {connectFriendsSql,friendCountSql,groupReadySql,memberSql} from "./clique-sql";
import type {CliqueState,FriendProfile,CliqueGroup} from "./clique-types";

export async function ensureClique(db:Store,user:string,mode:string){
 const {scope,id}=identity(user,mode);
 if(mode!=="demo"){await db.prepare("INSERT OR IGNORE INTO clique_settings(owner) SELECT id FROM profiles WHERE id=?").bind(id).run();return;}
 if(await db.prepare("SELECT scope FROM clique_seeds WHERE scope=?").bind(scope).first())return;
 const statements=[db.prepare("INSERT INTO clique_seeds(scope) VALUES(?)").bind(scope),db.prepare("INSERT OR IGNORE INTO clique_settings(owner,enabled,groups_enabled) SELECT id,1,1 FROM profiles WHERE scope=?").bind(scope)];
 for(const [a,b] of [["maya","aria"],["elena","noah"]]){
  for(const [from,to] of [[a,b],[b,a]])statements.push(db.prepare("INSERT OR IGNORE INTO friend_likes(sender,recipient,created) VALUES(?,?,?)").bind(scope+":"+from,scope+":"+to,Date.now()));
  statements.push(db.prepare(connectFriendsSql).bind(scope+":"+a,scope+":"+b,crypto.randomUUID(),Date.now()));
 }
 for(const key of ["maya","aria","elena","noah","theo"])statements.push(db.prepare("INSERT OR IGNORE INTO friend_likes(sender,recipient,created) VALUES(?,?,?)").bind(scope+":"+key,id,Date.now()));
 try{await db.batch(statements);}catch(e){if(!(await db.prepare("SELECT scope FROM clique_seeds WHERE scope=?").bind(scope).first()))throw e;}
}

export async function readClique(db:Store,user:string,mode:string):Promise<CliqueState>{
 const {scope,id}=identity(user,mode);
 const results=await db.batch([
  db.prepare(`SELECT p.id,p.name,p.dob,p.gender,p.city,p.bio,p.interests,p.photos,p.prompt,p.paused,COALESCE(c.enabled,0) enabled,COALESCE(c.groups_enabled,0) groups_enabled,COALESCE(c.revision,0) revision,${friendCountSql('p.id')} friendCount,
  EXISTS(SELECT 1 FROM friend_likes WHERE sender=p.id AND recipient=?1) likesYou,
  EXISTS(SELECT 1 FROM friend_likes WHERE sender=?1 AND recipient=p.id) liked,
  EXISTS(SELECT 1 FROM friend_passes WHERE sender=?1 AND recipient=p.id) passed,
  (SELECT replacement FROM friend_likes WHERE sender=?1 AND recipient=p.id) replacement
  FROM profiles p LEFT JOIN clique_settings c ON c.owner=p.id WHERE p.scope=?2
  AND NOT EXISTS(SELECT 1 FROM blocks WHERE (sender=?1 AND recipient=p.id) OR (sender=p.id AND recipient=?1)) ORDER BY p.created,p.id`).bind(id,scope),
  db.prepare("SELECT f.* FROM friendships f JOIN profiles p ON p.id=f.a WHERE p.scope=?").bind(scope),
  db.prepare(`SELECT c.owner FROM clique_settings c WHERE ${groupReadySql('?1','c.owner')} AND NOT EXISTS(SELECT 1 FROM group_matches WHERE (a=?1 AND b=c.owner) OR (b=?1 AND a=c.owner))`).bind(id),
  db.prepare("SELECT l.* FROM group_likes l JOIN profiles p ON p.id=l.sender WHERE p.scope=?").bind(scope),
  db.prepare(`SELECT g.* FROM group_matches g WHERE ?1 IN(${memberSql('g.a')}) OR ?1 IN(${memberSql('g.b')})`).bind(id),
  db.prepare(`WITH recent AS (SELECT m.*,p.name,row_number() OVER(PARTITION BY COALESCE(m.friendship,m.group_match) ORDER BY m.created DESC,m.id DESC) position FROM clique_messages m JOIN profiles p ON p.id=m.sender
   WHERE m.friendship IN(SELECT id FROM friendships WHERE a=?1 OR b=?1) OR m.group_match IN(SELECT g.id FROM group_matches g WHERE ?1 IN(${memberSql('g.a')}) OR ?1 IN(${memberSql('g.b')}))) SELECT id,friendship,group_match,sender,body,created,name FROM recent WHERE position<=300 ORDER BY created,id`).bind(id)
 ]);
 const raw=results[0].results as any[],edges=results[1].results as any[],likes=results[3].results as any[];
 const people:FriendProfile[]=raw.map(p=>({id:p.id,name:p.name,age:ageAt(p.dob),gender:p.gender,city:p.city,bio:p.bio,interests:JSON.parse(p.interests),photos:JSON.parse(p.photos),prompt:p.prompt,friendCount:p.friendCount,likesYou:!!p.likesYou,liked:!!p.liked,replacement:p.replacement}));
 const find=(pid:string)=>people.find(p=>p.id===pid);
 const members=(owner:string)=>[find(owner),...edges.filter(f=>f.a===owner||f.b===owner).map(f=>find(f.a===owner?f.b:f.a))].filter(Boolean) as FriendProfile[];
 const me=raw.find(p=>p.id===id),friends=edges.filter(f=>f.a===id||f.b===id).map(f=>({...find(f.a===id?f.b:f.a)!,friendshipId:f.id})).filter(p=>p.id);
 const candidates=people.filter(p=>p.id!==id&&raw.find(r=>r.id===p.id)?.enabled&&!raw.find(r=>r.id===p.id)?.paused&&!friends.some(f=>f.id===p.id));
 const outgoing=people.filter(p=>p.liked&&!friends.some(f=>f.id===p.id));
 const group=(owner:string,matchId?:string):CliqueGroup=>({owner:find(owner)!,members:members(owner),revision:raw.find(p=>p.id===owner)?.revision||0,likesYou:likes.some(l=>l.sender===owner&&l.recipient===id),liked:likes.some(l=>l.sender===id&&l.recipient===owner),matchId});
 return {enabled:!!me?.enabled,groupsEnabled:!!me?.groups_enabled,revision:me?.revision||0,viewer:find(id)||null,friends,profiles:me?.enabled?candidates.filter(p=>!p.liked&&!raw.find(r=>r.id===p.id)?.passed).sort((a,b)=>Number(b.likesYou)-Number(a.likesYou)):[],incoming:candidates.filter(p=>p.likesYou),outgoing,groups:(results[2].results as any[]).map(g=>group(g.owner)).filter(g=>g.owner),groupMatches:(results[4].results as any[]).map(g=>group(members(g.a).some(p=>p.id===id)?g.b:g.a,g.id)).filter(g=>g.owner),readyForGroups:members(id).length>=2&&members(id).every(p=>{const r=raw.find(x=>x.id===p.id);return r?.enabled&&r?.groups_enabled&&!r?.paused;}),messages:results[5].results as any};
}

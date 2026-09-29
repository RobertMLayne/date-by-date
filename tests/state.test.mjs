import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {discoveryFilterSql,queueEntrySql,messagesSql,normalizeFilters,nowSql} from '../lib/state-queries.ts';
import {authorizedDetail,captureModal,clearSubmittedDraft,resolveModal} from '../lib/view-state.ts';
import {promoteSql,capacitySql} from '../lib/matching-sql.ts';
function setup(){const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+f,'utf8'));db.exec("INSERT INTO spaces VALUES('test')");return db;}
function person(db,id,city='New York'){db.prepare("INSERT INTO profiles(id,scope,name,dob,gender,city,created) VALUES(?,'test',?,'1995-01-01','Nonbinary',?,0)").run(id,id,city);db.prepare("INSERT INTO plans(id,owner,addon,expires) VALUES(?,?,?,?)").run(id+':queue',id,'queue',Date.now()+86400000);}
function plan(db,id){db.prepare("INSERT INTO plans(id,owner,addon,expires) VALUES(?,?,?,?)").run(id+':capacity',id,'capacity',Date.now()+86400000);}
function like(db,a,b){db.prepare('INSERT INTO likes(sender,recipient) VALUES(?,?)').run(a,b);}
function pair(db,a,b){like(db,a,b);like(db,b,a);const mid=crypto.randomUUID();db.prepare(promoteSql()).run(mid,a,Date.now(),a);return mid;}

test('connection dialogs keep the original recipient and close when that match ends',()=>{
 const a={id:'a',partner:{id:'person-a'}},b={id:'b',partner:{id:'person-b'}};
 for(const name of ['date','connection-options','transparency']){
  const context=captureModal(name,a.id);
  assert.equal(resolveModal({matches:[b,a]},context).match,a);
  assert.deepEqual(resolveModal({matches:[b]},context),{name:'',match:null});
  assert.equal(resolveModal({matches:[b]},captureModal(name)).name,'');
  assert.equal(resolveModal({matches:[b]},captureModal(name,b.id)).match,b);
 }
 assert.equal(resolveModal({matches:[]},captureModal('plans')).name,'plans');
});
test('discovery excludes blocks and preferences before limiting candidates',()=>{const db=setup();person(db,'me');for(let i=0;i<101;i++)person(db,'p'+i,i===100?'Boston':'New York');for(let i=0;i<100;i++)db.prepare("INSERT INTO blocks(sender,recipient) VALUES('me',?)").run('p'+i);const sql=`SELECT q.id FROM profiles q WHERE q.scope=?2 AND q.id<>?1 ${discoveryFilterSql('q','?1')} ORDER BY q.created,q.rowid LIMIT 100`;const run=(city,intent='Any intention',interest='')=>db.prepare(sql).all({'?1':'me','?2':'test','?3':18,'?4':80,'?5':'Everyone','?6':city,'?7':intent,'?8':interest}).map(p=>p.id);assert.deepEqual(run(''),['p100']);db.exec('DELETE FROM blocks');assert.deepEqual(run('Boston'),['p100']);assert.deepEqual(run('Boston','Life partner','absent'),['p100']);plan(db,'me');assert.deepEqual(run('Boston','Life partner','absent'),[]);assert.equal(normalizeFilters({ages:[-10,1000]}).ages[0],18);});
test('actionable queues omit passed and paused senders but preserve original arrival order',()=>{const db=setup();for(const id of ['a','b','c','d'])person(db,id);like(db,'b','a');like(db,'c','a');like(db,'d','a');db.exec("INSERT INTO passes(sender,recipient) VALUES('a','b'); UPDATE profiles SET paused=1 WHERE id='c'");const ids=()=>db.prepare(`SELECT l.sender FROM likes l WHERE l.recipient='a' AND ${queueEntrySql('l')} ORDER BY l.id`).all().map(x=>x.sender);assert.deepEqual(ids(),['d']);db.exec("UPDATE profiles SET paused=0 WHERE id='c'");assert.deepEqual(ids(),['c','d']);});
test('each connection retains its own recent history',()=>{const db=setup();for(const id of ['a','b','c'])person(db,id);plan(db,'a');const old=pair(db,'a','b'),busy=pair(db,'a','c');db.prepare("INSERT INTO messages VALUES('old',?,'a','still here',0)").run(old);for(let i=0;i<305;i++)db.prepare('INSERT INTO messages VALUES(?,?,?,?,?)').run('new'+i,busy,'a','hello',i+1);const messages=db.prepare(messagesSql).all('a','a');assert.equal(messages.filter(m=>m.match_id===busy).length,300);assert.equal(messages.find(m=>m.match_id===old).body,'still here');});
test('paid transparency remains accessible at five matches and is revoked with entitlement',()=>{const third={id:'third',name:'Other person'},partner={id:'partner'},state={viewer:{activeCount:5,capacity:5},matches:[{partner}],profiles:[],incoming:[],outgoing:[],plans:{capacity:true},transparency:{partner:{connections:[third],queue:[]}}};assert.equal(authorizedDetail(state,{...third,readOnly:true}).id,'third');assert.equal(authorizedDetail(state,third),null);assert.equal(authorizedDetail({...state,plans:{capacity:false}},{...third,readOnly:true}),null);assert.equal(authorizedDetail({...state,transparency:{}},{...third,readOnly:true}),null);});
test('sending a draft clears only its recipient and preserves later edits',()=>{const drafts={a:'Hello A',b:'Hello B'};assert.deepEqual(clearSubmittedDraft(drafts,'a','Hello A'),{a:'',b:'Hello B'});assert.equal(clearSubmittedDraft({...drafts,a:'New message'},'a','Hello A').a,'New message');});
test('expired capacity uses millisecond precision in queries and mutation guards',()=>{const db=setup();for(const id of ['a','b','c'])person(db,id);plan(db,'a');pair(db,'a','b');db.prepare(`UPDATE plans SET expires=${nowSql}-1 WHERE owner='a' AND addon='capacity'`).run();assert.equal(db.prepare(`SELECT ${capacitySql("'a'")} AS n`).get().n,1);assert.throws(()=>like(db,'a','c'),/capacity/);});

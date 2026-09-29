export const nowSql="CAST(unixepoch('subsec')*1000 AS INTEGER)";

// A paused sender retains their original like ID and resumes their place when visible again.
export function queueEntrySql(l:string){return `
 EXISTS(SELECT 1 FROM profiles sender_profile WHERE sender_profile.id=${l}.sender AND sender_profile.paused=0)
 AND NOT EXISTS(SELECT 1 FROM passes rejected WHERE rejected.sender=${l}.recipient AND rejected.recipient=${l}.sender)
 AND NOT EXISTS(SELECT 1 FROM matches ended_pair WHERE ended_pair.ended IS NOT NULL AND ((ended_pair.a=${l}.sender AND ended_pair.b=${l}.recipient) OR (ended_pair.b=${l}.sender AND ended_pair.a=${l}.recipient)))
 AND NOT EXISTS(SELECT 1 FROM blocks blocked_pair WHERE (blocked_pair.sender=${l}.sender AND blocked_pair.recipient=${l}.recipient) OR (blocked_pair.recipient=${l}.sender AND blocked_pair.sender=${l}.recipient))`}

export function normalizeFilters(value:unknown){
 const v=(value&&typeof value==="object"?value:{}) as Record<string,unknown>;
 const ages=Array.isArray(v.ages)?v.ages:[18,65];
 const min=Math.max(18,Math.min(120,Number.isFinite(Number(ages[0]))?Number(ages[0]):18));
 const max=Math.max(min,Math.min(120,Number.isFinite(Number(ages[1]))?Number(ages[1]):65));
 return {ages:[min,max],gender:["Woman","Man","Nonbinary"].includes(String(v.gender))?String(v.gender):"Everyone",city:typeof v.city==="string"?v.city.slice(0,60):"",intent:["Long-term relationship","Open to exploring","Life partner"].includes(String(v.intent))?String(v.intent):"Any intention",interest:typeof v.interest==="string"?v.interest.slice(0,30):""};
}
export function discoveryFilterSql(q:string,viewer:string){return `
 AND NOT EXISTS(SELECT 1 FROM blocks k WHERE (k.sender=${viewer} AND k.recipient=${q}.id) OR (k.sender=${q}.id AND k.recipient=${viewer}))
 AND (CAST(strftime('%Y','now') AS INTEGER)-CAST(strftime('%Y',${q}.dob) AS INTEGER)-(strftime('%m-%d','now')<strftime('%m-%d',${q}.dob))) BETWEEN ?3 AND ?4
 AND (?5='Everyone' OR ${q}.gender=?5)
 AND instr(lower(${q}.city),lower(?6))>0
 AND (NOT EXISTS(SELECT 1 FROM plans filter_plan WHERE filter_plan.owner=${viewer} AND filter_plan.addon='capacity' AND filter_plan.expires>${nowSql})
 OR ((?7='Any intention' OR ${q}.intent=?7) AND (?8='' OR EXISTS(SELECT 1 FROM json_each(${q}.interests) interest WHERE instr(lower(interest.value),lower(?8))>0))))`}

export const messagesSql=`WITH recent AS (
 SELECT x.*,row_number() OVER(PARTITION BY x.match_id ORDER BY x.created DESC,x.id DESC) AS position
 FROM messages x JOIN matches m ON m.id=x.match_id
 WHERE m.ended IS NULL AND (m.a=? OR m.b=?)
) SELECT id,match_id,sender,body,created FROM recent WHERE position<=300 ORDER BY created,id`;

export function capacitySql(id:string){return "(CASE WHEN EXISTS(SELECT 1 FROM plans e WHERE e.owner="+id+" AND e.addon='capacity' AND e.expires>CAST(unixepoch('subsec')*1000 AS INTEGER)) THEN 5 ELSE 1 END)";}
export function occupancySql(id:string){return "(SELECT count(*) FROM matches m WHERE m.ended IS NULL AND (m.a="+id+" OR m.b="+id+"))";}
export function promoteSql(gated=false){return `
INSERT INTO matches(id,a,b,started)
SELECT ?, ?, l.sender, ? FROM likes l
JOIN profiles p ON p.id=l.sender JOIN profiles v ON v.id=l.recipient
WHERE l.recipient=? AND p.scope=v.scope AND p.paused=0 AND v.paused=0
AND EXISTS(SELECT 1 FROM likes r WHERE r.sender=l.recipient AND r.recipient=l.sender)
AND ${occupancySql("l.sender")}<${capacitySql("l.sender")}
AND ${occupancySql("l.recipient")}<${capacitySql("l.recipient")}
AND NOT EXISTS(SELECT 1 FROM matches m WHERE m.ended IS NULL AND ((m.a=l.sender AND m.b=l.recipient) OR (m.b=l.sender AND m.a=l.recipient)))
AND NOT EXISTS(SELECT 1 FROM blocks k WHERE (k.sender=l.sender AND k.recipient=l.recipient) OR (k.sender=l.recipient AND k.recipient=l.sender))
${gated?"AND EXISTS(SELECT 1 FROM matches e WHERE e.operation=? AND (e.a=l.recipient OR e.b=l.recipient))":""}
ORDER BY l.id LIMIT 1`;}
export const invariantSql=`
CREATE TRIGGER likes_guard BEFORE INSERT ON likes BEGIN
 SELECT CASE WHEN NEW.sender=NEW.recipient THEN RAISE(ABORT,'Cannot like yourself') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM profiles a JOIN profiles b ON a.scope=b.scope WHERE a.id=NEW.sender AND b.id=NEW.recipient AND a.paused=0 AND b.paused=0) THEN RAISE(ABORT,'Profile unavailable') END;
 SELECT CASE WHEN ${occupancySql("NEW.sender")}>=${capacitySql("NEW.sender")} THEN RAISE(ABORT,'Swiping is paused at match capacity') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM blocks WHERE (sender=NEW.sender AND recipient=NEW.recipient) OR (sender=NEW.recipient AND recipient=NEW.sender)) THEN RAISE(ABORT,'Profile unavailable') END;
END;
--> statement-breakpoint
CREATE TRIGGER passes_guard BEFORE INSERT ON passes BEGIN
 SELECT CASE WHEN ${occupancySql("NEW.sender")}>=${capacitySql("NEW.sender")} THEN RAISE(ABORT,'Swiping is paused at match capacity') END;
END;
--> statement-breakpoint
CREATE TRIGGER match_guard BEFORE INSERT ON matches BEGIN
 SELECT CASE WHEN NEW.a=NEW.b OR NEW.ended IS NOT NULL THEN RAISE(ABORT,'Invalid match') END;
 SELECT CASE WHEN ${occupancySql("NEW.a")}>=${capacitySql("NEW.a")} OR ${occupancySql("NEW.b")}>=${capacitySql("NEW.b")} THEN RAISE(ABORT,'Match capacity reached') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM matches WHERE ended IS NULL AND ((a=NEW.a AND b=NEW.b) OR (b=NEW.a AND a=NEW.b))) THEN RAISE(ABORT,'Already matched') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM profiles a JOIN profiles b ON a.scope=b.scope WHERE a.id=NEW.a AND b.id=NEW.b AND a.paused=0 AND b.paused=0) THEN RAISE(ABORT,'Profile unavailable') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM likes WHERE sender=NEW.a AND recipient=NEW.b) OR NOT EXISTS(SELECT 1 FROM likes WHERE sender=NEW.b AND recipient=NEW.a) THEN RAISE(ABORT,'Mutual consent required') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM blocks WHERE (sender=NEW.a AND recipient=NEW.b) OR (sender=NEW.b AND recipient=NEW.a)) THEN RAISE(ABORT,'Profile unavailable') END;
END;
--> statement-breakpoint
CREATE TRIGGER match_consume AFTER INSERT ON matches BEGIN
 DELETE FROM likes WHERE (sender=NEW.a AND recipient=NEW.b) OR (sender=NEW.b AND recipient=NEW.a);
END;
--> statement-breakpoint
CREATE TRIGGER match_immutable BEFORE UPDATE ON matches WHEN NEW.a<>OLD.a OR NEW.b<>OLD.b OR NEW.id<>OLD.id OR (OLD.ended IS NOT NULL AND NEW.ended IS NULL) BEGIN
 SELECT RAISE(ABORT,'Match participants and ended state are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER message_guard BEFORE INSERT ON messages BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM matches m WHERE m.id=NEW.match_id AND m.ended IS NULL AND (m.a=NEW.sender OR m.b=NEW.sender)) THEN RAISE(ABORT,'An active connection is required') END;
END;
--> statement-breakpoint
CREATE TRIGGER date_guard BEFORE INSERT ON dates BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM matches m WHERE m.id=NEW.match_id AND m.ended IS NULL AND (m.a=NEW.sender OR m.b=NEW.sender)) THEN RAISE(ABORT,'An active connection is required') END;
END;
`;


DROP TRIGGER likes_guard;
--> statement-breakpoint
CREATE TRIGGER likes_guard BEFORE INSERT ON likes BEGIN
 SELECT CASE WHEN NEW.sender=NEW.recipient THEN RAISE(ABORT,'Cannot like yourself') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM profiles a JOIN profiles b ON a.scope=b.scope WHERE a.id=NEW.sender AND b.id=NEW.recipient AND a.paused=0 AND b.paused=0) THEN RAISE(ABORT,'Profile unavailable') END;
 SELECT CASE WHEN (SELECT count(*) FROM matches m WHERE m.ended IS NULL AND (m.a=NEW.sender OR m.b=NEW.sender))>=(CASE WHEN EXISTS(SELECT 1 FROM plans e WHERE e.owner=NEW.sender AND e.addon='capacity' AND e.expires>CAST(unixepoch('subsec')*1000 AS INTEGER)) THEN 5 ELSE 1 END) THEN RAISE(ABORT,'Swiping is paused at match capacity') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM blocks WHERE (sender=NEW.sender AND recipient=NEW.recipient) OR (sender=NEW.recipient AND recipient=NEW.sender)) THEN RAISE(ABORT,'Profile unavailable') END;
END;
--> statement-breakpoint
DROP TRIGGER passes_guard;
--> statement-breakpoint
CREATE TRIGGER passes_guard BEFORE INSERT ON passes BEGIN
 SELECT CASE WHEN (SELECT count(*) FROM matches m WHERE m.ended IS NULL AND (m.a=NEW.sender OR m.b=NEW.sender))>=(CASE WHEN EXISTS(SELECT 1 FROM plans e WHERE e.owner=NEW.sender AND e.addon='capacity' AND e.expires>CAST(unixepoch('subsec')*1000 AS INTEGER)) THEN 5 ELSE 1 END) THEN RAISE(ABORT,'Swiping is paused at match capacity') END;
END;
--> statement-breakpoint
DROP TRIGGER match_guard;
--> statement-breakpoint
CREATE TRIGGER match_guard BEFORE INSERT ON matches BEGIN
 SELECT CASE WHEN NEW.a=NEW.b OR NEW.ended IS NOT NULL THEN RAISE(ABORT,'Invalid match') END;
 SELECT CASE WHEN (SELECT count(*) FROM matches m WHERE m.ended IS NULL AND (m.a=NEW.a OR m.b=NEW.a))>=(CASE WHEN EXISTS(SELECT 1 FROM plans e WHERE e.owner=NEW.a AND e.addon='capacity' AND e.expires>CAST(unixepoch('subsec')*1000 AS INTEGER)) THEN 5 ELSE 1 END) OR (SELECT count(*) FROM matches m WHERE m.ended IS NULL AND (m.a=NEW.b OR m.b=NEW.b))>=(CASE WHEN EXISTS(SELECT 1 FROM plans e WHERE e.owner=NEW.b AND e.addon='capacity' AND e.expires>CAST(unixepoch('subsec')*1000 AS INTEGER)) THEN 5 ELSE 1 END) THEN RAISE(ABORT,'Match capacity reached') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM matches WHERE ended IS NULL AND ((a=NEW.a AND b=NEW.b) OR (b=NEW.a AND a=NEW.b))) THEN RAISE(ABORT,'Already matched') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM profiles a JOIN profiles b ON a.scope=b.scope WHERE a.id=NEW.a AND b.id=NEW.b AND a.paused=0 AND b.paused=0) THEN RAISE(ABORT,'Profile unavailable') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM likes WHERE sender=NEW.a AND recipient=NEW.b) OR NOT EXISTS(SELECT 1 FROM likes WHERE sender=NEW.b AND recipient=NEW.a) THEN RAISE(ABORT,'Mutual consent required') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM blocks WHERE (sender=NEW.a AND recipient=NEW.b) OR (sender=NEW.b AND recipient=NEW.a)) THEN RAISE(ABORT,'Profile unavailable') END;
END;
--> statement-breakpoint
DROP TRIGGER likes_fifo_guard;
--> statement-breakpoint
CREATE TRIGGER likes_fifo_guard BEFORE INSERT ON likes WHEN NOT EXISTS(SELECT 1 FROM plans WHERE owner=NEW.sender AND addon='queue' AND expires>CAST(unixepoch('subsec')*1000 AS INTEGER)) BEGIN
SELECT CASE WHEN EXISTS(SELECT 1 FROM likes l JOIN profiles p ON p.id=l.sender WHERE l.recipient=NEW.sender AND p.paused=0
AND NOT EXISTS(SELECT 1 FROM likes r WHERE r.sender=NEW.sender AND r.recipient=l.sender)
AND NOT EXISTS(SELECT 1 FROM passes s WHERE s.sender=NEW.sender AND s.recipient=l.sender)
AND NOT EXISTS(SELECT 1 FROM matches e WHERE e.ended IS NOT NULL AND ((e.a=NEW.sender AND e.b=l.sender) OR (e.b=NEW.sender AND e.a=l.sender)))
AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.sender=NEW.sender AND b.recipient=l.sender) OR (b.sender=l.sender AND b.recipient=NEW.sender))) AND NEW.recipient<>(SELECT l.sender FROM likes l JOIN profiles p ON p.id=l.sender WHERE l.recipient=NEW.sender AND p.paused=0
AND NOT EXISTS(SELECT 1 FROM likes r WHERE r.sender=NEW.sender AND r.recipient=l.sender)
AND NOT EXISTS(SELECT 1 FROM passes s WHERE s.sender=NEW.sender AND s.recipient=l.sender)
AND NOT EXISTS(SELECT 1 FROM matches e WHERE e.ended IS NOT NULL AND ((e.a=NEW.sender AND e.b=l.sender) OR (e.b=NEW.sender AND e.a=l.sender)))
AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.sender=NEW.sender AND b.recipient=l.sender) OR (b.sender=l.sender AND b.recipient=NEW.sender)) ORDER BY l.id LIMIT 1) THEN RAISE(ABORT,'Review your oldest incoming like first') END;
END;
--> statement-breakpoint
DROP TRIGGER passes_fifo_guard;
--> statement-breakpoint
CREATE TRIGGER passes_fifo_guard BEFORE INSERT ON passes WHEN NOT EXISTS(SELECT 1 FROM plans WHERE owner=NEW.sender AND addon='queue' AND expires>CAST(unixepoch('subsec')*1000 AS INTEGER)) BEGIN
SELECT CASE WHEN EXISTS(SELECT 1 FROM likes l JOIN profiles p ON p.id=l.sender WHERE l.recipient=NEW.sender AND p.paused=0
AND NOT EXISTS(SELECT 1 FROM likes r WHERE r.sender=NEW.sender AND r.recipient=l.sender)
AND NOT EXISTS(SELECT 1 FROM passes s WHERE s.sender=NEW.sender AND s.recipient=l.sender)
AND NOT EXISTS(SELECT 1 FROM matches e WHERE e.ended IS NOT NULL AND ((e.a=NEW.sender AND e.b=l.sender) OR (e.b=NEW.sender AND e.a=l.sender)))
AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.sender=NEW.sender AND b.recipient=l.sender) OR (b.sender=l.sender AND b.recipient=NEW.sender))) AND NEW.recipient<>(SELECT l.sender FROM likes l JOIN profiles p ON p.id=l.sender WHERE l.recipient=NEW.sender AND p.paused=0
AND NOT EXISTS(SELECT 1 FROM likes r WHERE r.sender=NEW.sender AND r.recipient=l.sender)
AND NOT EXISTS(SELECT 1 FROM passes s WHERE s.sender=NEW.sender AND s.recipient=l.sender)
AND NOT EXISTS(SELECT 1 FROM matches e WHERE e.ended IS NOT NULL AND ((e.a=NEW.sender AND e.b=l.sender) OR (e.b=NEW.sender AND e.a=l.sender)))
AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.sender=NEW.sender AND b.recipient=l.sender) OR (b.sender=l.sender AND b.recipient=NEW.sender)) ORDER BY l.id LIMIT 1) THEN RAISE(ABORT,'Review your oldest incoming like first') END;
END;

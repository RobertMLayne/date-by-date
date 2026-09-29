DROP TRIGGER likes_fifo_guard;
--> statement-breakpoint
CREATE TRIGGER likes_fifo_guard BEFORE INSERT ON likes WHEN NOT EXISTS(SELECT 1 FROM plans WHERE owner=NEW.sender AND addon='queue' AND expires>unixepoch()*1000) BEGIN
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
CREATE TRIGGER passes_fifo_guard BEFORE INSERT ON passes WHEN NOT EXISTS(SELECT 1 FROM plans WHERE owner=NEW.sender AND addon='queue' AND expires>unixepoch()*1000) BEGIN
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
CREATE TRIGGER likes_existing_match_guard BEFORE INSERT ON likes BEGIN
SELECT CASE WHEN EXISTS(SELECT 1 FROM matches WHERE ended IS NULL AND ((a=NEW.sender AND b=NEW.recipient) OR (b=NEW.sender AND a=NEW.recipient))) THEN RAISE(ABORT,'Already matched') END;
END;

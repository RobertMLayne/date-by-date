import { writeFileSync } from 'node:fs';
import { invariantSql } from '../lib/matching-sql.ts';
const guard = (table) => `CREATE TRIGGER ${table}_fifo_guard BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM plans WHERE owner=NEW.sender AND addon='queue' AND expires>unixepoch()*1000) BEGIN
SELECT CASE WHEN EXISTS(SELECT 1 FROM likes l JOIN profiles p ON p.id=l.sender WHERE l.recipient=NEW.sender AND p.paused=0 AND NOT EXISTS(SELECT 1 FROM likes r WHERE r.sender=NEW.sender AND r.recipient=l.sender)) AND NEW.recipient<>(SELECT l.sender FROM likes l JOIN profiles p ON p.id=l.sender WHERE l.recipient=NEW.sender AND p.paused=0 AND NOT EXISTS(SELECT 1 FROM likes r WHERE r.sender=NEW.sender AND r.recipient=l.sender) ORDER BY l.id LIMIT 1) THEN RAISE(ABORT,'Review your oldest incoming like first') END;
END;`;
writeFileSync('drizzle/0002_matching_invariants.sql', invariantSql + '\n--> statement-breakpoint\n' + guard('likes') + '\n--> statement-breakpoint\n' + guard('passes'));

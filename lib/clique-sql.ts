export function friendCountSql(id:string){return `(SELECT count(*) FROM friendships fc WHERE fc.a=${id} OR fc.b=${id})`;}
export function memberSql(owner:string){return `SELECT ${owner} AS id UNION SELECT CASE WHEN fm.a=${owner} THEN fm.b ELSE fm.a END FROM friendships fm WHERE fm.a=${owner} OR fm.b=${owner}`;}
export function friendAllowedSql(a:string,b:string){return `${a}<>${b}
 AND EXISTS(SELECT 1 FROM profiles p JOIN profiles q ON p.scope=q.scope JOIN clique_settings cs ON cs.owner=p.id JOIN clique_settings ct ON ct.owner=q.id WHERE p.id=${a} AND q.id=${b} AND cs.enabled=1 AND ct.enabled=1 AND p.paused=0 AND q.paused=0)
 AND NOT EXISTS(SELECT 1 FROM blocks k WHERE (k.sender=${a} AND k.recipient=${b}) OR (k.sender=${b} AND k.recipient=${a}))`;}
function hasRoomSql(id:string,target:string){return `(${friendCountSql(id)}<4 OR EXISTS(SELECT 1 FROM friend_likes fl JOIN friendships fr ON ((fr.a=fl.sender AND fr.b=fl.replacement) OR (fr.b=fl.sender AND fr.a=fl.replacement)) WHERE fl.sender=${id} AND fl.recipient=${target}))`;}
export function friendshipReadySql(a:string,b:string){return `${friendAllowedSql(a,b)} AND EXISTS(SELECT 1 FROM friend_likes WHERE sender=${a} AND recipient=${b}) AND EXISTS(SELECT 1 FROM friend_likes WHERE sender=${b} AND recipient=${a}) AND ${hasRoomSql(a,b)} AND ${hasRoomSql(b,a)} AND NOT EXISTS(SELECT 1 FROM friendships WHERE (a=${a} AND b=${b}) OR (b=${a} AND a=${b}))`;}
export function replacementSql(){return `DELETE FROM friendships WHERE ${friendshipReadySql('?1','?2')}
 AND ${friendCountSql('?1')}>=4 AND ((a=?1 AND b=(SELECT replacement FROM friend_likes WHERE sender=?1 AND recipient=?2)) OR (b=?1 AND a=(SELECT replacement FROM friend_likes WHERE sender=?1 AND recipient=?2)))`;}
export const connectFriendsSql=`INSERT INTO friendships(id,a,b,created) SELECT ?3,min(?1,?2),max(?1,?2),?4 WHERE ${friendshipReadySql('?1','?2')}`;
export function groupReadySql(a:string,b:string){return `${friendAllowedSql(a,b)} AND ${friendCountSql(a)} BETWEEN 1 AND 4 AND ${friendCountSql(a)}=${friendCountSql(b)}
 AND NOT EXISTS(SELECT 1 FROM (${memberSql(a)}) ma JOIN (${memberSql(b)}) mb ON ma.id=mb.id)
 AND NOT EXISTS(SELECT 1 FROM (${memberSql(a)} UNION ${memberSql(b)}) mm JOIN profiles p ON p.id=mm.id LEFT JOIN clique_settings cs ON cs.owner=p.id WHERE p.paused=1 OR COALESCE(cs.enabled,0)=0 OR COALESCE(cs.groups_enabled,0)=0)
 AND NOT EXISTS(SELECT 1 FROM blocks k WHERE k.sender IN(${memberSql(a)} UNION ${memberSql(b)}) AND k.recipient IN(${memberSql(a)} UNION ${memberSql(b)}))`;}
const invalidate=(ids:string)=>`UPDATE clique_settings SET revision=revision+1 WHERE owner IN(${ids}); DELETE FROM group_likes WHERE sender IN(${ids}) OR recipient IN(${ids}); DELETE FROM group_matches WHERE a IN(${ids}) OR b IN(${ids});`;
export const cliqueInvariants=`
CREATE TRIGGER friendship_guard BEFORE INSERT ON friendships BEGIN
 SELECT CASE WHEN NEW.a>=NEW.b OR NOT (${friendAllowedSql('NEW.a','NEW.b')}) THEN RAISE(ABORT,'Friend profile unavailable') END;
 SELECT CASE WHEN ${friendCountSql('NEW.a')}>=4 OR ${friendCountSql('NEW.b')}>=4 THEN RAISE(ABORT,'A clique can contain four friends') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM friend_likes WHERE sender=NEW.a AND recipient=NEW.b) OR NOT EXISTS(SELECT 1 FROM friend_likes WHERE sender=NEW.b AND recipient=NEW.a) THEN RAISE(ABORT,'Mutual friendship interest required') END;
END;
--> statement-breakpoint
CREATE TRIGGER friendship_immutable BEFORE UPDATE ON friendships BEGIN SELECT RAISE(ABORT,'Friendships cannot be reassigned'); END;
--> statement-breakpoint
CREATE TRIGGER friendship_added AFTER INSERT ON friendships BEGIN
 DELETE FROM friend_likes WHERE (sender=NEW.a AND recipient=NEW.b) OR (sender=NEW.b AND recipient=NEW.a);
 ${invalidate('SELECT NEW.a UNION SELECT NEW.b')}
END;
--> statement-breakpoint
CREATE TRIGGER friendship_removed AFTER DELETE ON friendships BEGIN ${invalidate('SELECT OLD.a UNION SELECT OLD.b')} END;
--> statement-breakpoint
CREATE TRIGGER clique_consent_changed AFTER UPDATE OF enabled,groups_enabled ON clique_settings WHEN NEW.enabled<>OLD.enabled OR NEW.groups_enabled<>OLD.groups_enabled BEGIN ${invalidate(memberSql('NEW.owner'))} END;
--> statement-breakpoint
CREATE TRIGGER clique_profile_paused AFTER UPDATE OF paused ON profiles WHEN NEW.paused<>OLD.paused BEGIN ${invalidate(memberSql('NEW.id'))} END;
--> statement-breakpoint
CREATE TRIGGER clique_blocked AFTER INSERT ON blocks BEGIN
 DELETE FROM friend_likes WHERE (sender=NEW.sender AND recipient=NEW.recipient) OR (sender=NEW.recipient AND recipient=NEW.sender);
 ${invalidate(`${memberSql('NEW.sender')} UNION ${memberSql('NEW.recipient')}`)}
 DELETE FROM friendships WHERE (a=NEW.sender AND b=NEW.recipient) OR (b=NEW.sender AND a=NEW.recipient);
END;
--> statement-breakpoint
CREATE TRIGGER group_like_guard BEFORE INSERT ON group_likes BEGIN
 SELECT CASE WHEN NOT (${groupReadySql('NEW.sender','NEW.recipient')}) THEN RAISE(ABORT,'Cliques must be separate, available, and the same size') END;
 SELECT CASE WHEN NEW.sender_revision<>(SELECT revision FROM clique_settings WHERE owner=NEW.sender) OR NEW.recipient_revision<>(SELECT revision FROM clique_settings WHERE owner=NEW.recipient) THEN RAISE(ABORT,'Clique membership changed') END;
END;
--> statement-breakpoint
CREATE TRIGGER group_match_guard BEFORE INSERT ON group_matches BEGIN
 SELECT CASE WHEN NEW.a>=NEW.b OR NEW.size<>${friendCountSql('NEW.a')}+1 OR NOT (${groupReadySql('NEW.a','NEW.b')}) THEN RAISE(ABORT,'Cliques must be separate, available, and the same size') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM group_likes WHERE sender=NEW.a AND recipient=NEW.b AND sender_revision=(SELECT revision FROM clique_settings WHERE owner=NEW.a) AND recipient_revision=(SELECT revision FROM clique_settings WHERE owner=NEW.b)) OR NOT EXISTS(SELECT 1 FROM group_likes WHERE sender=NEW.b AND recipient=NEW.a AND sender_revision=(SELECT revision FROM clique_settings WHERE owner=NEW.b) AND recipient_revision=(SELECT revision FROM clique_settings WHERE owner=NEW.a)) THEN RAISE(ABORT,'Both clique organizers must agree') END;
END;
--> statement-breakpoint
CREATE TRIGGER group_match_added AFTER INSERT ON group_matches BEGIN DELETE FROM group_likes WHERE (sender=NEW.a AND recipient=NEW.b) OR (sender=NEW.b AND recipient=NEW.a); END;
--> statement-breakpoint
CREATE TRIGGER group_match_immutable BEFORE UPDATE ON group_matches BEGIN SELECT RAISE(ABORT,'Group matches cannot be reassigned'); END;
--> statement-breakpoint
CREATE TRIGGER clique_message_guard BEFORE INSERT ON clique_messages BEGIN
 SELECT CASE WHEN (NEW.friendship IS NULL)=(NEW.group_match IS NULL) THEN RAISE(ABORT,'Choose one conversation') END;
 SELECT CASE WHEN NEW.friendship IS NOT NULL AND NOT EXISTS(SELECT 1 FROM friendships WHERE id=NEW.friendship AND (a=NEW.sender OR b=NEW.sender)) THEN RAISE(ABORT,'An active friendship is required') END;
 SELECT CASE WHEN NEW.group_match IS NOT NULL AND NOT EXISTS(SELECT 1 FROM group_matches g WHERE g.id=NEW.group_match AND (NEW.sender IN(${memberSql('g.a')}) OR NEW.sender IN(${memberSql('g.b')}))) THEN RAISE(ABORT,'An active clique match is required') END;
END;
`;

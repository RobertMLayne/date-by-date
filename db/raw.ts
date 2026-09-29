import { env } from "cloudflare:workers";
export function getStore(){if(!env.DB)throw new Error("Database unavailable");return env.DB.withSession("first-primary");}
export function getBucket(){if(!env.BUCKET)throw new Error("Photo storage unavailable");return env.BUCKET;}


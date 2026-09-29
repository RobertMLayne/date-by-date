import {getStore} from "@/db/raw";
import {billingConfig,stripe,verifyWebhook} from "@/lib/billing";
import {promote} from "@/lib/service";
export async function POST(request:Request){try{
 const config=billingConfig();if(!config.webhook||!config.key)return new Response("Billing not configured",{status:503});
 const raw=await request.text();if(raw.length>1000000||!(await verifyWebhook(raw,request.headers.get("stripe-signature"),config.webhook)))return new Response("Invalid signature",{status:400});
 const event=JSON.parse(raw);if(!["customer.subscription.created","customer.subscription.updated","customer.subscription.deleted"].includes(event.type))return Response.json({received:true});
 const db=getStore();if(await db.prepare("SELECT id FROM billing_events WHERE id=?").bind(event.id).first())return Response.json({received:true});
 const sub=await stripe("subscriptions/"+encodeURIComponent(event.data.object.id));
 const owner=sub.metadata?.dbd_owner,addon=sub.metadata?.dbd_addon;if(typeof owner!=="string"||!owner.startsWith("user:")||!["capacity","queue"].includes(addon))return Response.json({received:true});
 const account:any=await db.prepare("SELECT customer FROM billing_accounts WHERE owner=?").bind(owner).first();if(!account||account.customer!==sub.customer)return new Response("Unrecognized customer",{status:400});
 const item=sub.items?.data?.find((i:any)=>i.price?.id===config[addon as "capacity"|"queue"]);
 const active=!!item&&["active","trialing"].includes(sub.status);
 const expires=active?Number(item.current_period_end||sub.current_period_end)*1000:0;if(!Number.isFinite(expires))throw new Error("Missing subscription period");
 const changes=[db.prepare("INSERT INTO billing_events(id,created) VALUES(?,?)").bind(event.id,event.created),
 db.prepare("INSERT INTO plans(id,owner,addon,expires,subscription,customer,updated) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner,addon) DO UPDATE SET expires=excluded.expires,subscription=excluded.subscription,customer=excluded.customer,updated=excluded.updated WHERE excluded.updated>=plans.updated").bind(owner+":"+addon,owner,addon,expires,sub.id,sub.customer,event.created)];
 if(active&&addon==="capacity")for(let i=0;i<5;i++)changes.push(promote(db,owner));
 try{await db.batch(changes);}catch(e){if(!(await db.prepare("SELECT id FROM billing_events WHERE id=?").bind(event.id).first()))throw e;}
 return Response.json({received:true});
}catch(e){console.error("Billing webhook failed:",e);return new Response("Retry later",{status:503});}}


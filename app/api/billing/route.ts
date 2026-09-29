import {getChatGPTUser} from "@/app/chatgpt-auth";
import {getStore} from "@/db/raw";
import {identity} from "@/lib/service";
import {billingConfig,stripe} from "@/lib/billing";
export async function POST(request:Request){try{
 const user=await getChatGPTUser();if(!user)return Response.json({error:"Sign in first."},{status:401});
 if(request.headers.get("origin")!==new URL(request.url).origin)return Response.json({error:"Invalid origin."},{status:403});
 const config=billingConfig();if(!config.key||!config.webhook||!config.capacity||!config.queue||!config.origin)return Response.json({error:"Billing is not connected yet. You can try all paid features in demo mode."},{status:503});
 const origin=new URL(config.origin);if(origin.protocol!=="https:"||origin.origin!==config.origin)return Response.json({error:"Billing configuration needs attention."},{status:503});
 const body:any=await request.json();const db=getStore();const {id}=identity(user.userId,"live");
 if(!(await db.prepare("SELECT id FROM profiles WHERE id=?").bind(id).first()))return Response.json({error:"Create your real profile before subscribing."},{status:400});
 let account:any=await db.prepare("SELECT customer FROM billing_accounts WHERE owner=?").bind(id).first();
 if(body.action==="portal"){
  if(!account)return Response.json({error:"No billing account yet."},{status:404});
  const portal=await stripe("billing_portal/sessions",{customer:account.customer,return_url:config.origin+"/?mode=live"});return Response.json({url:portal.url});
 }
 if(body.action!=="checkout"||!["capacity","queue"].includes(body.addon))return Response.json({error:"Choose a membership."},{status:400});
 const addon=body.addon as "capacity"|"queue";
 if(await db.prepare("SELECT id FROM plans WHERE owner=? AND addon=? AND expires>?").bind(id,addon,Date.now()).first())return Response.json({error:"You already have this upgrade. Manage it in billing."},{status:409});
 const price=await stripe("prices/"+encodeURIComponent(config[addon]));
 if(!price.active||price.unit_amount!==499||price.currency!=="usd"||price.recurring?.interval!=="month"||price.recurring?.interval_count!==1)return Response.json({error:"This membership's billing price needs to be configured as $4.99 USD per month."},{status:503});
 if(!account){const customer=await stripe("customers",{"metadata[dbd_owner]":id},"dbd-customer:"+id);await db.prepare("INSERT OR IGNORE INTO billing_accounts(owner,customer) VALUES(?,?)").bind(id,customer.id).run();account=await db.prepare("SELECT customer FROM billing_accounts WHERE owner=?").bind(id).first();}
 const session=await stripe("checkout/sessions",{mode:"subscription",customer:account.customer,"line_items[0][price]":config[addon],"line_items[0][quantity]":"1","subscription_data[metadata][dbd_owner]":id,"subscription_data[metadata][dbd_addon]":addon,client_reference_id:id,success_url:config.origin+"/?mode=live&billing=success",cancel_url:config.origin+"/?mode=live&billing=cancelled"},"dbd-checkout:"+id+":"+addon+":"+Math.floor(Date.now()/600000));
 return Response.json({url:session.url});
}catch(e:any){return Response.json({error:e.message||"Billing is temporarily unavailable."},{status:503});}}


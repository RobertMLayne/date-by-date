import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getStore,getBucket } from "@/db/raw";
import { identity } from "@/lib/service";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){try{
 const user=await getChatGPTUser();if(!user)return new Response(null,{status:401});
 const {id}=await params;const db=getStore();const photo:any=await db.prepare("SELECT * FROM photos WHERE id=?").bind(id).first();
 if(!photo)return new Response(null,{status:404});
 const viewer=identity(user.userId,photo.scope==="live"?"live":"demo");
 if(photo.scope!=="live"&&photo.scope!==viewer.scope)return new Response(null,{status:404});
 if(await db.prepare("SELECT id FROM blocks WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)").bind(viewer.id,photo.owner,photo.owner,viewer.id).first())return new Response(null,{status:404});
 const object=await getBucket().get(id);if(!object)return new Response(null,{status:404});
 return new Response(object.body,{headers:{"Content-Type":photo.mime,"Cache-Control":"private, max-age=60","X-Content-Type-Options":"nosniff"}});
}catch{return new Response(null,{status:503});}}


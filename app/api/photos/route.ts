import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getStore,getBucket } from "@/db/raw";
import { identity } from "@/lib/service";
export async function POST(request:Request){try{
 const user=await getChatGPTUser();if(!user)return Response.json({error:"Sign in first."},{status:401});
 if(request.headers.get("origin")!==new URL(request.url).origin)return Response.json({error:"Invalid origin."},{status:403});
 const mode=new URL(request.url).searchParams.get("mode")==="live"?"live":"demo";const {id:owner,scope}=identity(user.userId,mode);
 if(Number(request.headers.get("content-length"))>6*1024*1024)return Response.json({error:"Photos must be under 5 MB."},{status:413});
 const form=await request.formData();const file=form.get("file");
 if(!(file instanceof File)||file.size>5*1024*1024||file.size===0)return Response.json({error:"Choose a JPG, PNG, or WebP under 5 MB."},{status:400});
 const bytes=new Uint8Array(await file.arrayBuffer());
 const mime=bytes[0]===255&&bytes[1]===216&&bytes[2]===255?"image/jpeg":bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71?"image/png":String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP"?"image/webp":null;
 if(!mime)return Response.json({error:"Use a JPG, PNG, or WebP photo."},{status:400});
 const db=getStore();const count:any=await db.prepare("SELECT count(*) AS n FROM photos WHERE owner=?").bind(owner).first();
 if(count.n>=30)return Response.json({error:"Photo upload limit reached for this account."},{status:400});
 const id=crypto.randomUUID();await getBucket().put(id,bytes,{httpMetadata:{contentType:mime}});
 await db.prepare("INSERT INTO photos(id,owner,scope,mime) VALUES(?,?,?,?)").bind(id,owner,scope,mime).run();
 return Response.json({url:"/api/photos/"+id});
}catch(e){console.error("Photo upload:",e);return Response.json({error:"Photo upload failed. Please try again."},{status:503});}}


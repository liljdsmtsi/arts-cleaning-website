export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/reviews")) return handleReviews(request,env,ctx,url);
    if (url.pathname !== '/api/quote') return env.ASSETS.fetch(request);
    if (request.method !== 'POST') return new Response('Method not allowed', {status:405,headers:{Allow:'POST'}});
    if (!env.DB) return Response.json({error:'Database not configured'}, {status:503});
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return Response.json({error:'Invalid origin'}, {status:403});
    if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({error:'JSON required'}, {status:415});
    if (Number(request.headers.get('content-length') || 0)>12000) return Response.json({error:'Request too large'}, {status:413});
    let data;
    try { data = await request.json(); } catch { return Response.json({error:'Invalid JSON'}, {status:400}); }
    if (data.website) return Response.json({ok:true}); // honeypot
    const str=(v,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
    const name=str(data.name,80), phone=str(data.phone,30), email=str(data.email,254), service=str(data.service,80);
    if (!name || !phone || !service || !data.consent || name.length<2 || phone.length<7) return Response.json({error:'Please complete the required fields'}, {status:400});
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({error:'Invalid email'}, {status:400});
    const integer=v=>v===''||v==null?null:Number(v);
    const beds=integer(data.beds), baths=integer(data.baths);
    if ((beds!==null&&(!Number.isInteger(beds)||beds<0||beds>50))||(baths!==null&&(!Number.isFinite(baths)||baths<0||baths>50)))return Response.json({error:'Invalid property size'}, {status:400});
    try {
      await env.DB.prepare(`INSERT INTO cleaning_requests (customer_name,phone,email,service_type,property_address,bedrooms,bathrooms,preferred_date,customer_notes) VALUES (?,?,?,?,?,?,?,?,?)`).bind(name,phone,email,service,str(data.city,80),beds,baths,str(data.date,10),str(data.details,2000)).run();
      // Notification failures must never undo a successfully saved request.
      if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER && env.TWILIO_TO_NUMBER) {
        const notify = async () => {
          const body = [
            'A.R.T.S. Cleaning: New estimate request',
            `Name: ${name}`,
            `Phone: ${phone}`,
            `Service: ${service}`,
            email ? `Email: ${email}` : '',
            str(data.city,80) ? `Location: ${str(data.city,80)}` : '',
            str(data.date,10) ? `Preferred date: ${str(data.date,10)}` : ''
          ].filter(Boolean).join('\n');
          const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`;
          const params = new URLSearchParams({ To: env.TWILIO_TO_NUMBER, From: env.TWILIO_FROM_NUMBER, Body: body });
          try {
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: {
                Authorization: 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`),
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: params.toString()
            });
            if (!response.ok) console.error('Twilio SMS failed, HTTP', response.status);
          } catch (error) {
            console.error('Twilio SMS network error', String(error));
          }
        };
        if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(notify());
        else await notify();
      } else {
        console.warn('SMS notification skipped: Twilio configuration incomplete');
      }
      if (env.RESEND_API_KEY) {
        const sendEmail = async () => {
          const lines = [
            'New A.R.T.S. Cleaning estimate request',
            `Name: ${name}`, `Phone: ${phone}`, `Email: ${email || 'Not provided'}`,
            `Service: ${service}`, `City / ZIP: ${str(data.city,80) || 'Not provided'}`,
            `Preferred date: ${str(data.date,10) || 'Not provided'}`,
            `Bedrooms: ${beds ?? 'Not provided'}`, `Bathrooms: ${baths ?? 'Not provided'}`,
            `Notes: ${str(data.details,2000) || 'None'}`
          ];
          try {
            const response = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type':'application/json'},
              body: JSON.stringify({
                from: 'A.R.T.S. Cleaning <notifications@artscleaningco.com>',
                to: ['artscleaningservicesllc@outlook.com'],
                subject: 'New cleaning estimate request', text: lines.join('\n')
              })
            });
            if (!response.ok) console.error('Resend email failed, HTTP', response.status);
          } catch (error) { console.error('Resend email network error', String(error)); }
        };
        if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(sendEmail());
        else await sendEmail();
      }
      return Response.json({ok:true,message:'Request received. We will contact you to discuss an estimate.'}, {status:201,headers:{'Cache-Control':'no-store'}});
    } catch(e) { console.error('Quote submission failed',e); return Response.json({error:'Unable to save request. Please call or text instead.'}, {status:500}); }
  }
};

async function handleReviews(request,env,ctx,url){
 const json=(d,s=200)=>Response.json(d,{status:s,headers:{"Cache-Control":"no-store"}});
 if(!env.DB)return json({error:"Database unavailable"},503);
 const admin=url.pathname==="/api/reviews/admin" || url.pathname.startsWith("/api/reviews/photo/");
 if(admin){
  if(!env.REVIEW_ADMIN_PASSWORD||env.REVIEW_ADMIN_PASSWORD.length<16)return json({error:"Admin password not configured"},503);
  if(request.headers.get("Authorization")!=="Bearer "+env.REVIEW_ADMIN_PASSWORD)return json({error:"Unauthorized"},401);
 }
 if(request.method==="POST"&&request.headers.get("Origin")&&request.headers.get("Origin")!==url.origin)return json({error:"Invalid origin"},403);
 try{
  if(url.pathname.startsWith("/api/reviews/public-photo/") && request.method==="GET"){
   if(!env.REVIEW_PHOTOS)return json({error:"Photo storage unavailable"},503);
   const key=decodeURIComponent(url.pathname.slice("/api/reviews/public-photo/".length));
   if(!key.startsWith("reviews/") || !/^reviews[/][0-9]+[/][a-f0-9-]+[.](jpg|png|webp)$/.test(key))return json({error:"Invalid photo"},400);
   const row=await env.DB.prepare("SELECT r.status FROM customer_review_photos p JOIN customer_reviews r ON r.id=p.review_id WHERE p.object_key=?").bind(key).first();
   if(!row||row.status!=="approved")return json({error:"Not found"},404);
   const obj=await env.REVIEW_PHOTOS.get(key);if(!obj)return json({error:"Not found"},404);
   return new Response(obj.body,{headers:{"Content-Type":obj.httpMetadata?.contentType||"image/jpeg","Cache-Control":"public,max-age=300","X-Content-Type-Options":"nosniff"}});
  }
  if(url.pathname.startsWith("/api/reviews/photo/") && request.method==="GET"){
   if(!env.REVIEW_PHOTOS)return json({error:"Photo storage unavailable"},503);
   const key=url.pathname.slice("/api/reviews/photo/".length);
   if(!key.startsWith("reviews/") || !/^reviews[/][0-9]+[/][a-f0-9-]+[.](jpg|png|webp)$/.test(key))return json({error:"Invalid photo"},400);
   const object=await env.REVIEW_PHOTOS.get(key);
   if(!object)return json({error:"Not found"},404);
   return new Response(object.body,{headers:{"Content-Type":object.httpMetadata?.contentType||"image/jpeg","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  }
  if(url.pathname==="/api/reviews"&&request.method==="GET"){
   const r=await env.DB.prepare("SELECT id,display_name,rating,review_text,created_at FROM customer_reviews WHERE status='approved' ORDER BY created_at DESC LIMIT 30").all();
   const rows=r.results||[];
   if(env.REVIEW_PHOTOS && rows.length){const ids=rows.map(v=>v.id);const p=await env.DB.prepare("SELECT review_id,object_key FROM customer_review_photos WHERE review_id IN ("+ids.map(()=>"?").join(",")+") ORDER BY id").bind(...ids).all();for(const v of rows)v.photos=(p.results||[]).filter(x=>x.review_id===v.id).map(x=>"/api/reviews/public-photo/"+encodeURIComponent(x.object_key));}
   return json({reviews:rows});
  }
  if(url.pathname==="/api/reviews"&&request.method==="POST"){
   if(!request.headers.get("content-type")?.startsWith("application/json"))return json({error:"JSON required"},415);
   if(Number(request.headers.get("content-length")||0)>8000)return json({error:"Too large"},413);
   const d=await request.json();if(d.website)return json({ok:true},201);
   const name=typeof d.name==="string"?d.name.trim():"",message=typeof d.review==="string"?d.review.trim():"",rating=Number(d.rating);
   if(name.length<2||name.length>80||message.length<15||message.length>1500||!Number.isInteger(rating)||rating<1||rating>5||d.permission!==true)return json({error:"Complete all fields and consent to publication"},400);
   const photos=Array.isArray(d.photos)?d.photos:[];
   if(photos.length>5)return json({error:"Maximum five photos"},400);
   if(photos.length&&!env.REVIEW_PHOTOS)return json({error:"Photo storage not configured"},503);
   const decoded=[];
   for(const p of photos){
    if(typeof p!=="string"||p.length>2800000)return json({error:"Photo too large (maximum 2 MB each)"},413);
    const m=/^data:(image\[/](?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(p);
    if(!m)return json({error:"Use JPEG, PNG or WebP images"},400);
    const raw=atob(m[2]);if(raw.length>2*1024*1024)return json({error:"Photo too large (maximum 2 MB each)"},413);
    const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    const valid=m[1]==="image/jpeg"?(bytes[0]===255&&bytes[1]===216&&bytes[2]===255):m[1]==="image/png"?(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71):(String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP");
    if(!valid)return json({error:"Invalid image file"},400);
    decoded.push({bytes,type:m[1],ext:m[1]==="image/jpeg"?"jpg":m[1]==="image/png"?"png":"webp"});
   }
   const inserted=await env.DB.prepare("INSERT INTO customer_reviews(display_name,rating,review_text,status) VALUES(?,?,?,'pending')").bind(name,rating,message).run();
   const id=inserted.meta.last_row_id;
   for(const p of decoded){const key="reviews/"+id+"/"+crypto.randomUUID()+"."+p.ext;await env.REVIEW_PHOTOS.put(key,p.bytes,{httpMetadata:{contentType:p.type}});await env.DB.prepare("INSERT INTO customer_review_photos(review_id,object_key) VALUES(?,?)").bind(id,key).run();}
   if(env.RESEND_API_KEY){const notify=async()=>{try{await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:"A.R.T.S. Cleaning <notifications@artscleaningco.com>",to:["artscleaningservicesllc@outlook.com"],subject:"Customer review awaiting approval",text:"New "+rating+"-star review from "+name+". Open the private reviews dashboard to moderate it."})})}catch(e){console.error("Review notification",String(e))}};ctx.waitUntil(notify())}
   return json({ok:true},201);
  }
  if(admin&&url.pathname==="/api/reviews/admin"&&request.method==="GET"){const r=await env.DB.prepare("SELECT id,display_name,rating,review_text,status,created_at FROM customer_reviews ORDER BY created_at DESC LIMIT 200").all();const rows=r.results||[];if(env.REVIEW_PHOTOS&&rows.length){const ids=rows.map(x=>x.id);const p=await env.DB.prepare("SELECT review_id,object_key FROM customer_review_photos WHERE review_id IN ("+ids.map(()=>"?").join(",")+") ORDER BY id").bind(...ids).all();for(const v of rows)v.photos=(p.results||[]).filter(x=>x.review_id===v.id).map(x=>({key:x.object_key}));}return json({reviews:rows})}
  if(admin&&url.pathname==="/api/reviews/admin"&&request.method==="POST"){
   if(!request.headers.get("content-type")?.startsWith("application/json"))return json({error:"JSON required"},415);
   const d=await request.json();if(!Number.isSafeInteger(d.id)||!["pending","approved","rejected"].includes(d.status))return json({error:"Invalid update"},400);
   await env.DB.prepare("UPDATE customer_reviews SET status=? WHERE id=?").bind(d.status,d.id).run();return json({ok:true});
  }
  return json({error:"Method not allowed"},405);
 }catch(e){console.error("Review error",String(e));return json({error:"Review database not initialized or request failed"},500)}
}

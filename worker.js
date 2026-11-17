export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
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
      // Send the notification after saving. A messaging failure must not lose the quote.
      if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER && env.TWILIO_TO_NUMBER) {
        const notify = sendQuoteSms(env, {name, phone, email, service, city:str(data.city,80), date:str(data.date,10)});
        ctx.waitUntil(notify.catch(error => console.error('Quote SMS notification failed:', String(error))));
      } else {
        console.warn('Quote saved; SMS notification settings are incomplete');
      }
      return Response.json({ok:true,message:'Request received. We will contact you to discuss an estimate.'}, {status:201,headers:{'Cache-Control':'no-store'}});
    } catch(e) { console.error('Quote submission failed',e); return Response.json({error:'Unable to save request. Please call or text instead.'}, {status:500}); }
  }
};

async function sendQuoteSms(env, quote) {
  const body = [
    'A.R.T.S. Cleaning: New estimate request',
    `Name: ${quote.name}`,
    `Phone: ${quote.phone}`,
    `Service: ${quote.service}`,
    quote.city ? `Location: ${quote.city}` : '',
    quote.date ? `Preferred date: ${quote.date}` : '',
    quote.email ? `Email: ${quote.email}` : ''
  ].filter(Boolean).join('\n');
  const params = new URLSearchParams({
    To: env.TWILIO_TO_NUMBER,
    From: env.TWILIO_FROM_NUMBER,
    Body: body
  });
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    }
  );
  if (!response.ok) {
    // Avoid logging request contents or credentials.
    throw new Error(`Twilio API returned HTTP ${response.status}`);
  }
  console.log('Quote SMS accepted by Twilio');
}

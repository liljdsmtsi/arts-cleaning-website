const year=document.getElementById('year');if(year)year.textContent=new Date().getFullYear();const menu=document.getElementById('menu');if(menu)menu.addEventListener('click',()=>{
  const nav=document.getElementById('navlinks');
  if(!nav)return;
  const opened=nav.classList.toggle('open');
  menu.setAttribute('aria-expanded',String(opened));
});const form=document.getElementById('quoteForm');
if(form) form.addEventListener('submit',async e=>{
  e.preventDefault();
  const result=document.getElementById('formResult');
  const button=form.querySelector('button[type="submit"]');
  const value=id=>document.getElementById(id)?.value?.trim()||'';
  const payload={name:value('name'),phone:value('phone'),email:value('email'),city:value('city'),service:value('service'),date:value('date'),beds:value('beds'),baths:value('baths'),details:value('details'),consent:document.getElementById('consent').checked,website:value('website')};
  result.textContent='Sending your request…';
  button.disabled=true;
  try {
    const response=await fetch('/api/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const body=await response.json().catch(()=>({}));
    if(!response.ok||!body.ok) throw new Error(body.error||'Your request could not be submitted. Please try again or call us.');
    result.textContent=body.message||'Your request was received.';
    form.reset();
  } catch(error) {
    result.textContent=error.message||'Unable to submit. Please call or text instead.';
  } finally { button.disabled=false; }
});

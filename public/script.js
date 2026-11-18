document.getElementById('year').textContent=new Date().getFullYear();const menu=document.getElementById('menu');if(menu)menu.addEventListener('click',()=>{
  const nav=document.getElementById('navlinks');
  const opened=nav.classList.toggle('open');
  menu.setAttribute('aria-expanded',String(opened));
});const key='arts-redesign-demo-v1';function getLeads(){try{return JSON.parse(localStorage.getItem(key)||'[]')}catch{return []}}const form=document.getElementById('quoteForm');
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
const tbody=document.getElementById('leads');function render(){if(!tbody)return;const leads=getLeads();document.getElementById('leadCount').textContent=leads.length;tbody.replaceChildren();if(!leads.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=4;td.textContent='No demo requests yet. Submit a test request to see it here.';tr.append(td);tbody.append(tr)}leads.forEach((lead,i)=>{const tr=document.createElement('tr');for(const value of [lead.service,lead.city,lead.date]){const td=document.createElement('td');td.textContent=value;tr.append(td)}const td=document.createElement('td');const sel=document.createElement('select');for(const status of ['New lead','Estimate sent','Follow-up needed','Booked','Completed']){const opt=document.createElement('option');opt.value=status;opt.textContent=status;sel.append(opt)}sel.value=lead.status;sel.addEventListener('change',()=>{const a=getLeads();a[i].status=sel.value;localStorage.setItem(key,JSON.stringify(a))});td.append(sel);tr.append(td);tbody.append(tr)})}render();const clear=document.getElementById('clearLeads');if(clear)clear.addEventListener('click',()=>{localStorage.removeItem(key);render()});
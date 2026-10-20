(function(){
  var forms = document.querySelectorAll('.lead-form');
  if(!forms.length) return;
  var qs = new URLSearchParams(location.search);
  forms.forEach(function(form){
    var msg = form.querySelector('.lead-msg');
    var btn = form.querySelector('.lead-btn');
    form.addEventListener('submit', function(e){
      e.preventDefault();
      msg.className = 'lead-msg';
      var name = form.elements['name'].value.trim();
      var phone = form.elements['phone'].value.trim();
      var digits = phone.replace(/\D/g,'');
      if(name.length < 2){ msg.className='lead-msg err'; msg.textContent='من فضلك اكتب اسمك'; return; }
      if(digits.length < 9){ msg.className='lead-msg err'; msg.textContent='من فضلك اكتب رقم واتساب صحيح'; return; }
      if(!form.elements['consent'].checked){ msg.className='lead-msg err'; msg.textContent='لازم توافق على استلام الرسائل عشان نكمل'; return; }
      btn.disabled = true;
      fetch('/api/seller-applications', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          type:'lead', name:name, phone:phone, consent:true,
          website: form.elements['website'].value,
          source: form.getAttribute('data-source') || 'site',
          page: location.pathname,
          utm_source: qs.get('utm_source') || null,
          utm_medium: qs.get('utm_medium') || null,
          utm_campaign: qs.get('utm_campaign') || null
        })
      }).then(function(r){ return r.json().catch(function(){return {};}).then(function(d){ return {ok:r.ok,d:d}; }); })
        .then(function(res){
          if(res.ok){
            msg.className='lead-msg ok';
            msg.textContent='شكرًا ليك! حنرسل ليك كود الخصم على واتساب قريبًا ✓';
            form.reset();
            if(window.gtag){ gtag('event','lead_signup',{source: form.getAttribute('data-source')||'site'}); }
          } else {
            msg.className='lead-msg err';
            msg.textContent='حصلت مشكلة، حاول مرة ثانية أو تواصل معانا عبر واتساب.';
            btn.disabled=false;
          }
        })
        .catch(function(){ msg.className='lead-msg err'; msg.textContent='حصلت مشكلة في الاتصال، حاول مرة ثانية.'; btn.disabled=false; });
    });
  });
})();

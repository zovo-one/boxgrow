(function(){
  // i18n bootstrap (fleet Chrome-150 pattern): plain-JS port of
  // src/shared/i18n.ts. onboarding.js is copied verbatim to dist (never
  // bundled), so it cannot import shared/i18n.ts. The semantics are
  // identical: resolve every [data-i18n] text node and [data-i18n-attr]
  // attribute through chrome.i18n.getMessage; overwrite ONLY when a message
  // actually exists so the literal English in the HTML stays intact for
  // untranslated keys, and no raw __MSG_ ever appears in markup (Chrome 150
  // broke that path).
  function getMsg(key,subs){
    try{
      var m = (typeof chrome!=='undefined' && chrome.i18n && chrome.i18n.getMessage)
        ? chrome.i18n.getMessage(key,subs) : '';
      return m || '';
    }catch(e){ return ''; }
  }
  function applyI18n(){
    try{
      var nodes=document.querySelectorAll('[data-i18n]');
      for(var i=0;i<nodes.length;i++){
        var key=nodes[i].getAttribute('data-i18n');
        if(!key) continue;
        var text=getMsg(key);
        if(text) nodes[i].textContent=text;
      }
      var attrNodes=document.querySelectorAll('[data-i18n-attr]');
      for(var j=0;j<attrNodes.length;j++){
        var spec=attrNodes[j].getAttribute('data-i18n-attr');
        if(!spec) continue;
        var pairs=spec.split(';');
        for(var k=0;k<pairs.length;k++){
          var parts=pairs[k].split(':');
          var attr=(parts[0]||'').replace(/^\s+|\s+$/g,'');
          var akey=(parts[1]||'').replace(/^\s+|\s+$/g,'');
          if(!attr||!akey) continue;
          var val=getMsg(akey);
          if(val) attrNodes[j].setAttribute(attr,val);
        }
      }
    }catch(e){ /* localization never breaks the page */ }
  }
  applyI18n();

  // ---- engine premium onboarding controller, template logic VERBATIM ----
  // Only storage-key names (ffp_ -> bg_) and copy literals were adapted for
  // BoxGrow. Step navigation, dot rail, skip/back/next, the demo typer, and
  // the finish() close path (chrome.tabs.getCurrent -> chrome.tabs.remove,
  // window.close fallbacks) are the template's, untouched.
  var TOTAL=6, i=0;
  var steps=[].slice.call(document.querySelectorAll('.step'));
  var rail=document.getElementById('rail'), back=document.getElementById('back'),
      next=document.getElementById('next'), stepno=document.getElementById('stepno');
  for(var d=0;d<TOTAL;d++){var e=document.createElement('span');e.className='dot';rail.appendChild(e);}
  var dots=[].slice.call(rail.children);
  function render(){
    steps.forEach(function(s,n){s.classList.toggle('on',n===i);});
    dots.forEach(function(dt,n){dt.className='dot'+(n<i?' done':n===i?' now':'');});
    back.style.visibility = i===0?'hidden':'visible';
    stepno.textContent=(i+1)+' of '+TOTAL;
    next.textContent = i===TOTAL-1 ? 'Start typing' : (i===4 ? 'Maybe later' : 'Next');
    next.className = 'btn '+(i===TOTAL-1?'btn--primary':'btn--primary');
    if(i===1) setTimeout(runDemo,350);
  }
  function go(n){ i=Math.max(0,Math.min(TOTAL-1,n)); render();
    try{chrome.storage&&chrome.storage.local&&chrome.storage.local.set({bg_onboard_step:i});}catch(e){} }
  next.addEventListener('click',function(){ if(i===TOTAL-1){ finish(); } else go(i+1); });
  back.addEventListener('click',function(){go(i-1);});
  document.getElementById('skip').addEventListener('click',finish);
  document.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key==='Enter'){ if(document.activeElement.tagName!=='INPUT'&&document.activeElement.tagName!=='A') next.click(); }
    if(e.key==='ArrowLeft') back.click();
  });
  function finish(){
    try{chrome.storage&&chrome.storage.local&&chrome.storage.local.set({bg_onboardingComplete:true});}catch(e){}
    try{ if(chrome.tabs&&chrome.tabs.getCurrent){chrome.tabs.getCurrent(function(t){t&&t.id!=null?chrome.tabs.remove(t.id):window.close();});} else window.close(); }catch(e){ window.close(); }
  }
  // step 2 fill demo
  var demoRan=false;
  function runDemo(){
    var boxes=document.querySelectorAll('[data-step="1"] .box[data-fill]');
    boxes.forEach(function(b){b.classList.remove('filled');b.textContent=' ';});
    demoRan=true;
    boxes.forEach(function(b,n){
      setTimeout(function(){
        var val=b.getAttribute('data-fill'); b.textContent='';
        b.classList.add('filled');
        var k=0; (function type(){ b.textContent=val.slice(0,k); if(k<=val.length){k++;setTimeout(type,22);} })();
      }, 260*n);
    });
  }
  document.getElementById('demoBtn').addEventListener('click',runDemo);
  // step 3 save
  var saveBtn=document.getElementById('saveBtn');
  saveBtn && saveBtn.addEventListener('click',function(){
    var name=(document.getElementById('pn').value||'A line worth keeping');
    try{chrome.storage&&chrome.storage.local&&chrome.storage.local.set({bg_practice_line:name, bg_has_practice_line:true});}catch(e){}
    document.getElementById('saved').classList.add('show');
    saveBtn.textContent='Draft saved'; saveBtn.disabled=true; saveBtn.style.opacity=.7;
  });
  render();
})();

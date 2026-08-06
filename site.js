/* ReqPub shared site script - footer injection + cookie consent + Do Not Share.
   Single origin (reqpub.com): links are root-relative paths. */
(function(){
  const YEAR = new Date().getFullYear();
  const PREF_KEY = 'reqpub_cookie_prefs';
  const DNS_KEY  = 'reqpub_dns'; // "Do Not Share/Sell My Personal Information"

  function read(k){ try{ return JSON.parse(localStorage.getItem(k)); }catch{ return null; } }
  function write(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }

  /* ---------- Footer ---------- */
  const footerHTML =
    '<footer class="site-foot">'+
      '<div class="wrap">'+
        '<div class="top">'+
          '<div class="col">'+
            '<a class="lockup on-dark" href="/" style="font-size:20px">'+
              '<svg class="mark" viewBox="0 0 40 40" style="width:30px;height:30px"><rect x="3.5" y="3.5" width="33" height="33" rx="9" fill="none" stroke-width="3"/><polyline points="17 13 24 20 17 27" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'+
              'ReqPub</a>'+
            '<p class="blurb">Create, manage, and publish requirements with clarity and confidence.</p>'+
          '</div>'+
          '<div class="col"><h5>Product</h5>'+
            '<a href="/">Overview</a>'+
            '<a href="/app/">Open the app</a>'+
            '<a href="/signup/">Sign up</a>'+
            '<a href="/login/">Sign in</a>'+
          '</div>'+
          '<div class="col"><h5>Legal</h5>'+
            '<a href="/terms.html">Terms of Service</a>'+
            '<a href="/privacy.html">Privacy Statement</a>'+
            '<a href="/cookies.html">Cookie Policy</a>'+
            '<a href="/acceptable-use.html">Acceptable Use</a>'+
          '</div>'+
          '<div class="col"><h5>Company</h5>'+
            '<a href="mailto:[hello@reqpub.example]">Contact</a>'+
            '<a href="/do-not-share.html">Your privacy choices</a>'+
            '<button type="button" data-rp-cookies>Manage cookies</button>'+
          '</div>'+
        '</div>'+
        '<div class="bottom">'+
          '<span class="copy">© '+YEAR+' [ReqPub, Inc.] · From discovery to defensible requirements.</span>'+
          '<div class="legal-links">'+
            '<a href="/terms.html">TERMS</a>'+
            '<a href="/privacy.html">PRIVACY</a>'+
            '<button type="button" data-rp-cookies>MANAGE COOKIES</button>'+
            '<a href="/do-not-share.html">DO NOT SHARE MY PERSONAL INFORMATION</a>'+
          '</div>'+
        '</div>'+
      '</div>'+
    '</footer>';

  /* ---------- Cookie banner + modal ---------- */
  const bannerHTML =
    '<div id="rp-cookie-banner" role="dialog" aria-label="Cookie consent">'+
      '<p>ReqPub uses required cookies to run the service and, with your consent, analytics cookies to understand usage. See our <a href="/cookies.html">Cookie Policy</a>.</p>'+
      '<div class="row">'+
        '<button class="btn btn-primary btn-sm" data-rp-cookie-accept>Accept all</button>'+
        '<button class="btn btn-secondary btn-sm" data-rp-cookie-reject>Reject non-essential</button>'+
        '<button class="btn btn-secondary btn-sm" data-rp-cookies>Manage</button>'+
      '</div>'+
    '</div>';

  const modalHTML =
    '<div class="rp-modal-back" id="rp-cookie-modal" role="dialog" aria-modal="true" aria-label="Manage cookie preferences">'+
      '<div class="rp-modal">'+
        '<h3>Manage cookie preferences</h3>'+
        '<p class="desc">Cookies are small files stored on your device. You can turn off optional categories below. See the full <a href="/cookies.html">Cookie Policy</a>.</p>'+
        '<div class="rp-pref">'+
          '<div class="h"><strong>Required</strong><span class="rp-pill">Always on</span></div>'+
          '<p>Needed to sign you in, keep your session secure, remember preferences, and run essential features. These cannot be switched off.</p>'+
        '</div>'+
        '<div class="rp-pref">'+
          '<div class="h"><strong>Analytics</strong>'+
            '<label class="rp-switch"><input type="checkbox" id="rp-analytics"><span class="track"></span><span class="knob"></span></label>'+
          '</div>'+
          '<p>Helps us understand which features are used so we can improve ReqPub. No advertising, and we do not sell this data.</p>'+
        '</div>'+
        '<div class="actions">'+
          '<button class="btn btn-secondary btn-sm" data-rp-cookie-reject>Reject non-essential</button>'+
          '<button class="btn btn-primary btn-sm" data-rp-cookie-save>Save changes</button>'+
        '</div>'+
      '</div>'+
    '</div>';

  function inject(){
    const slot = document.getElementById('site-footer');
    if(slot){ slot.outerHTML = footerHTML; }
    else if(!document.querySelector('.site-foot')){ document.body.insertAdjacentHTML('beforeend', footerHTML); }
    if(!document.getElementById('rp-cookie-banner')) document.body.insertAdjacentHTML('beforeend', bannerHTML);
    if(!document.getElementById('rp-cookie-modal'))  document.body.insertAdjacentHTML('beforeend', modalHTML);

    const prefs = read(PREF_KEY);
    if(!prefs || !prefs.set){ const b=document.getElementById('rp-cookie-banner'); if(b) b.classList.add('show'); }

    document.addEventListener('click', function(e){
      const t = e.target.closest('[data-rp-cookies],[data-rp-cookie-accept],[data-rp-cookie-reject],[data-rp-cookie-save]');
      if(!t) return;
      if(t.hasAttribute('data-rp-cookies'))        openModal();
      if(t.hasAttribute('data-rp-cookie-accept'))  save(true);
      if(t.hasAttribute('data-rp-cookie-reject'))  save(false);
      if(t.hasAttribute('data-rp-cookie-save'))    save(!!document.getElementById('rp-analytics').checked);
    });
    const back=document.getElementById('rp-cookie-modal');
    if(back) back.addEventListener('click', function(e){ if(e.target===back) back.classList.remove('show'); });
  }

  function openModal(){
    const prefs = read(PREF_KEY) || {analytics:false};
    const cb = document.getElementById('rp-analytics'); if(cb) cb.checked = !!prefs.analytics;
    document.getElementById('rp-cookie-modal').classList.add('show');
  }
  function save(analytics){
    write(PREF_KEY, {set:true, analytics:!!analytics, ts:Date.now()});
    const b=document.getElementById('rp-cookie-banner'); if(b) b.classList.remove('show');
    const m=document.getElementById('rp-cookie-modal'); if(m) m.classList.remove('show');
  }

  window.reqpubCookies = { open: openModal, prefs: function(){ return read(PREF_KEY); } };
  window.reqpubDNS = {
    get: function(){ const v=read(DNS_KEY); return v && v.optedOut===true; },
    set: function(v){ write(DNS_KEY, {optedOut:!!v, ts:Date.now()}); }
  };

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();

/* ReqPub v2 - sign up. The display name travels in user metadata; the app
   copies it into user_profiles at first sign-in (works with or without
   email confirmation enabled). claim_invites() at first app load routes
   invited teammates and partners to the right workspace. */
(function () {
  const cfg = window.SB_CFG || {};
  if (!cfg.url || !cfg.anon || !window.supabase) return;
  const sb = window.supabase.createClient(cfg.url, cfg.anon);
  const $ = function (id) { return document.getElementById(id); };
  const esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  // Invite links carry the workspace name and the invited email
  // (/signup/?ws=Collection%20Ventures&email=lee@fathers.com): show where
  // they are headed and prefill the email so they cannot mistype it.
  try {
    const params = new URLSearchParams(location.search);
    const ws = (params.get('ws') || '').slice(0, 120);
    const invitedEmail = (params.get('email') || '').slice(0, 320);
    if (ws) {
      $('wsBannerName').textContent = ws;
      $('wsBanner').style.display = '';
    }
    if (invitedEmail) $('email').value = invitedEmail;
  } catch { /* no params */ }

  $('signupForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const btn = $('signupBtn');
    btn.disabled = true; btn.textContent = 'Creating…';
    $('msg').innerHTML = '';
    sb.auth.signUp({
      email: $('email').value.trim(),
      password: $('password').value,
      options: { data: { display_name: $('name').value.trim() } }
    }).then(function (r) {
      if (r.error) {
        btn.disabled = false; btn.textContent = 'Create account';
        $('msg').innerHTML = '<div class="err">' + esc(r.error.message || 'Could not sign up') + '</div>';
        return;
      }
      if (r.data && r.data.session) { location.replace('/app/'); return; }
      $('msg').innerHTML = '<div class="ok"><strong>Check your email.</strong> We sent a confirmation link to ' +
        esc($('email').value.trim()) + '. Open it, then sign in.</div>';
      btn.textContent = 'Account created';
    });
  });
})();

-- ============================================================================
-- ReqPub C1 HARDENING - EGRESS GUARD. Run once in the Supabase SQL editor,
-- after fix-authz-lockdown.sql. Idempotent; safe to run twice.
--
-- FINDING C1-004, HIGH, server-side request forgery through a webhook
-- destination.
--
-- endpoint_create required HTTPS and a non-empty host, and nothing else. Any
-- project manager could therefore register a destination inside the
-- deployment's own network and make the delivery worker, which holds the
-- service role, sign and POST to it: loopback, RFC 1918 space, link-local,
-- and in particular the cloud metadata address at 169.254.169.254. The
-- request would carry a valid ReqPub signature, which is worse than an
-- unsigned one, because a naive internal listener may treat a signed request
-- as trusted.
--
-- The guard below refuses, at creation and again at dispatch:
--   * any host that is an IP literal in any notation, decimal, octal,
--     hexadecimal, dotted, or bracketed IPv6, because a destination worth
--     trusting has a name;
--   * loopback, private, link-local, carrier-grade NAT, multicast, and
--     reserved ranges by name where a name is used;
--   * userinfo in the authority, which is the classic way to make a URL read
--     as one host and resolve as another;
--   * .local, .internal, .home.arpa, and bare single-label names, which only
--     resolve inside a network.
--
-- What this does NOT solve, stated plainly rather than implied: a name that
-- resolves publicly at creation and privately at delivery, DNS rebinding.
-- Closing that requires resolving the name in the delivery function and
-- pinning the address for the life of the request, which is TypeScript-side
-- work tracked as C1-005 in HARDENING_REPORT.md. Redirects are already not
-- followed, which removes the other half of that class.
-- ============================================================================

do $$
begin
  if to_regprocedure('public.webhook_host(text)') is null then
    raise exception 'fix-ssrf-guard.sql prerequisite missing: webhook_host';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- webhook_host_allowed: the single place that decides whether ReqPub will
-- ever send bytes to a destination. Returns the reason for refusal, or null
-- when the host is acceptable, so callers can log why rather than guess.
-- ----------------------------------------------------------------------------
create or replace function webhook_host_refusal(p_url text)
returns text language plpgsql immutable set search_path = public as $$
declare v_auth text; v_host text; v_label text;
begin
  if p_url is null or p_url !~ '^https://[^[:space:]]+$' or length(p_url) > 2000 then
    return 'https_required';
  end if;
  -- The authority is everything after the scheme and before the first / ? #
  v_auth := substring(p_url from '^https://([^/?#]+)');
  if v_auth is null or v_auth = '' then return 'https_required'; end if;

  -- Userinfo in the authority: https://real.example@internal.host/
  if position('@' in v_auth) > 0 then return 'userinfo_not_allowed'; end if;

  -- Strip the port. A bracketed IPv6 literal is refused outright.
  if left(v_auth, 1) = '[' then return 'ip_literal_not_allowed'; end if;
  v_host := lower(split_part(v_auth, ':', 1));
  if v_host = '' then return 'https_required'; end if;

  -- Any IP literal, in any notation. A destination worth trusting has a name.
  if v_host ~ '^[0-9]+$' then return 'ip_literal_not_allowed'; end if;                 -- decimal, 2130706433
  if v_host ~ '^0[xX][0-9a-fA-F]+$' then return 'ip_literal_not_allowed'; end if;      -- hexadecimal
  if v_host ~ '^[0-9]{1,3}(\.[0-9]{1,3}){1,3}$' then return 'ip_literal_not_allowed'; end if;
  if v_host ~ '^0[0-7]*(\.[0-7]+){1,3}$' then return 'ip_literal_not_allowed'; end if; -- octal
  if v_host ~ ':' then return 'ip_literal_not_allowed'; end if;                        -- bare IPv6

  -- Names that only mean something inside a network.
  if v_host = 'localhost' or v_host like '%.localhost' then return 'internal_host'; end if;
  if v_host like '%.local' or v_host like '%.internal' or v_host like '%.home.arpa'
     or v_host like '%.intranet' or v_host like '%.lan' or v_host like '%.corp'
     then return 'internal_host'; end if;

  -- A single-label name has no public meaning and resolves only via a local
  -- search domain.
  if position('.' in v_host) = 0 then return 'internal_host'; end if;

  -- A trailing dot is a valid absolute name but a common filter bypass; the
  -- normalised form is what gets stored, so refuse rather than silently edit.
  if right(v_host, 1) = '.' then return 'internal_host'; end if;

  return null;
end; $$;
revoke execute on function webhook_host_refusal(text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function webhook_host_refusal(text) to service_role';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Refuse at creation. House replacement of the v2.50 body; the only change is
-- the guard and the reason it returns.
-- ----------------------------------------------------------------------------
create or replace function endpoint_create(p_project text, p_url text, p_description text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid; v_host text; v_refusal text;
begin
  if not is_project_manager(p_project) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  v_org := project_org(p_project);
  if v_org is null then return jsonb_build_object('ok', false, 'error', 'unknown_project'); end if;
  v_refusal := webhook_host_refusal(p_url);
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'error', v_refusal,
      'message', case v_refusal
        when 'https_required' then 'A webhook destination must be an https URL.'
        when 'userinfo_not_allowed' then 'A webhook destination cannot carry a username in the URL.'
        when 'ip_literal_not_allowed' then 'A webhook destination must be a hostname, not an IP address.'
        else 'That destination is inside a private network and cannot be reached from ReqPub.' end);
  end if;
  v_host := webhook_host(p_url);
  insert into webhook_endpoints(org_id, project_id, url, description, created_by)
  values (v_org, p_project, p_url, left(coalesce(p_description, ''), 300), auth.uid())
  returning id into v_id;
  perform log_activity(v_org, p_project, 'webhook.endpoint_changed', 'webhook',
    v_id::text, 'Webhook endpoint added: ' || v_host,
    jsonb_build_object('host', v_host, 'change', 'added'));
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
revoke execute on function endpoint_create(text, text, text) from public, anon;
grant execute on function endpoint_create(text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Refuse again at dispatch. A row stored before this file existed, or edited
-- by any other means, still never gets bytes sent to it.
-- ----------------------------------------------------------------------------
create or replace function deliveries_due(p_project text, p_limit int default 20)
returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  if not is_project_manager(p_project) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'ids', coalesce((
    select jsonb_agg(d.id order by d.created_at)
    from (select dd.id, dd.created_at
            from webhook_deliveries dd
            join webhook_endpoints ee on ee.id = dd.endpoint_id
           where ee.project_id = p_project and ee.active
             and dd.state in ('pending', 'failed')
             and coalesce(dd.next_retry_at, now()) <= now()
             and webhook_host_refusal(ee.url) is null   -- C1-004: never dispatch to an internal destination
           order by dd.created_at
           limit greatest(1, least(coalesce(p_limit, 20), 50))) d), '[]'::jsonb));
end; $$;
revoke execute on function deliveries_due(text, int) from public, anon;
grant execute on function deliveries_due(text, int) to authenticated;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0029', 'ssrf_guard', '7f6d1ffe603553977ffd7e620178e0eb4a41a2520040019a4b69fa8545363a44')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;

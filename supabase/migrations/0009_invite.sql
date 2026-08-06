-- ReqPub fix: claim_invites returns which orgs were just joined, so the app
-- can route a fresh invitee straight into the workspace they were invited
-- to instead of their personal one. Also the return-type change requires a
-- drop. Run once in the Supabase SQL editor. Idempotent.
drop function if exists claim_invites();
create or replace function claim_invites()
returns jsonb language plpgsql security definer set search_path = public as $$
declare my_email text; n int := 0; p int := 0; ids jsonb := '[]'::jsonb;
begin
  select email into my_email from auth.users where id = auth.uid();
  if my_email is null then return jsonb_build_object('n', 0, 'org_ids', '[]'::jsonb); end if;
  with joined as (
    insert into org_members(org_id, user_id, email, role)
      select i.org_id, auth.uid(), my_email, i.role from org_invites i where lower(i.email) = lower(my_email)
      on conflict (org_id, user_id) do nothing
      returning org_id)
  select count(*), coalesce(jsonb_agg(org_id), '[]'::jsonb) into n, ids from joined;
  delete from org_invites where lower(email) = lower(my_email);
  update partners set user_id = auth.uid() where lower(email) = lower(my_email) and user_id is null;
  get diagnostics p = row_count;
  return jsonb_build_object('n', n + p, 'org_ids', ids);
end; $$;
grant execute on function claim_invites() to authenticated;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0009', 'invite', 'c6e395002525160d8085f01985fe057c4dbf86ca556e162f46c0e70dffe994a3')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;

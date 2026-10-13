-- 0064: the Viewer's giving summary follows the Fundraising module
-- (role audit, 2026-10-13).
--
-- member_giving (0031) checked who was asking but not whether the org
-- runs Fundraising at all. The Giving screen is not there when the module
-- is off, but the function still answered a direct call with the org's
-- gifts, pledges, campaigns and seats. Same function, one more check:
-- with the module off it returns null, as it does for a stranger.

create or replace function public.member_giving(p_org uuid)
  returns jsonb
  language plpgsql stable security definer
  set search_path = public
  as $$
  declare
    my_seat board_members%rowtype;
    my_donor uuid;
    out jsonb;
  begin
    if not (p_org in (select private._member_org_ids()) or p_org in (select private._observer_org_ids())) then
      return null;
    end if;
    -- The Fundraising module is off: nothing to show, the same as the
    -- Giving screen, which is not there.
    if not coalesce((select (o.modules->>'donor_fundraising')::boolean from orgs o where o.id = p_org), false) then
      return null;
    end if;

    select * into my_seat from board_members
      where org_id = p_org and user_id = auth.uid()
      order by status = 'active' desc, created_at
      limit 1;
    my_donor := my_seat.donor_id;

    out := jsonb_build_object(
      'my_seat_id', my_seat.id,
      'gifts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', g.id, 'amount', g.amount, 'received_on', g.received_on, 'category', g.category, 'method', g.method,
          'donor_id', g.donor_id, 'campaign_id', g.campaign_id, 'pledge_id', g.pledge_id, 'solicited_by', g.solicited_by,
          'donor_name', case
            when my_seat.id is not null and (g.solicited_by = my_seat.id or (my_donor is not null and g.donor_id = my_donor))
              then (select d.name from donors d where d.id = g.donor_id)
            else null end
        ) order by g.received_on desc)
        from gifts g where g.org_id = p_org
      ), '[]'::jsonb),
      'pledges', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'amount', p.amount, 'promised_on', p.promised_on, 'due_on', p.due_on, 'status', p.status,
          'donor_id', p.donor_id, 'campaign_id', p.campaign_id, 'solicited_by', p.solicited_by
        ) order by p.promised_on desc)
        from pledges p where p.org_id = p_org
      ), '[]'::jsonb),
      'campaigns', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'goal_amount', c.goal_amount, 'ends_on', c.ends_on) order by c.ends_on desc)
        from campaigns c where c.org_id = p_org
      ), '[]'::jsonb),
      'budget', coalesce((
        select jsonb_agg(jsonb_build_object('fiscal_year', b.fiscal_year, 'category', b.category, 'amount', b.amount))
        from fundraising_budget b where b.org_id = p_org
      ), '[]'::jsonb),
      'boards', coalesce((
        select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'kind', b.kind, 'sport', b.sport, 'give_get_amount', b.give_get_amount, 'min_seats', b.min_seats, 'max_seats', b.max_seats) order by b.sort_order)
        from boards b where b.org_id = p_org
      ), '[]'::jsonb),
      'seats', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'board_id', m.board_id,
          'name', case when m.id = my_seat.id then m.name else null end,
          'role_title', case when m.id = my_seat.id then m.role_title else null end,
          'donor_id', m.donor_id, 'status', m.status, 'term_start', m.term_start, 'term_end', m.term_end,
          'commitment_amount', m.commitment_amount
        ) order by m.created_at)
        from board_members m where m.org_id = p_org
      ), '[]'::jsonb)
    );
    return out;
  end;
  $$;

revoke execute on function public.member_giving(uuid) from public, anon;
grant execute on function public.member_giving(uuid) to authenticated;

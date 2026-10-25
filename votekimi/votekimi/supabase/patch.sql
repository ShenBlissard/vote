-- 补丁：把管理 token 改为明文存储（原脚本的哈希函数在新版 Supabase 中不可用）
-- 用法：SQL Editor → 新建查询（或清空现有编辑区）→ 粘贴全文 → Run

-- ---------- 创建投票（去掉哈希） ----------

create or replace function public.create_poll(
  p_poll_id text,
  p_admin_token text,
  p_title text,
  p_description text,
  p_min_choices integer,
  p_max_choices integer,
  p_shuffle_candidates boolean,
  p_anonymous boolean,
  p_deadline timestamptz,
  p_allow_change boolean,
  p_auto_publish boolean,
  p_pub_top_n integer,
  p_turnout_mode text,
  p_candidates jsonb,
  p_voters jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_desc text := btrim(coalesce(p_description, ''));
  cands text[];
  voter_rows jsonb;
  v_min int;
  v_max int;
  v_topn int;
begin
  if length(v_title) = 0 then return jsonb_build_object('ok', false, 'error', '请填写投票主题'); end if;
  if length(v_title) > 100 then return jsonb_build_object('ok', false, 'error', '投票主题过长（最多100字）'); end if;
  if length(v_desc) > 1000 then return jsonb_build_object('ok', false, 'error', '投票说明过长（最多1000字）'); end if;

  select coalesce(array_agg(name order by ord), '{}') into cands
  from (
    select t.x as name, t.ord,
      row_number() over (partition by t.x order by t.ord) rn
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_candidates) = 'array' then p_candidates else '[]'::jsonb end
    ) with ordinality as t(x, ord)
    where length(x) between 1 and 50
  ) s where rn = 1;

  if array_length(cands, 1) < 2 then return jsonb_build_object('ok', false, 'error', '至少需要2位候选人'); end if;
  if array_length(cands, 1) > 100 then return jsonb_build_object('ok', false, 'error', '候选人过多（最多100位）'); end if;

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'passcode', passcode) order by ord), '[]'::jsonb)
  into voter_rows
  from (
    select (e->>'name') as name, left(coalesce(e->>'passcode', ''), 20) as passcode, t.ord,
      row_number() over (partition by (e->>'name') order by t.ord) rn
    from jsonb_array_elements(
      case when jsonb_typeof(p_voters) = 'array' then p_voters else '[]'::jsonb end
    ) with ordinality as t(e, ord)
    where jsonb_typeof(e) = 'object'
      and length(coalesce(e->>'name', '')) between 1 and 50
  ) s where rn = 1;

  if jsonb_array_length(voter_rows) < 1 then return jsonb_build_object('ok', false, 'error', '请填写参与人名单'); end if;
  if jsonb_array_length(voter_rows) > 500 then return jsonb_build_object('ok', false, 'error', '参与人过多（最多500人）'); end if;

  v_min := p_min_choices; v_max := p_max_choices;
  if v_min is null or v_max is null or v_min < 1 or v_max < v_min or v_max > array_length(cands, 1) then
    return jsonb_build_object('ok', false, 'error', '每人投票人数设置无效（需为1~候选人数量之间的范围）');
  end if;

  v_topn := coalesce(p_pub_top_n, -1);
  if v_topn < -1 or v_topn > array_length(cands, 1) then
    return jsonb_build_object('ok', false, 'error', '公布设置无效（前N名需为0~候选人数量，或全部公布）');
  end if;

  if p_turnout_mode not in ('none', 'voted', 'not_voted', 'both') then
    return jsonb_build_object('ok', false, 'error', '参与情况公布设置无效');
  end if;

  if p_deadline is null or p_deadline <= now() then
    return jsonb_build_object('ok', false, 'error', '截止时间必须晚于当前时间');
  end if;

  insert into public.polls (
    id, title, description, min_choices, max_choices, shuffle_candidates,
    anonymous, deadline, allow_change, auto_publish, pub_top_n, turnout_mode,
    published, status, admin_token_hash, created_at
  ) values (
    p_poll_id, v_title, v_desc, v_min, v_max, coalesce(p_shuffle_candidates, false),
    coalesce(p_anonymous, true), p_deadline, coalesce(p_allow_change, false),
    coalesce(p_auto_publish, true), v_topn, p_turnout_mode,
    false, 'open', p_admin_token, now()
  );

  insert into public.candidates (id, poll_id, name, sort_order)
  select md5(p_poll_id || ':' || x || ':' || ord), p_poll_id, x, ord
  from unnest(cands) with ordinality as u(x, ord);

  insert into public.voters (id, poll_id, name, passcode)
  select md5(p_poll_id || ':v:' || (r->>'name') || ':' || ord), p_poll_id, r->>'name', r->>'passcode'
  from jsonb_array_elements(voter_rows) with ordinality as t(r, ord);

  return jsonb_build_object('ok', true, 'id', p_poll_id, 'admin_token', p_admin_token);
end $$;

-- ---------- 管理查询（去掉哈希） ----------

create or replace function public.get_admin_data(p_admin_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p public.polls;
  roster jsonb;
begin
  select * into p from public.polls where admin_token_hash = p_admin_token;
  if not found then return null; end if;

  if p.anonymous then
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'name', v.name, 'passcode', v.passcode,
        'voted', b.id is not null, 'submittedAt', b.submitted_at, 'choiceNames', '[]'::jsonb
      ) order by v.seq), '[]'::jsonb)
    into roster
    from public.voters v
    left join public.ballots b on b.voter_id = v.id
    where v.poll_id = p.id;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'name', v.name, 'passcode', v.passcode,
        'voted', b.id is not null, 'submittedAt', b.submitted_at,
        'choiceNames', coalesce((
          select jsonb_agg(c.name order by c.sort_order)
          from public.choices ch join public.candidates c on c.id = ch.candidate_id
          where ch.ballot_id = b.id), '[]'::jsonb)
      ) order by v.seq), '[]'::jsonb)
    into roster
    from public.voters v
    left join public.ballots b on b.voter_id = v.id
    where v.poll_id = p.id;
  end if;

  return jsonb_build_object(
    'poll', jsonb_build_object(
      'id', p.id, 'title', p.title, 'description', p.description,
      'minChoices', p.min_choices, 'maxChoices', p.max_choices,
      'shuffleCandidates', p.shuffle_candidates, 'anonymous', p.anonymous,
      'deadline', p.deadline, 'createdAt', p.created_at,
      'allowChange', p.allow_change, 'autoPublish', p.auto_publish,
      'pubTopN', p.pub_top_n, 'turnoutMode', p.turnout_mode,
      'published', p.published, 'status', p.status,
      'open', public.poll_is_open(p), 'resultsMode', public.poll_results_mode(p)),
    'candidates', coalesce((
      with counts as (
        select c.id, c.name, c.sort_order, count(ch.candidate_id) as n
        from public.candidates c
        left join public.choices ch on ch.candidate_id = c.id
        where c.poll_id = p.id
        group by c.id, c.name, c.sort_order
      )
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'count', n)
        order by n desc, sort_order)
      from counts), '[]'::jsonb),
    'roster', roster,
    'votedCount', (select count(*) from public.ballots where poll_id = p.id),
    'voterTotal', (select count(*) from public.voters where poll_id = p.id));
end $$;

-- ---------- 管理操作（去掉哈希） ----------

create or replace function public.admin_action(
  p_admin_token text,
  p_action text,
  p_params jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p public.polls;
  v_new_deadline timestamptz;
  v_topn int;
  v_cand_total int;
begin
  select * into p from public.polls where admin_token_hash = p_admin_token;
  if not found then return jsonb_build_object('ok', false, 'error', '管理链接无效'); end if;

  if p_action = 'close' then
    update public.polls set status = 'closed' where id = p.id;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'publish' then
    if public.poll_is_open(p) then
      return jsonb_build_object('ok', false, 'error', '投票尚未截止，不能公布结果');
    end if;
    update public.polls set published = true where id = p.id;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'unpublish' then
    update public.polls set published = false, auto_publish = false where id = p.id;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'updateDeadline' then
    begin
      v_new_deadline := (p_params->>'deadline')::timestamptz;
    exception when others then
      return jsonb_build_object('ok', false, 'error', '请填写正确的截止时间');
    end;
    if v_new_deadline is null then
      return jsonb_build_object('ok', false, 'error', '请填写正确的截止时间');
    end if;
    if v_new_deadline <= now() then
      return jsonb_build_object('ok', false, 'error', '无法修改成过去的时间');
    end if;
    update public.polls set deadline = v_new_deadline, status = 'open' where id = p.id;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'updateSettings' then
    if jsonb_typeof(p_params->'autoPublish') = 'boolean' then
      update public.polls set auto_publish = (p_params->>'autoPublish')::boolean where id = p.id;
    end if;
    if jsonb_typeof(p_params->'anonymous') = 'boolean' then
      update public.polls set anonymous = (p_params->>'anonymous')::boolean where id = p.id;
    end if;
    if p_params ? 'pubTopN' then
      v_topn := (p_params->>'pubTopN')::integer;
      select count(*) into v_cand_total from public.candidates where poll_id = p.id;
      if v_topn is null or v_topn < -1 or v_topn > v_cand_total then
        return jsonb_build_object('ok', false, 'error', '公布设置无效（前N名需为0~候选人数量，或全部公布）');
      end if;
      update public.polls set pub_top_n = v_topn where id = p.id;
    end if;
    if p_params->>'turnoutMode' in ('none', 'voted', 'not_voted', 'both') then
      update public.polls set turnout_mode = p_params->>'turnoutMode' where id = p.id;
    end if;
    return jsonb_build_object('ok', true);
  end if;

  return jsonb_build_object('ok', false, 'error', '未知操作');
end $$;

grant execute on function
  public.create_poll(text, text, text, text, integer, integer, boolean, boolean, timestamptz, boolean, boolean, integer, text, jsonb, jsonb),
  public.get_admin_data(text),
  public.admin_action(text, text, jsonb)
to anon;

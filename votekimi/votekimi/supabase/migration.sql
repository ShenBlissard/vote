-- =============================================================
-- 班级投票系统 · 数据库结构（一次性执行）
-- 用法：Supabase 控制台左侧 SQL Editor → New query → 粘贴全文 → Run
-- =============================================================


-- ---------- 表结构 ----------

create table if not exists public.polls (
  id text primary key,
  title text not null,
  description text not null default '',
  min_choices integer not null default 1,
  max_choices integer not null default 1,
  shuffle_candidates boolean not null default false,
  anonymous boolean not null default true,
  deadline timestamptz not null,
  allow_change boolean not null default false,
  auto_publish boolean not null default true,
  pub_top_n integer not null default -1,
  turnout_mode text not null default 'both',
  published boolean not null default false,
  status text not null default 'open',
  admin_token_hash text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.candidates (
  id text primary key,
  poll_id text not null references public.polls(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0
);

create table if not exists public.voters (
  id text primary key,
  poll_id text not null references public.polls(id) on delete cascade,
  name text not null,
  passcode text not null default '',
  seq bigint generated always as identity,
  unique (poll_id, name)
);

create table if not exists public.ballots (
  id text primary key,
  poll_id text not null references public.polls(id) on delete cascade,
  voter_id text not null unique references public.voters(id) on delete cascade,
  submitted_at timestamptz not null default now()
);

create table if not exists public.choices (
  ballot_id text not null references public.ballots(id) on delete cascade,
  candidate_id text not null references public.candidates(id) on delete cascade,
  primary key (ballot_id, candidate_id)
);

create index if not exists candidates_poll_idx on public.candidates(poll_id);
create index if not exists voters_poll_idx on public.voters(poll_id);
create index if not exists ballots_poll_idx on public.ballots(poll_id);
create index if not exists choices_candidate_idx on public.choices(candidate_id);

-- ---------- 安全：所有读写只能通过下方函数（存储过程）进行 ----------

alter table public.polls enable row level security;
alter table public.candidates enable row level security;
alter table public.voters enable row level security;
alter table public.ballots enable row level security;
alter table public.choices enable row level security;

revoke all on public.polls, public.candidates, public.voters, public.ballots, public.choices
  from anon, authenticated;

-- ---------- 公共辅助函数 ----------

create or replace function public.poll_is_open(p public.polls)
returns boolean language sql stable as $$
  select p.status = 'open' and p.deadline > now()
$$;

create or replace function public.poll_results_mode(p public.polls)
returns text language sql stable as $$
  select case
    when p.status <> 'open' or p.deadline <= now() then
      case when p.auto_publish or p.published then 'published' else 'not_published' end
    else 'hidden'
  end
$$;

-- 前N名自动收缩：若并列导致所选名次不存在，按「宁可少公布」收缩
create or replace function public.snap_pub_top_n(p_poll_id text)
returns void language plpgsql as $$
declare
  d int[];
  target int;
begin
  select array_agg(distinct r) into d
  from (
    select rank() over (order by n desc) as r
    from (
      select count(ch.candidate_id) as n
      from public.candidates c
      left join public.choices ch on ch.candidate_id = c.id
      where c.poll_id = p_poll_id
      group by c.id, c.sort_order
    ) t
  ) t2;
  if d is null then return; end if;
  select p.pub_top_n into target from public.polls p where p.id = p_poll_id;
  if target is null or target <= 0 then return; end if;
  if not (target = any(d)) then
    update public.polls set pub_top_n = greatest(1, coalesce((
      select max(x) from unnest(d) u(x) where x < target
    ), 1)) where id = p_poll_id;
  end if;
end $$;

-- ---------- 创建投票 ----------

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

-- ---------- 公共查询：投票基本信息 ----------

create or replace function public.get_poll_public(p_poll_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.polls;
begin
  select * into p from public.polls where id = p_poll_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', p.id,
    'title', p.title,
    'description', p.description,
    'minChoices', p.min_choices,
    'maxChoices', p.max_choices,
    'shuffleCandidates', p.shuffle_candidates,
    'deadline', p.deadline,
    'allowChange', p.allow_change,
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by sort_order)
      from public.candidates where poll_id = p.id), '[]'::jsonb),
    'voterNames', coalesce((
      select jsonb_agg(name order by seq) from public.voters where poll_id = p.id), '[]'::jsonb),
    'voterCount', (select count(*) from public.voters where poll_id = p.id),
    'open', public.poll_is_open(p),
    'resultsMode', public.poll_results_mode(p)
  );
end $$;

-- ---------- 公共查询：投票人状态（姓名+口令校验） ----------

create or replace function public.voter_status(p_poll_id text, p_name text, p_passcode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p public.polls;
  v record;
  b record;
  empty jsonb := jsonb_build_object('exists', false, 'needsPasscode', false, 'passcodeOk', false, 'voted', false, 'choices', '[]'::jsonb);
begin
  select * into p from public.polls where id = p_poll_id;
  if not found then return empty; end if;
  select id, passcode into v from public.voters where poll_id = p_poll_id and name = btrim(coalesce(p_name, ''));
  if not found then return empty; end if;
  if v.passcode <> '' and v.passcode <> btrim(coalesce(p_passcode, '')) then
    return jsonb_build_object('exists', true, 'needsPasscode', true, 'passcodeOk', false, 'voted', false, 'choices', '[]'::jsonb);
  end if;
  select id into b from public.ballots where voter_id = v.id;
  if not found then
    return jsonb_build_object('exists', true, 'needsPasscode', v.passcode <> '', 'passcodeOk', true, 'voted', false, 'choices', '[]'::jsonb);
  end if;
  if p.allow_change then
    return jsonb_build_object(
      'exists', true, 'needsPasscode', v.passcode <> '', 'passcodeOk', true, 'voted', true,
      'choices', coalesce((
        select jsonb_agg(candidate_id) from public.choices where ballot_id = b.id), '[]'::jsonb));
  end if;
  return jsonb_build_object('exists', true, 'needsPasscode', v.passcode <> '', 'passcodeOk', true, 'voted', true, 'choices', '[]'::jsonb);
end $$;

-- ---------- 提交投票（全部校验在一个事务里完成） ----------

create or replace function public.cast_vote(
  p_poll_id text,
  p_ballot_id text,
  p_name text,
  p_passcode text,
  p_candidate_ids jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p public.polls;
  v record;
  ids text[];
  b_id text;
  n int;
begin
  select * into p from public.polls where id = p_poll_id;
  if not found then return jsonb_build_object('ok', false, 'error', '投票不存在或链接错误'); end if;
  if btrim(coalesce(p_name, '')) = '' then return jsonb_build_object('ok', false, 'error', '请选择你的姓名'); end if;
  if not public.poll_is_open(p) then return jsonb_build_object('ok', false, 'error', '投票已截止，无法提交'); end if;

  select id, passcode into v from public.voters where poll_id = p_poll_id and name = btrim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '该姓名不在本次投票名单中，请核对'); end if;
  if v.passcode <> '' and v.passcode <> btrim(coalesce(p_passcode, '')) then
    return jsonb_build_object('ok', false, 'error', '口令错误，请向发起人核对');
  end if;

  select coalesce(array_agg(x order by ord), '{}') into ids
  from (
    select t.x, t.ord, row_number() over (partition by t.x order by t.ord) rn
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_candidate_ids) = 'array' then p_candidate_ids else '[]'::jsonb end
    ) with ordinality as t(x, ord)
    where t.x <> ''
  ) s where rn = 1;
  n := array_length(ids, 1);

  if n is null or n < p.min_choices or n > p.max_choices then
    if p.min_choices = p.max_choices then
      return jsonb_build_object('ok', false, 'error', '请选择' || p.min_choices || '位候选人');
    else
      return jsonb_build_object('ok', false, 'error', '请选择' || p.min_choices || '~' || p.max_choices || '位候选人');
    end if;
  end if;

  if (select count(*) from public.candidates where poll_id = p_poll_id and id = any(ids)) <> n then
    return jsonb_build_object('ok', false, 'error', '所选候选人无效');
  end if;

  select id into b_id from public.ballots where voter_id = v.id;
  if b_id is not null then
    if not p.allow_change then
      return jsonb_build_object('ok', false, 'error', '你已投过票，本次投票不允许修改');
    end if;
    delete from public.choices where ballot_id = b_id;
    update public.ballots set submitted_at = now() where id = b_id;
  else
    begin
      insert into public.ballots (id, poll_id, voter_id, submitted_at)
      values (p_ballot_id, p_poll_id, v.id, now());
      b_id := p_ballot_id;
    exception when unique_violation then
      if not p.allow_change then
        return jsonb_build_object('ok', false, 'error', '你已投过票，本次投票不允许修改');
      end if;
      select id into b_id from public.ballots where voter_id = v.id;
      delete from public.choices where ballot_id = b_id;
      update public.ballots set submitted_at = now() where id = b_id;
    end;
  end if;

  insert into public.choices (ballot_id, candidate_id)
  select b_id, x from unnest(ids) as u(x);

  if p.pub_top_n > 0 then
    begin
      perform public.snap_pub_top_n(p_poll_id);
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true);
end $$;

-- ---------- 公共查询：投票结果 ----------

create or replace function public.get_results(p_poll_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p public.polls;
  mode text;
  closed boolean;
  ranked jsonb;
  total int;
  snapped int;
  all_counts int[];
  shown jsonb;
  voter_total int;
  voted_count int;
  voted_names jsonb;
  notvoted_names jsonb;
begin
  select * into p from public.polls where id = p_poll_id;
  if not found then return null; end if;
  mode := public.poll_results_mode(p);
  closed := not public.poll_is_open(p);

  if mode = 'hidden' or mode = 'not_published' then
    return jsonb_build_object(
      'mode', mode, 'closed', closed,
      'candidates', '[]'::jsonb, 'candidateTotal', 0,
      'turnoutMode', p.turnout_mode,
      'turnout', jsonb_build_object('votedCount', null, 'voterTotal', null, 'votedNames', null, 'notVotedNames', null));
  end if;

  with counts as (
    select c.id, c.name, c.sort_order, count(ch.candidate_id) as n
    from public.candidates c
    left join public.choices ch on ch.candidate_id = c.id
    where c.poll_id = p_poll_id
    group by c.id, c.name, c.sort_order
  ), ranked_rows as (
    select id, name, n,
      rank() over (order by n desc) as r,
      row_number() over (order by n desc, sort_order) as pos
    from counts
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'count', n) order by pos), '[]'::jsonb),
         coalesce(array_agg(n order by pos), '{}'),
         count(*)
  into ranked, all_counts, total
  from ranked_rows;

  snapped := p.pub_top_n;
  if snapped > 0 then
    with counts as (
      select count(ch.candidate_id) as n
      from public.candidates c
      left join public.choices ch on ch.candidate_id = c.id
      where c.poll_id = p_poll_id
      group by c.id, c.sort_order
    ), ranked_rows as (
      select rank() over (order by n desc) as r from counts
    )
    select case when snapped = any(array_agg(distinct r)) then snapped
      else greatest(1, coalesce(max(r) filter (where r < snapped), 1))
    end into snapped
    from ranked_rows;
  end if;

  if p.pub_top_n = -1 then
    shown := ranked;
  elsif p.pub_top_n <= 0 then
    shown := '[]'::jsonb;
  else
    with counts as (
      select c.id, count(ch.candidate_id) as n, c.sort_order
      from public.candidates c
      left join public.choices ch on ch.candidate_id = c.id
      where c.poll_id = p_poll_id
      group by c.id, c.sort_order
    ), ranked_rows as (
      select c2.id, rank() over (order by n desc) as r
      from counts c2
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', rj.id, 'name', rj.name, 'count', rj.n) order by rj.pos), '[]'::jsonb)
    into shown
    from (
      select rr.id, rr.r, c3.name, c3.n, c3.pos
      from ranked_rows rr
      join (
        select c4.id, c4.name, c4.n,
          row_number() over (order by c4.n desc, c4.sort_order) as pos
        from (
          select c5.id, c5.name, count(ch2.candidate_id) as n, c5.sort_order
          from public.candidates c5
          left join public.choices ch2 on ch2.candidate_id = c5.id
          where c5.poll_id = p_poll_id
          group by c5.id, c5.name, c5.sort_order
        ) c4
      ) c3 on c3.id = rr.id
      where rr.r <= snapped
    ) rj;
  end if;

  select count(*) into voter_total from public.voters where poll_id = p_poll_id;
  select count(*) into voted_count from public.ballots where poll_id = p_poll_id;
  voted_names := null; notvoted_names := null;
  if closed and p.turnout_mode <> 'none' then
    if p.turnout_mode in ('voted', 'both') then
      select coalesce(jsonb_agg(name order by seq), '[]'::jsonb) into voted_names
      from public.voters v where v.poll_id = p_poll_id
        and exists (select 1 from public.ballots b where b.voter_id = v.id);
    end if;
    if p.turnout_mode in ('not_voted', 'both') then
      select coalesce(jsonb_agg(name order by seq), '[]'::jsonb) into notvoted_names
      from public.voters v where v.poll_id = p_poll_id
        and not exists (select 1 from public.ballots b where b.voter_id = v.id);
    end if;
  end if;

  return jsonb_build_object(
    'mode', mode, 'closed', closed,
    'candidates', shown,
    'candidateTotal', total,
    'turnoutMode', p.turnout_mode,
    'turnout', jsonb_build_object(
      'votedCount', voted_count, 'voterTotal', voter_total,
      'votedNames', voted_names, 'notVotedNames', notvoted_names));
end $$;

-- ---------- 管理查询：管理页数据（凭管理 token） ----------

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

-- ---------- 管理操作：截止/公布/改截止时间/改设置 ----------

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

-- ---------- 函数权限：仅允许匿名前端调用这些函数 ----------

revoke execute on all functions in schema public from public;

grant execute on function
  public.create_poll(text, text, text, text, integer, integer, boolean, boolean, timestamptz, boolean, boolean, integer, text, jsonb, jsonb),
  public.get_poll_public(text),
  public.voter_status(text, text, text),
  public.cast_vote(text, text, text, text, jsonb),
  public.get_results(text),
  public.get_admin_data(text),
  public.admin_action(text, text, jsonb)
to anon;

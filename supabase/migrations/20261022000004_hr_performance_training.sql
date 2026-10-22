-- Human Resources, part 4: performance reviews, goals and training.
--
-- Reviews:   draft (reviewer scores each criterion 1–5) ──submit──▶ submitted (the employee sees it)
--              ──acknowledge (with the employee's comments)──▶ acknowledged
-- Goals:     set by a reviewer; the employee and reviewer update progress; 100% completes the goal.
-- Training:  HR schedules a training; staff enrol themselves (if it's for their department and there's room) or HR
--            enrols them; HR records attendance, hours and scores; anyone who completes it (and passes, when it is
--            scored) can print a certificate and leave feedback.
--
--   * Reviewers are department and branch heads (performance.review) for the branches they cover. Nobody reviews
--     themselves or sets their own goals.
--   * Professional certifications can carry an expiry date, so HR sees renewals coming.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into public.permissions (code, description) values
  ('performance.read', 'View performance reviews and goals'),
  ('performance.review', 'Review staff performance and set their goals'),
  ('training.manage', 'Schedule training, enrol staff and record attendance and results');

insert into public.role_permissions (role_code, permission_code) values
  ('hr_officer', 'performance.read'),
  ('hr_officer', 'training.manage'),
  ('head_of_hr', 'performance.read'),
  ('head_of_hr', 'performance.review'),
  ('head_of_hr', 'training.manage'),
  ('internal_auditor', 'performance.read'),
  -- Department and branch heads review their people. They open HR only for this.
  ('branch_manager', 'module.hr'),
  ('branch_manager', 'performance.read'),
  ('branch_manager', 'performance.review'),
  ('head_of_administration', 'module.hr'),
  ('head_of_administration', 'performance.read'),
  ('head_of_administration', 'performance.review'),
  ('credit_manager', 'module.hr'),
  ('credit_manager', 'performance.read'),
  ('credit_manager', 'performance.review'),
  ('financial_controller', 'performance.read'),
  ('financial_controller', 'performance.review');

alter table public.employee_qualifications add column expires_on date;

-- ---------------------------------------------------------------------------
-- Performance reviews
-- ---------------------------------------------------------------------------

create type public.review_status as enum ('draft', 'submitted', 'acknowledged');

create table public.performance_reviews (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  reviewer_id uuid not null default auth.uid() references public.staff (id),
  period_label text not null check (length(trim(period_label)) > 0),
  period_start date not null,
  period_end date not null,
  status public.review_status not null default 'draft',
  overall_score numeric(3, 2),
  strengths text,
  improvements text,
  reviewer_comments text,
  employee_comments text,
  next_review_date date,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  acknowledged_at timestamptz,
  constraint performance_reviews_period check (period_end >= period_start)
);
create index performance_reviews_employee_idx on public.performance_reviews (employee_id, period_end);

create table public.performance_review_scores (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.performance_reviews (id) on delete cascade,
  criterion text not null check (length(trim(criterion)) > 0),
  target text,
  actual text,
  score integer not null check (score between 1 and 5),
  comment text,
  sort_order integer not null default 0
);
create index performance_review_scores_review_idx on public.performance_review_scores (review_id);

create or replace function app.performance_reviews_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.in_workflow() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'submitted reviews are kept' using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if app.is_own_employee_record(new.employee_id) then
      raise exception 'someone else has to review you' using errcode = 'insufficient_privilege';
    end if;
    if not exists (select 1 from public.employees e where e.id = new.employee_id and e.status in ('probation', 'active')) then
      raise exception 'reviews are for current employees' using errcode = 'check_violation';
    end if;
    new.reviewer_id := auth.uid();
    new.status := 'draft';
    new.overall_score := null;
    new.employee_comments := null;
    new.created_at := now();
    new.submitted_at := null;
    new.acknowledged_at := null;
    return new;
  end if;
  if old.status <> 'draft' or old.reviewer_id <> auth.uid() then
    raise exception 'only the reviewer can change a review, and only while it is a draft' using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status or new.employee_id is distinct from old.employee_id
     or new.reviewer_id is distinct from old.reviewer_id or new.overall_score is distinct from old.overall_score
     or new.employee_comments is distinct from old.employee_comments or new.submitted_at is distinct from old.submitted_at
     or new.acknowledged_at is distinct from old.acknowledged_at then
    raise exception 'a review is submitted and acknowledged through the workflow' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger performance_reviews_guard
  before insert or update or delete on public.performance_reviews
  for each row execute function app.performance_reviews_guard();

-- Scores change only on the reviewer's own drafts.
create or replace function app.performance_review_scores_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.in_workflow() then
    return coalesce(new, old);
  end if;
  if not exists (
    select 1 from public.performance_reviews r
    where r.id = coalesce(new.review_id, old.review_id) and r.status = 'draft' and r.reviewer_id = auth.uid()
  ) then
    raise exception 'scores change only on your own draft review' using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger performance_review_scores_guard
  before insert or update or delete on public.performance_review_scores
  for each row execute function app.performance_review_scores_guard();

create or replace function public.submit_performance_review(p_review_id uuid)
returns public.performance_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review public.performance_reviews;
begin
  select * into v_review from public.performance_reviews where id = p_review_id for update;
  if not found or v_review.reviewer_id <> auth.uid() then
    raise exception 'review not found' using errcode = 'no_data_found';
  end if;
  if v_review.status <> 'draft' then
    raise exception 'this review has already been submitted' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.performance_review_scores where review_id = p_review_id) then
    raise exception 'score at least one criterion before submitting' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.performance_reviews
     set status = 'submitted', submitted_at = now(),
         overall_score = (select round(avg(score), 2) from public.performance_review_scores where review_id = p_review_id),
         next_review_date = coalesce(next_review_date, (period_end + interval '6 months')::date)
   where id = p_review_id
   returning * into v_review;
  perform app.end_workflow();
  return v_review;
end;
$$;

-- The employee confirms they have read the review, adding their own comments.
create or replace function public.acknowledge_performance_review(p_review_id uuid, p_comments text default null)
returns public.performance_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review public.performance_reviews;
begin
  select * into v_review from public.performance_reviews where id = p_review_id for update;
  if not found or not app.is_own_employee_record(v_review.employee_id) then
    raise exception 'review not found' using errcode = 'no_data_found';
  end if;
  if v_review.status <> 'submitted' then
    raise exception 'only a submitted review can be acknowledged' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.performance_reviews
     set status = 'acknowledged', acknowledged_at = now(), employee_comments = nullif(trim(p_comments), '')
   where id = p_review_id
   returning * into v_review;
  perform app.end_workflow();
  return v_review;
end;
$$;

-- ---------------------------------------------------------------------------
-- Goals
-- ---------------------------------------------------------------------------

create table public.employee_goals (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  title text not null check (length(trim(title)) > 0),
  description text,
  goal_type text not null default 'performance'
    check (goal_type in ('performance', 'development', 'project', 'sales', 'customer_satisfaction', 'innovation')),
  target_date date,
  progress integer not null default 0 check (progress between 0 and 100),
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  progress_note text,
  set_by uuid not null default auth.uid() references public.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index employee_goals_employee_idx on public.employee_goals (employee_id);

create or replace function app.employee_goals_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.in_workflow() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if app.is_own_employee_record(new.employee_id) then
      raise exception 'someone else sets your goals' using errcode = 'insufficient_privilege';
    end if;
    new.set_by := auth.uid();
    new.progress := 0;
    new.status := 'open';
    new.completed_at := null;
    new.created_at := now();
  else
    if new.employee_id is distinct from old.employee_id or new.set_by is distinct from old.set_by
       or new.progress is distinct from old.progress or new.completed_at is distinct from old.completed_at then
      raise exception 'progress is updated with the progress button' using errcode = 'insufficient_privilege';
    end if;
    -- A completed or cancelled goal stays as it is: no reopening, and no cancelling a goal that was met.
    if old.status <> 'open' then
      raise exception 'this goal is closed' using errcode = 'check_violation';
    end if;
    if new.status = 'completed' and old.status <> 'completed' then
      raise exception 'a goal completes when its progress reaches 100%%' using errcode = 'check_violation';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger employee_goals_guard
  before insert or update on public.employee_goals
  for each row execute function app.employee_goals_guard();

-- The employee, or a reviewer for their branch, records how far a goal has got. 100% completes it.
create or replace function public.update_goal_progress(p_goal_id uuid, p_progress integer, p_note text default null)
returns public.employee_goals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_goal public.employee_goals;
begin
  select * into v_goal from public.employee_goals where id = p_goal_id for update;
  if not found or not (
    app.is_own_employee_record(v_goal.employee_id)
    or app.has_branch_permission('performance.review', app.employee_branch(v_goal.employee_id))
  ) then
    raise exception 'goal not found' using errcode = 'no_data_found';
  end if;
  if v_goal.status <> 'open' then
    raise exception 'this goal is closed' using errcode = 'check_violation';
  end if;
  if p_progress is null or p_progress not between 0 and 100 then
    raise exception 'progress is a percentage from 0 to 100' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.employee_goals
     set progress = p_progress,
         progress_note = coalesce(nullif(trim(p_note), ''), progress_note),
         status = case when p_progress = 100 then 'completed' else status end,
         completed_at = case when p_progress = 100 then now() end,
         updated_at = now()
   where id = p_goal_id
   returning * into v_goal;
  perform app.end_workflow();
  return v_goal;
end;
$$;

-- ---------------------------------------------------------------------------
-- Training
-- ---------------------------------------------------------------------------

create table public.trainings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text,
  trainer text,
  starts_on date not null,
  ends_on date not null,
  hours numeric(6, 1) check (hours > 0),
  venue text,
  is_virtual boolean not null default false,
  meeting_url text,
  capacity integer check (capacity > 0),
  cost_per_person numeric(14, 2) check (cost_per_person >= 0),
  -- Scored trainings issue a certificate only at or above this mark. Null: no score, completion is enough.
  pass_mark integer check (pass_mark between 0 and 100),
  -- Empty: open to every department.
  departments text[] not null default '{}',
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  created_by uuid not null default auth.uid() references public.staff (id),
  created_at timestamptz not null default now(),
  constraint trainings_dates check (ends_on >= starts_on)
);
create index trainings_dates_idx on public.trainings (starts_on);

create table public.training_enrollments (
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references public.trainings (id) on delete restrict,
  employee_id uuid not null references public.employees (id) on delete restrict,
  status text not null default 'enrolled' check (status in ('enrolled', 'completed', 'no_show', 'withdrawn')),
  hours_attended numeric(6, 1) check (hours_attended >= 0),
  score numeric(5, 2) check (score between 0 and 100),
  passed boolean,
  feedback_rating integer check (feedback_rating between 1 and 5),
  feedback_comment text,
  enrolled_by uuid not null references public.staff (id),
  enrolled_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (training_id, employee_id)
);
create index training_enrollments_employee_idx on public.training_enrollments (employee_id);

create or replace function app.training_enrollments_guard()
returns trigger
language plpgsql
as $$
begin
  if not app.in_workflow() then
    raise exception 'enrolments change only through enrolling, withdrawing and recording results'
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger training_enrollments_guard
  before insert or update or delete on public.training_enrollments
  for each row execute function app.training_enrollments_guard();

-- Enrols the signed-in employee, or (with training.manage) someone else.
create or replace function public.enrol_in_training(p_training_id uuid, p_employee_id uuid default null)
returns public.training_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_training public.trainings;
  v_employee public.employees;
  v_row public.training_enrollments;
  v_by_hr boolean := p_employee_id is not null;
begin
  select * into v_training from public.trainings where id = p_training_id for update;
  if not found then
    raise exception 'training not found' using errcode = 'no_data_found';
  end if;
  if v_by_hr then
    select * into v_employee from public.employees where id = p_employee_id;
    if not found or not app.has_branch_permission('training.manage', v_employee.branch_id) then
      raise exception 'employee not found' using errcode = 'no_data_found';
    end if;
  else
    select * into v_employee from public.employees where staff_id = auth.uid();
    if not found then
      raise exception 'your login isn''t linked to an employee record; ask HR' using errcode = 'no_data_found';
    end if;
    if cardinality(v_training.departments) > 0 and not (v_employee.department_code = any (v_training.departments)) then
      raise exception 'this training is for other departments; ask HR to enrol you' using errcode = 'check_violation';
    end if;
  end if;
  if v_employee.status not in ('probation', 'active') then
    raise exception 'only current employees can be enrolled' using errcode = 'check_violation';
  end if;
  if v_training.status <> 'scheduled' or v_training.starts_on < current_date then
    raise exception 'enrolment has closed for this training' using errcode = 'check_violation';
  end if;
  if v_training.capacity is not null and (
    select count(*) from public.training_enrollments where training_id = p_training_id and status <> 'withdrawn'
  ) >= v_training.capacity then
    raise exception 'this training is full' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  insert into public.training_enrollments (training_id, employee_id, enrolled_by)
  values (p_training_id, v_employee.id, auth.uid())
  on conflict (training_id, employee_id) do update set status = 'enrolled', enrolled_by = auth.uid(), enrolled_at = now()
    where public.training_enrollments.status = 'withdrawn'
  returning * into v_row;
  perform app.end_workflow();
  if v_row.id is null then
    raise exception 'already enrolled' using errcode = 'check_violation';
  end if;
  return v_row;
end;
$$;

create or replace function public.withdraw_from_training(p_enrollment_id uuid)
returns public.training_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.training_enrollments;
  v_training public.trainings;
begin
  select * into v_row from public.training_enrollments where id = p_enrollment_id for update;
  if not found or not (app.is_own_employee_record(v_row.employee_id)
                       or app.has_branch_permission('training.manage', app.employee_branch(v_row.employee_id))) then
    raise exception 'enrolment not found' using errcode = 'no_data_found';
  end if;
  select * into v_training from public.trainings where id = v_row.training_id;
  if v_row.status <> 'enrolled' or v_training.starts_on <= current_date then
    raise exception 'you can withdraw only before the training starts' using errcode = 'check_violation';
  end if;
  perform app.begin_workflow();
  update public.training_enrollments set status = 'withdrawn' where id = p_enrollment_id returning * into v_row;
  perform app.end_workflow();
  return v_row;
end;
$$;

-- HR records whether someone completed the training (with hours and score) or didn't show up.
create or replace function public.record_training_result(
  p_enrollment_id uuid, p_status text, p_hours numeric default null, p_score numeric default null
)
returns public.training_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.training_enrollments;
  v_training public.trainings;
begin
  select * into v_row from public.training_enrollments where id = p_enrollment_id for update;
  if not found or not app.has_branch_permission('training.manage', app.employee_branch(v_row.employee_id)) then
    raise exception 'enrolment not found' using errcode = 'no_data_found';
  end if;
  if app.is_own_employee_record(v_row.employee_id) then
    raise exception 'someone else records your own result' using errcode = 'insufficient_privilege';
  end if;
  select * into v_training from public.trainings where id = v_row.training_id;
  if p_status not in ('completed', 'no_show') then
    raise exception 'record the training as completed or a no-show' using errcode = 'check_violation';
  end if;
  if v_training.starts_on > current_date then
    raise exception 'results are recorded once the training has started' using errcode = 'check_violation';
  end if;
  if v_row.status = 'withdrawn' then
    raise exception 'this person withdrew' using errcode = 'check_violation';
  end if;
  if p_status = 'completed' and v_training.pass_mark is not null and p_score is null then
    raise exception 'this training is scored; enter the score' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.training_enrollments
     set status = p_status,
         hours_attended = case when p_status = 'completed' then coalesce(p_hours, v_training.hours) else 0 end,
         score = case when p_status = 'completed' then p_score end,
         passed = case when p_status = 'completed' then (v_training.pass_mark is null or p_score >= v_training.pass_mark) end,
         completed_at = case when p_status = 'completed' then now() end
   where id = p_enrollment_id
   returning * into v_row;
  perform app.end_workflow();
  return v_row;
end;
$$;

create or replace function public.give_training_feedback(p_enrollment_id uuid, p_rating integer, p_comment text default null)
returns public.training_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.training_enrollments;
begin
  select * into v_row from public.training_enrollments where id = p_enrollment_id for update;
  if not found or not app.is_own_employee_record(v_row.employee_id) then
    raise exception 'enrolment not found' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'completed' then
    raise exception 'feedback is given once you have completed the training' using errcode = 'check_violation';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'rate the training from 1 to 5' using errcode = 'check_violation';
  end if;
  perform app.begin_workflow();
  update public.training_enrollments set feedback_rating = p_rating, feedback_comment = nullif(trim(p_comment), '')
   where id = p_enrollment_id returning * into v_row;
  perform app.end_workflow();
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit and row level security
-- ---------------------------------------------------------------------------

select app.enable_audit('public.performance_reviews');
select app.enable_audit('public.performance_review_scores');
select app.enable_audit('public.employee_goals');
select app.enable_audit('public.trainings');
select app.enable_audit('public.training_enrollments');

alter table public.performance_reviews enable row level security;
alter table public.performance_review_scores enable row level security;
alter table public.employee_goals enable row level security;
alter table public.trainings enable row level security;
alter table public.training_enrollments enable row level security;

create or replace function app.can_see_review(p_review_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.performance_reviews r
    where r.id = p_review_id
      and (
        r.reviewer_id = auth.uid()
        or app.has_branch_permission('performance.read', app.employee_branch(r.employee_id))
        or (r.status <> 'draft' and app.is_own_employee_record(r.employee_id))
      )
  );
$$;
revoke all on function app.can_see_review(uuid) from public, anon;
grant execute on function app.can_see_review(uuid) to authenticated;

-- Written against the row itself, not app.can_see_review(id): a review just inserted isn't visible to a lookup yet.
create policy "reviewers, HR and the employee see reviews" on public.performance_reviews for select to authenticated
  using (
    reviewer_id = auth.uid()
    or app.has_branch_permission('performance.read', app.employee_branch(employee_id))
    or (status <> 'draft' and app.is_own_employee_record(employee_id))
  );
create policy "reviewers start reviews" on public.performance_reviews for insert to authenticated
  with check (app.has_branch_permission('performance.review', app.employee_branch(employee_id)));
create policy "reviewers edit their drafts" on public.performance_reviews for update to authenticated
  using (reviewer_id = auth.uid() and status = 'draft') with check (reviewer_id = auth.uid());
create policy "reviewers discard their drafts" on public.performance_reviews for delete to authenticated
  using (reviewer_id = auth.uid() and status = 'draft');

create policy "people who see the review see its scores" on public.performance_review_scores for select to authenticated
  using (app.can_see_review(review_id));
create policy "reviewers score their drafts" on public.performance_review_scores for insert to authenticated
  with check (exists (select 1 from public.performance_reviews r where r.id = review_id and r.reviewer_id = auth.uid()));
create policy "reviewers rescore their drafts" on public.performance_review_scores for update to authenticated
  using (exists (select 1 from public.performance_reviews r where r.id = review_id and r.reviewer_id = auth.uid()));
create policy "reviewers remove scores from their drafts" on public.performance_review_scores for delete to authenticated
  using (exists (select 1 from public.performance_reviews r where r.id = review_id and r.reviewer_id = auth.uid()));

create policy "reviewers, HR and the employee see goals" on public.employee_goals for select to authenticated
  using (app.has_branch_permission('performance.read', app.employee_branch(employee_id)) or app.is_own_employee_record(employee_id)
         or set_by = auth.uid());
create policy "reviewers set goals" on public.employee_goals for insert to authenticated
  with check (app.has_branch_permission('performance.review', app.employee_branch(employee_id)));
create policy "reviewers change goals" on public.employee_goals for update to authenticated
  using (app.has_branch_permission('performance.review', app.employee_branch(employee_id)))
  with check (app.has_branch_permission('performance.review', app.employee_branch(employee_id)));

create policy "staff see trainings" on public.trainings for select to authenticated using (true);
create policy "training managers schedule trainings" on public.trainings for insert to authenticated
  with check (app.has_permission('training.manage'));
create policy "training managers change trainings" on public.trainings for update to authenticated
  using (app.has_permission('training.manage')) with check (app.has_permission('training.manage'));

create policy "HR and the employee see enrolments" on public.training_enrollments for select to authenticated
  using (app.has_branch_permission('training.manage', app.employee_branch(employee_id))
         or app.has_branch_permission('hr.read', app.employee_branch(employee_id))
         or app.is_own_employee_record(employee_id));

-- Department and branch heads review staff without reading HR files (hr.read). This gives them names and where
-- people work, for the branches they review or read reviews for, and nothing else from the record.
create or replace function public.performance_people()
returns table (
  id uuid, full_name text, employee_no text, branch_id uuid, department_code text, status public.employee_status,
  is_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.first_name || ' ' || e.last_name, e.employee_no, e.branch_id, e.department_code, e.status,
         e.staff_id is not distinct from auth.uid()
  from public.employees e
  where app.has_branch_permission('performance.read', e.branch_id)
     or app.has_branch_permission('performance.review', e.branch_id)
  order by e.first_name, e.last_name;
$$;

-- Places taken on each training (everyone not withdrawn), so staff can see whether there is room without seeing
-- who else enrolled.
create or replace function public.training_seats_taken(p_training_ids uuid[])
returns table (training_id uuid, taken integer)
language sql
stable
security definer
set search_path = ''
as $$
  select en.training_id, count(*)::integer
  from public.training_enrollments en
  where en.training_id = any (p_training_ids) and en.status <> 'withdrawn'
    and exists (select 1 from public.staff me where me.id = auth.uid() and me.is_active)
  group by en.training_id;
$$;

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------

revoke all on function public.performance_people() from public, anon;
revoke all on function public.training_seats_taken(uuid[]) from public, anon;
grant execute on function public.performance_people() to authenticated;
grant execute on function public.training_seats_taken(uuid[]) to authenticated;

revoke all on function public.submit_performance_review(uuid) from public, anon;
revoke all on function public.acknowledge_performance_review(uuid, text) from public, anon;
revoke all on function public.update_goal_progress(uuid, integer, text) from public, anon;
revoke all on function public.enrol_in_training(uuid, uuid) from public, anon;
revoke all on function public.withdraw_from_training(uuid) from public, anon;
revoke all on function public.record_training_result(uuid, text, numeric, numeric) from public, anon;
revoke all on function public.give_training_feedback(uuid, integer, text) from public, anon;

grant execute on function public.submit_performance_review(uuid) to authenticated;
grant execute on function public.acknowledge_performance_review(uuid, text) to authenticated;
grant execute on function public.update_goal_progress(uuid, integer, text) to authenticated;
grant execute on function public.enrol_in_training(uuid, uuid) to authenticated;
grant execute on function public.withdraw_from_training(uuid) to authenticated;
grant execute on function public.record_training_result(uuid, text, numeric, numeric) to authenticated;
grant execute on function public.give_training_feedback(uuid, integer, text) to authenticated;

-- EventSpark schema
-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query)

create extension if not exists "pgcrypto";

-- 1. Profiles ---------------------------------------------------------
-- One row per authenticated user. Created automatically on signup.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  sparks int not null default 0,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "Profiles are viewable by everyone"
  on profiles for select
  using (true);

create policy "Users can update their own profile"
  on profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row whenever someone signs up
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- 2. Events -------------------------------------------------------------
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  event_date date not null,
  event_time time not null,
  location text default '',
  capacity int not null default 10,
  initiator_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table events enable row level security;

create policy "Events are viewable by everyone"
  on events for select
  using (true);

create policy "Authenticated users can create events"
  on events for insert
  with check (auth.uid() = initiator_id);

create policy "Hosts can update or delete their own events"
  on events for update using (auth.uid() = initiator_id);

create policy "Hosts can delete their own events"
  on events for delete using (auth.uid() = initiator_id);

-- 3. Participants ---------------------------------------------------------
create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (event_id, user_id)
);

alter table participants enable row level security;

create policy "Participants are viewable by everyone"
  on participants for select
  using (true);

create policy "Users can join events as themselves"
  on participants for insert
  with check (auth.uid() = user_id);

create policy "Users can leave events they joined"
  on participants for delete
  using (auth.uid() = user_id);

-- 4. Reward log -------------------------------------------------------------
-- Server-authoritative record of every spark payout. Never written to
-- directly by the client -- only by the trigger functions below, so
-- rewards can't be spoofed from the frontend.
create table if not exists reward_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  event_id uuid references events(id) on delete set null,
  amount int not null,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table reward_log enable row level security;

create policy "Users can view their own reward log"
  on reward_log for select
  using (auth.uid() = user_id);

-- 5. Reward triggers -------------------------------------------------------------

-- 10 sparks to the host the moment they create an event
create or replace function reward_event_creation()
returns trigger as $$
begin
  update profiles set sparks = sparks + 10 where id = new.initiator_id;
  insert into reward_log (user_id, event_id, amount, reason)
  values (new.initiator_id, new.id, 10, 'Started "' || new.title || '"');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_event_created on events;
create trigger on_event_created
  after insert on events
  for each row execute function reward_event_creation();

-- 15 sparks to the host each time attendance crosses 3, 6, or 10 joined
create or replace function reward_attendance_tier()
returns trigger as $$
declare
  host_id uuid;
  event_title text;
  attendee_count int;
begin
  select initiator_id, title into host_id, event_title
  from events where id = new.event_id;

  select count(*) into attendee_count
  from participants where event_id = new.event_id;

  if attendee_count in (3, 6, 10) and host_id != new.user_id then
    update profiles set sparks = sparks + 15 where id = host_id;
    insert into reward_log (user_id, event_id, amount, reason)
    values (host_id, new.event_id, 15, '"' || event_title || '" reached ' || attendee_count || ' joined');
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_participant_joined on participants;
create trigger on_participant_joined
  after insert on participants
  for each row execute function reward_attendance_tier();

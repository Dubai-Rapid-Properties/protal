-- ============================================================================
-- D|R|P PMS - 0050 Owner sign-in links the portal issues itself
--
-- An owner's sign-in link carried Supabase's own one-time token: spent the
-- first time it was used, and refused again whenever it was opened a second
-- time (another browser, a phone after the laptop, WhatsApp's own browser
-- and then Safari) - owners met "This link has expired" well within the 24
-- hours it promised.
--
-- The link now carries a token of the portal's own. Opening it (Continue)
-- makes a fresh Supabase sign-in on the spot, so it works again and again
-- until it expires or the owner has chosen a password; a newer link for the
-- same owner replaces it. Only the token's SHA-256 is kept.
-- ============================================================================

create table if not exists owner_invites (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique,
  profile_id  uuid not null references profiles(id) on delete cascade,
  email       text not null,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create index if not exists owner_invites_profile_idx on owner_invites (profile_id);

comment on table owner_invites is
  'Owner sign-in links (SHA-256 of the token). Written and read by the portal server only.';

-- No policies: only the service role (the portal server) reads or writes it.
alter table owner_invites enable row level security;

-- ============================================================================
-- D|R|P PMS - 0064 News on the D|R|P website
--
-- The articles the team picks for /news on the D|R|P website ("Stay Ahead of
-- the Market"), added under Website -> News: a story from any publication
-- (Arabian Business, Lovin Dubai, DXB Interact, Forbes, ...), shown as its
-- headline, a short summary and a link to the publisher's site. The website
-- reads them from /api/public/news when it builds, next to the UAE property
-- stories it takes from publishers' public feeds itself.
--
-- Staff read the list; super admins, property managers, agents and marketing
-- add and remove articles (pms.can_edit_listings, 0028).
-- ============================================================================

create table website_news (
  id           uuid primary key default gen_random_uuid(),
  url          text not null unique check (url ~ '^https://' and length(url) <= 1000),
  title        text not null check (length(trim(title)) between 5 and 300),
  -- The publication, e.g. "Arabian Business"
  source       text not null check (length(trim(source)) between 2 and 80),
  summary      text check (summary is null or length(summary) <= 600),
  image_url    text check (image_url is null or (image_url ~ '^https://' and length(image_url) <= 1000)),
  published_on date not null default ((now() at time zone 'Asia/Dubai')::date),
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index website_news_date_idx on website_news(published_on desc, created_at desc);

comment on table website_news is
  'Articles picked for /news on the D|R|P website, added under Website -> News and read by /api/public/news.';

alter table website_news enable row level security;

create policy website_news_read on website_news
  for select to authenticated using (pms.is_staff());

create policy website_news_insert on website_news
  for insert to authenticated with check (pms.can_edit_listings());

create policy website_news_delete on website_news
  for delete to authenticated using (pms.can_edit_listings());

grant select, insert, delete on website_news to authenticated;
grant all on website_news to service_role;

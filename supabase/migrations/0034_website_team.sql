-- ============================================================================
-- D|R|P PMS - 0034 The team on the D|R|P website
--
-- The people on the website's About page and on its listings (photo, role,
-- RERA BRN, phone, WhatsApp, email), edited under Website -> Team. The
-- website reads them from /api/public/team when it builds.
--
--   * A listing names its agent in website_listings.agent; the website finds
--     the team member by name or by one of agent_names (the spellings used on
--     Property Finder, e.g. "Adithya Mitter").
--   * phone / whatsapp / email are what the website's buttons use. Leave one
--     empty and that button is not shown (the listing card falls back to
--     the DRP office numbers).
--   * show_on_about: on the About page and with a profile page. Off: still
--     shown as the agent on their listings.
--   * Photos: the public listing-photos bucket, or a path on the website
--     (the members imported below keep their current portraits).
--
-- Staff read the team; super admins, property managers, agents and
-- marketing edit it (pms.can_edit_listings, 0028).
-- ============================================================================

create table website_team (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique
                  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  name          text not null check (length(trim(name)) between 2 and 120),
  role          text not null default '',
  -- One line under the role on the About page
  summary       text,
  -- Paragraphs separated by a blank line
  bio           text not null default '',
  photo_url     text,
  brn           text,
  phone         text,
  whatsapp      text,
  email         text,
  agent_names   text[] not null default '{}',
  show_on_about boolean not null default true,
  sort_order    integer not null default 100,
  is_active     boolean not null default true,
  created_by    uuid references profiles(id) on delete set null,
  updated_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index website_team_order_idx on website_team(sort_order, name);

create trigger website_team_touch before update on website_team
  for each row execute function pms.touch_updated_at();

comment on table website_team is
  'The team on the D|R|P website (About page, listing agents), edited under Website -> Team and read by /api/public/team.';

alter table website_team enable row level security;

create policy website_team_read on website_team
  for select to authenticated using (pms.is_staff());

create policy website_team_insert on website_team
  for insert to authenticated with check (pms.can_edit_listings());

create policy website_team_update on website_team
  for update to authenticated
  using (pms.can_edit_listings()) with check (pms.can_edit_listings());

create policy website_team_delete on website_team
  for delete to authenticated using (pms.can_edit_listings());

grant select, insert, update, delete on website_team to authenticated;
grant all on website_team to service_role;

-- ---------------------------------------------------------------------------
-- Today's team, as the website shows it now
-- ---------------------------------------------------------------------------
insert into website_team (slug, name, role, summary, bio, photo_url, brn, whatsapp, email, agent_names, sort_order)
values
  ($q$jasko-miletic$q$, $q$Jasko Miletic$q$, $q$Founder & CEO$q$, $q$Active in Dubai's real estate market since 2007.$q$, $q$Jasko Miletic is the founder of Dubai Rapid Properties and has been active in Dubai’s real estate market since 2007.

With nearly two decades of hands-on experience, Mr. Jasko has built his reputation on market knowledge, direct relationships, transparency and a highly personal approach to every transaction. Over the years, he has worked with private investors, property owners and international clients across Dubai, with particular expertise in luxury residential properties, investment opportunities, sales, leasing and property management.

Under his leadership, Dubai Rapid Properties has evolved beyond traditional brokerage into a fully integrated real estate platform, offering clients a complete range of services – from property acquisition and sales to holiday home management, furnishing, maintenance and ongoing property management.

Jasko believes that real estate is ultimately a relationship business. His philosophy remains simple: understand the client’s goals, provide straightforward advice and stay personally involved until the desired result is achieved.

Dubai Rapid Properties – Since 2007.$q$, $q$/media/2023/02/Mr-Jasko-12345-scaled.jpg$q$, null, null, $q$Office@dubairapidproperties.com$q$, '{}'::text[], 10),
  ($q$tara-topic$q$, $q$Tara Topic$q$, $q$Managing Director$q$, $q$Guiding buyers and sellers through every step, with a keen eye for detail.$q$, $q$Hi, I’m Tara and I’m passionate about turning your real estate dreams into reality! With a deep understanding of the local market and a keen eye for detail, I’m dedicated to providing exceptional service and making your buying or selling experience smooth and successful. Whether you’re looking for your perfect home or aiming to sell, I’m here to guide you every step of the way with confidence and enthusiasm. Let’s make your real estate journey an exciting adventure together!$q$, $q$/media/2024/02/Ms-Tara_-scaled.webp$q$, $q$77282$q$, $q$+971 56 777 0272$q$, $q$Office@dubairapidproperties.com$q$, '{}'::text[], 20),
  ($q$adithya-micheal$q$, $q$Adithya Micheal$q$, $q$Luxury Property Consultant$q$, $q$Matching buyers and investors to the right opportunities across Dubai's key communities.$q$, $q$I specialise in helping buyers and investors find the right opportunities across Dubai’s key communities. From understanding current market values to spotting the properties worth a closer look, my focus is on giving clients the full picture so they can make decisions with confidence. Every client’s goal is different, and my job is to match the property to the person.$q$, $q$/media/2026/09/Untitled-1123214.webp$q$, $q$95049$q$, $q$+971 56 777 0272$q$, null, array[$q$Adithya Mitter$q$,$q$Adithya Micheal Mitter$q$]::text[], 30),
  ($q$neel-mehra$q$, $q$Neel Mehra$q$, $q$Luxury Property Consultant$q$, $q$Investments matched to each client's lifestyle and financial goals.$q$, $q$As a trusted advisor at D|R|P, I focus on matching clients with investments that align with both their lifestyle and financial goals. I believe in going the extra mile — whether it’s finding rare deals, providing detailed insights, or negotiating the best terms. For me, success is when my clients succeed.$q$, $q$/media/2025/09/Mr-Neel-3-scaled.jpeg$q$, null, $q$+971 56 777 0272$q$, null, '{}'::text[], 40),
  ($q$dulshan-imantha$q$, $q$Dulshan Imantha$q$, $q$Marketing Manager$q$, $q$Telling each property's story to the buyers and investors it suits.$q$, $q$At D|R|P, my job is to make sure the right people see the right properties at the right time. With a background in design and technology, I bring creative ideas and data together to build campaigns that actually bring results. For me, great marketing isn’t about noise. It’s about telling each property’s story in a way that connects with buyers and investors.$q$, $q$/media/2026/10/4CA7F18E-F8AC-442A-BAF9-9058E1273397-scaled.jpg$q$, null, null, $q$Office@dubairapidproperties.com$q$, '{}'::text[], 50),
  ($q$anne-aristan$q$, $q$Anne Aristan$q$, $q$Office Administrator$q$, $q$Keeping the office, agents and clients running smoothly.$q$, $q$Ann is a driven and resourceful Office Administrator and Executive Assistant with extensive experience in the real estate industry. She specializes in executive support, office administration, real estate coordination, client relations, and day-to-day business operations.

Highly organized and detail-oriented, Ann excels in managing high-volume workloads, coordinating with agents and clients, and ensuring smooth and efficient office operations. She brings strong communication, customer service, HR, and problem-solving skills, with a professional and hands-on approach to every task.$q$, $q$/media/2024/05/FB7B396E-4E87-4B36-B8D4-3DD5C0DF5688-scaled.jpg$q$, null, null, $q$Office@dubairapidproperties.com$q$, '{}'::text[], 60),
  ($q$delia-cuadrante$q$, $q$Delia Cuadrante$q$, $q$Office Assistant$q$, null, $q$$q$, $q$/media/2024/07/6F4D5867-B65A-4DF7-996A-9B6C780C0AF3-scaled.jpg$q$, null, null, null, '{}'::text[], 70)
on conflict (slug) do nothing;

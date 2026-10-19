-- 0009_seed.sql — institutions, departments, categories, officers, demo auth users + complaints (seeded through the real intake RPC)
-- DEMO/DEV ONLY: never run against a production database — demo account passwords are public in this repo (live copies rotated and banned 2026-10-19).
insert into public.institutions (code, name, type, is_dashboard, public_visible, contact) values

  ('KMC', 'Kanifing Municipal Council', 'municipal', True, True, '{"phone": "+2204390001", "email": "info@kmc.gm", "aliases": ["kanifing", "kmc", "serekunda"], "bbox": [13.48, -16.76, 13.56, -16.62]}'::jsonb),
  ('BCC', 'Banjul City Council', 'municipal', False, True, '{"phone": "+2204220001", "email": "info@bcc.gm", "aliases": ["banjul", "bcc"], "bbox": [13.43, -16.6, 13.48, -16.54]}'::jsonb),
  ('BAC', 'Brikama Area Council', 'municipal', False, True, '{"phone": "+2204390002", "email": "info@bac.gm", "aliases": ["brikama", "bac", "west coast"], "bbox": [13.18, -16.85, 13.42, -16.6]}'::jsonb),
  ('NAWEC', 'National Water and Electricity Company', 'utility', True, True, '{"phone": "+2204371000", "email": "info@nawec.gm"}'::jsonb),
  ('NRA', 'National Roads Authority', 'agency', True, True, '{"phone": "+2204460001", "email": "info@nra.gm"}'::jsonb),
  ('NEA', 'National Environment Agency', 'agency', True, True, '{"phone": "+2204490001", "email": "info@nea.gm"}'::jsonb),
  ('POLICE', 'Gambia Police Force', 'security', False, False, '{"phone": "117", "email": "police@gamciv.gm"}'::jsonb),
  ('FIRE', 'Gambia Fire and Rescue Services', 'security', False, False, '{"phone": "118", "email": "fire@gamciv.gm"}'::jsonb),
  ('OMBUDSMAN', 'Office of the Ombudsman', 'agency', False, False, '{"phone": "+2204225000", "email": "info@ombudsman.gm"}'::jsonb),
  ('CENTRAL', 'GamCiv Central Desk', 'central', True, False, '{"phone": "+2201000000", "email": "central@gamciv.gm"}'::jsonb)
;

insert into public.departments (institution_id, name)
select i.id, d.dept_name
from (values

    ('KMC', 'Sanitation'),
    ('KMC', 'Waste Collection'),
    ('KMC', 'Roads & Drains'),
    ('KMC', 'Markets'),
    ('BCC', 'Sanitation'),
    ('BCC', 'Roads & Drains'),
    ('BAC', 'Sanitation'),
    ('BAC', 'Roads & Water'),
    ('NAWEC', 'Water Operations'),
    ('NAWEC', 'Electrical Operations'),
    ('NAWEC', 'Sewerage'),
    ('NRA', 'Engineering Inspection'),
    ('NRA', 'Road Maintenance'),
    ('NEA', 'Inspections & Enforcement'),
    ('CENTRAL', 'Triage')
) as d(inst_code, dept_name)
join public.institutions i on i.code = d.inst_code;

insert into public.categories
  (name, slug, keywords, default_institution_id, default_department_id, is_sensitive, is_emergency, deadline_hours)
select
  v.name, v.slug, v.keywords,
  di.id, dd.id,
  v.sensitive, v.emergency, v.deadline
from (values

    ('Waste Collection', 'waste_collection', array['garbage','trash','waste','rubbish','bin','refuse']::text[], 'KMC', 'Waste Collection', False, False, 72),
    ('Illegal Dumping', 'illegal_dumping', array['illegal dumping','dumping','waste site']::text[], 'NEA', 'Inspections & Enforcement', False, False, 96),
    ('Water Supply', 'water_supply', array['water','tap','pipe','leak','borehole']::text[], 'NAWEC', 'Water Operations', False, False, 48),
    ('Electricity', 'electricity', array['electricity','power','outage','transformer','cable']::text[], 'NAWEC', 'Electrical Operations', False, False, 48),
    ('Sewerage', 'sewerage', array['sewage','sewer','manhole','wastewater']::text[], 'NAWEC', 'Sewerage', False, False, 72),
    ('Local Roads', 'local_roads', array['pothole','road','street','drain','gutter']::text[], 'KMC', 'Roads & Drains', False, False, 168),
    ('Street Lighting', 'streetlight', array['street light','lamp','dark street','bulb']::text[], 'KMC', 'Roads & Drains', False, False, 96),
    ('Markets', 'markets', array['market','stall','vendor','serrekunda market']::text[], 'KMC', 'Markets', False, False, 96),
    ('National Roads', 'national_roads', array['highway','bridge','culvert','expressway']::text[], 'NRA', 'Engineering Inspection', False, False, 96),
    ('Traffic Signs', 'traffic_signs', array['traffic sign','road sign','traffic light','markings']::text[], 'NRA', 'Road Maintenance', False, False, 96),
    ('Pollution', 'pollution', array['pollution','smoke','smell','odor','fumes','contamination']::text[], 'NEA', 'Inspections & Enforcement', False, False, 96),
    ('Public Health', 'public_health', array['clinic','health post','mosquito','sanitation risk']::text[], 'NEA', 'Inspections & Enforcement', False, False, 96),
    ('Education', 'education', array['school','classroom','teacher','school furniture']::text[], null, null, False, False, 168),
    ('Crime Report', 'crime_report', array['theft','burglary','crime','assault']::text[], 'POLICE', null, True, False, 24),
    ('Police Misconduct', 'police_misconduct', array['police misconduct','brutality','harassment by police']::text[], 'POLICE', null, True, False, 24),
    ('Corruption Report', 'corruption_report', array['bribe','bribery','corruption','extortion']::text[], 'OMBUDSMAN', null, True, False, 24),
    ('Abuse of Power', 'abuse_of_power', array['abuse of power','maladministration','misuse of office']::text[], 'OMBUDSMAN', null, True, False, 24),
    ('Fire Emergency', 'emergency_fire', array['fire','smoke','burning','ablaze']::text[], 'FIRE', null, True, True, 24),
    ('Police Emergency', 'emergency_police', array['gunshot','shooting','robbery','drowning','stabbing']::text[], 'POLICE', null, True, True, 24),
    ('Other', 'other', array[]::text[], null, null, False, False, 72)
) as v(name, slug, keywords, inst_code, dept_name, sensitive, emergency, deadline)
left join public.institutions di on di.code = v.inst_code
left join public.departments dd on dd.name = v.dept_name and dd.institution_id = di.id;

insert into public.officers (institution_id, department_id, name, phone, email)
select i.id, d.id, v.name, v.phone, v.email
from (values

    ('KMC', 'Sanitation', 'Fatou Ceesay', '+2207770001', 'fatou.ceesay@kmc.gm'),
    ('KMC', 'Roads & Drains', 'Lamin Jobe', '+2207770002', 'lamin.jobe@kmc.gm'),
    ('NAWEC', 'Water Operations', 'Musa Darboe', '+2207770003', 'musa.darboe@nawec.gm'),
    ('NAWEC', 'Electrical Operations', 'Awa Sarr', '+2207770004', 'awa.sarr@nawec.gm'),
    ('NRA', 'Engineering Inspection', 'Ousman Kolley', '+2207770005', 'ousman.kolley@nra.gm'),
    ('NEA', 'Inspections & Enforcement', 'Isatou Njie', '+2207770006', 'isatou.njie@nea.gm'),
    ('CENTRAL', 'Triage', 'Modou Faye', '+2207770007', 'modou.faye@central.gamciv.gm'),
    ('CENTRAL', 'Triage', 'Aja Manga', '+2207770008', 'aja.manga@central.gamciv.gm')
) as v(inst_code, dept_name, name, phone, email)
join public.institutions i on i.code = v.inst_code
left join public.departments d on d.institution_id = i.id and d.name = v.dept_name;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
select
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  v.email,
  crypt('DemoPass123!', gen_salt('bf', 10)),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"' || v.full_name || '"}'::jsonb
from (values
  ('admin@gamciv.gm',                'Central Admin'),
  ('fatou.ceesay@kmc.gm',            'Fatou Ceesay'),
  ('lamin.jobe@kmc.gm',              'Lamin Jobe'),
  ('musa.darboe@nawec.gm',           'Musa Darboe'),
  ('awa.sarr@nawec.gm',              'Awa Sarr'),
  ('ousman.kolley@nra.gm',           'Ousman Kolley'),
  ('isatou.njie@nea.gm',             'Isatou Njie'),
  ('modou.faye@central.gamciv.gm',   'Modou Faye'),
  ('aja.manga@central.gamciv.gm',    'Aja Manga'),
  ('citizen1@example.com',           'Demo Citizen'),
  ('citizen2@example.com',           'Second Citizen')
) as v(email, full_name)
where not exists (select 1 from auth.users au where au.email = v.email);

insert into public.profiles (user_id, email, role, full_name)
select u.id, u.email,
  case
    when u.email = 'admin@gamciv.gm' then 'admin'::public.user_role
    when u.email like '%@example.com' then 'citizen'::public.user_role
    else 'officer'::public.user_role
  end,
  coalesce(u.raw_user_meta_data->>'full_name', u.email)
from auth.users u
where u.email in (
  'admin@gamciv.gm',
  'fatou.ceesay@kmc.gm', 'lamin.jobe@kmc.gm',
  'musa.darboe@nawec.gm', 'awa.sarr@nawec.gm',
  'ousman.kolley@nra.gm', 'isatou.njie@nea.gm',
  'modou.faye@central.gamciv.gm', 'aja.manga@central.gamciv.gm',
  'citizen1@example.com', 'citizen2@example.com'
)
on conflict (user_id) do nothing;

update public.officers o
set user_id = u.id
from auth.users u
where lower(u.email) = lower(o.email)
  and o.user_id is null;

-- Supabase expects one identity per user/provider
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
from auth.users u
where u.email in (
  'admin@gamciv.gm',
  'fatou.ceesay@kmc.gm', 'lamin.jobe@kmc.gm',
  'musa.darboe@nawec.gm', 'awa.sarr@nawec.gm',
  'ousman.kolley@nra.gm', 'isatou.njie@nea.gm',
  'modou.faye@central.gamciv.gm', 'aja.manga@central.gamciv.gm',
  'citizen1@example.com', 'citizen2@example.com'
)
and not exists (
  select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
);

create temp table _demo_batch (
  title text, description text, cat uuid, conf numeric,
  urgency public.urgency_level, lat numeric, lng numeric,
  region text, council text, ward text, channel public.report_channel,
  cname text, cphone text, anon bool
);

insert into _demo_batch
select v.title, v.description, c.id, v.conf, v.urgency::public.urgency_level,
       v.lat, v.lng, v.region, v.council, v.ward,
       v.channel::public.report_channel, v.cname, v.cphone, v.anon
from (values

  ('Water outage in Brikama', 'No water since morning in Brikama New Town. Entire street affected.', 'water_supply', '0.95', 'high', '13.285', '-16.65', 'West Coast Region', 'brikama', 'Brikama New Town', 'whatsapp', 'Fatmata Sowe', '+2203110001', False),
  ('Second water report - Brikama', 'Still no water in Brikama area, taps dry since morning.', 'water_supply', '0.93', 'high', '13.29', '-16.648', 'West Coast Region', 'brikama', 'Brikama New Town', 'web', 'Alhaji Njie', '+2203110002', False),
  ('Third report near Brikama outage', 'Water problem near Brikama Craft Market, same outage area.', 'water_supply', '0.94', 'high', '13.3', '-16.65', 'West Coast Region', 'brikama', 'Brikama New Town', 'sms', 'Bakary Jammeh', '+2203110003', False),
  ('Overflowing dumpster at Serekunda Market', 'Large garbage pile overflowing at the market entrance, attracting flies and blocking the walkway.', 'waste_collection', '0.92', 'high', '13.53', '-16.68', 'Greater Banjul', 'kanifing', 'Serekunda', 'whatsapp', 'Aminata Touray', '+2203110004', False),
  ('Trash not collected in Fajara', 'Household waste not collected for two weeks on Fajara main street.', 'waste_collection', '0.88', 'normal', '13.49', '-16.69', 'Greater Banjul', 'kanifing', 'Fajara', 'web', null, null, True),
  ('Illegal dumpsite near school', 'Someone dumped construction waste behind the school wall.', 'illegal_dumping', '0.9', 'high', '13.51', '-16.67', 'Greater Banjul', 'kanifing', 'London Corner', 'web', 'Ebrima Colley', '+2203110005', False),
  ('Sewage smell near Kotu', 'Strong sewage smell near Kotu bridge, suspected broken manhole.', 'sewerage', '0.86', 'high', '13.46', '-16.68', 'Greater Banjul', 'kanifing', 'Kotu', 'whatsapp', 'Yankuba Sonko', '+2203110006', False),
  ('Potholes on Bertil Harding Highway', 'Deep potholes near the traffic lights, dangerous for motorbikes.', 'local_roads', '0.91', 'normal', '13.47', '-16.69', 'Greater Banjul', 'kanifing', 'Kotu', 'web', 'Mariama Sarr', '+2203110007', False),
  ('Street light out in Bakau', 'Street lights dead along Bakau New Town road for a week.', 'streetlight', '0.87', 'low', '13.48', '-16.69', 'Greater Banjul', 'kanifing', 'Bakau', 'sms', null, null, True),
  ('Market stall dispute', 'Vendors blocked from their stalls at Serrekunda market by some men.', 'markets', '0.78', 'normal', '13.53', '-16.68', 'Greater Banjul', 'kanifing', 'Serekunda', 'web', 'Ndey Isatou Jallow', '+2203110008', False),
  ('Water leak at Westfield', 'Pipe leaking at Westfield junction, wasting water all day.', 'water_supply', '0.93', 'normal', '13.52', '-16.68', 'Greater Banjul', 'kanifing', 'Westfield', 'app', 'Sulayman Bojang', '+2203110009', False),
  ('Power outage in Banjul', 'Whole neighborhood dark since evening, transformer hums then cuts.', 'electricity', '0.94', 'high', '13.452', '-16.57', 'Banjul', 'banjul', 'Banjul Central', 'whatsapp', 'Pa Malick Faye', '+2203110010', False),
  ('Damaged cable in Brikama', 'Hanging electric cable over the road in Brikama, children play under it.', 'electricity', '0.9', 'critical', '13.28', '-16.66', 'West Coast Region', 'brikama', 'Brikama Central', 'whatsapp', 'Ousman Sanneh', '+2203110011', False),
  ('Frequent power cuts in Sukuta', 'Power cuts 4x a day in Sukuta for a week.', 'electricity', '0.89', 'normal', '13.48', '-16.66', 'Greater Banjul', 'kanifing', 'Sukuta', 'web', 'Amie Colley', '+2203110012', False),
  ('Dark street in Banjul', 'Street lights off on Independence Drive for two weeks.', 'streetlight', '0.85', 'normal', '13.453', '-16.575', 'Banjul', 'banjul', 'Banjul Central', 'web', null, null, True),
  ('Bridge railing broken on Senegambia highway', 'Guard rail broken on the highway median, gap next to the ditch.', 'national_roads', '0.91', 'high', '13.48', '-16.64', 'Greater Banjul', 'kanifing', 'Senegambia', 'web', 'Kebba Ceesay', '+2203110013', False),
  ('Faded road markings on Bertil Harding', 'Center line invisible at night between Kotu and Senegambia.', 'traffic_signs', '0.88', 'normal', '13.465', '-16.688', 'Greater Banjul', 'kanifing', 'Kotu', 'web', 'Sainey Sagna', '+2203110014', False),
  ('Factory smoke over Kanifing', 'Factory emits thick smoke every morning near the industrial area.', 'pollution', '0.9', 'high', '13.54', '-16.67', 'Greater Banjul', 'kanifing', 'Kanifing South', 'whatsapp', 'Tumani Krubally', '+2203110015', False),
  ('Blocked drainage causing flooding', 'Drain blocked with sand and plastic, street floods when it rains.', 'local_roads', '0.84', 'high', '13.5', '-16.675', 'Greater Banjul', 'kanifing', 'Churchill', 'sms', 'Saffie Loum', '+2203110016', False),
  ('Mosquito breeding site', 'Stagnant water in abandoned pool, mosquitoes everywhere.', 'public_health', '0.82', 'normal', '13.495', '-16.67', 'Greater Banjul', 'kanifing', 'Fajara', 'web', 'Fatou Sosseh', '+2203110017', False),
  ('Garbage piling in Banjul South', 'Trash heaps in the alleys of Banjul South, smell is terrible.', 'waste_collection', '0.91', 'normal', '13.446', '-16.57', 'Banjul', 'banjul', 'Banjul South', 'whatsapp', 'Dembo Camara', '+2203110018', False),
  ('No garbage collection in Sukuta', 'Garbage truck hasn''t come to Sukuta in three weeks.', 'waste_collection', '0.87', 'normal', '13.485', '-16.665', 'Greater Banjul', 'kanifing', 'Sukuta', 'web', 'Jainaba Sissoko', '+2203110019', False),
  ('Water problem in Gunjur', 'Borehole pump broken, village fetches water far away.', 'water_supply', '0.83', 'high', '13.27', '-16.83', 'West Coast Region', 'brikama', 'Gunjur', 'sms', 'Momodou Sabally', '+2203110020', False),
  ('Something strange at the dzow', 'There is a strange smell and noise near the dzow area, unsure what it is.', 'other', '0.42', 'normal', null, null, null, null, null, 'web', 'Sheriff Dukuray', '+2203110021', False),
  ('Need help with an issue', 'I need help with a problem in my area, not sure who handles it.', 'other', '0.55', 'normal', null, null, null, null, null, 'web', null, null, True),
  ('Officer demanded money at checkpoint', 'A police officer demanded money at the Westfield checkpoint.', 'police_misconduct', '0.88', 'high', null, null, null, null, null, 'web', 'anonymous citizen', '+2203110022', True),
  ('Bribe requested for permit', 'Council staff asked for a bribe to approve my building permit.', 'corruption_report', '0.9', 'high', null, null, null, null, null, 'whatsapp', 'anonymous citizen', '+2203110023', True),
  ('Council worker misused office', 'Officer misused his office to grab land in Kanifing.', 'abuse_of_power', '0.86', 'normal', null, null, null, null, null, 'web', 'anonymous citizen', '+2203110024', True),
  ('Theft at the shop', 'Shop was broken into last night, goods stolen.', 'crime_report', '0.89', 'high', '13.52', '-16.68', 'Greater Banjul', 'kanifing', 'Westfield', 'web', 'Baboucarr Njie', '+2203110025', True),
  ('Harassment report', 'Gang of men harass people near the fish market.', 'crime_report', '0.87', 'high', '13.44', '-16.57', 'Banjul', 'banjul', 'Banjul North', 'sms', 'anonymous citizen', '+2203110026', True),
  ('Market fire at Churchill', 'Fire broke out at Churchill market, smoke everywhere, shops burning.', 'waste_collection', '0.9', 'high', '13.5', '-16.675', 'Greater Banjul', 'kanifing', 'Churchill', 'whatsapp', 'Mustapha Sowe', '+2203110027', False),
  ('Burst pipe flooding the street', 'Pipe burst and water is flooding the whole street in Fajara.', 'water_supply', '0.92', 'high', '13.49', '-16.69', 'Greater Banjul', 'kanifing', 'Fajara', 'web', 'Ismailla Suwareh', '+2203110028', False),
  ('No water in Banjul North', 'Taps dry in Banjul North since yesterday.', 'water_supply', '0.93', 'normal', '13.444', '-16.565', 'Banjul', 'banjul', 'Banjul North', 'web', 'Chernor Jallow', '+2203110029', False),
  ('Broken street lamp in Bakau', 'Lamp post leaning and dark in Bakau New Town.', 'streetlight', '0.86', 'low', '13.4805', '-16.686', 'Greater Banjul', 'kanifing', 'Bakau', 'web', null, null, True),
  ('Pothole on Kairaba Avenue', 'Large pothole near the petrol station on Kairaba Avenue.', 'local_roads', '0.9', 'low', '13.51', '-16.68', 'Greater Banjul', 'kanifing', 'Kairaba', 'web', 'Omar Ceesay', '+2203110030', False),
  ('Rubbish bins overflowing at Kotu', 'Public bins overflowing near the Kotu roundabout.', 'waste_collection', '0.88', 'normal', '13.458', '-16.682', 'Greater Banjul', 'kanifing', 'Kotu', 'web', 'Ndamba Sanneh', '+2203110031', False),
  ('Manhole open near school', 'Manhole cover missing near the school, children pass daily.', 'sewerage', '0.85', 'critical', '13.505', '-16.673', 'Greater Banjul', 'kanifing', 'Kanifing North', 'app', 'Haddy Njie', '+2203110032', False),
  ('Classroom roof leaks', 'Classroom roof leaks every rain, books destroyed.', 'education', '0.8', 'high', '13.46', '-16.6', 'Banjul', 'banjul', 'Banjul Central', 'web', 'Seedy Gibba', '+2203110033', False),
  ('School furniture missing', 'School has no desks, children sit on the floor.', 'education', '0.77', 'normal', '13.28', '-16.67', 'West Coast Region', 'brikama', 'Brikama New Town', 'web', 'Kaddy Jallow', '+2203110044', False),
  ('Smoke smell in Bakau', 'Strange smoke smell in the evenings around Bakau craft market.', 'pollution', '0.79', 'normal', '13.481', '-16.685', 'Greater Banjul', 'kanifing', 'Bakau', 'web', null, null, True),
  ('Flooded street after rain', 'Street floods after every rain in Latrikunda, drains blocked.', 'local_roads', '0.83', 'normal', '13.49', '-16.66', 'Greater Banjul', 'kanifing', 'Latrikunda', 'web', 'Gibril Saidy', '+2203110035', False),
  ('Power transformer sparking', 'Transformer sparks and hums loudly at night in Tabokoto.', 'electricity', '0.88', 'high', '13.4', '-16.68', 'West Coast Region', 'brikama', 'Tabokoto', 'whatsapp', 'Malang Njie', '+2203110036', False),
  ('Waste site burning', 'Waste site on fire again at the dump near the highway.', 'illegal_dumping', '0.87', 'high', '13.495', '-16.665', 'Greater Banjul', 'kanifing', 'Latrikunda', 'web', 'Bass Amba Beyai', '+2203110037', True)
) as v(title, description, slug, conf, urgency, lat, lng, region, council, ward, channel, cname, cphone, anon)
join public.categories c on c.slug = v.slug;

select public.submit_complaint(
  b.title, b.description, b.cat, b.conf, b.urgency,
  b.lat, b.lng, b.region, b.council, b.ward,
  null, b.channel, b.cname, b.cphone, b.anon
)
from _demo_batch b;

drop table _demo_batch;

-- pushes demo cases through the real officer RPCs (via _demo_as_officer impersonation) so every state exists
create or replace function public._demo_as_officer(
  p_email text,
  p_action text,
  p_complaint uuid,
  p_arg1 text default null,
  p_arg2 uuid default null,
  p_arg3 text default null
) returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_ok boolean;
begin
  select id into v_user from auth.users where email = p_email;
  if v_user is null then
    return 'no user';
  end if;
  -- set request.jwt.claims so auth.uid() works inside the RPC
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);

  if p_action = 'accept' then
    v_ok := public.fn_officer_accept(p_complaint);
  elsif p_action = 'status' then
    v_ok := public.fn_officer_set_status(p_complaint, p_arg1, p_arg3);
  elsif p_action = 'note' then
    v_ok := public.fn_officer_note(p_complaint, p_arg3);
  elsif p_action = 'urgency' then
    v_ok := public.fn_officer_set_urgency(p_complaint, p_arg1);
  elsif p_action = 'reject' then
    v_ok := public.fn_officer_reject(p_complaint, p_arg3);
  else
    v_ok := false;
  end if;

  perform set_config('request.jwt.claims', '', true);
  if v_ok then return 'ok'; else return 'rejected'; end if;
end $$;

do $life$
declare
  r record;
  v_id uuid;
begin
  select c.id into v_id from public.complaints c
  join public.categories cat on cat.id = c.category_id
  where cat.slug = 'waste_collection' and c.title like 'Overflowing dumpster%'
  order by c.created_at limit 1;
  perform public._demo_as_officer('fatou.ceesay@kmc.gm', 'accept', v_id);
  perform public._demo_as_officer('fatou.ceesay@kmc.gm', 'status', v_id, 'in_progress');
  perform public._demo_as_officer('fatou.ceesay@kmc.gm', 'note', v_id, null, null, 'Sanitation crew dispatched for tomorrow 7am pickup.');
  perform public._demo_as_officer('fatou.ceesay@kmc.gm', 'status', v_id, 'citizen_confirmation', null, 'Dumpster emptied and area washed. Photo attached by crew.');

  for r in
    select c.id from public.complaints c
    join public.categories cat on cat.id = c.category_id
    join public.institutions i on i.id = c.institution_id
    where cat.slug = 'water_supply' and i.code = 'NAWEC'
      and c.title like 'Water outage in Brikama%'
  loop
    perform public._demo_as_officer('musa.darboe@nawec.gm', 'accept', r.id);
    perform public._demo_as_officer('musa.darboe@nawec.gm', 'status', r.id, 'in_progress');
  end loop;

  select c.id into v_id from public.complaints c
  join public.categories cat on cat.id = c.category_id
  where cat.slug = 'pollution' and c.title like 'Factory smoke%'
  order by c.created_at limit 1;
  perform public._demo_as_officer('isatou.njie@nea.gm', 'accept', v_id);
  update public.complaints
     set expected_response_at = now() - interval '2 hours'
   where id = v_id;

  select c.id into v_id from public.complaints c
  join public.categories cat on cat.id = c.category_id
  where cat.slug = 'local_roads' and c.title like 'Pothole on Kairaba%'
  order by c.created_at limit 1;
  perform public._demo_as_officer('lamin.jobe@kmc.gm', 'accept', v_id);
  perform public._demo_as_officer('lamin.jobe@kmc.gm', 'status', v_id, 'in_progress');
  perform public._demo_as_officer('lamin.jobe@kmc.gm', 'status', v_id, 'citizen_confirmation', null, 'Pothole filled with asphalt this morning.');
  update public.complaints
     set status = 'closed', closed_at = now()
   where id = v_id;
  update public.complaint_updates
     set citizen_message = 'Resolution confirmed by citizen. Thank you.'
   where complaint_id = v_id and citizen_message like 'Crew reports fixed%';

  select c.id into v_id from public.complaints c
  join public.categories cat on cat.id = c.category_id
  where cat.slug = 'water_supply' and c.title like 'Water leak at Westfield%'
  order by c.created_at limit 1;
  perform public._demo_as_officer('musa.darboe@nawec.gm', 'accept', v_id);
  perform public._demo_as_officer('musa.darboe@nawec.gm', 'status', v_id, 'citizen_confirmation', null, 'Pipe clamp replaced, leak stopped.');
  update public.complaints
     set resolved_at = now() - interval '80 hours'
   where id = v_id;

  select c.id into v_id from public.complaints c
  join public.categories cat on cat.id = c.category_id
  where cat.slug = 'markets' and c.title like 'Market stall dispute%'
  order by c.created_at limit 1;
  perform public._demo_as_officer('fatou.ceesay@kmc.gm', 'reject', v_id, null, null, 'This is a private dispute between vendors; please seek mediation at the bantaba.');

end $life$;

select public.fn_run_escalation_sweep();
select public.fn_run_autoclose_sweep();

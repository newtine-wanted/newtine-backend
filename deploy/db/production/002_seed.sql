-- NEWTINE production reference seed.
-- Apply after 001_schema.sql to the same empty production database.
-- This file contains only canonical reference data owned by this repository.
-- Entity master, publishers, articles, users, and admin accounts are loaded
-- separately from their operational source and are intentionally not seeded here.

BEGIN;

INSERT INTO public.issue_categories (code, display_name, display_order)
VALUES
  ('housing', '주거', 1),
  ('labor', '일자리', 2),
  ('finance', '세금·금융', 3),
  ('welfare', '복지·연금', 4),
  ('education', '교육', 5),
  ('health', '보건·의료', 6),
  ('climate', '환경·기후', 7),
  ('security', '외교·안보', 8),
  ('local', '지역·교통', 9),
  ('politics', '정치·사법', 10)
ON CONFLICT (code) DO UPDATE
SET display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order;

INSERT INTO public.regions (code, name, display_order)
VALUES
  ('SEOUL', '서울특별시', 1),
  ('BUSAN', '부산광역시', 2),
  ('DAEGU', '대구광역시', 3),
  ('INCHEON', '인천광역시', 4),
  ('GWANGJU', '광주광역시', 5),
  ('DAEJEON', '대전광역시', 6),
  ('ULSAN', '울산광역시', 7),
  ('SEJONG', '세종특별자치시', 8),
  ('GYEONGGI', '경기도', 9),
  ('GANGWON', '강원특별자치도', 10),
  ('CHUNGBUK', '충청북도', 11),
  ('CHUNGNAM', '충청남도', 12),
  ('JEONBUK', '전북특별자치도', 13),
  ('JEONNAM', '전라남도', 14),
  ('GYEONGBUK', '경상북도', 15),
  ('GYEONGNAM', '경상남도', 16),
  ('JEJU', '제주특별자치도', 17)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    display_order = EXCLUDED.display_order;

COMMIT;

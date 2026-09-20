-- Optional: reuse unambiguous published glossary definitions without overwriting existing terms.
begin;
-- Reuse only unambiguous definitions from published content.
insert into news_terms (normalized_term, term, definition)
select lower(regexp_replace(trim(normalize(g->>'term', NFKC)), '\s+', ' ', 'g')),
  min(g->>'term'), min(g->>'definition')
from issue_details d join issues i on i.id = d.issue_id
cross join lateral jsonb_array_elements(case when jsonb_typeof(d.glossary) = 'array' then d.glossary else '[]'::jsonb end) g
where i.publication_status = 'PUBLISHED' and jsonb_typeof(g->'term') = 'string'
  and jsonb_typeof(g->'definition') = 'string' and length(trim(g->>'term')) > 0 and length(trim(g->>'definition')) > 0
group by lower(regexp_replace(trim(normalize(g->>'term', NFKC)), '\s+', ' ', 'g'))
having count(distinct trim(g->>'definition')) = 1
on conflict (normalized_term) do nothing;
commit;

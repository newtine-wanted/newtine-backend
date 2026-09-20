-- Optional initial search copy AFTER 001_schema.sql, from existing populated issues.
-- Only pipeline-owned search rows change. Source issues remain untouched.
-- Run while collection is stopped. The runtime also refreshes this copy on start/resume.
begin;
select pg_advisory_xact_lock(92020002);
do $$
begin
  if exists (select 1 from news_collection_runs where status = 'RUNNING') then
    raise exception 'Stop the running collection before refreshing the search copy';
  end if;
end $$;
delete from news_issue_search;
insert into news_issue_search (issue_id, title, published_at)
select id, title, published_at from issues
where publication_status = 'PUBLISHED'
  and published_at >= current_timestamp - interval '7 days'
  and published_at <= current_timestamp;
commit;

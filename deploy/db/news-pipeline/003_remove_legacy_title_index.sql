-- Optional cleanup only for databases that applied the earlier pipeline DDL.
-- No table data is changed. Fresh installations do not need this file.
drop index if exists news_collection_published_title_trgm;

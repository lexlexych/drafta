-- Provider-reported preview image for a post shown in the «Комментарии» list.
-- The URL is filled asynchronously when a post is first seen and retried on
-- later comments only while it remains null. Existing inactive posts are not
-- backfilled and there is no scheduled refresh.
alter table public.posts add column thumbnail_url text;

comment on column public.posts.thumbnail_url is
  'Provider-reported post preview URL. Null until an asynchronous thumbnail lookup succeeds.';

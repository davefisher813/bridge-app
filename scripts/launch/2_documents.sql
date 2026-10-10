-- Decision 2: the 16 prepared files back to Needs Review, the Oct 9 copies
-- to Archived. Nothing is deleted. Run only on Dave's yes.
--
-- The brief counted 17 copies; production has 16 rows named
-- browser-download-* (checked 2026-10-10). The guard below fails if that
-- number has changed, so nothing runs on a different set.
begin;
do $$
declare
  bridge constant uuid := '25eb1763-fe05-450f-ad41-cbf79215c316';
  prepared constant uuid[] := array['7137e189-f7a4-406b-8927-f453304fbab8',
    '8ef6bc5c-74c7-4439-b111-ec88f37e960d',
    '7d5dfba1-b7dc-43db-b0c4-b2e28cfc972e',
    'c29f7ad7-ccc4-43e9-bdb7-6627eb4f4c0d',
    '416d861d-2d9d-4466-ba1a-e423ade78ca4',
    '6916c9fc-7ee6-4dbd-bd20-d1293d3932f1',
    'd3dd06ab-d2ee-4a34-b735-bbc0c98f8d0e',
    'ada740d8-c2df-4ed4-ae03-cfe2cc8dc4fc',
    'ebba0890-77ae-487a-b257-12c9d6bcd4c0',
    '7bf6c2c3-d87b-4f4c-a2b7-d5a5bbda891f',
    '7795c4f1-94d4-4a0a-8545-073b0a0bf42e',
    '35cc69a3-bcb3-4f0f-af8c-ae1c231ff128',
    'f9842696-14ff-4a26-b357-9b50d886463b',
    'c7454ef1-3f1f-4f78-9a93-8f3de72bf53e',
    '218d3722-58b0-4e2a-9f68-48acdb6a1be2',
    '01a38ed3-d51f-4eae-8509-a771a401240b']::uuid[];
  copies constant uuid[] := array['c1166a20-22b4-483e-b290-7ce90d84ea2d',
    '8e95f242-ee10-4231-b610-1bb51355856c',
    '7c93cc40-c251-476e-a3a7-ab9af0e644a5',
    '5c805ddf-c239-4775-94ac-f6c9cba2da3a',
    'ffd009e7-92f7-4de9-bfdf-028fb0c3cd11',
    '9b88d008-d426-4e2c-ba64-907292644666',
    'f6146e09-e45c-4c1c-911c-4039baae30d1',
    'cf07b6b9-70da-42bf-b436-2d2c80ca0043',
    'ddf19ae4-c3ed-4000-9e4e-4f10030f2ec6',
    '12c5b362-0b2b-41b5-ba05-cacc879a045a',
    'b4aecf6f-f9e9-483d-bce8-e435b48982e0',
    '227e18e6-feb6-4729-a429-b6ff6f5f56d3',
    '4106f0c5-abe0-43da-bc31-577d1f55cdc2',
    '3be948b5-271d-4856-93b1-caa1c5705ddb',
    'f1ffdca7-64df-4d2a-83de-86161c6e2709',
    'd74f5c7f-d635-4d6e-9b71-1510b3079c71']::uuid[];
  n int;
begin
  select count(*) into n from public.documents where org_id = bridge and id = any(prepared) and lifecycle = 'archived';
  if n <> 16 then raise exception 'expected 16 archived prepared files, found %', n; end if;
  select count(*) into n from public.documents where org_id = bridge and id = any(copies) and lifecycle = 'needs_review';
  if n <> 16 then raise exception 'expected 16 copies in Needs Review, found %', n; end if;

  update public.documents set lifecycle = 'needs_review', updated_at = now()
    where org_id = bridge and id = any(prepared) and lifecycle = 'archived';
  update public.documents set lifecycle = 'archived', updated_at = now()
    where org_id = bridge and id = any(copies) and lifecycle = 'needs_review';

  -- One log row per move. No actor: this was run on Dave's instruction, not
  -- by a person tapping in the app, and the log does not pretend otherwise.
  insert into public.activity_log (org_id, actor_id, action, subject_type, subject_id, summary)
    select bridge, null, 'document_unarchived', 'document', id, 'Unarchived a document' from unnest(prepared) id;
  insert into public.activity_log (org_id, actor_id, action, subject_type, subject_id, summary)
    select bridge, null, 'document_archived', 'document', id, 'Archived a document' from unnest(copies) id;
end $$;
commit;

select lifecycle, count(*) from public.documents
where org_id = '25eb1763-fe05-450f-ad41-cbf79215c316' group by 1 order by 1;

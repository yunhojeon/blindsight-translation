-- user_state — 크로스-디바이스 동기화 저장소 (Supabase / Postgres)
-- reader.js 가 읽고 쓰는 유일한 테이블. 원격 스키마의 기록용 사본이며,
-- 실제 정의/RLS 는 Supabase 프로젝트에 있다. 여기 값과 어긋나면 원격이 정본.
--
-- 컬럼별 특성(RPC/백워드 호환 분석의 근거):
--   position   jsonb  nullable            — { seg_id, chap, pct, ts(ms epoch), device }
--   bookmarks  jsonb  DEFAULT '{}'        — { <seg_id>: { t(ms), d(tombstone) } }
--   prefs      jsonb  nullable            — { orig, anno, gloss, ts }
--   notes      jsonb  NOT NULL DEFAULT '{}' — { <id>: { …, ts, d } }   ← NOT NULL 이지만 기본값 있음
--   updated_at timestamptz DEFAULT now()  — 클라이언트는 읽지 않음(SELECT 에 미포함)
--   user_id    uuid  PK, FK→auth.users    — on conflict (user_id) 의 근거
--
-- push_position RPC 의 insert 분기는 (user_id, position, updated_at) 만 채운다.
-- bookmarks/notes 는 DEFAULT '{}', prefs 는 NULL 로 안착 → NOT NULL 위반 없음.

CREATE TABLE public.user_state (
  user_id    uuid NOT NULL,
  position   jsonb,
  bookmarks  jsonb DEFAULT '{}'::jsonb,
  prefs      jsonb,
  updated_at timestamp with time zone DEFAULT now(),
  notes      jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT user_state_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- RLS: 원격 프로젝트에 존재(라이브 앱이 authenticated 로 upsert/delete 성공 → user_id = auth.uid()
-- 정책이 이미 있음이 입증됨). push_position 은 security invoker 라 동일 정책을 그대로 상속한다.
-- TODO: pg_policies 출력을 여기 붙여 넣어 정본화.

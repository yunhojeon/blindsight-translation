-- push_position — 읽은 위치만, ts 가 더 클 때만 쓰는 단조(monotonic) upsert.
-- 백그라운드 전환 시 reader.js 의 keepalive flush 가 호출한다(SELECT→UPSERT 왕복 회피).
--
-- 안전 특성:
--   · 컬럼 목록이 (user_id, position, updated_at) 뿐 → bookmarks/prefs/notes 손실 불가.
--   · where 절의 ts 비교 → 위치가 절대 뒤로 가지 않음(늦게·역순 도착해도 안전).
--   · null-guard → seg_id/ts 없는 malformed position 이 insert 분기로 새는 것 차단.
--   · security invoker → 기존 RLS 그대로 적용(definer 면 RLS 우회로 위험).
--
-- 배포: Supabase SQL editor 에서 실행. 클라이언트가 호출하기 전까지 비활성(무위험).

create or replace function public.push_position(p jsonb)
returns boolean language plpgsql security invoker as $$
declare applied integer := 0;   -- 영향받은 행 수(row_count) — return 에서 >0 판정
begin
  if auth.uid() is null then return false; end if;               -- 비인증 호출(예: SQL editor)엔 안전하게 no-op
  if p is null or (p->>'seg_id') is null or (p->>'ts') is null then
    return false;
  end if;

  insert into public.user_state (user_id, position, updated_at)
  values (auth.uid(), p, now())
  on conflict (user_id) do update
    set position = excluded.position, updated_at = now()
    where coalesce((user_state.position->>'ts')::bigint, 0)
        < (excluded.position->>'ts')::bigint;

  get diagnostics applied = row_count;
  return applied > 0;
end; $$;

revoke all on function public.push_position(jsonb) from public, anon;
grant execute on function public.push_position(jsonb) to authenticated;

-- 검증(SQL editor): auth.uid() 가 필요하므로 실제 유저를 '가장(impersonate)' 한다.
--   ⚠️ 트랜잭션으로 감싸 ROLLBACK — ts=9999999999999 는 미래값이라, 커밋하면 단조 가드가
--      그 유저의 이후 실제 위치 저장을 영구 차단한다. 절대 커밋하지 말 것.
--   select id, email from auth.users limit 5;   -- 가장할 uuid 하나 고르기
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims to '{"sub":"<uuid>","role":"authenticated"}';
--     select push_position('{"seg_id":"s2000","chap":9,"pct":55,"ts":9999999999999}'::jsonb);  -- true
--     select push_position('{"seg_id":"s0001","chap":0,"pct":0,"ts":1}'::jsonb);                -- false, 행 불변
--     select push_position('{"seg_id":"s0001"}'::jsonb);                                         -- false (ts 없음)
--     select position, bookmarks, notes from user_state where user_id = '<uuid>';  -- bookmarks/notes 앞뒤 동일
--   rollback;   -- 반드시 롤백(테스트값을 남기지 않음)

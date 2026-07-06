-- The second migration revoked EXECUTE on current_pod_id() from authenticated,
-- but RLS policies on profiles/tasks/daily_plans/streaks call it on every read.
-- That turns every authenticated query into a 403 "permission denied for
-- function current_pod_id", which freezes the dashboard on the loading screen.
-- Restore EXECUTE to authenticated so RLS policy checks can call the helper.

GRANT EXECUTE ON FUNCTION public.current_pod_id() TO authenticated;

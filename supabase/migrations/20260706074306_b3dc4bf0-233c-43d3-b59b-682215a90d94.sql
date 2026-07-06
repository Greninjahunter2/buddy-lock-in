
-- Fix search_path
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Lock down SECURITY DEFINER helpers from direct execution
REVOKE EXECUTE ON FUNCTION public.current_pod_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Tighten pods insert: only users who don't already belong to a pod
DROP POLICY IF EXISTS "any authed create pod" ON public.pods;
CREATE POLICY "create pod if unpaired" ON public.pods FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND pod_id IS NULL)
  );

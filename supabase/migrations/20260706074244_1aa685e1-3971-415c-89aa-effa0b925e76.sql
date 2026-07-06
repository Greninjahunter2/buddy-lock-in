
-- Pods (accountability pair)
CREATE TABLE public.pods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pods TO authenticated;
GRANT ALL ON public.pods TO service_role;
ALTER TABLE public.pods ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  pod_id UUID REFERENCES public.pods(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's pod
CREATE OR REPLACE FUNCTION public.current_pod_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT pod_id FROM public.profiles WHERE id = auth.uid() $$;

-- Profile policies
CREATE POLICY "read own or podmate profile" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR (pod_id IS NOT NULL AND pod_id = public.current_pod_id()));
CREATE POLICY "insert own profile" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Pod policies: members can read their pod; any authed user can create
CREATE POLICY "members read pod" ON public.pods FOR SELECT TO authenticated
  USING (id = public.current_pod_id() OR EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND pod_id IS NULL
  ));
CREATE POLICY "any authed create pod" ON public.pods FOR INSERT TO authenticated WITH CHECK (true);

-- Tasks
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  pod_id UUID REFERENCES public.pods(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'med' CHECK (priority IN ('high','med','low')),
  due_date DATE,
  tag TEXT,
  visibility TEXT NOT NULL DEFAULT 'shared' CHECK (visibility IN ('private','shared')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','done')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own tasks" ON public.tasks FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "read partner shared tasks" ON public.tasks FOR SELECT TO authenticated
  USING (visibility = 'shared' AND pod_id IS NOT NULL AND pod_id = public.current_pod_id() AND user_id <> auth.uid());
CREATE POLICY "insert own tasks" ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "update own tasks" ON public.tasks FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "delete own tasks" ON public.tasks FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Daily plans (top-3 priorities per user per day)
CREATE TABLE public.daily_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  pod_id UUID REFERENCES public.pods(id) ON DELETE SET NULL,
  plan_date DATE NOT NULL,
  priority_task_ids UUID[] NOT NULL DEFAULT '{}',
  reflection TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, plan_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_plans TO authenticated;
GRANT ALL ON public.daily_plans TO service_role;
ALTER TABLE public.daily_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own plans" ON public.daily_plans FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "read partner plans" ON public.daily_plans FOR SELECT TO authenticated
  USING (pod_id IS NOT NULL AND pod_id = public.current_pod_id() AND user_id <> auth.uid());
CREATE POLICY "insert own plans" ON public.daily_plans FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "update own plans" ON public.daily_plans FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Streaks
CREATE TABLE public.streaks (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  pod_id UUID REFERENCES public.pods(id) ON DELETE SET NULL,
  current_count INT NOT NULL DEFAULT 0,
  longest_count INT NOT NULL DEFAULT 0,
  last_completed_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.streaks TO authenticated;
GRANT ALL ON public.streaks TO service_role;
ALTER TABLE public.streaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own streak" ON public.streaks FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "read partner streak" ON public.streaks FOR SELECT TO authenticated
  USING (pod_id IS NOT NULL AND pod_id = public.current_pod_id() AND user_id <> auth.uid());
CREATE POLICY "insert own streak" ON public.streaks FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "update own streak" ON public.streaks FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- updated_at trigger fn
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_touch BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_daily_plans_touch BEFORE UPDATE ON public.daily_plans
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_streaks_touch BEFORE UPDATE ON public.streaks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-create profile on signup (display_name from user metadata or email prefix)
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.streaks (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_plans;
ALTER PUBLICATION supabase_realtime ADD TABLE public.streaks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;

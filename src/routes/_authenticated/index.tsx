import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Flame, LogOut, Plus, Check, Trash2, Trophy, Users, Eye, EyeOff } from "lucide-react";
import { todayISO, recomputeStreakForToday } from "@/lib/streak";
import { PodPairing } from "@/components/PodPairing";

type Profile = { id: string; display_name: string; pod_id: string | null };
type Task = {
  id: string; user_id: string; title: string;
  priority: "high" | "med" | "low"; due_date: string | null;
  tag: string | null; visibility: "private" | "shared";
  status: "todo" | "done"; completed_at: string | null;
};
type Streak = { user_id: string; current_count: number; longest_count: number; last_completed_date: string | null };
type DailyPlan = { user_id: string; plan_date: string; priority_task_ids: string[] };

export const Route = createFileRoute("/_authenticated/")({
  component: Dashboard,
  errorComponent: ({ error }) => (
    <div className="p-8 text-center text-danger">{error.message}</div>
  ),
  notFoundComponent: () => <div className="p-8 text-center">Not found</div>,
});

function Dashboard() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const today = todayISO();

  const meQuery = useQuery({
    queryKey: ["profile", user.id],
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase.from("profiles").select("id,display_name,pod_id").eq("id", user.id).maybeSingle();
      if (error) throw error;
      if (!data) {
        // Profile not created yet (trigger may lag). Create it now.
        const { data: created, error: insErr } = await supabase
          .from("profiles")
          .insert({ id: user.id, display_name: (user.user_metadata?.display_name as string) || user.email?.split("@")[0] || "You" })
          .select("id,display_name,pod_id")
          .maybeSingle();
        if (insErr) throw insErr;
        return created as Profile;
      }
      return data as Profile;
    },
  });

  const me = meQuery.data;
  const podId = me?.pod_id ?? null;

  const partnerQuery = useQuery({
    queryKey: ["partner", podId],
    enabled: !!podId,
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase.from("profiles").select("id,display_name,pod_id").eq("pod_id", podId!).neq("id", user.id).maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
  });

  const podQuery = useQuery({
    queryKey: ["pod", podId],
    enabled: !!podId,
    queryFn: async () => {
      const { data, error } = await supabase.from("pods").select("id,invite_code").eq("id", podId!).single();
      if (error) throw error;
      return data;
    },
  });

  const tasksQuery = useQuery({
    queryKey: ["tasks", user.id, podId],
    enabled: !!me,
    queryFn: async (): Promise<Task[]> => {
      let q = supabase.from("tasks").select("*").order("created_at", { ascending: false });
      if (podId) q = q.or(`user_id.eq.${user.id},and(pod_id.eq.${podId},visibility.eq.shared)`);
      else q = q.eq("user_id", user.id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });

  const streaksQuery = useQuery({
    queryKey: ["streaks", user.id, podId],
    enabled: !!me,
    queryFn: async (): Promise<Streak[]> => {
      const ids = [user.id, partnerQuery.data?.id].filter(Boolean) as string[];
      if (ids.length === 0) return [];
      const { data, error } = await supabase.from("streaks").select("*").in("user_id", ids);
      if (error) throw error;
      return (data ?? []) as Streak[];
    },
  });

  const plansQuery = useQuery({
    queryKey: ["daily_plans", today, user.id, podId],
    enabled: !!me,
    queryFn: async (): Promise<DailyPlan[]> => {
      const ids = [user.id, partnerQuery.data?.id].filter(Boolean) as string[];
      if (ids.length === 0) return [];
      const { data, error } = await supabase.from("daily_plans").select("user_id,plan_date,priority_task_ids").in("user_id", ids).eq("plan_date", today);
      if (error) throw error;
      return (data ?? []) as DailyPlan[];
    },
  });

  // realtime subscriptions
  useEffect(() => {
    if (!podId) return;
    const channel = supabase
      .channel("pod-" + podId)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `pod_id=eq.${podId}` }, () => {
        qc.invalidateQueries({ queryKey: ["tasks"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "streaks", filter: `pod_id=eq.${podId}` }, () => {
        qc.invalidateQueries({ queryKey: ["streaks"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_plans", filter: `pod_id=eq.${podId}` }, () => {
        qc.invalidateQueries({ queryKey: ["daily_plans"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [podId, qc]);

  const signOut = useCallback(async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }, [qc, navigate]);

  if (meQuery.isLoading || meQuery.isPending) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  }
  if (meQuery.error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="card-surface p-6 max-w-md text-center">
          <h2 className="font-display text-lg text-danger mb-2">Couldn't load your profile</h2>
          <p className="text-sm text-muted-foreground mb-4">{meQuery.error.message}</p>
          <button onClick={() => meQuery.refetch()} className="btn-primary">Try again</button>
        </div>
      </div>
    );
  }
  if (!me) return null;

  if (!me.pod_id) {
    return <PodPairing userId={me.id} onPaired={() => qc.invalidateQueries()} onSignOut={signOut} />;
  }

  const partner = partnerQuery.data;
  const myTasks = (tasksQuery.data ?? []).filter((t) => t.user_id === user.id);
  const partnerTasks = (tasksQuery.data ?? []).filter((t) => t.user_id !== user.id);
  const myPlan = plansQuery.data?.find((p) => p.user_id === user.id);
  const partnerPlan = plansQuery.data?.find((p) => p.user_id === partner?.id);
  const myStreak = streaksQuery.data?.find((s) => s.user_id === user.id);
  const partnerStreak = streaksQuery.data?.find((s) => s.user_id === partner?.id);

  return (
    <div className="min-h-screen max-w-6xl mx-auto px-4 py-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="text-primary" size={28} strokeWidth={2.5} />
          <h1 className="font-display text-2xl md:text-3xl">LOCK IN</h1>
        </div>
        <div className="flex items-center gap-2">
          {podQuery.data && (
            <span className="chip"><Users size={12} /> {podQuery.data.invite_code}</span>
          )}
          <button onClick={signOut} className="btn-ghost !py-1.5 !px-3 text-sm inline-flex items-center gap-1.5">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </header>

      {/* VS scoreboard */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <PlayerCard
          name={me.display_name}
          isMe
          streak={myStreak?.current_count ?? 0}
          longest={myStreak?.longest_count ?? 0}
          doneToday={myTasks.filter((t) => t.status === "done" && sameDay(t.completed_at, today)).length}
          top3Done={countTop3Done(myPlan, myTasks)}
          top3Total={myPlan?.priority_task_ids.length ?? 0}
        />
        <PlayerCard
          name={partner?.display_name ?? "Waiting for partner..."}
          streak={partnerStreak?.current_count ?? 0}
          longest={partnerStreak?.longest_count ?? 0}
          doneToday={partnerTasks.filter((t) => t.status === "done" && sameDay(t.completed_at, today)).length}
          top3Done={countTop3Done(partnerPlan, partnerTasks)}
          top3Total={partnerPlan?.priority_task_ids.length ?? 0}
          empty={!partner}
          inviteCode={podQuery.data?.invite_code}
        />
      </section>

      {/* Top 3 today */}
      <Top3Section
        userId={user.id}
        podId={podId!}
        myTasks={myTasks}
        currentPlan={myPlan}
        today={today}
        onChanged={() => {
          qc.invalidateQueries({ queryKey: ["daily_plans"] });
          qc.invalidateQueries({ queryKey: ["streaks"] });
        }}
      />

      {/* My tasks */}
      <TaskSection userId={user.id} podId={podId!} tasks={myTasks} onChanged={() => qc.invalidateQueries()} />

      {/* Partner tasks (visible/shared only) */}
      {partner && (
        <section className="card-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg">{partner.display_name}'s Grind</h2>
            <span className="chip"><Eye size={12} /> Shared</span>
          </div>
          {partnerTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing shared yet.</p>
          ) : (
            <ul className="space-y-2">
              {partnerTasks.slice(0, 15).map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm">
                  <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border ${t.status === "done" ? "bg-accent border-accent" : "border-border"}`}>
                    {t.status === "done" && <Check size={10} className="text-accent-foreground" />}
                  </span>
                  <span className={t.status === "done" ? "line-through text-muted-foreground" : ""}>{t.title}</span>
                  {t.tag && <span className="chip">{t.tag}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function sameDay(iso: string | null, day: string) {
  if (!iso) return false;
  return iso.slice(0, 10) === day;
}

function countTop3Done(plan: DailyPlan | undefined, tasks: Task[]) {
  if (!plan) return 0;
  const ids = new Set(plan.priority_task_ids);
  return tasks.filter((t) => ids.has(t.id) && t.status === "done").length;
}

function PlayerCard(props: {
  name: string; isMe?: boolean; streak: number; longest: number;
  doneToday: number; top3Done: number; top3Total: number;
  empty?: boolean; inviteCode?: string;
}) {
  const score = props.doneToday * 10 + props.streak * 5 + props.top3Done * 15;
  return (
    <div className={`card-surface p-5 relative overflow-hidden ${props.isMe ? "ring-1 ring-primary/40" : ""}`}>
      {props.isMe && <span className="chip absolute top-3 right-3 !bg-primary !text-primary-foreground">You</span>}
      <div className="flex items-baseline gap-2">
        <h3 className="font-display text-xl">{props.name}</h3>
      </div>
      {props.empty ? (
        <div className="mt-4 text-sm text-muted-foreground">
          Share this code with your partner: <span className="font-display text-primary text-lg tracking-widest">{props.inviteCode}</span>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Stat label="Score" value={score} accent />
            <Stat label="Streak" value={<span className="inline-flex items-center gap-1"><Flame size={16} className="text-flame" />{props.streak}</span>} />
            <Stat label="Done" value={props.doneToday} />
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Top 3: <span className="text-foreground font-bold">{props.top3Done}/{props.top3Total || 0}</span> · Best streak {props.longest}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`rounded-lg p-2 text-center ${accent ? "bg-primary/15" : "bg-[var(--surface-2)]"}`}>
      <div className={`font-display text-2xl leading-none ${accent ? "text-primary" : ""}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function Top3Section(props: {
  userId: string; podId: string; myTasks: Task[]; currentPlan: DailyPlan | undefined; today: string; onChanged: () => void;
}) {
  const openTasks = props.myTasks.filter((t) => t.status === "todo");
  const currentIds = props.currentPlan?.priority_task_ids ?? [];
  const [busy, setBusy] = useState(false);

  const toggle = async (id: string) => {
    setBusy(true);
    try {
      const next = currentIds.includes(id) ? currentIds.filter((x) => x !== id) : [...currentIds, id].slice(0, 3);
      const { error } = await supabase
        .from("daily_plans")
        .upsert(
          { user_id: props.userId, pod_id: props.podId, plan_date: props.today, priority_task_ids: next },
          { onConflict: "user_id,plan_date" },
        );
      if (error) throw error;
      await recomputeStreakForToday(props.userId);
      props.onChanged();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const top3Tasks = currentIds.map((id) => props.myTasks.find((t) => t.id === id)).filter(Boolean) as Task[];

  return (
    <section className="card-surface p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-display text-lg flex items-center gap-2"><Trophy size={18} className="text-primary" /> Today's Top 3</h2>
        <span className="text-xs text-muted-foreground">{currentIds.length}/3</span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Pick 3 tasks. Complete all 3 → streak day.</p>

      {top3Tasks.length > 0 && (
        <ol className="space-y-2 mb-4">
          {top3Tasks.map((t, i) => (
            <li key={t.id} className="flex items-center gap-3 p-2 rounded-lg bg-[var(--surface-2)]">
              <span className="font-display text-primary text-lg w-5 text-center">{i + 1}</span>
              <span className={`flex-1 ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</span>
              <button onClick={() => toggle(t.id)} disabled={busy} className="text-xs text-muted-foreground hover:text-danger">remove</button>
            </li>
          ))}
        </ol>
      )}

      {currentIds.length < 3 && openTasks.length > 0 && (
        <div className="text-xs text-muted-foreground mb-2">Add from your tasks:</div>
      )}
      <div className="flex flex-wrap gap-2">
        {openTasks.filter((t) => !currentIds.includes(t.id)).slice(0, 12).map((t) => (
          <button
            key={t.id}
            onClick={() => toggle(t.id)}
            disabled={busy || currentIds.length >= 3}
            className="text-xs px-3 py-1.5 rounded-full border border-border hover:border-primary hover:text-primary transition disabled:opacity-40"
          >
            + {t.title}
          </button>
        ))}
        {openTasks.length === 0 && <p className="text-xs text-muted-foreground">Add tasks below first.</p>}
      </div>
    </section>
  );
}

function TaskSection(props: { userId: string; podId: string; tasks: Task[]; onChanged: () => void }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("med");
  const [tag, setTag] = useState("");
  const [visibility, setVisibility] = useState<Task["visibility"]>("shared");
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("tasks").insert({
        user_id: props.userId, pod_id: props.podId,
        title: title.trim(), priority, tag: tag.trim() || null, visibility,
      });
      if (error) throw error;
      setTitle(""); setTag("");
      props.onChanged();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const toggleDone = async (t: Task) => {
    const nextStatus = t.status === "done" ? "todo" : "done";
    const { error } = await supabase.from("tasks").update({
      status: nextStatus, completed_at: nextStatus === "done" ? new Date().toISOString() : null,
    }).eq("id", t.id);
    if (error) return toast.error(error.message);
    await recomputeStreakForToday(props.userId);
    props.onChanged();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) return toast.error(error.message);
    await recomputeStreakForToday(props.userId);
    props.onChanged();
  };

  const toggleVisibility = async (t: Task) => {
    const v: Task["visibility"] = t.visibility === "shared" ? "private" : "shared";
    const { error } = await supabase.from("tasks").update({ visibility: v }).eq("id", t.id);
    if (error) return toast.error(error.message);
    props.onChanged();
  };

  return (
    <section className="card-surface p-5">
      <h2 className="font-display text-lg mb-3">Your Tasks</h2>
      <form onSubmit={add} className="flex flex-wrap gap-2 mb-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What are you locking in?"
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-[var(--input)] border border-transparent focus:border-primary outline-none text-sm"
        />
        <select value={priority} onChange={(e) => setPriority(e.target.value as Task["priority"])} className="px-3 py-2 rounded-lg bg-[var(--input)] text-sm">
          <option value="high">High</option><option value="med">Med</option><option value="low">Low</option>
        </select>
        <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="tag" className="w-24 px-3 py-2 rounded-lg bg-[var(--input)] text-sm" />
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as Task["visibility"])} className="px-3 py-2 rounded-lg bg-[var(--input)] text-sm">
          <option value="shared">Shared</option><option value="private">Private</option>
        </select>
        <button type="submit" disabled={busy} className="btn-primary !py-2 !px-4 text-sm inline-flex items-center gap-1"><Plus size={16} />Add</button>
      </form>

      {props.tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks yet. Add one above.</p>
      ) : (
        <ul className="space-y-1.5">
          {props.tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-[var(--surface-2)] group">
              <button onClick={() => toggleDone(t)} className={`h-5 w-5 rounded-md border flex items-center justify-center transition ${t.status === "done" ? "bg-accent border-accent" : "border-border hover:border-primary"}`}>
                {t.status === "done" && <Check size={12} className="text-accent-foreground" />}
              </button>
              <span className={`flex-1 text-sm ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</span>
              {t.tag && <span className="chip">{t.tag}</span>}
              <span className={`chip ${t.priority === "high" ? "!bg-danger/20 !text-danger" : t.priority === "low" ? "" : "!bg-primary/15 !text-primary"}`}>{t.priority}</span>
              <button onClick={() => toggleVisibility(t)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition" title={t.visibility}>
                {t.visibility === "shared" ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <button onClick={() => remove(t.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-danger transition">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

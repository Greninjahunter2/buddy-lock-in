import { supabase } from "@/integrations/supabase/client";

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(a: string, b: string) {
  const da = new Date(a + "T00:00:00");
  const db = new Date(b + "T00:00:00");
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

/**
 * A day counts if the user has a plan with 1+ priorities AND all priority tasks are completed.
 * Called after any task/plan mutation.
 */
export async function recomputeStreakForToday(userId: string) {
  const today = todayISO();
  const { data: plan } = await supabase
    .from("daily_plans")
    .select("priority_task_ids")
    .eq("user_id", userId)
    .eq("plan_date", today)
    .maybeSingle();

  const ids = (plan?.priority_task_ids ?? []) as string[];
  let completedToday = false;
  if (ids.length > 0) {
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id,status")
      .in("id", ids);
    completedToday = !!tasks && tasks.length === ids.length && tasks.every((t) => t.status === "done");
  }

  const { data: streak } = await supabase
    .from("streaks")
    .select("current_count,longest_count,last_completed_date")
    .eq("user_id", userId)
    .maybeSingle();

  const last = streak?.last_completed_date ?? null;
  let current = streak?.current_count ?? 0;
  const longest = streak?.longest_count ?? 0;
  let last_completed_date = last;

  if (completedToday) {
    if (last === today) {
      // already counted
    } else if (last && daysBetween(last, today) === 1) {
      current = current + 1;
    } else {
      current = 1;
    }
    last_completed_date = today;
  } else {
    // if last was today (previously counted) and now no longer meets bar, roll back
    if (last === today) {
      current = Math.max(0, current - 1);
      last_completed_date = current > 0 ? previousDate(today) : null;
    }
  }

  const newLongest = Math.max(longest, current);
  await supabase
    .from("streaks")
    .update({ current_count: current, longest_count: newLongest, last_completed_date })
    .eq("user_id", userId);

  return { current, longest: newLongest };
}

function previousDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

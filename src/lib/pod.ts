import { supabase } from "@/integrations/supabase/client";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode(len = 6) {
  let s = "";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[arr[i] % CODE_ALPHABET.length];
  return s;
}

export async function createPod(userId: string) {
  // try a few times in case of code collision
  for (let attempt = 0; attempt < 5; attempt++) {
    const invite_code = randomCode();
    const { data, error } = await supabase
      .from("pods")
      .insert({ invite_code })
      .select()
      .single();
    if (!error && data) {
      const { error: upErr } = await supabase
        .from("profiles")
        .update({ pod_id: data.id })
        .eq("id", userId);
      if (upErr) throw upErr;
      await supabase.from("streaks").update({ pod_id: data.id }).eq("user_id", userId);
      return data;
    }
    if (error && !error.message.includes("duplicate")) throw error;
  }
  throw new Error("Could not create pod");
}

export async function joinPod(userId: string, code: string) {
  const trimmed = code.trim().toUpperCase();
  const { data: pod, error } = await supabase
    .from("pods")
    .select("id")
    .eq("invite_code", trimmed)
    .maybeSingle();
  if (error) throw error;
  if (!pod) throw new Error("Invite code not found");

  // ensure only 2 members
  const { count, error: cntErr } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("pod_id", pod.id);
  if (cntErr) throw cntErr;
  if ((count ?? 0) >= 2) throw new Error("This pod is full");

  const { error: upErr } = await supabase
    .from("profiles")
    .update({ pod_id: pod.id })
    .eq("id", userId);
  if (upErr) throw upErr;
  await supabase.from("streaks").update({ pod_id: pod.id }).eq("user_id", userId);
  return pod;
}

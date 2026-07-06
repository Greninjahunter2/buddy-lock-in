import { useState } from "react";
import { Flame, LogOut, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { createPod, joinPod } from "@/lib/pod";
import { supabase } from "@/integrations/supabase/client";

export function PodPairing({ userId, onPaired, onSignOut }: { userId: string; onPaired: () => void; onSignOut: () => void }) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [code, setCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);

  const doCreate = async () => {
    setBusy(true);
    try {
      const pod = await createPod(userId);
      const { data } = await supabase.from("pods").select("invite_code").eq("id", pod.id).single();
      setCode(data?.invite_code ?? null);
      toast.success("Pod created. Share your code.");
      // don't auto-forward; user needs to see and share the code. Add a continue button.
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const doJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await joinPod(userId, joinCode);
      toast.success("Locked in with your partner.");
      onPaired();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const copy = () => {
    if (!code) return;
    navigator.clipboard.writeText(code);
    toast.success("Copied");
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2">
            <Flame className="text-primary" size={28} strokeWidth={2.5} />
            <h1 className="font-display text-2xl">LOCK IN</h1>
          </div>
          <button onClick={onSignOut} className="btn-ghost !py-1.5 !px-3 text-sm inline-flex items-center gap-1.5">
            <LogOut size={14} /> Sign out
          </button>
        </div>

        <div className="card-surface p-8 shadow-[var(--shadow-elevated)]">
          <h2 className="font-display text-2xl">Pair with your partner</h2>
          <p className="text-sm text-muted-foreground mt-1">Lock In needs two. Create a pod and share the code, or join theirs.</p>

          <div className="flex gap-2 mt-6 mb-6 p-1 rounded-lg bg-[var(--surface-2)]">
            {(["create", "join"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`flex-1 py-2 rounded-md text-sm font-bold uppercase tracking-wider transition ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                {m === "create" ? "Create Pod" : "Join Pod"}
              </button>
            ))}
          </div>

          {mode === "create" ? (
            code ? (
              <div className="space-y-4">
                <div className="text-center">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Your invite code</div>
                  <div className="font-display text-5xl text-primary tracking-widest mt-2">{code}</div>
                </div>
                <button onClick={copy} className="btn-ghost w-full inline-flex items-center justify-center gap-2">
                  <Copy size={14} /> Copy code
                </button>
                <button onClick={onPaired} className="btn-primary w-full inline-flex items-center justify-center gap-2">
                  <Check size={16} /> Continue to dashboard
                </button>
                <p className="text-xs text-center text-muted-foreground">Your partner joins with this code. You'll see them appear once they do.</p>
              </div>
            ) : (
              <button onClick={doCreate} disabled={busy} className="btn-primary w-full">
                {busy ? "..." : "Generate invite code"}
              </button>
            )
          ) : (
            <form onSubmit={doJoin} className="space-y-4">
              <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="ENTER CODE"
                className="w-full px-4 py-3 rounded-lg bg-[var(--input)] text-center font-display text-2xl tracking-widest outline-none focus:ring-2 focus:ring-primary" maxLength={8} />
              <button type="submit" disabled={busy || joinCode.length < 4} className="btn-primary w-full">
                {busy ? "..." : "Join Pod"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

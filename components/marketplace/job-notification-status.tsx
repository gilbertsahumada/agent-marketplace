"use client";
import { useEffect, useState } from "react";
import { NOTIFICATION_LABELS, type NotificationState } from "@/shared/hire-notification";

export function JobNotificationStatus({ chainId, jobId }: { chainId: 56 | 97; jobId: string }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    setLabel(null);
    const refresh = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`/api/marketplace/jobs/${chainId === 97 ? "testnet" : "mainnet"}/${jobId}/notification`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Unavailable");
        const data = await response.json();
        if (active) setLabel(data.state && Object.hasOwn(NOTIFICATION_LABELS, data.state) ? NOTIFICATION_LABELS[data.state as NotificationState] : null);
      } catch { if (active) setLabel("Notification status temporarily unavailable"); }
      finally { clearTimeout(timeout); if (active) timer = setTimeout(refresh, 30000); }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); controller?.abort(); };
  }, [chainId, jobId]);
  return label ? <p role="status" className="mt-4 text-sm text-muted-foreground">{label}</p> : null;
}

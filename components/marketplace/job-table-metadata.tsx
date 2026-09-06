"use client";
import { useEffect, useState } from "react";
import { CalendarDays, Check, Clock3, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { relativeAge } from "./relative-time";

export function CopyJobId({ jobId }: { jobId: string }) {
  const [status, setStatus] = useState("");
  return <span className="inline-flex items-center gap-1 whitespace-nowrap">Job #{jobId}
    <Button type="button" variant="ghost" size="icon-xs" aria-label={`Copy job ID ${jobId}`} onClick={async () => {
      try { await navigator.clipboard.writeText(jobId); setStatus("Job ID copied"); } catch { setStatus("Could not copy job ID"); }
    }}>{status === "Job ID copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</Button>
    <span role="status" className="sr-only">{status}</span>
  </span>;
}

export function JobTimestamp({ value }: { value?: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const timestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return <span title="Creation timestamp unavailable">—</span>;
  const iso = new Date(timestamp).toISOString();
  const full = `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
  const Icon = now !== null && now - timestamp < 86_400_000 ? Clock3 : CalendarDays;
  return <time dateTime={iso} title={full} className="inline-flex flex-col gap-1 whitespace-nowrap">
    <span className="inline-flex items-center gap-1"><Icon aria-hidden="true" className="size-3.5" />{now === null ? iso.slice(0, 10) : relativeAge(timestamp, now)}</span>
    <span className="text-[10px]">{full}</span>
  </time>;
}

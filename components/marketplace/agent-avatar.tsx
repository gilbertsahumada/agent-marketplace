import { Bot } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function AgentAvatar({
  imageUrl,
  name,
  className,
}: {
  imageUrl?: string;
  name: string;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-11 border border-white/10 bg-zinc-900", className)}>
      {imageUrl && <AvatarImage alt={`${name} avatar`} referrerPolicy="no-referrer" src={imageUrl} />}
      <AvatarFallback aria-label={`${name} avatar fallback`}><Bot aria-hidden="true" /></AvatarFallback>
    </Avatar>
  );
}

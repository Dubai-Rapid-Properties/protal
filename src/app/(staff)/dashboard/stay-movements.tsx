import Link from "next/link";
import { LogIn, LogOut, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";

export interface Movement {
  id: string;
  unitId: string;
  unit: string;
  guest: string | null;
  checkIn: string;
  checkOut: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  guests: number | null;
}

const hhmm = (t: string | null) => t?.slice(0, 5) ?? null;

/** "16:00 late" / "by 12:00" - the agreed time, or the standard one. */
function timeLabel(kind: "in" | "out", m: Movement) {
  if (kind === "out") {
    const t = hhmm(m.checkOutTime);
    return t ? (t > "12:00" ? `${t} late` : `by ${t}`) : "by 12:00";
  }
  const t = hhmm(m.checkInTime);
  return t ? (t < "15:00" ? `${t} early` : `from ${t}`) : "from 15:00";
}

function List({
  kind,
  items,
  turnovers,
}: {
  kind: "in" | "out";
  items: Movement[];
  turnovers: Set<string>;
}) {
  const Icon = kind === "in" ? LogIn : LogOut;
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        <Icon className="size-3.5" />
        {kind === "in" ? "Check-ins" : "Check-outs"} · {items.length}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">None</p>
      ) : (
        <ul className="space-y-2">
          {items.map((m) => {
            const early = kind === "in" && m.checkInTime && hhmm(m.checkInTime)! < "15:00";
            const late = kind === "out" && m.checkOutTime && hhmm(m.checkOutTime)! > "12:00";
            return (
              <li key={`${kind}-${m.id}`} className="text-sm">
                <Link href={`/bookings/${m.id}`} className="font-medium hover:underline">
                  {m.unit}
                </Link>
                <span className={early || late ? "font-medium text-[var(--warning)]" : "text-[var(--muted-foreground)]"}>
                  {" "}
                  · {timeLabel(kind, m)}
                </span>
                {turnovers.has(m.unitId) && (
                  <Badge variant="warning" className="ml-1.5 gap-1 align-middle">
                    <Repeat className="size-3" />
                    Same-day turnover
                  </Badge>
                )}
                <p className="text-xs text-[var(--muted-foreground)]">
                  {m.guest ?? "Guest"}
                  {m.guests ? ` · ${m.guests} ${m.guests === 1 ? "guest" : "guests"}` : ""}
                  {kind === "in"
                    ? ` · until ${formatDate(m.checkOut)}`
                    : ` · since ${formatDate(m.checkIn)}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Day({ title, date, movements }: { title: string; date: string; movements: Movement[] }) {
  const outs = movements.filter((m) => m.checkOut === date);
  const ins = movements.filter((m) => m.checkIn === date);
  // A guest leaves and another arrives the same day: the unit must be ready
  // between the two.
  const turnovers = new Set(outs.map((m) => m.unitId).filter((u) => ins.some((m) => m.unitId === u)));
  return (
    <div className="space-y-4">
      <p className="font-medium">
        {title} <span className="font-normal text-[var(--muted-foreground)]">· {formatDate(date)}</span>
      </p>
      <List kind="out" items={outs} turnovers={turnovers} />
      <List kind="in" items={ins} turnovers={turnovers} />
    </div>
  );
}

/** Today's and tomorrow's check-outs and check-ins, for housekeeping above all. */
export function StayMovements({
  today,
  tomorrow,
  movements,
}: {
  today: string;
  tomorrow: string;
  movements: Movement[];
}) {
  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Check-ins and check-outs</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 sm:grid-cols-2">
        <Day title="Today" date={today} movements={movements} />
        <Day title="Tomorrow" date={tomorrow} movements={movements} />
      </CardContent>
    </Card>
  );
}

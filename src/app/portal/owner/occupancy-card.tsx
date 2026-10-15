import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Occupancy } from "@/lib/occupancy";

function OccupancyCell({ o }: { o: Occupancy }) {
  if (o.rate == null) return <span className="text-[var(--muted-foreground)]">—</span>;
  return (
    <div className="ml-auto w-full max-w-28">
      <p className="tabular font-medium">{o.rate}%</p>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--muted)]" aria-hidden>
        <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${o.rate}%` }} />
      </div>
      <p className="tabular mt-1 text-[11px] text-[var(--muted-foreground)]">
        {o.booked}/{o.available} nights
      </p>
    </div>
  );
}

/**
 * Per holiday home: the share of nights that could be let that had a guest.
 * The owner's own stays and other closed nights are left out of both sides.
 */
export function OccupancyCard({
  periods,
  units,
  total,
}: {
  periods: string[];
  units: { id: string; label: string; byPeriod: Occupancy[] }[];
  total: Occupancy[] | null;
}) {
  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="size-4" />
          Occupancy
        </CardTitle>
        <p className="text-xs text-[var(--muted-foreground)]">
          Nights with a guest, out of the nights that could be let. Your own stays and closed nights are not counted.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Unit</TableHead>
              {periods.map((p) => (
                <TableHead key={p} className="text-right">
                  {p}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {units.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <Link href={`/portal/owner/units/${u.id}`} className="break-words font-medium hover:underline">
                    {u.label}
                  </Link>
                </TableCell>
                {u.byPeriod.map((o, i) => (
                  <TableCell key={i} className="text-right">
                    <OccupancyCell o={o} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {total && (
              <TableRow className="bg-[var(--muted)]/40">
                <TableCell className="font-medium">All holiday homes</TableCell>
                {total.map((o, i) => (
                  <TableCell key={i} className="text-right">
                    <OccupancyCell o={o} />
                  </TableCell>
                ))}
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

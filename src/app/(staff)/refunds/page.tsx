import Link from "next/link";
import { FileText, HandCoins, Paperclip, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { EmptyState, Money, PageHeader, StatCard } from "@/components/domain/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { BUCKETS, storage } from "@/lib/storage";
import { REFUND_PEOPLE, REFUND_STATUS, isPdf, type RefundStatus } from "@/lib/refunds";
import { SettleButtons } from "./settle-buttons";

export const metadata = { title: "Refunds" };

const VIEWS = { pending: "Waiting", refunded: "Refunded", rejected: "Declined", all: "All" } as const;
type View = keyof typeof VIEWS;

const TONE: Record<RefundStatus, "warning" | "success" | "muted"> = {
  pending: "warning",
  refunded: "success",
  rejected: "muted",
};

/**
 * Office costs staff paid out of their own pocket, to be paid back (0052).
 * Every staff member sees the list and adds claims; super admins settle them.
 */
export default async function RefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; who?: string }>;
}) {
  const params = await searchParams;
  const view: View = params.view && params.view in VIEWS ? (params.view as View) : "pending";
  const who = REFUND_PEOPLE.find((p) => p === params.who);
  const supabase = await createClient();

  let query = supabase
    .from("refunds")
    .select("id, spent_by, description, amount_aed, spent_on, receipt_path, status, settled_on, settle_note, created_at")
    .order("spent_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (view !== "all") query = query.eq("status", view);
  if (who) query = query.eq("spent_by", who);

  const [profile, { data, error }, waitingResult] = await Promise.all([
    requireCapability("refunds.view"),
    query,
    supabase.from("refunds").select("spent_by, amount_aed").eq("status", "pending"),
  ]);
  const refunds = data ?? [];
  const waiting = waitingResult.data ?? [];
  const canSettle = can(profile.role, "refunds.settle");

  // Each receipt opens through a short-lived link: the bucket is private.
  const receipts = new Map(
    await Promise.all(
      refunds
        .filter((r) => r.receipt_path)
        .map(async (r) => [r.id, await storage.signedUrl(BUCKETS.documents, r.receipt_path!, 3600).catch(() => null)] as const)
    )
  );

  const owed = (name: string) =>
    waiting.filter((w) => w.spent_by === name).reduce((sum, w) => sum + Number(w.amount_aed), 0);
  const people = REFUND_PEOPLE.filter((p) => owed(p) > 0);

  const newButton = (
    <Button asChild>
      <Link href="/refunds/new">
        <Plus className="size-4" />
        New refund
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Refunds"
        description="Office costs paid out of your own pocket: claim them back with the receipt."
        actions={newButton}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="Waiting to be paid"
          value={<Money amount={waiting.reduce((sum, w) => sum + Number(w.amount_aed), 0)} />}
          sublabel={`${waiting.length} ${waiting.length === 1 ? "claim" : "claims"}`}
          tone={waiting.length ? "warning" : "default"}
        />
        {people.slice(0, 2).map((p) => (
          <StatCard key={p} label={`Owed to ${p}`} value={<Money amount={owed(p)} />} href={`/refunds?who=${p}`} />
        ))}
      </div>
      {people.length > 2 && (
        <p className="mb-4 text-sm text-[var(--muted-foreground)]">
          Also owed:{" "}
          {people.slice(2).map((p, i) => (
            <span key={p}>
              {i > 0 && " · "}
              <Link href={`/refunds?who=${p}`} className="hover:underline">
                {p}
              </Link>{" "}
              <Money amount={owed(p)} />
            </span>
          ))}
        </p>
      )}

      <Card className="mb-4">
        <CardContent className="p-3">
          <form className="flex flex-col gap-2 sm:flex-row">
            <Select name="who" defaultValue={who ?? ""} className="sm:w-48">
              <option value="">Everyone</option>
              {REFUND_PEOPLE.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
            <Select name="view" defaultValue={view} className="sm:w-48">
              {Object.entries(VIEWS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary">
              Filter
            </Button>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <EmptyState title="Could not load refunds" description={error.message} icon={<HandCoins className="size-8" />} />
      ) : refunds.length === 0 ? (
        <EmptyState
          title={view === "pending" ? "Nothing waiting" : "No claims here"}
          description={
            view === "pending"
              ? "Paid for something for the office yourself? Claim it back with New refund."
              : "Nothing matches these filters."
          }
          icon={<HandCoins className="size-8" />}
          action={newButton}
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>What for</TableHead>
                <TableHead>Paid by</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden sm:table-cell">Receipt</TableHead>
                <TableHead>Status</TableHead>
                {canSettle && <TableHead className="text-right">Settle</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {refunds.map((r) => {
                const url = receipts.get(r.id);
                const status = (r.status in REFUND_STATUS ? r.status : "pending") as RefundStatus;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-xs">
                      <p className="break-words font-medium">{r.description}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        Paid {formatDate(r.spent_on)}
                        {url && (
                          <a href={url} target="_blank" rel="noreferrer" className="ml-2 underline sm:hidden">
                            Receipt
                          </a>
                        )}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm">{r.spent_by}</TableCell>
                    <TableCell className="text-right">
                      <Money amount={r.amount_aed} />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm hover:underline">
                          {isPdf(r.receipt_path!) ? <FileText className="size-4" /> : <Paperclip className="size-4" />}
                          View
                        </a>
                      ) : (
                        <span className="text-sm text-[var(--muted-foreground)]">None</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={TONE[status]}>{REFUND_STATUS[status]}</Badge>
                      {r.settled_on && (
                        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                          {formatDate(r.settled_on)}
                          {r.settle_note ? ` · ${r.settle_note}` : ""}
                        </p>
                      )}
                    </TableCell>
                    {canSettle && (
                      <TableCell className="text-right">
                        <SettleButtons refundId={r.id} status={status} />
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}

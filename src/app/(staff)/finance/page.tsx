import Link from "next/link";
import { Receipt, TrendingUp, TrendingDown, Percent } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { PageHeader, StatCard, EmptyState, Money } from "@/components/domain/shared";
import { ExportButton } from "@/components/domain/export-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, rollingWindow } from "@/lib/dates";
import { formatAED } from "@/lib/money";

export const metadata = { title: "Ledger" };

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; direction?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  // Default to a rolling window rather than the calendar month, so the ledger
  // is never empty just because the month has only just started. The date
  // pickers below still take any range.
  const { start, end } = rollingWindow(30);
  const from = params.from || start;
  const to = params.to || end;

  let query = supabase
    .from("ledger_entries")
    .select(
      "*, gl_categories(code, name), units(unit_number, properties(name)), owners(full_name)"
    )
    .gte("entry_date", from)
    .lte("entry_date", to)
    .order("entry_date", { ascending: false });

  if (params.direction === "income" || params.direction === "expense") {
    query = query.eq("direction", params.direction);
  }

  await requireCapability("finance.view");
  // Stays that have ended post their payout here first (migration 0023):
  // their status never changes on its own, so this is not left to a trigger.
  await supabase.rpc("post_completed_bookings");
  const { data, error } = await query;
  const entries = data ?? [];

  const income = entries
    .filter((e) => e.direction === "income")
    .reduce((sum, e) => sum + Number(e.amount_aed), 0);
  const expense = entries
    .filter((e) => e.direction === "expense")
    .reduce((sum, e) => sum + Number(e.amount_aed), 0);
  const vat = entries.reduce((sum, e) => sum + Number(e.vat_amount_aed), 0);

  const exportRows = entries.map((e) => ({
    Date: e.entry_date,
    Direction: e.direction,
    Category: e.gl_categories?.name ?? "",
    "Category code": e.gl_categories?.code ?? "",
    Property: e.units?.properties?.name ?? "",
    Unit: e.units?.unit_number ?? "",
    Owner: e.owners?.full_name ?? "",
    Description: e.description,
    "Net (AED)": e.amount_aed,
    "VAT applicable": e.vat_applicable ? "Yes" : "No",
    "VAT (AED)": e.vat_amount_aed,
    "Total (AED)": e.total_aed,
    "On statement": e.statement_id ? "Yes" : "No",
  }));

  return (
    <>
      <PageHeader
        title="Ledger"
        description="Every income and expense event, in AED, with VAT applied per line. Showing the last 30 days unless you pick a range."
        actions={
          <>
            <ExportButton rows={exportRows} filename="drp-ledger" />
            <Button asChild variant="outline">
              <Link href="/finance/statements">Owner statements</Link>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Income"
          value={formatAED(income, { decimals: false })}
          sublabel="Net of VAT"
          tone="success"
          icon={<TrendingUp className="size-5" />}
        />
        <StatCard
          label="Expenses"
          value={formatAED(expense, { decimals: false })}
          sublabel="Net of VAT"
          tone="danger"
          icon={<TrendingDown className="size-5" />}
        />
        <StatCard
          label="Net"
          value={formatAED(income - expense, { decimals: false })}
          sublabel="Before VAT"
          tone="brand"
        />
        <StatCard
          label="VAT"
          value={formatAED(vat, { decimals: false })}
          sublabel="On taxable lines only"
          icon={<Percent className="size-5" />}
        />
      </div>

      <Card className="my-5">
        <CardContent className="p-3">
          <form className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <label htmlFor="from" className="text-xs text-[var(--muted-foreground)]">
                From
              </label>
              <Input id="from" name="from" type="date" defaultValue={from} />
            </div>
            <div className="flex-1 space-y-1">
              <label htmlFor="to" className="text-xs text-[var(--muted-foreground)]">
                To
              </label>
              <Input id="to" name="to" type="date" defaultValue={to} />
            </div>
            <div className="flex-1 space-y-1">
              <label
                htmlFor="direction"
                className="text-xs text-[var(--muted-foreground)]"
              >
                Direction
              </label>
              <Select id="direction" name="direction" defaultValue={params.direction ?? ""}>
                <option value="">Income and expenses</option>
                <option value="income">Income only</option>
                <option value="expense">Expenses only</option>
              </Select>
            </div>
            <Button type="submit" variant="secondary">
              Apply
            </Button>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <EmptyState title="Could not load the ledger" description={error.message} />
      ) : entries.length === 0 ? (
        <EmptyState
          title="No entries in this period"
          description="Income is posted automatically when a rent cheque clears, and for holiday-home stays by the nights in each statement period, 16th to 15th (the payout, once the stay has a price). Expenses can be recorded against a unit."
          icon={<Receipt className="size-8" />}
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="hidden lg:table-cell">Unit</TableHead>
                <TableHead className="hidden md:table-cell">Category</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">VAT</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="tabular whitespace-nowrap text-sm">
                    {formatDate(entry.entry_date)}
                  </TableCell>
                  <TableCell>
                    <p className="truncate text-sm font-medium">{entry.description}</p>
                    {entry.statement_id && (
                      <Badge variant="muted" className="mt-0.5">
                        On statement
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm">
                    {entry.units
                      ? `${entry.units.properties?.name} · ${entry.units.unit_number}`
                      : "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {entry.gl_categories?.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money
                      amount={entry.amount_aed}
                      className={
                        entry.direction === "income"
                          ? "text-[var(--success)]"
                          : undefined
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    {entry.vat_applicable ? (
                      <Money amount={entry.vat_amount_aed} muted />
                    ) : (
                      <span className="text-xs text-[var(--muted-foreground)]">
                        Exempt
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <Money amount={entry.total_aed} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}

import Link from "next/link";
import { DoorOpen, Download, Plus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader, EmptyState, Money } from "@/components/domain/shared";
import {
  UnitStatusBadge,
  OperatingModeBadge,
  EjariBadge,
} from "@/components/domain/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ROW_LINK,
  ROW_CLICKABLE,
} from "@/components/ui/table";
import {
  UNIT_KIND,
  UNIT_STATUS,
  OPERATING_MODE,
  optionsFrom,
  parseEnum,
} from "@/lib/labels";
import { ExportButton } from "@/components/domain/export-button";
import { Badge } from "@/components/ui/badge";
import { dubaiToday } from "@/lib/calendar";

export const metadata = { title: "Units" };

export default async function UnitsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    mode?: string;
    show?: string;
    permit?: string;
  }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("v_units_overview")
    .select("*")
    .eq("is_active", params.show !== "archived")
    .order("property_name")
    .order("unit_number");

  // Query-string values are untrusted: narrow them to real enum members so an
  // arbitrary value yields no filter rather than a Postgres error.
  const status = parseEnum(UNIT_STATUS, params.status);
  const mode = parseEnum(OPERATING_MODE, params.mode);
  if (status) query = query.eq("status", status);
  if (mode) query = query.eq("operating_mode", mode);
  // Holiday home and dual-mode units letting without a live DET permit - the
  // dashboard's permit warning links here.
  const permitMissing = params.permit === "missing";
  if (permitMissing) {
    query = query.in("operating_mode", ["short_term", "both"]).eq("has_valid_permit", false);
  }
  if (params.q) {
    const term = `%${params.q}%`;
    query = query.or(
      `unit_number.ilike.${term},reference_code.ilike.${term},property_name.ilike.${term},owner_name.ilike.${term}`
    );
  }

  const today = dubaiToday();
  const [profile, { data: units, error }, { data: tonight }] = await Promise.all([
    requireCapability("units.view"),
    query,
    // Holiday homes with a guest staying tonight (bookings, not the stored status).
    supabase
      .from("bookings")
      .select("unit_id")
      .in("status", ["confirmed", "checked_in"])
      .lte("check_in", today)
      .gt("check_out", today),
  ]);
  const rows = units ?? [];
  const inHouse = new Set((tonight ?? []).map((b) => b.unit_id));

  const exportRows = rows.map((u) => ({
    Reference: u.reference_code ?? "",
    Property: u.property_name ?? "",
    Unit: u.unit_number ?? "",
    Type: u.kind ? UNIT_KIND[u.kind] : "",
    Bedrooms: u.bedrooms ?? "",
    "Size (sqft)": u.size_sqft ?? "",
    Status: u.status ? UNIT_STATUS[u.status] : "",
    Mode: u.operating_mode ? OPERATING_MODE[u.operating_mode] : "",
    Owner: u.owner_name ?? "",
    "Annual rent (AED)": u.annual_rent_aed ?? "",
    Ejari: u.ejari_status ?? "",
    "DET permit": u.det_permit_number ?? "",
  }));

  return (
    <>
      <PageHeader
        title="Units"
        description={
          params.show === "archived"
            ? `${rows.length} archived unit${rows.length === 1 ? "" : "s"}`
            : `${rows.length} unit${rows.length === 1 ? "" : "s"} under management`
        }
        actions={
          <>
            <ExportButton rows={exportRows} filename="drp-units" />
            {can(profile.role, "units.manage") && (
              <>
                <Button asChild variant="outline">
                  <Link href="/units/from-airbnb">
                    <Download className="size-4" />
                    Import from Airbnb
                  </Link>
                </Button>
                <Button asChild>
                  <Link href="/units/new">
                    <Plus className="size-4" />
                    Add unit
                  </Link>
                </Button>
              </>
            )}
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="p-3">
          <form className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="Search unit, reference, building or owner"
                className="pl-8"
              />
            </div>
            <Select name="status" defaultValue={params.status ?? ""} className="sm:w-48">
              <option value="">All statuses</option>
              {optionsFrom(UNIT_STATUS).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select name="mode" defaultValue={params.mode ?? ""} className="sm:w-44">
              <option value="">All modes</option>
              {optionsFrom(OPERATING_MODE).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select name="show" defaultValue={params.show ?? ""} className="sm:w-40">
              <option value="">Active units</option>
              <option value="archived">Archived units</option>
            </Select>
            {permitMissing && <input type="hidden" name="permit" value="missing" />}
            <Button type="submit" variant="secondary">
              Filter
            </Button>
          </form>
          {permitMissing && (
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Showing holiday home and dual-mode units without a valid DET permit.{" "}
              <Link href="/units" className="underline underline-offset-2">
                Show all units
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      {error ? (
        <EmptyState
          title="Could not load units"
          description={error.message}
          icon={<DoorOpen className="size-8" />}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No units match"
          description="Adjust the filters, or add the first unit to this portfolio."
          icon={<DoorOpen className="size-8" />}
          action={
            can(profile.role, "units.manage") ? (
              <Button asChild>
                <Link href="/units/new">Add unit</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unit</TableHead>
                <TableHead className="hidden md:table-cell">Owner</TableHead>
                <TableHead className="hidden lg:table-cell">Mode</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden xl:table-cell">Compliance</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Rent / night</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((unit) => (
                <TableRow key={unit.id} className={ROW_CLICKABLE}>
                  <TableCell>
                    <Link
                      href={`/units/${unit.id}`}
                      className={ROW_LINK}
                    >
                      {unit.property_name} · {unit.unit_number}
                    </Link>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {unit.kind ? UNIT_KIND[unit.kind] : ""}
                      {unit.bedrooms !== null && ` · ${unit.bedrooms} bed`}
                      {unit.size_sqft && ` · ${Math.round(Number(unit.size_sqft))} sqft`}
                    </p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="text-sm">{unit.owner_name ?? "—"}</span>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {unit.operating_mode && (
                      <OperatingModeBadge mode={unit.operating_mode} />
                    )}
                  </TableCell>
                  <TableCell>
                    {unit.id && inHouse.has(unit.id) ? (
                      <Badge variant="success">Guest in house</Badge>
                    ) : (
                      unit.status && <UnitStatusBadge status={unit.status} />
                    )}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {unit.ejari_status && (
                        <EjariBadge
                          status={unit.ejari_status}
                          contractNumber={unit.lease_number}
                        />
                      )}
                      {(unit.operating_mode === "short_term" ||
                        unit.operating_mode === "both") && (
                        <span className="text-xs">
                          {unit.has_valid_permit ? (
                            <span className="text-[var(--success)]">DET valid</span>
                          ) : (
                            <span className="font-medium text-[var(--destructive)]">
                              No DET permit
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    {unit.annual_rent_aed ? (
                      <Money amount={unit.annual_rent_aed} compact />
                    ) : unit.base_nightly_rate_aed ? (
                      <span className="tabular text-sm">
                        <Money amount={unit.base_nightly_rate_aed} />
                        <span className="text-[var(--muted-foreground)]">/night</span>
                      </span>
                    ) : (
                      <Money amount={unit.target_annual_rent_aed} muted compact />
                    )}
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

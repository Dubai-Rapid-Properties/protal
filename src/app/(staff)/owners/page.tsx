import Link from "next/link";
import { Archive, Users, Plus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader, EmptyState } from "@/components/domain/shared";
import { ExportButton } from "@/components/domain/export-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/dates";
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

export const metadata = { title: "Owners" };

export default async function OwnersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; show?: string; portal?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("owners")
    .select("*, unit_ownerships(unit_id, ownership_pct, end_date), owner_users(profile_id, profiles(last_login_at))")
    .eq("is_active", params.show !== "archived")
    .order("full_name");

  if (params.q) {
    query = query.or(
      `full_name.ilike.%${params.q}%,email.ilike.%${params.q}%,phone.ilike.%${params.q}%`
    );
  }

  const [profile, { data, error }] = await Promise.all([requireCapability("owners.view"), query]);
  const all = (data ?? []).map((owner) => ({
    ...owner,
    unitCount: (owner.unit_ownerships ?? []).filter((o) => o.end_date === null).length,
    hasPortalAccess: (owner.owner_users ?? []).length > 0,
    // The latest sign-in of any of the owner's portal logins.
    lastLoginAt:
      (owner.owner_users ?? [])
        .map((u) => u.profiles?.last_login_at)
        .filter((d): d is string => Boolean(d))
        .sort()
        .at(-1) ?? null,
  }));
  const signedIn = all.filter((o) => o.lastLoginAt).length;
  const invitedOnly = all.filter((o) => o.hasPortalAccess && !o.lastLoginAt).length;
  // ?portal=signed-in: owners who have signed in, latest first; ?portal=not-signed-in: invited, never in.
  const owners =
    params.portal === "signed-in"
      ? all.filter((o) => o.lastLoginAt).sort((a, b) => b.lastLoginAt!.localeCompare(a.lastLoginAt!))
      : params.portal === "not-signed-in"
        ? all.filter((o) => o.hasPortalAccess && !o.lastLoginAt)
        : all;
  const link = (portal?: string) =>
    `/owners?${new URLSearchParams({ ...(params.q ? { q: params.q } : {}), ...(params.show ? { show: params.show } : {}), ...(portal ? { portal } : {}) })}`;

  const exportRows = owners.map((o) => ({
    Name: o.full_name,
    Type: o.is_company ? "Company" : "Individual",
    Email: o.email ?? "",
    Phone: o.phone ?? "",
    Nationality: o.nationality ?? "",
    "Emirates ID": o.emirates_id ?? "",
    TRN: o.trn ?? "",
    Units: o.unitCount,
    "Portal access": o.hasPortalAccess ? "Yes" : "No",
    "Last signed in": o.lastLoginAt ? o.lastLoginAt.slice(0, 10) : "",
  }));

  return (
    <>
      <PageHeader
        title={params.show === "archived" ? "Archived owners" : "Owners"}
        description={
          params.show === "archived"
            ? `${owners.length} archived owner${owners.length === 1 ? "" : "s"}. Open one to restore it.`
            : `${owners.length} owner${owners.length === 1 ? "" : "s"} with property under management`
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={params.show === "archived" ? "/owners" : "/owners?show=archived"}>
                {params.show === "archived" ? <Users className="size-4" /> : <Archive className="size-4" />}
                {params.show === "archived" ? "Active owners" : "Archived"}
              </Link>
            </Button>
            <ExportButton rows={exportRows} filename="drp-owners" />
            {can(profile.role, "owners.manage") && (
              <Button asChild>
                <Link href="/owners/new">
                  <Plus className="size-4" />
                  Add owner
                </Link>
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="p-3">
          <form className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <Input
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Search by name, email or phone"
              className="pl-8"
            />
            {params.show === "archived" && <input type="hidden" name="show" value="archived" />}
            {params.portal && <input type="hidden" name="portal" value={params.portal} />}
          </form>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            {[
              { id: undefined, label: `All (${all.length})` },
              { id: "signed-in", label: `Signed in to the portal (${signedIn})` },
              { id: "not-signed-in", label: `Invited, not signed in yet (${invitedOnly})` },
            ].map((f) => (
              <Button key={f.label} asChild size="sm" variant={params.portal === f.id ? "default" : "outline"}>
                <Link href={link(f.id)}>{f.label}</Link>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {error ? (
        <EmptyState title="Could not load owners" description={error.message} />
      ) : owners.length === 0 ? (
        <EmptyState
          title="No owners"
          description="Add the owners whose property D|R|P manages, then link their units and management agreements."
          icon={<Users className="size-8" />}
          action={
            can(profile.role, "owners.manage") ? (
              <Button asChild>
                <Link href="/owners/new">Add owner</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Owner</TableHead>
                <TableHead className="hidden md:table-cell">Contact</TableHead>
                <TableHead className="hidden lg:table-cell">Nationality</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Portal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {owners.map((owner) => (
                <TableRow key={owner.id} className={ROW_CLICKABLE}>
                  <TableCell>
                    <Link
                      href={`/owners/${owner.id}`}
                      className={ROW_LINK}
                    >
                      {owner.full_name}
                    </Link>
                    {owner.is_company && (
                      <Badge variant="muted" className="ml-2">
                        Company
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <p className="text-sm">{owner.email ?? "—"}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {owner.phone ?? ""}
                    </p>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm">
                    {owner.nationality ?? "—"}
                  </TableCell>
                  <TableCell className="tabular text-right text-sm">
                    {owner.unitCount}
                  </TableCell>
                  <TableCell className="text-right">
                    {owner.lastLoginAt ? (
                      <>
                        <Badge variant="success">Signed in</Badge>
                        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                          Last {formatDateTime(owner.lastLoginAt)}
                        </p>
                      </>
                    ) : owner.hasPortalAccess ? (
                      <Badge variant="warning">Not signed in yet</Badge>
                    ) : (
                      <Badge variant="muted">Not invited</Badge>
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

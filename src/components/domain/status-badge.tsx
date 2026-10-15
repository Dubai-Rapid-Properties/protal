import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { Enums } from "@/lib/db/database.types";
import * as L from "@/lib/labels";

type Variant = NonNullable<BadgeProps["variant"]>;

/**
 * One badge per domain status, with the colour meaning fixed across the app:
 * green = healthy, amber = needs attention soon, red = blocking or overdue,
 * grey = inert. A property manager should be able to read any screen the same
 * way without relearning the palette.
 */

const unitStatus: Record<Enums<"unit_status">, Variant> = {
  vacant: "warning",
  occupied_long_term: "success",
  listed_short_term: "brand",
  under_maintenance: "danger",
  owner_occupied: "muted",
  off_market: "muted",
};

export function UnitStatusBadge({ status }: { status: Enums<"unit_status"> }) {
  return <Badge variant={unitStatus[status]}>{L.UNIT_STATUS[status]}</Badge>;
}

const leaseStatus: Record<Enums<"lease_status">, Variant> = {
  draft: "muted",
  pending_signature: "warning",
  active: "success",
  expiring: "warning",
  renewed: "success",
  terminated: "danger",
  cancelled: "muted",
  expired: "danger",
};

export function LeaseStatusBadge({ status }: { status: Enums<"lease_status"> }) {
  return <Badge variant={leaseStatus[status]}>{L.LEASE_STATUS[status]}</Badge>;
}

const ejariStatus: Record<Enums<"ejari_status">, Variant> = {
  not_registered: "danger",
  pending: "warning",
  registered: "success",
  expired: "danger",
  cancelled: "muted",
};

export function EjariBadge({
  status,
  contractNumber,
}: {
  status: Enums<"ejari_status">;
  contractNumber?: string | null;
}) {
  return (
    <Badge variant={ejariStatus[status]}>
      {status === "registered" && contractNumber
        ? `Ejari ${contractNumber}`
        : L.EJARI_STATUS[status]}
    </Badge>
  );
}

const permitStatus: Record<Enums<"permit_status">, Variant> = {
  draft: "muted",
  pending: "warning",
  active: "success",
  expired: "danger",
  suspended: "danger",
  cancelled: "muted",
};

export function PermitBadge({
  status,
  permitNumber,
}: {
  status: Enums<"permit_status">;
  permitNumber?: string | null;
}) {
  return (
    <Badge variant={permitStatus[status]}>
      {status === "active" && permitNumber
        ? `DET ${permitNumber}`
        : L.PERMIT_STATUS[status]}
    </Badge>
  );
}

const installmentStatus: Record<Enums<"installment_status">, Variant> = {
  scheduled: "muted",
  presented: "warning",
  cleared: "success",
  bounced: "danger",
  part_paid: "warning",
  cancelled: "muted",
  written_off: "danger",
};

export function InstallmentBadge({ status }: { status: Enums<"installment_status"> }) {
  return (
    <Badge variant={installmentStatus[status]}>{L.INSTALLMENT_STATUS[status]}</Badge>
  );
}

const bookingStatus: Record<Enums<"booking_status">, Variant> = {
  inquiry: "muted",
  tentative: "warning",
  confirmed: "success",
  checked_in: "brand",
  checked_out: "muted",
  cancelled: "danger",
  no_show: "danger",
};

export function BookingStatusBadge({ status }: { status: Enums<"booking_status"> }) {
  return <Badge variant={bookingStatus[status]}>{L.BOOKING_STATUS[status]}</Badge>;
}

/** Where a booking came from. Airbnb and direct get their calendar colours. */
export function ChannelBadge({ channel }: { channel: Enums<"sales_channel"> }) {
  const tone =
    channel === "airbnb"
      ? "border-transparent bg-rose-500/12 text-rose-700 dark:text-rose-300"
      : channel === "direct"
        ? undefined
        : "border-transparent bg-sky-500/12 text-sky-700 dark:text-sky-300";
  return (
    <Badge variant={channel === "direct" ? "brand" : "default"} className={tone}>
      {L.SALES_CHANNEL[channel]}
    </Badge>
  );
}

const maintenanceStatus: Record<Enums<"maintenance_status">, Variant> = {
  submitted: "warning",
  acknowledged: "warning",
  awaiting_quote: "warning",
  awaiting_owner_approval: "brand",
  approved: "success",
  scheduled: "default",
  in_progress: "default",
  on_hold: "muted",
  completed: "success",
  closed: "muted",
  rejected: "danger",
  cancelled: "muted",
};

export function MaintenanceStatusBadge({
  status,
}: {
  status: Enums<"maintenance_status">;
}) {
  return (
    <Badge variant={maintenanceStatus[status]}>{L.MAINTENANCE_STATUS[status]}</Badge>
  );
}

const priority: Record<Enums<"maintenance_priority">, Variant> = {
  low: "muted",
  medium: "default",
  high: "warning",
  emergency: "danger",
};

export function PriorityBadge({ value }: { value: Enums<"maintenance_priority"> }) {
  return <Badge variant={priority[value]}>{L.MAINTENANCE_PRIORITY[value]}</Badge>;
}

const invoiceStatus: Record<Enums<"invoice_status">, Variant> = {
  draft: "muted",
  issued: "default",
  part_paid: "warning",
  paid: "success",
  overdue: "danger",
  void: "muted",
  written_off: "danger",
};

export function InvoiceStatusBadge({ status }: { status: Enums<"invoice_status"> }) {
  return <Badge variant={invoiceStatus[status]}>{L.INVOICE_STATUS[status]}</Badge>;
}

const statementStatus: Record<Enums<"statement_status">, Variant> = {
  draft: "muted",
  issued: "default",
  approved: "brand",
  paid: "success",
  void: "danger",
};

export function StatementStatusBadge({
  status,
}: {
  status: Enums<"statement_status">;
}) {
  return <Badge variant={statementStatus[status]}>{L.STATEMENT_STATUS[status]}</Badge>;
}

const severityVariant: Record<Enums<"compliance_severity">, Variant> = {
  ok: "success",
  due_soon: "warning",
  urgent: "danger",
  overdue: "danger",
  missing: "danger",
};

const severityLabel: Record<Enums<"compliance_severity">, string> = {
  ok: "Valid",
  due_soon: "Due soon",
  urgent: "Urgent",
  overdue: "Overdue",
  missing: "Missing",
};

export function ComplianceBadge({
  severity,
  daysRemaining,
}: {
  severity: Enums<"compliance_severity">;
  daysRemaining?: number | null;
}) {
  const suffix =
    daysRemaining === null || daysRemaining === undefined
      ? ""
      : daysRemaining < 0
        ? ` · ${Math.abs(daysRemaining)}d over`
        : ` · ${daysRemaining}d`;

  return (
    <Badge variant={severityVariant[severity]}>
      {severityLabel[severity]}
      {suffix}
    </Badge>
  );
}

export function OperatingModeBadge({ mode }: { mode: Enums<"operating_mode"> }) {
  const variant: Record<Enums<"operating_mode">, Variant> = {
    long_term: "default",
    short_term: "brand",
    both: "brand",
    not_operating: "muted",
  };
  return <Badge variant={variant[mode]}>{L.OPERATING_MODE[mode]}</Badge>;
}

const incidentStatus: Record<L.IncidentStatus, Variant> = {
  open: "warning",
  in_progress: "brand",
  awaiting_payment: "danger",
  resolved: "success",
  closed: "muted",
};

export function IncidentStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={incidentStatus[status as L.IncidentStatus] ?? "muted"}>
      {L.INCIDENT_STATUS[status as L.IncidentStatus] ?? status}
    </Badge>
  );
}

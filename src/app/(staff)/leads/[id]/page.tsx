import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, MessageCircle, Phone } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { Field, FieldGrid, PageHeader } from "@/components/domain/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/dates";
import { LEAD_INTENTS, LEAD_STAGES, humanise, type LeadIntent, type LeadStage } from "@/lib/leads";
import { LeadPanel } from "./lead-panel";

export const metadata = { title: "Lead" };

/** Fields shown on their own above the form's answers. */
const SHOWN = new Set(["form", "name", "email", "phone", "message", "submittedAt"]);

const show = (v: unknown): string => {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map(show).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const [, { data: lead }, { data: activities }, { data: staffRows }] = await Promise.all([
    requireCapability("leads.manage"),
    supabase.from("leads").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("lead_activities")
      .select("id, author_id, body, stage_from, stage_to, occurred_at")
      .eq("lead_id", id)
      .order("occurred_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("role", ["super_admin", "property_manager", "agent", "marketing"])
      .eq("is_active", true)
      .order("full_name"),
  ]);
  if (!lead) notFound();

  const staff = (staffRows ?? []).map((p) => ({ id: p.id, name: p.full_name || p.email || "Staff" }));
  const names = new Map(staff.map((s) => [s.id, s.name]));
  const payload =
    lead.raw_payload && typeof lead.raw_payload === "object" && !Array.isArray(lead.raw_payload)
      ? (lead.raw_payload as Record<string, unknown>)
      : {};
  const answers = Object.entries(payload).filter(([k]) => !SHOWN.has(k));
  const form = typeof payload.form === "string" ? humanise(payload.form) : humanise(lead.source);
  const whatsapp = (lead.whatsapp || lead.phone || "").replace(/[^\d]/g, "");

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href="/leads">
          <ArrowLeft className="size-4" />
          Leads
        </Link>
      </Button>
      <PageHeader
        title={lead.full_name}
        description={`${form} · received ${formatDateTime(lead.created_at)}`}
        actions={
          <>
            {lead.email && (
              <Button asChild variant="outline">
                <a href={`mailto:${lead.email}`}>
                  <Mail className="size-4" />
                  Email
                </a>
              </Button>
            )}
            {lead.phone && (
              <Button asChild variant="outline">
                <a href={`tel:${lead.phone}`}>
                  <Phone className="size-4" />
                  Call
                </a>
              </Button>
            )}
            {whatsapp.length >= 8 && (
              <Button asChild variant="outline">
                <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="size-4" />
                  WhatsApp
                </a>
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                Enquiry
                <Badge variant={lead.stage === "new" ? "brand" : "muted"}>{LEAD_STAGES[lead.stage as LeadStage]}</Badge>
                <Badge variant="muted">{LEAD_INTENTS[lead.intent as LeadIntent]}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldGrid>
                <Field label="Email">{lead.email}</Field>
                <Field label="Phone">{lead.phone}</Field>
                <Field label="Form">{form}</Field>
                {lead.stay_check_in && (
                  <Field label="Stay">
                    {formatDate(lead.stay_check_in)} – {formatDate(lead.stay_check_out)}
                  </Field>
                )}
                {lead.party_size && <Field label="Guests">{lead.party_size}</Field>}
              </FieldGrid>
              {typeof payload.message === "string" && payload.message.trim() && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Message</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{payload.message}</p>
                </div>
              )}
              {answers.length > 0 && (
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {answers.map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{humanise(k)}</dt>
                      <dd className="mt-0.5 break-words text-sm">{show(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {(activities ?? []).length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">Nothing yet. Stage changes and notes appear here.</p>
              ) : (
                <ul className="space-y-3">
                  {(activities ?? []).map((a) => (
                    <li key={a.id} className="text-sm">
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {formatDateTime(a.occurred_at)} · {(a.author_id && names.get(a.author_id)) || "Staff"}
                      </p>
                      {a.stage_to && (
                        <p>
                          {a.stage_from ? LEAD_STAGES[a.stage_from as LeadStage] : "—"} → {LEAD_STAGES[a.stage_to as LeadStage]}
                        </p>
                      )}
                      {a.body && <p className="whitespace-pre-wrap">{a.body}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <LeadPanel
          leadId={lead.id}
          staff={staff}
          current={{
            stage: lead.stage,
            intent: lead.intent,
            assignedTo: lead.assigned_to,
            followUp: lead.next_follow_up_at ? lead.next_follow_up_at.slice(0, 10) : null,
            lostReason: lead.lost_reason,
            notes: lead.notes,
          }}
        />
      </div>
    </>
  );
}

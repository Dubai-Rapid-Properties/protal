/**
 * The "Refunded" confirmation image a super admin sends to whoever paid
 * (WhatsApp, usually): who was paid back, how much, what for and when. Drawn
 * on a canvas in the browser, so nothing is stored. Browser only, apart from
 * wrapText.
 */
import { formatDate } from "@/lib/dates";
import { formatAED } from "@/lib/money";
import { refundReference } from "@/lib/refunds";

export type RefundForImage = {
  id: string;
  spent_by: string;
  description: string;
  amount_aed: number | string;
  spent_on: string;
  settled_on: string | null;
  settle_note: string | null;
};

const W = 1080;
const PAD = 90;
const NAVY = "#0F172A";
const GOLD = "#C6A15B";
const GREEN = "#16A34A";
const MUTED = "#64748B";
const LINE = "#E2E8F0";
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Breaks text into lines no wider than maxWidth, at most maxLines of them; the
 * last one ends in an ellipsis when the text does not fit. A word too long
 * for a line is cut.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (measure(line) > maxWidth && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && measure(`${last}…`) > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

async function loadLogo(): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.src = "/logo-white.png";
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/** Draws the confirmation and returns it as a PNG. */
export async function drawRefundImage(r: RefundForImage, companyName = "DRP Holiday Homes LLC"): Promise<Blob> {
  const logo = await loadLogo();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = (px: number, weight = 400) => `${weight} ${px}px ${FONT}`;
  const measureWith = (f: string) => (s: string) => {
    ctx.font = f;
    return ctx.measureText(s).width;
  };

  const inner = W - PAD * 2;
  const forLines = wrapText(r.description, inner, measureWith(font(36, 600)), 4);
  const noteLines = r.settle_note ? wrapText(r.settle_note, inner, measureWith(font(30)), 3) : [];
  const rows: [string, string][] = [
    ["Spent on", formatDate(r.spent_on)],
    ["Refunded on", formatDate(r.settled_on)],
    ["Reference", refundReference(r.id)],
  ];

  // Height follows the text, so a long description is never cut short.
  const headerH = 260;
  const detailsTop = 900;
  const forH = 50 + forLines.length * 50;
  const rowsH = rows.length * 76;
  const noteH = noteLines.length ? 84 + noteLines.length * 42 : 0;
  const H = detailsTop + forH + 30 + rowsH + noteH + 190;

  canvas.width = W;
  canvas.height = H;
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, W, H);

  // Header: navy band with the white logo, gold rule beneath.
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, headerH);
  ctx.fillStyle = GOLD;
  ctx.fillRect(0, headerH, W, 8);
  if (logo) {
    const h = 150;
    const w = (logo.naturalWidth / logo.naturalHeight) * h;
    ctx.drawImage(logo, (W - w) / 2, (headerH - h) / 2, w, h);
  } else {
    ctx.fillStyle = "#FFFFFF";
    ctx.font = font(72, 700);
    ctx.textAlign = "center";
    ctx.fillText("D|R|P", W / 2, headerH / 2 + 26);
  }

  // Green tick.
  const cx = W / 2;
  const cy = 420;
  ctx.fillStyle = GREEN;
  ctx.beginPath();
  ctx.arc(cx, cy, 78, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 16;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(cx - 34, cy + 2);
  ctx.lineTo(cx - 9, cy + 28);
  ctx.lineTo(cx + 38, cy - 24);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = GREEN;
  ctx.font = font(34, 700);
  ctx.letterSpacing = "6px";
  ctx.fillText("REFUNDED", cx, 560);
  ctx.letterSpacing = "0px";

  ctx.fillStyle = NAVY;
  let size = 56;
  const title = `Paid back to ${r.spent_by}`;
  while (size > 36 && measureWith(font(size, 700))(title) > inner) size -= 2;
  ctx.font = font(size, 700);
  ctx.fillText(title, cx, 640);

  const amount = formatAED(r.amount_aed);
  size = 112;
  while (size > 60 && measureWith(font(size, 800))(amount) > inner) size -= 4;
  ctx.font = font(size, 800);
  ctx.fillText(amount, cx, 780);

  // Dashed rule, like a receipt.
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 3;
  ctx.lineCap = "butt";
  ctx.setLineDash([14, 10]);
  ctx.beginPath();
  ctx.moveTo(PAD, 840);
  ctx.lineTo(W - PAD, 840);
  ctx.stroke();
  ctx.setLineDash([]);

  // What it was for.
  ctx.textAlign = "left";
  let y = detailsTop;
  ctx.fillStyle = MUTED;
  ctx.font = font(28, 500);
  ctx.fillText("For", PAD, y);
  ctx.fillStyle = NAVY;
  ctx.font = font(36, 600);
  for (const line of forLines) {
    y += 50;
    ctx.fillText(line, PAD, y);
  }
  y += 30;

  for (const [label, value] of rows) {
    y += 76;
    ctx.textAlign = "left";
    ctx.fillStyle = MUTED;
    ctx.font = font(30);
    ctx.fillText(label, PAD, y);
    ctx.textAlign = "right";
    ctx.fillStyle = NAVY;
    ctx.font = font(32, 600);
    ctx.fillText(value, W - PAD, y);
    ctx.fillStyle = LINE;
    ctx.fillRect(PAD, y + 26, inner, 2);
  }

  if (noteLines.length) {
    y += 84;
    ctx.textAlign = "left";
    ctx.fillStyle = MUTED;
    ctx.font = font(28, 500);
    ctx.fillText("Note", PAD, y);
    ctx.fillStyle = NAVY;
    ctx.font = font(30);
    for (const line of noteLines) {
      y += 42;
      ctx.fillText(line, PAD, y);
    }
  }

  // Footer.
  ctx.textAlign = "center";
  ctx.fillStyle = NAVY;
  ctx.font = font(30, 600);
  ctx.fillText("Thank you!", cx, H - 100);
  ctx.fillStyle = MUTED;
  ctx.font = font(26);
  ctx.fillText(companyName, cx, H - 58);
  ctx.fillStyle = GOLD;
  ctx.fillRect(0, H - 12, W, 12);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The image could not be made.");
  return blob;
}

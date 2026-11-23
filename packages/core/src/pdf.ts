/**
 * A small PDF writer: pages holding JPEG pictures, lines, rectangles and text in Helvetica. Enough to print a map across sheets of paper (printPlan.ts);
 * no embedded fonts and no compression of its own (the pictures are JPEG already). Coordinates are PDF points (1/72 inch) from the page's bottom-left.
 */

export type PdfOp =
  /** A JPEG picture (`pw` x `ph` pixels) drawn into the box x, y, w, h. */
  | { t: "image"; jpeg: Uint8Array; pw: number; ph: number; x: number; y: number; w: number; h: number }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; width: number; gray?: number; dash?: number[] }
  | { t: "rect"; x: number; y: number; w: number; h: number; width: number; gray?: number; dash?: number[] }
  /** Text (ASCII: anything else is spelt out or replaced), `size` in points, its baseline at x, y. */
  | { t: "text"; x: number; y: number; size: number; text: string; gray?: number };

export interface PdfPage {
  /** The page's size in points (US Letter is 612 x 792). */
  w: number;
  h: number;
  ops: PdfOp[];
}

const n = (v: number) => (Math.round(v * 100) / 100).toString();

/** Text Helvetica can print: accents dropped (é → e), ß and the like spelt out, anything else a question mark; ( ) and \ escaped. */
export function pdfText(s: string): string {
  const plain = s.normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/Æ/g, "AE").replace(/ø/g, "o").replace(/Ø/g, "O").replace(/œ/g, "oe").replace(/Œ/g, "OE").replace(/þ/g, "th")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/×/g, "x").replace(/…/g, "...");
  return plain.replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1");
}

function contentOf(ops: PdfOp[], images: Map<PdfOp, string>): string {
  const out: string[] = [];
  for (const op of ops) {
    if (op.t === "image") out.push(`q ${n(op.w)} 0 0 ${n(op.h)} ${n(op.x)} ${n(op.y)} cm /${images.get(op)} Do Q`);
    else if (op.t === "line" || op.t === "rect") {
      const style = `${n(op.width)} w ${n(op.gray ?? 0)} G [${(op.dash ?? []).map(n).join(" ")}] 0 d`;
      out.push(op.t === "line" ? `q ${style} ${n(op.x1)} ${n(op.y1)} m ${n(op.x2)} ${n(op.y2)} l S Q` : `q ${style} ${n(op.x)} ${n(op.y)} ${n(op.w)} ${n(op.h)} re S Q`);
    } else out.push(`BT /F1 ${n(op.size)} Tf ${n(op.gray ?? 0)} g ${n(op.x)} ${n(op.y)} Td (${pdfText(op.text)}) Tj ET`);
  }
  return out.join("\n");
}

/** The pages as a PDF file. */
export function writePdf(pages: PdfPage[], title = "Dragon Drop map"): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const offsets: number[] = [];
  const put = (b: Uint8Array | string) => { const u = typeof b === "string" ? enc.encode(b) : b; chunks.push(u); size += u.length; };
  // object numbers: 1 catalogue, 2 page tree, 3 font, 4 information, then each page's page, contents and pictures
  let next = 5;
  const plan = pages.map((p) => {
    const page = next++, contents = next++;
    const images = new Map<PdfOp, string>();
    const imageObjs: { id: number; op: Extract<PdfOp, { t: "image" }> }[] = [];
    for (const op of p.ops) if (op.t === "image") { const id = next++; images.set(op, `Im${id}`); imageObjs.push({ id, op }); }
    return { p, page, contents, images, imageObjs };
  });
  const obj = (id: number, body: string | ((put: (b: Uint8Array | string) => void) => void)) => {
    offsets[id] = size;
    put(`${id} 0 obj\n`);
    if (typeof body === "string") put(body); else body(put);
    put("\nendobj\n");
  };
  put("%PDF-1.4\n%âãÏÓ\n"); // (a comment with bytes over 127, as PDF files carry: tells tools the file is binary)
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${plan.map((x) => `${x.page} 0 R`).join(" ")}] /Count ${plan.length} >>`);
  obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  obj(4, `<< /Title (${pdfText(title)}) /Producer (Dragon Drop) >>`);
  for (const x of plan) {
    const xo = x.imageObjs.map((i) => `/Im${i.id} ${i.id} 0 R`).join(" ");
    obj(x.page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(x.p.w)} ${n(x.p.h)}] /Resources << /Font << /F1 3 0 R >>${xo ? ` /XObject << ${xo} >>` : ""} >> /Contents ${x.contents} 0 R >>`);
    const content = enc.encode(contentOf(x.p.ops, x.images));
    obj(x.contents, (w) => { w(`<< /Length ${content.length} >>\nstream\n`); w(content); w("\nendstream"); });
    for (const i of x.imageObjs) {
      obj(i.id, (w) => {
        w(`<< /Type /XObject /Subtype /Image /Width ${i.op.pw} /Height ${i.op.ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${i.op.jpeg.length} >>\nstream\n`);
        w(i.op.jpeg);
        w("\nendstream");
      });
    }
  }
  const xref = size;
  const count = next;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) table += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  put(table);
  put(`trailer\n<< /Size ${count} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

import * as XLSX from "xlsx";
import { Unzip, UnzipInflate, zipSync, strToU8 } from "fflate";

// Some exports style a million empty rows. Stream-filter those rows before SheetJS
// creates cells, retaining every populated row (even after large empty gaps).
export async function readWorkbook(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!/\.xlsx$/i.test(file.name)) return XLSX.read(bytes, { type: "array", raw: true });
  const entries: Record<string, Uint8Array> = {};
  let failure: Error | undefined;
  const unzip = new Unzip((entry) => {
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name)) {
      const decoder = new TextDecoder();
      let buffer = "",
        prefix = "",
        inData = false,
        ended = false;
      const parts: string[] = [];
      entry.ondata = (error, data, final) => {
        if (error) {
          failure = error;
          return;
        }
        buffer += decoder.decode(data, { stream: !final });
        if (!inData) {
          const start = buffer.indexOf("<sheetData>");
          if (start < 0) {
            if (final) entries[entry.name] = strToU8(buffer);
            return;
          }
          prefix = buffer.slice(0, start).replace(/<dimension\b[^>]*\/>/g, "");
          buffer = buffer.slice(start + 11);
          inData = true;
          parts.push(prefix, "<sheetData>");
        }
        if (!ended) {
          let end: number;
          while ((end = buffer.indexOf("</row>")) >= 0) {
            const row = buffer.slice(0, end + 6);
            if (/<(?:v|t)(?:\s[^>]*)?>[^<]+</.test(row)) parts.push(row);
            buffer = buffer.slice(end + 6);
          }
          const close = buffer.indexOf("</sheetData>");
          if (close >= 0) {
            buffer = buffer.slice(close);
            ended = true;
          }
        }
        if (final) {
          parts.push(buffer);
          entries[entry.name] = strToU8(parts.join(""));
        }
      };
    } else {
      const chunks: Uint8Array[] = [];
      entry.ondata = (error, data, final) => {
        if (error) {
          failure = error;
          return;
        }
        chunks.push(data);
        if (final) {
          const joined = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
          let offset = 0;
          for (const c of chunks) {
            joined.set(c, offset);
            offset += c.length;
          }
          entries[entry.name] = joined;
        }
      };
    }
    entry.start();
  });
  unzip.register(UnzipInflate);
  for (let i = 0; i < bytes.length; i += 65536) {
    unzip.push(bytes.subarray(i, i + 65536), i + 65536 >= bytes.length);
    // Yield so the progress state remains visible during large local imports.
    if (i % 1048576 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (failure) throw failure;
  return XLSX.read(zipSync(entries, { level: 0 }), { type: "array", raw: true });
}

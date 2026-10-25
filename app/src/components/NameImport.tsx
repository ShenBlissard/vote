import { useRef, useState } from "react";
import { cleanNameLine, loadScript } from "@/lib/client";

interface XlsxChoice {
  rows: string[][];
  nameCol: number;
  codeCol: number;
}

const HEADER_WORDS = /^(姓名|名字|学生|人员|名单|候选人|学号|序号|编号|姓名名单)$/;
const CODE_HEADER_WORDS = /^(四位数字|数字|登录数字|账号|学号|编号|序号)?$/;

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

export default function NameImport({
  onImport,
  withCode = false,
}: {
  onImport: (lines: string[]) => void;
  withCode?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [xlsxChoice, setXlsxChoice] = useState<XlsxChoice | null>(null);

  function colCells(rows: string[][], col: number): string[] {
    const out: string[] = [];
    for (const r of rows) {
      const cell = (r[col] ?? "").toString().trim();
      if (cell) out.push(cell);
    }
    return out;
  }

  function extractColumn(rows: string[][], col: number): string[] {
    const out: string[] = [];
    for (let r = 0; r < rows.length; r++) {
      const cell = (rows[r][col] ?? "").toString().trim();
      if (!cell) continue;
      if (r === 0 && HEADER_WORDS.test(cell)) continue;
      out.push(cleanNameLine(cell));
    }
    return out.filter((s) => s && s.length <= 30);
  }

  function guessNameColumn(rows: string[][]): number {
    const maxCol = rows.reduce((m, r) => Math.max(m, r.length), 0);
    let best = 0;
    let bestScore = -1;
    for (let c = 0; c < maxCol; c++) {
      const vals = extractColumn(rows, c);
      const score = vals.filter((s) => !/^\d+$/.test(s)).length;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  function guessCodeColumn(rows: string[][], nameCol: number): number {
    const maxCol = rows.reduce((m, r) => Math.max(m, r.length), 0);
    let best = -1;
    let bestScore = 0;
    for (let c = 0; c < maxCol; c++) {
      if (c === nameCol) continue;
      const vals = colCells(rows, c);
      const score = vals.filter((s) => /^\d{4}$/.test(s)).length;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return bestScore > 0 ? best : -1;
  }

  async function parseXlsx(file: File) {
    await loadScript("/vendor/xlsx.full.min.js");
    const XLSX = (window as unknown as { XLSX: { read: (d: ArrayBuffer, o: object) => { SheetNames: string[]; Sheets: Record<string, object> }; utils: { sheet_to_json: (s: object, o: object) => string[][] } } }).XLSX;
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: false });
    const matrix = rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "")) : []));
    const maxCol = matrix.reduce((m, r) => Math.max(m, r.length), 0);
    if (maxCol === 0) {
      setError("表格是空的");
      return;
    }
    if (!withCode) {
      const names = extractColumn(matrix, guessNameColumn(matrix));
      if (names.length === 0) {
        setError("没有识别到姓名，请检查表格内容");
        return;
      }
      finishImport(names);
    } else {
      const nameCol = guessNameColumn(matrix);
      setXlsxChoice({
        rows: matrix,
        nameCol,
        codeCol: guessCodeColumn(matrix, nameCol),
      });
    }
  }

  async function parseDocx(file: File) {
    await loadScript("/vendor/mammoth.browser.min.js");
    const mammoth = (window as unknown as {
      mammoth: { extractRawText: (o: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> };
    }).mammoth;
    const buf = await file.arrayBuffer();
    const res = await mammoth.extractRawText({ arrayBuffer: buf });
    const lines = res.value
      .split(/\r?\n/)
      .map((s) => (withCode ? s.trim() : cleanNameLine(s)))
      .filter((s) => s && s.length <= 60);
    if (lines.length === 0) {
      setError("文档中没有识别到姓名");
      return;
    }
    finishImport(lines);
  }

  async function preprocessImage(file: File): Promise<string | null> {
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const scale = bitmap.width < 500 ? 3 : 1;
        const w = bitmap.width * scale;
        const h = bitmap.height * scale;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return null;
        ctx.imageSmoothingEnabled = scale > 1;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h);
        const d = data.data;
        let sum = 0;
        let count = 0;
        for (let i = 0; i + 2 < d.length; i += 64) {
          sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          count++;
        }
        const avg = count > 0 ? sum / count : 255;
        if (avg < 120) {
          for (let i = 0; i + 2 < d.length; i += 4) {
            d[i] = 255 - d[i];
            d[i + 1] = 255 - d[i + 1];
            d[i + 2] = 255 - d[i + 2];
          }
          ctx.putImageData(data, 0, 0);
        }
        return canvas.toDataURL("image/png");
      } finally {
        bitmap.close();
      }
    } catch {
      return null;
    }
  }

  async function parseImage(file: File) {
    await loadScript("/vendor/tesseract/tesseract.min.js");
    const Tesseract = (window as unknown as {
      Tesseract: {
        createWorker: (
          lang: string,
          oem: number,
          options: Record<string, unknown>
        ) => Promise<{
          recognize: (f: File | string) => Promise<{ data: { text: string } }>;
          terminate: () => Promise<void>;
        }>;
      };
    }).Tesseract;
    setStatus("正在预处理图片…");
    const imgSource = await preprocessImage(file);
    setStatus("正在初始化识别引擎（首次约需10-30秒）…");
    const worker = await withTimeout(
      Tesseract.createWorker("chi_sim", 1, {
        workerPath: "/vendor/tesseract/worker.min.js",
        corePath: "/vendor/tesseract",
        langPath: "/ocr",
        gzip: false,
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text") {
            setProgress(Math.round(m.progress * 100));
            setStatus(`OCR识别中 ${Math.round(m.progress * 100)}%`);
          }
        },
      }),
      45000,
      "识别引擎加载超时，请刷新页面重试，或改用文本导入"
    );
    try {
      const { data } = await withTimeout(
        worker.recognize(imgSource ?? file),
        120000,
        "图片识别超时，请换一张更清晰的图片，或改用文本导入"
      );
      const lines = data.text
        .split(/\n/)
        .map((s) => (withCode ? s.trim() : cleanNameLine(s)))
        .filter((s) => s && s.length <= 60);
      if (lines.length === 0) {
        setError("图片中没有识别到文字，请确保图片清晰");
        return;
      }
      finishImport(lines);
    } finally {
      await worker.terminate();
    }
  }

  async function parseText(file: File) {
    const text = await file.text();
    const lines = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setError("文件是空的");
      return;
    }
    finishImport(lines);
  }

  function finishImport(lines: string[]) {
    onImport(lines);
    setStatus(`已导入 ${lines.length} 行，请检查下方名单`);
  }

  async function handleFile(file: File) {
    setError("");
    setStatus("");
    setProgress(0);
    setXlsxChoice(null);
    const name = file.name.toLowerCase();
    setBusy(true);
    try {
      if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        setStatus("正在读取表格…");
        await parseXlsx(file);
      } else if (name.endsWith(".docx")) {
        setStatus("正在读取文档…");
        await parseDocx(file);
      } else if (/\.(png|jpe?g|bmp|webp)$/.test(name)) {
        await parseImage(file);
      } else if (name.endsWith(".txt") || name.endsWith(".csv")) {
        await parseText(file);
      } else {
        setError("不支持的文件类型，请使用 Excel、Word、图片或文本文件");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  const maxCol = xlsxChoice ? xlsxChoice.rows.reduce((m, r) => Math.max(m, r.length), 0) : 0;

  function confirmXlsx() {
    if (!xlsxChoice) return;
    if (withCode && (xlsxChoice.codeCol < 0 || xlsxChoice.codeCol === xlsxChoice.nameCol)) {
      setError("请选择与姓名列不同的四位数字列");
      return;
    }
    const rows = xlsxChoice.rows;
    const skipHeader =
      rows.length > 0 &&
      (HEADER_WORDS.test((rows[0][xlsxChoice.nameCol] ?? "").trim()) ||
        (xlsxChoice.codeCol >= 0 && CODE_HEADER_WORDS.test((rows[0][xlsxChoice.codeCol] ?? "").trim()) && (rows[0][xlsxChoice.codeCol] ?? "").trim() !== ""));
    const start = skipHeader ? 1 : 0;
    const lines: string[] = [];
    for (let r = start; r < rows.length; r++) {
      const name = cleanNameLine((rows[r][xlsxChoice.nameCol] ?? "").toString().trim());
      if (!name || name.length > 30) continue;
      const code =
        xlsxChoice.codeCol >= 0
          ? (rows[r][xlsxChoice.codeCol] ?? "").toString().trim()
          : "";
      if (withCode) {
        lines.push(`${code} ${name}`);
      } else {
        lines.push(name);
      }
    }
    if (lines.length === 0) {
      setError("所选列没有识别到姓名，请重新选择");
      return;
    }
    setXlsxChoice(null);
    finishImport(lines);
  }

  return (
    <div className="import-box">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.docx,.txt,.csv,.png,.jpg,.jpeg,.bmp,.webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) handleFile(f);
        }}
      />
      <div className="import-actions">
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {busy ? "处理中…" : "📁 导入名单文件"}
        </button>
        <span className={`import-status ${error ? "err" : ""}`}>
          {error || status || "支持 Excel / Word / 图片 / 文本"}
        </span>
      </div>
      {xlsxChoice && (
        <div className="xlsx-picker">
          <span className="small muted">
            请确认姓名列{withCode ? "和四位数字列" : ""}：
          </span>
          <div className="flex" style={{ marginTop: 6, flexWrap: "wrap" }}>
            <select
              className="select"
              style={{ flex: "1 1 140px" }}
              value={xlsxChoice.nameCol}
              onChange={(e) =>
                setXlsxChoice({ ...xlsxChoice, nameCol: Number(e.target.value) })
              }
            >
              {Array.from({ length: maxCol }, (_, i) => {
                const sample = extractColumn(xlsxChoice.rows, i)
                  .slice(0, 3)
                  .join("、");
                return (
                  <option key={i} value={i}>
                    姓名：第{i + 1}列{sample ? `（如：${sample}）` : ""}
                  </option>
                );
              })}
            </select>
            {withCode && (
              <select
                className="select"
                style={{ flex: "1 1 140px" }}
                value={xlsxChoice.codeCol}
                onChange={(e) =>
                  setXlsxChoice({ ...xlsxChoice, codeCol: Number(e.target.value) })
                }
              >
                <option value={-1}>四位数字：请选择</option>
                {Array.from({ length: maxCol }, (_, i) => {
                  const sample = colCells(xlsxChoice.rows, i)
                    .slice(0, 3)
                    .join("、");
                  return (
                    <option key={i} value={i}>
                      四位数字：第{i + 1}列{sample ? `（如：${sample}）` : ""}
                    </option>
                  );
                })}
              </select>
            )}
            <button type="button" className="btn btn-primary btn-sm" onClick={confirmXlsx}>
              确认导入
            </button>
          </div>
        </div>
      )}
      {busy && progress > 0 && (
        <div className="bar" style={{ marginTop: 8 }}>
          <div className="bar-fill" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

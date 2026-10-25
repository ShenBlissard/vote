const { createWorker } = require("tesseract.js");
const path = require("path");

async function main() {
  const worker = await createWorker("chi_sim", 1, {
    langPath: path.join(__dirname, "..", "public", "ocr"),
    gzip: false,
  });
  const img = process.argv[2];
  const { data } = await worker.recognize(img);
  console.log("OCR结果:", JSON.stringify(data.text));
  await worker.terminate();
}
main().catch((e) => {
  console.error("OCR失败:", e.message);
  process.exit(1);
});

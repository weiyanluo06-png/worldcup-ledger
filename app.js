// 1. 在 Google 表格里点：文件 -> 分享 -> 发布到网络。
// 2. 选择工作表，格式选择 CSV。
// 3. 把发布后的 CSV 链接粘贴到下面的引号里。
const SHEET_CSV_URL = "";

// 可选：把你的 Google 表格编辑链接粘贴到这里，页面右上角会显示“打开表格”。
const SHEET_EDIT_URL = "";

const sortSelect = document.querySelector("#sortSelect");
const recordsList = document.querySelector("#recordsList");
const recordTemplate = document.querySelector("#recordTemplate");
const statusText = document.querySelector("#statusText");
const sourceStatus = document.querySelector("#sourceStatus");
const refreshBtn = document.querySelector("#refreshBtn");
const sheetLink = document.querySelector("#sheetLink");

const totalStakeEl = document.querySelector("#totalStake");
const totalReturnEl = document.querySelector("#totalReturn");
const totalProfitEl = document.querySelector("#totalProfit");
const recordDaysEl = document.querySelector("#recordDays");

let records = [];

setupSheetLink();
sortSelect.addEventListener("change", render);
refreshBtn.addEventListener("click", loadSheetRecords);
loadSheetRecords();

async function loadSheetRecords() {
  if (!SHEET_CSV_URL) {
    records = [];
    render();
    sourceStatus.textContent = "还没有配置 Google 表格链接。请把发布后的 CSV 链接填进 app.js 的 SHEET_CSV_URL。";
    statusText.textContent = "等待配置表格。";
    return;
  }

  refreshBtn.disabled = true;
  sourceStatus.textContent = "正在读取 Google 表格...";

  try {
    const response = await fetch(cacheBustedUrl(SHEET_CSV_URL));
    if (!response.ok) {
      throw new Error(`读取失败：${response.status}`);
    }

    const csvText = await response.text();
    records = csvToRecords(csvText);
    sourceStatus.textContent = `已读取 Google 表格，更新时间：${formatDateTime(new Date())}`;
    render();
  } catch (error) {
    records = [];
    render();
    sourceStatus.textContent = "读取表格失败。请确认表格已经发布到网络，并且 CSV 链接填对了。";
    statusText.textContent = error.message || "读取失败。";
  } finally {
    refreshBtn.disabled = false;
  }
}

function render() {
  const sortedRecords = getSortedRecords(records);
  renderSummary(records);
  renderRecords(sortedRecords);
}

function renderSummary(items) {
  const totals = items.reduce(
    (sum, item) => {
      sum.stake += Number(item.stake || 0);
      sum.payout += Number(item.payout || 0);
      return sum;
    },
    { stake: 0, payout: 0 }
  );
  const profit = totals.payout - totals.stake;
  const days = new Set(items.map((item) => item.date).filter(Boolean)).size;

  totalStakeEl.textContent = money(totals.stake);
  totalReturnEl.textContent = money(totals.payout);
  totalProfitEl.textContent = signedMoney(profit);
  totalProfitEl.className = profitClass(profit);
  recordDaysEl.textContent = days;
}

function renderRecords(items) {
  recordsList.replaceChildren();

  if (!items.length) {
    statusText.textContent = SHEET_CSV_URL ? "表格里还没有可展示的记录。" : "等待配置表格。";
    const empty = document.createElement("p");
    empty.className = "subtitle";
    empty.textContent = SHEET_CSV_URL
      ? "请确认表格第一行是：日期、投入、返奖、场次、备注。"
      : "配置完成后，这里会显示所有公开记录。";
    recordsList.append(empty);
    return;
  }

  statusText.textContent = `共 ${items.length} 条记录，按当前排序展示。`;

  for (const record of items) {
    const profit = Number(record.payout || 0) - Number(record.stake || 0);
    const node = recordTemplate.content.firstElementChild.cloneNode(true);

    node.querySelector(".record-date").textContent = formatDate(record.date);
    node.querySelector(".record-date").dateTime = record.date;
    node.querySelector(".record-match").textContent = record.match || "未填写场次";
    node.querySelector(".record-profit").textContent = signedMoney(profit);
    node.querySelector(".record-profit").classList.add(profitClass(profit));
    node.querySelector(".record-stake").textContent = money(record.stake);
    node.querySelector(".record-return").textContent = money(record.payout);
    node.querySelector(".record-note").textContent = record.note;

    recordsList.append(node);
  }
}

function csvToRecords(csvText) {
  const rows = parseCsv(csvText).filter((row) => row.some((cell) => String(cell).trim()));
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeHeader);
  const dateIndex = findHeader(headers, ["日期", "date"]);
  const stakeIndex = findHeader(headers, ["投入", "投注", "本金", "stake"]);
  const payoutIndex = findHeader(headers, ["返奖", "奖金", "收入", "payout", "return"]);
  const matchIndex = findHeader(headers, ["场次", "比赛", "玩法", "match"]);
  const noteIndex = findHeader(headers, ["备注", "note"]);

  if (dateIndex < 0 || stakeIndex < 0 || payoutIndex < 0) {
    throw new Error("表格至少需要三列：日期、投入、返奖。");
  }

  return rows.slice(1).map((row, index) => ({
    id: `${row[dateIndex] || "row"}-${index}`,
    date: normalizeDate(row[dateIndex]),
    stake: parseMoney(row[stakeIndex]),
    payout: parseMoney(row[payoutIndex]),
    match: matchIndex >= 0 ? String(row[matchIndex] || "").trim() : "",
    note: noteIndex >= 0 ? String(row[noteIndex] || "").trim() : "",
  })).filter((record) => record.date);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function getSortedRecords(items) {
  return [...items].sort((a, b) => {
    const profitA = Number(a.payout || 0) - Number(a.stake || 0);
    const profitB = Number(b.payout || 0) - Number(b.stake || 0);

    if (sortSelect.value === "date-asc") return a.date.localeCompare(b.date);
    if (sortSelect.value === "profit-desc") return profitB - profitA;
    if (sortSelect.value === "profit-asc") return profitA - profitB;
    return b.date.localeCompare(a.date);
  });
}

function setupSheetLink() {
  if (!SHEET_EDIT_URL) {
    sheetLink.hidden = true;
    return;
  }

  sheetLink.href = SHEET_EDIT_URL;
}

function findHeader(headers, candidates) {
  return headers.findIndex((header) => candidates.some((candidate) => header === normalizeHeader(candidate)));
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const normalized = raw.replace(/\//g, "-").replace(/[年月]/g, "-").replace(/日/g, "");
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) return raw;

  return date.toISOString().slice(0, 10);
}

function parseMoney(value) {
  return Number(String(value || "0").replace(/[^\d.-]/g, "")) || 0;
}

function cacheBustedUrl(url) {
  const parsed = new URL(url);
  parsed.searchParams.set("_", Date.now());
  return parsed.toString();
}

function money(value) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(Number(value || 0));
}

function signedMoney(value) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${money(value)}`;
}

function profitClass(value) {
  if (value > 0) return "profit-positive";
  if (value < 0) return "profit-negative";
  return "profit-even";
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

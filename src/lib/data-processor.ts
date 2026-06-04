import * as XLSX from "xlsx";

/* ================================================================ */
/*  Types                                                           */
/* ================================================================ */
export interface RawRecord {
  year: number; yemo: number; week_of_year_BA: number;
  dept_name_2_new: string; dept_name_3_new: string; oper_name: string;
  deal_ord_original_amt: number; deal_order_cnt: number;
  store_open_cnt: number; store_sale_cnt_2: number;
  deal_plat_subsidy_amt: number; deal_sku_plat_subsidy_amt: number;
  deal_goods_coupon_plat_subsidy_amt: number;
  deal_ord_freight_plat_subsidy_amt: number;
  deal_vender_subsidy_amt: number; deal_sku_vender_subsidy_amt: number;
  deal_goods_coupon_vender_subsidy_amt: number;
  deal_ord_freight_vender_subsidy_amt: number;
  total_gmv: number; store_open_cnt_2: number; store_sale_cnt: number;
  store_open_cnt_3: number; open_store_dur: number;
  open_20h_store_cnt: number; open_store_sku_cnt: number;
  store_sale_cnt_accurate: number; deal_order_accurate: number; dt_latest: number;
}
export interface Metrics {
  total_gmv: number; deal_order_cnt: number; store_open_cnt: number;
  store_sale_cnt: number; deal_plat_subsidy_amt: number;
  deal_vender_subsidy_amt: number; open_20h_store_cnt: number;
}
export interface KPIs {
  avg_daily_gmv: number; avg_daily_orders: number; avg_order_value: number;
  avg_daily_open_stores: number; avg_daily_sale_stores: number;
  sale_rate: number; orders_per_sale_store: number;
  plat_subsidy_rate: number; vender_subsidy_rate: number; leverage_ratio: number;
}
export interface Insight {
  severity: "up" | "down" | "warn" | "info";
  icon: "trending-up" | "trending-down" | "alert-triangle" | "bar-chart";
  title: string; detail: string; metric: string; changePct: number;
}
export interface ChartPoint { week: string; [key: string]: number | string; }

/* ================================================================ */
/*  Parse                                                           */
/* ================================================================ */
export function parseExcel(data: ArrayBuffer): RawRecord[] {
  const wb = XLSX.read(data, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return (XLSX.utils.sheet_to_json(sheet, { defval: "" }) as any[]).map(normalize);
}
function nn(v: any) { return (v === "" || v === null || v === undefined ? 0 : Number(v)); }
function normalize(r: any): RawRecord {
  return {
    year: Number(r.year) || 0, yemo: Number(r.yemo) || 0,
    week_of_year_BA: Number(r.week_of_year_BA) || 0,
    dept_name_2_new: String(r.dept_name_2_new ?? ""),
    dept_name_3_new: String(r.dept_name_3_new ?? ""),
    oper_name: String(r.oper_name ?? ""),
    deal_ord_original_amt: nn(r.deal_ord_original_amt),
    deal_order_cnt: nn(r.deal_order_cnt),
    store_open_cnt: nn(r.store_open_cnt),
    store_sale_cnt_2: nn(r.store_sale_cnt_2),
    deal_plat_subsidy_amt: nn(r.deal_plat_subsidy_amt),
    deal_sku_plat_subsidy_amt: nn(r.deal_sku_plat_subsidy_amt),
    deal_goods_coupon_plat_subsidy_amt: nn(r.deal_goods_coupon_plat_subsidy_amt),
    deal_ord_freight_plat_subsidy_amt: nn(r.deal_ord_freight_plat_subsidy_amt),
    deal_vender_subsidy_amt: nn(r.deal_vender_subsidy_amt),
    deal_sku_vender_subsidy_amt: nn(r.deal_sku_vender_subsidy_amt),
    deal_goods_coupon_vender_subsidy_amt: nn(r.deal_goods_coupon_vender_subsidy_amt),
    deal_ord_freight_vender_subsidy_amt: nn(r.deal_ord_freight_vender_subsidy_amt),
    total_gmv: nn(r.total_gmv), store_open_cnt_2: nn(r.store_open_cnt_2),
    store_sale_cnt: nn(r.store_sale_cnt), store_open_cnt_3: nn(r.store_open_cnt_3),
    open_store_dur: nn(r.open_store_dur), open_20h_store_cnt: nn(r.open_20h_store_cnt),
    open_store_sku_cnt: nn(r.open_store_sku_cnt),
    store_sale_cnt_accurate: nn(r.store_sale_cnt_accurate),
    deal_order_accurate: nn(r.deal_order_accurate), dt_latest: nn(r.dt_latest),
  };
}

/* ================================================================ */
/*  Filter                                                          */
/* ================================================================ */
export function getFilterOptions(records: RawRecord[]) {
  const u = <T>(arr: T[]) => [...new Set(arr)].filter(Boolean).sort() as T[];
  return {
    years: u(records.map(r => r.year)),
    dept2: u(records.map(r => r.dept_name_2_new)),
    dept3: u(records.map(r => r.dept_name_3_new)),
    operNames: u(records.map(r => r.oper_name)),
  };
}
export function filterRecords(records: RawRecord[], f: {
  year?: number; dept2?: string; dept3?: string; operName?: string;
}): RawRecord[] {
  return records.filter(r => {
    if (f.year && r.year !== f.year) return false;
    if (f.dept2 && r.dept_name_2_new !== f.dept2) return false;
    if (f.dept3 && r.dept_name_3_new !== f.dept3) return false;
    if (f.operName && r.oper_name !== f.operName) return false;
    return true;
  });
}

/* ================================================================ */
/*  Aggregate                                                       */
/* ================================================================ */
export function aggregate(records: RawRecord[]): { metrics: Metrics; days: number; weekRange: number[] } {
  const sum = (fn: (r: RawRecord) => number) => records.reduce((a, b) => a + fn(b), 0);
  const weeks = [...new Set(records.map(r => r.week_of_year_BA))].sort((a, b) => a - b);
  return {
    metrics: {
      total_gmv: sum(r => r.total_gmv),
      deal_order_cnt: sum(r => r.deal_order_cnt),
      store_open_cnt: sum(r => r.store_open_cnt),
      store_sale_cnt: sum(r => r.store_sale_cnt),
      deal_plat_subsidy_amt: sum(r => r.deal_plat_subsidy_amt),
      deal_vender_subsidy_amt: sum(r => r.deal_vender_subsidy_amt),
      open_20h_store_cnt: sum(r => r.open_20h_store_cnt),
    },
    days: new Set(records.map(r => r.dt_latest)).size || 1,
    weekRange: weeks,
  };
}

export function computeKPIs(metrics: Metrics, days: number): KPIs {
  const avg_daily_gmv = metrics.total_gmv / days;
  const avg_daily_orders = metrics.deal_order_cnt / days;
  const avg_order_value = metrics.deal_order_cnt > 0 ? metrics.total_gmv / metrics.deal_order_cnt : 0;
  const avg_daily_open_stores = metrics.store_open_cnt / days;
  const avg_daily_sale_stores = metrics.store_sale_cnt / days;
  const sale_rate = metrics.store_open_cnt > 0 ? metrics.store_sale_cnt / metrics.store_open_cnt : 0;
  const orders_per_sale_store = metrics.store_sale_cnt > 0 ? metrics.deal_order_cnt / metrics.store_sale_cnt : 0;
  const plat_subsidy_rate = metrics.total_gmv > 0 ? metrics.deal_plat_subsidy_amt / metrics.total_gmv : 0;
  const vender_subsidy_rate = metrics.total_gmv > 0 ? metrics.deal_vender_subsidy_amt / metrics.total_gmv : 0;
  const total_subsidy = metrics.deal_plat_subsidy_amt + metrics.deal_vender_subsidy_amt;
  const leverage_ratio = total_subsidy > 0 ? metrics.total_gmv / total_subsidy : 0;
  return { avg_daily_gmv, avg_daily_orders, avg_order_value, avg_daily_open_stores, avg_daily_sale_stores, sale_rate, orders_per_sale_store, plat_subsidy_rate, vender_subsidy_rate, leverage_ratio };
}

/* ================================================================ */
/*  Weekly Trend (for charts)                                       */
/* ================================================================ */
export function getWeeklyTrend(records: RawRecord[], maxWeeks = 12): ChartPoint[] {
  const allWeeks = [...new Set(records.map(r => r.week_of_year_BA))].sort((a, b) => a - b);
  const weeks = allWeeks.slice(-maxWeeks);
  return weeks.map(w => {
    const wr = records.filter(r => r.week_of_year_BA === w);
    const { metrics, days } = aggregate(wr);
    const k = computeKPIs(metrics, days || 7);
    return {
      week: `W${w}`,
      avg_daily_gmv: Math.round(k.avg_daily_gmv * 10) / 10,
      avg_daily_orders: Math.round(k.avg_daily_orders * 10) / 10,
      avg_order_value: Math.round(k.avg_order_value * 10) / 10,
      sale_rate: Math.round(k.sale_rate * 1000) / 10,
      plat_subsidy_rate: Math.round(k.plat_subsidy_rate * 1000) / 10,
      vender_subsidy_rate: Math.round(k.vender_subsidy_rate * 1000) / 10,
      avg_daily_open_stores: Math.round(k.avg_daily_open_stores * 10) / 10,
    };
  });
}

/* ================================================================ */
/*  Anomaly Detection                                              */
/* ================================================================ */
export function detectAnomalies(records: RawRecord[]): Insight[] {
  const insights: Insight[] = [];
  const trend = getWeeklyTrend(records, 9);
  if (trend.length < 2) return insights;

  const last = trend[trend.length - 1];
  const prev = trend[trend.length - 2];

  type Check = { key: string; label: string; unit: string; threshold: number };
  const checks: Check[] = [
    { key: "avg_daily_gmv", label: "日均GMV", unit: "万元", threshold: 0.08 },
    { key: "avg_daily_orders", label: "日均订单量", unit: "单", threshold: 0.08 },
    { key: "sale_rate", label: "动销率", unit: "%", threshold: 0.05 },
    { key: "plat_subsidy_rate", label: "平台补贴率", unit: "%", threshold: 0.15 },
    { key: "vender_subsidy_rate", label: "商家补贴率", unit: "%", threshold: 0.15 },
  ];

  checks.forEach(c => {
    const cv = (last as any)[c.key] as number;
    const pv = (prev as any)[c.key] as number;
    if (pv === 0 || isNaN(cv) || isNaN(pv)) return;
    const chg = (cv - pv) / Math.abs(pv);
    if (Math.abs(chg) < c.threshold) return;
    const dir = chg > 0 ? "up" : "down";
    insights.push({
      severity: dir,
      icon: dir === "up" ? "trending-up" : "trending-down",
      title: `${c.label} ${chg > 0 ? "上涨" : "下降"} ${Math.abs(chg * 100).toFixed(1)}%`,
      detail: `W${last.week} ${cv.toFixed(1)}${c.unit} vs 上周 ${pv.toFixed(1)}${c.unit}，周环比 ${(chg * 100).toFixed(1)}%`,
      metric: c.key,
      changePct: Math.round(chg * 1000) / 10,
    });
  });

  // Year-over-year on GMV
  const thisYear = records.filter(r => r.year === 2026);
  const lastYear = records.filter(r => r.year === 2025);
  if (thisYear.length > 0 && lastYear.length > 0) {
    const tyKpi = computeKPIs(aggregate(thisYear).metrics, aggregate(thisYear).days || 1);
    const lyKpi = computeKPIs(aggregate(lastYear).metrics, aggregate(lastYear).days || 1);
    const yoyChg = lyKpi.avg_daily_gmv > 0 ? (tyKpi.avg_daily_gmv - lyKpi.avg_daily_gmv) / lyKpi.avg_daily_gmv : 0;
    insights.push({
      severity: yoyChg > 0.05 ? "up" : yoyChg < -0.05 ? "warn" : "info",
      icon: "bar-chart",
      title: `日均GMV 年同比 ${yoyChg > 0 ? "+" : ""}${(yoyChg * 100).toFixed(1)}%`,
      detail: `2026 日均GMV ${tyKpi.avg_daily_gmv.toFixed(1)}万元 vs 2025 同期 ${lyKpi.avg_daily_gmv.toFixed(1)}万元`,
      metric: "avg_daily_gmv",
      changePct: Math.round(yoyChg * 1000) / 10,
    });
  }
  return insights;
}

/* ================================================================ */
/*  Insights Summary                                               */
/* ================================================================ */
export function generateInsights(records: RawRecord[]): { summary: string; highlights: string[] } {
  const anomalies = detectAnomalies(records);
  const kpis = computeKPIs(aggregate(records).metrics, aggregate(records).days);
  const highlights: string[] = [];
  if (kpis.sale_rate < 0.2) highlights.push(`动销率仅 ${(kpis.sale_rate * 100).toFixed(1)}%，门店活跃度偏低，建议加强动销运营。`);
  if (kpis.plat_subsidy_rate > 0.08) highlights.push(`平台补贴率 ${(kpis.plat_subsidy_rate * 100).toFixed(2)}%，补贴效率需关注，建议优化补贴精准度。`);
  if (kpis.avg_order_value < 40) highlights.push(`单均价 ${kpis.avg_order_value.toFixed(1)}元，客单价有提升空间。`);
  if (kpis.leverage_ratio > 20) highlights.push(`平商撬动比 ${kpis.leverage_ratio.toFixed(1)}，补贴效率良好。`);
  if (anomalies.length === 0) highlights.push("近期各项指标平稳，无明显异动。");
  const upCount = anomalies.filter(a => a.severity === "up").length;
  const downCount = anomalies.filter(a => a.severity === "down" || a.severity === "warn").length;
  const summary = anomalies.length > 0
    ? `监测到 ${anomalies.length} 项异动：${upCount} 项正向提升，${downCount} 项需关注。建议重点查看趋势分析视图。`
    : "近期各项指标平稳，未检测到显著异动。";
  return { summary, highlights };
}

/* ================================================================ */
/*  Group & Compare                                               */
/* ================================================================ */
export function groupAndAggregate(records: RawRecord[], groupKey: "dept_name_3_new" | "oper_name"): { name: string; metrics: Metrics; days: number }[] {
  const groups = new Map<string, RawRecord[]>();
  records.forEach(r => {
    const key = String(r[groupKey] ?? "其他");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  });
  const result: { name: string; metrics: Metrics; days: number }[] = [];
  groups.forEach((recs, name) => result.push({ name, ...aggregate(recs) }));
  return result.sort((a, b) => {
    const na = parseFloat(a.name), nb = parseFloat(b.name);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.name.localeCompare(b.name, "zh");
  });
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseExcel, getFilterOptions, filterRecords, aggregate, computeKPIs,
  getWeeklyTrend, detectAnomalies, generateInsights, groupAndAggregate,
  type RawRecord, type Insight,
} from "@/lib/data-processor";
import {
  TrendingUp, TrendingDown, AlertTriangle, BarChart3, Upload,
  Filter, ChevronDown, Activity, Zap, Target, DollarSign,
} from "lucide-react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart,
} from "recharts";

/* ================================================================ */
/*  Constants                                                       */
/* ================================================================ */
const KPI_META: Record<string, { label: string; unit: string; fmt: (v: number) => string; icon: typeof Activity }> = {
  avg_daily_gmv:        { label: "日均成交金额",  unit: "万",  fmt: v => v.toFixed(1),   icon: DollarSign },
  avg_daily_orders:     { label: "日均订单量",    unit: "单",  fmt: v => v.toFixed(0),   icon: Target },
  avg_order_value:      { label: "单均价",        unit: "元",  fmt: v => v.toFixed(1),   icon: Activity },
  avg_daily_open_stores:{ label: "日均营业门店",  unit: "家",  fmt: v => v.toFixed(0),   icon: BarChart3 },
  avg_daily_sale_stores:{ label: "日均动销门店",  unit: "家",  fmt: v => v.toFixed(0),   icon: BarChart3 },
  sale_rate:            { label: "动销率",        unit: "%",  fmt: v => (v*100).toFixed(1), icon: Target },
  orders_per_sale_store:{ label: "店均单量",      unit: "单",  fmt: v => v.toFixed(1),   icon: Zap },
  plat_subsidy_rate:    { label: "平台补贴率",    unit: "%",  fmt: v => (v*100).toFixed(2), icon: TrendingDown },
  vender_subsidy_rate:  { label: "商家补贴率",    unit: "%",  fmt: v => (v*100).toFixed(2), icon: TrendingDown },
  leverage_ratio:       { label: "平商撬动比",    unit: "",   fmt: v => v.toFixed(1),   icon: Activity },
};

const CHART_COLORS = {
  gmv: "#8b5cf6", orders: "#0ea5e9", plat: "#f97316", vender: "#ef4444",
  sale: "#10b981", aov: "#f59e0b", grid: "rgba(255,255,255,0.04)",
  tooltip: "rgba(15,23,42,0.95)",
};

/* ================================================================ */
/*  Mini Sparkline (pure SVG)                                       */
/* ================================================================ */
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 80, h = 28, pad = 2;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  if (data.every(v => v === data[0])) return <div className="w-20 h-7 shrink-0" />;
  const points = data.map((v, i) =>
    `${pad + i * ((w - pad * 2) / (data.length - 1 || 1))},${h - pad - ((v - min) / range) * (h - pad * 2)}`
  ).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-20 h-7 shrink-0 opacity-70">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  );
}

/* ================================================================ */
/*  Dashboard Component                                             */
/* ================================================================ */
export default function DashboardPage() {
  const [records, setRecords] = useState<RawRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [year, setYear] = useState<number>(0);
  const [dept2, setDept2] = useState("");
  const [dept3, setDept3] = useState("");
  const [operName, setOperName] = useState("");

  useEffect(() => {
    fetch("/源数据.xlsx")
      .then(res => { if (!res.ok) throw new Error(""); return res.arrayBuffer(); })
      .then(buf => setRecords(parseExcel(buf)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const opts = useMemo(() => getFilterOptions(records), [records]);
  const filtered = useMemo(
    () => filterRecords(records, { year: year || undefined, dept2: dept2 || undefined, dept3: dept3 || undefined, operName: operName || undefined }),
    [records, year, dept2, dept3, operName],
  );
  const { metrics, days, weekRange } = useMemo(() => aggregate(filtered), [filtered]);
  const kpis = useMemo(() => computeKPIs(metrics, days || 1), [metrics, days]);
  const trend = useMemo(() => getWeeklyTrend(filtered, 12), [filtered]);
  const anomalies = useMemo(() => detectAnomalies(filtered), [filtered]);
  const insights = useMemo(() => generateInsights(filtered), [filtered]);

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setLoading(true);
    const reader = new FileReader();
    reader.onload = ev => {
      try { setRecords(parseExcel(ev.target!.result as ArrayBuffer)); } catch {}
      setLoading(false);
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const sectionTitle = "text-xs font-medium uppercase tracking-[0.15em] text-zinc-500 mb-4";
  const card = "glass rounded-xl p-5";

  /* =========================== Empty ============================ */
  if (!loading && records.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="flex flex-col items-center gap-6 text-center max-w-sm">
          <div className="size-20 rounded-2xl bg-gradient-to-br from-violet-500 to-sky-500 flex items-center justify-center shadow-xl shadow-violet-500/20">
            <BarChart3 className="size-10 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">秒送药店 · 商运业绩看板</h1>
            <p className="text-sm text-zinc-500 mt-2">上传源数据 Excel 以开始分析</p>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn-primary px-6 py-2.5 rounded-xl text-white text-sm font-medium inline-flex items-center gap-2"
          >
            <Upload className="size-4" /> 上传 Excel 文件
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />
        </div>
      </div>
    );
  }

  /* =========================== Render =========================== */
  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto w-full space-y-8">

      {/* ────── HEADER & FILTERS ────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">秒送药店 · 商运业绩追踪</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {records.length} 条记录 · W{weekRange[0]}–W{weekRange[weekRange.length - 1]} · 覆盖 {days} 天 · 筛选后 {filtered.length} 条
          </p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg glass-strong text-sm text-zinc-300 hover:text-white transition-colors"
        >
          <Upload className="size-3.5" /> 上传数据
        </button>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="size-3.5 text-zinc-600 shrink-0" />
        {[
          { val: year, set: setYear, opts: [{ v: 0, l: "全部年份" }, ...opts.years.map(y => ({ v: y, l: `${y}年` }))] },
          { val: dept2, set: setDept2, opts: [{ v: "", l: "全部二级部门" }, ...opts.dept2.map(d => ({ v: d, l: d }))] },
          { val: dept3, set: setDept3, opts: [{ v: "", l: "全部三级部门" }, ...opts.dept3.map(d => ({ v: d, l: d }))] },
          { val: operName, set: setOperName, opts: [{ v: "", l: "全部运营" }, ...opts.operNames.map(n => ({ v: n, l: n }))] },
        ].map(({ val, set, opts: o }) => (
          <div key={o[0].l} className="relative">
            <select
              value={val}
              onChange={e => (set as any)(typeof val === "number" ? Number(e.target.value) : e.target.value)}
              className="appearance-none bg-slate-900/50 border border-slate-700/60 rounded-lg px-3 py-2 pr-8 text-sm text-zinc-300 focus:border-violet-500/50 focus:outline-none transition-colors"
            >
              {o.map(opt => <option key={String(opt.v)} value={opt.v} className="bg-slate-900">{opt.l}</option>)}
            </select>
            <ChevronDown className="size-3 absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
          </div>
        ))}
      </div>

      {/* ────── KPI CARDS ────── */}
      <section>
        <h2 className={sectionTitle}>核心指标总览</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {["avg_daily_gmv", "avg_daily_orders", "avg_order_value", "sale_rate", "leverage_ratio"].map(key => {
            const meta = KPI_META[key]; if (!meta) return null;
            const val = (kpis as any)[key] ?? 0;
            const Icon = meta.icon;
            const sparkData = (key === "leverage_ratio") ? [] : trend.map(t => (t as any)[key] ?? 0).filter((v: number) => !isNaN(v));
            const prevVal = sparkData.length > 1 ? sparkData[sparkData.length - 2] : val;
            const wowChg = prevVal ? ((val - prevVal) / Math.abs(prevVal)) * 100 : 0;
            return (
              <div key={key} className="glass rounded-xl p-4 hover:border-slate-600/30 transition-all duration-300">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon className="size-3.5 text-violet-400" />
                    <span className="text-xs text-zinc-500">{meta.label}</span>
                  </div>
                  {sparkData.length > 0 && <Sparkline data={sparkData} color={key === "avg_daily_gmv" ? "#8b5cf6" : "#0ea5e9"} />}
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-semibold tabular-nums tracking-tight">{meta.fmt(val)}</span>
                  <span className="text-xs text-zinc-500">{meta.unit}</span>
                </div>
                {Math.abs(wowChg) > 0.5 && (
                  <div className={`mt-1.5 text-xs inline-flex items-center gap-1 ${wowChg > 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {wowChg > 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                    周环比 {wowChg > 0 ? "+" : ""}{wowChg.toFixed(1)}%
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ────── TREND CHARTS ────── */}
      <section>
        <h2 className={sectionTitle}>趋势分析</h2>
        {trend.length < 2 ? (
          <p className="text-sm text-zinc-600 py-8 text-center">数据不足，需至少 2 周数据</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={`${card} lg:col-span-2`}>
              <h3 className="text-sm font-medium text-zinc-400 mb-4">GMV & 订单量 周趋势</h3>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={trend}>
                  <defs>
                    <linearGradient id="gmvGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.25} /><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} /></linearGradient>
                    <linearGradient id="orderGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.2} /><stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: CHART_COLORS.tooltip, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 13, color: "#e4e4e7" }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }} />
                  <Area yAxisId="left" type="monotone" dataKey="avg_daily_gmv" name="日均GMV(万元)" stroke="#8b5cf6" fill="url(#gmvGrad)" strokeWidth={2} />
                  <Area yAxisId="right" type="monotone" dataKey="avg_daily_orders" name="日均订单量(单)" stroke="#0ea5e9" fill="url(#orderGrad)" strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className={card}>
              <h3 className="text-sm font-medium text-zinc-400 mb-4">补贴率 周趋势 (%)</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={trend} barGap={2}>
                  <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                  <Tooltip contentStyle={{ backgroundColor: CHART_COLORS.tooltip, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 13, color: "#e4e4e7" }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }} />
                  <Bar dataKey="plat_subsidy_rate" name="平台补贴率" fill="#f97316" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="vender_subsidy_rate" name="商家补贴率" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className={card}>
              <h3 className="text-sm font-medium text-zinc-400 mb-4">动销率 & 单均价 周趋势</h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={trend}>
                  <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: CHART_COLORS.tooltip, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 13, color: "#e4e4e7" }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }} />
                  <Line yAxisId="left" type="monotone" dataKey="sale_rate" name="动销率(%)" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: "#10b981" }} />
                  <Line yAxisId="right" type="monotone" dataKey="avg_order_value" name="单均价(元)" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: "#f59e0b" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </section>

      {/* ────── ANOMALIES & INSIGHTS ────── */}
      <section>
        <h2 className={sectionTitle}>异动检测 & 分析结论</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className={`${card} lg:col-span-2`}>
            <h3 className="text-sm font-medium text-zinc-400 mb-3">周度异动监测</h3>
            {anomalies.length === 0 ? (
              <p className="text-sm text-zinc-600 py-4">近期指标平稳，无显著异动</p>
            ) : (
              <div className="space-y-2">
                {anomalies.map((a, i) => {
                  const icoMap: Record<Insight["icon"], typeof TrendingUp> = {
                    "trending-up": TrendingUp, "trending-down": TrendingDown,
                    "alert-triangle": AlertTriangle, "bar-chart": BarChart3,
                  };
                  const Ico = icoMap[a.icon];
                  return (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-slate-900/40 border border-slate-800/60">
                      <div className={`mt-0.5 shrink-0 ${a.severity === "up" ? "text-emerald-400" : a.severity === "down" ? "text-red-400" : a.severity === "warn" ? "text-amber-400" : "text-sky-400"}`}>
                        <Ico className="size-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{a.title}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">{a.detail}</p>
                      </div>
                      <span className={`shrink-0 text-xs font-mono tabular-nums px-2 py-0.5 rounded-full ${a.changePct > 0 ? "text-emerald-400 bg-emerald-400/10" : "text-red-400 bg-red-400/10"}`}>
                        {a.changePct > 0 ? "+" : ""}{a.changePct}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className={card}>
            <h3 className="text-sm font-medium text-zinc-400 mb-3">分析结论</h3>
            <p className="text-sm text-zinc-300 leading-relaxed mb-4">{insights.summary}</p>
            {insights.highlights.length > 0 && (
              <div className="space-y-2">
                {insights.highlights.map((h, i) => (
                  <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-900/40">
                    <AlertTriangle className="size-3.5 shrink-0 mt-px text-amber-400" />
                    <p className="text-xs text-zinc-400 leading-relaxed">{h}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ────── COMPARE ────── */}
      <section>
        <h2 className={sectionTitle}>对比分析</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={card}>
            <h3 className="text-sm font-medium text-zinc-400 mb-4">按三级部门 · 日均GMV (万元)</h3>
            {(() => {
              const groups = groupAndAggregate(filtered, "dept_name_3_new").filter(g => g.name && g.name !== "");
              const data = groups.map(g => ({
                name: g.name.length > 6 ? g.name.slice(0, 6) + "…" : g.name,
                fullName: g.name,
                gmv: Math.round(computeKPIs(g.metrics, g.days || 1).avg_daily_gmv * 10) / 10,
              })).sort((a, b) => b.gmv - a.gmv);
              return (
                <ResponsiveContainer width="100%" height={Math.max(180, data.length * 36)}>
                  <BarChart data={data} layout="vertical" margin={{ left: 10, right: 10 }}>
                    <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#a1a1aa" }} axisLine={false} tickLine={false} width={70} />
                    <Tooltip contentStyle={{ backgroundColor: CHART_COLORS.tooltip, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 13, color: "#e4e4e7" }} />
                    <Bar dataKey="gmv" radius={[0, 4, 4, 0]} fill="#8b5cf6" />
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </div>
          <div className={card}>
            <h3 className="text-sm font-medium text-zinc-400 mb-4">按运营 TOP15 · 日均GMV (万元)</h3>
            {(() => {
              const groups = groupAndAggregate(filtered, "oper_name").filter(g => g.name);
              const data = groups.map(g => ({
                name: g.name,
                gmv: Math.round(computeKPIs(g.metrics, g.days || 1).avg_daily_gmv * 10) / 10,
              })).sort((a, b) => b.gmv - a.gmv).slice(0, 15);
              return (
                <ResponsiveContainer width="100%" height={Math.max(180, data.length * 28)}>
                  <BarChart data={data} layout="vertical" margin={{ left: 10, right: 10 }}>
                    <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#a1a1aa" }} axisLine={false} tickLine={false} width={60} />
                    <Tooltip contentStyle={{ backgroundColor: CHART_COLORS.tooltip, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 13, color: "#e4e4e7" }} />
                    <Bar dataKey="gmv" radius={[0, 4, 4, 0]} fill="#0ea5e9" />
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </div>
        </div>
      </section>

      {/* ────── DETAIL TABLE ────── */}
      <section>
        <h2 className={sectionTitle}>运营明细</h2>
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800/60 text-xs text-zinc-500">
                <th className="text-left py-3 pr-4 font-medium">运营</th>
                <th className="text-left py-3 pr-4 font-medium">三级部门</th>
                <th className="text-right py-3 pr-4 font-medium">日均GMV(万)</th>
                <th className="text-right py-3 pr-4 font-medium">日均订单</th>
                <th className="text-right py-3 pr-4 font-medium">单均价(元)</th>
                <th className="text-right py-3 pr-4 font-medium">动销率</th>
                <th className="text-right py-3 pr-4 font-medium">平台补贴率</th>
                <th className="text-right py-3 pr-4 font-medium">商家补贴率</th>
                <th className="text-right py-3 font-medium">撬动比</th>
              </tr>
            </thead>
            <tbody>
              {groupAndAggregate(filtered, "oper_name").filter(g => g.name).sort((a, b) => {
                const ak = computeKPIs(a.metrics, a.days || 1);
                const bk = computeKPIs(b.metrics, b.days || 1);
                return bk.avg_daily_gmv - ak.avg_daily_gmv;
              }).map(g => {
                const k = computeKPIs(g.metrics, g.days || 1);
                const samples = filtered.filter(r => r.oper_name === g.name);
                const depts = [...new Set(samples.map(r => r.dept_name_3_new))].join(", ");
                return (
                  <tr key={g.name} className="border-b border-slate-800/40 hover:bg-slate-900/30 transition-colors">
                    <td className="py-2.5 pr-4 font-medium tabular-nums">{g.name}</td>
                    <td className="py-2.5 pr-4 text-zinc-500 text-xs">{depts || "-"}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{k.avg_daily_gmv.toFixed(1)}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{k.avg_daily_orders.toFixed(0)}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{k.avg_order_value.toFixed(1)}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{(k.sale_rate * 100).toFixed(1)}%</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{(k.plat_subsidy_rate * 100).toFixed(2)}%</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{(k.vender_subsidy_rate * 100).toFixed(2)}%</td>
                    <td className="py-2.5 text-right tabular-nums">{k.leverage_ratio.toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

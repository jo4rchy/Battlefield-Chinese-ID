import React, { useEffect, useMemo, useState } from "react";
import RuntimeTimer from "./RuntimeTimer";

// --- Helpers ---------------------------------------------------------------
const GAMES = [
  { key: "bf4", name: "战地4 (BF4)", file: "/data/bf4.txt", note: "" },
  { key: "bf1", name: "战地1 (BF1)", file: "/data/bf1.txt", note: "" },
  { key: "bf5", name: "战地5 (BFV)", file: "/data/bf5.txt", note: "" },
  { key: "bf2042", name: "战地2042 (BF2042)", file: "/data/bf2042.txt", note: "" },
  { key: "bf6", name: "战地6 (BF6)", file: "/data/bf6.txt", note: "" },
];

const API_BASE = ["http://localhost:8001/api/v1/calid/"];

function classNames(...xs) { return xs.filter(Boolean).join(" "); }

function parseTable(text) {
  // 行格式：HEX\t中文文本
  const rows = [];
  text.split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t) return;
    const [hex, ...rest] = t.split(/\t+/);
    if (!hex || rest.length === 0) return;
    const value = rest.join(" ").trim();
    rows.push({ hex: hex.trim(), text: value });
  });
  return rows;
}

function useOpenCCForBF1nBF4() {
  const [convert, setConvert] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const mod = await import(
         /* webpackIgnore: true */
          "https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/esm/cn2t.js"
        );
       // opencc-js 的 API：创建转换器，然后直接同步转换字符串
        const converter = mod.Converter({ from: "cn", to: "t" });
       // 统一成 Promise 接口，便于你现有的 await 调用
        setConvert(() => (s) => Promise.resolve(converter(String(s || ""))));
        setReady(true);
      } catch (e) {
        console.warn("OpenCC 加载失败，BF1 简繁检索将降级为普通搜索", e);
        setConvert(null);
        setReady(false);
      }
    })();
    return () => { aborted = true; };
  }, []);
  return { convert, ready };
}

// --- Main Component --------------------------------------------------------
export default function App() {
  const [activeGame, setActiveGame] = useState(GAMES[3].key);
  const [tables, setTables] = useState({}); // { bf1: [{hex,text}], ... }
  const [loading, setLoading] = useState({});
  const [error, setError] = useState({});
  const [copied, setCopied] = useState(null);

  const [init, setInit] = useState("");     // prefix up to 7 chars
  const [target, setTarget] = useState(""); // uppercase hex
  const [clan, setClan] = useState("");     // optional
  const [calcRes, setCalcRes] = useState(null);
  const [calcBusy, setCalcBusy] = useState(false);

  const [search, setSearch] = useState("");
  const { convert: s2t, ready: openccReady } = useOpenCCForBF1nBF4();

  // Load tables when switching tabs
  useEffect(() => {
    const game = GAMES.find((g) => g.key === activeGame);
    if (!game) return;
    if (tables[game.key] || loading[game.key]) return;

    setLoading((m) => ({ ...m, [game.key]: true }));
    fetch(game.file)
      .then((r) => {
        if (!r.ok) throw new Error(`${game.file} 加载失败：${r.status}`);
        return r.text();
      })
      .then((text) => {
        const rows = parseTable(text);
        setTables((m) => ({ ...m, [game.key]: rows }));
        setError((m) => ({ ...m, [game.key]: null }));
      })
      .catch((e) => setError((m) => ({ ...m, [game.key]: String(e) })))
      .finally(() => setLoading((m) => ({ ...m, [game.key]: false })));
  }, [activeGame]);

  // Filter logic (BF1/BF4: 简体输入 -> 繁体匹配)
  const [convertedQuery, setConvertedQuery] = useState("");
  useEffect(() => {
    (async () => {
      if ((activeGame === "bf1" || activeGame === "bf4") && s2t && search) {
        try {
          const t = await s2t(search);
          setConvertedQuery(t);
        } catch {
          setConvertedQuery("");
        }
      } else {
        setConvertedQuery("");
      }
    })();
  }, [search, activeGame, s2t]);

  const filteredRows = useMemo(() => {
    const rows = tables[activeGame] || [];
    if (!search) return rows;
    const q = search.trim().toLowerCase();
    const qHant = (activeGame === "bf1" || activeGame === "bf4") && convertedQuery ? convertedQuery.trim() : null;
    return rows.filter(({ hex, text }) => {
      const hexHit = hex.toLowerCase().includes(q);
      if (activeGame === "bf1" || activeGame === "bf4") {
        const textLC = text.toLowerCase();
        return (
          hexHit ||
          textLC.includes(q) ||
          (qHant ? textLC.includes(qHant.toLowerCase()) : false)
        );
      }
      return hexHit || text.toLowerCase().includes(q);
    });
  }, [tables, activeGame, search, convertedQuery]);

  // Pagination (client-side)
  const [page, setPage] = useState(1);
  const pageSize = 200; // 每页显示 200 条
  useEffect(() => { setPage(1); }, [activeGame, search]);
  const pageCount = Math.max(1, Math.ceil((filteredRows?.length || 0) / pageSize));
  const pageRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  // Handlers
  const onTargetChange = (v) => {
    const cleaned = v.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
    setTarget(cleaned);
  };

  const applyHex = (hex) => {
    const cleaned = (hex || "").toString().replace(/[^0-9a-fA-F]/g, "").toUpperCase();
    setTarget(cleaned);
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (_) {}
  };

  // === Debug-capable doCalc ===
  const DEBUG = true; // 需要时改为 false 可关闭调试打印

  const doCalc = async () => {
    setCalcRes(null);

    if (!target) {
      alert("请输入 target（十六进制哈希值）");
      return;
    }
    if (!/^[0-9A-F]+$/.test(target)) {
      alert("target 需为纯十六进制且大写，例如 00B91163");
      return;
    }
    if (init.length > 8 || !/^[A-Za-z0-9_-]*$/.test(init)) {
      alert("init 仅允许字母/数字/下划线/中横线，且最长 8 位");
      return;
    }

    try {
      setCalcBusy(true);
      const url = new URL(API_BASE);
      url.searchParams.set("init", init || "");
      url.searchParams.set("target", target);
      if (activeGame !== "bf2042") {
        url.searchParams.set("clan", clan || ""); // 避免传 null
      }

      if (DEBUG) {
        console.group("[CALID] 请求");
        console.time("[CALID] 耗时");
        console.log("GET", url.toString());
      }

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      const contentType = (res.headers.get("content-type") || "").toLowerCase();

      if (DEBUG) {
        console.log("收到响应:", {
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          contentType,
        });
      }

      // 读取原始文本，方便观察 server 实际返回
      const text = await res.text();
      if (DEBUG) console.log("原始文本 body:", text.slice(0, 1000));

      let body;
      try {
        // 尝试 JSON.parse（即使是 text/plain 也能 parse 成对象）
        body = JSON.parse(text);
        if (DEBUG) console.log("JSON 解析成功:", body);
      } catch (e) {
        body = { raw: text };
        if (DEBUG) console.warn("JSON 解析失败，保留原始文本。错误：", e);
      }

      if (!res.ok) {
        setCalcRes({
          ok: false,
          data: {
            status: res.status,
            statusText: res.statusText,
            contentType,
            body,
          },
        });
      } else {
        setCalcRes({ ok: true, data: body });
      }

      if (DEBUG) {
        console.timeEnd("[CALID] 耗时");
        console.groupEnd();
      }
    } catch (e) {
      if (DEBUG) console.error("请求异常:", e);
      setCalcRes({
        ok: false,
        data: {
          error: String(e),
          hint: "若是 Failed to fetch，多半为 CORS/网络问题；可用 Vite 代理或服务端开启 CORS。",
        },
      });
    } finally {
      setCalcBusy(false);
    }
  };

  const activeMeta = GAMES.find((g) => g.key === activeGame);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Battlefield 中文 ID 计算器</h1>
          <p className="text-sm text-slate-600">支持 战地4 / 战地1 / 战地5 / 战地2042 / 战地6。每个游戏有独立哈希表；BF1/BF4 支持“简体输入→繁体检索”。</p>
          <p className="text-sm text-slate-600">
            B站关注我 <a href="https://space.bilibili.com/35670010" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">很大的小棒槌</a> ，BFV曾经CN TOP10， BF2042目前CN TOP10。
          </p>
          <p className="text-sm text-slate-600">
            一键加入 <a href="https://qm.qq.com/q/qh6htZCv3c" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">战地开黑交流群</a>
          </p>


          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-medium mb-1">自定义前缀（可为空，最多 8 位）</label>
              <input
                value={init}
                onChange={(e) => {
                  const raw = e.target.value;
                  // 只保留 A-Z a-z 0-9 _ -
                  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 8);
                  setInit(cleaned);
                }}
                placeholder="例如：BilITV-"
                className="border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 max-w-[200px] w-full"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">目标哈希值（十六进制）</label>
              <input
                value={target}
                onChange={(e) => onTargetChange(e.target.value)}
                placeholder="例如：00B91163"
                className="border rounded-xl px-3 py-2 tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 max-w-[200px] w-full"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">代表战排（可为空）</label>
              <input
                value={clan}
                onChange={(e) => {
                  if (activeGame === "bf2042" || activeGame === "bf6") return;
                  const raw = e.target.value;
                  // 只保留 A-Z a-z 0-9 _ -
                  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 4);
                  setClan(cleaned);
                }}
                placeholder={
                  activeGame === "bf2042" || activeGame === "bf6" ? "战地2042/6不支持战排" : "输入你要代表的战排"
                }
                maxLength={activeGame === "bf2042" || activeGame === "bf6" ? undefined : 4}
                disabled={activeGame === "bf2042" || activeGame === "bf6"}
                className="border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 max-w-[200px] w-full disabled:opacity-50 disabled:cursor-not-allowed"
                aria-disabled={activeGame === "bf2042" || activeGame === "bf6"}
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={doCalc}
                disabled={calcBusy}
                className={classNames(
                  "h-10 rounded-xl px-4 font-medium",
                  calcBusy ? "bg-indigo-300" : "bg-indigo-600 hover:bg-indigo-700 text-white"
                )}
              >
                计算
              </button>

              {/* <select
                value={activeGame}
                onChange={(e) => setActiveGame(e.target.value)}
                className="h-10 rounded-xl border px-2"
              >
                {GAMES.map((g) => (
                  <option key={g.key} value={g.key}>{g.name}</option>
                ))}
              </select> */}
            </div>
          </div>

          {calcRes && (
            <div className={classNames(
              "rounded-2xl border p-3",
              calcRes.ok ? "border-emerald-300 bg-emerald-50" : "border-rose-300 bg-rose-50"
            )}>
              <div className="text-sm font-medium mb-2">计算结果，将EA ID修改成以下任意ID即可</div>
              {calcRes.ok ? (
                <div className="w-full">
                  <div className="text-xs text-slate-600 mb-2">可用中文ID：</div>
                  {(activeGame === "bf1") && (
                    <div className="text-sm text-amber-700 mb-2">
                      注意：战地1（BF1）能否使用中文ID请参阅具体服务器规定。
                    </div>
                  )}
                  {(activeGame === "bf5") && (
                    <div className="text-sm text-amber-700 mb-2">
                      注意：战地5（BFV）社区机器人将中文ID判定为违规，请谨慎使用！！！
                    </div>
                  )}
                  {(activeGame === "bf6") && (
                    <>
                      <div className="text-sm text-amber-700 mb-2">
                        注意：战地6（BF6）建议通过Steam登陆来展示个性化中文ID。
                      </div>
                      <div className="text-sm text-amber-700 mb-2">
                        此方法仅适用于EA购买/启动游戏的玩家。
                      </div>
                    </>
                  )}
                  {Array.isArray(calcRes.data?.result) ? (
                    <div className="max-h-64 overflow-auto space-y-2">
                      {calcRes.data.result.map((id, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2"
                        >
                          <code className="font-mono text-sm break-words">{String(id)}</code>
                          <button
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(String(id));
                                setCopied(i);
                                setTimeout(() => setCopied(null), 1200);
                              } catch (_) {}
                            }}
                            className="shrink-0 rounded-md border px-2 py-1 text-xs bg-slate-50 hover:bg-slate-100"
                            title="复制此 ID"
                          >
                            {copied === i ? "已复制" : "复制"}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2">
                      <span className="font-mono text-lg break-words">
                        {String(calcRes.data?.result ?? "")}
                      </span>
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(String(calcRes.data?.result ?? ""));
                            setCopied("single");
                            setTimeout(() => setCopied(null), 1200);
                          } catch (_) {}
                        }}
                        className="shrink-0 rounded-md border px-2 py-1 text-xs bg-slate-50 hover:bg-slate-100"
                        title="复制"
                      >
                        {copied === "single" ? "已复制" : "复制"}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-rose-700">
                  请求失败：
                  {String(
                    (calcRes.data && (calcRes.data.error || calcRes.data.statusText)) ||
                    "未知错误"
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pb-24 pt-4">
        {/* Tabs */}
        <div className="flex gap-2 mb-3">
          {GAMES.map((g) => (
            <button
              key={g.key}
              onClick={() => setActiveGame(g.key)}
              className={classNames(
                "rounded-2xl px-4 py-2 border text-sm",
                activeGame === g.key ? "bg-indigo-600 text-white border-indigo-600" : "bg-white hover:bg-slate-100"
              )}
            >
              {g.name} <span className="opacity-70">{g.note}</span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 HEX 或中文…（BF1/BF4 支持简体→繁体匹配）"
            className="flex-1 border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {(activeGame === "bf1" || activeGame === "bf4") && (
            <div className="text-xs text-slate-600">
              简繁转换：{openccReady ? <span className="text-emerald-600">已启用</span> : <span className="text-amber-600">未启用（降级为普通搜索）</span>}
            </div>
          )}
        </div>

        {/* Table */}
        <div className="rounded-2xl border overflow-hidden bg-white">
          <div className="grid grid-cols-12 px-3 py-2 text-xs font-semibold bg-slate-50 border-b">
            <div className="col-span-3">HEX</div>
            <div className="col-span-8">中文文本</div>
            <div className="col-span-1 text-right">操作</div>
          </div>

          {loading[activeGame] && (
            <div className="p-6 text-sm text-slate-600">正在加载 {activeMeta?.name} 哈希表…</div>
          )}

          {error[activeGame] && (
            <div className="p-6 text-sm text-rose-600">加载失败：{error[activeGame]}</div>
          )}

          {!loading[activeGame] && !error[activeGame] && (
            <div className="max-h-[60vh] overflow-auto divide-y">
              {pageRows.map((r, i) => (
                <div key={`${r.hex}-${i}`} className="grid grid-cols-12 px-3 py-2 text-sm items-center">
                  <div className="col-span-3 font-mono text-slate-700">{r.hex}</div>
                  <div className="col-span-8 whitespace-pre-wrap break-words">{r.text}</div>
                  <div className="col-span-1 text-right">
                    <button
                      onClick={() => applyHex(r.hex)}
                      className="px-2 py-1 text-xs rounded-lg border bg-white hover:bg-slate-50"
                    >
                      应用
                    </button>
                  </div>
                </div>
              ))}
              {filteredRows.length === 0 && (
                <div className="p-6 text-sm text-slate-500">没有匹配的结果。</div>
              )}
            </div>
          )}
        </div>

        {/* 选页 */}
        <div className="mt-3 flex items-center justify-between text-sm">
          <div>共 <b>{filteredRows.length}</b> 条；第 <b>{page}</b>/<b>{pageCount}</b> 页</div>
          <div className="flex gap-2">
            <button onClick={() => setPage(1)} disabled={page === 1}
                    className="px-3 py-1 rounded-lg border bg-white disabled:opacity-40">« 首页</button>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                    className="px-3 py-1 rounded-lg border bg-white disabled:opacity-40">‹ 上一页</button>
            <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page === pageCount}
                    className="px-3 py-1 rounded-lg border bg-white disabled:opacity-40">下一页 ›</button>
            <button onClick={() => setPage(pageCount)} disabled={page === pageCount}
                    className="px-3 py-1 rounded-lg border bg-white disabled:opacity-40">末页 »</button>
          </div>
        </div>

        {/* GitHub Link */}
        <div className="mt-6 text-xs text-slate-500">
          <li>由 <a href="https://github.com/jo4rchy" className="underline">jo4rchy</a> 协助ChatGPT制作。项目开源，欢迎在 <a href="https://github.com/jo4rchy/Battlefield-Chinese-ID" className="underline">GitHub</a> 上贡献代码。</li>
          <li>关注 <a href="https://space.bilibili.com/35670010" className="underline">我的Bilibili</a> ，战地风云超级老登。</li>
        </div>
        
        {/* 不蒜子计数器 */}
        <div className="mt-6 text-xs text-slate-500">
          <span id="busuanzi_container_site_pv">本站总访问量<span id="busuanzi_value_site_pv"></span>次</span>
        </div>

        {/* 运行时间 */}
        <div className="mt-2 text-xs text-slate-500">
          <RuntimeTimer since="2025-09-27T19:00:00+01:00" />
        </div>
      </main>
    </div>
  );
}

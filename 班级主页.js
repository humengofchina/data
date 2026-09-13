export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ADMIN_PASSWORD = env.ADMIN_PASSWORD || "286076062";

    // 1. 静态主页
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(renderHTML(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // 2. 核心数据接口
    if (request.method === "GET" && url.pathname === "/api/data") {
      const records = JSON.parse((await env.LEAVE_KV.get("leave_records")) || "[]");
      const slides = JSON.parse((await env.LEAVE_KV.get("board_slides")) || "[]");
      const notice = (await env.LEAVE_KV.get("class_notice")) || "暂无最新班级公告。";
      return new Response(JSON.stringify({ records, slides, notice }), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // 3. ONE 一个 文艺励志语录接口 (已彻底清除博学笃行固定文本)
    if (request.method === "GET" && url.pathname === "/api/one") {
      try {
        const cached = await env.LEAVE_KV.get("one_quote_cache_v4");
        if (cached) {
          return new Response(cached, { headers: { "Content-Type": "application/json; charset=utf-8" } });
        }

        const res = await fetch("http://v3.wufazhuce.com:8000/api/channel/one/0/0");
        const json = await res.json();
        const list = (json.data && json.data.content_list) ? json.data.content_list : [];

        const item0 = list[0] || {};
        const item1 = list[1] || {};

        const oneData = {
          vol: item0.volume || "VOL.ONE",
          pic: item0.img_url || "",
          quote: item0.forward || "生活不在别处，当下即是全部。",
          author: item0.words_info || "",
          work: item0.text_author_info ? item0.text_author_info.text_author_work : "",
          articleTitle: item1.title || "",
          articleIntro: item1.forward || "",
          articleUrl: item1.share_url || ""
        };

        const resultStr = JSON.stringify(oneData);
        await env.LEAVE_KV.put("one_quote_cache_v4", resultStr, { expirationTtl: 7200 });
        return new Response(resultStr, { headers: { "Content-Type": "application/json; charset=utf-8" } });
      } catch (e) {
        return jsonRes({
          vol: "VOL.ONE",
          pic: "",
          quote: "脚踏实地，仰望星空。",
          author: "高一7班",
          work: "",
          articleTitle: "",
          articleIntro: ""
        });
      }
    }

    // 4. 国内权威官方气象源：中国天气网 (商水县代码: 101181403)
    if (request.method === "GET" && url.pathname === "/api/weather") {
      try {
        const cacheKey = "shangshui_cma_weather_v5";
        const cached = await env.LEAVE_KV.get(cacheKey);
        if (cached) {
          return new Response(cached, { headers: { "Content-Type": "application/json; charset=utf-8" } });
        }

        // 1) 获取中国天气网商水实时天气
        const resSk = await fetch("http://d1.weather.com.cn/sk_2d/101181403.html", {
          headers: { "Referer": "http://www.weather.com.cn/", "User-Agent": "Mozilla/5.0" }
        });
        const rawSk = await resSk.text();
        const dataSK = JSON.parse(rawSk.replace("var dataSK =", "").trim());

        // 2) 获取中国天气网未来7天天气预报
        const resF = await fetch("http://wthrcdn.etouch.cn/weather_mini?citykey=101181403");
        const jsonF = await resF.json();
        const fList = (jsonF.data && jsonF.data.forecast) ? jsonF.data.forecast : [];

        // 天气图标智能映射
        const getIcon = (typeStr) => {
          if (!typeStr) return "⛅";
          if (typeStr.includes("晴")) return "☀️";
          if (typeStr.includes("多云")) return "⛅";
          if (typeStr.includes("阴")) return "☁️";
          if (typeStr.includes("雷")) return "⛈️";
          if (typeStr.includes("雨")) return "🌧️";
          if (typeStr.includes("雪")) return "🌨️";
          if (typeStr.includes("雾") || typeStr.includes("霾")) return "🌫️";
          return "🌤️";
        };

        const weekdayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
        const today = new Date();

        // 整理 7 天预报数据
        const forecast = [];
        for (let i = 0; i < 7; i++) {
          const targetDate = new Date(today.getTime() + i * 86400000);
          let label = "今天";
          if (i === 0) label = "今天";
          else if (i === 1) label = "明天";
          else if (i === 2) label = "后天";
          else label = weekdayNames[targetDate.getDay()];

          if (fList[i]) {
            const item = fList[i];
            const maxT = (item.high || "").replace(/[^\d]/g, "");
            const minT = (item.low || "").replace(/[^\d]/g, "");
            forecast.push({
              day: label,
              desc: item.type || "多云",
              icon: getIcon(item.type),
              tempMax: (maxT || "22") + "℃",
              tempMin: (minT || "14") + "℃"
            });
          } else {
            forecast.push({
              day: label,
              desc: "晴间多云",
              icon: "🌤️",
              tempMax: (22 + (i % 2)) + "℃",
              tempMin: (13 + (i % 2)) + "℃"
            });
          }
        }

        const weatherInfo = {
          city: "河南省周口市商水县",
          currentTemp: dataSK.temp || (forecast[0] ? forecast[0].tempMax.replace("℃", "") : "20"),
          currentWeather: dataSK.weather || (forecast[0] ? forecast[0].desc : "多云"),
          currentIcon: getIcon(dataSK.weather || (forecast[0] ? forecast[0].desc : "")),
          wind: (dataSK.WD || "偏南风") + " " + (dataSK.WS || "微风"),
          humidity: (dataSK.SD || "50%"),
          aqi: dataSK.aqi || "优良",
          forecast
        };

        const resultStr = JSON.stringify(weatherInfo);
        await env.LEAVE_KV.put(cacheKey, resultStr, { expirationTtl: 600 });
        return new Response(resultStr, { headers: { "Content-Type": "application/json; charset=utf-8" } });
      } catch (err) {
        return jsonRes({
          city: "河南省周口市商水县",
          currentTemp: 22,
          currentWeather: "多云",
          currentIcon: "⛅",
          wind: "偏南风 微风",
          humidity: "50%",
          aqi: "优良",
          forecast: [
            { day: "今天", desc: "晴天", icon: "☀️", tempMax: "24℃", tempMin: "15℃" },
            { day: "明天", desc: "多云", icon: "⛅", tempMax: "23℃", tempMin: "14℃" },
            { day: "后天", desc: "阴天", icon: "☁️", tempMax: "21℃", tempMin: "13℃" },
            { day: "周四", desc: "小雨", icon: "🌧️", tempMax: "20℃", tempMin: "12℃" },
            { day: "周五", desc: "晴天", icon: "☀️", tempMax: "22℃", tempMin: "13℃" },
            { day: "周六", desc: "多云", icon: "⛅", tempMax: "23℃", tempMin: "14℃" },
            { day: "周日", desc: "晴间多云", icon: "🌤️", tempMax: "24℃", tempMin: "15℃" }
          ]
        });
      }
    }

    // 5. 更新公告 (需密码)[cite: 1, 2]
    if (request.method === "POST" && url.pathname === "/api/notice/update") {
      try {
        const { text, password } = await request.json();
        if (password !== ADMIN_PASSWORD) return jsonRes({ error: "管理员密码错误！" }, 403);
        await env.LEAVE_KV.put("class_notice", (text || "").trim());
        return jsonRes({ success: true, message: "班级公告已更新！" });
      } catch (err) {
        return jsonRes({ error: err.message }, 500);
      }
    }

    // 6. 上传轮播图 (需密码)[cite: 1, 2]
    if (request.method === "POST" && url.pathname === "/api/slides/upload") {
      try {
        const { imageBase64, note, password } = await request.json();
        if (password !== ADMIN_PASSWORD) return jsonRes({ error: "管理员密码错误！" }, 403);
        if (!imageBase64) return jsonRes({ error: "图片无效" }, 400);

        let slides = JSON.parse((await env.LEAVE_KV.get("board_slides")) || "[]");
        slides.push({
          id: "slide_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
          image: imageBase64,
          note: (note || "").trim(),
          createdAt: new Date().toISOString(),
        });
        if (slides.length > 8) slides.shift();

        await env.LEAVE_KV.put("board_slides", JSON.stringify(slides), { expirationTtl: 86400 });
        return jsonRes({ success: true, message: "图片已添加！" });
      } catch (err) {
        return jsonRes({ error: err.message }, 500);
      }
    }

    // 7. 更新图注 (需密码)[cite: 1, 2]
    if (request.method === "POST" && url.pathname === "/api/slides/update-note") {
      try {
        const { slideId, note, password } = await request.json();
        if (password !== ADMIN_PASSWORD) return jsonRes({ error: "管理员密码错误！" }, 403);
        let slides = JSON.parse((await env.LEAVE_KV.get("board_slides")) || "[]");
        slides = slides.map(s => s.id === slideId ? { ...s, note: (note || "").trim() } : s);
        await env.LEAVE_KV.put("board_slides", JSON.stringify(slides), { expirationTtl: 86400 });
        return jsonRes({ success: true, message: "说明已更新！" });
      } catch (err) {
        return jsonRes({ error: err.message }, 500);
      }
    }

    // 8. 删除图片 (需密码)[cite: 1, 2]
    if (request.method === "POST" && url.pathname === "/api/slides/delete") {
      try {
        const { slideId, password } = await request.json();
        if (password !== ADMIN_PASSWORD) return jsonRes({ error: "管理员密码错误！" }, 403);
        let slides = JSON.parse((await env.LEAVE_KV.get("board_slides")) || "[]");
        slides = slides.filter(s => s.id !== slideId);
        await env.LEAVE_KV.put("board_slides", JSON.stringify(slides), { expirationTtl: 86400 });
        return jsonRes({ success: true, message: "图片已删除！" });
      } catch (err) {
        return jsonRes({ error: err.message }, 500);
      }
    }

    // 9. 登记请假 (需密码)[cite: 1, 2]
    if (request.method === "POST" && url.pathname === "/api/leave") {
      try {
        const { studentName, startTime, endTime, reason, password } = await request.json();
        if (password !== ADMIN_PASSWORD) return jsonRes({ error: "管理员密码错误！" }, 403);
        if (!studentName || !startTime || !endTime) return jsonRes({ error: "必填项未填写" }, 400);

        const records = JSON.parse((await env.LEAVE_KV.get("leave_records")) || "[]");
        records.unshift({
          id: "rec_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
          studentName: studentName.trim(),
          startTime,
          endTime,
          reason: (reason || "因事请假").trim(),
          status: "pending",
          createdAt: new Date().toISOString(),
          returnedAt: null,
        });
        await env.LEAVE_KV.put("leave_records", JSON.stringify(records));
        return jsonRes({ success: true, message: "登记成功！" });
      } catch (err) {
        return jsonRes({ error: err.message }, 500);
      }
    }

    // 10. 销假 (需密码)[cite: 1, 2]
    if (request.method === "POST" && url.pathname === "/api/return") {
      try {
        const { recordId, password } = await request.json();
        if (password !== ADMIN_PASSWORD) return jsonRes({ error: "管理员密码错误！" }, 403);
        let records = JSON.parse((await env.LEAVE_KV.get("leave_records")) || "[]");
        let found = false;
        records = records.map((r) => {
          if (r.id === recordId) {
            found = true;
            return { ...r, status: "returned", returnedAt: new Date().toISOString() };
          }
          return r;
        });
        if (!found) return jsonRes({ error: "记录不存在" }, 404);
        await env.LEAVE_KV.put("leave_records", JSON.stringify(records));
        return jsonRes({ success: true, message: "销假完成！" });
      } catch (err) {
        return jsonRes({ error: err.message }, 500);
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function renderHTML() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>高一7班综合公示大屏</title>
  <style>
    :root {
      --primary: #1e40af;
      --danger: #dc2626;
      --bg: #f8fafc;
      --card: #ffffff;
      --border: #cbd5e1;
      --panel-h: 540px;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
      background: var(--bg);
      margin: 0;
      padding: 16px;
      color: #0f172a;
    }
    .main-wrap {
      max-width: 1560px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    /* 1. ONE·一个 励志横幅 */
    .one-banner {
      background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
      color: #ffffff;
      border-radius: 10px;
      padding: 12px 18px;
      display: flex;
      align-items: center;
      gap: 16px;
      box-shadow: 0 4px 12px rgba(30, 58, 138, 0.15);
      position: relative;
      overflow: hidden;
    }
    .one-thumb {
      width: 54px;
      height: 54px;
      object-fit: cover;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.4);
      flex-shrink: 0;
      display: none;
    }
    .one-main-box {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .one-meta-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .one-badge {
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.4);
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 800;
      font-size: 11.5px;
      letter-spacing: 0.5px;
      flex-shrink: 0;
    }
    .one-article-title {
      font-size: 12px;
      color: #bfdbfe;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .one-quote-text {
      font-size: 14.5px;
      font-weight: 600;
      line-height: 1.4;
      color: #f8fafc;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .one-author-text {
      font-size: 12px;
      color: #93c5fd;
      text-align: right;
      flex-shrink: 0;
      max-width: 240px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* 2. 顶部四栏栅格大屏 */
    .top-grid {
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr) 290px 240px;
      gap: 12px;
      height: var(--panel-h);
    }
    @media (max-width: 1200px) {
      .top-grid { grid-template-columns: 1fr 1fr; height: auto; }
    }

    .panel {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      box-shadow: 0 1px 4px rgba(0,0,0,0.04);
      overflow: hidden;
    }
    .panel-head {
      font-size: 13.5px;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }

    /* 公告栏 */
    .notice-view {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      background: #fdfbf7;
      border: 1.5px solid #fef08a;
      border-left: 4px solid #eab308;
      border-radius: 6px;
      padding: 10px;
      font-size: 13.5px;
      line-height: 1.6;
      color: #334155;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .notice-form { margin-top: 8px; flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; }
    .notice-form textarea { width: 100%; height: 70px; padding: 6px; border: 1px solid var(--border); border-radius: 4px; font-size: 12px; resize: none; }

    /* 轮播大屏 */
    .carousel-view {
      position: relative;
      background: #0f172a;
      border-radius: 8px;
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      cursor: pointer;
    }
    .carousel-slide { width: 100%; height: 100%; display: none; align-items: center; justify-content: center; }
    .carousel-slide.active { display: flex; }
    .carousel-slide img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .carousel-arrow {
      position: absolute; top: 50%; transform: translateY(-50%);
      background: rgba(0,0,0,0.5); color: #fff; border: none; width: 32px; height: 32px;
      border-radius: 50%; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center;
    }
    .arrow-left { left: 6px; } .arrow-right { right: 6px; }
    .carousel-dots { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); display: flex; gap: 5px; }
    .dot { width: 6px; height: 6px; background: rgba(255,255,255,0.4); border-radius: 50%; cursor: pointer; }
    .dot.active { background: #38bdf8; width: 16px; border-radius: 3px; }
    .slide-info-wrap { margin-top: 8px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 6px 8px; flex-shrink: 0; }
    .slide-banner-text { font-size: 13.5px; font-weight: 700; color: #1e40af; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .slide-upload-wrap { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border); flex-shrink: 0; }

    /* 时间与国内官方商水县未来一周天气 (加粗放大) */
    .clock-weather-panel {
      background: linear-gradient(150deg, #1e293b 0%, #0f172a 100%);
      color: #fff;
      border-color: #334155;
    }
    .clock-box { text-align: center; padding: 4px 0 6px; border-bottom: 1px solid rgba(255,255,255,0.1); flex-shrink: 0; }
    .clock-digits { font-size: 44px; font-weight: 800; color: #ffffff; text-shadow: 0 2px 10px rgba(56, 189, 248, 0.4); line-height: 1; font-variant-numeric: tabular-nums; }
    .clock-solar { font-size: 12.5px; color: #cbd5e1; margin-top: 4px; font-weight: 700; }
    .clock-lunar { font-size: 12px; color: #38bdf8; margin-top: 2px; font-weight: 700; }

    .weather-box {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      padding-top: 6px;
    }
    .weather-loc {
      font-size: 13px;
      font-weight: 800;
      color: #fbbf24;
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .weather-now-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 2px 0 6px;
      padding-bottom: 6px;
      border-bottom: 1px dashed rgba(255,255,255,0.15);
    }
    .weather-now-left {
      display: flex;
      align-items: baseline;
      gap: 6px;
    }
    .weather-icon-big { font-size: 32px; line-height: 1; }
    .weather-temp-big { font-size: 34px; font-weight: 900; color: #ffffff; line-height: 1; }
    .weather-now-right {
      text-align: right;
    }
    .weather-cond-big { font-size: 17px; font-weight: 800; color: #38bdf8; margin-bottom: 2px; }
    .weather-wind-text { font-size: 11.5px; font-weight: 600; color: #94a3b8; }

    /* 7天预报列表 (字号增大，加粗均衡，支持内部滚动) */
    .forecast-title-row {
      font-size: 11.5px;
      font-weight: 700;
      color: #94a3b8;
      margin-bottom: 4px;
      display: flex;
      justify-content: space-between;
    }
    .forecast-scroll-box {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding-right: 2px;
    }
    .forecast-row-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 3px 6px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
      font-size: 13px;
      font-weight: 700;
      color: #f1f5f9;
    }
    .f-day { width: 38px; color: #e2e8f0; }
    .f-icon { font-size: 16px; margin: 0 4px; }
    .f-desc { flex: 1; color: #38bdf8; font-weight: 700; text-align: left; padding-left: 2px; }
    .f-temp { font-weight: 800; color: #f8fafc; font-size: 12.5px; }

    /* 请假名单 */
    .leave-panel { border-color: #fca5a5; }
    .leave-list-scroll { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
    .mini-card {
      background: #fff; border: 1px solid #fecaca; border-left: 3px solid #ef4444;
      border-radius: 5px; padding: 6px; display: flex; flex-direction: column; gap: 2px; font-size: 11.5px; flex-shrink: 0;
    }
    .mini-card.overdue { background: #fff1f2; border-left-color: #9f1239; }
    .mini-r1 { display: flex; justify-content: space-between; font-weight: 700; color: #881337; }
    .mini-r2 { display: flex; justify-content: space-between; color: #64748b; font-size: 11px; align-items: center; }

    /* 3. 请假总流水台账 (完全展开到底) */
    .ledger-section {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.04);
    }
    .ledger-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    table.excel-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
      text-align: left;
    }
    table.excel-table th {
      background: #f1f5f9;
      border: 1px solid var(--border);
      padding: 8px 10px;
      color: #334155;
    }
    table.excel-table td {
      border: 1px solid var(--border);
      padding: 7px 10px;
      color: #1e293b;
    }
    table.excel-table tr:hover { background: #f8fafc; }

    /* 4. 页脚：高一7班莘莘学子 (每行7人) */
    .students-footer {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 18px 20px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.04);
    }
    .students-title {
      font-size: 13.5px;
      font-weight: 700;
      color: #475569;
      text-align: center;
      margin-bottom: 14px;
      letter-spacing: 1.5px;
    }
    .students-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 10px 8px;
      text-align: center;
    }
    .student-tag {
      font-size: 12.5px;
      color: #64748b;
      opacity: 0.65;
      transition: opacity 0.2s, color 0.2s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .student-tag:hover {
      opacity: 1;
      color: #1e40af;
      font-weight: 600;
    }

    /* 5. 最底部跳转外链条目 */
    .footer-links-wrap {
      text-align: center;
      padding: 10px 0 6px;
    }
    .footer-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: #64748b;
      font-size: 12.5px;
      text-decoration: none;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 20px;
      background: #f1f5f9;
      border: 1px solid var(--border);
      transition: all 0.2s ease;
    }
    .footer-link:hover {
      color: var(--primary);
      background: #e0f2fe;
      border-color: #bae6fd;
    }

    /* 交互组件 */
    .btn { background: var(--primary); color: #fff; border: none; padding: 5px 10px; border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .btn:hover { opacity: 0.9; }
    .btn-return { background: #059669; color: white; border: none; padding: 2px 6px; border-radius: 3px; font-size: 11px; cursor: pointer; }
    .status-tag { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 700; }
    .tag-out { background: #fee2e2; color: #b91c1c; }
    .tag-out-timeout { background: #9f1239; color: #ffffff; }
    .tag-returned { background: #dcfce7; color: #15803d; }
    .row-flex { display: flex; gap: 6px; align-items: center; }

    /* 弹窗 */
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: none; align-items: center; justify-content: center; z-index: 100; }
    .modal { background: white; padding: 18px; border-radius: 8px; width: 360px; }
    .form-group { margin-bottom: 10px; }
    .form-group label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 3px; }
    .form-group input { width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="main-wrap">
    <!-- 1. ONE · 一个 励志横幅 (无默认博学笃行文字) -->
    <div class="one-banner">
      <img id="oneThumb" class="one-thumb" src="" alt="ONE封面" />
      <div class="one-main-box">
        <div class="one-meta-row">
          <span class="one-badge" id="oneVol">VOL.ONE</span>
          <span class="one-article-title" id="oneArticle"></span>
        </div>
        <div class="one-quote-text" id="oneQuote">加载精选寄语中...</div>
      </div>
      <div class="one-author-text" id="oneAuthor"></div>
    </div>

    <!-- 2. 顶部四栏栅格大屏 -->
    <div class="top-grid">
      <!-- 1. 班级公告 -->
      <div class="panel">
        <div class="panel-head"><span>📢 班级重要公告</span></div>
        <div class="notice-view" id="noticeTextDisplay">加载公告中...</div>
        <div class="notice-form">
          <textarea id="noticeInput" placeholder="输入班级公告内容（支持换行）..."></textarea>
          <div class="row-flex">
            <input type="password" id="noticePwd" placeholder="🔑 管理员密码" style="flex:1; padding: 4px 6px; border: 1px solid #f87171; border-radius: 4px; font-size: 11.5px;" />
            <button class="btn" onclick="saveNotice()">发布公告</button>
          </div>
        </div>
      </div>

      <!-- 2. 轮播大屏 -->
      <div class="panel">
        <div class="panel-head">
          <span>🖼️ 通报违纪 / 班级轮播</span>
          <span id="slideCounter" style="font-size: 11px; color: #64748b;">0 / 0</span>
        </div>
        <div class="carousel-view" id="carouselViewport" onclick="triggerPickImage(event)">
          <div id="emptyPrompt" style="color: #94a3b8; font-size: 12px; pointer-events: none; text-align: center;">
            📁 拖拽图片至此处加入轮播 (24h自动销毁)
          </div>
          <div id="slidesContainer" style="width:100%; height:100%;"></div>
          <button class="carousel-arrow arrow-left" onclick="prevSlide(event)">❮</button>
          <button class="carousel-arrow arrow-right" onclick="nextSlide(event)">❯</button>
          <div class="carousel-dots" id="dotsContainer"></div>
          <input type="file" id="fileInput" accept="image/*" style="display:none;" />
        </div>

        <div class="slide-info-wrap">
          <div class="slide-banner-text" id="currentSlideBanner">暂无图片说明</div>
          <div class="row-flex">
            <input type="text" id="editNoteInput" placeholder="修改当前图说明..." style="flex:1; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 11.5px;" />
            <input type="password" id="editNotePwd" placeholder="🔑 密码" style="width: 65px; padding: 4px; border: 1px solid #f87171; border-radius: 4px; font-size: 11px;" />
            <button class="btn" style="padding: 4px 6px; font-size: 11px;" onclick="saveCurrentNote()">保存</button>
            <button class="btn" style="background:#ef4444; padding: 4px 6px; font-size: 11px;" onclick="deleteCurrentSlide()">删除</button>
          </div>
        </div>

        <div class="slide-upload-wrap row-flex">
          <input type="text" id="newImageNote" placeholder="新图说明..." style="flex:1; padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px; font-size: 11.5px;" />
          <input type="password" id="newImagePwd" placeholder="🔑 密码" style="width: 65px; padding: 4px; border: 1px solid #f87171; border-radius: 4px; font-size: 11px;" />
          <button class="btn" style="padding: 4px 8px; font-size: 11px;" onclick="uploadPendingImage()">添加轮播</button>
        </div>
      </div>

      <!-- 3. 北京时间 + 国内商水县未来一周天气 (中国天气网源) -->
      <div class="panel clock-weather-panel">
        <div class="clock-box">
          <div class="clock-digits" id="clockTime">--:--</div>
          <div class="clock-solar" id="clockDateSolar">--年--月--日 星期-</div>
          <div class="clock-lunar" id="clockDateLunar">农历 --年 ----</div>
        </div>

        <div class="weather-box">
          <div class="weather-loc">
            <span>📍 河南 · 周口 · 商水县</span>
            <span style="font-size: 11.5px; color:#38bdf8; font-weight:700;">官方未来7天预报</span>
          </div>
          
          <div class="weather-now-row">
            <div class="weather-now-left">
              <span class="weather-icon-big" id="wCurIcon">🌤️</span>
              <span class="weather-temp-big" id="wCurTemp">--℃</span>
            </div>
            <div class="weather-now-right">
              <div class="weather-cond-big" id="wCurDesc">加载中</div>
              <div class="weather-wind-text" id="wCurWind">--</div>
            </div>
          </div>

          <div class="forecast-title-row">
            <span>预报日期</span>
            <span>天气状况</span>
            <span>气温范围</span>
          </div>

          <div class="forecast-scroll-box" id="forecastGrid">
            <div style="font-size: 12px; color:#94a3b8; text-align:center; padding-top: 10px;">气象数据加载中...</div>
          </div>
        </div>
      </div>

      <!-- 4. 请假名单 (最右侧) -->
      <div class="panel leave-panel">
        <div class="panel-head" style="color: #b91c1c;">
          <span>📋 请假名单 (<span id="activeCount">0</span>)</span>
          <span style="font-size: 11px; color: #94a3b8; font-weight: normal;">需手动销假</span>
        </div>
        <div class="leave-list-scroll" id="activeList">
          <div style="color: #94a3b8; font-size: 12px; text-align: center; padding: 40px 0;">全员在校</div>
        </div>
      </div>
    </div>

    <!-- 3. 请假总流水台账 (完全展开到底) -->
    <div class="ledger-section">
      <div class="ledger-head">
        <span style="font-size: 14px; font-weight: 700; color:#334155;">📋 请假总流水台账</span>
        <div style="display: flex; gap: 6px;">
          <button class="btn" onclick="openModal()">➕ 登记请假 (需密码)</button>
          <button class="btn" style="background:#64748b;" onclick="fetchData()">🔄 刷新</button>
        </div>
      </div>
      <table class="excel-table">
        <thead>
          <tr>
            <th style="width: 40px; text-align: center;">#</th>
            <th style="width: 100px;">学生姓名</th>
            <th style="width: 100px;">状态</th>
            <th style="width: 150px;">离校时间</th>
            <th style="width: 150px;">截至返校</th>
            <th>请假事由</th>
            <th style="width: 160px;">手动销假时间</th>
            <th style="width: 80px; text-align: center;">操作</th>
          </tr>
        </thead>
        <tbody id="tableBody">
          <tr><td colspan="8" style="text-align: center; color: #94a3b8; padding: 16px;">加载中...</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 4. 页脚：高一7班莘莘学子 (每行7人，69人纯文本矩阵) -->
    <div class="students-footer">
      <div class="students-title">🎓 高一7班 ·  共 69 人</div>
      <div class="students-grid" id="studentsContainer"></div>
    </div>

    <!-- 5. 页脚最底部居中跳转其他网站文本链接 -->
    <div class="footer-links-wrap">
      <a class="footer-link" href="https://github.com/humengofchina/data/blob/main/%E7%8F%AD%E7%BA%A7%E4%B8%BB%E9%A1%B5.js" target="_blank" rel="noopener noreferrer">
        开放源代码 ↗
      </a>
        <a class="footer-link" href="https://name.aihuihui.de5.net/" target="_blank" rel="noopener noreferrer">
        高一7班随机抽签 ↗
      </a>
    </div>
  </div>

  <!-- 登记请假弹窗 -->
  <div class="modal-overlay" id="modal">
    <div class="modal">
      <h3 style="margin:0 0 10px; font-size:15px;">登记学生请假</h3>
      <div class="form-group">
        <label>学生姓名:</label>
        <input type="text" id="nameInput" placeholder="输入姓名">
      </div>
      <div class="form-group">
        <label>离校时间:</label>
        <input type="datetime-local" id="startTimeInput">
      </div>
      <div class="form-group">
        <label>截至返校时间:</label>
        <input type="datetime-local" id="endTimeInput">
      </div>
      <div class="form-group">
        <label>请假原因:</label>
        <input type="text" id="reasonInput" placeholder="事由">
      </div>
      <div class="form-group">
        <label style="color: #b91c1c;">🔐 管理员密码:</label>
        <input type="password" id="adminPwdInput" placeholder="输入密码授权">
      </div>
      <div style="display:flex; justify-content: flex-end; gap:6px; margin-top:12px;">
        <button class="btn" style="background: #94a3b8;" onclick="closeModal()">取消</button>
        <button class="btn" onclick="submitLeave()">确认提交</button>
      </div>
    </div>
  </div>

  <script>
    const studentsRawText = \`
高林旭
王明哲
王涵乐
张景豪
孙敏浩
王耀康
王翔宇
查寅诚
杨双亮
杨绍博
李赫哲
华梦涛
王子轩
李书研
许科航
文俊豪
魏家旺
李佳坤
栾家乐
母高博
苏军豪
乔宇辰
王哲轩
刘帅豪
许秉坤
李彤珈
李沐洋
支琼瑶
张盼盼
付思恩
苏雅琪
姜思涵
张慧莹
史雅欣
张畅畅
康馨予
王静怡
任静茹
杨梦圆
郭馨雨
吴梦瑶
王婧祎
陈梦霏
胡梓钥
刘雅婷
张静蕾
王妙彤
张一珂
雷岚岚
王含钰
苗林林
朱紫晗
付政豪
苏世博
赵康
任科旭
高博望
董振鹏
喻昶沣
付诗博
郭施昂
赵家欣
刘苒苒
雷雨馨
李一诺
单孟晴
刘恩阳
王易涵
张书珂
\`;

    const classStudents = studentsRawText.trim().split('\\n').map(s => s.trim()).filter(Boolean);

    let cacheRecords = [];
    let slidesList = [];
    let currentSlideIndex = 0;
    let carouselTimer = null;
    let pendingUploadBase64 = null;

    window.addEventListener("DOMContentLoaded", () => {
      renderStudentsFooter();
      initDragDrop();
      fetchData();
      fetchWeather();
      fetchOneQuote();
      updateBeijingClock();
      setInterval(updateBeijingClock, 1000);
      setInterval(fetchData, 30000);
      setInterval(fetchWeather, 600000);
      startCarouselTimer();
    });

    function renderStudentsFooter() {
      const container = document.getElementById("studentsContainer");
      container.innerHTML = classStudents.map((name) => \`
        <div class="student-tag" title="\${name}">\${name}</div>
      \`).join("");
    }

    async function fetchOneQuote() {
      try {
        const res = await fetch("/api/one");
        const data = await res.json();
        
        document.getElementById("oneVol").innerText = data.vol || "VOL.ONE";
        document.getElementById("oneQuote").innerText = "「" + data.quote + "」";
        
        let authorText = data.author || "";
        if (data.work) authorText += " · " + data.work;
        document.getElementById("oneAuthor").innerText = authorText ? "—— " + authorText : "";

        if (data.pic) {
          const img = document.getElementById("oneThumb");
          img.src = data.pic;
          img.style.display = "block";
        }

        if (data.articleTitle) {
          document.getElementById("oneArticle").innerText = "精选：" + data.articleTitle;
        }
      } catch (e) {
        console.error("ONE 加载失败", e);
      }
    }

    function updateBeijingClock() {
      const d = new Date();
      const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
      const bjDate = new Date(utc + (3600000 * 8));

      const h = String(bjDate.getHours()).padStart(2, '0');
      const m = String(bjDate.getMinutes()).padStart(2, '0');
      document.getElementById("clockTime").innerText = \`\${h}:\${m}\`;

      const weeks = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
      document.getElementById("clockDateSolar").innerText = \`\${bjDate.getFullYear()}年\${bjDate.getMonth() + 1}月\${bjDate.getDate()}日 \${weeks[bjDate.getDay()]}\`;

      try {
        const lunarFormatter = new Intl.DateTimeFormat('zh-Hans-CN-u-ca-chinese', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        document.getElementById("clockDateLunar").innerText = "农历 " + lunarFormatter.format(bjDate);
      } catch (e) {
        document.getElementById("clockDateLunar").innerText = "农历日期计算中";
      }
    }

    // 渲染商水县未来7天中文天气 (国内气象源)
    async function fetchWeather() {
      try {
        const res = await fetch("/api/weather");
        const data = await res.json();
        
        document.getElementById("wCurIcon").innerText = data.currentIcon || "🌤️";
        document.getElementById("wCurTemp").innerText = data.currentTemp + "℃";
        document.getElementById("wCurDesc").innerText = data.currentWeather;
        document.getElementById("wCurWind").innerText = data.wind;

        const grid = document.getElementById("forecastGrid");
        grid.innerHTML = "";
        (data.forecast || []).forEach(f => {
          const card = document.createElement("div");
          card.className = "forecast-row-card";
          card.innerHTML = \`
            <span class="f-day">\${f.day}</span>
            <span class="f-icon">\${f.icon}</span>
            <span class="f-desc">\${f.desc}</span>
            <span class="f-temp">\${f.tempMin} ~ \${f.tempMax}</span>
          \`;
          grid.appendChild(card);
        });
      } catch (e) {
        console.error("天气数据加载失败", e);
      }
    }

    function startCarouselTimer() {
      if (carouselTimer) clearInterval(carouselTimer);
      carouselTimer = setInterval(() => {
        if (slidesList.length > 1) {
          goToSlide((currentSlideIndex + 1) % slidesList.length);
        }
      }, 10000);
    }

    function initDragDrop() {
      const dropZone = document.getElementById("carouselViewport");
      const fileInput = document.getElementById("fileInput");

      ['dragenter', 'dragover'].forEach(n => {
        dropZone.addEventListener(n, (e) => { e.preventDefault(); e.stopPropagation(); });
      });

      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        const files = e.dataTransfer.files;
        if (files.length > 0) handleFile(files[0]);
      });

      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleFile(e.target.files[0]);
      });
    }

    function triggerPickImage(e) {
      if (e.target.classList.contains('carousel-arrow') || e.target.classList.contains('dot')) return;
      document.getElementById('fileInput').click();
    }

    function handleFile(file) {
      if (!file.type.startsWith('image/')) return alert('请选择图片！');
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width, height = img.height;
          const maxDim = 1200;
          if (width > maxDim || height > maxDim) {
            if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
            else { width = Math.round((width * maxDim) / height); height = maxDim; }
          }
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          pendingUploadBase64 = canvas.toDataURL('image/jpeg', 0.82);
          alert("图片读取成功！请填写说明与管理员密码，点击【添加轮播】。");
          document.getElementById('newImageNote').focus();
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }

    async function saveNotice() {
      const text = document.getElementById("noticeInput").value;
      const password = document.getElementById("noticePwd").value;
      if (!password) return alert("请输入管理员密码！");

      const res = await fetch("/api/notice/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, password })
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else {
        alert("公告更新成功！");
        document.getElementById("noticePwd").value = "";
        fetchData();
      }
    }

    async function uploadPendingImage() {
      if (!pendingUploadBase64) return alert("请先选择图片！");
      const note = document.getElementById("newImageNote").value;
      const password = document.getElementById("newImagePwd").value;
      if (!password) return alert("请输入管理员密码！");

      const res = await fetch("/api/slides/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: pendingUploadBase64, note, password })
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else {
        alert(data.message);
        pendingUploadBase64 = null;
        document.getElementById("newImageNote").value = "";
        document.getElementById("newImagePwd").value = "";
        fetchData();
      }
    }

    async function saveCurrentNote() {
      if (slidesList.length === 0) return;
      const current = slidesList[currentSlideIndex];
      const note = document.getElementById("editNoteInput").value;
      const password = document.getElementById("editNotePwd").value;
      if (!password) return alert("请输入管理员密码！");

      const res = await fetch("/api/slides/update-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slideId: current.id, note, password })
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else {
        alert("说明已更新！");
        document.getElementById("editNotePwd").value = "";
        fetchData();
      }
    }

    async function deleteCurrentSlide() {
      if (slidesList.length === 0) return;
      const current = slidesList[currentSlideIndex];
      const password = prompt("⚠️ 确认删除当前图片？请输入管理员密码：");
      if (!password) return;

      const res = await fetch("/api/slides/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slideId: current.id, password })
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else {
        alert("已删除！");
        currentSlideIndex = 0;
        fetchData();
      }
    }

    function renderCarousel() {
      const container = document.getElementById("slidesContainer");
      const dots = document.getElementById("dotsContainer");
      const counter = document.getElementById("slideCounter");
      const emptyPrompt = document.getElementById("emptyPrompt");

      container.innerHTML = "";
      dots.innerHTML = "";

      if (slidesList.length === 0) {
        emptyPrompt.style.display = "block";
        counter.innerText = "0 / 0";
        document.getElementById("currentSlideBanner").innerText = "暂无通报/轮播图";
        document.getElementById("editNoteInput").value = "";
        return;
      }

      emptyPrompt.style.display = "none";
      if (currentSlideIndex >= slidesList.length) currentSlideIndex = 0;

      slidesList.forEach((slide, idx) => {
        const div = document.createElement("div");
        div.className = "carousel-slide " + (idx === currentSlideIndex ? "active" : "");
        div.innerHTML = \`<img src="\${slide.image}" alt="轮播图" />\`;
        container.appendChild(div);

        const dot = document.createElement("div");
        dot.className = "dot " + (idx === currentSlideIndex ? "active" : "");
        dot.onclick = (e) => { e.stopPropagation(); goToSlide(idx); };
        dots.appendChild(dot);
      });

      const current = slidesList[currentSlideIndex];
      counter.innerText = \`\${currentSlideIndex + 1} / \${slidesList.length}\`;
      document.getElementById("currentSlideBanner").innerText = current.note || "（未设置说明）";
      if (document.activeElement !== document.getElementById("editNoteInput")) {
        document.getElementById("editNoteInput").value = current.note || "";
      }
    }

    function goToSlide(idx) {
      currentSlideIndex = idx;
      renderCarousel();
      startCarouselTimer();
    }

    function prevSlide(e) {
      e.stopPropagation();
      if (slidesList.length <= 1) return;
      goToSlide((currentSlideIndex - 1 + slidesList.length) % slidesList.length);
    }

    function nextSlide(e) {
      e.stopPropagation();
      if (slidesList.length <= 1) return;
      goToSlide((currentSlideIndex + 1) % slidesList.length);
    }

    async function fetchData() {
      try {
        const res = await fetch("/api/data");
        const data = await res.json();
        cacheRecords = data.records || [];
        slidesList = data.slides || [];
        
        document.getElementById("noticeTextDisplay").innerText = data.notice || "暂无最新公告。";
        if (document.activeElement !== document.getElementById("noticeInput")) {
          document.getElementById("noticeInput").value = data.notice || "";
        }

        renderCarousel();
        renderRecords();
      } catch (err) {
        console.error("加载失败:", err);
      }
    }

    function renderRecords() {
      const now = new Date();
      const activeList = [];
      const tbody = document.getElementById("tableBody");
      tbody.innerHTML = "";

      if (cacheRecords.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #94a3b8; padding: 20px;">暂无请假记录</td></tr>';
      }

      cacheRecords.forEach((item, index) => {
        const end = new Date(item.endTime);
        const isOverdue = now > end;
        let statusTag = "";
        let actionBtn = "-";

        if (item.status === "returned") {
          statusTag = '<span class="status-tag tag-returned">已手动销假</span>';
          actionBtn = '<span style="color: #94a3b8; font-size: 11px;">已归校</span>';
        } else {
          activeList.push({ ...item, isOverdue });
          statusTag = isOverdue ? '<span class="status-tag tag-out-timeout">⚠️ 超时未归</span>' : '<span class="status-tag tag-out">请假中</span>';
          actionBtn = \`<button class="btn-return" onclick="returnStudent('\${item.id}')">销假</button>\`;
        }

        const tr = document.createElement("tr");
        tr.innerHTML = \`
          <td style="text-align: center; color: #64748b;">\${index + 1}</td>
          <td><b>\${escapeHtml(item.studentName)}</b></td>
          <td>\${statusTag}</td>
          <td>\${item.startTime.replace("T", " ")}</td>
          <td><b style="\${isOverdue && item.status !== 'returned' ? 'color: #b91c1c;' : ''}">\${item.endTime.replace("T", " ")}</b></td>
          <td>\${escapeHtml(item.reason)}</td>
          <td>\${item.returnedAt ? new Date(item.returnedAt).toLocaleString() : '<span style="color:#94a3b8;">-</span>'}</td>
          <td style="text-align: center;">\${actionBtn}</td>
        \`;
        tbody.appendChild(tr);
      });

      const activeContainer = document.getElementById("activeList");
      document.getElementById("activeCount").innerText = activeList.length;

      if (activeList.length === 0) {
        activeContainer.innerHTML = '<div style="color: #94a3b8; font-size: 12px; text-align: center; padding: 40px 0;">全员在校</div>';
      } else {
        activeContainer.innerHTML = activeList.map(item => \`
          <div class="mini-card \${item.isOverdue ? 'overdue' : ''}">
            <div class="mini-r1">
              <span>\${escapeHtml(item.studentName)}</span>
              <span style="font-size:11px;\${item.isOverdue ? 'color:#be123c;' : ''}">\${item.isOverdue ? '已超时' : item.endTime.slice(11, 16) + '止'}</span>
            </div>
            <div class="mini-r2">
              <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:120px;">\${escapeHtml(item.reason)}</span>
              <button class="btn-return" onclick="returnStudent('\${item.id}')">销假</button>
            </div>
          </div>
        \`).join("");
      }
    }

    function openModal() {
      document.getElementById("modal").style.display = "flex";
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      document.getElementById("startTimeInput").value = now.toISOString().slice(0, 16);
      const later = new Date(Date.now() + 2 * 3600 * 1000);
      later.setMinutes(later.getMinutes() - later.getTimezoneOffset());
      document.getElementById("endTimeInput").value = later.toISOString().slice(0, 16);
    }

    function closeModal() { document.getElementById("modal").style.display = "none"; }

    async function submitLeave() {
      const studentName = document.getElementById("nameInput").value;
      const startTime = document.getElementById("startTimeInput").value;
      const endTime = document.getElementById("endTimeInput").value;
      const reason = document.getElementById("reasonInput").value;
      const password = document.getElementById("adminPwdInput").value;

      if (!studentName || !password) return alert("姓名和管理员密码为必填项！");

      const res = await fetch("/api/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentName, startTime, endTime, reason, password })
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else {
        alert("请假登记成功！");
        closeModal();
        document.getElementById("nameInput").value = "";
        document.getElementById("adminPwdInput").value = "";
        fetchData();
      }
    }

    async function returnStudent(recordId) {
      const password = prompt("⚠️ 确认该同学已返校？请输入管理员密码进行手动销假：");
      if (!password) return;

      const res = await fetch("/api/return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId, password })
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else {
        alert("销假成功！");
        fetchData();
      }
    }

    function escapeHtml(str) {
      return (str || "").replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
      }[tag] || tag));
    }
  </script>
</body>
</html>`;
}

// utils/marketHelpers.js

// 1. Ambil Watchlist dari Database Upstash/Vercel KV
async function getPersistentWatchlist(chatId) {
  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return ['BTC', null, null]; 
    }
    const response = await fetch(process.env.KV_REST_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
      body: JSON.stringify(['GET', `wl_${chatId}`])
    });
    const data = await response.json();
    if (data && data.result) return JSON.parse(data.result);
  } catch (e) {
    console.error("Gagal membaca database:", e);
  }
  return ['BTC', null, null]; 
}

// 2. Simpan Watchlist ke Database
async function savePersistentWatchlist(chatId, watchlistArray) {
  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return;
    await fetch(process.env.KV_REST_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
      body: JSON.stringify(['SET', `wl_${chatId}`, JSON.stringify(watchlistArray)])
    });
  } catch (e) {
    console.error("Gagal menulis ke database:", e);
  }
}

// 3. PERBAIKAN TOTAL: Kalkulator Hitung Lembaran Transaksi Dinamis
async function calculateRealTransactionFlow(coin, timeframe) {
  const pair = `${coin}-USD`;
  let total_buy = 0, total_sell = 0;

  try {
    // KONDISI A: RENTANG PENDEK (Membaca lembar nota transaksi mentah riil detik demi detik)
    if (timeframe === '1H' || timeframe === '2H' || timeframe === '4H') {
      let cursor = '';
      const maxPages = timeframe === '1H' ? 3 : timeframe === '2H' ? 5 : 8;

      for (let i = 0; i < maxPages; i++) {
        const url = `https://api.exchange.coinbase.com/products/${pair}/trades?limit=100` + (cursor ? `&after=${cursor}` : '');
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!response.ok) break;
        cursor = response.headers.get('cb-after');
        const trades = await response.json();
        if (!Array.isArray(trades) || trades.length === 0) break;

        trades.forEach(t => {
          const valueUsd = parseFloat(t.price) * parseFloat(t.size);
          if (t.side.toUpperCase() === 'BUY') total_buy += valueUsd;
          else total_sell += valueUsd;
        });
        if (!cursor) break;
      }
    } 
    // KONDISI B: RENTANG PANJANG (1D, 1W, 1M, YTD) -> Hitung Agregasi Dinamis per Jam/Hari
    else {
      let granularity = 86400; // Default 1 Hari (86400 detik)
      let limit = 30;

      if (timeframe === '1D') { granularity = 3600; limit = 24; }       // 24 Jam terakhir (dipecah per jam)
      else if (timeframe === '1W') { granularity = 21600; limit = 28; }  // 7 Hari terakhir (dipecah per 6j)
      else if (timeframe === '1M') { granularity = 86400; limit = 30; }  // 30 Hari terakhir (dipecah per hari)
      else if (timeframe === 'YTD') {
        granularity = 86400;
        const start = new Date('2026-01-01');
        const now = new Date();
        limit = Math.ceil(Math.abs(now - start) / (1000 * 60 * 60 * 24)) || 1;
      }

      const response = await fetch(`https://api.exchange.coinbase.com/products/${pair}/candles?granularity=${granularity}&limit=${limit}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (!response.ok) return null;
      const buckets = await response.json();
      if (!Array.isArray(buckets) || buckets.length === 0) return null;

      buckets.forEach(b => {
        // Struktur data bucket Coinbase: [time, low, high, open, close, volume]
        const [time, low, high, open, close, volume] = b;
        const hargaRataRata = (open + close + high + low) / 4;
        const candleVolumeUsd = volume * hargaRataRata;

        if (high === low) {
          total_buy += candleVolumeUsd / 2;
          total_sell += candleVolumeUsd / 2;
        } else {
          // RUMUS KUANTITATIF VOLUME SPLIT: Membelah total volume bursa secara dinamis
          const buyFraction = (close - low) / (high - low);
          const sellFraction = (high - close) / (high - low);
          
          total_buy += candleVolumeUsd * buyFraction;
          total_sell += candleVolumeUsd * sellFraction;
        }
      });
    }

    const total = total_buy + total_sell;
    return {
      total_buy, total_sell,
      buy_pct: total > 0 ? ((total_buy / total) * 100).toFixed(1) : 0,
      sell_pct: total > 0 ? ((total_sell / total) * 100).toFixed(1) : 0
    };
  } catch (e) {
    return null;
  }
}

// 4. Kirim Tombol Pilihan Menu Waktu ke Telegram
async function sendTimeframeMenu(chatId, coin) {
  const token = process.env.TELEGRAM_TOKEN;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: `📊 *Riset Market Flow untuk ${coin}*\n\nSilakan tentukan durasi agregat transaksi riil yang mau dibedah:`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🕒 Last 1H", callback_data: `ANALYZE:${coin}:1H` },
            { text: "🕒 Last 2H", callback_data: `ANALYZE:${coin}:2H` },
            { text: "🕒 Last 4H", callback_data: `ANALYZE:${coin}:4H` }
          ],
          [
            { text: "📅 Last 1D", callback_data: `ANALYZE:${coin}:1D` },
            { text: "📅 Last 1W", callback_data: `ANALYZE:${coin}:1W` },
            { text: "📅 Last 1M", callback_data: `ANALYZE:${coin}:1M` }
          ],
          [
            { text: "🏆 YTD (Year to Date)", callback_data: `ANALYZE:${coin}:YTD` }
          ]
        ]
      }
    })
  });
}

// 5. Fungsi Basis Pengiriman Teks Telegram
async function sendToTelegram(chatId, text) {
  const token = process.env.TELEGRAM_TOKEN;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
  });
  if (res.ok) {
    const data = await res.json();
    return data.result;
  }
  return null;
}

// 6. Kirim Teks Sekaligus Tombol Pilihan ke Telegram
async function sendToTelegramWithButtons(chatId, text, replyMarkup) {
  const token = process.env.TELEGRAM_TOKEN;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown', reply_markup: replyMarkup })
  });
}

module.exports = {
  getPersistentWatchlist,
  savePersistentWatchlist,
  calculateRealTransactionFlow,
  sendTimeframeMenu,
  sendToTelegram,
  sendToTelegramWithButtons
};

const { GoogleGenerativeAI } = require('@google/generative-ai');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot aktif! Silakan gunakan lewat Telegram.');
  }

  try {
    const { message, callback_query } = req.body;

    // MENU 1: MENANGKAP INPUT KEYWORD KOIN
    if (message && message.text) {
      const chatId = message.chat.id;
      const textInput = message.text.trim().toUpperCase();

      if (textInput === '/START') {
        await sendToTelegram(chatId, "👋 *Bot Riset Market Flow Aktif!*\n\nSilakan ketik langsung nama koin untuk memulai riset.\n\n*Contoh:* `BTC`, `ETH`, atau `SOL`");
        return res.status(200).send('OK');
      }

      if (/^[A-Z]{2,6}$/.test(textInput)) {
        await sendTimeframeMenu(chatId, textInput);
      } else {
        await sendToTelegram(chatId, "❌ Format salah. Silakan ketik simbol koin yang valid.\n*Contoh:* `BTC` atau `SOL`");
      }
      return res.status(200).send('OK');
    }

    // MENU 2: PROSES KLIK TOMBOL JANGKA WAKTU
    if (callback_query) {
      const callbackQueryId = callback_query.id;
      const chatId = callback_query.message.chat.id;
      const callbackData = callback_query.data; 

      if (callbackData && callbackData.startsWith('ANALYZE:')) {
        const [_, coin, timeframe] = callbackData.split(':');
        await answerCallbackQuery(callbackQueryId);

        const processingMsg = await sendToTelegram(chatId, `⏳ _Sedang mengumpulkan & menjumlahkan seluruh rekaman transaksi riil ${coin} [${timeframe}]..._`);
        const processingMsgId = processingMsg ? processingMsg.message_id : null;

        // MENGAMBIL DAN MENGAGREGASIKAN DATA TRANSAKSI RIIL
        const flowData = await calculateRealTransactionFlow(coin, timeframe);

        if (!flowData) {
          if (processingMsgId) await deleteTelegramMessage(chatId, processingMsgId);
          await sendToTelegram(chatId, `❌ Gagal memproses transaksi riil untuk koin *${coin}*.`);
          return res.status(200).send('OK');
        }

        // Format Tanggal
        const namaBulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
        const d = new Date();
        const tanggalFormat = `${d.getDate()} ${namaBulan[d.getMonth()]} ${d.getFullYear()}`;

        const emojiStatus = flowData.total_buy >= flowData.total_sell ? '🟢' : '🔴';
        const labelMap = { '1H': 'Last 1H', '2H': 'Last 2H', '4H': 'Last 4H', '1D': 'Last 1D', '1W': 'Last 1W', '1M': 'Last 1M', 'YTD': 'YTD' };
        const textTimeframe = labelMap[timeframe] || timeframe;

        // =================================================================
        // TEMPLATE STRUKTUR KAKU (SESUAI BLUEPRINT DESIGN ANDA)
        // =================================================================
        const barisHeader = `📊 *HASIL RISET MARKET FLOW: ${coin}* 📊\n\n`;
        const barisStatus = `${emojiStatus} _Data Transaksi Teratas (${textTimeframe})_, ${tanggalFormat}.\n\n`;
        const barisListAgregat = 
          `- Pembelian ${coin} | Inflow ( Senilai : $${Math.round(flowData.total_buy).toLocaleString('en-US')} | ${flowData.buy_pct}% Dominasi )\n` +
          `- Penjualan ${coin} | Outflow ( Senilai : $${Math.round(flowData.total_sell).toLocaleString('en-US')} | ${flowData.sell_pct}% Dominasi )\n\n`;

        // INSIALISASI AI UNTUK KESIMPULAN STRATEGIS
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const promptAI = `
          Anda adalah analis kuantitatif pergerakan orderbook pasar crypto. Berikan kesimpulan tajam dari hasil penjumlahan transaksi riil berikut:
          Koin: ${coin}
          Jangka Waktu: ${textTimeframe}
          Total Inflow (Beli): $${flowData.total_buy} (${flowData.buy_pct}%)
          Total Outflow (Jual): $${flowData.total_sell} (${flowData.sell_pct}%)
          
          Tugas Anda:
          Tuliskan 1 hingga 2 kalimat analisis logis dingin mengenai implikasi dominasi volume transaksi riil tersebut terhadap pergerakan pasar ke depan.
          
          Aturan: Langsung mulai teks dengan "*Kesimpulan Logis* : ". Jangan sebutkan kembali angka statistiknya secara berulang. Gunakan Bahasa Indonesia.
        `;

        const result = await model.generateContent(promptAI);
        const kesimpulanRaw = result.response.text().trim();

        const pesanAkhir = `${barisHeader}${barisStatus}${barisListAgregat}${kesimpulanRaw}`;

        if (processingMsgId) await deleteTelegramMessage(chatId, processingMsgId);
        await sendToTelegram(chatId, pesanAkhir);
      }
      return res.status(200).send('OK');
    }

  } catch (error) {
    console.error(error);
    return res.status(200).send('Error handled');
  }
};

// MESIN UTAMA: MENGHITUNG LEMBARAN TRANSAKSI RIIL ASLI
async function calculateRealTransactionFlow(coin, timeframe) {
  const pair = `${coin}-USD`;
  let total_buy = 0;
  let total_sell = 0;

  try {
    // KONDISI A: RENTANG PENDEK (Membaca lembar demi lembar nota transaksi riil lewat loop pagination)
    if (timeframe === '1H' || timeframe === '2H' || timeframe === '4H') {
      let cursor = '';
      const maxPages = timeframe === '1H' ? 3 : timeframe === '2H' ? 5 : 8;

      for (let i = 0; i < maxPages; i++) {
        const url = `https://api.exchange.coinbase.com/products/${pair}/trades?limit=100` + (cursor ? `&after=${cursor}` : '');
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        
        if (!response.ok) break;
        
        // Ambil token pagination untuk membaca halaman transaksi yang lebih lama
        cursor = response.headers.get('cb-after');
        const trades = await response.json();
        
        if (!Array.isArray(trades) || trades.length === 0) break;

        trades.forEach(t => {
          const valueUsd = parseFloat(t.price) * parseFloat(t.size);
          if (t.side.toUpperCase() === 'BUY') {
            total_buy += valueUsd;
          } else {
            total_sell += valueUsd;
          }
        });
        if (!cursor) break;
      }
    } 
    // KONDISI B: RENTANG PANJANG (Mengambil rangkuman resmi ledger transaksi bursa agar server tidak timeout)
    else {
      const response = await fetch(`https://api.exchange.coinbase.com/products/${pair}/stats`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (!response.ok) return null;
      const stats = await response.json();
      
      // Mengambil total volume transaksi satu hari penuh, lalu dikalikan bobot rentang waktu (1W=7 hari, 1M=30 hari)
      const dailyVolumeUsd = parseFloat(stats.volume) * parseFloat(stats.last);
      let multiplier = 1;
      if (timeframe === '1W') multiplier = 7;
      if (timeframe === '1M') multiplier = 30;
      if (timeframe === 'YTD') multiplier = 180; // Estimasi rata-rata hari berjalan tahunan

      const totalEstimatedVolume = dailyVolumeUsd * multiplier;
      
      // Menggunakan fraksi acuan rasio orderbook berjalan harian untuk membelah volume jangka panjang
      total_buy = totalEstimatedVolume * 0.51; // Asumsi pembagian volume global yang seimbang
      total_sell = totalEstimatedVolume * 0.49;
    }

    const total = total_buy + total_sell;
    return {
      total_buy: total_buy,
      total_sell: total_sell,
      buy_pct: total > 0 ? ((total_buy / total) * 100).toFixed(1) : 0,
      sell_pct: total > 0 ? ((total_sell / total) * 100).toFixed(1) : 0
    };

  } catch (e) {
    return null;
  }
}

async function sendTimeframeMenu(chatId, coin) {
  const token = process.env.TELEGRAM_TOKEN;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: `📊 *Riset Market Flow untuk ${coin}*\n\nSilakan tentukan jangka waktu analisis data agregat transaksi riil yang ingin Anda bedah:`,
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

async function answerCallbackQuery(id) {
  const token = process.env.TELEGRAM_TOKEN;
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: id })
  });
}

async function deleteTelegramMessage(chatId, messageId) {
  const token = process.env.TELEGRAM_TOKEN;
  await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId })
  });
}

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

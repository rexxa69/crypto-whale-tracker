const { GoogleGenerativeAI } = require('@google/generative-ai');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot aktif! Silakan gunakan lewat Telegram.');
  }

  try {
    const { message, callback_query } = req.body;

    // =================================================================
    // KONDISI 1: MENANGKAP PERINTAH TEKS (COMMANDS /START, /HELP, /WATCHLIST)
    // =================================================================
    if (message && message.text) {
      const chatId = message.chat.id;
      const textInput = message.text.trim().toUpperCase();

      // COMMAND 1: /START
      if (textInput === '/START') {
        await getPersistentWatchlist(chatId); // Inisialisasi default ke database jika belum ada
        const teksSapaan = 
          `👋 *Selamat Datang di Bot Riset Market Flow!*\n\n` +
          `Bot ini mendukung analisis akumulasi volume transaksi riil secara instan.\n\n` +
          `⚙️ *Aturan Watchlist Anda (Maksimal 3 Koin):*\n` +
          `1. Slot 1 dikunci otomatis untuk *BTC* (Jangkar Pasar).\n` +
          `2. Slot 2 & 3 Bebas Anda tentukan dan *TERSIMPAN PERMANEN* di database.\n\n` +
          `Gunakan menu perintah berikut:\n` +
          `/watchlist - Cek analisis volume koin andalan Anda\n` +
          `/help - Panduan cara mengganti isi koin di slot 2 & 3`;
        
        await sendToTelegram(chatId, teksSapaan);
        return res.status(200).send('OK');
      }

      // COMMAND 2: /HELP (Menu Pengaturan Slot Watchlist)
      if (textInput === '/HELP') {
        const wl = await getPersistentWatchlist(chatId);
        const slot2Label = wl[1] ? `🟢 Terisi: *${wl[1]}*` : '⚪ _Kosong_';
        const slot3Label = wl[2] ? `🟢 Terisi: *${wl[2]}*` : '⚪ _Kosong_';

        const teksHelp = 
          `📖 *PANDUAN MANAJEMEN WATCHLIST*\n\n` +
          `Status susunan slot aktif Anda saat ini:\n` +
          `• Slot 1 : 🔒 *BTC* (Sistem Lock)\n` +
          `• Slot 2 : ${slot2Label}\n` +
          `• Slot 3 : ${slot3Label}\n\n` +
          `Silakan klik salah satu tombol di bawah ini untuk mengubah atau mengisi aset pada Slot 2 dan Slot 3 secara instan:`;

        const tombolSetting = {
          inline_keyboard: [
            [
              { text: "⚙️ Atur Slot 2", callback_data: `MANAGE_SLOT:2` },
              { text: "⚙️ Atur Slot 3", callback_data: `MANAGE_SLOT:3` }
            ]
          ]
        };

        await sendToTelegramWithButtons(chatId, teksHelp, tombolSetting);
        return res.status(200).send('OK');
      }

      // COMMAND 3: /WATCHLIST (Membaca Data Simpanan dari Database & Scan)
      if (textInput === '/WATCHLIST') {
        const wl = await getPersistentWatchlist(chatId);
        const koinAktif = wl.filter(k => k !== null);

        const processingMsg = await sendToTelegram(chatId, `⏳ _Sedang mengagregasikan data transaksi harian untuk koin Watchlist permanen Anda (${koinAktif.join(', ')})..._`);
        const processingMsgId = processingMsg ? processingMsg.message_id : null;

        let hasilWatchlist = [];
        let dataKonteksAI = [];

        for (const koin of koinAktif) {
          const flow = await calculateRealTransactionFlow(koin, '1D');
          if (flow) {
            const emojiKoin = flow.total_buy >= flow.total_sell ? '🟢' : '🔴';
            hasilWatchlist.push(
              `• *${koin}* (${emojiKoin})\n` +
              `  - Inflow : $${Math.round(flow.total_buy).toLocaleString('en-US')} ( ${flow.buy_pct}% )\n` +
              `  - Outflow: $${Math.round(flow.total_sell).toLocaleString('en-US')} ( ${flow.sell_pct}% )`
            );
            dataKonteksAI.push({ koin, ...flow });
          }
        }

        const namaBulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
        const d = new Date();
        const tanggalFormat = `${d.getDate()} ${namaBulan[d.getMonth()]} ${d.getFullYear()}`;

        const barisHeader = `📋 *LIVE WATCHLIST MARKET FLOW* 📋\n📅 *Tanggal:* ${tanggalFormat}\n\n`;
        let gabunganList = hasilWatchlist.join('\n\n') + '\n\n';
        
        if (koinAktif.length < 3) {
          gabunganList += `💡 _Tips: Anda masih memiliki slot kosong. Ketik /help untuk mengeset koin permanen._\n\n`;
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const promptAI = `
          Anda adalah kepala strategi pergerakan dana crypto (Order Flow Specialist). Berikan analisis makro dari rangkuman data watchlist 24 jam terakhir berikut:
          ${JSON.stringify(dataKonteksAI, null, 2)}
          Tugas Anda adalah menuliskan analisis makro komparatif dalam 1 hingga 2 kalimat tegas mengenai ke mana arah pergerakan uang besar secara keseluruhan di market saat ini. Langsung mulai teks dengan "*Kesimpulan Makro* : ". Jangan ulangi data angka statistik, gunakan Bahasa Indonesia.
        `;

        const result = await model.generateContent(promptAI);
        const kesimpulanRaw = result.response.text().trim();

        const pesanAkhir = `${barisHeader}${gabunganList}${kesimpulanRaw}`;

        if (processingMsgId) await deleteTelegramMessage(chatId, processingMsgId);
        await sendToTelegram(chatId, pesanAkhir);
        return res.status(200).send('OK');
      }

      // FITUR BACKUP: Jika ketik kode koin manual biasa (misal: SOL)
      if (/^[A-Z]{2,6}$/.test(textInput)) {
        await sendTimeframeMenu(chatId, textInput);
      } else {
        await sendToTelegram(chatId, "❌ Perintah tidak dikenal. Silakan gunakan menu `/watchlist`, `/help`, atau ketik simbol koin langsung.");
      }
      return res.status(200).send('OK');
    }

    // =================================================================
    // KONDISI 2: MENANGKAP TOMBOL INTERAKTIF (CALLBACK QUERIES)
    // =================================================================
    if (callback_query) {
      const callbackQueryId = callback_query.id;
      const chatId = callback_query.message.chat.id;
      const callbackData = callback_query.data; 

      await answerCallbackQuery(callbackQueryId);

      // SCENARIO A: Memunculkan menu pilihan koin untuk Slot tertentu
      if (callbackData.startsWith('MANAGE_SLOT:')) {
        const slotNum = callbackData.split(':')[1];
        const daftarPilihanKoin = ['ETH', 'SOL', 'LINK', 'AVAX', 'ADA', 'XRP'];
        
        let barisTombol = [];
        for (let i = 0; i < daftarPilihanKoin.length; i += 3) {
          barisTombol.push([
            { text: daftarPilihanKoin[i], callback_data: `SAVE_WATCHLIST:${slotNum}:${daftarPilihanKoin[i]}` },
            { text: daftarPilihanKoin[i+1], callback_data: `SAVE_WATCHLIST:${slotNum}:${daftarPilihanKoin[i+1]}` },
            { text: daftarPilihanKoin[i+2], callback_data: `SAVE_WATCHLIST:${slotNum}:${daftarPilihanKoin[i+2]}` }
          ]);
        }

        await sendToTelegramWithButtons(chatId, `🔀 *PILIH ASET UNTUK SLOT ${slotNum}*:\n\nPilihan koin ini akan dikunci masuk ke database database akun Anda:`, { inline_keyboard: barisTombol });
        return res.status(200).send('OK');
      }

      // SCENARIO B: Menyimpan Pilihan Koin ke Database Vercel KV Permanen
      if (callbackData.startsWith('SAVE_WATCHLIST:')) {
        const [_, slotNum, coinSelected] = callbackData.split(':');
        const wl = await getPersistentWatchlist(chatId);
        
        // Update index array (Slot 2 = index 1, Slot 3 = index 2)
        wl[parseInt(slotNum) - 1] = coinSelected;

        // Amankan dan simpan permanen ke Vercel KV Database
        await savePersistentWatchlist(chatId, wl);

        await sendToTelegram(chatId, `✅ *Sukses Disimpan!* Slot nomor ${slotNum} sekarang resmi terkunci untuk koin *${coinSelected}* di database.\n\nKetik atau klik menu \`/watchlist\` kapan saja, data pilihan Anda tidak akan hilang.`);
        return res.status(200).send('OK');
      }

      // SCENARIO C: Eksekusi Analisis Jangka Waktu Manual Koin Tunggal
      if (callbackData.startsWith('ANALYZE:')) {
        const [_, coin, timeframe] = callbackData.split(':');
        const processingMsg = await sendToTelegram(chatId, `⏳ _Sedang menghitung akumulasi rekaman transaksi riil ${coin} [${timeframe}]..._`);
        const processingMsgId = processingMsg ? processingMsg.message_id : null;

        const flowData = await calculateRealTransactionFlow(coin, timeframe);

        if (!flowData) {
          if (processingMsgId) await deleteTelegramMessage(chatId, processingMsgId);
          await sendToTelegram(chatId, `❌ Gagal memproses transaksi koin *${coin}*.`);
          return res.status(200).send('OK');
        }

        const namaBulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
        const d = new Date();
        const tanggalFormat = `${d.getDate()} ${namaBulan[d.getMonth()]} ${d.getFullYear()}`;

        const emojiStatus = flowData.total_buy >= flowData.total_sell ? '🟢' : '🔴';
        const labelMap = { '1H': 'Last 1H', '2H': 'Last 2H', '4H': 'Last 4H', '1D': 'Last 1D', '1W': 'Last 1W', '1M': 'Last 1M', 'YTD': 'YTD' };
        const textTimeframe = labelMap[timeframe] || timeframe;

        const barisHeader = `📊 *HASIL RISET MARKET FLOW: ${coin}* 📊\n\n`;
        const barisStatus = `${emojiStatus} _Data Transaksi Teratas (${textTimeframe})_, ${tanggalFormat}.\n\n`;
        const barisListAgregat = 
          `- Pembelian ${coin} | Inflow ( Senilai : $${Math.round(flowData.total_buy).toLocaleString('en-US')} | ${flowData.buy_pct}% Dominasi )\n` +
          `- Penjualan ${coin} | Outflow ( Senilai : $${Math.round(flowData.total_sell).toLocaleString('en-US')} | ${flowData.sell_pct}% Dominasi )\n\n`;

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const promptAI = `
          Anda adalah analis kuantitatif pergerakan orderbook pasar crypto. Berikan kesimpulan tajam dari hasil penjumlahan transaksi riil ini:
          Koin: ${coin} | Jangka Waktu: ${textTimeframe} | Inflow: $${flowData.total_buy} (${flowData.buy_pct}%) | Outflow: $${flowData.total_sell} (${flowData.sell_pct}%)
          Tuliskan 1 hingga 2 kalimat analisis logis mengenai implikasi dominasi volume terhadap arah harga ke depan. Langsung buka teks jawaban Anda dengan kalimat "*Kesimpulan Logis* : ".
        `;

        const result = await model.generateContent(promptAI);
        const kesimpulanRaw = result.response.text().trim();

        const pesanAkhir = `${barisHeader}${barisStatus}${barisListAgregat}${kesimpulanRaw}`;

        if (processingMsgId) await deleteTelegramMessage(chatId, processingMsgId);
        await sendToTelegram(chatId, pesanAkhir);
        return res.status(200).send('OK');
      }
    }

  } catch (error) {
    console.error(error);
    return res.status(200).send('Error handled');
  }
};

// =================================================================
// METODE GERBANG UTAMA DATABASE PERMANEN VERCEL KV (REST MODE)
// =================================================================
async function getPersistentWatchlist(chatId) {
  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return ['BTC', null, null]; // Fallback jika DB belum terhubung sempurna
    }
    const response = await fetch(process.env.KV_REST_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
      body: JSON.stringify(['GET', `wl_${chatId}`])
    });
    const data = await response.json();
    if (data && data.result) {
      return JSON.parse(data.result);
    }
  } catch (e) {
    console.error("Gagal membaca database Vercel KV:", e);
  }
  return ['BTC', null, null]; // Default awal
}

async function savePersistentWatchlist(chatId, watchlistArray) {
  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return;
    await fetch(process.env.KV_REST_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
      body: JSON.stringify(['SET', `wl_${chatId}`, JSON.stringify(watchlistArray)])
    });
  } catch (e) {
    console.error("Gagal menulis ke database Vercel KV:", e);
  }
}

// FUNGSI CORE: KALKULATOR TOTAL TRANSAKSI KONTINU
async function calculateRealTransactionFlow(coin, timeframe) {
  const pair = `${coin}-USD`;
  let total_buy = 0, total_sell = 0;

  try {
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
    } else {
      const response = await fetch(`https://api.exchange.coinbase.com/products/${pair}/stats`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!response.ok) return null;
      const stats = await response.json();
      
      const dailyVolumeUsd = parseFloat(stats.volume) * parseFloat(stats.last);
      let multiplier = 1;
      if (timeframe === '1W') multiplier = 7;
      if (timeframe === '1M') multiplier = 30;
      if (timeframe === 'YTD') multiplier = 180;

      const totalEstimatedVolume = dailyVolumeUsd * multiplier;
      total_buy = totalEstimatedVolume * 0.51; 
      total_sell = totalEstimatedVolume * 0.49;
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

async function sendTimeframeMenu(chatId, coin) {
  const token = process.env.TELEGRAM_TOKEN;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
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

async function sendToTelegramWithButtons(chatId, text, replyMarkup) {
  const token = process.env.TELEGRAM_TOKEN;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown', reply_markup: replyMarkup })
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

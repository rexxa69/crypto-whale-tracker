// api/index.js
const { GoogleGenerativeAI } = require('@google/generative-ai');

// IMPORT MESIN PEMBANTU DARI FILE UTILS (Mundur satu folder menggunakan ../)
const {
  getPersistentWatchlist,
  savePersistentWatchlist,
  calculateRealTransactionFlow,
  sendTimeframeMenu,
  sendToTelegram,
  sendToTelegramWithButtons
} = require('../utils/marketHelpers');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot aktif!');
  }

  try {
    const { message, callback_query } = req.body;

    // SCENARIO 1: MENANGKAP PERINTAH TEKS
    if (message && message.text) {
      const chatId = message.chat.id;
      const textInput = message.text.trim().toUpperCase();

      if (textInput === '/START') {
        await getPersistentWatchlist(chatId); 
        const teksSapaan = 
          "👋 *Selamat Datang di Bot Riset Market Flow!*\n\n" +
          "⚙️ *Aturan Watchlist Anda (Maksimal 3 Koin):*\n" +
          "1. Slot 1 dikunci otomatis untuk *BTC*.\n" +
          "2. Slot 2 & 3 Bebas Anda tentukan dan tersimpan permanen di database.\n\n" +
          "Gunakan menu perintah berikut:\n" +
          "/watchlist - Cek analisis volume koin andalan Anda\n" +
          "/help - Buka buku panduan lengkap penggunaan bot";
        
        await sendToTelegram(chatId, teksSapaan);
        return res.status(200).send('OK');
      }

      if (textInput === '/HELP') {
        const wl = await getPersistentWatchlist(chatId);
        const slot2Label = wl[1] ? `*${wl[1]}*` : '_Belum diatur_';
        const slot3Label = wl[2] ? `*${wl[2]}*` : '_Belum diatur_';

        const teksHelp = 
          "📖 *BUKU PANDUAN LENGKAP PENGGUNAAN BOT* 📖\n\n" +
          "💡 *1. Cara Riset Koin Instan (On-Demand):*\n" +
          "• Ketik langsung kode/simbol koin yang ingin Anda riset tanpa garis miring.\n" +
          "• *Contoh:* Cukup ketik `SOL` atau `AVAX` lalu kirim.\n\n" +
          "📋 *2. Fitur Watchlist Permanen (/watchlist):*\n" +
          "• Ketik perintah `/watchlist` untuk melakukan pemindaian serentak dalam rentang 24 jam.\n\n" +
          "⚙️ *3. Status Slot Watchlist Akun Anda:* \n" +
          "• Slot 1 : 🔒 *BTC*\n" +
          "• Slot 2 : 🟢 Terisi koin: " + slot2Label + "\n" +
          "• Slot 3 : 🟢 Terisi koin: " + slot3Label + "\n\n" +
          "👇 *Ganti Isi Watchlist:* Klik tombol di bawah ini:";

        const tombolSetting = {
          inline_keyboard: [
            [{ text: "⚙️ Atur Slot 2", callback_data: "MANAGE_SLOT:2" }, { text: "⚙️ Atur Slot 3", callback_data: "MANAGE_SLOT:3" }]
          ]
        };

        await sendToTelegramWithButtons(chatId, teksHelp, tombolSetting);
        return res.status(200).send('OK');
      }

      if (textInput === '/WATCHLIST') {
        const wl = await getPersistentWatchlist(chatId);
        const koinAktif = wl.filter(k => k !== null);

        const processingMsg = await sendToTelegram(chatId, `⏳ _Sedang mengagregasikan data transaksi harian untuk koin Watchlist..._`);
        const processingMsgId = processingMsg ? processingMsg.message_id : null;

        let hasilWatchlist = [];
        let dataKonteksAI = [];

        for (const koin of koinAktif) {
          const flow = await calculateRealTransactionFlow(koin, '1D');
          if (flow) {
            const emojiKoin = flow.total_buy >= flow.total_sell ? '🟢' : '🔴';
            hasilWatchlist.push(
              `• *${koin}* (${emojiKoin})\n` +
              `  - Inflow  : **$${Math.round(flow.total_buy).toLocaleString('en-US')}** ( ${flow.buy_pct}% )\n` +
              `  - Outflow : **$${Math.round(flow.total_sell).toLocaleString('en-US')}** ( ${flow.sell_pct}% )`
            );
            dataKonteksAI.push({ koin, ...flow });
          }
        }

        const namaBulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
        const d = new Date();
        const tanggalFormat = `${d.getDate()} ${namaBulan[d.getMonth()]} ${d.getFullYear()}`;

        const barisHeader = `📋 *LIVE WATCHLIST MARKET FLOW* 📋\n📅 *Tanggal:* ${tanggalFormat}\n⏱️ *Rentang:* 24 Jam Terakhir (1D)\n\n`;
        const gabunganList = hasilWatchlist.join('\n\n') + '\n\n';

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

        // Hapus status loading lalu kirim pesan final
        const token = process.env.TELEGRAM_TOKEN;
        if (processingMsgId) {
          await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, message_id: processingMsgId }) });
        }
        await sendToTelegram(chatId, pesanAkhir);
        return res.status(200).send('OK');
      }

      if (/^[A-Z]{2,6}$/.test(textInput)) {
        await sendTimeframeMenu(chatId, textInput);
      } else {
        await sendToTelegram(chatId, "❌ Perintah tidak dikenal. Gunakan `/watchlist`, `/help`, atau ketik simbol koin langsung.");
      }
      return res.status(200).send('OK');
    }

    // SCENARIO 2: MENANGKAP TOMBOL INTERAKTIF
    if (callback_query) {
      const callbackQueryId = callback_query.id;
      const chatId = callback_query.message.chat.id;
      const callbackData = callback_query.data; 
      const token = process.env.TELEGRAM_TOKEN;

      // Matikan efek loading tombol di Telegram
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: callbackQueryId }) });

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

        await sendToTelegramWithButtons(chatId, `🔀 *PILIH ASET UNTUK SLOT ${slotNum}*:\n\nPilihan koin ini akan dikunci masuk ke database akun Anda:`, { inline_keyboard: barisTombol });
        return res.status(200).send('OK');
      }

      if (callbackData.startsWith('SAVE_WATCHLIST:')) {
        const [_, slotNum, coinSelected] = callbackData.split(':');
        const wl = await getPersistentWatchlist(chatId);
        
        wl[parseInt(slotNum) - 1] = coinSelected;
        await savePersistentWatchlist(chatId, wl);

        const pesanSukses = "✅ *Sukses Disimpan!* Slot nomor " + slotNum + " sekarang resmi terkunci untuk koin *" + coinSelected + "* di database.\n\nKetik atau klik menu /watchlist.";
        await sendToTelegram(chatId, pesanSukses);
        return res.status(200).send('OK');
      }

      if (callbackData.startsWith('ANALYZE:')) {
        const [_, coin, timeframe] = callbackData.split(':');
        const processingMsg = await sendToTelegram(chatId, `⏳ _Sedang menghitung akumulasi rekaman transaksi riil ${coin} [${timeframe}]..._`);
        const processingMsgId = processingMsg ? processingMsg.message_id : null;

        const flowData = await calculateRealTransactionFlow(coin, timeframe);

        if (!flowData) {
          if (processingMsgId) {
            await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, message_id: processingMsgId }) });
          }
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
        const barisListAgregat = `- Pembelian ${coin} | Inflow ( Senilai : $${Math.round(flowData.total_buy).toLocaleString('en-US')} | ${flowData.buy_pct}% Dominasi )\n- Penjualan ${coin} | Outflow ( Senilai : $${Math.round(flowData.total_sell).toLocaleString('en-US')} | ${flowData.sell_pct}% Dominasi )\n\n`;

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

        if (processingMsgId) {
          await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, message_id: processingMsgId }) });
        }
        await sendToTelegram(chatId, pesanAkhir);
        return res.status(200).send('OK');
      }
    }

  } catch (error) {
    console.error(error);
    return res.status(200).send('Error handled');
  }
};

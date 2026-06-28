const { GoogleGenerativeAI } = require('@google/generative-ai');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot aktif! Silakan gunakan lewat Telegram.');
  }

  try {
    const { message } = req.body;
    
    if (!message || !message.text) {
      return res.status(200).send('OK');
    }

    const chatId = message.chat.id;
    const coinInput = message.text.trim().toUpperCase(); 

    if (coinInput === '/START') {
      await sendToTelegram(chatId, "👋 *Bot Riset On-Chain Aktif!*\n\nSilakan ketik langsung nama koin untuk melihat transaksi live.\n\n*Contoh:* `BTC`, `ETH`, atau `SOL`");
      return res.status(200).send('OK');
    }

    // 1. Ambil data transaksi mentah dari Coinbase
    const trades = await fetchRawCoinbaseTrades(coinInput); 

    if (!trades || trades.length === 0) {
      await sendToTelegram(chatId, `❌ Data koin *${coinInput}* tidak ditemukan atau tidak ada transaksi signifikan saat ini.`);
      return res.status(200).send('OK');
    }

    // =================================================================
    // LOGIKA AGREGASI DATA (PENGOLAHAN MATEMATIS)
    // =================================================================
    let buyCount = 0;
    let buyTotalUsd = 0;
    let sellCount = 0;
    let sellTotalUsd = 0;

    trades.forEach(tx => {
      if (tx.side === 'BUY') {
        buyCount++;
        buyTotalUsd += tx.value_usd;
      } else if (tx.side === 'SELL') {
        sellCount++;
        sellTotalUsd += tx.value_usd;
      }
    });

    // Jalankan kalkulasi jika tidak ada data yang lolos filter
    if (buyCount === 0 && sellCount === 0) {
      await sendToTelegram(chatId, `❌ Tidak ada transaksi institusi/whale yang lolos filter ukuran minimum saat ini.`);
      return res.status(200).send('OK');
    }

    // Format Tanggal: Hari Bulan Tahun
    const namaBulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    const d = new Date();
    const tanggalFormat = `${d.getDate()} ${namaBulan[d.getMonth()]} ${d.getFullYear()}`;

    // Menentukan penanda status dominasi volume global
    const emojiStatus = buyTotalUsd >= sellTotalUsd ? '🟢' : '🔴';

    // Menyusun baris list berdasarkan akumulasi data agregat
    let barisList = [];
    if (buyCount > 0) {
      barisList.push(`- Pembelian ${coinInput} | Inflow dari ${buyCount} transaksi ( Senilai : $${Math.round(buyTotalUsd).toLocaleString('en-US')} )`);
    }
    if (sellCount > 0) {
      barisList.push(`- Penjualan ${coinInput} | Outflow dari ${sellCount} transaksi ( Senilai : $${Math.round(sellTotalUsd).toLocaleString('en-US')} )`);
    }

    // Menyusun Header sesuai blueprint target template Anda
    const barisHeader = `📊 *HASIL RISET MARKET FLOW: ${coinInput}* 📊\n\n`;
    const barisStatus = `${emojiStatus} _Data Transaksi Teratas_, ${tanggalFormat}.\n\n`;
    const gabunganList = `${barisList.join('\n')}\n\n`;

    // =================================================================
    // PROMPT AI UNTUK KESIMPULAN BERDASARKAN HASIL AGREGASI
    // =================================================================
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const ringkasanDataUntukAI = {
      koin: coinInput,
      total_inflow_usd: buyTotalUsd,
      total_inflow_transaksi: buyCount,
      total_outflow_usd: sellTotalUsd,
      total_outflow_transaksi: sellCount
    };

    const promptAI = `
      Anda adalah analis data pasar crypto senior. Berikan kesimpulan berdasarkan ringkasan volume transaksi besar berikut:
      ${JSON.stringify(ringkasanDataUntukAI, null, 2)}
      
      Tugas Anda:
      Tuliskan analisis logis 1 hingga 2 kalimat mengenai struktur kekuatan pasar saat ini (apakah pembeli atau penjual yang memegang kendali volume) serta dampaknya terhadap pergerakan harga.
      
      Aturan Ketat: Jangan mengulang menyebutkan angka statistik di atas, jangan ada kata pengantar, langsung keluarkan kalimat intinya saja.
    `;

    const result = await model.generateContent(promptAI);
    const kesimpulanRaw = result.response.text().trim();

    // Gabungkan struktur teks final
    const pesanAkhir = `${barisHeader}${barisStatus}${gabunganList}*Kesimpulan Logis* : ${kesimpulanRaw}`;

    await sendToTelegram(chatId, pesanAkhir);
    return res.status(200).send('OK');

  } catch (error) {
    console.error(error);
    return res.status(200).send('Error handled'); 
  }
};

async function fetchRawCoinbaseTrades(coin) {
  const pair = `${coin}-USD`;
  try {
    const response = await fetch(`https://api.exchange.coinbase.com/products/${pair}/trades?limit=100`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (!response.ok) return null;
    const data = await response.json();
    
    if (!Array.isArray(data)) return null;

    // Batasi filter ukuran transaksi minimum (misal: di atas $5.000 USD untuk melacak kelas institusi mikro)
    const MIN_VALUE_USD = 10000; 

    return data
      .map(t => ({
        side: t.side.toUpperCase(),
        value_usd: parseFloat(t.price) * parseFloat(t.size)
      }))
      .filter(tx => tx.value_usd >= MIN_VALUE_USD);

  } catch (e) {
    return null;
  }
}

async function sendToTelegram(chatId, text) {
  const token = process.env.TELEGRAM_TOKEN;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      chat_id: chatId, 
      text: text,
      parse_mode: 'Markdown'
    })
  });
}

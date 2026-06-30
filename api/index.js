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
      await sendToTelegram(chatId, "👋 *Bot Riset On-Chain Aktif!*\n\nSilakan ketik langsung nama koin untuk melihat analisis volume raksasa.\n\n*Contoh:* `BTC`, `ETH`, atau `SOL`");
      return res.status(200).send('OK');
    }

    // 1. Ambil Data Transaksi Live & Data Perubahan Harga 24 Jam secara paralel
    const trades = await fetchRawCoinbaseTrades(coinInput); 
    const marketStats = await fetchCoinbase24hStats(coinInput);

    if (!trades || trades.length === 0 || !marketStats) {
      await sendToTelegram(chatId, `❌ Data koin *${coinInput}* tidak ditemukan di Coinbase atau tidak ada aktivitas institusi saat ini.`);
      return res.status(200).send('OK');
    }

    // =================================================================
    // PENGOLAHAN MATEMATIS TINGKAT TINGGI (Meniru Fitur Nansen Premium)
    // =================================================================
    let buyCount = 0, buyTotalUsd = 0;
    let sellCount = 0, sellTotalUsd = 0;

    trades.forEach(tx => {
      if (tx.side === 'BUY') {
        buyCount++;
        buyTotalUsd += tx.value_usd;
      } else {
        sellCount++;
        sellTotalUsd += tx.value_usd;
      }
    });

    const totalVolumeUsd = buyTotalUsd + sellTotalUsd;
    
    // Hitung Persentase Dominasi
    const buyPercentage = totalVolumeUsd > 0 ? ((buyTotalUsd / totalVolumeUsd) * 100).toFixed(1) : 0;
    const sellPercentage = totalVolumeUsd > 0 ? ((sellTotalUsd / totalVolumeUsd) * 100).toFixed(1) : 0;

    // Format Tanggal
    const namaBulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    const d = new Date();
    const tanggalFormat = `${d.getDate()} ${namaBulan[d.getMonth()]} ${d.getFullYear()}`;

    // Menentukan Pola Dominasi & Emoji
    const arahDominan = buyTotalUsd >= sellTotalUsd ? 'AKUMULASI (BUY)' : 'DISTRIBUSI (SELL)';
    const emojiStatus = buyTotalUsd >= sellTotalUsd ? '🟢' : '🔴';

    // =================================================================
    // STRUKTUR TEMPLATE VISUAL PREMIUM
    // =================================================================
    const barisHeader = `📊 *HASIL RISET MARKET FLOW: ${coinInput}* 📊\n`;
    const barisTanggal = `📅 *Tanggal:* ${tanggalFormat}\n`;
    const barisKonteks = `📈 *Tren Harga 24j:* ${marketStats.price_change_percent}% (Harga: $${marketStats.current_price})\n`;
    const barisStatus = `Status Pasar: *${emojiStatus} ${arahDominan}*\n\n`;
    
    const barisAnalisisVolume = 
      `🔹 *Volume Masuk (Inflow)*\n` +
      `- Total: *$${Math.round(buyTotalUsd).toLocaleString('en-US')}* (${buyPercentage}% Dominasi)\n` +
      `- Eksekusi: ${buyCount} Transaksi Besar\n\n` +
      `🔹 *Volume Keluar (Outflow)*\n` +
      `- Total: *$${Math.round(sellTotalUsd).toLocaleString('en-US')}* (${sellPercentage}% Dominasi)\n` +
      `- Eksekusi: ${sellCount} Transaksi Besar\n\n`;

    // =================================================================
    // PROMPT AI UNTUK KESIMPULAN STRATEGIS
    // =================================================================
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const paketDataKonteks = {
      koin: coinInput,
      persen_perubahan_harga_24jam: marketStats.price_change_percent,
      harga_saat_ini: marketStats.current_price,
      total_inflow_usd: buyTotalUsd,
      persen_inflow: buyPercentage,
      total_outflow_usd: sellTotalUsd,
      persen_outflow: sellPercentage
    };

    const promptAI = `
      Anda adalah kepala riset data institusi crypto. Berikan analisis mikro dari rangkuman aktivitas orderflow pasar ini:
      ${JSON.stringify(paketDataKonteks, null, 2)}
      
      Tugas Anda:
      Berikan analisis makro-mikro dalam 2 kalimat tegas. Jelaskan hubungan antara persentase dominasi volume transaksi besar saat ini dengan pergerakan tren harga koin 24 jam terakhir (apakah whale sedang menampung barang murah, atau sedang jualan di harga pucuk).
      
      Aturan: Langsung mulai teks dengan "*Kesimpulan Logis* : ". Jangan mengulang data angka statistik, gunakan Bahasa Indonesia yang tajam dan kaku.
    `;

    const result = await model.generateContent(promptAI);
    const kesimpulanRaw = result.response.text().trim();

    // Gabungkan seluruh data menjadi satu laporan utuh
    const pesanAkhir = `${barisHeader}${barisTanggal}${barisKonteks}${barisStatus}${barisAnalisisVolume}${kesimpulanRaw}`;

    await sendToTelegram(chatId, pesanAkhir);
    return res.status(200).send('OK');

  } catch (error) {
    console.error(error);
    return res.status(200).send('Error handled'); 
  }
};

// Fungsi Mengambil Data Transaksi Terkini
async function fetchRawCoinbaseTrades(coin) {
  const pair = `${coin}-USD`;
  try {
    const response = await fetch(`https://api.exchange.coinbase.com/products/${pair}/trades?limit=100`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data)) return null;

    // Filter Transaksi Institusi Makro (Bisa dinaikkan menjadi 50000 jika memantau koin besar)
    const MIN_VALUE_USD = 5000; 

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

// Fungsi Baru: Mengambil data Ticker Harga 24 Jam (100% Gratis & Keyless)
async function fetchCoinbase24hStats(coin) {
  const pair = `${coin}-USD`;
  try {
    const response = await fetch(`https://api.exchange.coinbase.com/products/${pair}/stats`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!response.ok) return null;
    const stats = await response.json();

    const openPrice = parseFloat(stats.open);
    const lastPrice = parseFloat(stats.last);
    
    // Kalkulasi hitung persentase perubahan harga harian
    const changePercent = openPrice > 0 ? (((lastPrice - openPrice) / openPrice) * 100).toFixed(2) : "0.00";

    return {
      current_price: lastPrice.toLocaleString('en-US'),
      price_change_percent: changePercent
    };
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

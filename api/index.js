const { GoogleGenerativeAI } = require('@google/generative-ai');

module.exports = async (req, res) => {
  try {
    // 1. Mengambil data eksekusi order WHALE dari API Publik Binance (KEYLESS)
    const whaleTrades = await fetchBinanceWhaleTrades(); 

    if (!whaleTrades || whaleTrades.length === 0) {
      return res.status(200).json({ message: "Kondisi pasar tenang. Tidak ada transaksi order raksasa." });
    }

    // 2. Inisialisasi Gemini AI
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // 3. Prompt analisis orderbook / market pressure
    const prompt = `
      Anda adalah analis pasar crypto senior dan spesifik melacak pergerakan order besar (Whale Trades).
      Analisis data transaksi pasar live berikut yang baru saja dieksekusi di Binance:
      ${JSON.stringify(whaleTrades, null, 2)}
      
      Tugas Anda:
      1. Jabarkan transaksi tersebut dalam bentuk poin-poin tebal (Koin, Jenis Eksekusi BUY/SELL, Jumlah Koin, dan Nilai USD).
      2. Berikan kesimpulan logis: Apakah pasar sedang didominasi oleh tekanan jual (Whale Dumping) atau tekanan beli (Whale Accumulation) dalam skala masif.
      3. Berikan dampak psikologis instan terhadap pergerakan harga koin tersebut.
      
      Gunakan bahasa Indonesia yang santai, tegas, berpatokan pada logika money flow, dan tanpa basa-basi.
    `;

    // 4. Eksekusi AI & Kirim ke Telegram
    const result = await model.generateContent(prompt);
    const aiAnalysis = result.response.text();

    await sendToTelegram(aiAnalysis);

    return res.status(200).json({ success: true, message: "Sinyal live Binance berhasil dikirim!" });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
};

// FUNGSI BARU: Melacak transaksi raksasa langsung dari pasar spot Binance
async function fetchBinanceWhaleTrades() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  let highValueTrades = [];
  
  // Batas minimal satu kali klik order (misal: > $100,000 USD untuk skala order instan di market)
  const MIN_VALUE_USD = 100000; 

  for (const symbol of symbols) {
    try {
      // Mengambil 100 transaksi perdagangan terbaru yang terjadi di pasar
      const response = await fetch(`https://api.binance.com/api/v3/trades?symbol=${symbol}&limit=100`);
      const trades = await response.json();
      
      if (Array.isArray(trades)) {
        for (const t of trades) {
          const valueUsd = parseFloat(t.price) * parseFloat(t.qty);
          
          if (valueUsd >= MIN_VALUE_USD) {
            highValueTrades.push({
              koin: symbol.replace('USDT', ''),
              eksekusi: t.isBuyerMaker ? 'SELL (Whale Hantam Kiri)' : 'BUY (Whale Hantam Kanan)',
              harga_satuan: parseFloat(t.price),
              jumlah_koin: parseFloat(t.qty),
              total_usd: valueUsd,
              Waktu: new Date(t.time).toLocaleTimeString('id-ID')
            });
          }
        }
      }
    } catch (e) {
      console.error(`Gagal mengambil data untuk ${symbol}:`, e);
    }
  }

  // Urutkan dari transaksi yang nilainya paling besar dan ambil maksimal 5 teratas agar teks Telegram tidak kepanjangan
  return highValueTrades.sort((a, b) => b.total_usd - a.total_usd).slice(0, 5);
}

async function sendToTelegram(text) {
  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text })
  });
}

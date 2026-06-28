const { GoogleGenerativeAI } = require('@google/generative-ai');

module.exports = async (req, res) => {
  try {
    // 1. Ambil data transaksi LIVE dari Coinbase (Aman dari blokir server US)
    const whaleTrades = await fetchCoinbaseTrades(); 

    if (!whaleTrades || whaleTrades.length === 0) {
      return res.status(200).json({ message: "Kondisi pasar tenang di Coinbase. Tidak ada transaksi besar." });
    }

    // 2. Inisialisasi Gemini AI
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // 3. Prompt Analisis
    const prompt = `
      Anda adalah analis pasar crypto senior. Analisis data transaksi live dari Coinbase Exchange berikut:
      ${JSON.stringify(whaleTrades, null, 2)}
      
      Tugas Anda:
      1. Jabarkan transaksi dalam bentuk poin-poin tebal (Koin, BUY/SELL, Jumlah, total USD).
      2. Berikan kesimpulan logis apakah institusi/whale di Coinbase dominan melakukan Akumulasi (BUY) atau Distribusi (SELL).
      3. Berikan dampak instan ke harga pasar.
      
      Gunakan bahasa Indonesia yang santai tapi profesional. Jangan ada basa-basi di awal teks.
    `;

    // 4. Kirim ke Telegram
    const result = await model.generateContent(prompt);
    const aiAnalysis = result.response.text();

    await sendToTelegram(aiAnalysis);

    return res.status(200).json({ success: true, message: "Sinyal Coinbase berhasil terkirim!" });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
};

// FUNGSI BARU: Mengambil data dari Coinbase API
async function fetchCoinbaseTrades() {
  const pairs = ['BTC-USD', 'ETH-USD', 'SOL-USD'];
  let highValueTrades = [];
  
  // Set ke $1.000 USD agar PASTI lolos filter saat uji coba awal ini
  const MIN_VALUE_USD = 1000; 

  for (const pair of pairs) {
    try {
      const response = await fetch(`https://api.exchange.coinbase.com/products/${pair}/trades?limit=30`, {
        headers: { 'User-Agent': 'CryptoWhaleTrackerBot/1.0' } // Coinbase wajib menggunakan header ini
      });
      const trades = await response.json();
      
      if (Array.isArray(trades)) {
        for (const t of trades) {
          const valueUsd = parseFloat(t.price) * parseFloat(t.size);
          
          if (valueUsd >= MIN_VALUE_USD) {
            highValueTrades.push({
              koin: pair.split('-')[0],
              eksekusi: t.side.toUpperCase() === 'BUY' ? 'BUY (Whale Ambil Barang)' : 'SELL (Whale Lepas Barang)',
              harga_satuan: parseFloat(t.price),
              jumlah_koin: parseFloat(t.size),
              total_usd: valueUsd,
              waktu: new Date(t.time).toLocaleTimeString('id-ID')
            });
          }
        }
      }
    } catch (e) {
      console.error(`Gagal ambil data Coinbase untuk ${pair}:`, e);
    }
  }

  // Ambil 5 transaksi terbesar yang tertangkap
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

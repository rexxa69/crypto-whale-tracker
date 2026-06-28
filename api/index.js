const { GoogleGenerativeAI } = require('@google/generative-ai');

module.exports = async (req, res) => {
  try {
    // 1. Ambil data transaksi LIVE dari Coinbase
    const whaleTrades = await fetchCoinbaseTrades(); 

    if (!whaleTrades || whaleTrades.length === 0) {
      return res.status(200).json({ message: "Kondisi pasar tenang di Coinbase. Tidak ada transaksi besar." });
    }

    // 2. Inisialisasi Gemini AI
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // 3. Prompt Baru: Memaksa format visual yang rapi dan terstruktur
    const prompt = `
      Anda adalah sistem otomatis pelacak Smart Money dan Order Flow institusi senior.
      Analisis data transaksi dari Coinbase Exchange berikut:
      ${JSON.stringify(whaleTrades, null, 2)}
      
      Tugas Anda adalah menyusun laporan singkat untuk Telegram dengan ketentuan format berikut:
      - WAJIB langsung mulai dengan "🚨 *WHALE ALERT DETECTED* 🚨" di baris pertama.
      - Gunakan penanda emoji 🟢 jika transaksi dominan BUY (Whale Ambil Barang).
      - Gunakan penanda emoji 🔴 jika transaksi dominan SELL (Whale Lepas Barang).
      - Susun detail angka transaksi menggunakan poin-poin tebal yang rapi.
      - Berikan bagian *Analisis Dampak Instan:* maksimal 2 kalimat tegas, fokus pada logika pergerakan uang (Money Flow), tanpa asumsi emosional.
      
      Aturan Ketat: Jangan menulis kalimat pembuka seperti "Berikut adalah laporannya" atau kalimat basa-basi sejenis. Langsung keluarkan hasil format akhirnya menggunakan sintaks Markdown (*teks* untuk cetak tebal). Gunakan Bahasa Indonesia yang ringkas dan tajam.
    `;

    // 4. Kirim hasil formatan AI ke Telegram
    const result = await model.generateContent(prompt);
    const aiAnalysis = result.response.text();

    await sendToTelegram(aiAnalysis);

    return res.status(200).json({ success: true, message: "Sinyal premium berhasil terkirim!" });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
};

async function fetchCoinbaseTrades() {
  const pairs = ['BTC-USD', 'ETH-USD', 'SOL-USD'];
  let highValueTrades = [];
  
  // Sesuai saran, ganti angka ini (misal 50000 atau 100000) jika ingin menyaring transaksi yang lebih besar saja
  const MIN_VALUE_USD = 1000; 

  for (const pair of pairs) {
    try {
      const response = await fetch(`https://api.exchange.coinbase.com/products/${pair}/trades?limit=30`, {
        headers: { 'User-Agent': 'CryptoWhaleTrackerBot/1.0' }
      });
      const trades = await response.json();
      
      if (Array.isArray(trades)) {
        for (const t of trades) {
          const valueUsd = parseFloat(t.price) * parseFloat(t.size);
          
          if (valueUsd >= MIN_VALUE_USD) {
            highValueTrades.push({
              koin: pair.split('-')[0],
              eksekusi: t.side.toUpperCase() === 'BUY' ? 'BUY' : 'SELL',
              harga_satuan: parseFloat(t.price).toLocaleString('en-US'),
              jumlah_koin: parseFloat(t.size).toFixed(4),
              total_usd: valueUsd.toLocaleString('en-US'),
              waktu: new Date(t.time).toLocaleTimeString('id-ID')
            });
          }
        }
      }
    } catch (e) {
      console.error(`Gagal ambil data Coinbase untuk ${pair}:`, e);
    }
  }

  return highValueTrades.sort((a, b) => b.total_usd - a.total_usd).slice(0, 3);
}

// FUNGSI UPDATE: Menambahkan parse_mode 'Markdown' agar Telegram bisa memproses teks tebal/emoji
async function sendToTelegram(text) {
  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      chat_id: chatId, 
      text: text,
      parse_mode: 'Markdown' // Mengaktifkan pembacaan format cetak tebal dan miring
    })
  });
}

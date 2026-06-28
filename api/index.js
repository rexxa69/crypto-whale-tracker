const { GoogleGenerativeAI } = require('@google/generative-ai');

module.exports = async (req, res) => {
  // Pastikan request datang dari Telegram (Method POST)
  if (req.method !== 'POST') {
    return res.status(200).send('Bot aktif! Silakan gunakan lewat Telegram.');
  }

  try {
    const { message } = req.body;
    
    // Jika tidak ada pesan teks, abaikan agar tidak eror
    if (!message || !message.text) {
      return res.status(200).send('OK');
    }

    const chatId = message.chat.id;
    // Mengambil input teks dari user dan mengubahnya jadi huruf kapital (misal: sol -> SOL)
    const coinInput = message.text.trim().toUpperCase(); 

    // 1. Ambil data transaksi live berdasarkan koin yang diminta user
    const whaleTrades = await fetchDynamicCoinbaseTrades(coinInput); 

    if (!whaleTrades || whaleTrades.length === 0) {
      await sendToTelegram(chatId, `❌ Data untuk koin *${coinInput}* tidak ditemukan di Coinbase atau tidak ada transaksi signifikan saat ini.`);
      return res.status(200).send('OK');
    }

    // 2. Inisialisasi Gemini AI
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // 3. Prompt Analisis On-Demand
    const prompt = `
      Anda adalah asisten riset pasar crypto senior. User baru saja meminta data transaksi terbaru untuk koin ${coinInput}.
      Berikut adalah data transaksi live teratas dari Coinbase Exchange:
      ${JSON.stringify(whaleTrades, null, 2)}
      
      Tugas Anda adalah menyusun laporan singkat untuk Telegram dengan ketentuan format berikut:
      - Baris pertama wajib bertuliskan: "📊 *HASIL RISET ON-CHAIN: ${coinInput}* 📊"
      - Gunakan penanda emoji 🟢 jika transaksi beberapa menit terakhir didominasi BUY.
      - Gunakan penanda emoji 🔴 jika transaksi beberapa menit terakhir didominasi SELL.
      - Susun detail angka transaksi menggunakan poin-poin tebal yang rapi.
      - Berikan bagian *Kesimpulan Logis:* maksimal 2 kalimat tegas mengenai ke mana arah pergerakan uang institusi saat ini pada koin tersebut.
      
      Gunakan Bahasa Indonesia yang ringkas, objektif, dan tanpa basa-basi di awal teks.
    `;

    // 4. Kirim balasan langsung ke user yang bertanya
    const result = await model.generateContent(prompt);
    const aiAnalysis = result.response.text();

    await sendToTelegram(chatId, aiAnalysis);
    return res.status(200).send('OK');

  } catch (error) {
    console.error(error);
    // Tetap kirim status 200 ke Telegram agar Telegram tidak mengirim ulang pesan eror secara terus-menerus
    return res.status(200).send('Error handled'); 
  }
};

// Fungsi pencarian data koin secara dinamis sesuai ketikan user
async function fetchDynamicCoinbaseTrades(coin) {
  const pair = `${coin}-USD`;
  let highValueTrades = [];
  
  // Batas minimal transaksi yang dilacak (bisa disesuaikan, misal $5.000 USD agar sensitif untuk Altcoins)
  const MIN_VALUE_USD = 5000; 

  try {
    const response = await fetch(`https://api.exchange.coinbase.com/products/${pair}/trades?limit=40`, {
      headers: { 'User-Agent': 'CryptoWhaleTrackerBot/1.0' }
    });
    
    // Jika koin tidak terdaftar di Coinbase, API akan melempar eror atau array kosong
    if (!response.ok) return null;
    
    const trades = await response.json();
    
    if (Array.isArray(trades)) {
      for (const t of trades) {
        const valueUsd = parseFloat(t.price) * parseFloat(t.size);
        
        if (valueUsd >= MIN_VALUE_USD) {
          highValueTrades.push({
            koin: coin,
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
    console.error(e);
    return null;
  }

  return highValueTrades.sort((a, b) => b.total_usd - a.total_usd).slice(0, 4);
}

// Fungsi mengirim pesan balik ke Chat ID asal penanya
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

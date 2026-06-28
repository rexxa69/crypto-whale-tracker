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

    // PERBAIKAN 1: Intersepsi perintah /START agar tidak dibaca sebagai nama koin
    if (coinInput === '/START') {
      await sendToTelegram(chatId, "👋 *Bot Riset On-Chain Aktif!*\n\nSilakan ketik langsung nama koin tanpa garis miring untuk melihat transaksi live di Coinbase.\n\n*Contoh:* `BTC`, `ETH`, atau `SOL`");
      return res.status(200).send('OK');
    }

    // 1. Ambil data transaksi live berdasarkan koin
    const whaleTrades = await fetchDynamicCoinbaseTrades(coinInput); 

    // PERBAIKAN 2: Jika API Coinbase memblokir atau error, bot akan memberi tahu statusnya
    if (whaleTrades && whaleTrades.length === 1 && whaleTrades[0].error_status) {
      await sendToTelegram(chatId, `⚠️ API Coinbase mengembalikan error status: ${whaleTrades[0].error_status}. Coba lagi beberapa saat lagi.`);
      return res.status(200).send('OK');
    }

    if (!whaleTrades || whaleTrades.length === 0) {
      await sendToTelegram(chatId, `❌ Data koin *${coinInput}* tidak ditemukan di Coinbase atau tidak ada transaksi yang lolos filter saat ini.`);
      return res.status(200).send('OK');
    }

    // 2. Inisialisasi Gemini AI
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // 3. Prompt Analisis
    const prompt = `
      Anda adalah asisten riset pasar crypto senior. User meminta data transaksi terbaru untuk koin ${coinInput}.
      Berikut adalah data transaksi live teratas dari Coinbase Exchange:
      ${JSON.stringify(whaleTrades, null, 2)}
      
      Tugas Anda adalah menyusun laporan singkat untuk Telegram dengan ketentuan format berikut:
      - Baris pertama wajib bertuliskan: "📊 *HASIL RISET MARKET FLOW: ${coinInput}* 📊"
      - Gunakan penanda emoji 🟢 jika transaksi dominan BUY.
      - Gunakan penanda emoji 🔴 jika transaksi dominan SELL.
      - Susun detail angka transaksi menggunakan poin-poin tebal yang rapi.
      - Berikan bagian *Kesimpulan Logis:* maksimal 2 kalimat tegas mengenai ke mana arah pergerakan uang saat ini pada koin tersebut.
      
      Gunakan Bahasa Indonesia yang ringkas, objektif, dan tanpa basa-basi di awal teks.
    `;

    // 4. Kirim balasan
    const result = await model.generateContent(prompt);
    const aiAnalysis = result.response.text();

    await sendToTelegram(chatId, aiAnalysis);
    return res.status(200).send('OK');

  } catch (error) {
    console.error(error);
    return res.status(200).send('Error handled'); 
  }
};

async function fetchDynamicCoinbaseTrades(coin) {
  const pair = `${coin}-USD`;
  let highValueTrades = [];
  
  // PERBAIKAN 3: Set ke 0 terlebih dahulu untuk tes ombak agar data PASTI lolos masuk
  const MIN_VALUE_USD = 0; 

  try {
    // Menaikkan limit menjadi 100 transaksi terakhir
    const response = await fetch(`https://api.exchange.coinbase.com/products/${pair}/trades?limit=100`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    
    if (!response.ok) return [{ error_status: response.status }];
    
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
            value_raw: valueUsd,
            waktu: new Date(t.time).toLocaleTimeString('id-ID')
          });
        }
      }
    }
  } catch (e) {
    return null;
  }

  // Ambil urutan transaksi yang nilainya paling besar dari 100 sampel tersebut
  return highValueTrades.sort((a, b) => b.value_raw - a.value_raw).slice(0, 4);
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

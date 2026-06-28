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
      await sendToTelegram(chatId, "👋 *Bot Riset On-Chain Aktif!*\n\nSilakan ketik langsung nama koin tanpa garis miring untuk melihat transaksi live di Coinbase.\n\n*Contoh:* `BTC`, `ETH`, atau `SOL`");
      return res.status(200).send('OK');
    }

    // 1. Ambil data transaksi live berdasarkan koin
    const whaleTrades = await fetchDynamicCoinbaseTrades(coinInput); 

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

    // 3. PROMPT BARU: Memaksa struktur visual grid yang rapi dan scannable
    const prompt = `
      Anda adalah sistem otomatis pelacak Order Flow institusi senior.
      Analisis data transaksi dari Coinbase Exchange berikut:
      ${JSON.stringify(whaleTrades, null, 2)}
      
      Tugas Anda adalah menyusun laporan singkat untuk Telegram dengan KETENTUAN FORMAT KETAT berikut:
      
      1. Baris pertama wajib bertuliskan: "📊 *HASIL RISET MARKET FLOW: ${coinInput}* 📊"
      2. Baris kedua adalah status dominasi koin saat ini: Berikan satu emoji besar saja (🟢 jika dominan BUY, 🔴 jika dominan SELL).
      3. Daftar Transaksi: Tampilkan transaksi dengan template format per baris yang rapi seperti contoh ini:
         • 🟩 *BUY* | *[Jumlah] ${coinInput}* | Total: *$[Total USD]* @ $[Harga] ([Waktu])
         • 🟥 *SELL* | *[Jumlah] ${coinInput}* | Total: *$[Total USD]* @ $[Harga] ([Waktu])
         
         Aturan angka desimal:
         - Untuk koin bernilai rendah (seperti ONDO, ADA), pertahankan 2-3 angka desimal pada harga.
         - Untuk jumlah koin dan total USD, bulatkan desimalnya agar tidak terlalu panjang (misal $2,377.255 cukup ditulis $2,377).
      
      4. Pembatas: Berikan jarak satu baris kosong sebelum kesimpulan.
      5. Pertahankan bagian *Kesimpulan Logis:* Anda yang sudah bagus (maksimal 2 kalimat tegas mengenai pergerakan uang institusi).
      
      Aturan Ketat: Jangan menulis kalimat pembuka atau basa-basi apa pun. Langsung keluarkan hasil format akhirnya saja dengan gaya Markdown. Gunakan Bahasa Indonesia yang ringkas dan tajam.
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
  
  // Ambil data transaksi di atas $1.000 agar data selalu terisi saat dicoba
  const MIN_VALUE_USD = 1000; 

  try {
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
            harga_satuan: parseFloat(t.price),
            jumlah_koin: parseFloat(t.size),
            total_usd: valueUsd,
            waktu: new Date(t.time).toLocaleTimeString('id-ID')
          });
        }
      }
    }
  } catch (e) {
    return null;
  }

  return highValueTrades.sort((a, b) => b.total_usd - a.total_usd).slice(0, 4);
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

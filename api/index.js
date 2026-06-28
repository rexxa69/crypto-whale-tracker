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

    // 1. Ambil data transaksi live
    const whaleTrades = await fetchDynamicCoinbaseTrades(coinInput); 

    if (!whaleTrades || whaleTrades.length === 0) {
      await sendToTelegram(chatId, `❌ Data koin *${coinInput}* tidak ditemukan di Coinbase atau tidak ada transaksi signifikan saat ini.`);
      return res.status(200).send('OK');
    }

    // =================================================================
    // TEMPLATE FORMATTER (Sesuai Blueprint image_0838fb.png)
    // =================================================================
    
    // Konversi Tanggal ke format: Hari Bulan Tahun (Contoh: 28 Juni 2026)
    const namaBulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    const d = new Date();
    const tanggalFormat = `${d.getDate()} ${namaBulan[d.getMonth()]} ${d.getFullYear()}`;

    let totalBuyUsd = 0;
    let totalSellUsd = 0;
    let daftarTeksTransaksi = [];

    // Proteksi format string agar tidak terjadi double text atau salah bold
    whaleTrades.forEach(tx => {
      if (tx.eksekusi === 'BUY') {
        totalBuyUsd += tx.total_usd;
      } else {
        totalSellUsd += tx.total_usd;
      }

      const labelAksi = tx.eksekusi === 'BUY' ? 'Pembelian' : 'Penjualan';
      const formatTotalUsd = Math.round(tx.total_usd).toLocaleString('en-US');

      // Format strict sesuai gambar: - Pembelian BTC ( Senilai : $999,999 )
      daftarTeksTransaksi.push(`- ${labelAksi} ${tx.koin} ( Senilai : $${formatTotalUsd} )`);
    });

    // Menentukan emoji indikator dominasi volume
    const emojiStatus = totalBuyUsd >= totalSellUsd ? '🟢' : '🔴';

    // Menyusun susunan baris teks atas
    const barisHeader = `📊 *HASIL RISET MARKET FLOW: ${coinInput}* 📊\n\n`;
    const barisStatus = `${emojiStatus} _Data Transaksi Teratas_, ${tanggalFormat}.\n\n`;
    const barisList = `${daftarTeksTransaksi.join('\n')}\n\n`;

    // =================================================================
    // PROMPT AI UNTUK KESIMPULAN RAW
    // =================================================================
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const promptAI = `
      Anda adalah analis pasar crypto senior yang dingin, kaku, dan logis. Berikan kesimpulan singkat berdasarkan data transaksi berikut:
      ${JSON.stringify(whaleTrades, null, 2)}
      
      Tugas Anda:
      Tuliskan analisis 1 sampai 2 kalimat tegas mengenai kemana arah pergerakan uang institusi saat ini pada koin tersebut dan dampaknya terhadap harga secara objektif.
      
      Aturan Ketat: Jangan gunakan kata pengantar, jangan buat judul baru, langsung berikan kalimat analisisnya saja. Gunakan Bahasa Indonesia.
    `;

    const result = await model.generateContent(promptAI);
    const kesimpulanRaw = result.response.text().trim();

    // Menggabungkan seluruh data ke format final gambar
    const pesanAkhir = `${barisHeader}${barisStatus}${barisList}*Kesimpulan Logis* : ${kesimpulanRaw}`;

    await sendToTelegram(chatId, pesanAkhir);
    return res.status(200).send('OK');

  } catch (error) {
    console.error(error);
    return res.status(200).send('Error handled'); 
  }
};

async function fetchDynamicCoinbaseTrades(coin) {
  const pair = `${coin}-USD`;
  let highValueTrades = [];
  const MIN_VALUE_USD = 1000; 

  try {
    const response = await fetch(`https://api.exchange.coinbase.com/products/${pair}/trades?limit=100`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (!response.ok) return null;
    const trades = await response.json();
    
    if (Array.isArray(trades)) {
      for (const t of trades) {
        const valueUsd = parseFloat(t.price) * parseFloat(t.size);
        if (valueUsd >= MIN_VALUE_USD) {
          highValueTrades.push({
            koin: coin,
            eksekusi: t.side.toUpperCase(), 
            total_usd: valueUsd
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

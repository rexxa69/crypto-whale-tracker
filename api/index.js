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

    // 1. Ambil data transaksi live (Berupa angka mentah)
    const whaleTrades = await fetchDynamicCoinbaseTrades(coinInput); 

    if (!whaleTrades || whaleTrades.length === 0) {
      await sendToTelegram(chatId, `❌ Data koin *${coinInput}* tidak ditemukan di Coinbase atau tidak ada transaksi signifikan saat ini.`);
      return res.status(200).send('OK');
    }

    // =================================================================
    // PROGRAMMATIC FORMATTING (Menyusun Tampilan Lewat Kode - 100% Presisi)
    // =================================================================
    
    // Mendapatkan tanggal hari ini (Format: DD/MM/YYYY)
    const tanggalHariIni = new Date().toLocaleDateString('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    let totalBuyUsd = 0;
    let totalSellUsd = 0;
    let daftarTeksTransaksi = [];

    // Proses data secara matematis
    whaleTrades.forEach(tx => {
      if (tx.eksekusi === 'BUY') {
        totalBuyUsd += tx.total_usd;
      } else {
        totalSellUsd += tx.total_usd;
      }

      const barisEmoji = tx.eksekusi === 'BUY' ? '🟩' : '🟥';
      const labelAksi = tx.eksekusi === 'BUY' ? 'BUY' : 'SELL';
      
      // Pembulatan angka agar ringkas dan scannable
      const formatJumlahKoin = tx.jumlah_koin < 1 ? tx.jumlah_koin.toFixed(4) : tx.jumlah_koin.toFixed(2);
      const formatTotalUsd = Math.round(tx.total_usd).toLocaleString('en-US');
      const formatHargaSatuan = tx.harga_satuan.toLocaleString('en-US');

      daftarTeksTransaksi.push(`• ${barisEmoji} *${labelAksi}* | *${formatJumlahKoin} ${tx.koin}* | Total: *$${formatTotalUsd}* @ $${formatHargaSatuan}`);
    });

    // Menentukan emoji dominasi di header secara objektif
    const emojiDominan = totalBuyUsd >= totalSellUsd ? '🟢 (Dominan Beli)' : '🔴 (Dominan Jual)';

    // Menyusun komponen Header atas
    const bagianHeader = `📊 *HASIL RISET MARKET FLOW: ${coinInput}* 📊\n📅 *Tanggal:* ${tanggalHariIni}\nStatus: ${emojiDominan}\n\n${daftarTeksTransaksi.join('\n')}\n\n`;

    // =================================================================
    // MEMANGGIL AI HANYA UNTUK MEMBUAT KESIMPULAN LOGIS
    // =================================================================
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const promptAI = `
      Anda adalah analis pasar crypto senior yang dingin dan logis. Berikan kesimpulan singkat berdasarkan data transaksi ini:
      ${JSON.stringify(whaleTrades, null, 2)}
      
      Tugas Anda:
      Tuliskan bagian *Kesimpulan Logis:* maksimal 2 kalimat tegas mengenai ke mana arah pergerakan uang saat ini dan dampaknya ke harga. Jangan menulis ulang data angka di atas. Langsung mulai teks dengan kata "*Kesimpulan Logis:* "
    `;

    const result = await model.generateContent(promptAI);
    const kesimpulanAI = result.response.text().trim();

    // Menggabungkan susunan Kode + Analisis AI
    const pesanAkhir = bagianHeader + kesimpulanAI;

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
  const MIN_VALUE_USD = 1000; // Set standar filter filter awal

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
            harga_satuan: parseFloat(t.price),
            jumlah_koin: parseFloat(t.size),
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

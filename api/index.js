const { GoogleGenerativeAI } = require('@google/generative-ai');

module.exports = async (req, res) => {
  try {
    // 1. Mengambil data transaksi besar (Format data standar On-Chain)
    const whaleData = await fetchWhaleData(); 

    if (!whaleData || whaleData.length === 0) {
      return res.status(200).json({ message: "Tidak ada transaksi besar saat ini." });
    }

    // 2. Inisialisasi Otak Gemini AI menggunakan API Key Anda
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // 3. Menyusun perintah (Prompt) logis untuk Gemini AI
    const prompt = `
      Anda adalah analis on-chain crypto senior yang berfokus pada pergerakan institusi dan Smart Money.
      Analisis data transaksi besar berikut secara objektif:
      ${JSON.stringify(whaleData, null, 2)}
      
      Tugas Anda:
      1. Tentukan apakah ini INFLOW ke Exchange (potensi menjual/dump) atau OUTFLOW dari Exchange ke Cold Wallet (potensi akumulasi).
      2. Berikan laporan ringkas, jelas, berbentuk poin-poin penting untuk dikirim ke Telegram.
      3. Jangan gunakan emosi, berikan analisis berbasis logika pergerakan uang (Money Flow).
      
      Gunakan bahasa Indonesia yang santai tapi profesional.
    `;

    // 4. Eksekusi analisis AI
    const result = await model.generateContent(prompt);
    const aiAnalysis = result.response.text();

    // 5. Kirim hasil analisis ke Telegram Anda
    await sendToTelegram(aiAnalysis);

    return res.status(200).json({ 
      success: true, 
      message: "Analisis On-Chain berhasil dikirim ke Telegram!" 
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
};

// Fungsi simulasi data On-Chain (Dapat Anda ganti dengan API Live seperti Alchemy/WhaleAlert nanti)
async function fetchWhaleData() {
  return [
    {
      coin: "BTC",
      amount: 520,
      value_usd: 33800000,
      from: "Unknown Private Wallet (Whale)",
      to: "Binance Exchange (Deposit Hot Wallet)",
      timestamp: new Date().toISOString()
    },
    {
      coin: "ETH",
      amount: 14500,
      value_usd: 50750000,
      from: "Coinbase Exchange",
      to: "Cold Wallet (0x71a...3f9)",
      timestamp: new Date().toISOString()
    }
  ];
}

// Fungsi pengirim pesan ke Bot Telegram
async function sendToTelegram(text) {
  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text
    })
  });
}

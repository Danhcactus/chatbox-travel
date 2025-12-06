// server.js
import express from "express";
import cors from "cors";
import axios from "axios";
import cheerio from "cheerio";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GEMINI_KEY;
const SITE_URLS = (process.env.SITE_URLS || "").split(";").map(s => s.trim()).filter(Boolean);
const SCRAPE_INTERVAL_MS = Number(process.env.SCRAPE_INTERVAL_MS || 1000 * 60 * 5); // 5 min default

if (!GEMINI_KEY) {
  console.error("ERROR: GEMINI_KEY is not set in environment variables.");
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "200kb" }));

let CHUNKS = []; // in-memory index

function cleanHtmlToText(html) {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, footer, header").remove();
  let text = $("body").text() || "";
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function splitToChunks(text, url, size = 800) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) {
    const part = text.slice(i, i + size);
    const id = `${url}#${i}`;
    const words = part.toLowerCase().replace(/[^a-z0-9\u00C0-\u017F\s]/gi, " ").split(/\s+/).filter(Boolean);
    const set = new Set(words);
    chunks.push({ id, url, text: part.trim(), wordsSet: set });
  }
  return chunks;
}

async function fetchAndIndexAll() {
  console.log("Start scraping", SITE_URLS.length, "pages...");
  const newChunks = [];
  for (const url of SITE_URLS) {
    try {
      const r = await axios.get(url, { headers: { "User-Agent": "SeaChatBot/1.0" }, timeout: 15000 });
      const text = cleanHtmlToText(r.data);
      if (!text) {
        console.warn("No text extracted from", url);
        continue;
      }
      const chunks = splitToChunks(text, url);
      newChunks.push(...chunks);
      console.log("Indexed", chunks.length, "chunks from", url);
    } catch (err) {
      console.warn("Fetch failed for", url, err.message);
    }
  }
  CHUNKS = newChunks;
  console.log("Indexing complete. Total chunks:", CHUNKS.length);
}

// initial and periodic indexing
(async () => {
  await fetchAndIndexAll();
  setInterval(fetchAndIndexAll, SCRAPE_INTERVAL_MS);
})();

// simple retrieval by word overlap
function retrieveTop(query, topN = 6) {
  const qWords = query.toLowerCase().replace(/[^a-z0-9\u00C0-\u017F\s]/gi, " ").split(/\s+/).filter(Boolean);
  const qSet = new Set(qWords);
  const scored = CHUNKS.map(c => {
    let score = 0;
    for (const w of qSet) if (c.wordsSet.has(w)) score++;
    return { score, chunk: c };
  }).filter(x => x.score > 0);
  scored.sort((a,b) => b.score - a.score);
  return scored.slice(0, topN).map(s => s.chunk);
}

async function callGemini(prompt) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + GEMINI_KEY;
  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ]
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text || null;
}

// health
app.get("/health", (_req, res) => res.json({ ok: true, indexed: CHUNKS.length }));

// force reindex
app.post("/force-refresh", async (_req, res) => {
  await fetchAndIndexAll();
  res.json({ ok: true, indexed: CHUNKS.length });
});

// chat endpoint
app.post("/chat", async (req, res) => {
  try {
    const question = (req.body?.question || "").trim();
    if (!question) return res.status(400).json({ error: "No question" });

    const topChunks = retrieveTop(question, 6);
    if (topChunks.length === 0) {
      return res.json({ answer: "Xin lỗi, tôi chỉ có thể trả lời dựa trên nội dung có trên website." });
    }

    let contextText = "";
    for (const c of topChunks) {
      contextText += `Nguồn: ${c.url}\n${c.text}\n\n`;
    }

    const systemInstruction = `Bạn là trợ lý của website du lịch. CHỈ trả lời dựa trên nội dung bên dưới. Nếu câu hỏi không có trong nội dung thì trả lời: "Xin lỗi, tôi chỉ có thể cung cấp thông tin nằm trong website."`;
    const prompt = `${systemInstruction}\n\n---NỘI DUNG LIÊN QUAN---\n${contextText}\n---END---\n\nCâu hỏi: ${question}`;

    const aiReply = await callGemini(prompt);
    if (!aiReply) return res.json({ answer: "Lỗi gọi mô hình AI." });

    return res.json({ answer: aiReply.trim() });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

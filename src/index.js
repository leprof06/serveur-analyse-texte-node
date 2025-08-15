// API Node/Express d’analyse de texte
// + Vérification de sens avec embeddings

import express from "express";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import fetch from "node-fetch";
import { franc } from "franc-min";

import { iso3ToIso2 } from "./utils/lang.js";
import { checkWithLanguageTool } from "./services/languagetool.js";
import { similarityScore, grammarSpellingScores, structureHeuristics } from "./scoring.js";
import { evaluateAnswer } from "./evaluation.js";

const app = express();
const PORT = Number(process.env.PORT || 8080);
const LT_API_KEY = process.env.LT_API_KEY || null;
const EMB_BASE_URL = process.env.EMB_BASE_URL || null; // <-- nouvel env

// ----- CORS -----
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "*")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(express.json({ limit: "2mb" }));
app.use(morgan("tiny"));

if (CORS_ORIGINS.includes("*")) {
  app.use(cors());
} else {
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const ok = CORS_ORIGINS.some(o => origin === o);
      cb(ok ? null : new Error("Origin not allowed by CORS"), ok);
    }
  }));
}

app.use(rateLimit({ windowMs: 60_000, max: 60 }));

// ----- Health -----
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), ts: Date.now() });
});

// ----- Fonction utilitaire pour embeddings -----
async function getSemanticScore(sentenceA, sentenceB) {
  if (!EMB_BASE_URL) return null; // pas configuré
  try {
    const r = await fetch(`${EMB_BASE_URL}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentences: [sentenceA, sentenceB] })
    });
    if (!r.ok) throw new Error(`Embeddings API error ${r.status}`);
    const data = await r.json();
    if (!data.vectors || data.vectors.length < 2) return null;

    // Cosine similarity
    const v1 = data.vectors[0];
    const v2 = data.vectors[1];
    const dot = v1.reduce((sum, val, i) => sum + val * v2[i], 0);
    const normA = Math.sqrt(v1.reduce((sum, val) => sum + val * val, 0));
    const normB = Math.sqrt(v2.reduce((sum, val) => sum + val * val, 0));
    return dot / (normA * normB);
  } catch (e) {
    console.error("Semantic score error:", e.message);
    return null;
  }
}

// ----- Analyse -----
app.post("/analyse-text", async (req, res) => {
  try {
    const { text, expectedAnswer = "", expectedLang = "", keywords = [] } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Champ 'text' requis (string)." });
    }

    // 1) Détection langue
    const detectedIso3 = franc(text, { minLength: 10 });
    const lang = iso3ToIso2(detectedIso3);

    // 2) LanguageTool
    let ltData = { matches: [] };
    try {
      const ltLang = expectedLang || lang || "auto";
      ltData = await checkWithLanguageTool(text, ltLang, LT_API_KEY);
    } catch {
      ltData = { matches: [], _error: "LanguageTool unreachable" };
    }

    // 3) Similarité basique
    const similarity = similarityScore(text, expectedAnswer);

    // 4) Similarité sémantique
    let semantic = null;
    if (expectedAnswer && EMB_BASE_URL) {
      semantic = await getSemanticScore(text, expectedAnswer);
    }

    // 5) Heuristiques de structure
    const struct = structureHeuristics(text, keywords, expectedLang || lang);

    // 6) Scores grammaire/orthographe
    const { grammarScore, spellingScore, grammarErr, spellingErr } = grammarSpellingScores(ltData.matches);

    // 7) Issues
    const issues = (ltData.matches || []).slice(0, 100).map(m => ({
      type: (m.rule?.issueType || "grammar").toLowerCase(),
      message: m.message || m.shortMessage || "Problème détecté",
      ruleId: m.rule?.id,
      description: m.rule?.description,
      offset: m.offset,
      length: m.length,
      replacements: (m.replacements || []).slice(0, 5).map(r => r.value)
    }));

    // 8) Langue inattendue
    if (expectedLang && expectedLang !== (lang || "und")) {
      issues.unshift({
        type: "language",
        message: `Réponse détectée en '${lang || "indéterminée"}' au lieu de '${expectedLang}'.`
      });
    }

    // 9) Évaluation optionnelle
    const evalCfg = req.body?.eval || null;
    let contentEval = { contentScore: 0, isCorrect: false, reasons: [] };
    if (evalCfg) {
      contentEval = evaluateAnswer(text, evalCfg, expectedLang || lang);
    }

    // 10) Réponse
    res.json({
      lang,
      grammarScore,
      spellingScore,
      similarityScore: similarity,
      semanticScore: semantic, // <-- nouveau
      issues,
      details: {
        grammarErrors: grammarErr,
        spellingErrors: spellingErr,
        ltError: ltData._error || null,
        hasVerb: struct.hasVerb,
        keywordScore: struct.keywordScore,
        keywordsFound: struct.found,
        keywordsTotal: struct.total,
        content: contentEval,
      }
    });
  } catch (err) {
    const msg = err?.message || "Unknown error";
    const is429 = /429/.test(msg);
    res.status(is429 ? 503 : 500).json({
      error: "analysis_failed",
      message: msg,
      hint: is429
        ? "Limite atteinte sur LanguageTool public : fournissez LT_BASE_URL vers votre instance self-hostée."
        : undefined
    });
  }
});

app.listen(PORT, () => {
  console.log(`[analyse-texte] Écoute sur : http://0.0.0.0:${PORT}`);
});

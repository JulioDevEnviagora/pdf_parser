const express = require("express");
const multer = require("multer");
const cors = require("cors");

const pdfjsLib = require("pdfjs-dist/build/pdf");
const pdfjsWorker = require("pdfjs-dist/build/pdf.worker.js");
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// =====================================================
// HELPERS
// =====================================================
function isOnlyNumber(str) {
  return /^\d+$/.test(str.trim());
}

function isLikelyName(str) {
  return /^[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ ]+$/.test(str.trim()) && str.trim().length > 5;
}

async function extractEmployeeInfoFromPDF(buffer) {
  try {
    const data = new Uint8Array(buffer);
    const pdf = await pdfjsLib.getDocument({
      data,
      useSystemFonts: true,
      disableFontFace: true
    }).promise;

    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      fullText += textContent.items.map(item => item.str).join(" ") + "\n";
    }

    if (!fullText.trim()) {
      return { nome: null, codigo: null, fullText: "" };
    }

    const lines = fullText.split("\n").map(l => l.trim()).filter(Boolean);
    let codigo = null;
    let nome = null;

    // Buscar código
    const ccMatch = fullText.match(/CC:\s*(\d+)/i);
    if (ccMatch && ccMatch[1]) {
      codigo = ccMatch[1];
    } else {
      const allNumbers = fullText.match(/\d+/g);
      if (allNumbers && allNumbers.length > 0) {
        codigo = allNumbers[allNumbers.length - 1];
      }
    }

    // Buscar nome — Tentativa A
    const nomeCabecalhoMatch = fullText.match(/Código\s+([A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ\s]{5,100}?)\s+Nome/i);
    if (nomeCabecalhoMatch && nomeCabecalhoMatch[1].trim().length > 5) {
      nome = nomeCabecalhoMatch[1].trim().replace(/\s+/g, " ");
    }

    // Buscar nome — Tentativa B
    if (!nome || nome.includes("FUNCIONÁRIO")) {
      const blocosMaiusculos = fullText.match(/[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ\s]{10,}/g);
      if (blocosMaiusculos) {
        const nomesPossiveis = blocosMaiusculos
          .map(b => b.trim().replace(/\s+/g, " "))
          .filter(b => b.length > 10 && !b.includes("DECLARO") && !b.includes("ASSINATURA"));
        if (nomesPossiveis.length > 0) {
          nome = nomesPossiveis[nomesPossiveis.length - 1];
        }
      }
    }

    // Fallback linha a linha
    if (!codigo || !nome) {
      for (let i = 0; i < lines.length; i++) {
        const current = lines[i].toUpperCase();
        if (current.includes("CÓDIGO") || current.includes("CODIGO")) {
          if (!codigo) {
            if (i > 0 && isOnlyNumber(lines[i - 1])) codigo = lines[i - 1];
            else {
              const m = lines[i].match(/\d+/);
              if (m) codigo = m[0];
            }
          }
          if (!nome) {
            for (let j = i; j < i + 5 && j < lines.length; j++) {
              const lineU = lines[j].toUpperCase();
              if (isLikelyName(lines[j]) && !lineU.includes("CÓDIGO") && !lineU.includes("NOME")) {
                nome = lines[j];
                break;
              }
            }
          }
        }
        if (codigo && nome) break;
      }
    }

    return { nome, codigo, fullText };

  } catch (err) {
    return { nome: null, codigo: null, fullText: "Erro: " + err.message };
  }
}

// =====================================================
// ROTAS
// =====================================================

// Health check
app.get("/", (req, res) => {
  res.json({ ok: true, message: "PDF Parser API rodando!" });
});

// POST /pdf/extract
app.post("/pdf/extract", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ ok: false, message: "Nenhum arquivo enviado." });
    }

    if (file.mimetype !== "application/pdf") {
      return res.status(400).json({ ok: false, message: "Apenas arquivos PDF são permitidos." });
    }

    const result = await extractEmployeeInfoFromPDF(file.buffer);

    if (!result.codigo) {
      return res.status(422).json({
        ok: false,
        message: "Código do funcionário não encontrado no PDF.",
        fullText: result.fullText
      });
    }

    return res.json({
      ok: true,
      codigo: result.codigo,
      nome: result.nome
    });

  } catch (err) {
    console.error("Erro extract:", err);
    return res.status(500).json({ ok: false, message: "Erro interno do servidor." });
  }
});

// =====================================================
// START
// =====================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
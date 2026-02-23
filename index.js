const express = require("express");
const multer = require("multer");
const cors = require("cors");
const nodemailer = require("nodemailer");
require("dotenv").config();

const pdfjsLib = require("pdfjs-dist/build/pdf");
const pdfjsWorker = require("pdfjs-dist/build/pdf.worker.js");
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// =====================================================
// NODEMAILER TRANSPORTER
// =====================================================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// =====================================================
// HELPERS PDF
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
// HELPERS EMAIL
// =====================================================
function emailBase(conteudo) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Enviagora Hub</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"/>
</head>
<body style="margin:0;padding:0;background:linear-gradient(135deg,#eef7f1 0%,#f0f4f8 50%,#e8f4ed 100%);font-family:'Inter',Arial,sans-serif;min-height:100vh;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- LOGO PILL -->
          <tr>
            <td style="padding-bottom:24px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#ffffff;border-radius:50px;padding:10px 18px 10px 10px;box-shadow:0 2px 12px rgba(0,0,0,0.07);">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right:10px;vertical-align:middle;">
                          <div style="width:32px;height:32px;background:#1a4731;border-radius:10px;text-align:center;line-height:32px;font-size:16px;display:inline-block;">
                            <span style="color:#ffffff;font-size:14px;font-weight:800;">E</span>
                          </div>
                        </td>
                        <td style="vertical-align:middle;">
                          <span style="font-size:14px;font-weight:600;color:#1a2e24;letter-spacing:-0.2px;">Enviagora <span style="color:#1a4731;font-weight:800;">Hub</span></span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CARD PRINCIPAL -->
          <tr>
            <td style="background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,0.08);">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="height:5px;background:linear-gradient(90deg,#1a4731 0%,#2d8f5e 50%,#3ab5f5 100%);font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:48px 48px 40px;">
                    ${conteudo}
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:20px 48px 28px;border-top:1px solid #f0f0f0;">
                    <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6;font-family:'Inter',Arial,sans-serif;">
                      E-mail enviado automaticamente pelo sistema <strong style="color:#666;">Enviagora Hub</strong>. Não responda esta mensagem.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- RODAPÉ -->
          <tr>
            <td style="padding:20px 0;text-align:center;">
              <p style="margin:0;font-size:11px;color:#aaa;letter-spacing:0.5px;font-family:'Inter',Arial,sans-serif;">© 2025 Enviagora · Todos os direitos reservados</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// =====================================================
// ROTAS PDF (originais, sem alteração)
// =====================================================

// Health check
app.get("/", (req, res) => {
  res.json({ ok: true, message: "PDF Parser API rodando!" });
});

// POST /pdf/extract — único arquivo (mantido por compatibilidade)
app.post("/pdf/extract", upload.any(), async (req, res) => {
  try {
    const file = req.files && req.files[0];

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

// POST /pdf/extract-many — múltiplos arquivos
app.post("/pdf/extract-many", upload.any(), async (req, res) => {
  try {
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ ok: false, message: "Nenhum arquivo enviado." });
    }

    const results = await Promise.all(
      files.map(async (file) => {
        if (file.mimetype !== "application/pdf") {
          return {
            filename: file.originalname,
            ok: false,
            message: "Arquivo não é um PDF válido."
          };
        }

        const extracted = await extractEmployeeInfoFromPDF(file.buffer);

        if (!extracted.codigo) {
          return {
            filename: file.originalname,
            ok: false,
            message: "Código do funcionário não encontrado no PDF.",
            fullText: extracted.fullText
          };
        }

        return {
          filename: file.originalname,
          ok: true,
          codigo: extracted.codigo,
          nome: extracted.nome
        };
      })
    );

    const successCount = results.filter(r => r.ok).length;
    const errorCount = results.length - successCount;

    return res.json({
      ok: true,
      total: results.length,
      successCount,
      errorCount,
      results
    });

  } catch (err) {
    console.error("Erro extract-many:", err);
    return res.status(500).json({ ok: false, message: "Erro interno do servidor." });
  }
});

// =====================================================
// ROTAS EMAIL
// =====================================================

// POST /api/email/acesso
// Body: { emailDestino, nome, senhaProvisoria }
app.post("/api/email/acesso", async (req, res) => {
  const { emailDestino, nome, senhaProvisoria } = req.body;

  if (!emailDestino || !nome || !senhaProvisoria) {
    return res.status(400).json({ error: "Campos obrigatórios: emailDestino, nome, senhaProvisoria" });
  }

  const conteudo = `
    <h1 style="margin:0 0 8px;font-size:26px;font-weight:800;color:#1a2e24;letter-spacing:-0.8px;line-height:1.2;">
      Bem-vindo ao Hub, <span style="color:#1a4731;">${nome}!</span>
    </h1>
    <p style="margin:0 0 32px;font-size:15px;color:#6b7280;line-height:1.6;">
      Seu acesso foi criado com sucesso. Utilize as credenciais abaixo para entrar no sistema.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <td style="background:#f8faf9;border-radius:14px;padding:24px;border:1px solid #e5ede9;">
          <p style="margin:0 0 16px;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;">Credenciais de Acesso</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
            <tr>
              <td style="background:#ffffff;border-radius:10px;padding:14px 16px;border:1px solid #e5e7eb;">
                <p style="margin:0 0 3px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#9ca3af;">EMAIL</p>
                <p style="margin:0;font-size:15px;font-weight:600;color:#1a2e24;">${emailDestino}</p>
              </td>
            </tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#ffffff;border-radius:10px;padding:14px 16px;border:1px solid #e5e7eb;">
                <p style="margin:0 0 3px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#9ca3af;">SENHA PROVISÓRIA</p>
                <p style="margin:0;font-size:15px;font-weight:700;color:#1a2e24;letter-spacing:2px;font-family:monospace,Courier,serif;">${senhaProvisoria}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
      <tr>
        <td style="background:#fffbeb;border-radius:10px;padding:14px 16px;border:1px solid #fde68a;">
          <p style="margin:0;font-size:13px;color:#92400e;line-height:1.5;">
            ⚠️ &nbsp;Você será solicitado a <strong>criar uma nova senha</strong> no primeiro acesso.
          </p>
        </td>
      </tr>
    </table>
    <table cellpadding="0" cellspacing="0">
      <tr>
        <td style="background:#1a4731;border-radius:10px;">
          <a href="${process.env.FRONTEND_URL}"
             style="display:inline-block;color:#ffffff;text-decoration:none;font-family:'Inter',Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:1px;padding:16px 36px;text-transform:uppercase;">
            ENTRAR NO HUB &nbsp;→
          </a>
        </td>
      </tr>
    </table>
  `;

  try {
    await transporter.sendMail({
      from: `"Enviagora RH" <${process.env.EMAIL_USER}>`,
      to: emailDestino,
      subject: "Seu acesso ao Enviagora Hub foi criado",
      html: emailBase(conteudo)
    });
    res.json({ ok: true, message: "E-mail de acesso enviado." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Falha ao enviar e-mail.", details: err.message });
  }
});

// POST /api/email/reset-senha
// Body: { emailDestino, token }
app.post("/api/email/reset-senha", async (req, res) => {
  const { emailDestino, token } = req.body;

  if (!emailDestino || !token) {
    return res.status(400).json({ error: "Campos obrigatórios: emailDestino, token" });
  }

  const resetLink = `${process.env.FRONTEND_URL}/resetar-senha?token=${token}&email=${emailDestino}`;

  const conteudo = `
    <h1 style="margin:0 0 8px;font-size:26px;font-weight:800;color:#1a2e24;letter-spacing:-0.8px;line-height:1.2;">
      Recuperação<br/>de Senha
    </h1>
    <p style="margin:0 0 32px;font-size:15px;color:#6b7280;line-height:1.6;">
      Recebemos uma solicitação para redefinir sua senha no <strong style="color:#1a2e24;">Enviagora Hub</strong>. Clique no botão abaixo para criar uma nova.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="background:#1a4731;border-radius:10px;">
          <a href="${resetLink}"
             style="display:inline-block;color:#ffffff;text-decoration:none;font-family:'Inter',Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:1px;padding:16px 36px;text-transform:uppercase;">
            ALTERAR MINHA SENHA &nbsp;→
          </a>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
      <tr>
        <td style="background:#f8faf9;border-radius:12px;padding:16px 20px;border:1px solid #e5ede9;">
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding-right:12px;vertical-align:middle;">
                <div style="width:34px;height:34px;background:#e5ede9;border-radius:8px;text-align:center;line-height:34px;font-size:16px;display:inline-block;">⏱</div>
              </td>
              <td>
                <p style="margin:0;font-size:13px;color:#374151;line-height:1.5;">
                  Este link expira em <strong style="color:#1a4731;">1 hora</strong> a partir do recebimento deste e-mail.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="background:#f8faf9;border-radius:12px;padding:16px 20px;border:1px solid #e5ede9;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#9ca3af;">Se o botão não funcionar, copie este link:</p>
          <p style="margin:0;font-size:12px;color:#1a4731;word-break:break-all;line-height:1.5;">${resetLink}</p>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="background:#fef2f2;border-radius:10px;padding:14px 16px;border:1px solid #fecaca;">
          <p style="margin:0;font-size:13px;color:#991b1b;line-height:1.5;">
            🔒 &nbsp;Se você <strong>não solicitou</strong> esta alteração, ignore este e-mail. Sua senha permanece inalterada.
          </p>
        </td>
      </tr>
    </table>
  `;

  try {
    await transporter.sendMail({
      from: `"Enviagora RH" <${process.env.EMAIL_USER}>`,
      to: emailDestino,
      subject: "Recuperação de Senha — Enviagora Hub",
      html: emailBase(conteudo)
    });
    res.json({ ok: true, message: "E-mail de reset enviado." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Falha ao enviar e-mail.", details: err.message });
  }
});

// POST /api/email/aviso
// Body: { emails: string[], titulo, mensagem, tipo: "urgente" | "alerta" | "informativo" }
app.post("/api/email/aviso", async (req, res) => {
  const { emails, titulo, mensagem, tipo } = req.body;

  if (!emails || !Array.isArray(emails) || !titulo || !mensagem || !tipo) {
    return res.status(400).json({ error: "Campos obrigatórios: emails (array), titulo, mensagem, tipo" });
  }

  const emojis = { urgente: "🚨", alerta: "⚠️", informativo: "ℹ️" };
  const emoji = emojis[tipo] || "📢";

  const conteudo = `
    <div style="text-align:center;margin-bottom:24px;">
      <span style="font-size:48px;">${emoji}</span>
    </div>
    <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:1.5px;text-align:center;">
      Novo Aviso do Enviagora Hub
    </p>
    <h1 style="margin:0 0 16px;font-size:26px;font-weight:900;color:#1a2e24;letter-spacing:-0.8px;line-height:1.2;text-align:center;">
      ${titulo}
    </h1>
    <div style="background:#f8fafc;border-radius:16px;padding:32px;border:1px solid #e2e8f0;margin-bottom:32px;">
      <p style="margin:0;font-size:16px;color:#334155;line-height:1.7;white-space:pre-wrap;">${mensagem}</p>
    </div>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;text-align:center;line-height:1.6;">
      Um novo comunicado importante foi publicado. <br/>Clique no botão abaixo para acessar o portal e ver <strong>todos os avisos</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#1a4731;border-radius:12px;box-shadow:0 4px 12px rgba(26,71,49,0.2);">
                <a href="${process.env.FRONTEND_URL}/dashboard/avisos/lista"
                   style="display:inline-block;color:#ffffff;text-decoration:none;font-family:'Inter',Arial,sans-serif;font-size:14px;font-weight:700;padding:18px 48px;text-transform:uppercase;letter-spacing:1px;">
                  VER TODOS OS AVISOS &nbsp;→
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  try {
    await transporter.sendMail({
      from: `"Enviagora Hub" <${process.env.EMAIL_USER}>`,
      bcc: emails,
      subject: `${emoji} Novo Aviso: ${titulo}`,
      html: emailBase(conteudo)
    });
    res.json({ ok: true, message: `Aviso enviado para ${emails.length} destinatário(s).` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Falha ao enviar e-mail.", details: err.message });
  }
});

// POST /api/email/noticia
// Body: { emails: string[], titulo, mes, ano }
app.post("/api/email/noticia", async (req, res) => {
  const { emails, titulo, mes, ano } = req.body;

  if (!emails || !Array.isArray(emails) || !titulo || !mes || !ano) {
    return res.status(400).json({ error: "Campos obrigatórios: emails (array), titulo, mes, ano" });
  }

  const conteudo = `
    <div style="text-align:center;margin-bottom:24px;">
      <span style="font-size:48px;">📰</span>
    </div>
    <h1 style="margin:0 0 8px;font-size:26px;font-weight:900;color:#1a2e24;letter-spacing:-1px;line-height:1.2;text-align:center;">
      Enviagora <span style="color:#2d8f5e;">News</span>
    </h1>
    <p style="margin:0 0 32px;font-size:16px;color:#64748b;text-align:center;font-weight:500;">
      A edição de <strong style="color:#1a2e24;">${mes}/${ano}</strong> já está disponível!
    </p>
    <div style="background:linear-gradient(135deg, #1a4731 0%, #2d8f5e 100%);border-radius:20px;padding:40px;color:#ffffff;text-align:center;margin-bottom:32px;box-shadow:0 10px 20px rgba(26,71,49,0.1);">
      <h2 style="margin:0 0 12px;font-size:20px;font-weight:800;letter-spacing:-0.5px;">${titulo}</h2>
      <p style="margin:0 0 24px;font-size:14px;opacity:0.8;">Confira as últimas novidades, conquistas e avisos mensais nesta nova edição.</p>
      <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
        <tr>
          <td style="background:#ffffff;border-radius:10px;">
            <a href="${process.env.FRONTEND_URL}/dashboard/news"
               style="display:inline-block;color:#1a4731;text-decoration:none;font-family:'Inter',Arial,sans-serif;font-size:13px;font-weight:800;padding:14px 30px;text-transform:uppercase;">
              LER AGORA &nbsp;📖
            </a>
          </td>
        </tr>
      </table>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Enviagora News" <${process.env.EMAIL_USER}>`,
      bcc: emails,
      subject: `📰 Enviagora News: ${mes}/${ano} já disponível!`,
      html: emailBase(conteudo)
    });
    res.json({ ok: true, message: `Notícia enviada para ${emails.length} destinatário(s).` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Falha ao enviar e-mail.", details: err.message });
  }
});

// =====================================================
// START
// =====================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
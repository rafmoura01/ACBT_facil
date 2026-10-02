/**
 * CHAMADOS — ACBT Fácil
 *
 * Abrir:      morador informa nome, PNR e telefone (sem verificação).
 * Acompanhar: morador informa o telefone e o PNR usados ao abrir e vê
 *             somente os chamados abertos com esses dados.
 * Responder:  responsáveis entram no painel com e-mail e senha da aba
 *             "Responsáveis" da planilha "Chamados — ACBT".
 *
 * Primeira vez: rode configurarChamados() pelo editor (Executar).
 */

const CH = {
  URL_APP: "https://script.google.com/macros/s/AKfycbxzgOl8IVkikR6DhFU0BcP_sR1y21PGR5VN3MmnPCoRgPlCqZovzY6W3aH5YKugw57obA/exec",
  NOME_PLANILHA: "Chamados — ACBT",
  NOME_PASTA_FOTOS: "Fotos dos chamados",
  ABA_CHAMADOS: "Chamados",
  ABA_ANDAMENTO: "Andamento",
  ABA_RESP: "Responsáveis",
  COL_CHAMADOS: ["Protocolo","Aberto em","Nome","PNR","Telefone","Categoria","Local","Descrição",
                 "Foto (ID)","Status","Responsável","Atualizado em"],
  COL_ANDAMENTO: ["Protocolo","Data","Autor","Status","Mensagem","Interna"],
  COL_RESP: ["Nome","E-mail","Senha","Recebe e-mail","Ativo"],
  CATEGORIAS: ["Manutenção","Iluminação","Portão e guarita","Limpeza e jardinagem",
               "Água e esgoto","Segurança","Convivência e barulho","Outros"],
  STATUS: ["Aberto","Em andamento","Concluído","Cancelado"],
  SESSAO_MIN: 180,
  LIMITE_TELEFONE_HORA: 5,
  LIMITE_GERAL_HORA: 40,
  FOTO_MAX_BYTES: 2500000
};

/* ======================= configuração inicial ======================= */

/** Rode uma vez pelo editor. Cria a planilha e você como primeiro responsável. */
function configurarChamados(){
  const ss = planilhaChamados_();
  const aba = ss.getSheetByName(CH.ABA_RESP);
  if(aba.getLastRow() < 2){
    const email = Session.getEffectiveUser().getEmail();
    const senha = Utilities.getUuid().replace(/-/g, "").slice(0, 8);
    aba.appendRow(["Rafael Viana Moura", email, senha, "Sim", "Sim"]);
    Logger.log("Responsável inicial: " + email + " · senha: " + senha + " (troque na aba Responsáveis se quiser)");
  }
  pastaFotos_();
  Logger.log("E-mails disponíveis hoje: " + MailApp.getRemainingDailyQuota());
  Logger.log("Planilha: " + ss.getUrl());
  Logger.log("Painel da diretoria: " + CH.URL_APP + "?p=painel");
}

/* ======================= chamadas da página ======================= */

function categoriasChamado(){
  return CH.CATEGORIAS;
}

function abrirChamado(d){
  d = d || {};
  if(d.site) return { ok:true, protocolo:"—" };            // campo invisível: robô

  const nome = texto_(d.nome, 80);
  const pnr = texto_(d.pnr, 20);
  const tel = String(d.telefone || "").replace(/\D/g, "").slice(0, 13);
  const categoria = CH.CATEGORIAS.indexOf(d.categoria) > -1 ? d.categoria : "";
  const local = texto_(d.local, 120);
  const descricao = textoLongo_(d.descricao, 1500);

  if(nome.length < 3) return erro_("Informe seu nome.");
  if(!pnr) return erro_("Informe o seu PNR.");
  if(tel.length < 10) return erro_("Informe um telefone com DDD.");
  if(!categoria) return erro_("Escolha o tipo do chamado.");
  if(descricao.length < 10) return erro_("Descreva o problema com um pouco mais de detalhe.");

  const cache = CacheService.getScriptCache();
  const kTel = "ch_tel_" + tel, kGer = "ch_geral";
  const nTel = Number(cache.get(kTel) || 0), nGer = Number(cache.get(kGer) || 0);
  if(nTel >= CH.LIMITE_TELEFONE_HORA || nGer >= CH.LIMITE_GERAL_HORA){
    return erro_("Muitos chamados em pouco tempo. Tente de novo mais tarde ou fale com a administração.");
  }

  let protocolo, fotoId = "";
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    const ss = planilhaChamados_();
    protocolo = proximoProtocolo_();
    if(d.foto){
      try{ fotoId = salvarFoto_(d.foto, protocolo); }catch(e){ Logger.log("Foto não salva: " + e.message); }
    }
    const agora = new Date();
    ss.getSheetByName(CH.ABA_CHAMADOS).appendRow(
      [protocolo, agora, nome, pnr, tel, categoria, local, descricao, fotoId, "Aberto", "", agora]);
    ss.getSheetByName(CH.ABA_ANDAMENTO).appendRow(
      [protocolo, agora, "Morador", "Aberto", "Chamado aberto.", "Não"]);
    SpreadsheetApp.flush();
  }finally{
    lock.releaseLock();
  }

  cache.put(kTel, String(nTel + 1), 3600);
  cache.put(kGer, String(nGer + 1), 3600);
  try{
    avisarResponsaveis_({ protocolo, nome, pnr, tel, categoria, local, descricao, temFoto: !!fotoId });
  }catch(e){
    Logger.log("E-mail não enviado: " + e.message);
  }
  return { ok:true, protocolo, token: criarSessao_({ tipo:"morador", tel, pnr: normPnr_(pnr) }) };
}

/** Morador entra com o telefone e o PNR que usou ao abrir o chamado. */
function entrarMorador(telefone, pnr){
  const tel = String(telefone || "").replace(/\D/g, "");
  const p = normPnr_(pnr);
  if(tel.length < 10 || !p) return erro_("Informe o telefone com DDD e o PNR usados ao abrir o chamado.");
  const cache = CacheService.getScriptCache();
  const k = "mor_tent_" + tel, n = Number(cache.get(k) || 0);
  if(n >= 5) return erro_("Muitas tentativas. Tente de novo em 30 minutos.");
  if(!lerChamados_().some(c => doMorador_(c, tel, p))){
    cache.put(k, String(n + 1), 1800);
    return erro_("Não encontramos chamados com esse telefone e PNR. Confira se são os mesmos informados ao abrir o chamado.");
  }
  cache.remove(k);
  return { ok:true, token: criarSessao_({ tipo:"morador", tel, pnr: p }) };
}

function entrarResponsavel(email, senha){
  email = String(email || "").trim().toLowerCase();
  senha = String(senha || "").trim();
  if(!email || !senha) return erro_("Informe e-mail e senha.");
  const cache = CacheService.getScriptCache();
  const k = "resp_tent_" + email, n = Number(cache.get(k) || 0);
  if(n >= 5) return erro_("Muitas tentativas. Tente de novo em 30 minutos.");
  const r = responsaveis_().find(x => x.ativo && x.email === email && x.senha && x.senha === senha);
  if(!r){
    cache.put(k, String(n + 1), 1800);
    return erro_("E-mail ou senha incorretos.");
  }
  cache.remove(k);
  return { ok:true, nome: r.nome, token: criarSessao_({ tipo:"resp", nome: r.nome, email: r.email }) };
}

function listarChamados(token){
  const s = sessao_(token);
  const resp = s.tipo === "resp";
  const lista = lerChamados_()
    .filter(c => resp || doMorador_(c, s.tel, s.pnr))
    .sort((a, b) => carimbo_(b.abertoEm) - carimbo_(a.abertoEm))
    .map(c => publico_(c, resp));
  return { ok:true, chamados: lista, status: CH.STATUS, categorias: CH.CATEGORIAS };
}

function detalheChamado(token, protocolo){
  const s = sessao_(token);
  const resp = s.tipo === "resp";
  const c = lerChamados_().find(x => x.protocolo === String(protocolo));
  if(!c || (!resp && !doMorador_(c, s.tel, s.pnr))) return erro_("Chamado não encontrado.");
  let foto = "";
  if(c.fotoId){
    try{
      const blob = DriveApp.getFileById(c.fotoId).getBlob();
      foto = "data:" + (blob.getContentType() || "image/jpeg") + ";base64," + Utilities.base64Encode(blob.getBytes());
    }catch(e){ foto = ""; }
  }
  return { ok:true, chamado: publico_(c, resp), andamento: andamentos_(c.protocolo, resp), foto };
}

function atualizarChamado(token, protocolo, d){
  const s = sessao_(token, "resp");
  d = d || {};
  const status = CH.STATUS.indexOf(d.status) > -1 ? d.status : "";
  const msg = textoLongo_(d.mensagem, 1500);
  const interna = !!d.interna;
  if(!status) return erro_("Escolha a situação.");

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    const ss = planilhaChamados_();
    const c = lerChamados_().find(x => x.protocolo === String(protocolo));
    if(!c) return erro_("Chamado não encontrado.");
    if(status === c.status && !msg) return erro_("Escreva uma mensagem ou mude a situação.");
    if(interna && status !== c.status){
      return erro_("Nota interna não muda a situação. Desmarque \"nota interna\" para mudar a situação.");
    }
    if(interna && !msg) return erro_("Escreva a nota interna.");
    const agora = new Date();
    if(!interna){
      ss.getSheetByName(CH.ABA_CHAMADOS).getRange(c.linha, 10, 1, 3).setValues([[status, s.nome, agora]]);
    }
    ss.getSheetByName(CH.ABA_ANDAMENTO).appendRow([
      c.protocolo, agora, s.nome, status,
      msg || "Situação alterada para " + status + ".", interna ? "Sim" : "Não"]);
    SpreadsheetApp.flush();
  }finally{
    lock.releaseLock();
  }
  return detalheChamado(token, protocolo);
}

/* ======================= planilha ======================= */

let planilhaChamadosCache_ = null;

function planilhaChamados_(){
  if(planilhaChamadosCache_) return planilhaChamadosCache_;
  const pasta = DriveApp.getFolderById(CONFIG.ID_PASTA);
  const it = pasta.getFilesByName(CH.NOME_PLANILHA);
  while(it.hasNext()){
    const f = it.next();
    if(!f.isTrashed() && f.getMimeType() === MimeType.GOOGLE_SHEETS){
      return planilhaChamadosCache_ = SpreadsheetApp.open(f);
    }
  }
  const ss = SpreadsheetApp.create(CH.NOME_PLANILHA);
  const a1 = ss.getSheets()[0].setName(CH.ABA_CHAMADOS);
  cabecalho_(a1, CH.COL_CHAMADOS);
  a1.getRange("A:A").setNumberFormat("@");
  a1.getRange("D:E").setNumberFormat("@");
  const a2 = ss.insertSheet(CH.ABA_ANDAMENTO);
  cabecalho_(a2, CH.COL_ANDAMENTO);
  a2.getRange("A:A").setNumberFormat("@");
  const a3 = ss.insertSheet(CH.ABA_RESP);
  cabecalho_(a3, CH.COL_RESP);
  a3.getRange("B:C").setNumberFormat("@");
  DriveApp.getFileById(ss.getId()).moveTo(pasta);
  return planilhaChamadosCache_ = ss;
}

function cabecalho_(aba, colunas){
  aba.getRange(1, 1, 1, colunas.length).setValues([colunas])
     .setFontWeight("bold").setBackground("#1F4D3A").setFontColor("#FFFFFF");
  aba.setFrozenRows(1);
}

function linhasCh_(aba){
  if(!aba || aba.getLastRow() < 2) return [];
  return aba.getRange(2, 1, aba.getLastRow() - 1, aba.getLastColumn()).getValues();
}

function lerChamados_(){
  const aba = planilhaChamados_().getSheetByName(CH.ABA_CHAMADOS);
  return linhasCh_(aba).map((l, i) => ({
    linha: i + 2, protocolo: String(l[0] || "").trim(), abertoEm: l[1],
    nome: String(l[2] || ""), pnr: String(l[3] || ""), telefone: String(l[4] || ""),
    categoria: String(l[5] || ""), local: String(l[6] || ""), descricao: String(l[7] || ""),
    fotoId: String(l[8] || ""), status: String(l[9] || "Aberto"),
    responsavel: String(l[10] || ""), atualizadoEm: l[11]
  })).filter(c => c.protocolo);
}

function andamentos_(protocolo, resp){
  return linhasCh_(planilhaChamados_().getSheetByName(CH.ABA_ANDAMENTO))
    .filter(l => String(l[0]).trim() === protocolo)
    .map(l => ({ data: dataHora_(l[1]), ts: carimbo_(l[1]), autor: String(l[2] || ""),
                 status: String(l[3] || ""), mensagem: String(l[4] || ""),
                 interna: /^s/i.test(String(l[5] || "")) }))
    .filter(a => resp || !a.interna)
    .sort((a, b) => a.ts - b.ts);
}

function responsaveis_(){
  return linhasCh_(planilhaChamados_().getSheetByName(CH.ABA_RESP)).map(l => ({
    nome: String(l[0] || "").trim(),
    email: String(l[1] || "").trim().toLowerCase(),
    senha: String(l[2] || "").trim(),
    recebeEmail: /^s/i.test(String(l[3] || "")),
    ativo: !/^n/i.test(String(l[4] || ""))
  })).filter(r => r.email);
}

function publico_(c, resp){
  const base = {
    protocolo: c.protocolo, abertoEm: dataHora_(c.abertoEm), categoria: c.categoria,
    local: c.local, descricao: c.descricao, status: c.status,
    atualizadoEm: dataHora_(c.atualizadoEm), temFoto: !!c.fotoId
  };
  if(resp){
    base.nome = c.nome; base.pnr = c.pnr; base.telefone = c.telefone; base.responsavel = c.responsavel;
  }
  return base;
}

function proximoProtocolo_(){
  const props = PropertiesService.getScriptProperties();
  const ano = Utilities.formatDate(new Date(), CONFIG.FUSO, "yyyy");
  const n = Number(props.getProperty("CH_SEQ_" + ano) || 0) + 1;
  props.setProperty("CH_SEQ_" + ano, String(n));
  return ano + "-" + ("000" + n).slice(-4);
}

/* ======================= fotos e e-mail ======================= */

function pastaFotos_(){
  const pasta = DriveApp.getFolderById(CONFIG.ID_PASTA);
  const it = pasta.getFoldersByName(CH.NOME_PASTA_FOTOS);
  return it.hasNext() ? it.next() : pasta.createFolder(CH.NOME_PASTA_FOTOS);
}

function salvarFoto_(dataUri, protocolo){
  const m = String(dataUri).match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if(!m) return "";
  const bytes = Utilities.base64Decode(m[2]);
  if(bytes.length > CH.FOTO_MAX_BYTES) return "";
  return pastaFotos_().createFile(Utilities.newBlob(bytes, m[1], protocolo + ".jpg")).getId();
}

function avisarResponsaveis_(c){
  const para = responsaveis_().filter(r => r.ativo && r.recebeEmail).map(r => r.email);
  if(!para.length) return;
  const h = s => String(s || "").replace(/[&<>"]/g, x => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[x]));
  const link = CH.URL_APP + "?p=painel";
  const linhas = [
    ["Tipo", c.categoria], ["Local", c.local || "—"], ["Morador", c.nome],
    ["PNR", c.pnr], ["Telefone", c.tel], ["Foto", c.temFoto ? "sim, ver no painel" : "não"]
  ];
  MailApp.sendEmail({
    to: para.join(","),
    subject: "Chamado " + c.protocolo + " · " + c.categoria,
    body: "Novo chamado " + c.protocolo + "\n\n" +
          linhas.map(l => l[0] + ": " + l[1]).join("\n") + "\n\n" + c.descricao + "\n\nPainel: " + link,
    htmlBody:
      "<p style='font-size:16px'><b>Novo chamado " + h(c.protocolo) + "</b></p>" +
      "<table style='border-collapse:collapse'>" +
      linhas.map(l => "<tr><td style='padding:3px 12px 3px 0;color:#555'>" + h(l[0]) +
                      "</td><td style='padding:3px 0'><b>" + h(l[1]) + "</b></td></tr>").join("") +
      "</table><p style='white-space:pre-wrap'>" + h(c.descricao) + "</p>" +
      "<p><a href='" + link + "'>Abrir o painel de chamados</a></p>",
    name: "ACBT Fácil"
  });
}

/* ======================= sessão e utilitários ======================= */

/** "12-B", "12 b" e "12B" são o mesmo PNR. */
function normPnr_(v){
  return String(v || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}
function doMorador_(c, tel, pnr){
  return !!tel && !!pnr && String(c.telefone).replace(/\D/g, "") === tel && normPnr_(c.pnr) === pnr;
}

function criarSessao_(dados){
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put("sess_" + token, JSON.stringify(dados), CH.SESSAO_MIN * 60);
  return token;
}

function sessao_(token, tipo){
  const v = token ? CacheService.getScriptCache().get("sess_" + token) : null;
  if(!v) throw new Error("SESSAO");
  const s = JSON.parse(v);
  if(tipo && s.tipo !== tipo) throw new Error("SESSAO");
  return s;
}

const erro_ = msg => ({ ok:false, msg });

/** Evita que um texto digitado vire fórmula na planilha. */
function semFormula_(s){
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function texto_(v, max){
  return semFormula_(String(v || "").replace(/\s+/g, " ").trim().slice(0, max));
}
function textoLongo_(v, max){
  return semFormula_(String(v || "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, max));
}
function carimbo_(v){
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
function dataHora_(v){
  const d = v instanceof Date ? v : new Date(v);
  if(!v || isNaN(d.getTime())) return "";
  return Utilities.formatDate(d, CONFIG.FUSO, "dd/MM/yyyy HH:mm");
}

/**
 * RESERVAS DA ÁREA DE LAZER — ACBT Fácil
 *
 * Dia inteiro, uma reserva por dia.
 * Morador entra com SARAM + 4 dígitos do CPF; só quem está em dia com
 * mensalidade e água consegue pedir. A diretoria aprova, registra o
 * pagamento da taxa de uso e a reserva fica confirmada.
 *
 * Valores: evento do morador ou evento de terceiros (no nome do morador),
 * definidos na aba "Configuração". Pagamento em duas parcelas:
 * sinal de 50% para confirmar e restante até o dia do evento.
 *
 * Situações: Solicitada → Aprovada (falta o sinal) → Confirmada (falta o
 *            restante) → Quitada; ou Recusada / Cancelada.
 * Solicitada, Aprovada, Confirmada e Quitada ocupam a data.
 *
 * Agenda do Google: se a aba "Configuração" tiver o endereço da agenda (e ela estiver
 * compartilhada com a conta do app, com permissão para fazer alterações), cada reserva
 * vira um evento de dia inteiro, e eventos criados direto na agenda ocupam o dia no app.
 *
 * Primeira vez: rode configurarReservas() pelo editor (Executar).
 * Taxa, chave PIX, prazos e regras ficam na aba "Configuração" da planilha.
 */

const RS = {
  NOME_PLANILHA: "Reservas — ACBT",
  ABA_RESERVAS: "Reservas",
  ABA_BLOQUEIOS: "Bloqueios",
  ABA_CONFIG: "Configuração",
  COL_RESERVAS: ["Protocolo","Solicitada em","Data do uso","Nome","SARAM","PNR","Telefone","Evento",
                 "Convidados","Taxa","Status","Pago em","Forma de pagamento","Decidido por",
                 "Observação","Histórico","Tipo de evento","Restante pago em","Forma do restante",
                 "Responsável pelo evento (terceiro)","ID na agenda"],
  COL_BLOQUEIOS: ["Data","Motivo","Criado por","Criado em","ID na agenda"],
  COL_CONFIG: ["Parâmetro","Valor","Explicação"],
  CONFIG_PADRAO: [
    ["Taxa — evento do morador", "350", "Valor total, em reais, quando o evento é do próprio morador."],
    ["Taxa — evento de terceiros", "450", "Valor total, em reais, quando o evento é de terceiros no nome do morador."],
    ["Antecedência mínima (dias)", "2", "Com quantos dias de antecedência, no mínimo, o morador pode pedir."],
    ["Antecedência máxima (dias)", "90", "Até quantos dias à frente o calendário fica aberto."],
    ["Reservas ativas por morador", "1", "Quantas reservas futuras cada morador pode ter ao mesmo tempo."],
    ["Chave PIX", "", "Chave para pagar a taxa. O morador só vê depois que a reserva é aprovada."],
    ["Favorecido do PIX", "ACBT", "Nome que aparece para quem paga o PIX."],
    ["Agenda do Google", "", "E-mail da conta (ou ID da agenda) que controla o calendário da área de lazer. Compartilhe essa agenda com a conta do app, com permissão para fazer alterações."],
    ["Regras de uso", "O morador é responsável pela limpeza e conservação do espaço, pelo comportamento dos convidados e pelo respeito ao horário de silêncio.",
     "Texto que o morador precisa aceitar ao pedir a reserva."]
  ],
  ATIVAS: ["Solicitada","Aprovada","Confirmada","Quitada"],
  TIPOS: { morador: "Evento do morador", terceiros: "Evento de terceiros" },
  TEXTO_STATUS: {
    Solicitada: "Aguardando aprovação",
    Aprovada: "Aprovada · falta o sinal",
    Confirmada: "Confirmada · falta o restante",
    Quitada: "Confirmada e paga",
    Recusada: "Recusada",
    Cancelada: "Cancelada"
  }
};

/* ======================= configuração inicial ======================= */

function configurarReservas(){
  const ss = planilhaReservas_();
  const c = configRs_();
  Logger.log("Planilha: " + ss.getUrl());
  Logger.log("Evento do morador: R$ " + c.taxas.morador.toFixed(2) + " · evento de terceiros: R$ " + c.taxas.terceiros.toFixed(2));
  Logger.log("Chave PIX: " + (c.pix || "(vazia) ← preencha na aba Configuração"));
  Logger.log("Agenda do Google: " + statusAgenda_());
  Logger.log("Página do morador: " + CH.URL_APP + "?p=reserva");
  Logger.log("Painel da diretoria: " + CH.URL_APP + "?p=painel");
}

/* ======================= morador ======================= */

function entrarReserva(saram, cpf4){
  const v = validarMorador_(saram, cpf4);
  if(!v.ok) return v;
  const p = v.p;
  const mens = p.temMensalidade ? (p.emAberto || 0) : 0;
  const agua = p.agua ? (p.agua.emAberto || 0) : 0;
  const pendencia = Math.round((mens + agua) * 100) / 100;
  const emDia = !p.encerrado && pendencia < 0.005;
  const c = configRs_();
  return {
    ok: true,
    token: criarSessao_({ tipo:"reserva", saram: p.saram, nome: p.nome, pnr: p.pnr || "", emDia }),
    nome: p.nome, pnr: p.pnr || "",
    telefone: (p.vinculo && p.vinculo.telefone) || "",
    emDia, encerrado: !!p.encerrado, pendencia,
    taxas: c.taxas, regras: c.regras
  };
}

function calendarioReservas(token){
  const s = sessao_(token);
  const c = configRs_();
  const hoje = hojeIso_();
  const dias = {};
  lerReservas_().filter(r => RS.ATIVAS.indexOf(r.status) > -1 && r.data >= hoje).forEach(r => {
    dias[r.data] = (s.tipo === "reserva" && r.saram === s.saram) ? "sua" : "ocupado";
  });
  bloqueios_().filter(b => b.data >= hoje).forEach(b => { if(!dias[b.data]) dias[b.data] = "bloqueado"; });
  const max = somaDias_(hoje, c.maxDias);
  const externos = diasExternos_(hoje, max);
  Object.keys(externos).forEach(d => { if(!dias[d]) dias[d] = "ocupado"; });
  return { ok:true, hoje, min: somaDias_(hoje, c.minDias), max, dias };
}

function solicitarReserva(token, d){
  const s = sessao_(token, "reserva");
  d = d || {};
  if(!s.emDia) return erro_("Há pendências de mensalidade ou taxa de água. Regularize para poder reservar.");
  const c = configRs_();
  const data = String(d.data || "");
  const hoje = hojeIso_(), min = somaDias_(hoje, c.minDias), max = somaDias_(hoje, c.maxDias);
  if(!isoValida_(data)) return erro_("Escolha uma data no calendário.");
  if(data < min || data > max) return erro_(`Escolha uma data entre ${dataBr_(min)} e ${dataBr_(max)}.`);
  const tel = String(d.telefone || "").replace(/\D/g, "").slice(0, 13);
  if(tel.length < 10) return erro_("Informe um telefone com DDD.");
  const pnr = texto_(d.pnr || s.pnr, 20);
  if(!pnr) return erro_("Informe o seu PNR.");
  if(!d.aceite) return erro_("É preciso aceitar as regras de uso.");
  const tipo = RS.TIPOS[d.tipo] ? d.tipo : "";
  if(!tipo) return erro_("Informe se o evento é seu ou de terceiros.");
  const responsavel = tipo === "terceiros" ? texto_(d.responsavel, 80) : "";
  const evento = texto_(d.evento, 80);
  const convidados = String(d.convidados || "").replace(/\D/g, "").slice(0, 4);

  let protocolo;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    const todas = lerReservas_();
    const ocupada = todas.find(r => r.data === data && RS.ATIVAS.indexOf(r.status) > -1);
    if(ocupada || bloqueios_().some(b => b.data === data) || diasExternos_(data, data)[data]){
      return erro_("Essa data não está mais disponível. Escolha outra.");
    }
    const minhas = todas.filter(r => r.saram === s.saram && RS.ATIVAS.indexOf(r.status) > -1 && r.data >= hoje);
    if(minhas.length >= c.maxAtivas){
      return erro_(c.maxAtivas === 1
        ? "Você já tem uma reserva em andamento. Depois dessa data, ou se cancelar a atual, poderá pedir outra."
        : `Você já tem ${minhas.length} reservas em andamento, que é o limite por morador.`);
    }
    protocolo = proximoProtocoloRs_();
    const agora = new Date();
    planilhaReservas_().getSheetByName(RS.ABA_RESERVAS).appendRow([
      protocolo, agora, data, texto_(s.nome, 80), s.saram, pnr, tel, evento, convidados,
      c.taxas[tipo], "Solicitada", "", "", "", "", linhaHist_(agora, "Morador", "Pedido de reserva"),
      RS.TIPOS[tipo], "", "", responsavel, ""]);
    SpreadsheetApp.flush();
    sincronizarEventoRs_(lerReservas_().find(x => x.protocolo === protocolo));
  }finally{
    lock.releaseLock();
  }

  try{
    avisarResponsaveisReserva_({ protocolo, data, nome: s.nome, pnr, tel, evento, convidados,
                                 tipo: RS.TIPOS[tipo], responsavel, valor: c.taxas[tipo] });
  }catch(e){ Logger.log("E-mail não enviado: " + e.message); }
  return { ok:true, protocolo, data, dataBr: dataBr_(data), semana: semana_(data) };
}

function minhasReservas(token){
  const s = sessao_(token, "reserva");
  const c = configRs_();
  const hoje = hojeIso_();
  const lista = lerReservas_().filter(r => r.saram === s.saram)
    .sort((a, b) => b.data.localeCompare(a.data))
    .map(r => ({
      protocolo: r.protocolo, data: r.data, dataBr: dataBr_(r.data), semana: semana_(r.data),
      status: r.status, statusTexto: RS.TEXTO_STATUS[r.status] || r.status,
      evento: r.evento, tipo: r.tipo, taxa: r.taxa, obs: r.obs,
      sinal: parcelas_(r.taxa).sinal, restante: parcelas_(r.taxa).restante,
      pagar: r.status === "Aprovada" && r.taxa > 0
        ? { parcela: "sinal", valor: parcelas_(r.taxa).sinal, pix: c.pix, favorecido: c.favorecido }
        : r.status === "Confirmada"
        ? { parcela: "restante", valor: parcelas_(r.taxa).restante, ate: dataBr_(r.data), pix: c.pix, favorecido: c.favorecido }
        : null,
      podeCancelar: (r.status === "Solicitada" || r.status === "Aprovada") && r.data >= hoje
    }));
  return { ok:true, reservas: lista };
}

function cancelarMinhaReserva(token, protocolo){
  const s = sessao_(token, "reserva");
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    const r = lerReservas_().find(x => x.protocolo === String(protocolo) && x.saram === s.saram);
    if(!r) return erro_("Reserva não encontrada.");
    if(!((r.status === "Solicitada" || r.status === "Aprovada") && r.data >= hojeIso_())){
      return erro_("Essa reserva não pode mais ser cancelada por aqui. Fale com a diretoria.");
    }
    gravarRs_(r, { status:"Cancelada", historico: r.historico + "\n" + linhaHist_(new Date(), "Morador", "Cancelada pelo morador") });
    sincronizarEventoRs_(lerReservas_().find(x => x.protocolo === r.protocolo));
  }finally{
    lock.releaseLock();
  }
  return minhasReservas(token);
}

/* ======================= diretoria ======================= */

function listarReservas(token){
  sessao_(token, "resp");
  const c = configRs_();
  const hoje = hojeIso_();
  const reservas = lerReservas_().sort((a, b) => b.data.localeCompare(a.data)).map(r => ({
    protocolo: r.protocolo, data: r.data, dataBr: dataBr_(r.data), semana: semana_(r.data),
    passou: r.data < hoje, solicitadaEm: dataHora_(r.solicitadaEm),
    nome: r.nome, saram: r.saram, pnr: r.pnr, telefone: r.telefone,
    evento: r.evento, convidados: r.convidados, tipo: r.tipo, responsavel: r.responsavel,
    taxa: r.taxa, sinal: parcelas_(r.taxa).sinal, restante: parcelas_(r.taxa).restante,
    status: r.status, statusTexto: RS.TEXTO_STATUS[r.status] || r.status,
    sinalPagoEm: dataBr_(isoDe_(r.pagoEm)), sinalForma: r.forma,
    restantePagoEm: dataBr_(isoDe_(r.restantePagoEm)), restanteForma: r.restanteForma,
    restanteAtrasado: r.status === "Confirmada" && r.data < hoje,
    decididoPor: r.decididoPor, obs: r.obs, historico: r.historico
  }));
  const bloqueios = bloqueios_().filter(b => b.data >= hoje).sort((a, b) => a.data.localeCompare(b.data))
    .map(b => ({ data: b.data, dataBr: dataBr_(b.data), semana: semana_(b.data), motivo: b.motivo }));
  const ext = diasExternos_(hoje, somaDias_(hoje, c.maxDias));
  const agendaExternos = Object.keys(ext).sort().map(d => ({ data: d, dataBr: dataBr_(d), semana: semana_(d), titulo: ext[d] }));
  return { ok:true, reservas, bloqueios, agendaExternos, agenda: statusAgenda_(),
           config: { taxas: c.taxas, pix: c.pix, favorecido: c.favorecido }, hoje };
}

/**
 * acao: "aprovar" | "pagamento" | "recusar" | "cancelar"
 * Em "pagamento", d.parcela: "sinal", "total" (sinal + restante juntos) ou "restante".
 */
function decidirReserva(token, protocolo, acao, d){
  const s = sessao_(token, "resp");
  d = d || {};
  const motivo = texto_(d.motivo, 300);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    const r = lerReservas_().find(x => x.protocolo === String(protocolo));
    if(!r) return erro_("Reserva não encontrada.");
    let status = r.status, pagoEm = isoDe_(r.pagoEm), forma = r.forma, txt = "";
    let restantePagoEm = isoDe_(r.restantePagoEm), restanteForma = r.restanteForma;
    const pc = parcelas_(r.taxa);

    if(acao === "aprovar"){
      if(r.status !== "Solicitada") return erro_("Só pedidos aguardando aprovação podem ser aprovados.");
      status = r.taxa > 0 ? "Aprovada" : "Quitada";
      txt = r.taxa > 0 ? "Aprovada" : "Aprovada (sem taxa)";
    }else if(acao === "pagamento"){
      const f = /dinheiro/i.test(String(d.forma || "")) ? "Dinheiro" : "PIX";
      const dt = isoValida_(String(d.dataPagamento || "")) ? d.dataPagamento : hojeIso_();
      const brl = v => "R$ " + v.toFixed(2).replace(".", ",");
      if(r.status === "Aprovada" && d.parcela === "total"){
        status = "Quitada"; pagoEm = dt; forma = f; restantePagoEm = dt; restanteForma = f;
        txt = `Valor total recebido, ${brl(r.taxa)} (${f}, ${dataBr_(dt)})`;
      }else if(r.status === "Aprovada"){
        status = "Confirmada"; pagoEm = dt; forma = f;
        txt = `Sinal recebido, ${brl(pc.sinal)} (${f}, ${dataBr_(dt)})`;
      }else if(r.status === "Confirmada"){
        status = "Quitada"; restantePagoEm = dt; restanteForma = f;
        txt = `Restante recebido, ${brl(pc.restante)} (${f}, ${dataBr_(dt)})`;
      }else if(r.status === "Quitada"){
        return erro_("O pagamento desta reserva já está completo.");
      }else{
        return erro_("O pagamento é registrado depois da aprovação.");
      }
    }else if(acao === "recusar"){
      if(r.status !== "Solicitada" && r.status !== "Aprovada") return erro_("Essa reserva não pode ser recusada.");
      if(!motivo) return erro_("Informe o motivo da recusa.");
      status = "Recusada"; txt = "Recusada";
    }else if(acao === "cancelar"){
      if(RS.ATIVAS.indexOf(r.status) < 0) return erro_("Essa reserva já não está ativa.");
      if(!motivo) return erro_("Informe o motivo do cancelamento.");
      status = "Cancelada"; txt = "Cancelada pela diretoria";
    }else{
      return erro_("Ação desconhecida.");
    }

    gravarRs_(r, {
      status, pagoEm, forma, restantePagoEm, restanteForma, decididoPor: s.nome,
      obs: motivo || r.obs,
      historico: r.historico + "\n" + linhaHist_(new Date(), s.nome, txt + (motivo ? ": " + motivo : ""))
    });
    sincronizarEventoRs_(lerReservas_().find(x => x.protocolo === r.protocolo));
  }finally{
    lock.releaseLock();
  }
  return listarReservas(token);
}

function bloquearData(token, data, motivo){
  const s = sessao_(token, "resp");
  data = String(data || "");
  if(!isoValida_(data)) return erro_("Escolha a data a bloquear.");
  if(data < hojeIso_()) return erro_("Escolha uma data a partir de hoje.");
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    if(bloqueios_().some(b => b.data === data)) return erro_("Essa data já está bloqueada.");
    const r = lerReservas_().find(x => x.data === data && RS.ATIVAS.indexOf(x.status) > -1);
    if(r) return erro_(`Já existe a reserva ${r.protocolo} nessa data. Cancele a reserva antes de bloquear.`);
    const m = texto_(motivo, 120) || "Uso da associação";
    const aba = planilhaReservas_().getSheetByName(RS.ABA_BLOQUEIOS);
    aba.appendRow([data, m, s.nome, new Date(), ""]);
    SpreadsheetApp.flush();
    const id = criarEventoAgenda_("🔒 Bloqueado · " + m, data, "Data bloqueada pela diretoria no ACBT Fácil por " + s.nome + ".", "acbt-bloqueio", data);
    if(id) aba.getRange(aba.getLastRow(), 5, 1, 1).setValues([[id]]);
  }finally{
    lock.releaseLock();
  }
  return listarReservas(token);
}

function desbloquearData(token, data){
  sessao_(token, "resp");
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    const b = bloqueios_().find(x => x.data === String(data));
    if(b){
      apagarEventoAgenda_(b.eventoId);
      planilhaReservas_().getSheetByName(RS.ABA_BLOQUEIOS).deleteRow(b.linha);
    }
  }finally{
    lock.releaseLock();
  }
  return listarReservas(token);
}

/* ======================= planilha ======================= */

let planilhaReservasCache_ = null;

function planilhaReservas_(){
  if(planilhaReservasCache_) return planilhaReservasCache_;
  const pasta = DriveApp.getFolderById(CONFIG.ID_PASTA);
  const it = pasta.getFilesByName(RS.NOME_PLANILHA);
  while(it.hasNext()){
    const f = it.next();
    if(!f.isTrashed() && f.getMimeType() === MimeType.GOOGLE_SHEETS){
      planilhaReservasCache_ = SpreadsheetApp.open(f);
      atualizarEstruturaRs_(planilhaReservasCache_);
      return planilhaReservasCache_;
    }
  }
  const ss = SpreadsheetApp.create(RS.NOME_PLANILHA);
  const a1 = ss.getSheets()[0].setName(RS.ABA_RESERVAS);
  cabecalho_(a1, RS.COL_RESERVAS);
  ["A:A","C:C","E:G","L:L","R:R"].forEach(r => a1.getRange(r).setNumberFormat("@"));
  const a2 = ss.insertSheet(RS.ABA_BLOQUEIOS);
  cabecalho_(a2, RS.COL_BLOQUEIOS);
  a2.getRange("A:A").setNumberFormat("@");
  const a3 = ss.insertSheet(RS.ABA_CONFIG);
  cabecalho_(a3, RS.COL_CONFIG);
  a3.getRange("B:B").setNumberFormat("@");
  a3.getRange(2, 1, RS.CONFIG_PADRAO.length, 3).setValues(RS.CONFIG_PADRAO);
  DriveApp.getFileById(ss.getId()).moveTo(pasta);
  return planilhaReservasCache_ = ss;
}

/** Planilhas criadas antes das duas taxas e das parcelas: acrescenta o que falta. */
function atualizarEstruturaRs_(ss){
  const a1 = ss.getSheetByName(RS.ABA_RESERVAS);
  if(a1 && a1.getLastColumn() < RS.COL_RESERVAS.length){
    cabecalho_(a1, RS.COL_RESERVAS);
    a1.getRange("R:R").setNumberFormat("@");
  }
  const a2 = ss.getSheetByName(RS.ABA_BLOQUEIOS);
  if(a2 && a2.getLastColumn() < RS.COL_BLOQUEIOS.length) cabecalho_(a2, RS.COL_BLOQUEIOS);
  const cfg = ss.getSheetByName(RS.ABA_CONFIG);
  if(!cfg) return;
  const nomes = linhasCh_(cfg).map(l => String(l[0] || "").trim().toLowerCase());
  const antiga = nomes.indexOf("taxa de uso");
  RS.CONFIG_PADRAO.forEach(linha => {
    if(nomes.indexOf(linha[0].toLowerCase()) > -1) return;
    if(linha[0] === "Taxa — evento do morador" && antiga > -1){
      cfg.getRange(antiga + 2, 1, 1, 3).setValues([linha]);      // substitui a antiga "Taxa de uso"
    }else{
      cfg.appendRow(linha);
    }
  });
}

/** Sinal de 50% e restante (o que sobrar, para fechar os centavos). */
function parcelas_(total){
  const sinal = Math.round(total * 50) / 100;
  return { sinal, restante: Math.round((total - sinal) * 100) / 100 };
}

function configRs_(){
  const m = {};
  linhasCh_(planilhaReservas_().getSheetByName(RS.ABA_CONFIG))
    .forEach(l => { m[String(l[0] || "").trim().toLowerCase()] = l[1]; });
  const v = (nome, padrao) => {
    const x = m[nome.toLowerCase()];
    return x === undefined || x === "" ? padrao : x;
  };
  return {
    taxas: {
      morador: Math.max(0, numRs_(v("Taxa — evento do morador", 350))),
      terceiros: Math.max(0, numRs_(v("Taxa — evento de terceiros", 450)))
    },
    minDias: Math.max(0, Math.round(numRs_(v("Antecedência mínima (dias)", 2)))),
    maxDias: Math.max(1, Math.round(numRs_(v("Antecedência máxima (dias)", 90)))),
    maxAtivas: Math.max(1, Math.round(numRs_(v("Reservas ativas por morador", 1)))),
    pix: String(v("Chave PIX", "")).trim(),
    favorecido: String(v("Favorecido do PIX", "ACBT")).trim(),
    regras: String(v("Regras de uso", "")).trim(),
    agenda: String(v("Agenda do Google", "")).trim()
  };
}

function lerReservas_(){
  return linhasCh_(planilhaReservas_().getSheetByName(RS.ABA_RESERVAS)).map((l, i) => ({
    linha: i + 2, protocolo: String(l[0] || "").trim(), solicitadaEm: l[1], data: isoDe_(l[2]),
    nome: String(l[3] || ""), saram: String(l[4] || "").replace(/\D/g, ""), pnr: String(l[5] || ""),
    telefone: String(l[6] || ""), evento: String(l[7] || ""), convidados: String(l[8] || ""),
    taxa: numRs_(l[9]), status: String(l[10] || "Solicitada").trim(), pagoEm: l[11],
    forma: String(l[12] || ""), decididoPor: String(l[13] || ""), obs: String(l[14] || ""),
    historico: String(l[15] || ""), tipo: String(l[16] || RS.TIPOS.morador),
    restantePagoEm: l[17], restanteForma: String(l[18] || ""), responsavel: String(l[19] || ""),
    eventoId: String(l[20] || "")
  })).filter(r => r.protocolo && r.data);
}

function bloqueios_(){
  return linhasCh_(planilhaReservas_().getSheetByName(RS.ABA_BLOQUEIOS))
    .map((l, i) => ({ linha: i + 2, data: isoDe_(l[0]), motivo: String(l[1] || ""), eventoId: String(l[4] || "") }))
    .filter(b => b.data);
}

/** Grava as colunas Status…Histórico (K a P) e as do restante (R e S) de uma reserva. */
function gravarRs_(r, c){
  const aba = planilhaReservas_().getSheetByName(RS.ABA_RESERVAS);
  aba.getRange(r.linha, 18, 1, 2).setValues([[
    c.restantePagoEm !== undefined ? c.restantePagoEm : isoDe_(r.restantePagoEm),
    c.restanteForma !== undefined ? c.restanteForma : r.restanteForma
  ]]);
  aba.getRange(r.linha, 11, 1, 6).setValues([[
    c.status !== undefined ? c.status : r.status,
    c.pagoEm !== undefined ? c.pagoEm : isoDe_(r.pagoEm),
    c.forma !== undefined ? c.forma : r.forma,
    c.decididoPor !== undefined ? c.decididoPor : r.decididoPor,
    c.obs !== undefined ? c.obs : r.obs,
    (c.historico !== undefined ? c.historico : r.historico).replace(/^\n+/, "")
  ]]);
  SpreadsheetApp.flush();
}

function proximoProtocoloRs_(){
  const props = PropertiesService.getScriptProperties();
  const ano = Utilities.formatDate(new Date(), CONFIG.FUSO, "yyyy");
  const n = Number(props.getProperty("RS_SEQ_" + ano) || 0) + 1;
  props.setProperty("RS_SEQ_" + ano, String(n));
  return "R" + ano + "-" + ("000" + n).slice(-4);
}

function avisarResponsaveisReserva_(r){
  const para = responsaveis_().filter(x => x.ativo && x.recebeEmail).map(x => x.email);
  if(!para.length) return;
  const h = s => String(s || "").replace(/[&<>"]/g, x => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[x]));
  const link = CH.URL_APP + "?p=painel&aba=reservas";
  const linhas = [
    ["Data", semana_(r.data) + ", " + dataBr_(r.data)], ["Morador", r.nome], ["PNR", r.pnr],
    ["Telefone", r.tel], ["Tipo", r.tipo + " · R$ " + r.valor.toFixed(2).replace(".", ",")],
    ["Responsável (terceiro)", r.responsavel || "—"],
    ["Evento", r.evento || "—"], ["Convidados", r.convidados || "—"]
  ];
  MailApp.sendEmail({
    to: para.join(","),
    subject: "Pedido de reserva " + r.protocolo + " · " + dataBr_(r.data),
    body: "Novo pedido de reserva da área de lazer " + r.protocolo + "\n\n" +
          linhas.map(l => l[0] + ": " + l[1]).join("\n") + "\n\nPainel: " + link,
    htmlBody:
      "<p style='font-size:16px'><b>Novo pedido de reserva " + h(r.protocolo) + "</b></p>" +
      "<table style='border-collapse:collapse'>" +
      linhas.map(l => "<tr><td style='padding:3px 12px 3px 0;color:#555'>" + h(l[0]) +
                      "</td><td style='padding:3px 0'><b>" + h(l[1]) + "</b></td></tr>").join("") +
      "</table><p><a href='" + link + "'>Abrir o painel de reservas</a></p>",
    name: "ACBT Fácil"
  });
}

/* ======================= agenda do Google ======================= */

let agendaCache_ = undefined, agendaErro_ = "";

/** A agenda configurada, ou null se não houver ou se a conta do app não tiver acesso. */
function agendaRs_(){
  if(agendaCache_ !== undefined) return agendaCache_;
  agendaCache_ = null;
  const id = configRs_().agenda;
  if(!id){ agendaErro_ = "não configurada"; return null; }
  try{
    let cal = CalendarApp.getCalendarById(id);
    if(!cal){ try{ cal = CalendarApp.subscribeToCalendar(id); }catch(e){ cal = null; } }
    if(!cal){ agendaErro_ = "sem acesso a " + id + " (compartilhe a agenda com a conta do app)"; return null; }
    agendaCache_ = cal;
  }catch(e){
    agendaErro_ = "erro ao abrir " + id + ": " + e.message;
  }
  return agendaCache_;
}

function statusAgenda_(){
  const cal = agendaRs_();
  if(!cal) return agendaErro_ || "não configurada";
  return "conectada (" + configRs_().agenda + ")";
}

/** Data ISO → meia-noite local, para eventos de dia inteiro. */
function dataLocal_(iso){
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d);
}

/**
 * Dias ocupados na agenda por eventos que NÃO foram criados pelo app
 * (reservas marcadas direto no Google Agenda). Retorna { "2026-10-10": "título" }.
 */
function diasExternos_(ini, fim){
  const cal = agendaRs_();
  const out = {};
  if(!cal) return out;
  try{
    cal.getEvents(dataLocal_(ini), dataLocal_(somaDias_(fim, 1))).forEach(ev => {
      if(ev.getTag("acbt") || ev.getTag("acbt-bloqueio")) return;
      let a, b;
      if(ev.isAllDayEvent()){
        a = isoDe_(ev.getAllDayStartDate());
        b = somaDias_(isoDe_(ev.getAllDayEndDate()), -1);
      }else{
        a = isoDe_(ev.getStartTime());
        b = isoDe_(new Date(ev.getEndTime().getTime() - 1));
      }
      if(!a || !b || b < a) return;
      for(let d = a < ini ? ini : a, n = 0; d <= b && d <= fim && n < 400; d = somaDias_(d, 1), n++){
        if(!out[d]) out[d] = ev.getTitle() || "Evento na agenda";
      }
    });
  }catch(e){
    Logger.log("Agenda (leitura): " + e.message);
  }
  return out;
}

function criarEventoAgenda_(titulo, iso, descricao, tag, valorTag){
  const cal = agendaRs_();
  if(!cal) return "";
  try{
    const ev = cal.createAllDayEvent(titulo, dataLocal_(iso), { description: descricao });
    ev.setTag(tag, valorTag);
    return ev.getId();
  }catch(e){
    Logger.log("Agenda (criar): " + e.message);
    return "";
  }
}

function apagarEventoAgenda_(id){
  const cal = agendaRs_();
  if(!cal || !id) return;
  try{
    const ev = cal.getEventById(id);
    if(ev) ev.deleteEvent();
  }catch(e){
    Logger.log("Agenda (apagar): " + e.message);
  }
}

/** Cria, atualiza ou apaga o evento da reserva conforme a situação. */
function sincronizarEventoRs_(r){
  if(!r || !agendaRs_()) return;
  const aba = planilhaReservas_().getSheetByName(RS.ABA_RESERVAS);
  const ativa = RS.ATIVAS.indexOf(r.status) > -1;
  try{
    let ev = null;
    if(r.eventoId){ try{ ev = agendaRs_().getEventById(r.eventoId); }catch(e){ ev = null; } }
    if(!ativa){
      if(ev) ev.deleteEvent();
      if(r.eventoId) aba.getRange(r.linha, 21, 1, 1).setValues([[""]]);
      return;
    }
    const pc = parcelas_(r.taxa);
    const reais = v => "R$ " + v.toFixed(2).replace(".", ",");
    const situacao = {
      Solicitada: "⏳ Pedido", Aprovada: "✅ Aprovada · falta sinal",
      Confirmada: "🎉 Reservada · falta restante", Quitada: "🎉 Reservada · paga"
    }[r.status];
    const titulo = `${situacao} · PNR ${r.pnr} · ${r.nome.split(" ").slice(0, 2).join(" ")}`;
    const desc = [
      "Reserva " + r.protocolo + " (ACBT Fácil)",
      "Situação: " + (RS.TEXTO_STATUS[r.status] || r.status),
      "Morador: " + r.nome + " · PNR " + r.pnr + " · " + r.telefone,
      r.tipo + (r.responsavel ? " · responsável: " + r.responsavel : ""),
      r.evento ? "Evento: " + r.evento : "", r.convidados ? "Convidados: " + r.convidados : "",
      "Taxa: " + reais(r.taxa) + " (sinal " + reais(pc.sinal) + " + restante " + reais(pc.restante) + ")",
      "Painel: " + CH.URL_APP + "?p=painel&aba=reservas"
    ].filter(Boolean).join("\n");
    if(ev){
      ev.setTitle(titulo);
      ev.setDescription(desc);
    }else{
      const id = criarEventoAgenda_(titulo, r.data, desc, "acbt", r.protocolo);
      if(id) aba.getRange(r.linha, 21, 1, 1).setValues([[id]]);
    }
  }catch(e){
    Logger.log("Agenda (sincronizar " + r.protocolo + "): " + e.message);
  }
}

/* ======================= datas ======================= */

function hojeIso_(){
  return Utilities.formatDate(new Date(), CONFIG.FUSO, "yyyy-MM-dd");
}
function somaDias_(iso, n){
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
function isoValida_(s){
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && somaDias_(s, 0) === s;
}
function isoDe_(v){
  if(v instanceof Date) return isNaN(v.getTime()) ? "" : Utilities.formatDate(v, CONFIG.FUSO, "yyyy-MM-dd");
  const s = String(v || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return m[0];
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? m[3] + "-" + m[2] + "-" + m[1] : "";
}
function dataBr_(iso){
  return iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "";
}
function semana_(iso){
  if(!iso) return "";
  const [a, m, d] = iso.split("-").map(Number);
  return ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"]
    [new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
}
function linhaHist_(d, autor, txt){
  return Utilities.formatDate(d, CONFIG.FUSO, "dd/MM/yyyy HH:mm") + " · " + autor + " · " + txt;
}
function numRs_(v){
  if(typeof v === "number") return v;
  let s = String(v || "").replace(/[R$\s]/g, "");
  if(s.indexOf(",") > -1) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/* ======================= diagnóstico da agenda ======================= */

/** Rode pelo editor para ver o que o app enxerga na agenda do Google. */
function diagnosticoAgenda(){
  const c = configRs_();
  Logger.log("ID configurado na planilha: [" + c.agenda + "]");
  Logger.log("Situação: " + statusAgenda_());
  const cal = agendaRs_();
  if(cal){
    Logger.log("Agenda aberta: " + cal.getName());
    const hoje = hojeIso_(), fim = somaDias_(hoje, c.maxDias);
    const evs = cal.getEvents(dataLocal_(hoje), dataLocal_(somaDias_(fim, 1)));
    Logger.log("Eventos de " + dataBr_(hoje) + " a " + dataBr_(fim) + ": " + evs.length);
    evs.slice(0, 25).forEach(ev => Logger.log(
      "  " + dataBr_(isoDe_(ev.isAllDayEvent() ? ev.getAllDayStartDate() : ev.getStartTime())) +
      (ev.isAllDayEvent() ? " (dia inteiro)" : " (com horário)") + " · " + ev.getTitle() +
      (ev.getTag("acbt") || ev.getTag("acbt-bloqueio") ? " · criado pelo app" : " · criado direto no Gmail")));
    Logger.log("Dias ocupados por eventos do Gmail: " + Object.keys(diasExternos_(hoje, fim)).join(", "));
  }
  Logger.log("---- Agendas que a conta do app consegue ver ----");
  CalendarApp.getAllCalendars().forEach(k => Logger.log("  " + k.getName() + " → " + k.getId()));
}

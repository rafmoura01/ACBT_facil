/**
 * CONSULTA DO MORADOR — ACBT
 * Projeto SEPARADO do app da diretoria. Não altera nada: só lê a "fotografia"
 * dos dados que o app da diretoria salva no Drive e devolve ao morador
 * apenas a situação dele.
 *
 * Implantar como App da Web:  Executar como: Eu  ·  Quem pode acessar: Qualquer pessoa
 *
 * Só doGet, consultar e diagnostico ficam visíveis. Todo o resto está
 * fechado dentro de Motor_ e das funções terminadas em "_", que o navegador
 * não consegue chamar.
 */

const CONFIG = {
  ID_PASTA: "1o2R7pTbza2BTFjYvoPRmAdBQzzVIKUDD",   // mesma pasta monitorada pelo app da diretoria
  NOME_CACHE: "cache do app de mensalidades (não apagar).json",
  ID_CACHE: "",          // opcional: cole aqui o ID do arquivo, se existir mais de um com esse nome
  TENTATIVAS: 5,         // erros seguidos permitidos para o mesmo SARAM
  BLOQUEIO_MIN: 30,      // minutos de bloqueio depois disso
  FUSO: "America/Belem"
};

const PAGINAS = {
  consulta: ["Pagina", "Mensalidade e água · ACBT"],
  chamado:  ["Chamado", "Chamados · ACBT"],
  reserva:  ["Reserva", "Área de lazer · ACBT"],
  painel:   ["Painel", "Painel da diretoria · ACBT"]
};

function doGet(e){
  const p = e && e.parameter && e.parameter.p;
  const [arquivo, titulo] = Object.prototype.hasOwnProperty.call(PAGINAS, p) ? PAGINAS[p] : ["Hub", "ACBT Fácil"];
  return HtmlService.createHtmlOutputFromFile(arquivo)
    .setTitle(titulo)
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);   // permite abrir dentro do app instalado
}

/** Chamada pela página. Só responde se SARAM e final do CPF baterem com o mesmo cadastro. */
function consultar(saram, cpf4){
  const v = validarMorador_(saram, cpf4);
  if(!v.ok) return v;
  return { ok:true, dados: resumo_(v.p, v.S, v.snap) };
}

/** Confere SARAM + 4 últimos dígitos do CPF no cadastro. Usada pela consulta e pelos chamados. */
function validarMorador_(saram, cpf4){
  saram = String(saram || "").replace(/\D/g, "");
  cpf4 = String(cpf4 || "").replace(/\D/g, "");
  if(saram.length !== 7 || cpf4.length !== 4){
    return { ok:false, msg:"Informe o SARAM com 7 dígitos e os 4 últimos dígitos do CPF." };
  }

  const cache = CacheService.getScriptCache();
  const chave = "tent_" + saram;
  const tentativas = Number(cache.get(chave) || 0);
  if(tentativas >= CONFIG.TENTATIVAS){
    return { ok:false, msg:`Muitas tentativas seguidas para este SARAM. Tente de novo daqui a ${CONFIG.BLOQUEIO_MIN} minutos.` };
  }

  let snap;
  try{ snap = lerSnapshot_(); }
  catch(e){ return { ok:false, msg:"A consulta está indisponível no momento. Tente mais tarde ou fale com a diretoria." }; }

  const S = Motor_.calcular(snap);
  const p = [...S.pessoas.values()].find(x =>
    x.saram === saram && /^\d{11}$/.test(x.cpf) && x.cpf.slice(-4) === cpf4);

  if(!p){
    cache.put(chave, String(tentativas + 1), CONFIG.BLOQUEIO_MIN * 60);
    return { ok:false, msg:"Não encontramos um cadastro com esses dados. Confira o SARAM e o CPF. Se estiverem certos, procure a diretoria para atualizar o seu cadastro." };
  }
  cache.remove(chave);
  return { ok:true, p, S, snap };
}

/** Rode pelo editor (Executar) para conferir se a fotografia foi encontrada. Não devolve dados ao navegador. */
function diagnostico(){
  const snap = lerSnapshot_();
  const S = Motor_.calcular(snap);
  const pessoas = [...S.pessoas.values()];
  Logger.log("Fotografia salva em: " + formatarData_(snap.salvoEm));
  Logger.log("Competências da mensalidade: " + S.comps.length + " · da água: " + S.compsAgua.length);
  Logger.log("Pessoas: " + pessoas.length +
    " · com SARAM e CPF (podem consultar): " + pessoas.filter(p => p.saram && /^\d{11}$/.test(p.cpf)).length);
  Logger.log("Sem SARAM ou sem CPF (não conseguem consultar): " +
    pessoas.filter(p => !p.encerrado && !(p.saram && /^\d{11}$/.test(p.cpf))).map(p => p.nome).join(", "));
}

/* ================= leitura da fotografia ================= */
function lerSnapshot_(){
  let arq = null;
  if(CONFIG.ID_CACHE){
    arq = DriveApp.getFileById(CONFIG.ID_CACHE);
  }else{
    const pasta = DriveApp.getFolderById(CONFIG.ID_PASTA);
    const it = pasta.getFilesByName(CONFIG.NOME_CACHE);
    while(it.hasNext()){
      const f = it.next();
      if(f.isTrashed()) continue;
      if(!arq || f.getLastUpdated() > arq.getLastUpdated()) arq = f;
    }
  }
  if(!arq) throw new Error("Arquivo de dados não encontrado: " + CONFIG.NOME_CACHE);
  return JSON.parse(arq.getBlob().getDataAsString("UTF-8"));
}

function formatarData_(v){
  const d = new Date(v);
  if(!v || isNaN(d.getTime())) return "";
  return Utilities.formatDate(d, CONFIG.FUSO, "dd/MM/yyyy 'às' HH:mm");
}

/* ================= o que o morador vê ================= */
function resumo_(p, S, snap){
  const R = Motor_.ROTULOS;
  const mesesDe = (linha, rot) => linha.filter(x => x.estado !== "fora").slice(-12)
    .map(x => ({ comp:x.comp, estado:x.estado, rotulo:rot[x.estado] || x.estado }));
  const pendDe = (lista, rot) => lista.map(x => ({
    comp:x.comp, estado:x.estado, rotulo:rot[x.estado] || x.estado,
    valor:x.restante || 0, pago:x.estado === "parcial" ? x.valor : 0
  }));

  return {
    nome: p.nome,
    posto: p.posto && p.posto !== "Só taxa de água" && p.posto !== "Paga por PIX" ? p.posto : "",
    pnr: p.pnr || "",
    encerrado: !!p.encerrado,
    saida: p.saida || "",
    atualizadoEm: formatarData_(snap.salvoEm),
    mensalidade: p.temMensalidade ? {
      valor: p.parcelaUsual || 0,
      emAberto: p.emAberto || 0,
      pendencias: pendDe(p.pendencias, R.mens),
      meses: mesesDe(p.linha, R.mens)
    } : null,
    agua: S.compsAgua.length && p.agua ? {
      isento: p.aguaModo === "isento",
      emAberto: p.agua.emAberto || 0,
      pendencias: pendDe(p.agua.pendencias, R.agua),
      meses: mesesDe(p.agua.linha, R.agua)
    } : null
  };
}

/* =================================================================
   MOTOR DE CÁLCULO — cópia fiel da regra do app da diretoria
   (lerLinha, consolidar, derivar, derivarAgua). Se a regra mudar lá,
   atualize aqui também.
   ================================================================= */
const Motor_ = (function(){
  let S, PIX, AGUA;
  const L = { pago:"pago", pix:"pix", misto:"misto", parcial:"parcial", naoproc:"naoproc", semreg:"semreg" };

  const ROTULOS = {
    mens: { pago:"Pago (folha)", pix:"Pago (PIX)", misto:"Pago (folha + PIX)", parcial:"Pago em parte",
            naoproc:"Não descontado na folha", semreg:"Em aberto", aguardando:"Aguardando processamento" },
    agua: { pago:"Pago (folha)", pix:"Pago (avulso)", misto:"Pago (folha + avulso)", parcial:"Pago em parte",
            semreg:"Em aberto", aguardando:"Aguardando relatório", isento:"Isento" }
  };

  const CAMPOS = [
    ["orgao",0,6],["dataFolha",6,14],["horaGer",14,20],["matricula",20,30],["cpf",30,41],["nome",41,131],
    ["codSit",131,133],["situacao",133,140],["posto",140,220],["codPosto",220,222],["ugPagadora",222,322],
    ["ugLotacao",322,422],["valParcela",422,431],["valAux1",431,440],["valDescontado",440,449],
    ["valAux2",449,458],["codOcorrencia",458,464],["descOcorrencia",464,554],["contrato",554,563]
  ];

  function lerLinha(l){
    if(l.length < 464) return null;
    const r = {};
    for(const [nome,i,f] of CAMPOS) r[nome] = l.slice(i,f);
    const num = s => { const n = parseInt(s,10); return isNaN(n) ? 0 : n/100; };
    return {
      matricula:r.matricula.trim(), cpf:r.cpf.trim(), nome:r.nome.trim(), situacao:r.situacao.trim(),
      posto:r.posto.trim(), ugPagadora:r.ugPagadora.trim(), ugLotacao:r.ugLotacao.trim(),
      parcela:num(r.valParcela), descontado:num(r.valDescontado),
      codOcorrencia:r.codOcorrencia, descOcorrencia:r.descOcorrencia.trim(),
      contrato:r.contrato.trim(), compHeader:r.dataFolha.slice(0,6)
    };
  }
  const pago = reg => parseInt(reg.codOcorrencia,10) === 1;

  function competenciaDoNome(nome){
    const m = nome.match(/_(\d{2})(\d{4})(?:\s*\(\d+\))?\s*\.txt$/i);
    return m ? m[2] + m[1] : null;
  }
  function geracaoDoNome(nome){
    const m = nome.match(/(\d{2})-(\d{2})-(\d{4})-(\d{6})/);
    return m ? m[3]+m[2]+m[1]+m[4] : "0";
  }

  const arred = v => Math.round((v || 0) * 100) / 100;
  function moda(arr){
    if(!arr.length) return 0;
    const c = new Map();
    arr.forEach(v => c.set(v,(c.get(v)||0)+1));
    return [...c.entries()].sort((a,b) => b[1]-a[1] || b[0]-a[0])[0][0];
  }
  const normNome = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
  const saramDaMatricula = m => /^\d{10}$/.test(m || "") ? m.slice(1, 8) : "";
  function proximaComp(comp){
    if(!comp) return "";
    let ano = +comp.slice(0,4), mes = +comp.slice(4,6) + 1;
    if(mes > 12){ mes = 1; ano++; }
    return ano + ("0" + mes).slice(-2);
  }
  function faixaComps(ini, fim){
    const r = [];
    for(let c = ini; c && c <= fim && r.length < 600; c = proximaComp(c)) r.push(c);
    return r;
  }
  function valorAgua(comp){
    const vs = (PIX.valores || []).filter(v => v.cobranca === "agua" && v.desde <= comp)
      .sort((a,b) => a.desde.localeCompare(b.desde));
    return vs.length ? vs[vs.length-1].valor : 30;
  }

  function calcular(snap){
    S = { arquivos:[], comps:[], compsRetorno:new Set(), pessoas:new Map(), mensalidadeGeral:0,
          compsAgua:[], aguaRetorno:new Set(), aguaArquivos:new Map() };
    PIX = snap.pix ? snap.pix : { moradores:[], pagamentos:[], situacoes:[], valores:[] };
    AGUA = snap.agua ? snap.agua : { arquivos:[], registros:[] };

    const txt = snap.txt || {};
    Object.keys(txt).forEach(id => {
      const f = txt[id];
      const regs = String(f.conteudo || "").split(/\r?\n/)
        .filter(l => l.trim().length > 100).map(lerLinha).filter(Boolean);
      if(!regs.length) return;
      S.arquivos.push({ nome:f.nome, comp:competenciaDoNome(f.nome) || regs[0].compHeader,
                        geracao:geracaoDoNome(f.nome), registros:regs, ignorado:false });
    });
    consolidar();
    return S;
  }

  function consolidar(){
    const porComp = new Map();
    for(const a of S.arquivos){ (porComp.get(a.comp) || porComp.set(a.comp,[]).get(a.comp)).push(a); }
    const validos = [];
    for(const [, arr] of porComp){
      arr.sort((x,y) => y.geracao.localeCompare(x.geracao) || y.registros.length - x.registros.length);
      validos.push(arr[0]);
    }

    const pagMens = (PIX.pagamentos || []).filter(g => g.tipo !== "agua");
    const pagAgua = (PIX.pagamentos || []).filter(g => g.tipo === "agua");
    S.compsRetorno = new Set(validos.map(a => a.comp));
    const universo = new Set(validos.map(a => a.comp));
    pagMens.forEach(g => { if(g.comp) universo.add(g.comp); });
    S.comps = [...universo].sort();

    const idxSaram = new Map(), idxNome = new Map();
    const indexar = p => {
      if(p.saram && !idxSaram.has(p.saram)) idxSaram.set(p.saram, p);
      const n = normNome(p.nome);
      if(n && !idxNome.has(n)) idxNome.set(n, p);
    };
    const achar = (cpf, saram, nome, criar) => {
      cpf = /^\d{11}$/.test(cpf || "") ? cpf : "";
      let p = cpf ? S.pessoas.get(cpf) : null;
      if(!p && saram) p = idxSaram.get(saram) || null;
      if(!p && nome) p = idxNome.get(normNome(nome)) || null;
      if(p && cpf && /^\d{11}$/.test(p.cpf) && p.cpf !== cpf) p = null;
      if(p && cpf && !/^\d{11}$/.test(p.cpf)){ S.pessoas.delete(p.cpf); p.cpf = cpf; S.pessoas.set(cpf, p); }
      if(!p && criar){
        const chave = cpf || (saram ? "saram:" + saram : "nome:" + normNome(nome));
        p = S.pessoas.get(chave) || novaPessoa(chave, nome);
        S.pessoas.set(chave, p);
      }
      return p;
    };

    for(const arq of validos){
      for(const reg of arq.registros){
        let p = S.pessoas.get(reg.cpf);
        if(!p){ p = novaPessoa(reg.cpf, reg.nome); S.pessoas.set(reg.cpf, p); }
        p.nome = reg.nome; p.posto = reg.posto; p.situacao = reg.situacao; p.matricula = reg.matricula;
        p.saram = p.saram || saramDaMatricula(reg.matricula);
        p.meses.set(arq.comp, reg);
        indexar(p);
      }
    }
    for(const m of (PIX.moradores || [])){
      const p = achar(m.cpf, "", m.nome, true);
      p.cadastroPix = m;
      if(m.nome) p.nome = m.nome;
      if(m.posto) p.posto = m.posto;
      indexar(p);
    }
    for(const st of (PIX.situacoes || [])){
      const p = achar(st.cpf, st.saram, st.nome, true);
      p.vinculo = st;
      if(st.nome) p.nome = st.nome;
      if(st.saram) p.saram = st.saram;
      indexar(p);
    }
    for(const g of (PIX.pagamentos || [])){
      const p = achar(g.cpf, g.saram, g.nome, true);
      if(!p.nome && g.nome) p.nome = g.nome;
      indexar(p);
      const alvo = g.tipo === "agua" ? p.aguaAvulso : p.pix;
      if(!alvo.has(g.comp)) alvo.set(g.comp, []);
      alvo.get(g.comp).push(g);
    }

    const porCompA = new Map();
    for(const a of (AGUA.arquivos || [])){
      if(!a.comp || !a.linhas) continue;
      (porCompA.get(a.comp) || porCompA.set(a.comp, []).get(a.comp)).push(a);
    }
    const arqAguaValidos = new Set();
    for(const [comp, arr] of porCompA){
      arr.sort((x,y) => Number(y.versao) - Number(x.versao) || y.linhas - x.linhas);
      S.aguaArquivos.set(comp, arr[0]);
      arqAguaValidos.add(arr[0].id);
    }
    for(const r of (AGUA.registros || [])){
      if(!r.comp || !arqAguaValidos.has(r.arquivoId)) continue;
      S.aguaRetorno.add(r.comp);
      let p = achar("", r.saram, r.nome, false);
      if(!p){ p = achar("", r.saram, r.nome, true); p.origemAgua = true; }
      if(!p.posto && r.posto) p.posto = r.posto;
      if(!p.saram) p.saram = r.saram;
      indexar(p);
      if(!p.aguaFolha.has(r.comp)) p.aguaFolha.set(r.comp, []);
      p.aguaFolha.get(r.comp).push(r);
    }
    const compsComAgua = [...S.aguaRetorno, ...pagAgua.map(g => g.comp).filter(Boolean)].sort();
    S.compsAgua = compsComAgua.length
      ? faixaComps(compsComAgua[0], [...compsComAgua, ...S.comps].sort().pop()) : [];

    const totaisMensais = [];
    for(const p of S.pessoas.values())
      for(const c of S.comps){
        const r = p.meses.get(c);
        const v = arred((r && pago(r) ? r.descontado : 0) +
                        (p.pix.get(c) || []).reduce((t,g) => t + (g.valor||0), 0));
        if(v > 0) totaisMensais.push(v);
      }
    S.mensalidadeGeral = moda(totaisMensais);

    for(const p of S.pessoas.values()){ derivar(p); derivarAgua(p); }
  }

  function novaPessoa(chave, nome){
    return { cpf:chave, nome:nome || "", matricula:"", saram:"", posto:"", situacao:"",
             meses:new Map(), pix:new Map(), cadastroPix:null, vinculo:null,
             aguaFolha:new Map(), aguaAvulso:new Map(), origemAgua:false };
  }

  function derivar(p){
    const cad = p.cadastroPix, vin = p.vinculo;
    const todas = [...new Set([...p.meses.keys(), ...p.pix.keys()])].sort();

    const inicios = [];
    if(vin && vin.entrada) inicios.push(vin.entrada);
    if(cad && cad.inicio) inicios.push(cad.inicio);
    if(todas.length) inicios.push(todas[0]);
    p.primeira = inicios.length ? inicios.sort()[0] : S.comps[0];

    p.pnr = (vin && vin.pnr) || "";
    p.encerrado = !!(vin && vin.encerrado);
    p.saida = (vin && vin.saida) || "";

    const fins = [];
    if(p.saida) fins.push(p.saida);
    if(cad && cad.fim) fins.push(cad.fim);
    p.fim = fins.length ? fins.sort()[0] : "";

    const formaCad = vin ? (vin.forma || "") : "";
    p.temMensalidade = p.meses.size > 0 || p.pix.size > 0 || !!cad ||
                       (!!vin && formaCad !== "nenhuma" && !(p.origemAgua && !formaCad));
    if(!p.temMensalidade){
      const primAgua = [...p.aguaFolha.keys(), ...p.aguaAvulso.keys()].sort()[0];
      p.primeira = (vin && vin.entrada) || primAgua || S.compsAgua[0] || S.comps[0] || "";
      p.parcelaUsual = 0;
      p.linha = S.comps.map(c => ({ comp:c, estado:"fora" }));
      p.pendencias = []; p.emAberto = 0;
      return;
    }

    const somaFolha = c => { const r = p.meses.get(c); return r && pago(r) ? r.descontado : 0; };
    const somaPix   = c => (p.pix.get(c) || []).reduce((s,g) => s + (g.valor||0), 0);

    p.parcelaUsual = (cad && cad.mensalidade > 0)
      ? cad.mensalidade
      : moda(todas.map(c => arred(somaFolha(c) + somaPix(c))).filter(v => v > 0)) || S.mensalidadeGeral || 0;

    p.linha = S.comps.map(c => {
      if(p.primeira && c < p.primeira) return { comp:c, estado:"fora" };
      if(p.fim && c > p.fim){
        const extraPix = (p.pix.get(c) || []).reduce((t,g) => t + (g.valor||0), 0);
        const regPos = p.meses.get(c);
        const extraFolha = regPos && pago(regPos) ? regPos.descontado : 0;
        if(extraPix + extraFolha > 0){
          return { comp:c, estado: extraFolha > 0 && extraPix > 0 ? L.misto : extraFolha > 0 ? L.pago : L.pix,
                   valorFolha:extraFolha, valorPix:extraPix, valor:arred(extraFolha+extraPix), esperado:0, restante:0 };
        }
        return { comp:c, estado:"fora" };
      }
      const reg = p.meses.get(c);
      const vFolha = somaFolha(c), vPix = somaPix(c);
      const pagoNoMes = arred(vFolha + vPix);
      const esperado = p.parcelaUsual || 0;
      const base = { comp:c, reg, valorFolha:vFolha, valorPix:vPix, valor:pagoNoMes, esperado, restante:0 };

      if(pagoNoMes <= 0){
        if(reg && !pago(reg)) return { ...base, estado:L.naoproc, valor:reg.parcela, restante:reg.parcela };
        const estado = S.compsRetorno.has(c) ? L.semreg : "aguardando";
        return { ...base, estado, valor:esperado, restante: estado === L.semreg ? esperado : 0 };
      }
      if(esperado > 0 && pagoNoMes < esperado - 0.005)
        return { ...base, estado:L.parcial, restante: arred(esperado - pagoNoMes) };
      if(vFolha > 0 && vPix > 0) return { ...base, estado:L.misto };
      return { ...base, estado: vFolha > 0 ? L.pago : L.pix };
    });

    p.pendencias = p.linha.filter(x => x.estado === L.semreg || x.estado === L.naoproc || x.estado === L.parcial);
    p.emAberto = arred(p.pendencias.reduce((s,x) => s + (x.restante || 0), 0));
  }

  function derivarAgua(p){
    const vin = p.vinculo;
    const modo = (vin && vin.agua) || "automatico";
    p.aguaModo = modo;
    const A = { linha:[], pendencias:[], emAberto:0 };
    p.agua = A;
    if(!S.compsAgua.length) return;

    const primAgua = [...p.aguaFolha.keys(), ...p.aguaAvulso.keys()].sort()[0];
    let ini;
    if(vin && vin.aguaDesde) ini = vin.aguaDesde;
    else if(p.temMensalidade) ini = p.primeira;
    else ini = (vin && vin.entrada) || primAgua || S.compsAgua[0];
    if(primAgua && primAgua < ini) ini = primAgua;
    if(!ini || ini < S.compsAgua[0]) ini = S.compsAgua[0];

    const somaF = c => (p.aguaFolha.get(c) || []).reduce((s,r) => s + (r.valor||0), 0);
    const somaA = c => (p.aguaAvulso.get(c) || []).reduce((s,g) => s + (g.valor||0), 0);

    A.linha = S.compsAgua.map(c => {
      const vF = arred(somaF(c)), vA = arred(somaA(c)), pagoMes = arred(vF + vA);
      const base = { comp:c, valorFolha:vF, valorPix:vA, valor:pagoMes, esperado:0, restante:0 };
      const quitado = () => vF > 0 && vA > 0 ? L.misto : vF > 0 ? L.pago : L.pix;
      const foraDoPeriodo = c < ini || (p.fim && c > p.fim);
      if(foraDoPeriodo || modo === "isento"){
        if(pagoMes > 0) return { ...base, estado: quitado() };
        return { ...base, estado: !foraDoPeriodo && modo === "isento" ? "isento" : "fora" };
      }
      const esperado = valorAgua(c);
      base.esperado = esperado;
      if(pagoMes <= 0){
        if(modo === "avulso" || S.aguaRetorno.has(c)) return { ...base, estado:L.semreg, restante:esperado };
        return { ...base, estado:"aguardando" };
      }
      if(pagoMes < esperado - 0.005) return { ...base, estado:L.parcial, restante: arred(esperado - pagoMes) };
      return { ...base, estado: quitado() };
    });

    A.pendencias = A.linha.filter(x => x.estado === L.semreg || x.estado === L.parcial);
    A.emAberto = arred(A.pendencias.reduce((s,x) => s + (x.restante || 0), 0));
  }

  return { calcular, ROTULOS };
})();

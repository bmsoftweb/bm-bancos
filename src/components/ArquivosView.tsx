import React, { useCallback, useMemo, useState } from 'react';
import { Ban, CheckCheck, CloudDownload, Download, FilePlus2, Upload } from 'lucide-react';
import * as api from '../services/api';
import { Ocorrencia, Remessa, Retorno } from '../types';
import { ColunaGrade, Grade } from './Grade';
import { BotaoAcao } from './MenuAcoes';
import { Botao, Confirmacao, Selecao } from './ui';
import { AvisoErro, AvisoSucesso } from './AvisoErro';
import { useProgresso } from './ProgressoModal';
import { EscolherArquivo, SeletorConta, etiqueta, useAcao, useContas } from './comum';
import { SITUACOES_REMESSA, TIPOS_OCORRENCIA, formatarData, formatarDataHora, formatarMoeda, moedaOuTraco, opcoesFiltro } from '../utils/formatters';

const resumo = (r: { novas: number; repetidas: number; semBoleto: number }) =>
  `${r.novas} ocorrência(s) nova(s)` + (r.repetidas ? `, ${r.repetidas} já conhecida(s)` : '') + (r.semBoleto ? `, ${r.semBoleto} sem boleto` : '') + '.';

// ---------------------------------------------------------------------------
// Remessas
// ---------------------------------------------------------------------------

export const RemessasView: React.FC<{ onMudou: () => void }> = ({ onMudou }) => {
  const [recarregar, setRecarregar] = useState(0);
  const [conta, setConta] = useState<number | ''>('');
  const [cancelando, setCancelando] = useState<Remessa | null>(null);
  const contas = useContas(recarregar);
  const acao = useAcao();
  const progresso = useProgresso();
  const escolhida = contas.find((c) => c.id === conta);
  const pendentes = escolhida ? Number(escolhida.boletos_remessa) + Number(escolhida.instrucoes_remessa) : 0;

  const atualizou = () => {
    setRecarregar((n) => n + 1);
    onMudou();
  };

  const gerar = () =>
    acao.executar('gerar', async () => {
      if (!escolhida) throw new Error('Escolha a conta da remessa.');
      const r = await progresso.aguardar('Gerando a remessa', 'Montando o arquivo CNAB…', () => api.gerarRemessa(escolhida.id));
      atualizou();
      await api.baixarRemessa(r.id);
      return `Remessa ${r.numero} gerada: ${r.boletos} boleto(s) e ${r.instrucoes} instrução(ões). Envie o arquivo pelo site do banco.`;
    });

  const carregarPagina = useCallback((c: api.ConsultaGrade) => api.listarRemessas(c, { conta }), [conta]);

  const colunas = useMemo<ColunaGrade<Remessa>[]>(
    () => [
      { nome: 'criado_em', rotulo: 'Gerada em', tipo: 'data', valor: (r) => formatarDataHora(r.criado_em) },
      { nome: 'numero', rotulo: 'NSA', tipo: 'numero', valor: (r) => r.numero },
      { nome: 'conta', rotulo: 'Conta', valor: (r) => r.conta },
      { nome: 'nome_arquivo', rotulo: 'Arquivo', ordenavel: false, valor: (r) => r.nome_arquivo },
      { nome: 'layout', rotulo: 'Layout', tipo: 'centro', ordenavel: false, valor: (r) => `CNAB ${r.layout}` },
      { nome: 'qtde_registros', rotulo: 'Registros', tipo: 'numero', valor: (r) => r.qtde_registros },
      { nome: 'valor_total', rotulo: 'Valor', tipo: 'numero', valor: (r) => formatarMoeda(r.valor_total) },
      { nome: 'situacao', rotulo: 'Situação', tipo: 'centro', valor: (r) => etiqueta(SITUACOES_REMESSA, r.situacao) },
    ],
    [],
  );

  const acoes = (r: Remessa) => (
    <>
      <BotaoAcao icone={Download} titulo="Baixar" descricao="Arquivo da remessa para enviar ao banco" onClick={() => acao.executar(`baixar-${r.id}`, () => api.baixarRemessa(r.id))} />
      {r.situacao === 'gerada' && (
        <>
          <BotaoAcao
            icone={CheckCheck}
            titulo="Marcar enviada"
            descricao="O arquivo já foi enviado ao banco"
            tom="verde"
            carregando={acao.ocupado === `enviada-${r.id}`}
            onClick={() => acao.executar(`enviada-${r.id}`, async () => { await api.marcarRemessaEnviada(r.id); atualizou(); return `Remessa ${r.numero} marcada como enviada.`; })}
          />
          <BotaoAcao icone={Ban} titulo="Cancelar" descricao="Devolve os boletos e instruções à fila" tom="perigo" onClick={() => setCancelando(r)} />
        </>
      )}
    </>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {acao.erro && <AvisoErro mensagem={acao.erro} onFechar={() => acao.setErro(null)} />}
      {acao.feito && <AvisoSucesso mensagem={acao.feito} onFechar={() => acao.setFeito(null)} />}
      {progresso.modal}
      <Grade<Remessa>
        recurso="remessas"
        colunas={colunas}
        carregarPagina={carregarPagina}
        chave={(r) => r.id}
        ordemPadrao={{ campo: 'criado_em', direcao: 'desc' }}
        acoes={acoes}
        larguraAcoes={84}
        botoes={
          <>
            <SeletorConta contas={contas.filter((c) => c.layout_cnab)} valor={conta} onTrocar={setConta} todas="Todas as contas" />
            <Botao
              variante="primario"
              icone={<FilePlus2 className="w-3.5 h-3.5" />}
              disabled={!escolhida || !pendentes}
              carregando={acao.ocupado === 'gerar'}
              title={!escolhida ? 'Escolha a conta' : !pendentes ? 'Nada na fila desta conta' : undefined}
              onClick={gerar}
            >
              Gerar remessa{escolhida ? ` (${pendentes})` : ''}
            </Botao>
          </>
        }
        recarregar={recarregar}
        rotuloVazio="Nenhuma remessa gerada"
      />
      <Confirmacao
        aberto={!!cancelando}
        titulo={`Cancelar a remessa ${cancelando?.numero}?`}
        mensagem="Use só se o arquivo não foi enviado ao banco. Os boletos e as instruções voltam para a próxima remessa."
        rotuloConfirmar="Cancelar remessa"
        onConfirmar={() => {
          const r = cancelando!;
          setCancelando(null);
          acao.executar(`cancelar-${r.id}`, async () => { await api.cancelarRemessa(r.id); atualizou(); return `Remessa ${r.numero} cancelada.`; });
        }}
        onCancelar={() => setCancelando(null)}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Retornos
// ---------------------------------------------------------------------------

export const RetornosView: React.FC<{ onMudou: () => void }> = ({ onMudou }) => {
  const [recarregar, setRecarregar] = useState(0);
  const [conta, setConta] = useState<number | ''>('');
  const contas = useContas();
  const acao = useAcao();
  const progresso = useProgresso();

  const importar = (arquivo: File) =>
    acao.executar('importar', async () => {
      if (!conta) throw new Error('Escolha a conta do arquivo de retorno.');
      const base64 = await api.lerArquivoBase64(arquivo);
      const r = await progresso.aguardar('Importando o retorno', 'Lendo as ocorrências…', () => api.importarRetorno(conta, arquivo.name, base64));
      setRecarregar((n) => n + 1);
      onMudou();
      return `Retorno importado: ${resumo(r)}`;
    });

  const carregarPagina = useCallback((c: api.ConsultaGrade) => api.listarRetornos(c, { conta }), [conta]);

  const colunas = useMemo<ColunaGrade<Retorno>[]>(
    () => [
      { nome: 'criado_em', rotulo: 'Importado em', tipo: 'data', valor: (r) => formatarDataHora(r.criado_em) },
      { nome: 'data_arquivo', rotulo: 'Data do arquivo', tipo: 'data', valor: (r) => formatarData(r.data_arquivo) },
      { nome: 'numero', rotulo: 'NSA', tipo: 'numero', valor: (r) => r.numero ?? '—' },
      { nome: 'conta', rotulo: 'Conta', valor: (r) => r.conta },
      { nome: 'nome_arquivo', rotulo: 'Arquivo', valor: (r) => r.nome_arquivo },
      { nome: 'qtde_registros', rotulo: 'Ocorrências', tipo: 'numero', valor: (r) => r.qtde_registros },
      { nome: 'liquidacoes', rotulo: 'Liquidações', tipo: 'numero', ordenavel: false, valor: (r) => r.liquidacoes },
      { nome: 'sem_boleto', rotulo: 'Sem boleto', tipo: 'numero', ordenavel: false, valor: (r) => r.sem_boleto },
    ],
    [],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {acao.erro && <AvisoErro mensagem={acao.erro} onFechar={() => acao.setErro(null)} />}
      {acao.feito && <AvisoSucesso mensagem={acao.feito} onFechar={() => acao.setFeito(null)} />}
      {progresso.modal}
      <Grade<Retorno>
        recurso="retornos"
        colunas={colunas}
        carregarPagina={carregarPagina}
        chave={(r) => r.id}
        ordemPadrao={{ campo: 'criado_em', direcao: 'desc' }}
        acoes={(r) => <BotaoAcao icone={Download} titulo="Baixar" descricao="Arquivo de retorno importado" onClick={() => acao.executar(`baixar-${r.id}`, () => api.baixarRetorno(r.id))} />}
        larguraAcoes={56}
        botoes={
          <>
            <SeletorConta contas={contas} valor={conta} onTrocar={setConta} todas="Todas as contas" />
            <EscolherArquivo aceitar=".ret,.txt,.RET,.TXT" onEscolher={importar}>
              {(abrir) => (
                <Botao
                  variante="primario"
                  icone={<Upload className="w-3.5 h-3.5" />}
                  disabled={!conta}
                  title={!conta ? 'Escolha a conta do arquivo' : undefined}
                  carregando={acao.ocupado === 'importar'}
                  onClick={abrir}
                >
                  Importar retorno
                </Botao>
              )}
            </EscolherArquivo>
          </>
        }
        recarregar={recarregar}
        rotuloVazio="Nenhum arquivo de retorno importado"
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Ocorrências
// ---------------------------------------------------------------------------

export const OcorrenciasView: React.FC<{ onMudou: () => void }> = ({ onMudou }) => {
  const [recarregar, setRecarregar] = useState(0);
  const [conta, setConta] = useState<number | ''>('');
  const [tipo, setTipo] = useState('');
  const [semBoleto, setSemBoleto] = useState('');
  const contas = useContas();
  const acao = useAcao();
  const progresso = useProgresso();
  const escolhida = contas.find((c) => c.id === conta);

  const buscarApi = () =>
    acao.executar('api', async () => {
      const r = await progresso.aguardar('Retorno pela API', 'Consultando liquidações e baixas no banco…', () => api.buscarMovimento(escolhida!.id));
      setRecarregar((n) => n + 1);
      onMudou();
      return `Consulta concluída: ${resumo(r)}`;
    });

  const carregarPagina = useCallback((c: api.ConsultaGrade) => api.listarOcorrencias(c, { conta, tipo, semBoleto }), [conta, tipo, semBoleto]);

  const colunas = useMemo<ColunaGrade<Ocorrencia>[]>(
    () => [
      { nome: 'id', rotulo: 'Nº', tipo: 'numero', valor: (o) => o.id },
      { nome: 'data_ocorrencia', rotulo: 'Data', tipo: 'data', valor: (o) => formatarData(o.data_ocorrencia) },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'centro', valor: (o) => etiqueta(TIPOS_OCORRENCIA, o.tipo) },
      { nome: 'nosso_numero', rotulo: 'Nosso número', tipo: 'numero', valor: (o) => o.nosso_numero },
      { nome: 'referencia', rotulo: 'Referência', ordenavel: false, valor: (o) => (o.boleto_id ? o.referencia || '—' : <span className="text-amber-600">sem boleto</span>) },
      { nome: 'pagador_nome', rotulo: 'Pagador', ordenavel: false, valor: (o) => o.pagador_nome || '—' },
      { nome: 'valor_pago', rotulo: 'Pago', tipo: 'numero', valor: (o) => moedaOuTraco(o.valor_pago) },
      { nome: 'valor_tarifa', rotulo: 'Tarifa', tipo: 'numero', ordenavel: false, valor: (o) => moedaOuTraco(o.valor_tarifa) },
      { nome: 'data_credito', rotulo: 'Crédito', tipo: 'data', valor: (o) => formatarData(o.data_credito) },
      { nome: 'origem', rotulo: 'Origem', tipo: 'centro', valor: (o) => o.origem },
      { nome: 'motivo', rotulo: 'Motivo', ordenavel: false, valor: (o) => `${o.codigo_banco ? `${o.codigo_banco} — ` : ''}${o.motivo || ''}` || '—', dica: (o) => o.motivo || undefined },
    ],
    [],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {acao.erro && <AvisoErro mensagem={acao.erro} onFechar={() => acao.setErro(null)} />}
      {acao.feito && <AvisoSucesso mensagem={acao.feito} onFechar={() => acao.setFeito(null)} />}
      {progresso.modal}
      <Grade<Ocorrencia>
        recurso="ocorrencias"
        colunas={colunas}
        carregarPagina={carregarPagina}
        chave={(o) => o.id}
        ordemPadrao={{ campo: 'id', direcao: 'desc' }}
        botoes={
          <>
            <Selecao className="w-32" value={tipo} onChange={(e) => setTipo(e.target.value)} opcoes={opcoesFiltro(TIPOS_OCORRENCIA, 'Todos os tipos')} />
            <Selecao
              className="w-32"
              value={semBoleto}
              onChange={(e) => setSemBoleto(e.target.value)}
              opcoes={[{ valor: '', rotulo: 'Com e sem boleto' }, { valor: '1', rotulo: 'Só sem boleto' }]}
            />
            <SeletorConta contas={contas} valor={conta} onTrocar={setConta} todas="Todas as contas" />
            <Botao
              icone={<CloudDownload className="w-3.5 h-3.5" />}
              disabled={!escolhida || !escolhida.tem_credenciais}
              title={!escolhida ? 'Escolha a conta' : !escolhida.tem_credenciais ? 'A conta não tem credenciais da API' : 'Liquidações e baixas desde a última consulta'}
              carregando={acao.ocupado === 'api'}
              onClick={buscarApi}
            >
              Buscar na API
            </Botao>
          </>
        }
        recarregar={recarregar}
        rotuloVazio="Nenhuma ocorrência recebida do banco"
      />
    </div>
  );
};

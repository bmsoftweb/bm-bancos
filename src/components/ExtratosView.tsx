import React, { useCallback, useMemo, useState } from 'react';
import { CheckCheck, EyeOff, Undo2, Upload } from 'lucide-react';
import * as api from '../services/api';
import { Lancamento } from '../types';
import { ColunaGrade, Grade } from './Grade';
import { BotaoAcao } from './MenuAcoes';
import { Botao, Selecao, Texto } from './ui';
import { AvisoErro, AvisoSucesso } from './AvisoErro';
import { useProgresso } from './ProgressoModal';
import { Dialogo, EscolherArquivo, SeletorConta, etiqueta, useAcao, useContas } from './comum';
import { SITUACOES_LANCAMENTO, formatarData, formatarDataHora, formatarMoeda, opcoesFiltro } from '../utils/formatters';

/**
 * Extrato importado por OFX e a conciliação. Quem concilia de verdade é o
 * módulo financeiro do ERP (pela API); aqui dá para conferir e marcar à mão.
 */
export const ExtratosView: React.FC<{ onMudou: () => void }> = ({ onMudou }) => {
  const [recarregar, setRecarregar] = useState(0);
  const [conta, setConta] = useState<number | ''>('');
  const [situacao, setSituacao] = useState('pendente');
  const [conciliando, setConciliando] = useState<Lancamento | null>(null);
  const [referencia, setReferencia] = useState('');
  const contas = useContas();
  const acao = useAcao();
  const progresso = useProgresso();

  const atualizou = () => {
    setRecarregar((n) => n + 1);
    onMudou();
  };

  const importar = (arquivo: File) =>
    acao.executar('importar', async () => {
      if (!conta) throw new Error('Escolha a conta do extrato.');
      const base64 = await api.lerArquivoBase64(arquivo);
      const r = await progresso.aguardar('Importando o extrato', 'Lendo o OFX…', () => api.importarOfx(conta, arquivo.name, base64));
      atualizou();
      return (
        `Extrato importado: ${r.novos} lançamento(s) novo(s)` +
        (r.repetidos ? `, ${r.repetidos} já importado(s)` : '') +
        (r.vinculados ? `; ${r.vinculados} liquidação(ões) de boleto ligada(s) ao crédito do banco` : '') +
        '.'
      );
    });

  const marcar = (l: Lancamento, acaoLanc: 'conciliar' | 'ignorar' | 'desfazer', ref?: string) =>
    acao.executar(`${acaoLanc}-${l.id}`, async () => {
      await api.marcarLancamento(l.id, acaoLanc, ref);
      atualizou();
      return acaoLanc === 'conciliar' ? 'Lançamento conciliado.' : acaoLanc === 'ignorar' ? 'Lançamento ignorado.' : 'Lançamento voltou a pendente.';
    });

  const carregarPagina = useCallback((c: api.ConsultaGrade) => api.listarLancamentos(c, { conta, situacao }), [conta, situacao]);

  const colunas = useMemo<ColunaGrade<Lancamento>[]>(
    () => [
      { nome: 'data_lancamento', rotulo: 'Data', tipo: 'data', valor: (l) => formatarData(l.data_lancamento) },
      { nome: 'historico', rotulo: 'Histórico', valor: (l) => l.historico || '—', dica: (l) => l.historico || undefined },
      { nome: 'documento', rotulo: 'Documento', valor: (l) => l.documento || '—' },
      {
        nome: 'valor',
        rotulo: 'Valor',
        tipo: 'numero',
        valor: (l) => <span className={Number(l.valor) < 0 ? 'text-red-600 dark:text-red-400' : ''}>{formatarMoeda(l.valor)}</span>,
      },
      { nome: 'situacao', rotulo: 'Situação', tipo: 'centro', valor: (l) => etiqueta(SITUACOES_LANCAMENTO, l.situacao) },
      { nome: 'referencia_conciliacao', rotulo: 'Lançamento no ERP', ordenavel: false, valor: (l) => l.referencia_conciliacao || '—' },
      {
        nome: 'liquidacoes',
        rotulo: 'Boletos',
        tipo: 'numero',
        ordenavel: false,
        valor: (l) => l.liquidacoes || '—',
        dica: (l) => (l.liquidacoes ? 'Liquidações de boleto cobertas por este crédito' : undefined),
      },
      { nome: 'conta', rotulo: 'Conta', valor: (l) => l.conta },
      { nome: 'conciliado_em', rotulo: 'Conciliado em', tipo: 'data', ordenavel: false, valor: (l) => formatarDataHora(l.conciliado_em) },
    ],
    [],
  );

  const acoes = (l: Lancamento) =>
    l.situacao === 'pendente' ? (
      <>
        <BotaoAcao icone={CheckCheck} titulo="Conciliar" descricao="Informar o lançamento do ERP que cobre este" tom="verde" onClick={() => { setReferencia(''); setConciliando(l); }} />
        <BotaoAcao icone={EyeOff} titulo="Ignorar" descricao="Não precisa de conciliação" carregando={acao.ocupado === `ignorar-${l.id}`} onClick={() => marcar(l, 'ignorar')} />
      </>
    ) : (
      <BotaoAcao icone={Undo2} titulo="Desfazer" descricao="Voltar a pendente" carregando={acao.ocupado === `desfazer-${l.id}`} onClick={() => marcar(l, 'desfazer')} />
    );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {acao.erro && <AvisoErro mensagem={acao.erro} onFechar={() => acao.setErro(null)} />}
      {acao.feito && <AvisoSucesso mensagem={acao.feito} onFechar={() => acao.setFeito(null)} />}
      {progresso.modal}
      <Grade<Lancamento>
        recurso="lancamentos"
        colunas={colunas}
        carregarPagina={carregarPagina}
        chave={(l) => l.id}
        ordemPadrao={{ campo: 'data_lancamento', direcao: 'desc' }}
        acoes={acoes}
        larguraAcoes={64}
        botoes={
          <>
            <Selecao className="w-32" value={situacao} onChange={(e) => setSituacao(e.target.value)} opcoes={opcoesFiltro(SITUACOES_LANCAMENTO)} />
            <SeletorConta contas={contas} valor={conta} onTrocar={setConta} todas="Todas as contas" />
            <EscolherArquivo aceitar=".ofx,.OFX" onEscolher={importar}>
              {(abrir) => (
                <Botao
                  variante="primario"
                  icone={<Upload className="w-3.5 h-3.5" />}
                  disabled={!conta}
                  title={!conta ? 'Escolha a conta do extrato' : undefined}
                  carregando={acao.ocupado === 'importar'}
                  onClick={abrir}
                >
                  Importar OFX
                </Botao>
              )}
            </EscolherArquivo>
          </>
        }
        recarregar={recarregar}
        rotuloVazio="Nenhum lançamento de extrato"
      />

      {conciliando && (
        <Dialogo
          titulo="Conciliar lançamento"
          descricao={`${formatarData(conciliando.data_lancamento)} • ${conciliando.historico || ''} • ${formatarMoeda(conciliando.valor)}`}
          onFechar={() => setConciliando(null)}
          ocupado={acao.ocupado === `conciliar-${conciliando.id}`}
          rodape={
            <>
              <Botao onClick={() => setConciliando(null)}>Voltar</Botao>
              <Botao
                variante="primario"
                disabled={!referencia.trim()}
                carregando={acao.ocupado === `conciliar-${conciliando.id}`}
                onClick={async () => (await marcar(conciliando, 'conciliar', referencia)) && setConciliando(null)}
              >
                Conciliar
              </Botao>
            </>
          }
        >
          <Texto rotulo="Lançamento no ERP" autoFocus required maxLength={80} value={referencia} onChange={(e) => setReferencia(e.target.value)} dica="Ex.: MOV-789" />
        </Dialogo>
      )}
    </div>
  );
};

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Eye, FileText, Plus, Printer, Send, SlidersHorizontal } from 'lucide-react';
import * as api from '../services/api';
import { BoletoDetalhe, BoletoLista, Conta, PedidoBoleto } from '../types';
import { ColunaGrade, Grade } from './Grade';
import { BotaoAcao, MenuAcoes, SeparadorAcoes } from './MenuAcoes';
import { Area, Botao, Confirmacao, Secao, Selecao, Texto } from './ui';
import { AvisoErro, AvisoSucesso } from './AvisoErro';
import { DateField } from './DateField';
import { NumberField } from './NumberField';
import { useProgresso } from './ProgressoModal';
import { AbaFilha, Dialogo, FaixaAbasFilhas, SeletorConta, etiqueta, useAbasFilhas, useAcao, useContas } from './comum';
import {
  AMBIENTES, CANAIS, INSTRUCOES, SITUACOES_BOLETO, SITUACOES_INSTRUCAO, TIPOS_OCORRENCIA, formatarCpfCnpj, formatarData,
  formatarDataHora, formatarMoeda, moedaOuTraco, opcoesFiltro,
} from '../utils/formatters';

type Aba = AbaFilha & { boletoId?: number };

/** Ainda pode ir ao banco pela API */
const registravel = (b: { canal: string; situacao: string }) => b.canal === 'api' && ['emitido', 'processando', 'enviado', 'rejeitado'].includes(b.situacao);
/** Situações em que instrução faz sentido (local antes do banco, ou ao banco depois da entrada) */
const instruivel = (s: string) => ['emitido', 'rejeitado', 'enviado', 'registrado'].includes(s);

/**
 * Boletos: a grade, e em abas filhas o Novo boleto e cada boleto aberto.
 * A faixa de abas só aparece com alguma filha aberta; o X fecha e volta à grade.
 */
export const BoletosView: React.FC<{ onMudou: () => void }> = ({ onMudou }) => {
  const { abas, ativa, setAtiva, abrir, fechar } = useAbasFilhas<Aba>();
  const [recarregar, setRecarregar] = useState(0);
  const [situacao, setSituacao] = useState('');
  const [conta, setConta] = useState<number | ''>('');
  const [instruindo, setInstruindo] = useState<{ id: number; titulo: string; tipo?: string } | null>(null);
  const [baixando, setBaixando] = useState<BoletoLista | BoletoDetalhe | null>(null);
  const contas = useContas();
  const acao = useAcao();
  const progresso = useProgresso();

  const titulo = (b: { id: number; nosso_numero?: string | null; nossoNumero?: string | null }) =>
    `Boleto ${b.nosso_numero ?? b.nossoNumero ?? `#${b.id}`}`;
  const abrirBoleto = (b: BoletoLista) => abrir({ id: `b-${b.id}`, titulo: titulo(b), boletoId: b.id });

  const atualizou = () => {
    setRecarregar((n) => n + 1);
    onMudou();
  };

  const pdf = (id: number) => acao.executar(`pdf-${id}`, () => progresso.aguardar('Abrindo o boleto', 'Gerando o PDF…', () => api.abrirPdf(id)));

  const registrar = (id: number) =>
    acao.executar(`registrar-${id}`, async () => {
      try {
        const { boleto } = await progresso.aguardar('Registrando no banco', 'Enviando o boleto pela API…', () => api.registrarBoleto(id));
        if (boleto.situacao === 'rejeitado') throw new Error(`O banco rejeitou o boleto: ${boleto.motivo || ''}`);
        return boleto.situacao === 'registrado' ? 'Boleto registrado no banco.' : 'O banco não confirmou o registro: tente de novo mais tarde.';
      } finally {
        atualizou();
      }
    });

  const baixar = (b: { id: number }) => {
    setBaixando(null);
    return acao.executar(`baixar-${b.id}`, async () => {
      const r = await progresso.aguardar('Baixando o boleto', 'Enviando a instrução…', () => api.instruirBoleto(b.id, 'baixar'));
      atualizou();
      return r.local ? 'Boleto cancelado (ainda não tinha ido ao banco).' : r.boleto.canal === 'api' ? 'Baixa enviada ao banco.' : 'Baixa na fila da próxima remessa.';
    });
  };

  const carregarPagina = useCallback((c: api.ConsultaGrade) => api.listarBoletos(c, { situacao, conta }), [situacao, conta]);

  const colunas = useMemo<ColunaGrade<BoletoLista>[]>(
    () => [
      { nome: 'data_vencimento', rotulo: 'Vencimento', tipo: 'data', valor: (b) => formatarData(b.data_vencimento) },
      { nome: 'nosso_numero', rotulo: 'Nosso número', tipo: 'numero', valor: (b) => (b.nosso_numero ? `${b.nosso_numero}${b.nosso_numero_dv ? `-${b.nosso_numero_dv}` : ''}` : '—') },
      { nome: 'seu_numero', rotulo: 'Documento', valor: (b) => b.seu_numero },
      { nome: 'referencia', rotulo: 'Referência', valor: (b) => b.referencia || '—' },
      { nome: 'pagador_nome', rotulo: 'Pagador', valor: (b) => b.pagador_nome, dica: (b) => `${b.pagador_nome} • ${formatarCpfCnpj(b.pagador_documento)}` },
      { nome: 'valor', rotulo: 'Valor', tipo: 'numero', valor: (b) => formatarMoeda(b.valor) },
      { nome: 'situacao', rotulo: 'Situação', tipo: 'centro', valor: (b) => etiqueta(SITUACOES_BOLETO, b.situacao) },
      { nome: 'data_pagamento', rotulo: 'Pagamento', tipo: 'data', valor: (b) => formatarData(b.data_pagamento) },
      { nome: 'valor_pago', rotulo: 'Pago', tipo: 'numero', valor: (b) => moedaOuTraco(b.valor_pago) },
      { nome: 'conta', rotulo: 'Conta', valor: (b) => b.conta },
      { nome: 'canal', rotulo: 'Canal', tipo: 'centro', valor: (b) => CANAIS[b.canal] },
      { nome: 'motivo', rotulo: 'Retorno do banco', valor: (b) => b.motivo || '—', dica: (b) => b.motivo || undefined },
    ],
    [],
  );

  const acoes = (b: BoletoLista) => (
    <MenuAcoes>
      <BotaoAcao icone={Eye} titulo="Abrir" descricao="Detalhes, ocorrências e instruções" onClick={() => abrirBoleto(b)} />
      {b.linha_digitavel && (
        <BotaoAcao icone={Printer} titulo="PDF" descricao="Boleto para imprimir ou enviar" carregando={acao.ocupado === `pdf-${b.id}`} onClick={() => pdf(b.id)} />
      )}
      {registravel(b) && (
        <BotaoAcao icone={Send} titulo="Registrar no banco" descricao="Enviar pela API do banco" carregando={acao.ocupado === `registrar-${b.id}`} onClick={() => registrar(b.id)} />
      )}
      {instruivel(b.situacao) && (
        <>
          <BotaoAcao icone={SlidersHorizontal} titulo="Instrução" descricao="Alterar vencimento, valor, abatimento, protesto" onClick={() => setInstruindo({ id: b.id, titulo: titulo(b) })} />
          <SeparadorAcoes />
          <BotaoAcao icone={Ban} titulo="Baixar" descricao="Cancelar o boleto no banco" tom="perigo" onClick={() => setBaixando(b)} />
        </>
      )}
    </MenuAcoes>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {acao.erro && <AvisoErro mensagem={acao.erro} onFechar={() => acao.setErro(null)} />}
      {acao.feito && <AvisoSucesso mensagem={acao.feito} onFechar={() => acao.setFeito(null)} />}
      {progresso.modal}

      <FaixaAbasFilhas rotulo="Boletos" icone={FileText} abas={abas} ativa={ativa} onAtivar={setAtiva} onFechar={fechar} />

      {/* Abas filhas continuam montadas enquanto abertas: o que foi digitado não se perde */}
      {abas.map((aba) => (
        <div key={aba.id} className={ativa === aba.id ? 'flex-1 flex flex-col min-h-0 overflow-y-auto' : 'hidden'}>
          {aba.id === 'novo' ? (
            <NovoBoleto
              contas={contas}
              onCancelar={() => fechar('novo')}
              onEmitido={(b, mensagem) => {
                fechar('novo');
                acao.setFeito(mensagem);
                atualizou();
                abrir({ id: `b-${b.id}`, titulo: titulo(b), boletoId: b.id });
              }}
            />
          ) : (
            <DetalheBoleto
              boletoId={aba.boletoId!}
              versao={recarregar}
              ocupado={acao.ocupado}
              onPdf={pdf}
              onRegistrar={registrar}
              onInstruir={(b) => setInstruindo({ id: b.id, titulo: titulo(b) })}
              onBaixar={setBaixando}
            />
          )}
        </div>
      ))}

      <div className={ativa === 'grade' ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
        <Grade<BoletoLista>
          recurso="boletos"
          colunas={colunas}
          carregarPagina={carregarPagina}
          chave={(b) => b.id}
          ordemPadrao={{ campo: 'data_vencimento', direcao: 'desc' }}
          acoes={acoes}
          larguraAcoes={56}
          botoes={
            <>
              <Selecao className="w-36" value={situacao} onChange={(e) => setSituacao(e.target.value)} opcoes={opcoesFiltro(SITUACOES_BOLETO)} />
              <SeletorConta contas={contas} valor={conta} onTrocar={setConta} todas="Todas as contas" />
              <Botao
                variante="primario"
                icone={<Plus className="w-3.5 h-3.5" />}
                onClick={() => abrir({ id: 'novo', titulo: 'Novo boleto', icone: Plus })}
              >
                Novo boleto
              </Botao>
            </>
          }
          onDuploClique={abrirBoleto}
          recarregar={recarregar}
          rotuloVazio="Nenhum boleto emitido"
        />
      </div>

      <Confirmacao
        aberto={!!baixando}
        titulo="Baixar o boleto?"
        mensagem={
          baixando &&
          `${'pagador_nome' in baixando ? baixando.pagador_nome : baixando.pagadorNome} • ${formatarMoeda(baixando.valor)}. ` +
            'Se ainda não foi ao banco, o boleto é só cancelado; senão a baixa vai pela API ou na próxima remessa.'
        }
        rotuloConfirmar="Baixar"
        onConfirmar={() => baixando && baixar(baixando)}
        onCancelar={() => setBaixando(null)}
      />

      {instruindo && (
        <DialogoInstrucao
          boletoId={instruindo.id}
          titulo={instruindo.titulo}
          onFechar={() => setInstruindo(null)}
          onEnviada={(mensagem) => {
            setInstruindo(null);
            acao.setFeito(mensagem);
            atualizou();
          }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Novo boleto (aba filha)
// ---------------------------------------------------------------------------

const PAGADOR_VAZIO = { documento: '', nome: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', email: '' };

const NovoBoleto: React.FC<{
  contas: Conta[];
  onCancelar: () => void;
  onEmitido: (b: BoletoDetalhe, mensagem: string) => void;
}> = ({ contas, onCancelar, onEmitido }) => {
  const ativas = contas.filter((c) => c.ativo);
  const [contaId, setContaId] = useState<number | ''>(ativas.length === 1 ? ativas[0].id : '');
  const conta = contas.find((c) => c.id === contaId);
  const [vencimento, setVencimento] = useState('');
  const [valor, setValor] = useState('');
  const [seuNumero, setSeuNumero] = useState('');
  const [pagador, setPagador] = useState(PAGADOR_VAZIO);
  const [multa, setMulta] = useState('');
  const [juros, setJuros] = useState('');
  const [desconto, setDesconto] = useState('');
  const [dataDesconto, setDataDesconto] = useState('');
  const [mensagens, setMensagens] = useState('');
  const [canal, setCanal] = useState<'remessa' | 'api'>('remessa');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const progresso = useProgresso();

  // A conta traz os padrões: canal, multa e juros
  useEffect(() => {
    if (!conta) return;
    setCanal(conta.canal);
    setMulta(conta.config.multaPercentual != null ? String(conta.config.multaPercentual) : '');
    setJuros(conta.config.jurosMensalPercentual != null ? String(conta.config.jurosMensalPercentual) : '');
  }, [conta?.id]);

  // Foco no primeiro campo vazio: a conta, ou o vencimento quando ela já vem escolhida
  useEffect(() => {
    document.getElementById(contaId ? 'nb-vencimento' : 'nb-conta')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const p = (campo: keyof typeof PAGADOR_VAZIO) => ({
    value: pagador[campo],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPagador((x) => ({ ...x, [campo]: e.target.value })),
  });

  const emitir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contaId) return setErro('Escolha a conta de cobrança.');
    const pedido: PedidoBoleto = {
      contaId,
      seuNumero: seuNumero.trim() || undefined,
      dataVencimento: vencimento,
      valor: Number(valor || 0),
      pagador: { ...pagador, documento: pagador.documento.replace(/\D/g, ''), cep: pagador.cep.replace(/\D/g, ''), uf: pagador.uf.toUpperCase() },
      multa: Number(multa) > 0 ? { percentual: Number(multa) } : null,
      juros: Number(juros) > 0 ? { percentualMensal: Number(juros) } : null,
      desconto: Number(desconto) > 0 ? { valor: Number(desconto), data: dataDesconto || vencimento } : null,
      mensagens: mensagens.split('\n').map((m) => m.trim()).filter(Boolean),
      canal,
    };
    setEnviando(true);
    setErro(null);
    try {
      const { boleto } = await progresso.aguardar(
        'Emitindo o boleto',
        canal === 'api' ? 'Registrando pela API do banco…' : 'Gerando o nosso número…',
        () => api.emitirBoleto(pedido),
      );
      if (boleto.situacao === 'rejeitado') {
        setErro(`O banco rejeitou o boleto: ${boleto.motivo || ''}`);
      }
      onEmitido(
        boleto,
        canal === 'remessa'
          ? 'Boleto emitido: vai na próxima remessa.'
          : boleto.situacao === 'registrado'
            ? 'Boleto registrado no banco.'
            : 'Boleto gravado; o registro no banco não foi confirmado.',
      );
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={emitir} className="flex flex-col">
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      {progresso.modal}

      <Secao titulo="Título">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <SeletorConta rotulo="Conta de cobrança" contas={contas} valor={contaId} onTrocar={setContaId} todas="Escolha…" className="lg:col-span-2" />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-stone-500 dark:text-stone-400">Vencimento</label>
            <DateField id="nb-vencimento" value={vencimento} onChange={setVencimento} required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-stone-500 dark:text-stone-400">Valor</label>
            <NumberField value={valor} onChange={setValor} scale={2} required />
          </div>
          <Texto rotulo="Documento (seu número)" value={seuNumero} onChange={(e) => setSeuNumero(e.target.value)} maxLength={15} dica="Vazio = o nosso número" />
          <Selecao
            rotulo="Registro"
            value={canal}
            onChange={(e) => setCanal(e.target.value as 'remessa' | 'api')}
            opcoes={Object.entries(CANAIS).map(([valor, rotulo]) => ({ valor, rotulo }))}
          />
        </div>
      </Secao>

      <Secao titulo="Pagador">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <Texto rotulo="CPF/CNPJ" required {...p('documento')} maxLength={18} />
          <Texto rotulo="Nome" required {...p('nome')} maxLength={100} className="lg:col-span-3" />
          <Texto rotulo="E-mail" type="email" {...p('email')} className="lg:col-span-2" />
          <Texto rotulo="CEP" required {...p('cep')} maxLength={9} />
          <Texto rotulo="Logradouro" required {...p('logradouro')} className="lg:col-span-3" />
          <Texto rotulo="Número" {...p('numero')} maxLength={10} />
          <Texto rotulo="Complemento" {...p('complemento')} />
          <Texto rotulo="Bairro" required {...p('bairro')} className="lg:col-span-2" />
          <Texto rotulo="Cidade" required {...p('cidade')} className="lg:col-span-2" />
          <Texto rotulo="UF" required {...p('uf')} maxLength={2} />
        </div>
      </Secao>

      <Secao titulo="Encargos e mensagens" descricao="Multa e juros vêm do cadastro da conta; zero não cobra">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-stone-500 dark:text-stone-400">Multa (%)</label>
            <NumberField value={multa} onChange={setMulta} scale={2} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-stone-500 dark:text-stone-400">Juros ao mês (%)</label>
            <NumberField value={juros} onChange={setJuros} scale={2} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-stone-500 dark:text-stone-400">Desconto (R$)</label>
            <NumberField value={desconto} onChange={setDesconto} scale={2} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-stone-500 dark:text-stone-400">Desconto até</label>
            <DateField value={dataDesconto} onChange={setDataDesconto} />
          </div>
          <Area rotulo="Mensagens ao pagador" rows={3} value={mensagens} onChange={(e) => setMensagens(e.target.value)} dica="Uma por linha" className="lg:col-span-6" />
        </div>
      </Secao>

      <div className="px-4 py-3 flex justify-end gap-2">
        <Botao onClick={onCancelar} disabled={enviando}>Cancelar</Botao>
        <Botao type="submit" variante="primario" icone={<Plus className="w-3.5 h-3.5" />} carregando={enviando}>
          Emitir boleto
        </Botao>
      </div>
    </form>
  );
};

// ---------------------------------------------------------------------------
// Detalhe do boleto (aba filha)
// ---------------------------------------------------------------------------

const Dado: React.FC<{ rotulo: string; children: React.ReactNode }> = ({ rotulo, children }) => (
  <div className="min-w-0">
    <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">{rotulo}</div>
    <div className="text-xs text-stone-800 dark:text-stone-100 break-words">{children}</div>
  </div>
);

const DetalheBoleto: React.FC<{
  boletoId: number;
  versao: number;
  ocupado: string | null;
  onPdf: (id: number) => void;
  onRegistrar: (id: number) => void;
  onInstruir: (b: BoletoDetalhe) => void;
  onBaixar: (b: BoletoDetalhe) => void;
}> = ({ boletoId, versao, ocupado, onPdf, onRegistrar, onInstruir, onBaixar }) => {
  const [b, setB] = useState<BoletoDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api.buscarBoleto(boletoId).then(setB).catch((e) => setErro(e.message));
  }, [boletoId, versao]);

  if (!b) return <div className="py-16 text-center text-xs text-stone-500">{erro || 'Carregando…'}</div>;

  const pg = b.dados?.pagador || {};
  return (
    <div className="flex flex-col">
      <Secao
        titulo={`${b.conta?.descricao || ''} • ${AMBIENTES[b.ambiente]}`}
        acoes={
          <>
            {b.linhaDigitavelFormatada && (
              <Botao icone={<Printer className="w-3.5 h-3.5" />} carregando={ocupado === `pdf-${b.id}`} onClick={() => onPdf(b.id)}>PDF</Botao>
            )}
            {registravel(b) && (
              <Botao icone={<Send className="w-3.5 h-3.5" />} carregando={ocupado === `registrar-${b.id}`} onClick={() => onRegistrar(b.id)}>Registrar no banco</Botao>
            )}
            {instruivel(b.situacao) && (
              <>
                <Botao icone={<SlidersHorizontal className="w-3.5 h-3.5" />} onClick={() => onInstruir(b)}>Instrução</Botao>
                <Botao variante="perigo" icone={<Ban className="w-3.5 h-3.5" />} onClick={() => onBaixar(b)}>Baixar</Botao>
              </>
            )}
          </>
        }
      >
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <Dado rotulo="Situação">{etiqueta(SITUACOES_BOLETO, b.situacao)}</Dado>
          <Dado rotulo="Nosso número">{b.nossoNumero ? `${b.nossoNumero}${b.nossoNumeroDv ? `-${b.nossoNumeroDv}` : ''}` : '—'}</Dado>
          <Dado rotulo="Documento">{b.seuNumero}</Dado>
          <Dado rotulo="Referência">{b.referencia || '—'}</Dado>
          <Dado rotulo="Emissão">{formatarData(b.dataEmissao)}</Dado>
          <Dado rotulo="Vencimento">{formatarData(b.dataVencimento)}</Dado>
          <Dado rotulo="Valor">{formatarMoeda(b.valor)}</Dado>
          <Dado rotulo="Canal">{CANAIS[b.canal]}{b.remessaId ? ` (remessa #${b.remessaId})` : ''}</Dado>
          <Dado rotulo="Pagamento">{formatarData(b.dataPagamento)}</Dado>
          <Dado rotulo="Crédito">{formatarData(b.dataCredito)}</Dado>
          <Dado rotulo="Valor pago">{moedaOuTraco(b.valorPago)}</Dado>
          <Dado rotulo="Retorno do banco">{b.codigoStatus ? `${b.codigoStatus} — ` : ''}{b.motivo || '—'}</Dado>
          <div className="col-span-2 lg:col-span-3">
            <Dado rotulo="Pagador">
              {b.pagadorNome} • {formatarCpfCnpj(b.pagadorDocumento)}
              <br />
              {[pg.logradouro, pg.numero, pg.complemento, pg.bairro, pg.cidade && `${pg.cidade}/${pg.uf}`].filter(Boolean).join(', ')}
            </Dado>
          </div>
          <div className="col-span-2 lg:col-span-3">
            <Dado rotulo="Linha digitável">{b.linhaDigitavelFormatada || '—'}</Dado>
          </div>
          {b.pixCopiaECola && (
            <div className="col-span-2 lg:col-span-6">
              <Dado rotulo="PIX copia e cola">{b.pixCopiaECola}</Dado>
            </div>
          )}
        </div>
      </Secao>

      <Secao titulo="Ocorrências do banco">
        {b.ocorrencias.length === 0 ? (
          <p className="text-xs text-stone-500">Nenhuma ocorrência ainda.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-stone-400">
              <tr>
                <th className="text-center py-1 w-24">Data</th>
                <th className="text-center w-24">Tipo</th>
                <th className="text-left">Motivo</th>
                <th className="text-right w-24">Pago</th>
                <th className="text-right w-20">Tarifa</th>
                <th className="text-center w-20">Origem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {b.ocorrencias.map((o) => (
                <tr key={o.id}>
                  <td className="py-1.5 text-center">{formatarData(o.data_ocorrencia)}</td>
                  <td className="text-center">{etiqueta(TIPOS_OCORRENCIA, o.tipo)}</td>
                  <td>{o.codigo_banco ? `${o.codigo_banco} — ` : ''}{o.motivo || '—'}</td>
                  <td className="text-right">{moedaOuTraco(o.valor_pago)}</td>
                  <td className="text-right">{moedaOuTraco(o.valor_tarifa)}</td>
                  <td className="text-center">{o.origem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Secao>

      <Secao titulo="Instruções">
        {b.instrucoes.length === 0 ? (
          <p className="text-xs text-stone-500">Nenhuma instrução enviada.</p>
        ) : (
          <table className="w-full text-xs">
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {b.instrucoes.map((i) => (
                <tr key={i.id}>
                  <td className="py-1.5 text-center w-32">{formatarDataHora(i.criado_em)}</td>
                  <td>{INSTRUCOES[i.tipo] || i.tipo}</td>
                  <td className="text-center w-28">{etiqueta(SITUACOES_INSTRUCAO, i.situacao)}</td>
                  <td>{i.motivo || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Secao>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Instrução ao banco
// ---------------------------------------------------------------------------

const DialogoInstrucao: React.FC<{
  boletoId: number;
  titulo: string;
  onFechar: () => void;
  onEnviada: (mensagem: string) => void;
}> = ({ boletoId, titulo, onFechar, onEnviada }) => {
  // Baixar tem o botão próprio, com confirmação
  const tipos = Object.entries(INSTRUCOES).filter(([t]) => t !== 'baixar');
  const [tipo, setTipo] = useState(tipos[0][0]);
  const [vencimento, setVencimento] = useState('');
  const [valor, setValor] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const enviar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      const dados =
        tipo === 'alterar_vencimento' ? { vencimento } : tipo === 'alterar_valor' ? { valor: Number(valor) } : tipo === 'conceder_abatimento' ? { abatimento: Number(valor) } : {};
      const r = await api.instruirBoleto(boletoId, tipo, dados);
      onEnviada(r.local ? 'Boleto alterado (ainda não tinha ido ao banco).' : r.boleto.canal === 'api' ? 'Instrução enviada ao banco.' : 'Instrução na fila da próxima remessa.');
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialogo
      titulo={`Instrução — ${titulo}`}
      onFechar={onFechar}
      ocupado={enviando}
      rodape={
        <>
          <Botao onClick={onFechar} disabled={enviando}>Voltar</Botao>
          <Botao variante="primario" carregando={enviando} onClick={enviar}>Enviar instrução</Botao>
        </>
      }
    >
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      <Selecao rotulo="Instrução" value={tipo} onChange={(e) => setTipo(e.target.value)} opcoes={tipos.map(([valor, rotulo]) => ({ valor, rotulo }))} />
      {tipo === 'alterar_vencimento' && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-stone-500 dark:text-stone-400">Novo vencimento</label>
          <DateField value={vencimento} onChange={setVencimento} required />
        </div>
      )}
      {(tipo === 'alterar_valor' || tipo === 'conceder_abatimento') && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-stone-500 dark:text-stone-400">{tipo === 'alterar_valor' ? 'Novo valor' : 'Valor do abatimento'}</label>
          <NumberField value={valor} onChange={setValor} scale={2} required />
        </div>
      )}
    </Dialogo>
  );
};

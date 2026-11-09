import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, Landmark, Pencil, Plus, ShieldAlert, ShieldCheck, Trash2, Upload } from 'lucide-react';
import * as api from '../services/api';
import { Banco, Conta, ConfigConta } from '../types';
import { ColunaGrade, Grade } from './Grade';
import { BotaoAcao } from './MenuAcoes';
import { Area, Botao, Confirmacao, Secao, Selecao, Texto } from './ui';
import { AvisoErro, AvisoSucesso } from './AvisoErro';
import { NumberField } from './NumberField';
import { Toggle } from './Toggle';
import { AbaFilha, Dialogo, EscolherArquivo, FaixaAbasFilhas, useAbasFilhas, useAcao } from './comum';
import { AMBIENTES, CANAIS, formatarData, formatarDataHora } from '../utils/formatters';

const ROTULO = 'text-xs font-semibold text-stone-500 dark:text-stone-400';

type Aba = AbaFilha & { conta: Partial<Conta> };

const CONTA_NOVA: Partial<Conta> = { canal: 'remessa', ambiente: 2, layout_cnab: '240', ativo: 1, config: {}, ultimo_nosso_numero: 0, ultima_remessa: 0 };

/**
 * Contas de cobrança: dados do convênio, padrões do boleto e credenciais da API.
 * Nova conta e edição abrem em abas filhas, como o Novo boleto.
 */
export const ContasView: React.FC<{ onMudou: () => void }> = ({ onMudou }) => {
  const { abas, ativa, setAtiva, abrir, fechar } = useAbasFilhas<Aba>();
  const [recarregar, setRecarregar] = useState(0);
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [credenciais, setCredenciais] = useState<Conta | null>(null);
  const [avisos, setAvisos] = useState<string | null>(null);
  const acao = useAcao();

  useEffect(() => {
    api.listarBancos().then(setBancos).catch(() => setBancos([]));
  }, []);

  const atualizou = (mensagem: string) => {
    acao.setFeito(mensagem);
    setRecarregar((n) => n + 1);
    onMudou();
  };

  // A lista é curta: vem inteira e a busca é feita aqui
  const carregarPagina = useCallback(async (c: api.ConsultaGrade) => {
    const termo = c.busca.toLowerCase();
    const todas = (await api.listarContas()).filter(
      (x) => !termo || [x.descricao, x.banco_nome, x.agencia, x.conta, x.convenio].some((v) => String(v || '').toLowerCase().includes(termo)),
    );
    return { data: todas, total: todas.length, totalPages: 1 };
  }, []);

  const colunas = useMemo<ColunaGrade<Conta>[]>(
    () => [
      { nome: 'descricao', rotulo: 'Descrição', ordenavel: false, valor: (c) => <span className={c.ativo ? '' : 'line-through text-stone-400'}>{c.descricao}</span> },
      { nome: 'banco', rotulo: 'Banco', ordenavel: false, valor: (c) => `${c.banco_codigo} — ${c.banco_nome}` },
      { nome: 'agencia', rotulo: 'Agência / conta', ordenavel: false, valor: (c) => `${c.agencia}${c.agencia_dv ? `-${c.agencia_dv}` : ''} / ${c.conta}${c.conta_dv ? `-${c.conta_dv}` : ''}` },
      { nome: 'convenio', rotulo: 'Convênio / carteira', ordenavel: false, valor: (c) => [c.convenio || c.beneficiario, c.carteira].filter(Boolean).join(' / ') || '—' },
      { nome: 'canal', rotulo: 'Registro', tipo: 'centro', ordenavel: false, valor: (c) => CANAIS[c.canal] },
      { nome: 'layout', rotulo: 'CNAB', tipo: 'centro', ordenavel: false, valor: (c) => c.layout_cnab || '—' },
      { nome: 'ambiente', rotulo: 'Ambiente da API', tipo: 'centro', ordenavel: false, valor: (c) => AMBIENTES[c.ambiente] },
      { nome: 'nosso_numero', rotulo: 'Último nosso nº', tipo: 'numero', ordenavel: false, valor: (c) => c.ultimo_nosso_numero },
      { nome: 'remessa', rotulo: 'Última remessa', tipo: 'numero', ordenavel: false, valor: (c) => c.ultima_remessa },
      {
        nome: 'credenciais',
        rotulo: 'API',
        tipo: 'centro',
        ordenavel: false,
        valor: (c) =>
          c.tem_credenciais ? <ShieldCheck className="w-4 h-4 text-emerald-500 inline" /> : <ShieldAlert className="w-4 h-4 text-stone-300 inline" />,
        dica: (c) =>
          c.tem_credenciais
            ? `Credenciais cadastradas${c.certificado_validade ? `; certificado vence em ${formatarData(c.certificado_validade)}` : ''}`
            : 'Sem credenciais da API',
      },
      { nome: 'consultado', rotulo: 'Retorno API até', tipo: 'data', ordenavel: false, valor: (c) => formatarDataHora(c.api_consultado_ate) },
    ],
    [],
  );

  const editar = (c: Conta) => abrir({ id: `conta-${c.id}`, titulo: c.descricao, icone: Pencil, conta: c });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {acao.erro && <AvisoErro mensagem={acao.erro} onFechar={() => acao.setErro(null)} />}
      {avisos && <AvisoErro tom="alerta" mensagem={avisos} onFechar={() => setAvisos(null)} />}
      {acao.feito && <AvisoSucesso mensagem={acao.feito} onFechar={() => acao.setFeito(null)} />}

      <FaixaAbasFilhas rotulo="Contas de cobrança" icone={Landmark} abas={abas} ativa={ativa} onAtivar={setAtiva} onFechar={fechar} />

      {/* Abas filhas continuam montadas enquanto abertas: o que foi digitado não se perde */}
      {abas.map((aba) => (
        <div key={aba.id} className={ativa === aba.id ? 'flex-1 flex flex-col min-h-0 overflow-y-auto' : 'hidden'}>
          <FormConta
            inicial={aba.conta}
            bancos={bancos}
            onFechar={() => fechar(aba.id)}
            onGravou={(r) => {
              fechar(aba.id);
              if (r.avisos.length) setAvisos(`Conta gravada, mas confira: ${r.avisos.join(' ')}`);
              atualizou('Conta gravada.');
            }}
          />
        </div>
      ))}

      <div className={ativa === 'grade' ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
        <Grade<Conta>
          recurso="contas"
          colunas={colunas}
          carregarPagina={carregarPagina}
          chave={(c) => c.id}
          ordemPadrao={{ campo: 'descricao', direcao: 'asc' }}
          acoes={(c) => (
            <>
              <BotaoAcao icone={KeyRound} titulo="Credenciais da API" descricao="client_id, segredo e certificado do banco" onClick={() => setCredenciais(c)} />
              <BotaoAcao icone={Pencil} titulo="Editar" descricao="Dados da conta e padrões do boleto" onClick={() => editar(c)} />
            </>
          )}
          larguraAcoes={64}
          botoes={
            <Botao variante="primario" icone={<Plus className="w-3.5 h-3.5" />} onClick={() => abrir({ id: 'nova', titulo: 'Nova conta', icone: Plus, conta: CONTA_NOVA })}>
              Nova conta
            </Botao>
          }
          onDuploClique={editar}
          recarregar={recarregar}
          rotuloVazio="Nenhuma conta de cobrança cadastrada"
        />
      </div>

      {credenciais && (
        <DialogoCredenciais
          conta={credenciais}
          onFechar={() => setCredenciais(null)}
          onGravou={(m) => {
            setCredenciais(null);
            atualizou(m);
          }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Cadastro da conta
// ---------------------------------------------------------------------------

const FormConta: React.FC<{
  inicial: Partial<Conta>;
  bancos: Banco[];
  onFechar: () => void;
  onGravou: (r: { avisos: string[] }) => void;
}> = ({ inicial, bancos, onFechar, onGravou }) => {
  const [c, setC] = useState<Partial<Conta>>(inicial);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const cfg: ConfigConta = c.config || {};
  const novo = !inicial.id;

  const campo = (nome: keyof Conta) => ({
    value: String(c[nome] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setC((x) => ({ ...x, [nome]: e.target.value })),
  });
  const conf = <K extends keyof ConfigConta>(nome: K, valor: ConfigConta[K]) => setC((x) => ({ ...x, config: { ...(x.config || {}), [nome]: valor } }));
  const confTexto = (nome: keyof ConfigConta) => ({
    value: String(cfg[nome] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => conf(nome, e.target.value || undefined),
  });
  const confNumero = (nome: keyof ConfigConta) => ({
    value: cfg[nome] == null ? '' : String(cfg[nome]),
    onChange: (v: string) => conf(nome, v === '' ? undefined : Number(v)),
  });

  const gravar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const { id, banco_nome, tem_credenciais, certificado_nome, certificado_validade, boletos_remessa, instrucoes_remessa, api_consultado_ate, ...dados } = c as Conta;
      const r = novo ? await api.incluirConta(dados) : await api.gravarConta(id, dados);
      onGravou(r);
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={gravar} className="flex flex-col">
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      <Secao titulo="Conta">
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <Texto rotulo="Descrição" required autoFocus={novo} maxLength={60} {...campo('descricao')} className="col-span-2 lg:col-span-3" />
          <Selecao
            rotulo="Banco"
            required
            {...campo('banco_codigo')}
            opcoes={[{ valor: '', rotulo: 'Escolha…' }, ...bancos.map((b) => ({ valor: b.codigo, rotulo: `${b.codigo} — ${b.nome}` }))]}
            className="col-span-2"
          />
          <div className="flex flex-col gap-1 justify-end">
            <Toggle checked={!!Number(c.ativo ?? 1)} onChange={(v) => setC((x) => ({ ...x, ativo: v ? 1 : 0 }))} label="Ativa" />
          </div>
          <Texto rotulo="Agência" required maxLength={5} {...campo('agencia')} />
          <Texto rotulo={c.banco_codigo === '756' ? 'Posto' : 'DV agência'} maxLength={2} {...campo('agencia_dv')} />
          <Texto rotulo="Conta" required maxLength={12} {...campo('conta')} />
          <Texto rotulo="DV conta" maxLength={2} {...campo('conta_dv')} />
          <Texto rotulo={c.banco_codigo === '756' ? 'Código do cliente' : 'Código do beneficiário'} maxLength={20} {...campo('beneficiario')} />
          <Texto rotulo="DV beneficiário" maxLength={2} {...campo('beneficiario_dv')} />
          <Texto rotulo="Convênio" maxLength={20} {...campo('convenio')} />
          <Texto rotulo="Carteira" maxLength={5} {...campo('carteira')} />
          {c.banco_codigo === '001' && <Texto rotulo="Variação da carteira" maxLength={3} {...confTexto('variacao')} />}
          {c.banco_codigo === '756' && (
            <>
              <Texto rotulo="Modalidade" maxLength={2} {...confTexto('modalidade')} dica="01 = simples com registro" />
              <Texto rotulo="Número do cliente (API)" maxLength={20} {...confTexto('numeroCliente')} />
            </>
          )}
        </div>
      </Secao>

      <Secao titulo="Registro e numeração">
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <Selecao rotulo="Registro padrão" {...campo('canal')} opcoes={Object.entries(CANAIS).map(([valor, rotulo]) => ({ valor, rotulo }))} />
          <Selecao rotulo="Remessa" {...campo('layout_cnab')} opcoes={[{ valor: '', rotulo: 'Não gera' }, { valor: '240', rotulo: 'CNAB 240' }]} />
          <Selecao
            rotulo="Ambiente da API"
            value={String(c.ambiente ?? 2)}
            onChange={(e) => setC((x) => ({ ...x, ambiente: Number(e.target.value) }))}
            opcoes={[{ valor: '2', rotulo: AMBIENTES[2] }, { valor: '1', rotulo: AMBIENTES[1] }]}
          />
          <div className="flex flex-col gap-1">
            <label className={ROTULO}>Último nosso número</label>
            <NumberField value={c.ultimo_nosso_numero ?? 0} onChange={(v) => setC((x) => ({ ...x, ultimo_nosso_numero: Number(v || 0) }))} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={ROTULO}>Última remessa (NSA)</label>
            <NumberField value={c.ultima_remessa ?? 0} onChange={(v) => setC((x) => ({ ...x, ultima_remessa: Number(v || 0) }))} />
          </div>
          <div className="flex flex-col gap-1 justify-end">
            <Toggle checked={!!cfg.pixHibrido} onChange={(v) => conf('pixHibrido', v)} label="PIX no boleto (API)" />
          </div>
        </div>
      </Secao>

      <Secao titulo="Padrões do boleto" descricao="Valem quando o módulo do ERP não manda">
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <Texto rotulo="Espécie" maxLength={3} {...confTexto('especie')} dica="DM, DS, NP, RC…" />
          <Selecao rotulo="Aceite" {...confTexto('aceite')} opcoes={[{ valor: 'N', rotulo: 'N — não' }, { valor: 'A', rotulo: 'A — sim' }]} />
          <div className="flex flex-col gap-1">
            <label className={ROTULO}>Multa (%)</label>
            <NumberField scale={2} {...confNumero('multaPercentual')} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={ROTULO}>Juros ao mês (%)</label>
            <NumberField scale={2} {...confNumero('jurosMensalPercentual')} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={ROTULO}>Dias para protesto</label>
            <NumberField {...confNumero('diasProtesto')} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={ROTULO}>Dias para baixa</label>
            <NumberField {...confNumero('diasBaixa')} />
          </div>
          <Texto rotulo="Local de pagamento" maxLength={80} {...confTexto('localPagamento')} className="col-span-2 lg:col-span-6" dica="Vazio = Pagável em qualquer banco até o vencimento" />
          <Area rotulo="Instruções impressas" rows={3} {...confTexto('instrucoes')} className="col-span-2 lg:col-span-6" dica="Até 4 linhas" />
        </div>
      </Secao>

      <div className="px-4 py-3 flex justify-end gap-2">
        <Botao onClick={onFechar} disabled={enviando}>Cancelar</Botao>
        <Botao type="submit" variante="primario" carregando={enviando}>Gravar</Botao>
      </div>
    </form>
  );
};

// ---------------------------------------------------------------------------
// Credenciais da API
// ---------------------------------------------------------------------------

const DialogoCredenciais: React.FC<{ conta: Conta; onFechar: () => void; onGravou: (mensagem: string) => void }> = ({ conta, onFechar, onGravou }) => {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [chaveAplicacao, setChaveAplicacao] = useState('');
  const [certificado, setCertificado] = useState<File | null>(null);
  const [senha, setSenha] = useState('');
  const [removendo, setRemovendo] = useState(false);
  const acao = useAcao();
  const tem = !!conta.tem_credenciais;
  const mantem = tem ? 'Vazio mantém o atual' : undefined;

  const gravar = () =>
    acao.executar('gravar', async () => {
      await api.gravarCredenciais(conta.id, {
        clientId,
        clientSecret: clientSecret || undefined,
        chaveAplicacao: chaveAplicacao || undefined,
        ...(certificado ? { certificadoBase64: await api.lerArquivoBase64(certificado), certificadoNome: certificado.name, certificadoSenha: senha } : {}),
      });
      onGravou('Credenciais gravadas.');
    });

  return (
    <Dialogo
      titulo={`Credenciais da API — ${conta.descricao}`}
      descricao={
        tem
          ? `Já cadastradas${conta.certificado_nome ? `; certificado ${conta.certificado_nome}, vence em ${formatarData(conta.certificado_validade)}` : ''}. O client_id precisa ser digitado de novo para gravar.`
          : 'Fornecidas pelo banco no portal do desenvolvedor. Os segredos são gravados cifrados.'
      }
      onFechar={onFechar}
      ocupado={!!acao.ocupado}
      rodape={
        <>
          {tem && (
            <Botao variante="perigo" icone={<Trash2 className="w-3.5 h-3.5" />} className="mr-auto" onClick={() => setRemovendo(true)}>
              Remover
            </Botao>
          )}
          <Botao onClick={onFechar}>Cancelar</Botao>
          <Botao variante="primario" disabled={!clientId.trim() || (!!certificado && !senha)} carregando={acao.ocupado === 'gravar'} onClick={gravar}>
            Gravar
          </Botao>
        </>
      }
    >
      {acao.erro && <AvisoErro mensagem={acao.erro} onFechar={() => acao.setErro(null)} />}
      <Texto rotulo="client_id" required autoFocus value={clientId} onChange={(e) => setClientId(e.target.value)} />
      <Texto rotulo="client_secret" type="password" autoComplete="new-password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} dica={mantem} />
      {conta.banco_codigo === '001' && (
        <Texto rotulo="Chave do aplicativo (gw-dev-app-key)" value={chaveAplicacao} onChange={(e) => setChaveAplicacao(e.target.value)} dica={mantem} />
      )}
      <div className="flex items-end gap-2">
        <EscolherArquivo aceitar=".pfx,.p12" onEscolher={setCertificado}>
          {(abrir) => (
            <Botao icone={<Upload className="w-3.5 h-3.5" />} onClick={abrir}>
              {certificado ? certificado.name : 'Certificado .pfx'}
            </Botao>
          )}
        </EscolherArquivo>
        {certificado && (
          <Texto rotulo="Senha do certificado" type="password" autoComplete="new-password" required value={senha} onChange={(e) => setSenha(e.target.value)} className="flex-1" />
        )}
      </div>
      <Confirmacao
        aberto={removendo}
        titulo="Remover as credenciais da API?"
        mensagem="A conta deixa de registrar e consultar boletos pela API até que sejam cadastradas de novo."
        rotuloConfirmar="Remover"
        onConfirmar={() => {
          setRemovendo(false);
          acao.executar('remover', async () => {
            await api.removerCredenciais(conta.id);
            onGravou('Credenciais removidas.');
          });
        }}
        onCancelar={() => setRemovendo(false)}
      />
    </Dialogo>
  );
};

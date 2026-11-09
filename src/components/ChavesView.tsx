import React, { useCallback, useMemo, useState } from 'react';
import { Ban, Copy, Plus } from 'lucide-react';
import * as api from '../services/api';
import { ChaveApi } from '../types';
import { ColunaGrade, Grade } from './Grade';
import { BotaoAcao } from './MenuAcoes';
import { Botao, Confirmacao, Texto } from './ui';
import { AvisoErro, AvisoSucesso } from './AvisoErro';
import { Dialogo, useAcao } from './comum';
import { formatarDataHora } from '../utils/formatters';

/**
 * Chaves de API dos módulos do ERP. A chave completa aparece uma vez, na
 * criação; o banco guarda só o hash dela.
 */
export const ChavesView: React.FC = () => {
  const [recarregar, setRecarregar] = useState(0);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState('');
  const [criada, setCriada] = useState<{ nome: string; chave: string } | null>(null);
  const [revogando, setRevogando] = useState<ChaveApi | null>(null);
  const acao = useAcao();

  const carregarPagina = useCallback(async () => {
    const todas = await api.listarChaves();
    return { data: todas, total: todas.length, totalPages: 1 };
  }, []);

  const colunas = useMemo<ColunaGrade<ChaveApi>[]>(
    () => [
      { nome: 'nome', rotulo: 'Módulo', ordenavel: false, valor: (c) => <span className={c.ativo ? '' : 'line-through text-stone-400'}>{c.nome}</span> },
      { nome: 'prefixo', rotulo: 'Início da chave', ordenavel: false, valor: (c) => `${c.prefixo}…` },
      { nome: 'ativo', rotulo: 'Situação', tipo: 'centro', ordenavel: false, valor: (c) => (c.ativo ? 'Ativa' : 'Revogada') },
      { nome: 'ultimo_uso', rotulo: 'Último uso', tipo: 'data', ordenavel: false, valor: (c) => formatarDataHora(c.ultimo_uso) },
      { nome: 'criado_em', rotulo: 'Criada em', tipo: 'data', ordenavel: false, valor: (c) => formatarDataHora(c.criado_em) },
    ],
    [],
  );

  const criar = () =>
    acao.executar('criar', async () => {
      const r = await api.criarChave(nome);
      setCriando(false);
      setCriada({ nome, chave: r.chave });
      setRecarregar((n) => n + 1);
    });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {acao.erro && <AvisoErro mensagem={acao.erro} onFechar={() => acao.setErro(null)} />}
      {acao.feito && <AvisoSucesso mensagem={acao.feito} onFechar={() => acao.setFeito(null)} />}
      <Grade<ChaveApi>
        recurso="chaves"
        colunas={colunas}
        carregarPagina={carregarPagina}
        chave={(c) => c.id}
        ordemPadrao={{ campo: 'nome', direcao: 'asc' }}
        acoes={(c) => (c.ativo ? <BotaoAcao icone={Ban} titulo="Revogar" descricao="O módulo deixa de acessar na hora" tom="perigo" onClick={() => setRevogando(c)} /> : null)}
        larguraAcoes={48}
        botoes={
          <Botao variante="primario" icone={<Plus className="w-3.5 h-3.5" />} onClick={() => { setNome(''); setCriando(true); }}>
            Nova chave
          </Botao>
        }
        recarregar={recarregar}
        rotuloVazio="Nenhuma chave de API criada"
      />

      {criando && (
        <Dialogo
          titulo="Nova chave de API"
          descricao="Uma chave por módulo do ERP (Financeiro, PDV, Contratos…), para poder revogar só a dele."
          onFechar={() => setCriando(false)}
          ocupado={acao.ocupado === 'criar'}
          rodape={
            <>
              <Botao onClick={() => setCriando(false)}>Cancelar</Botao>
              <Botao variante="primario" disabled={!nome.trim()} carregando={acao.ocupado === 'criar'} onClick={criar}>Criar chave</Botao>
            </>
          }
        >
          <Texto rotulo="Módulo" autoFocus required maxLength={60} value={nome} onChange={(e) => setNome(e.target.value)} />
        </Dialogo>
      )}

      {criada && (
        <Dialogo
          titulo={`Chave do módulo ${criada.nome}`}
          descricao="Copie agora: ela não aparece de novo. No módulo, envie no header Authorization: Bearer <chave>."
          onFechar={() => setCriada(null)}
          rodape={
            <>
              <Botao
                icone={<Copy className="w-3.5 h-3.5" />}
                onClick={() => navigator.clipboard.writeText(criada.chave).then(() => acao.setFeito('Chave copiada.'), () => acao.setErro('Não foi possível copiar: selecione e copie à mão.'))}
              >
                Copiar
              </Botao>
              <Botao variante="primario" onClick={() => setCriada(null)}>Fechar</Botao>
            </>
          }
        >
          <Texto readOnly value={criada.chave} />
        </Dialogo>
      )}

      <Confirmacao
        aberto={!!revogando}
        titulo={`Revogar a chave do módulo ${revogando?.nome}?`}
        mensagem="O módulo deixa de acessar o BMBancos na hora. Para voltar, crie uma chave nova e configure no módulo."
        rotuloConfirmar="Revogar"
        onConfirmar={() => {
          const c = revogando!;
          setRevogando(null);
          acao.executar(`revogar-${c.id}`, async () => {
            await api.revogarChave(c.id);
            setRecarregar((n) => n + 1);
            return `Chave do módulo ${c.nome} revogada.`;
          });
        }}
        onCancelar={() => setRevogando(null)}
      />
    </div>
  );
};

# BMBancos

Concentrador das rotinas bancárias do ERP BMsoft, na mesma pilha do BMNFe e do BMNFs:
React 19 + Vite + Tailwind 4 no front, Express + MySQL no back, tudo em TypeScript.

- **Boletos**: emissão com nosso número, código de barras, linha digitável e PDF (com o
  PIX do boleto híbrido quando o banco devolve).
- **Registro** por **remessa CNAB 240** (arquivo para subir no site do banco) ou pela
  **API do banco** (OAuth + certificado A1 em TLS mútuo).
- **Retorno** por **arquivo CNAB 240** ou pela **API** (busca automática a cada 30 min,
  das 7h às 22h, no servidor contínuo; na Vercel, só pelo botão "Buscar na API").
- **Conciliação**: extrato **OFX** (1.x SGML ou 2.x XML); as liquidações de boleto são
  ligadas sozinhas ao crédito do dia no extrato.

Bancos: **Banco do Brasil (001)** e **Sicoob (756)**, portados do ACBrBoleto
(`ACBrBancoBrasil`, `ACBrBancoSicoob`, `ACBrBoletoW_BancoBrasil_API`, `ACBrBoletoW_Sicoob_V3`).
CNAB 400 ainda não é gerado nem lido. Banco novo = um arquivo em `server/bancos/`
implementando `ModuloBanco` (`server/boleto/tipos.ts`) e uma linha em `server/bancos/index.ts`.

## Como rodar

```bash
npm install
```

1. Rode [`extras/bmbancos_schema.sql`](extras/bmbancos_schema.sql) no banco do ERP (o mesmo
   do BMNFe e do BMNFs). O aplicativo nunca cria tabelas.
2. Copie `.env.example` para `.env` e preencha o MySQL, o `SESSION_SECRET` e a
   `CHAVE_CREDENCIAIS`. **A `CHAVE_CREDENCIAIS` tem de ser a mesma no local e na Vercel**
   (o banco é o mesmo); perdê-la obriga a digitar de novo as credenciais dos bancos.
3. O login usa os usuários do ERP (`sys_usuarios`), pelo CNPJ da empresa (`sys_empresas`),
   que é o beneficiário dos boletos.
4. Em **Contas de cobrança**, cadastre o convênio e, para usar a API, as credenciais
   (client_id, client_secret, a chave do aplicativo no BB e o certificado .pfx).

```bash
npm run dev
```

Autoteste (código de barras FEBRABAN, campos CNAB, OFX, cifra das credenciais e os testes
de cada banco: remessa, retorno e API com cliente falso; sem banco de dados e sem rede):

```bash
npm run teste
```

## API para os módulos do ERP

Toda chamada leva `Authorization: Bearer <chave>`, com a chave criada em **Chaves de API**
(uma por módulo, revogável). A empresa sai da chave, nunca do corpo.

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/api/boletos` | Emite. A `referencia` do módulo (ex.: `CR-123`) é a idempotência: mandar de novo devolve o mesmo boleto (`repetida: true`). No canal `api`, já registra no banco (`?registrar=0` só grava). |
| `GET` | `/api/boletos/referencia/:ref` | Boleto pela referência, com ocorrências e instruções |
| `GET` | `/api/boletos/referencia/:ref/pdf` | PDF do boleto |
| `GET` | `/api/boletos/:id` · `/api/boletos/:id/pdf` | O mesmo, pelo id |
| `GET` | `/api/boletos/pdf?ids=1,2,3` | Vários boletos num PDF |
| `POST` | `/api/boletos/:id/registrar` | Registra pela API (ou consulta, se já foi tentado) |
| `POST` | `/api/boletos/:id/instrucoes` | `{ tipo, dados }`: `baixar`, `alterar_vencimento` (`dados.vencimento`), `alterar_valor` (`dados.valor`), `conceder_abatimento` (`dados.abatimento`), `cancelar_abatimento`, `protestar`, `sustar_protesto` |
| `GET` | `/api/ocorrencias?desde=<id>&limite=200` | **Canal de volta**: entradas, liquidações, baixas e rejeições com id maior que `desde`, em ordem. O módulo guarda o `ultimoId`. |
| `GET` | `/api/extratos/lancamentos?situacao=pendente&conta=1` | Lançamentos do extrato para conciliar |
| `POST` | `/api/extratos/lancamentos/:id/conciliar` | `{ referencia: "MOV-789" }`: o lançamento do ERP que cobre este |
| `POST` | `/api/extratos` | Importa OFX: `{ contaId, nomeArquivo, conteudoBase64 }` |
| `POST` | `/api/retornos` | Importa retorno CNAB: `{ contaId, nomeArquivo, conteudoBase64 }` |
| `POST` | `/api/remessas` | Gera a remessa da conta: `{ contaId }` |

Exemplo de emissão:

```json
POST /api/boletos
{
  "referencia": "CR-123",
  "contaId": 1,
  "seuNumero": "NF-4567",
  "dataVencimento": "2026-12-10",
  "valor": 150.00,
  "pagador": {
    "documento": "12345678909", "nome": "João da Silva",
    "logradouro": "Av. Brasil", "numero": "200", "bairro": "Centro",
    "cidade": "Rio do Sul", "uf": "SC", "cep": "89160100"
  }
}
```

Multa, juros, protesto, baixa, espécie e aceite vêm do cadastro da conta quando o módulo
não manda (`"multa": null` = sem multa). Multa acima de 2% é recusada (CDC).

## Situações do boleto

`emitido` → (remessa) `enviado` → `registrado` → `liquidado` | `baixado`, ou `rejeitado`.
Pela API: `emitido` → `processando` → `registrado`. Se o banco não responder (rede,
timeout ou 5xx), fica `enviado` e a próxima tentativa **consulta antes de reenviar**,
para nunca registrar o mesmo título duas vezes. `cancelado` = baixado antes de ir ao banco.

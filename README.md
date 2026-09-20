# Planner financeiro

Agenda financeira compartilhada com persistencia local em SQLite.

Agora os dados ficam em SQLite, nao mais apenas no navegador.

## Rodar localmente

```powershell
node server.js 8080
```

Ou:

```powershell
npm start
```

Abra:

```text
http://localhost:8080
```

Pagina de patrimonio:

```text
http://localhost:8080/patrimonio.html
```

Pagina de viagens:

```text
http://localhost:8080/viagens.html
```

Pagina de academia:

```text
http://localhost:8080/academia.html
```

Para usar exatamente `http://localhost`, a porta 80 precisa estar livre:

```powershell
node server.js 80
```

Neste computador, a porta 80 estava ocupada pelo IIS padrao do Windows no momento da criacao do projeto.

## Banco de dados

Arquivo principal:

```text
data/planner-financeiro.sqlite
```

O servidor usa:

- SQLite nativo do Node (`node:sqlite`)
- `PRAGMA journal_mode = WAL`
- `PRAGMA synchronous = FULL`
- `PRAGMA foreign_keys = ON`
- valores monetarios em centavos inteiros
- validacoes por `CHECK`
- transacoes para importacao inicial

Tabelas principais:

- `bills`
- `revenues`
- `assets`
- `asset_movements`
- `asset_balance_snapshots`
- `financial_goals`
- `card_statements`
- `card_transactions`
- `trips`
- `trip_travelers`
- `trip_categories`
- `trip_expenses`
- `trip_expense_participants`
- `trip_installments`
- `trip_reservations`
- `trip_itinerary_items`
- `trip_checklist_items`
- `trip_documents`
- `fitness_profiles`
- `fitness_measurements`
- `fitness_volume_targets`
- `fitness_workout_sessions`
- `fitness_workout_exercises`
- `fitness_workout_sets`
- `fitness_cardio_sessions`
- `fitness_templates`

## Academia

O modulo de academia compartilha o mesmo login e banco SQLite do Planner, mas separa os dados por perfil. Ele registra peso, body fat opcional, musculacao, cardio, modelos de treino e metas semanais editaveis.

O painel calcula series por grupo muscular, tonelagem, sequencia semanal, XP, melhores marcas estimadas e sinais de evolucao. As faixas iniciais de volume sao apenas um ponto de partida configuravel e nao substituem avaliacao profissional.

## Meta patrimonial

A area de patrimonio acompanha uma meta separada do total de bens cadastrados. O ponto inicial configurado e:

- saldo acompanhado de R$ 110 mil;
- meta de R$ 250 mil;
- data final em 31/12/2026;
- aporte mensal planejado de R$ 25 mil.

O Planner calcula automaticamente o ritmo mensal necessario, a projecao para a data e a diferenca entre o aporte planejado e o aporte exigido. A meta tambem aparece no painel mensal junto do check-in do casal.

## Investimentos

Os itens dos tipos **Investimento** e **Reserva** podem guardar:

- valor inicialmente investido e saldo atual;
- data de inicio, referencia, vencimento e encerramento;
- status do investimento;
- taxa mensal ou anual efetiva;
- tipo de rentabilidade;
- aportes e resgates adicionais;
- snapshots de saldo realizados.

A tela de detalhes separa os saldos realizados das projecoes futuras e mostra a evolucao em 6, 12, 24 meses ou ate o vencimento. A taxa anual efetiva e convertida para a taxa mensal equivalente com:

```text
taxaMensal = (1 + taxaAnual)^(1/12) - 1
```

Os calculos usam juros compostos. Aportes e resgates posteriores ao saldo de referencia entram no proximo fechamento mensal. Quando nao existe taxa suficiente para projetar, o Planner mostra uma orientacao para editar o investimento em vez de criar uma taxa ficticia.

## Viagens

A area **Viagens** adiciona planejamento de viagem integrado ao Planner Financeiro:

- cadastro de viagens e viajantes;
- orcamento por categoria;
- despesas em varias moedas com cotacao registrada;
- rateio simples entre viajantes;
- parcelamentos com opcao de gerar contas no Planner;
- reservas, roteiro, checklist e documentos;
- relatorio de orcamento, pagamentos e acerto entre viajantes.
- seletor persistente da viagem atual, com sugestao automatica da viagem em andamento;
- resumo de orcamento, gasto realizado, saldo, media diaria e estimativa final;
- gastos agrupados por dia, busca, filtros e ordenacao;
- resumo por categoria e graficos de categoria, gastos diarios, orcamento e acumulado.

Quando uma despesa parcelada e enviada para o Planner, cada parcela gera uma conta vinculada. Ao excluir a despesa ou a viagem, as contas vinculadas tambem sao removidas para evitar duplicidade.

Backups consistentes sao criados pelo botao **Backup**:

```text
data/backups/
```

## Recuperacao de dados antigos

A primeira versao salvava contas e receitas no `localStorage` do navegador. A versao SQLite agora detecta quando um navegador ainda tem um snapshot local diferente do banco e mostra o botao **Recuperar local** antes de sobrescrever qualquer coisa.

Se os dados antigos estiverem em outro navegador ou perfil, abra `http://localhost:8080` nesse mesmo navegador/perfil e use **Recuperar local**.

## Publicar como site

Este app usa Node.js + SQLite. Por isso, GitHub Pages sozinho nao roda a versao completa com salvamento de dados, porque Pages serve apenas arquivos estaticos e nao executa o servidor `/api`.

Opcoes boas:

- Rodar em um computador/NAS de casa e acessar por VPN/Tailscale/Cloudflare Tunnel.
- Hospedar em um servidor Node com disco persistente para o SQLite.
- Usar GitHub Pages apenas como demo estatica, sem as rotas de API e sem gravacao.

### Railway

O projeto esta pronto para Railway:

- Railway fornece `PORT`, e o servidor usa essa porta automaticamente.
- Em Railway, o servidor escuta em `0.0.0.0`.
- Se houver volume conectado, o SQLite usa `RAILWAY_VOLUME_MOUNT_PATH`.

Passos:

1. Criar um projeto no Railway.
2. Adicionar o repositorio `mapacc-com-br/planner`.
3. Criar um Volume no servico.
4. Montar o volume em `/data`.
5. Fazer deploy.
6. Gerar um dominio publico no servico.

Sem volume, o deploy funciona, mas os dados podem ser perdidos entre redeploys.

## Validacao

Checagem de sintaxe:

```powershell
npm run check
```

Testes unitarios e de integracao:

```powershell
npm test
```

Os testes de integracao iniciam o servidor com um banco SQLite temporario. Eles nao alteram `data/planner-financeiro.sqlite`.

Para criar a antiga viagem de demonstracao somente em um ambiente de desenvolvimento vazio, defina `PLANNER_SEED_DEMO_TRIP=1` antes de iniciar o servidor. O seed fica desligado por padrao.

## Login

O app pode ser protegido com `PLANNER_AUTH_CONFIG`, um JSON com usuarios e hashes de senha. Para desenvolvimento local, tambem e possivel criar `auth.local.json`, que fica fora do Git.

Formato:

```json
{
  "users": [
    {
      "username": "andre",
      "name": "Andre",
      "actor": "Andre",
      "passwordHash": "pbkdf2-sha256$100000$salt$hash"
    }
  ]
}
```

## Contas da casa — fluxo mensal

A tela inicial sempre abre no mês atual. Histórico e meses futuros continuam acessíveis em
“Histórico e próximos meses”. Uma lista reúne contas pendentes e pagas, com filtros.

- Novas contas são únicas por padrão; repetir todo mês ou ano é uma escolha explícita.
- Editar uma recorrência afeta somente a ocorrência selecionada por padrão. “Este mês e os
  próximos” usa a divisão de série já existente; não reescreve meses anteriores.
- Na edição de uma ocorrência, nome e recorrência ficam protegidos por pertencerem à série.
- “Já paguei” registra o valor exibido hoje, com o usuário atual e método não informado.
  Para outro valor/data, ou fora do mês atual, usa-se o formulário de pagamento.
- “Já pagas” permite desfazer. Toques simultâneos não enviam pagamentos duplicados no cliente.
- Falta pagar soma somente contas pendentes. Sobra prevista considera valores pagos reais e
  previsões pendentes; não representa saldo bancário nem aporte realizado.

Os testes adicionais usam registros fictícios e SQLite temporário. Não modificam dados de produção.

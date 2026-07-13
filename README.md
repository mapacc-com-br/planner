# Planner financeiro

Primeira versao local de uma agenda financeira compartilhada.

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

## Viagens

A area **Viagens** adiciona planejamento de viagem integrado ao Planner Financeiro:

- cadastro de viagens e viajantes;
- orcamento por categoria;
- despesas em varias moedas com cotacao registrada;
- rateio simples entre viajantes;
- parcelamentos com opcao de gerar contas no Planner;
- reservas, roteiro, checklist e documentos;
- relatorio de orcamento, pagamentos e acerto entre viajantes.

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

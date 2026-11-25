# Estoque & Compras — Nordeschina Delivery

Aplicação web responsiva, PWA e cliente Windows para controlar estoque, compras e preços de uma operação de delivery. Todos os dispositivos conectados usam a mesma API e o mesmo PostgreSQL. O Consumer é fonte de vendas por arquivo ou lançamento manual: a aplicação não se conecta diretamente ao Consumer, ao MenuDino, à 99Food ou ao iFood.

## Demonstração local

Requisitos: **Node.js 22.12+** e npm.

```bash
npm ci
npm run build
npm run preview
```

Abra `http://localhost:3001`. A prévia entra automaticamente como Camila (ADM Master) no primeiro acesso, usa PGlite e grava em `.data/demo`. Para trocar de conta, abra o menu de perfil e clique em **Sair**. A demonstração inclui 4 usuários, 5 locais de Recife, 20 insumos, fichas técnicas, solicitações e preços históricos.

| Perfil        | E-mail de demonstração       |
| ------------- | ---------------------------- |
| ADM Master    | `master@nordeschina.demo`    |
| Administrador | `admin@nordeschina.demo`     |
| Operador      | `operador@nordeschina.demo`  |
| Comprador     | `comprador@nordeschina.demo` |

Senha comum **somente para a demonstração local**: `Nordeschina2026!`. Para desenvolver com recarga automática, rode `npm run dev` e use `http://localhost:5173`; o service worker é registrado somente no build. Não exponha o modo demo na internet com dados reais.

## Instalação para a operação

1. Provisione um PostgreSQL **14+** e um banco dedicado. Use uma conexão que suporte sessões persistentes e `LISTEN/NOTIFY` (conexão direta ou pool em modo sessão, não em modo transação). Habilite TLS para um banco remoto conforme o provedor.
2. Copie `.env.example` para `.env`. Configure `DATABASE_URL` e os dados do primeiro ADM Master. A senha inicial deve ter pelo menos 12 caracteres. O bootstrap se recusa a criar a conta se já houver usuários.
3. Na máquina que hospedará o servidor, execute:

```bash
npm ci
npm run build
npm run bootstrap
npm start
```

O schema em `server/schema.sql` é aplicado automaticamente. Remova `MASTER_PASSWORD` do ambiente depois do bootstrap. Em produção não há login automático nem seed automático; o servidor exige `DATABASE_URL`.

4. Publique em **HTTPS** com um proxy reverso que preserve o `Host` e não faça buffering do endpoint SSE `/api/events`. Não exponha a porta do Node diretamente. Configure `TRUST_PROXY=1` apenas se houver exatamente um proxy confiável entre o navegador e a API. Exemplo para Caddy, substituindo o domínio pelo da operação:

```caddyfile
estoque.seudominio.com.br {
  reverse_proxy 127.0.0.1:3001 {
    flush_interval -1
  }
}
```

5. Crie as contas individuais em **Usuários e acesso** e teste os quatro perfis com usuários reais antes da liberação. Configure backups PostgreSQL, teste restauração e monitore erros HTTP, conexões ao banco e espaço em disco. A versão atual é **para uma operação**, sem isolamento entre restaurantes nem recuperação de senha por e-mail. O Master redefine senhas pela interface.

Para popular um ambiente descartável com os exemplos, configure **outro** `DATABASE_URL`, defina `SEED_PASSWORD` (mín. 12 caracteres) e execute `npm run seed`. Use o seed somente em banco vazio; ele não sobrescreve uma operação existente.

### PWA e uso offline

Abra a aplicação HTTPS no celular. No Android/Chromium, use **Instalar app** no navegador; no iOS/Safari, use **Compartilhar → Adicionar à Tela de Início**. Abra e autentique online pelo menos uma vez antes de sair para as compras. O shell é versionado e fica no cache. O dispositivo mantém o último estado operacional (sem usuários nem auditoria), o carrinho por conta e a fila em `localStorage`.

Requisições, baixas manuais, reservas, cadastro de locais e finalização de compra podem ser enfileirados. Não são confirmados no banco até a reconexão com sessão válida. A fila executa em ordem e pausa se houver um conflito; o app exibe o motivo e permite tentar novamente ou descartar a primeira operação. Em compras offline, a intenção fica na fila mesmo após o carrinho ser fechado. O carrinho é local ao dispositivo; a **reserva do pedido**, os saldos, a lista e as compras confirmadas são compartilhados. Um comprador pode retomar uma reserva própria a partir da lista em outro dispositivo, mas precisa reinformar quantidade e preço. Não use o modo offline em um dispositivo compartilhado sem controle de acesso local.

### Desktop Windows (Electron)

O instalador NSIS abre a mesma aplicação HTTPS da operação, sem banco, senha ou segredo embutido. A URL do servidor é a única configuração empacotada. Compile em Windows com Node/npm:

```powershell
npm ci
$env:ESTOQUE_URL = 'https://estoque.seudominio.com.br'
npm run desktop:build
```

O `.exe` fica em `release/`. Para testar a janela sem empacotar, mantenha a variável e execute `npm run desktop`. Para alterar o servidor após instalar, coloque `desktop.json` com `{"url":"https://estoque.seudominio.com.br"}` na pasta de dados do aplicativo Electron, ou reempacote. A janela exige HTTPS, bloqueia navegação para outras origens e não expõe Node ao renderer. Para distribuição ampla, configure um certificado de assinatura Windows na infraestrutura de release.

## Rotinas

- **Estoque:** filtre por categoria e situação. O menu `…` permite solicitar compra, informar saldo físico ou registrar baixa. A contagem física atualiza o saldo e solicita `max(0, ideal − restante)`. O limiar de reposição automática é `saldo < mínimo`, sem duplicar uma requisição aberta para o mesmo insumo.
- **Modo Rua:** escolha o estabelecimento, reserve itens e informe quantidade e preço unitário ou total. O outro campo é calculado em centavos; quando o total é informado, ele prevalece e o unitário exibido é arredondado. Ao finalizar, informe desconto/taxa e escolha se a compra dá entrada no estoque. O servidor grava a compra, reserva encerrada, histórico, auditoria e estoque na mesma transação.
- **Comparador:** o ranking usa o menor, último e médio preço por local/insumo. O local único só é recomendado se tiver referência para todos os itens pendentes com quantidade positiva. A divisão usa o menor preço histórico por insumo e indica lacunas de cobertura. São estimativas, não preços vigentes nem garantia de disponibilidade.
- **Consumer:** em **Fichas técnicas**, associe o código de venda aos insumos. Em **Saída de pedidos**, selecione o canal, informe um identificador único por pedido/lote e confira a prévia. A confirmação recalcula no servidor e rejeita estoque insuficiente ou duplicidade de identificador no canal. O seletor de inclusão manual só funciona se habilitado pelo Master.
- **Auditoria:** o Master vê todos os eventos; o ADM não vê eventos do Master. A trilha guarda o antes/depois no banco e bloqueia atualizações, exclusões e truncamento por trigger. Como sempre, restrinja acesso de administração ao banco e inclua a trilha nos backups. Itens com referências históricas não podem ser excluídos; inative-os para preservar a integridade.

### Formatos aceitos para importação

Normalize o export do Consumer para código do produto da ficha técnica e quantidade inteira vendida. Canal e identificador do lote são selecionados na tela. CSV UTF-8 com `;` ou `,`, cabeçalho opcional:

```csv
codigo;quantidade
YAK-FRANGO;2
```

XML equivalente:

```xml
<vendas>
  <linha codigo="YAK-FRANGO" quantidade="2" />
</vendas>
```

## Estrutura e validação

- `src/`: React + TypeScript estrito, Tailwind CSS, módulos de operação e cliente de sincronização.
- `server/`: API Express, validação Zod, autenticação por cookie HttpOnly, RBAC em cada operação, schema PostgreSQL e seed. O Master atribui perfis nativos e configura regras operacionais; a matriz de permissões é fixa no código.
- `public/`: manifesto, ícones e service worker. Respostas autenticadas da API não entram no cache do service worker.
- `desktop/`: inicialização segura do Electron e configuração da URL de release.
- `tests/`: testes de API e smoke test de navegador.

A API usa transações, travas de linha e chaves de idempotência para reenvios offline. Quantidades usam `numeric(14,3)`; dinheiro usa inteiros em centavos. Eventos `LISTEN/NOTIFY` emitidos após commit acionam SSE para atualizar as telas. A aplicação de pequeno porte carrega o estado operacional e o histórico acessível por perfil; antes de usar com grandes volumes, dimensione e valide paginação/retenção para a operação.

```bash
npm test                        # integração com PGlite isolado em memória
npx playwright install chromium # uma vez na máquina de testes
npm run test:browser            # build, shell offline, carrinho e navegação mobile
```

Para executar a mesma suíte de API no PostgreSQL, configure `TEST_DATABASE_URL` apontando **exclusivamente a um banco descartável e vazio**. A suíte cria schema, aplica seed e grava compras. A geração e a instalação do `.exe` exigem validação em Windows antes da distribuição.

## Hospedagem recomendada para ficar online

**Render: Web Service pago + Render Postgres pago**, ambos na mesma região, é a opção mais simples para esta operação. Não há servidor próprio para manter. Escolha uma região disponível próxima de Recife e confira, no painel, os preços, retenção de backup e limites dos planos antes de contratar. Não use a combinação gratuita para operação diária: ela não é a configuração adequada para evitar suspensão do serviço e garantir a permanência do banco. O Render fornece HTTPS para o endereço `onrender.com`; um domínio próprio é opcional.

1. Crie um **Render Postgres** e guarde a _Internal Database URL_ para uso no Web Service. Use a conexão direta para `LISTEN/NOTIFY`.
2. Crie um **Web Service** a partir do repositório com runtime **Node**, na mesma região do banco. Use `npm ci && npm run build` no build e `npm start` no start. Configure `DATABASE_URL` com a URL interna do banco e deixe o Render definir `PORT`. Use Node 22.12+ (preferencialmente a versão 22 LTS mais recente). Não use `npm run preview` na nuvem.
3. Faça o deploy. No Shell do Web Service, execute `npm run bootstrap` com `MASTER_NAME`, `MASTER_EMAIL` e `MASTER_PASSWORD` definidos temporariamente como segredos. Remova a senha de bootstrap depois que a primeira conta existir.
4. Abra o HTTPS em dois dispositivos. Confirme que a compra criada em um aparece no outro e valide cadastro, aprovação e login antes de distribuir o instalador. Configure backups e teste a restauração. Arquivos do serviço e do instalador não substituem o backup do PostgreSQL.

Alternativa: **Railway** com serviço Node e PostgreSQL na mesma rede privada. Compare custo, backup e região antes de decidir. Evite publicar apenas o front-end como site estático: o app também precisa da API Node persistente.

### Cadastro e aprovação

No login web ou Windows, selecione **Não tenho conta · Solicitar acesso**. Até a aprovação, não é criada uma conta ativa. Em **Usuários e acesso → Solicitações de acesso**, o ADM Master pode recusar ou aprovar como **Operador**, **Comprador** ou **Administrador**. As permissões e restrições do perfil escolhido são aplicadas pelo servidor no primeiro login. A revisão não concede ADM Master. Não há e-mail automático nem verificação de propriedade do endereço: confirme a identidade do solicitante por um canal interno antes de aprovar.

### Gerar e baixar o instalador

No Windows, `npm ci` e `npm run desktop:build` geram o instalador NSIS em `release/`. Com `ESTOQUE_URL` definida, ele abre o servidor diretamente. Sem ela, a primeira execução pede a URL HTTPS e salva somente o endereço, não a senha. Depois disso, o usuário entra ou solicita cadastro. A sessão pode persistir após fechar e reabrir o programa; use **Sair** em computadores compartilhados.

No GitHub, após o workflow estar na branch padrão, abra **Actions → Build Windows installer → Run workflow**. O campo `server_url` pode ficar vazio para gerar o instalador genérico. Baixe o artefato **Estoque-e-Compras-Windows** da execução concluída, extraia o `.exe` e faça um teste em Windows antes de distribuí-lo. Sem assinatura de código, o Windows pode exibir um aviso de editor desconhecido.

### Exclusão de contas

Em **Usuários e acesso**, o ADM Master pode excluir uma conta da lista. A exclusão é lógica: desativa o acesso e encerra as sessões, mas preserva compras, solicitações e auditoria. Não é possível excluir a própria conta; o e-mail de uma conta excluída permanece reservado. Este recurso não implementa isolamento por filiais.

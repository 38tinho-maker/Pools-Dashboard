# Pools LP · v1.2.0

Painel das suas posições de liquidez na **Uniswap v3 e v4** (Ethereum, Arbitrum, Base, Polygon e Monad), feito para abrir no iPhone. Os alertas chegam como notificação pelo app **ntfy**.

- Cada posição aparece como um anel. A bolinha mostra onde está o preço dentro do range.
- Nas pontas ficam as moedas: à esquerda, a moeda com que você fica 100% se o preço cair abaixo do mínimo; à direita, a moeda com que você fica 100% se subir acima do máximo.
- Mostra também valor em US$, fees a coletar e quanto elas representam do valor da posição (%), distância até a borda e composição.
- **Monad:** por enquanto só posições v3. A v4 da Monad ainda não tem índice oficial no The Graph.
- O limite de alerta é ajustável por posição: toque em **Até a borda**.
- Atualiza a cada 1 minuto com o app aberto.
- Carteiras e chave ficam salvas **só no seu aparelho**, nunca no código.

Para ver sem configurar nada, abra o site com `?demo` no fim do endereço.

---

## 1. Publicar no GitHub Pages

1. No GitHub, crie um repositório **público**, por exemplo `pools-lp`.
2. Envie todos os arquivos deste zip, **incluindo a pasta `.github`**. No Mac ela fica oculta no Finder: aperte `Cmd + Shift + .` para mostrar.
3. No repositório, vá em **Settings → Pages**. Em *Source* escolha **Deploy from a branch**, depois `main` e `/ (root)`, e salve.
4. Em 1 ou 2 minutos o site fica em `https://SEU-USUARIO.github.io/pools-lp/`.

## 2. Instalar no iPhone

1. Abra esse endereço no **Safari**.
2. Toque em **Compartilhar → Adicionar à Tela de Início**.
3. Abra pelo ícone e toque no botão de configurações (duas linhas com bolinhas, no canto superior direito):
   - **Carteiras:** apelido e endereço `0x…`. Pode adicionar várias.
   - **Chave The Graph:** só é necessária para posições **v4**. As v3 são lidas direto da blockchain.
   - **Redes:** marque as que você usa.

### Como criar a chave do The Graph (grátis)

1. Acesse https://thegraph.com/studio e entre com sua carteira ou e-mail.
2. Vá em **API Keys → Create API Key**.
3. Recomendado: em *Authorized domains*, coloque `SEU-USUARIO.github.io`. Assim a chave só funciona no seu site.
4. O plano gratuito cobre com folga o uso pessoal.

## 3. Alertas no iPhone (ntfy + GitHub Actions)

O GitHub verifica suas posições a cada ~10 minutos. Cada alerta avisa **uma vez**, quando a condição passa a valer:

- **por posição** (toque em "Até a borda" no cartão), com padrão nas Configurações:
  - entrou / saiu do range (liga e desliga);
  - perto da borda;
  - preço alvo;
  - fees atingiram X%;
  - fees atingiram US$ X;
  - composição (moeda ≥ X%);
  - fora do range há mais de X horas;
- **gerais:**
  - posição nova ou fechada;
  - pool parou de render: no range, mas as fees de 24h ficam abaixo de 30% da média de 7 dias (precisa de ~2 dias de histórico);
- **quando avisar:**
  - lembrete repetido enquanto a posição estiver fora;
  - horário de silêncio: só "saiu do range" toca, e o resto chega num resumo no fim do horário.

### Configuração (uma vez só)

1. **ntfy:** instale o app **ntfy** no iPhone (grátis) e assine um tópico difícil de adivinhar, ex.: `pools-marco-7f3k9q2x`.
2. **Arquivo de agendamento:** no repositório, use **Add file → Create new file**. No nome, digite `.github/workflows/alertas.yml` e cole o conteúdo do arquivo de mesmo nome que veio no zip. Clique em **Commit changes**.
3. **Token do GitHub:**
   - Acesse https://github.com/settings/personal-access-tokens/new.
   - Dê um nome (ex.: *pools-lp*) e escolha a validade mais longa.
   - Em *Repository access*, marque **Only select repositories** e escolha este repositório.
   - Em *Permissions → Repository permissions*, deixe **Variables** como **Read and write**.
   - Clique em **Generate token** e copie o código (`github_pat_…`).
4. **No app:** abra Configurações e, em **Alertas no iPhone**, preencha o tópico do ntfy (toque em **Testar**), o token e o repositório. Deve aparecer "Sincronizado em …".
5. **Teste:** no GitHub, vá em **Actions → Alertas de range → Run workflow**. Chega a notificação "Alertas ativados".

> O token fica salvo só no iPhone e só consegue alterar as variáveis deste repositório. As configurações de alerta, incluindo carteiras e tópico, ficam numa variável do repositório chamada `ALERTAS`. Ela só é visível para você, mesmo com o repositório público. O log do Actions não imprime endereços nem valores.
> Se a sua chave do The Graph tiver restrição de domínio, as posições **v4** não entram nos alertas. Nesse caso, crie uma segunda chave sem restrição e salve como secret `GRAPH_API_KEY`.

## Limitações

- **Horário:** o agendamento do GitHub pode atrasar alguns minutos, e em horários de pico às vezes pula uma execução.
- **Agendamento desativado:** o GitHub desativa agendamentos em repositórios públicos sem nenhum commit por **60 dias**. Se receber o e-mail avisando, é só reativar em Actions ou fazer um commit qualquer.
- **Fees a coletar** são calculadas pelo mesmo método da Uniswap, lendo o contrato. Em pools v4 com *hooks* que alteram fees, o valor pode ser aproximado.
- **Preços em US$** vêm da DefiLlama. Tokens sem preço mostram `—`.
- **RPC:** usa RPCs públicos gratuitos (publicnode). Se algum ficar lento, cole um RPC seu em **Configurações → RPC personalizado**.

## Estrutura

```
index.html, style.css, app.js   → o app
core.js                         → leitura das posições (compartilhado com os alertas)
scripts/alertas.mjs             → verificador que roda no GitHub Actions
.github/workflows/alertas.yml   → agendamento a cada 10 min
manifest.webmanifest, icons/    → instalação na tela de início
```

Ao lançar uma nova versão, atualize `VERSION` em `core.js` e o `?v=` em `index.html` e `app.js`. Assim o iPhone não fica com a versão antiga em cache.

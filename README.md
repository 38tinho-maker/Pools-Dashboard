# Pools LP · v1.0.0

Painel das suas posições de liquidez na **Uniswap v3 e v4** (Ethereum, Arbitrum, Base e Polygon), feito para abrir no iPhone. Os alertas chegam como notificação pelo app **ntfy**.

- Cada posição aparece como um anel. A bolinha mostra onde está o preço dentro do range.
- Nas pontas ficam as moedas: à esquerda, a moeda com que você fica 100% se o preço cair abaixo do mínimo; à direita, a moeda com que você fica 100% se subir acima do máximo.
- Mostra também valor em US$, fees a coletar, distância até a borda e composição.
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
3. Abra pelo ícone e toque na engrenagem para configurar:
   - **Carteiras:** apelido e endereço `0x…`. Pode adicionar várias.
   - **Chave The Graph:** só é necessária para posições **v4**. As v3 são lidas direto da blockchain.
   - **Redes:** marque as que você usa.

### Como criar a chave do The Graph (grátis)

1. Acesse https://thegraph.com/studio e entre com sua carteira ou e-mail.
2. Vá em **API Keys → Create API Key**.
3. Recomendado: em *Authorized domains*, coloque `SEU-USUARIO.github.io`. Assim a chave só funciona no seu site.
4. O plano gratuito cobre com folga o uso pessoal.

## 3. Alertas no iPhone (ntfy + GitHub Actions)

O GitHub verifica suas posições a cada ~10 minutos e manda notificação **só quando algo muda**: a posição ficou perto da borda, saiu do range ou voltou ao range.

1. Instale o app **ntfy** no iPhone (App Store, grátis).
2. No app, toque em **+** e assine um tópico com um nome difícil de adivinhar, por exemplo `pools-marco-7f3k9q2x`. O nome do tópico funciona como senha: quem souber o nome recebe os avisos.
3. No GitHub, abra **Settings → Secrets and variables → Actions**.
4. Na aba **Secrets**, clique em *New repository secret* e crie:

| Nome | Valor |
|---|---|
| `CARTEIRAS` | endereços separados por vírgula. No app, use **Configurações → Copiar CARTEIRAS** |
| `NTFY_TOPIC` | o nome do tópico do passo 2 |
| `GRAPH_API_KEY` | sua chave do The Graph (necessária para posições v4) |

5. Na aba **Variables** (opcional), crie:

| Nome | Valor |
|---|---|
| `ALERTA_PADRAO` | % de distância para "perto da borda" (padrão `5`) |
| `LIMITES` | limites por posição. No app, use **Configurações → Copiar LIMITES** |
| `REDES` | redes a verificar, ex.: `arbitrum,base` (padrão: todas) |

6. Vá em **Actions → Alertas de range → Run workflow** para testar. Na primeira execução chega a notificação "Alertas ativados".

> Os secrets ficam ocultos mesmo com o repositório público, e o log do Actions não imprime endereços nem valores.

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

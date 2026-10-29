# Dokke para Windows

O PC (Windows 10/11) vira o "host": o Dokke roda na bandeja, mostra os apps do PC e o celular
(Android ou qualquer navegador) abre e traz os apps para frente.

## Instalar (usuário)

1. Baixe `Dokke-Setup-<versão>.exe` nos [Releases](https://github.com/felipenalves/Dokke/releases) e execute.
   Não precisa de administrador. Deixe marcadas as opções **iniciar com o Windows** e **liberar no Firewall**
   (esta pede uma permissão de administrador uma única vez).
2. Na primeira abertura, o Dokke mostra a tela **Conectar** com um QR Code e um PIN.
3. No celular, na mesma rede Wi‑Fi, **escaneie o QR**: o Dokke abre já conectado. No app Android, ele acha o PC
   sozinho; digite o PIN mostrado na tela.
4. Na aba **Dock**, clique em **+** em qualquer slot para adicionar apps ou sites. Arraste para reorganizar.

O ícone da bandeja tem: abrir o Dokke, copiar o endereço, liberar no Firewall, iniciar com o Windows,
pasta de logs e sair. Dados e logs ficam em `%APPDATA%\Dokke`.

### Se o celular não conectar
- A rede do PC precisa estar como **Privada** (Configurações → Rede → Propriedades da rede).
- Use **Liberar no Firewall…** no menu da bandeja.
- Com VPN, WSL ou VirtualBox o PC tem vários endereços: escolha o certo na lista da tela **Conectar**.
- Se a porta 3000 estiver ocupada, o Dokke usa a próxima livre (3001…); o QR e o app Android já acompanham.

## Como funciona
```
Dokke.exe (bandeja)  ──inicia──▶  node.exe server\server.js  ◀── celular (PWA / APK) via Wi‑Fi
      ▲                                  │
      └── "Dokke.exe running|focus|launch|icon …" (helper, sem UI) ◀─┘
```
- **Dokke.exe** é um só executável: sem argumentos é a bandeja; com `running`, `focus`, `launch`,
  `launch-packaged`, `icon`, `icon-packaged` age como helper (JSON em UTF‑8).
- O servidor só ativa apps que existem no inventário do PC (atalhos do Menu Iniciar + apps da Store).
  Nada que chega pela rede vira linha de comando.
- O foco usa o HWND da janela e tenta, em ordem: `SetForegroundWindow`, anexar à thread do primeiro plano,
  toque de Alt e `SwitchToThisWindow`. Se o Windows ainda recusar (por exemplo, janela de um app rodando como
  administrador), o botão pisca na barra de tarefas e o celular recebe sucesso parcial (`focused:false`), sem erro.
- O servidor recusa conexões que não venham da rede local ou do próprio PC (defesa contra IPv6 público).
  Para desligar: variável `DOKKE_ALLOW_PUBLIC=1`.
- O QR leva o PIN no fragmento da URL (`#pin=1234`), que o navegador nunca envia ao servidor.

## Compilar (desenvolvedor)

Requisitos: Windows, .NET 8 SDK, Node 22, Inno Setup 6.

```powershell
npm ci
npm run windows:build          # dist\Dokke-Setup-<versão>.exe
./scripts/smoke-windows.ps1    # teste de fumaça no pacote (helper, servidor, inventário, bandeja)
```
Sem Windows local, o workflow `Windows` (GitHub Actions) faz tudo isso e anexa o instalador ao release
quando a tag `v*` é publicada. Os testes de Node (`npm test`) rodam em Linux no workflow `Testes`.

## Roteiro de teste manual (primeira vez)
1. Instalar → a tela **Conectar** abre sozinha; o QR leva ao Dokke já conectado no celular.
2. Adicionar 3 apps (um do Menu Iniciar, um da Store, um site) e confirmar os ícones.
3. Tocar num app **fechado** → abre. Tocar num app **aberto atrás de outra janela** → vem para frente.
4. Tocar num app **minimizado** → restaura. Tocar num app rodando **como administrador** → deve piscar
   na barra de tarefas (sem mensagem de erro).
5. Reiniciar o PC → o Dokke volta sozinho e o celular reconecta.
6. Fechar pela bandeja → nenhum `node.exe` do Dokke deve sobrar no Gerenciador de Tarefas.

## Limitações conhecidas
- Windows 10/11 x64. Atalhos do Apple Shortcuts não existem no Windows.
- O instalador não é assinado: o SmartScreen pode avisar ("Mais informações → Executar assim mesmo").
- O pacote é self-contained (inclui .NET e Node): o instalador tem algumas dezenas de MB.
- Cada consulta de janelas abre o `Dokke.exe` por ~0,1 s. Se virar gargalo, o próximo passo é um
  modo persistente do helper (JSON por linha), sem mudar a API.

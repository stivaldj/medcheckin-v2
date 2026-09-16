# DEPLOY-CASA — MedCheck-in num PC de casa (Windows 10 + WSL Ubuntu), sem VPS e sem domínio

Para o piloto pequeno (1 médica + poucos pacientes) rodando num PC que fica ligado 24 h. Custo zero.
Para produção com domínio próprio numa VPS, use [`DEPLOY.md`](DEPLOY.md).

```
celular / navegador ──HTTPS──▶ Tailscale Funnel ──▶ [seu PC · WSL · Docker]
                                (medcheckin.<rede>.ts.net)   tailscale ─▶ caddy ─▶ web ─▶ db
                                                                          scheduler ─▶ db
                                                                          backup ─▶ pasta do Syncthing ─▶ Mac
```

| Peça              | Como                                                                                |
| ----------------- | ----------------------------------------------------------------------------------- |
| Endereço HTTPS    | Tailscale Funnel — `https://medcheckin.<sua-rede>.ts.net`, fixo, certificado válido |
| E-mail do login   | SMTP do Gmail com senha de app                                                      |
| Backup fora do PC | backup cifrado numa pasta sincronizada com o Mac pelo Syncthing                     |
| Aviso de queda    | UptimeRobot em `/api/health`                                                        |
| Energia           | nobreak                                                                             |

## Leia antes: o que este modelo NÃO garante

- **PC desligado = sistema parado.** Lembretes de dose não saem e alertas não chegam à médica.
  O nobreak cobre quedas curtas; o UptimeRobot (parte 11) te avisa das longas. Combine com a médica
  o que fazer se o sistema cair.
- **O Windows 10 reinicia sozinho para atualizar.** A tarefa da parte 3 traz tudo de volta, mas há
  alguns minutos fora do ar a cada reinício.
- **O endereço `.ts.net` pertence à sua conta Tailscale.** Trocar de conta, de nome de rede ou de
  `TS_HOSTNAME` muda o endereço — e convites, PWA instalado e notificações push param de funcionar.
  Escolha uma vez e não mexa.
- **Você é o operador dos dados de saúde** (LGPD art. 11). Criptografia do disco (parte 1) e backup
  fora do PC (parte 6) não são opcionais com paciente real.
- **Windows sem atualização de segurança é risco.** O suporte do Windows 10 terminou em out/2025
  (versões antigas, como a 21H2, antes disso). O app fica exposto na internet pelo Funnel e guarda
  dado de saúde: confira a versão (`winver`) e **registre por escrito** se o piloto aceita esse risco
  — ou use um PC com sistema suportado (ESU do Windows 10, Windows 11 ou Linux).

Cada parte termina com **✅ Confira**: não siga para a próxima sem ver o resultado esperado.

---

## Parte 1 — Windows

1. **Nunca suspender.** Painel de Controle → Opções de Energia → Alterar configurações do plano:
   "Suspender atividade do computador" = **Nunca** (na tomada). Em "Alterar configurações avançadas",
   desative também a hibernação e a suspensão do disco rígido.
2. **Voltar a ligar sozinho depois de queda longa.** Na BIOS/UEFI do PC, procure "Restore on AC
   Power Loss" (ou "AC Recovery") e deixe em **Power On**. Se o nobreak esgotar, o PC religa quando a
   energia volta.
3. **Atualizações.** Configurações → Atualização e Segurança → Windows Update → "Alterar horário
   ativo": cubra o horário de uso da médica. Reinícios vão acontecer fora dele — a parte 3 cuida da volta.
4. **Criptografia do disco.**
   - **Windows 10 Pro:** Painel de Controle → Criptografia de Unidade de Disco BitLocker → Ativar no
     disco `C:`. **Guarde a chave de recuperação fora do PC** (gerenciador de senhas).
   - **Windows 10 Home:** Configurações → Atualização e Segurança → **Criptografia do dispositivo**.
     Se essa opção não existir, o hardware não suporta — anote isso como risco aceito do piloto.
5. **Conta do Windows com senha forte**, e ninguém mais usando esse PC com acesso ao WSL.

✅ **Confira:** `manage-bde -status C:` (PowerShell como administrador) mostra "Proteção Ativada" —
ou, no Home, a Criptografia do dispositivo aparece como ativada.

## Parte 2 — WSL e Docker

Tudo daqui em diante roda **dentro do Ubuntu** (abra "Ubuntu" no menu Iniciar), exceto quando indicado.

1. **Atualize o WSL** (PowerShell como administrador):

   ```powershell
   wsl --update
   wsl --version
   wsl -l -v
   ```

   `wsl --version` precisa responder (é a versão da Microsoft Store, que suporta systemd). Anote o nome
   exato da distribuição em `wsl -l -v` (ex.: `Ubuntu` ou `Ubuntu-22.04`) — ele é usado na parte 3.

2. **Ligue o systemd** no Ubuntu. Primeiro veja se já está ligado (versões novas do Ubuntu no WSL
   já vêm assim): `systemctl is-system-running` respondendo `running` ou `degraded` → pule para o
   passo 3. Senão:

   ```bash
   sudo tee /etc/wsl.conf >/dev/null <<'EOF'
   [boot]
   systemd=true
   EOF
   ```

   No PowerShell: `wsl --shutdown`, espere 10 segundos e abra o Ubuntu de novo.

3. **Instale o Docker Engine** (não o Docker Desktop — não instale os dois):

   ```bash
   sudo apt-get update && sudo apt-get install -y ca-certificates curl git
   sudo install -m 0755 -d /etc/apt/keyrings
   sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
   sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
   sudo systemctl enable --now docker
   sudo usermod -aG docker "$USER"
   ```

   Feche e reabra o Ubuntu (para o grupo `docker` valer).

4. **Clone o projeto no disco do Linux** — não em `/mnt/c`, que é lento e dá problema de permissão
   com o Postgres:
   ```bash
   git clone https://github.com/stivaldj/medcheckin-v2.git ~/medcheckin && cd ~/medcheckin
   ```

✅ **Confira:** `systemctl is-active docker` → `active` · `docker run --rm hello-world` → "Hello from Docker!"

## Parte 3 — Manter o Ubuntu ligado depois de reiniciar

No Windows 10 o WSL não sobe sozinho com o PC e desliga quando nada o usa. Uma tarefa agendada o
inicia no boot — **mesmo sem ninguém fazer login** — e o mantém vivo.

PowerShell **como administrador** (troque `Ubuntu` pelo nome anotado na parte 2):

```powershell
$distro  = "Ubuntu"
$acao    = New-ScheduledTaskAction -Execute "wsl.exe" -Argument "-d $distro --exec /bin/sh -c 'sleep infinity'"
$gatilho = New-ScheduledTaskTrigger -AtStartup
$config  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
             -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$senha   = Read-Host "Senha do seu usuário do Windows"
Register-ScheduledTask -TaskName "MedCheckin-WSL" -Action $acao -Trigger $gatilho -Settings $config `
  -User "$env:USERDOMAIN\$env:USERNAME" -Password $senha -RunLevel Highest
```

Os containers sobem sozinhos quando o Docker inicia (todos têm `restart: unless-stopped`).

✅ **Confira (faça isto de verdade, depois da parte 10):** reinicie o PC, **não faça login**, espere
3 minutos e abra `https://medcheckin.<sua-rede>.ts.net/api/health` **no celular, pelo 4G**.
Tem que responder `{"ok":true,...}`.

**Se não responder:** algumas combinações de Windows 10 + WSL não iniciam o WSL antes do login. Plano B:
edite a tarefa para o gatilho **"Ao fazer logon"** e ative o login automático do Windows
(`netplwiz` → desmarque "Os usuários devem digitar um nome de usuário e senha"). Com login automático,
a criptografia do disco da parte 1 fica ainda mais importante.

## Parte 4 — Tailscale (o endereço HTTPS)

1. Crie a conta em <https://login.tailscale.com> (pode entrar com a conta Google).
2. **DNS** (<https://login.tailscale.com/admin/dns>): ative **MagicDNS** e **HTTPS Certificates**.
   Anote o **nome da rede** ("Tailnet name", algo como `tail1234.ts.net`).
   Seu endereço será `https://medcheckin.<nome-da-rede>` — ex.: `https://medcheckin.tail1234.ts.net`.
3. **Permissão de Funnel** (<https://login.tailscale.com/admin/acls>): o arquivo de política precisa
   ter o atributo `funnel`. Contas novas costumam já trazer; se não houver, acrescente:
   ```json
   "nodeAttrs": [{ "target": ["autogroup:member"], "attr": ["funnel"] }]
   ```
4. **Chave de autenticação** (<https://login.tailscale.com/admin/settings/keys>) → Generate auth key.
   Não reutilizável, não efêmera. Copie para `TS_AUTHKEY` na parte 7. Ela só é usada no primeiro
   login; depois disso o estado fica salvo no volume `tailscale_state`.
5. **Depois de subir (parte 8):** em <https://login.tailscale.com/admin/machines>, abra a máquina
   `medcheckin` → **Disable key expiry**. Sem isso ela sai da rede em 180 dias e o site cai.

## Parte 5 — E-mail do login (Gmail)

1. Na conta Google que vai enviar os e-mails, ative a **Verificação em duas etapas**.
2. Crie uma **senha de app** em <https://myaccount.google.com/apppasswords> (nome: "MedCheck-in").
   São 16 letras — vai em `SMTP_PASS`.

Limite do Gmail: ~500 e-mails por dia. Para o piloto sobra.

## Parte 6 — Backup fora do PC (Syncthing → Mac)

1. **No PC**, crie a pasta de backup dentro de uma pasta que o Syncthing já sincroniza com o Mac —
   ex.: `C:\Users\<você>\Sync\medcheckin-backups`. Pelo WSL ela aparece como
   `/mnt/c/Users/<você>/Sync/medcheckin-backups` — esse caminho vai em `BACKUP_HOST_DIR`. Cada rodada de
   backup grava **dois** arquivos nessa pasta: `medcheckin-*.dump.enc` (banco) e `uploads-*.tar.enc`
   (anexos, D38) — os dois seguem para o Mac pelo Syncthing.
2. **No Mac**, nas opções dessa pasta no Syncthing:
   - **Tipo de pasta: "Receive Only"** — o Mac só recebe; se algo apagar ou corromper os arquivos no
     PC, a cópia do Mac não é sobrescrita de volta.
   - **File Versioning: "Staggered"** — guarda versões antigas mesmo quando o PC apaga backups
     vencidos (o PC mantém `BACKUP_KEEP_DAYS`, padrão 14 dias).
3. **`BACKUP_PASSPHRASE`**: gere uma frase longa e **guarde no gerenciador de senhas, fora do PC**.
   Os arquivos saem cifrados; sem essa frase o backup é inútil — inclusive para você.

## Parte 7 — Arquivo `.env.prod`

Os segredos vão **direto para o arquivo**, sem aparecer na tela: terminal rolado, print e histórico
de conversa não podem guardar senha do banco nem chave privada.

No Ubuntu, dentro de `~/medcheckin`:

1. **Gere os segredos** (cria o arquivo só com permissão sua):

   ```bash
   cd ~/medcheckin && umask 077
   v=$(docker run --rm node:22-alpine sh -c "npx -y web-push@3 generate-vapid-keys --json 2>/dev/null")
   {
     echo "POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')"
     echo "BACKUP_PASSPHRASE=$(openssl rand -base64 36 | tr -d '/+=')"
     echo "VAPID_PUBLIC_KEY=$(printf '%s' "$v" | sed -n 's/.*"publicKey": *"\([^"]*\)".*/\1/p')"
     echo "VAPID_PRIVATE_KEY=$(printf '%s' "$v" | sed -n 's/.*"privateKey": *"\([^"]*\)".*/\1/p')"
   } > .env.prod
   unset v
   ```

   ✅ **Confira sem mostrar os valores** — cada linha tem que dar `1`:

   ```bash
   for k in POSTGRES_PASSWORD BACKUP_PASSPHRASE VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY; do echo "$k: $(grep -c "^$k=.\{20,\}$" .env.prod)"; done
   ```

2. **Guarde fora do PC** a `POSTGRES_PASSWORD` e a `BACKUP_PASSPHRASE`: abra o arquivo **você mesmo**
   (`nano .env.prod`), copie as duas para o gerenciador de senhas e feche sem alterar. Sem a
   passphrase o backup é inútil — inclusive para você.

3. **Complete o resto** com `nano .env.prod`, acrescentando no fim (troque tudo que está entre `< >`).
   A senha de app do Gmail e a chave do Tailscale você digita aqui — não cole em chat, e-mail ou print:

   ```ini
   APP_BASE_URL=https://medcheckin.<nome-da-rede>
   # exigido pelo compose de produção; em casa o Caddy não usa
   DOMAIN=:80

   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=<conta>@gmail.com
   SMTP_PASS=<senha de app, 16 letras SEM os espaços que o Google mostra>
   EMAIL_FROM="MedCheck-in <conta@gmail.com>"   # mesma conta do SMTP_USER; mantenha as aspas

   VAPID_SUBJECT=mailto:<conta>@gmail.com

   TS_AUTHKEY=<chave da parte 4>
   TS_HOSTNAME=medcheckin

   BACKUP_HOST_DIR=/mnt/c/Users/<você>/Sync/medcheckin-backups

   APP_VERSION=<saída de: git rev-parse --short HEAD>
   ```

   ✅ **Confira sem mostrar os valores** — nenhum texto de exemplo pode sobrar e todas as chaves precisam
   existir:

   ```bash
   grep -cE '<(conta|senha|chave|nome-da-rede|você|saída)' .env.prod   # tem que dar 0 (nenhum exemplo esquecido)
   for k in APP_BASE_URL DOMAIN SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS EMAIL_FROM VAPID_SUBJECT TS_AUTHKEY TS_HOSTNAME BACKUP_HOST_DIR APP_VERSION; do grep -q "^$k=." .env.prod && echo "ok $k" || echo "FALTA $k"; done
   ls -l .env.prod         # -rw------- (só você lê)
   ```

## Parte 8 — Subir

```bash
cd ~/medcheckin
docker compose -p medcheckin -f docker-compose.prod.yml -f docker-compose.casa.yml --env-file .env.prod up -d --build
```

A primeira vez demora (compila as imagens). O serviço `migrate` cria o banco e só depois `web` e
`scheduler` sobem.

✅ **Confira:**

```bash
alias mc='docker compose -p medcheckin -f docker-compose.prod.yml -f docker-compose.casa.yml --env-file .env.prod'
mc ps                      # db, web, scheduler, caddy, tailscale, backup → running/healthy; migrate → exited (0)
mc logs migrate | tail -3  # "migrate: batch 1 aplicado → ..."
mc logs tailscale | tail   # sem erro de autenticação
```

(Coloque o `alias mc=...` no `~/.bashrc` para usar nas próximas vezes.)

## Parte 9 — Primeiro acesso

Crie a clínica e a médica (o seed é recusado em produção de propósito):

```bash
mc exec db psql -U medcheckin -d medcheckin -c "insert into clinics(name) values('<Nome da clínica>') returning id"
mc exec db psql -U medcheckin -d medcheckin -c "insert into users(clinic_id, role, email, name) values('<id acima>','doctor','<email da médica>','<Dra. Nome>')"
```

## Parte 10 — Verificar de ponta a ponta

Faça cada item **pelo celular, fora do Wi-Fi de casa**:

- [ ] `https://medcheckin.<nome-da-rede>/api/health` → `{"ok":true,"db":"up","scheduler":{"stale":false}}`
- [ ] Médica entra em `/login` → o e-mail com o link chega → login funciona
- [ ] Cadastra um paciente de teste → o link de convite abre no celular → aceite → instalar o PWA
- [ ] Ativar notificações no PWA → uma notificação de lembrete chega no horário
- [ ] **Backup:** `mc exec backup /usr/local/bin/backup.sh` → aparecem `backup.ok` e `backup.uploads_ok` →
      os arquivos `medcheckin-*.dump.enc` e `uploads-*.tar.enc` aparecem **no Mac** em alguns minutos
- [ ] **Restore:** `mc exec backup /usr/local/bin/restore-drill.sh` → `RESTORE DRILL OK` seguido de
      `RESTORE DRILL anexos OK`
- [ ] **Reinício:** o teste da parte 3 (reiniciar sem login e abrir o health pelo 4G)
- [ ] Apague o paciente de teste antes de cadastrar os pacientes reais (anonimizar, na tela do paciente)

## Parte 11 — Aviso de queda (UptimeRobot)

1. Conta gratuita em <https://uptimerobot.com>.
2. New Monitor → **HTTP(s)** → URL `https://medcheckin.<nome-da-rede>/api/health` → intervalo 5 min.
3. Alerta por e-mail (e, se quiser, pelo app no celular).
4. **Prove o aviso antes de precisar dele** — um alarme só exercitado no dia da queda não é
   alarme (é critério de aborto do piloto: "scheduler parado > 60 min sem alerta"). Derrube o app de
   propósito e espere o e-mail chegar:

   ```bash
   mc stop web      # o /api/health passa a falhar
   # espere o e-mail do UptimeRobot (até ~2 intervalos do monitor)
   mc start web
   ```

   Não chegou? Confira o contato de alerta no UptimeRobot antes de seguir.

O `/api/health` responde **503** quando o banco caiu ou o scheduler parou — não só quando o PC desliga.

## Parte 12 — Atualizar

```bash
cd ~/medcheckin && git pull
sed -i "s/^APP_VERSION=.*/APP_VERSION=$(git rev-parse --short HEAD)/" .env.prod
mc up -d --build
mc logs migrate | tail -3
```

As migrations rodam sozinhas a cada atualização. Antes de atualizar, confira que o backup da
madrugada chegou ao Mac.

## Parte 13 — Acesso SSH pelo Tailscale (atualizar sem AnyDesk)

O contêiner `tailscale` do compose só publica o site; o WSL em si não está na tailnet. Esta parte
coloca o WSL na tailnet como `medcheckin-wsl` e abre um SSH que só aceita chave pública vinda de
endereços da tailnet (`100.64.0.0/10`). Sem senha, sem porta exposta na rede local: em WSL2 o
modo NAT não deixa a porta 22 visível para fora do PC.

1. No Mac, gere uma chave só para isso e copie o conteúdo do `.pub`:

   ```bash
   ssh-keygen -t ed25519 -N "" -C "medcheckin-wsl" -f ~/.ssh/id_ed25519_medcheckin && cat ~/.ssh/id_ed25519_medcheckin.pub
   ```

2. No WSL, com o repositório atualizado (`git pull`):

   ```bash
   cd ~/medcheckin && sudo sh scripts/wsl-ssh-setup.sh "ssh-ed25519 AAAA... medcheckin-wsl"
   ```

   O script instala o Tailscale pelo instalador oficial, roda `tailscale up`, instala o
   `openssh-server`, grava a configuração em `/etc/ssh/sshd_config.d/60-medcheckin-tailscale.conf`
   e a chave em `~/.ssh/authorized_keys`. Se aparecer um link `login.tailscale.com/...`, abra no
   navegador e autorize; com `TS_AUTHKEY=... sudo -E sh scripts/wsl-ssh-setup.sh ...` ele entra sem
   link. Pode rodar de novo à vontade (para trocar a chave, por exemplo).

3. No admin do Tailscale, em Machines → `medcheckin-wsl`, marque **Disable key expiry**, como na
   parte 4.5, senão o acesso cai depois de meses.

4. No Mac, em `~/.ssh/config` (o script imprime o IP no final):

   ```
   Host medcheckin-wsl
     HostName 100.x.y.z
     User xbr
     IdentityFile ~/.ssh/id_ed25519_medcheckin
   ```

   Teste: `ssh medcheckin-wsl 'cd ~/medcheckin && git log --oneline -1'`.

Com isso a parte 12 inteira roda do Mac:

```bash
ssh medcheckin-wsl 'cd ~/medcheckin && git pull && sed -i "/APP_VERSION=/s/=.*/=$(git rev-parse --short HEAD)/" .env.prod && docker compose -p medcheckin -f docker-compose.prod.yml -f docker-compose.casa.yml --env-file .env.prod up -d --build && docker compose -p medcheckin logs migrate | tail -3'
```

O SSH depende do WSL estar de pé, o que a parte 3 já garante. Se `ssh` der `Connection refused`,
o WSL não subiu ou o `tailscaled` não iniciou: `wsl -d Ubuntu` no PowerShell e `sudo systemctl status tailscaled ssh`.

## Problemas comuns

| Sintoma                                                            | Causa provável e o que fazer                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Could not resolve host: github.com` (mas `ping 1.1.1.1` responde) | DNS do WSL sem servidor: com systemd, o resolvedor local `127.0.0.53` fica sem upstream. `sudo mkdir -p /etc/systemd/resolved.conf.d && printf '[Resolve]\nDNS=1.1.1.1 8.8.8.8\nFallbackDNS=9.9.9.9\n' \| sudo tee /etc/systemd/resolved.conf.d/dns.conf` e `sudo systemctl restart systemd-resolved`. Vale depois de reiniciar |
| `.ts.net` não abre de fora                                         | Funnel sem permissão (parte 4.3) ou HTTPS Certificates desligado (4.2). `mc logs tailscale`                                                                                                                                                                                                                                     |
| Site cai depois de meses                                           | Expiração da chave da máquina — parte 4.5 (Disable key expiry)                                                                                                                                                                                                                                                                  |
| E-mail do login não chega                                          | Senha de app errada ou verificação em duas etapas desligada. `mc logs web \| grep -i mail`                                                                                                                                                                                                                                      |
| `backup.sh` falha com "Permission denied"                          | `BACKUP_HOST_DIR` aponta para pasta inexistente ou sem permissão — crie a pasta pelo Windows e confira o caminho                                                                                                                                                                                                                |
| Nada responde depois de reiniciar                                  | Tarefa da parte 3 não subiu o WSL — veja o Plano B da parte 3                                                                                                                                                                                                                                                                   |
| Login bloqueado com "Muitas tentativas" para todos                 | O IP real dos visitantes não está chegando ao app (o limite de tentativas passa a ser um só para todo mundo). O `deploy/Caddyfile.casa` depende do `X-Forwarded-For` que o Funnel envia — anote o horário e reporte                                                                                                             |

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

2. **Ligue o systemd** no Ubuntu:

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
   `/mnt/c/Users/<você>/Sync/medcheckin-backups` — esse caminho vai em `BACKUP_HOST_DIR`.
2. **No Mac**, nas opções dessa pasta no Syncthing:
   - **Tipo de pasta: "Receive Only"** — o Mac só recebe; se algo apagar ou corromper os arquivos no
     PC, a cópia do Mac não é sobrescrita de volta.
   - **File Versioning: "Staggered"** — guarda versões antigas mesmo quando o PC apaga backups
     vencidos (o PC mantém `BACKUP_KEEP_DAYS`, padrão 14 dias).
3. **`BACKUP_PASSPHRASE`**: gere uma frase longa e **guarde no gerenciador de senhas, fora do PC**.
   Os arquivos saem cifrados; sem essa frase o backup é inútil — inclusive para você.

## Parte 7 — Arquivo `.env.prod`

No Ubuntu, dentro de `~/medcheckin`:

```bash
# gera segredos (anote a senha do banco e a passphrase no gerenciador de senhas)
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')"
docker run --rm node:22-alpine sh -c "npm i -g web-push >/dev/null 2>&1 && web-push generate-vapid-keys"
```

Crie `~/medcheckin/.env.prod` (troque tudo que está entre `< >`):

```ini
POSTGRES_PASSWORD=<gerada acima>
APP_BASE_URL=https://medcheckin.<nome-da-rede>
# exigido pelo compose de produção; em casa o Caddy não usa
DOMAIN=:80

SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=<conta>@gmail.com
SMTP_PASS=<senha de app, 16 letras>
EMAIL_FROM="MedCheck-in <conta@gmail.com>"   # mesma conta do SMTP_USER; mantenha as aspas

VAPID_PUBLIC_KEY=<gerada acima>
VAPID_PRIVATE_KEY=<gerada acima>
VAPID_SUBJECT=mailto:<conta>@gmail.com

TS_AUTHKEY=<chave da parte 4>
TS_HOSTNAME=medcheckin

BACKUP_HOST_DIR=/mnt/c/Users/<você>/Sync/medcheckin-backups
BACKUP_PASSPHRASE=<frase longa>

APP_VERSION=<saída de: git rev-parse --short HEAD>
```

```bash
chmod 600 .env.prod
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
- [ ] **Backup:** `mc exec backup /usr/local/bin/backup.sh` → aparece `backup.ok` → o arquivo
      `medcheckin-*.dump.enc` aparece **no Mac** em alguns minutos
- [ ] **Restore:** `mc exec backup /usr/local/bin/restore-drill.sh` → `RESTORE DRILL OK`
- [ ] **Reinício:** o teste da parte 3 (reiniciar sem login e abrir o health pelo 4G)
- [ ] Apague o paciente de teste antes de cadastrar os pacientes reais (anonimizar, na tela do paciente)

## Parte 11 — Aviso de queda (UptimeRobot)

1. Conta gratuita em <https://uptimerobot.com>.
2. New Monitor → **HTTP(s)** → URL `https://medcheckin.<nome-da-rede>/api/health` → intervalo 5 min.
3. Alerta por e-mail (e, se quiser, pelo app no celular).

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

## Problemas comuns

| Sintoma                                            | Causa provável e o que fazer                                                                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.ts.net` não abre de fora                         | Funnel sem permissão (parte 4.3) ou HTTPS Certificates desligado (4.2). `mc logs tailscale`                                                                                                                         |
| Site cai depois de meses                           | Expiração da chave da máquina — parte 4.5 (Disable key expiry)                                                                                                                                                      |
| E-mail do login não chega                          | Senha de app errada ou verificação em duas etapas desligada. `mc logs web \| grep -i mail`                                                                                                                          |
| `backup.sh` falha com "Permission denied"          | `BACKUP_HOST_DIR` aponta para pasta inexistente ou sem permissão — crie a pasta pelo Windows e confira o caminho                                                                                                    |
| Nada responde depois de reiniciar                  | Tarefa da parte 3 não subiu o WSL — veja o Plano B da parte 3                                                                                                                                                       |
| Login bloqueado com "Muitas tentativas" para todos | O IP real dos visitantes não está chegando ao app (o limite de tentativas passa a ser um só para todo mundo). O `deploy/Caddyfile.casa` depende do `X-Forwarded-For` que o Funnel envia — anote o horário e reporte |

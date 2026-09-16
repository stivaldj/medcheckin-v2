#!/bin/sh
# Acesso SSH ao WSL do PC de casa só pela rede do Tailscale (DEPLOY-CASA.md, parte 13).
# Instala o Tailscale no próprio WSL (o contêiner `tailscale` do compose só publica o site),
# instala o openssh-server aceitando apenas chave pública vinda de endereços 100.64.0.0/10
# e grava a chave pública informada no authorized_keys do usuário que chamou o sudo.
# Uso: sudo sh scripts/wsl-ssh-setup.sh "ssh-ed25519 AAAA... comentario" [nome-na-tailnet]
#   TS_AUTHKEY (opcional, no ambiente): entra na tailnet sem abrir link no navegador.
# Idempotente: pode rodar de novo para trocar/adicionar chave ou refazer a configuração.
set -eu

PUBKEY="${1:?informe a chave pública (conteúdo do .pub) como primeiro argumento}"
HOSTNAME_TS="${2:-medcheckin-wsl}"
USER_ALVO="${SUDO_USER:-$(id -un)}"
HOME_ALVO="$(getent passwd "$USER_ALVO" | cut -d: -f6)"

[ "$(id -u)" -eq 0 ] || { echo "rode com sudo" >&2; exit 1; }
case "$PUBKEY" in
  ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*|sk-*) ;;
  *) echo "chave pública inválida: precisa começar com ssh-ed25519, ssh-rsa, ecdsa-sha2- ou sk-" >&2; exit 1 ;;
esac
command -v systemctl >/dev/null || { echo "WSL sem systemd (parte 2) - habilite antes" >&2; exit 1; }

echo "1) Tailscale no WSL"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
systemctl enable --now tailscaled >/dev/null
if ! tailscale status >/dev/null 2>&1; then
  if [ -n "${TS_AUTHKEY:-}" ]; then
    tailscale up --hostname="$HOSTNAME_TS" --authkey="$TS_AUTHKEY" || {
      echo "chave TS_AUTHKEY recusada; entrando pelo link do navegador" >&2
      tailscale up --hostname="$HOSTNAME_TS"
    }
  else
    echo "   abra o link abaixo no navegador para autorizar esta máquina na tailnet"
    tailscale up --hostname="$HOSTNAME_TS"
  fi
fi
TS_IP="$(tailscale ip -4)"
echo "   tailnet ok: $HOSTNAME_TS ($TS_IP)"

echo "2) openssh-server só por chave e só pela tailnet"
if ! dpkg -s openssh-server >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q openssh-server >/dev/null
fi
cat >/etc/ssh/sshd_config.d/60-medcheckin-tailscale.conf <<EOF
# gerado por scripts/wsl-ssh-setup.sh - acesso só por chave, só de dentro da tailnet
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitRootLogin no
AllowUsers ${USER_ALVO}@100.64.0.0/10 ${USER_ALVO}@fd7a:115c:a1e0::/48
EOF
sshd -t
systemctl enable --now ssh >/dev/null
systemctl restart ssh

echo "3) chave autorizada para $USER_ALVO"
install -d -m 700 -o "$USER_ALVO" -g "$USER_ALVO" "$HOME_ALVO/.ssh"
AK="$HOME_ALVO/.ssh/authorized_keys"
touch "$AK"
grep -qxF "$PUBKEY" "$AK" || printf '%s\n' "$PUBKEY" >>"$AK"
chown "$USER_ALVO:$USER_ALVO" "$AK"
chmod 600 "$AK"

echo
echo "pronto. No Mac, em ~/.ssh/config:"
echo "  Host medcheckin-wsl"
echo "    HostName $TS_IP"
echo "    User $USER_ALVO"
echo "    IdentityFile ~/.ssh/id_ed25519_medcheckin"
echo "teste: ssh medcheckin-wsl 'cd ~/medcheckin && git log --oneline -1'"

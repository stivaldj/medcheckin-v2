# Configuração do rclone (backup off-site)

Coloque aqui o `rclone.conf` gerado por `rclone config` e defina `BACKUP_RCLONE_REMOTE` no `.env.prod`
(ex.: `b2:medcheckin-backups`). O `rclone.conf` tem credenciais: **nunca** entra no git (ver `.gitignore`).

Sem `BACKUP_RCLONE_REMOTE`, o backup fica só no volume local — e o `backup.sh` diz isso. Com ele
definido, se a cópia off-site falhar o backup termina com erro (exit 5/6), em vez de fingir sucesso.

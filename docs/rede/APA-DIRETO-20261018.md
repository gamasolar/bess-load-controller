# Auto Posto Amaral — túnel direto para o gamaserver (tira o relay da VPS)

Data: 2026-10-18. Motivo: o enlace da VPS Hostinger (srv769185) satura em ~10 Mbit/s
por sentido e as 6 câmeras do APA (12 fluxos, ~9 Mbit/s) passam por ela. Qualquer
coisa a mais (câmera da Barragem, WebRTC) estoura o teto e tudo trava com 400 ms de fila.

Desenho (template `/opt/helios/app/docs/mk-vf-template-dual-path-20260807.rsc`): o
MikroTik ganha uma segunda interface `wg-direct` apontando para `45.161.95.189:51822`
(wg1 do gamaserver, que já atende a Vila Fernanda pelo encaminhamento do Deco). O
`wg-apa` para a VPS fica como reserva. **Quem escolhe o caminho é o servidor** (rota
192.168.11.0/24 por wg1 com métrica 1, por wg2 com métrica 10) — o MikroTik só responde
pela interface por onde o pacote chegou. Um script no servidor troca a métrica se o
direto cair.

Fatos conferidos em 18/10:
- gamaserver: `wg1` = 10.10.0.1/24 escutando em 51822/udp; IP público 45.161.95.189;
  `wg1` recebendo 31 Mbit/s da VF (o encaminhamento do Deco funciona).
- MK `mk-apa-novo` (RouterOS 7; acesso `ssh -i ~/.ssh/id_rsa_helios_mk_apa admin@10.20.0.3`):
  só `wg-apa` (10.20.0.3/24, peer VPS `18ADoOD…`, allowed 10.20.0.0/24,10.10.0.0/24,192.168.10.0/24),
  LAN `lan-cams` 192.168.11.1/24, firewall com `drop outros input` e `SSH-helios-wg src=10.20.0.2`.
- Endereço livre no wg1: 10.10.0.4 (10.10.0.2 reservado, 10.10.0.3 = VF).

Ordem: **A (MK) → B (servidor) → C (teste) → D (virar a rota) → E (failover) → F (persistir)**.
Nada de A–C derruba o que existe; o relay continua ativo até o passo D.

---

## A. MikroTik do APA (um comando por linha; não colar várias de uma vez)

```
/export file=apa-antes-direto-20261018
/interface wireguard add name=wg-direct listen-port=51821 mtu=1420 comment="Direto pro gamaserver (primario)"
/interface wireguard print
```
Anote a `public-key` de `wg-direct` → **PUB_WG_DIRECT_APA**.

```
/ip address add address=10.10.0.4/24 interface=wg-direct comment="tunel direto"
/ip firewall filter add chain=input action=accept protocol=udp dst-port=51821 comment="WG direct inbound" place-before=[find comment="drop outros input"]
/ip firewall filter add chain=input action=accept protocol=tcp src-address=10.10.0.1 dst-port=22 comment="SSH-helios-direct" place-before=[find comment="drop outros input"]
/ip firewall filter add chain=forward action=accept in-interface=wg-direct out-interface=lan-cams comment="wg-direct->cams" place-before=[find comment="forward est/rel"]
```

O peer precisa da chave pública do wg1 do servidor (passo B1). Com ela em mãos:

```
/interface wireguard peers add interface=wg-direct public-key="PUB_WG1_GAMASERVER" endpoint-address=45.161.95.189 endpoint-port=51822 allowed-address=10.10.0.0/24 persistent-keepalive=25s comment="gamaserver direto"
```

Watchdog do túnel direto (mesmo padrão do `wg-watchdog` que já existe para o wg-apa):

```
/system script add name=wg-watchdog-direct owner=admin policy=read,write,test source=":local lh [/interface wireguard peers get [find interface=wg-direct] last-handshake]; :if (\$lh > 2m) do={:log warning (\"wg-watchdog-direct: sem handshake ha \".\$lh.\" bouncing wg-direct\"); /interface wireguard disable wg-direct; :delay 3s; /interface wireguard enable wg-direct}"
/system scheduler add name=wg-watchdog-direct interval=2m on-event="/system script run wg-watchdog-direct" start-time=startup
```

## B. gamaserver (sudo)

B1. Chave pública do wg1 (deve ser a mesma do wg2, `GCY6guIo…`):
```
sudo wg show wg1 public-key
```
→ **PUB_WG1_GAMASERVER** (usar no peer do passo A).

B2. Peer novo no wg1, sem derrubar nada:
```
sudo wg set wg1 peer PUB_WG_DIRECT_APA allowed-ips 10.10.0.4/32,192.168.11.0/24,10.0.0.0/24
```

## C. Teste antes de virar (sem impacto)

```
sudo wg show wg1 latest-handshakes          # linha do PUB_WG_DIRECT_APA com segundos recentes
ping -c 3 10.10.0.4                          # MK pelo direto
ping -c 3 -I wg1 192.168.11.141              # câmera pelo direto, forçando a interface
```
Se o handshake não aparecer: no MK, `/log print where topics~"wireguard"` e
`/interface wireguard peers print detail` (olhar `current-endpoint-address`).

## D. Virar a rota (câmeras do APA reconectam em ~10–30 s no Frigate/go2rtc)

Os fluxos abertos hoje têm origem 10.20.0.2 (wg2); ao trocar a rota eles caem e o
Frigate reabre com origem 10.10.0.1. É esperado.

```
sudo ip route del 192.168.11.0/24 dev wg2
sudo ip route del 10.0.0.0/24 dev wg2
sudo ip route add 192.168.11.0/24 dev wg1 metric 1
sudo ip route add 10.0.0.0/24   dev wg1 metric 1
sudo ip route add 192.168.11.0/24 dev wg2 metric 10
sudo ip route add 10.0.0.0/24   dev wg2 metric 10
ip route | grep -E "192.168.11|10.0.0.0"
```
Conferir: `ping 192.168.11.141` (deve responder ~5 ms, não ~40 ms) e as 6 câmeras do
APA voltando no Helios. Na VPS: `wg show wg0 transfer` deve mostrar o peer `iyY/Hv…`
caindo de ~9 Mbit/s para quase zero, e o ping da VPS voltando a ~20–40 ms.

Voltar atrás (se precisar): repetir o bloco trocando as métricas (wg2 = 1, wg1 = 10).

## E. Failover automático (servidor)

`wg-apa-failover.sh` (nesta pasta). Roda como root a cada minuto: se o handshake do
peer direto tiver mais de 150 s, põe o relay na frente; quando o direto voltar, devolve.
```
sudo install -m 755 /opt/bess-dashboard/docs/rede/wg-apa-failover.sh /usr/local/sbin/wg-apa-failover
sudo sed -i 's|^PEER=.*|PEER="PUB_WG_DIRECT_APA"|' /usr/local/sbin/wg-apa-failover
echo '* * * * * root /usr/local/sbin/wg-apa-failover' | sudo tee /etc/cron.d/wg-apa-failover
sudo /usr/local/sbin/wg-apa-failover && echo ok
```
Teste: no MK `/interface wireguard disable wg-direct`; em ≤ 3 min o
`ping 192.168.11.141` volta a responder pelo relay (~40 ms) e `journalctl -t wg-apa-failover`
mostra a troca. Depois `/interface wireguard enable wg-direct`.

## F. Persistir para sobreviver a reboot (aplicado com `sed`, backup antes)

Os dois confs ganham `Table = off`: sem isso o wg-quick cria, no boot, rotas métrica 0
para os AllowedIPs dos peers nos **dois** túneis, a segunda falha com "File exists" e o
túnel que subir por último não sobe (é o bug de 24/04). Com `Table = off`, o wg1 segue
atendido pelo `192.168.0.0/16` do PostUp mais a rota conectada 10.10.0.0/24; o wg2 só
pelas rotas explícitas (10.20.0.0/24 vem do `Address`). **Qualquer faixa nova no wg2
(ex.: 192.168.88.0/24 da Barragem) passa a precisar de linha no PostUp.**

```
sudo cp /etc/wireguard/wg1.conf /etc/wireguard/wg1.conf.bak-20261018
sudo cp /etc/wireguard/wg2.conf /etc/wireguard/wg2.conf.bak-20261018
sudo sed -i 's|^PostUp = ip route add 192.168.0.0/16 dev wg1;|PostUp = ip route add 192.168.0.0/16 dev wg1; ip route add 192.168.11.0/24 dev wg1 metric 1; ip route add 10.0.0.0/24 dev wg1 metric 1;|' /etc/wireguard/wg1.conf
sudo sed -i 's|^PostDown = ip route del 192.168.0.0/16 dev wg1;|PostDown = ip route del 192.168.0.0/16 dev wg1; ip route del 192.168.11.0/24 dev wg1; ip route del 10.0.0.0/24 dev wg1;|' /etc/wireguard/wg1.conf
sudo sed -i 's|^ListenPort = 51822$|ListenPort = 51822\nTable = off|' /etc/wireguard/wg1.conf
printf '\n[Peer]\n# Auto Posto Amaral - direto\nPublicKey = H1XWU7NYKBL2exIZbVACOCd6MT1875cMD8bxgt7bDgs=\nAllowedIPs = 10.10.0.4/32, 192.168.11.0/24, 10.0.0.0/24\n' | sudo tee -a /etc/wireguard/wg1.conf
sudo sed -i 's|^Address = 10.20.0.2/24$|Address = 10.20.0.2/24\nTable = off\nPostUp = ip route add 192.168.11.0/24 dev wg2 metric 10; ip route add 10.0.0.0/24 dev wg2 metric 10\nPostDown = ip route del 192.168.11.0/24 dev wg2 metric 10; ip route del 10.0.0.0/24 dev wg2 metric 10|' /etc/wireguard/wg2.conf
sudo wg-quick strip wg1 >/dev/null && sudo wg-quick strip wg2 >/dev/null && echo "sintaxe ok"
sudo grep -v PrivateKey /etc/wireguard/wg1.conf /etc/wireguard/wg2.conf
```
Não precisa reiniciar os túneis: o estado vivo já é o mesmo que os confs vão produzir no
próximo boot. Backup do MK: `/export file=apa-depois-direto-20261018`.

## Depois

- VPS: o peer `iyY/Hv…` fica como reserva (nada a remover).
- Barragem (BESS): o mesmo desenho serve para o `mk-barragem` (10.20.0.4) e tira a
  câmera e o WebRTC da VPS também — o `wg1` só precisa de mais um peer (10.10.0.5,
  192.168.88.0/24). Fica para depois de o APA estabilizar.
- Atualizar `memory/helios.md` (tabela de peers) e `MEMORY.md` ("APA aposentar relay VPS").

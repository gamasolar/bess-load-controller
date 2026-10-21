#!/usr/bin/env python3
"""Leitor de observação do SmartLogger (só leitura, Modbus TCP, unit id 0).
Grava a cada INTERVALO s em arquivos por dia: <DIR>/sl-AAAAMMDD.csv.
Mantém só RETER_DIAS dias no Pi (memória de redundância); o histórico completo
fica no servidor, que puxa estes arquivos pela WireGuard. Fase A do Caminho 2.
Colunas: hora, soc(%), ess_w(W +=descarga), pv_w(W), load_w(W), soh(%),
desc_kwh(kWh ainda descarregável), pmax_desc_w(W máx descarga agora),
pcs(nº PCS do ESS ligados), vab(V linha A-B), alarme_seq(nº seq alarme ativo), erro."""
import socket, struct, time, datetime, os, sys, glob

HOST = "192.168.88.250"; PORT = 502; INTERVALO = 30
DIR = os.environ.get("SL_DIR", "/var/lib/bess/sl")
RETER_DIAS = int(os.environ.get("SL_RETER_DIAS", "7"))
CAB = "hora,soc,ess_w,pv_w,load_w,soh,desc_kwh,pmax_desc_w,pcs,vab,alarme_seq,erro"

def ler(s, addr, n, tid):
    pdu = struct.pack(">BHH", 3, addr, n)
    s.sendall(struct.pack(">HHHB", tid, 0, len(pdu) + 1, 0) + pdu)
    r = s.recv(300)
    if len(r) < 9 or r[7] & 0x80: raise RuntimeError(f"resposta inválida {r.hex()}")
    return r[9:]

def u16(b): return struct.unpack(">H", b)[0]
def i32(b): return struct.unpack(">i", b)[0]
def u32(b): return struct.unpack(">I", b)[0]

def podar():
    corte = datetime.date.today() - datetime.timedelta(days=RETER_DIAS)
    for p in glob.glob(os.path.join(DIR, "sl-*.csv")):
        nome = os.path.basename(p)
        try: d = datetime.datetime.strptime(nome[3:11], "%Y%m%d").date()
        except ValueError: continue
        if d < corte:
            try: os.remove(p)
            except OSError: pass

os.makedirs(DIR, exist_ok=True)
tid = 1
def prox(t): return (t + 1) % 60000
ultimo_dia = None
while True:
    t0 = time.time(); agora = datetime.datetime.now(); hora = agora.strftime("%Y-%m-%d %H:%M:%S")
    try:
        s = socket.create_connection((HOST, PORT), timeout=5)
        soc  = u16(ler(s, 40515, 1, tid)) / 10;   tid = prox(tid)
        ess  = i32(ler(s, 40392, 2, tid));         tid = prox(tid)
        pv   = u32(ler(s, 40388, 2, tid));         tid = prox(tid)
        load = i32(ler(s, 40525, 2, tid));         tid = prox(tid)
        soh  = u16(ler(s, 40516, 1, tid)) / 10;    tid = prox(tid)
        desc = u32(ler(s, 40482, 2, tid)) / 1000;  tid = prox(tid)
        pmax = u32(ler(s, 40492, 2, tid));         tid = prox(tid)
        pcs  = u16(ler(s, 40207, 1, tid));         tid = prox(tid)
        vab  = u16(ler(s, 40575, 1, tid)) / 10;    tid = prox(tid)
        als  = u32(ler(s, 40568, 2, tid));         tid = prox(tid)
        s.close()
        linha = ",".join([hora, f"{soc}", f"{ess}", f"{pv}", f"{load}", f"{soh}",
                          f"{desc}", f"{pmax}", f"{pcs}", f"{vab}", f"{als}", ""])
    except Exception as e:
        linha = ",".join([hora] + [""] * 10 + [str(e)[:80].replace(",", ";")])
    caminho = os.path.join(DIR, "sl-" + agora.strftime("%Y%m%d") + ".csv")
    novo = not os.path.exists(caminho)
    with open(caminho, "a") as f:
        if novo: f.write(CAB + "\n")
        f.write(linha + "\n")
    if agora.date() != ultimo_dia:
        podar(); ultimo_dia = agora.date()
    sys.stdout.write(linha + "\n"); sys.stdout.flush()
    time.sleep(max(1, INTERVALO - (time.time() - t0)))

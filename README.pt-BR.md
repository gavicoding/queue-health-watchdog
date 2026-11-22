[🇺🇸 English](README.md) | **🇧🇷 Português**

# 📡 Queue Health Watchdog

Monitor **somente leitura** de filas de replicação e processamento em **TypeScript** com heurística de tendência por snapshots, supressão de ruído (cooldown por nó), notificações via Webhook (incluindo evento automático de `RECOVERY`) e dashboard web ao vivo.

---

## Por que usar heurística de tendência?

Monitores simples baseados apenas em valor absoluto disparam falsos positivos em horários de pico, mesmo quando os consumidores estão saudáveis e vazando a fila rapidamente.

O **Queue Health Watchdog** mantém uma janela móvel de snapshots por `(nodeId, queueName)` e diferencia:

- **`OK`**: pendentes abaixo do limite.
- **`HIGH_LOAD`**: pendentes acima do limite, **mas com progresso real de processamento** na janela (`drainedDelta > 0`) — **não gera alerta falso**.
- **`STALLED`**: pendentes acima do limite **e 0 itens processados** por `STALLED_WINDOW` ciclos seguidos — dispara alerta com *cooldown*.
- **`ERROR`**: erro explícito retornado pelo worker/adaptador — escalonamento imediato.
- **`RECOVERY`**: notificação automática quando o nó volta para `OK` ou `HIGH_LOAD`.

---

## Execução Rápida

```bash
npm install
npm run build
npm start
```

Acesse **[http://localhost:3080](http://localhost:3080)** para o painel HTML em tempo real ou consulte `/api/status` e `/api/health`.

Com Docker:

```bash
docker compose up --build
```

## Testes

```bash
npm test
```

Veja a documentação completa em [README.md](README.md) e a licença em [LICENSE](LICENSE).

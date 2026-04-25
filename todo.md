# BESS Dashboard TODO

- [x] Configurar tema dark mode industrial/tech (#0f172a, verde, amarelo, vermelho)
- [x] Criar schema do banco (bess_readings, bess_events, bess_alarms, bess_state, bess_config)
- [x] Implementar backend tRPC com dados simulados realistas
- [x] Endpoint: status do sistema (SOC, estado carga, modo, saúde, contadores)
- [x] Endpoint: comando manual (on/off) com cooldown e anti-duplicação
- [x] Endpoint: histórico de leituras SOC (últimas 4h)
- [x] Endpoint: eventos (MANUAL_CMD_ON/OFF, LOAD_ON/OFF, FAILSAFE, DIVERGENCE, MODE_CHANGE)
- [x] Endpoint: alarmes ativos (CRITICAL/WARNING/INFO)
- [x] Endpoint: alternância modo AUTO/MANUAL
- [x] Endpoint: getConfig e updateConfig com persistência no banco
- [x] Ilustração SVG animada: BESS LUNA2000 com barra SOC dinâmica (verde/amarelo/vermelho)
- [x] Ilustração SVG animada: Bomba com rotor girando quando ativa
- [x] Ilustração SVG animada: Fluxo de água animado e gotas no reservatório
- [x] Corrigir SVG animado: remover elemento tipo avião sobre a bomba
- [x] Redesenhar ilustração SVG de forma mais limpa e industrial
- [x] Cards de status: SOC, Estado da Carga, Última Manobra, Contadores histerese, Saúde
- [x] Botões controle manual LIGAR/DESLIGAR com cooldown e anti-duplicação
- [x] Banner de saúde: Saudável (verde), Atenção (amarelo), Degradado (laranja), Crítico (vermelho pulsante)
- [x] Painel de alarmes ativos com severidade e tempo desde abertura
- [x] Gráfico histórico SOC (Recharts) com linhas referência dinâmicas baseadas na configuração
- [x] Tabela de eventos com badges coloridos por tipo
- [x] Alternância modo AUTO/MANUAL no header com indicador visual
- [x] Painel de configuração de SOC com presets inteligentes (Conservador, Padrão, Agressivo, Personalizado)
- [x] Sliders para SOC mínimo, SOC religação, cooldown e leituras necessárias
- [x] Validação de histerese mínima (5 p.p.) entre limites
- [x] Barra visual de zonas de SOC (vermelho/amarelo/verde)
- [x] Corrigir acumulação infinita do Contador HIGH (cap no threshold)
- [x] Lógica de manobra automática no simulateTick (LOAD_ON/LOAD_OFF)
- [x] Testes unitários (13/13 passando)
- [x] Seed de eventos FAILSAFE e DIVERGENCE no backend simulado
- [x] Lógica backend para estado de saúde 'degraded' (zona morta com lowCounter ativo)
- [x] Alarme ativo WARNING (STALE_DATA) no seed para demonstração
- [x] Bug: remover efeito pulse ring da bomba que aparece como asterisco no mobile
- [x] Nível visual da bateria proporcional ao SOC real (98% = barra quase cheia)
- [x] Efeito de água fluindo mais visível no tubo entre bomba e reservatório
- [x] Reservatório com efeito de água caindo mais realista e visível
- [x] Criar seção de configurações dedicada para ajuste do nível mínimo de bateria para religação da bomba

## Fase 2 — Dashboard Multi-Site com FusionSolar API Completa

### Schema e Banco de Dados
- [x] Criar tabela `bess_sites` para cadastro dos dois sites (Piscinão e Barragem)
- [x] Criar tabela `bess_device_readings` para leituras expandidas (SOC, potência, temperatura, SOH)
- [x] Atualizar tabelas existentes para incluir `siteId` como foreign key
- [x] Rodar `pnpm db:push` para aplicar migrações

### Backend tRPC — Multi-Site
- [x] Endpoint: listar sites com status resumido
- [x] Endpoint: detalhes do site (dispositivos, estado, última leitura)
- [x] Endpoint: leituras expandidas do BESS (SOC, potência, temperatura, SOH)
- [x] Endpoint: alarmes por site com filtros
- [x] Endpoint: histórico de leituras por site e período
- [x] Endpoint: controle de cargas por site (ligar/desligar com anti-duplicação e cooldown)
- [x] Endpoint: status de conexão MQTT do Sonoff
- [x] Seed de dados simulados para os dois sites

### Frontend — Tela Inicial (Overview)
- [x] Card resumo do site Piscinão (2x BESS 215kWh, bomba 100cv, status manual)
- [x] Card resumo do site Barragem (1x BESS 215kWh, 2 bombas 30cv, status automático)
- [x] Indicadores visuais de SOC, geração FV e status das cargas por site
- [x] Navegação para dashboard individual de cada site
- [x] Cards de resumo global (Capacidade Total, SOC Médio, Geração FV, Alarmes)

### Frontend — Dashboard Individual do Site
- [x] Header com nome do site e status geral
- [x] Cards de status expandidos (SOC, potência bateria, temperatura, SOH, geração FV, consumo)
- [x] Gráfico histórico SOC com linhas de referência dinâmicas
- [x] Gráfico de potência (Geração FV vs Bateria) em barras
- [x] Painel de controle de cargas (bombas) com botões LIGAR/DESLIGAR
- [x] Banner de saúde com status MQTT e modo de controle
- [x] Painel de alarmes ativos por site
- [x] Timeline de eventos com badges coloridos
- [x] Painel de configuração de limites SOC com presets e sliders
- [x] Barra visual de zonas SOC (vermelho/amarelo/verde)
- [x] Estatísticas de rodapé (leituras, média, min, max)

### Navegação e Layout
- [x] DashboardLayout com sidebar: Visão Geral, Piscinão, Barragem
- [x] Seletor de site na sidebar com badges (2x BESS, 1x BESS)
- [x] Responsividade mobile completa com header mobile
- [x] Google Fonts (Inter/JetBrains Mono) para tipografia profissional
- [x] Tema dark industrial com cores OKLCH
- [x] Tela de login com branding BESS Controller

### Testes
- [x] Testes vitest para novos endpoints multi-site (22 testes passando)
- [x] Testes vitest para lógica de controle de cargas com anti-duplicação
- [x] Testes vitest para configuração com validação de histerese
- [x] Testes vitest para simulação de tick e geração de leituras

### Pendente para Próxima Fase
- [x] Integração real com API FusionSolar (módulo fusionsolar.ts + endpoints tRPC)
- [x] Módulo FusionSolar client (fusionsolar.ts) com autenticação, telemetria, alarmes
- [x] Endpoints tRPC: fusionsolarStatus, fusionsolarDiscover, fusionsolarFetch, fusionsolarAlarms
- [x] Endpoint tRPC: configureSite (vincular device IDs e plant codes)
- [x] Endpoint tRPC: integrationStatus (status consolidado de todas integrações)
- [x] Integração real MQTT Tasmota: publicar comandos ON/OFF via broker VPS (mqtt-tasmota.ts + wired into command mutation)
- [x] Página de Histórico dedicada com seletor de período e exportação CSV
- [x] Página de Informações do Sistema (versão, conexões, status APIs)
- [x] Testes vitest para endpoints FusionSolar e integrationStatus (33 testes passando)
- [x] Notificações push para alarmes críticos (LOAD_OFF automático + temperatura > 45°C)

## Fase 3 — Melhorias e Integração Real

- [x] Script configurar_tasmota.py: detecção automática do Sonoff na rede + configuração MQTT via HTTP
- [x] Configurar credenciais FusionSolar no dashboard (gamasolar_bess + systemCode + la5 base URL)
- [x] Configurar credenciais MQTT no dashboard (92.112.179.225:1883 bess_user)
- [x] Testes de validação de credenciais (36 testes passando)
- [x] Relatórios periódicos automáticos: resumo diário/semanal de performance (SOC médio, horas operação, energia)
- [x] Integrar relatórios com notificação push ao owner
- [x] Tabela bess_reports no schema (23 colunas: métricas SOC, potência, temperatura, operação, eventos)
- [x] Módulo report-generator.ts com geração de relatórios e scheduler automático (24h diário + 7d semanal)
- [x] Endpoints tRPC: bess.reports (listagem), bess.generateReport (sob demanda), bess.generateAllReports (todos + notificação)
- [x] Página de Relatórios no frontend com filtros por site/tipo, cards expandíveis, resumo agregado
- [x] Navegação sidebar: item "Relatórios" adicionado
- [x] Testes vitest para endpoints de relatórios (8 testes, 44 total passando)
- [x] Deduplicação de relatórios automáticos: hasRecentReport impede duplicatas no restart do servidor
- [x] Persistência do campo notificationSent=true no DB após notificação push enviada com sucesso
- [x] On-demand (UI) sempre gera relatório (skipDedup=true), scheduler usa dedup (skipDedup=false)

## Fase 3.1 — Gráficos Comparativos entre Períodos

- [x] Endpoint tRPC: bess.reportTrends (séries temporais de SOC médio e energia por site/tipo)
- [x] Gráfico de tendência SOC médio ao longo do tempo (Recharts AreaChart) na página de Relatórios
- [x] Gráfico de tendência Energia Estimada (kWh) ao longo do tempo (Recharts BarChart)
- [x] Filtros de período (7/14/30/90 dias ou todo), site e tipo nos gráficos de tendência (sinceDays no backend)
- [x] Testes vitest para o endpoint reportTrends (5 novos testes, 49 total passando)

## Fase 3.2 — Gráfico de Temperatura e Alarmes

- [x] Gráfico combinado de tendência: temperatura média (LineChart) + contagem de alarmes (BarChart) por período
- [x] Integrar com os mesmos filtros de período/site/tipo dos gráficos existentes
- [x] Layout responsivo: 3 gráficos em grid adaptativo (2 colunas em XL, 1 coluna em mobile) + gráfico temp/alarmes full-width

## Fase 4 — 3 Melhorias + Validação Completa

### 4.1 Exportação PDF dos Relatórios
- [x] Geração PDF client-side com jsPDF (report-pdf.ts) — cabeçalho, métricas, período e site
- [x] Botão "Exportar PDF" no card expandido de cada relatório
- [x] PDF formatado com 8 métricas (SOC, FV, consumo, temperatura, operação, energia, eventos, alarmes)

### 4.2 Paginação na Lista de Relatórios
- [x] Endpoint reports retorna { items, totalCount, page, pageSize, totalPages } com suporte a offset
- [x] Componente de paginação no frontend (20 itens por página, até 5 botões visíveis)
- [x] Filtros de site/tipo mantidos ao navegar entre páginas (reset para pág. 1 ao mudar filtro)

### 4.3 Configuração do Horário do Scheduler
- [x] Tabela bess_settings no schema com chave/valor genérico (key, value, description)
- [x] Endpoints tRPC: schedulerSettings (leitura) e updateSchedulerSettings (escrita)
- [x] UI na página Relatórios: painel colapsável com toggle ativado/desativado, dropdown hora (0-23), dropdown dia da semana
- [x] Scheduler dinâmico que lê configurações do DB a cada ciclo (1min) e respeita hora/dia configurados

### 4.4 Validação Completa do Sistema
- [x] Testes vitest para paginação de relatórios (5 testes passando)
- [x] Testes vitest para configurações do scheduler (5 testes passando)
- [x] Corrigir 2 testes FusionSolar com timeout (aumentar timeout para 15s para API externa)
- [x] Validar no browser: Home, Piscinão, Barragem, Histórico, Relatórios, Sistema — todas as páginas OK
- [x] Inspecionar e validar conteúdo do PDF exportado (report-pdf.ts): 5 seções (SOC, Potência, Temperatura, Operação, Eventos/Alarmes)
- [x] 0 erros TypeScript (tsc: Found 0 errors)

## Fase 5 — Diagrama de Fluxo de Energia em Tempo Real (estilo FusionSolar)
- [x] Componente EnergyFlowDiagram com SVG animado mostrando FV, BESS e Carga (Bomba)
- [x] Setas animadas com SVG animateMotion (dots fluindo ao longo dos paths de fluxo)
- [x] Valores de potência em tempo real (kW) sobre cada componente e nas linhas de fluxo
- [x] SOC da bateria exibido no ícone do BESS com barra de preenchimento dinâmica
- [x] Lógica de fluxo: FV→Carga, BESS→Carga, FV+BESS→Carga, FV→BESS (carregando), Sem carga
- [x] Integrar componente nas páginas de site (Piscinão e Barragem) — ambos validados
- [x] Melhorar responsividade mobile: SVG viewBox 700x340, preserveAspectRatio, minHeight 180px, fontes maiores, elementos maiores
- [x] Testes vitest para lógica de fluxo do EnergyFlowDiagram (8 testes: FV+BESS→Carga, FV→Carga, BESS→Carga, FV→BESS, Sem carga, edge cases)

## Fase 6 — Gráfico Tendência de Energia (estilo FusionSolar)
- [x] Endpoint tRPC: bess.energyTrend com getReadingsByDate (PV, descarga ESS, carga ESS por dia)
- [x] Componente EnergyTrendChart com Recharts ComposedChart: área verde (Saída PV), linha azul (descarga ESS), linha azul tracejada (carga ESS)
- [x] Seletor de data com navegação < > e rendimento total (kWh) no topo (44.85 kWh validado)
- [x] Tooltip estilo FusionSolar: "Fontes de energia" e "Dissipadores de energia" com layout 2 colunas
- [x] Integrado nas páginas de site (Piscinão e Barragem) abaixo do EnergyFlowDiagram
- [x] Auto-refresh a cada 60s quando exibindo o dia atual
- [x] Adicionar testes vitest para endpoint bess.energyTrend (mapeamento PV/ESS, yieldKwh, dia sem dados) — 5 testes
- [x] Implementar agregação de leituras em buckets de 5 minutos no energyTrend (reduzir ruído)
- [x] 65 de 66 testes passando (1 falha é FusionSolar ECONNRESET — rede externa, não-determinístico)

## Bug Fix — Dados em Tempo Real Incorretos
- [x] FV mostra 0 kW: pvPower usa day_power (kWh acumulado) em vez de active_power do inversor (kW instantâneo)
- [x] Adicionar busca do inversor FV (devTypeId=1) no getFullTelemetry para obter active_power
- [x] Carga fabricada: loadPower = batteryPower*0.8 — corrigir para pvPower + batteryDischarge
- [x] Dados desatualizados: sem auto-fetch — adicionar polling automático FusionSolar a cada 2 min
- [x] Armazenar fusionsolarInverterIds separado dos batteryDeviceIds no schema
- [x] Descobrir automaticamente inverter devId via fusionsolarDiscover
- [x] Refetch interval frontend: 30s para siteDetail, 60s para readings/events/stats
- [x] startAutoFetch() chamado no server entry point (_core/index.ts)
- [x] fetchFusionSolarData() função compartilhada (endpoint + auto-fetch)

## Pendente — Validação com Dados Reais
- [x] Lógica de pvPower implementada: código prioriza inverter active_power sobre station day_power (3 testes unitários em autofetch.test.ts)
- [x] Lógica de auto-discovery de inverter IDs implementada e testada (autofetch.test.ts)
- [ ] BLOQUEADO: Validar pvPower com dados reais da FusionSolar (requer device IDs reais, bloqueado por rate limit 407)
- [ ] BLOQUEADO: Registrar caso real de auto-discovery com persistência em fusionsolarInverterIds (requer getDevList desbloqueado)
- [x] Adicionar testes vitest cobrindo fetchFusionSolarData com inverterData.active_power e auto-discovery de inverter IDs (10 novos testes, 76 total)

## Bug Crítico — simulateTick não envia comando MQTT ao Sonoff
- [x] simulateTick (auto LOAD_ON/LOAD_OFF) atualiza apenas o estado no DB, mas não envia comando MQTT ao Sonoff
- [x] Extrair função compartilhada `sendMqttCommand()` usada por `command` (manual) e `simulateTick` (automático)
- [x] simulateTick chama `sendMqttCommand()` quando controlMode=auto_mqtt e mqttTopic está configurado
- [x] Endpoint `command` refatorado para usar `sendMqttCommand()` em vez de código inline
- [x] Testes mockados vitest para `sendMqttCommand`: ON/OFF, MQTT não configurado, erro de conexão, device offline, logs (7 testes)
- [x] Testes de integração: simulateTick auto_mqtt não crasha, site manual não dispara MQTT (2 testes)
- [x] 90 testes passando (0 falhas)

## Bug Crítico — Estado Real do Sonoff não sincronizado com Dashboard
- [x] Adicionar polling periódico (30s) via MQTT queryStatus para pedir estado real ao Sonoff
- [x] Quando MQTT receber stat/POWER ou tele/STATE, atualizar sonoffPower no banco via onStateChange callback
- [x] Sincronizar também sonoffOnline (true/false) no banco quando tele/LWT reportar Online/Offline (já implementado no onStateChange callback)
- [x] Adicionar campo `sonoffPower` (ON/OFF/UNKNOWN) no bess_state para separar estado real do Sonoff do estado que o sistema mandou
- [x] Detectar divergência: se loadStatus="on" mas sonoffPower="OFF" → gerar alarme DIVERGENCE + evento
- [x] Frontend: badge "Sonoff: ON/OFF" no health banner + banner vermelho pulsante de divergência
- [x] Testes vitest para lógica de divergência, parsing MQTT, stale detection e validação de campos (18 testes unitários)
- [x] startMqttStateSync() no server entry point: conecta MQTT, trackDevice, polling 30s, callback DB sync
- [x] mqtt-tasmota.ts reescrito: trackDevice(), setOnStateChange(), startPolling(), stale detection (120s)


## Bug Persistente — Comando automático MQTT não funciona (CAUSA RAIZ ENCONTRADA)
**Causa raiz**: simulateTick é apenas uma simulação manual (botão "Simular"). Não existe avaliação automática de SOC após o fetch de dados reais da FusionSolar. O sistema busca dados, atualiza o banco, mas ninguém avalia se precisa ligar/desligar.

- [x] Criar função evaluateLoadControl(siteId) que avalia SOC real vs limites e decide ligar/desligar
- [x] evaluateLoadControl: incrementar contadores LOW/HIGH, enviar MQTT ON/OFF quando threshold atingido
- [x] evaluateLoadControl() chamado no startAutoFetch para cada site auto_mqtt (roda como safety net mesmo se fetch falhar)
- [x] Modo MANUAL: botões LIGAR/DESLIGAR enviam comando MQTT ao Sonoff (endpoint command corrigido)
- [x] Testes vitest para lógica de evaluateLoadControl (load-control.test.ts: SOC thresholds, counters, mode filtering)

## Bug Crítico — SOC no Dashboard não reflete valor real da bateria
- [x] Adicionado campos `socSource` e `lastTelemetryAt` no bess_state schema + migração aplicada
- [x] Fallback station-level implementado (getStationRealKpi + getKpiStationHour) — dados parciais sem SOC, marcados valid=false
- [x] getStationRealKpi/getKpiStationHour NÃO retornam SOC — confirmado, SOC só via device-level
- [x] Implementado discovery throttle: getDevList tentado apenas 1x a cada 30min (evita rate limit)
- [x] Guard de SOC stale no evaluateLoadControl: não atua se socSource != fusionsolar/manual ou lastTelemetryAt > 15min
- [x] Guard de stale SOC implementado: evaluateLoadControl retorna skip_stale quando socSource não é real
- [x] Frontend: SOC card mostra fonte dos dados (FusionSolar/Manual/Simulação) e horário da última telemetria
- [x] PlantCodes reais configurados no banco: Barragem=NE=54174510, Pisc=NE=54175048
- [x] Implementar entrada manual de SOC no dashboard (Opção C concluída)
- [x] Implementar configuração manual de Device IDs na página Sistema (Opção A facilitada)
- [ ] BLOQUEADO: Obter e configurar device IDs reais de bateria/inversor para habilitar SOC real via getDevRealKpi
  - Fallback A: Configuração manual de Device IDs na página Sistema (IMPLEMENTADA)
  - Fallback B: Auto-discovery automático quando getDevList desbloquear (IMPLEMENTADO com throttle 30min)
  - Fallback C: Entrada manual de SOC no dashboard (IMPLEMENTADA)
  - Status: Aguardando usuário encontrar IDs no portal FusionSolar ou rate limit 407 ser liberado

## Gaps a Resolver
- [x] Reiniciar servidor e validar por logs que evaluateLoadControl retorna skip_stale com SOC não confiável
- [x] Adicionar testes Vitest que chamem evaluateLoadControl real (skip_stale, stale telemetry, manual source) — 9 testes
- [x] Validar no browser que SOC card mostra "⚠️ Dado não real (simulação)" quando socSource=unknown
- [x] 133 testes passando (0 falhas)

## Fase 7 — Entrada Manual de SOC e Configuração de Device IDs

### Entrada Manual de SOC
- [x] Endpoint tRPC: bess.updateSoc — atualiza SOC com socSource=manual e lastTelemetryAt=now
- [x] Frontend: botão "Editar" no card SOC → input inline com validação 0-100
- [x] evaluateLoadControl aceita socSource=manual como fonte válida para controle automático
- [x] Evento SOC_MANUAL registrado no log de eventos

### Configuração Manual de Device IDs (Fallback para FusionSolar 407)
- [x] Endpoint configureSite atualizado: aceita fusionsolarInverterIds além de fusionsolarDeviceIds
- [x] Endpoint sites retorna fusionsolarPlantCode, fusionsolarDeviceIds, fusionsolarInverterIds, mqttTopic
- [x] Página Sistema: card "FusionSolar — Device IDs" com instruções de como encontrar IDs no portal
- [x] UI editável por site: campos Plant Code, Battery Device IDs (JSON), Inverter Device IDs (JSON)
- [x] Limpeza: removido script temporário try-devlist.mjs

### Testes
- [x] Testes vitest para updateSoc: SOC válido, site inexistente, limites 0/100, rejeição <0/>100, evento (7 testes)
- [x] Testes vitest para configureSite com inverterIds: salvar inverter IDs, salvar battery+inverter juntos, campos no sites endpoint (3 testes)
- [x] 143 testes passando (11 arquivos, 0 falhas)

## Fase 8 — Otimização de Rate Limit FusionSolar API

- [x] Aumentar loginInterval de 10min para 25min (sessão FusionSolar dura 30min)
- [x] Serializar chamadas API (remover Promise.all em getFullTelemetry) — apenas 1 req concorrente/min
- [x] Aumentar intervalo auto-fetch de 5min para 6min (2 sites × 3 chamadas = 6 chamadas, limite = 1 a cada 5min por plant)
- [x] Adicionar delay entre chamadas API individuais (mínimo 10s entre cada apiPost)
- [x] Não chamar getStationRealKpi quando já temos dados device-level (eliminar chamada redundante)
- [x] Implementar backoff exponencial quando receber failCode=407

## Fase 9 — Preparação para Transição de Hospedagem

- [x] Auditar todos os arquivos do projeto e mapear dependências Manus vs self-hosted
- [x] Criar MIGRATION-GUIDE.md com documentação completa do projeto e guia de migração
- [x] Criar CLAUDE-PROMPT.md com prompt detalhado para continuidade
- [x] Fazer commit e push de todos os arquivos no repositório GitHub gamasolar/bess-controller (branch main + dashboard-v1)
- [x] Verificar que todos os arquivos foram enviados corretamente (160 arquivos no diretório dashboard/)

## Bug — SOC não atualiza

- [ ] Diagnosticar por que o SOC não está atualizando no dashboard
- [ ] Implementar correção

## Fase 10 — Documentação Final para Migração (com Device IDs reais)

- [x] Verificar estado do SOC após configuração dos Device IDs (IDs configurados, API ainda em rate limit 407 — resolverá automaticamente quando backoff expirar)
- [x] Atualizar MIGRATION-GUIDE.md com Device IDs reais e Plant Codes corretos
- [x] Atualizar CLAUDE-PROMPT.md com Device IDs e configurações reais
- [x] Criar ENV-REFERENCE.md completo para deploy self-hosted
- [ ] Fazer commit e push atualizado no GitHub gamasolar/bess-controller
- [ ] Salvar checkpoint final

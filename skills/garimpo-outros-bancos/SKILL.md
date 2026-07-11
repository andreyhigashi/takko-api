---
name: garimpo-outros-bancos
description: |
  Busca, filtra e ranqueia oportunidades de imóveis em leilão/venda direta de bancos privados
  (Itaú Unibanco, Santander, Bradesco) via o agregador leilaoimovel.com.br, complementando o
  garimpo-caixa (que cobre só Caixa). Menos concorrência que a Caixa segundo pesquisa de mercado
  (validado em 12/07/2026 via NotebookLM — comunidade Smart Leilões).

  Use esta skill SEMPRE que o usuário disser:
  - "garimpa outros bancos", "busca imóveis do Itaú/Santander/Bradesco"
  - "roda o garimpo de bancos privados"
  - "atualiza o garimpo de outros bancos"
  - qualquer variação de busca de imóveis em leilão de bancos privados (não Caixa)
---

# Garimpo Outros Bancos (Itaú, Santander, Bradesco) — SP

Pipeline de busca e triagem de imóveis de bancos privados via o agregador **leilaoimovel.com.br**
(mesmo site que já usamos nas análises de deep dive desta sessão para checar oversupply/contexto).
Complementa o `garimpo-caixa` — não substitui. Rode os dois separadamente e combine os resultados
manualmente se quiser um ranking único.

## ⚠️ Nota de instalação (12/07/2026)

Esta skill foi escrita e testada numa sessão de chat, mas **não foi instalada oficialmente** —
o ambiente usado não tinha a ferramenta de apresentar arquivo (`present_files`/`SendUserFile`)
necessária pro fluxo oficial `skill-creator` → `package_skill.py` → usuário clica "Save skill".
Uma tentativa anterior de escrever direto na pasta de skills do AppData
(`...skills-plugin\...\skills\garimpo-outros-bancos\`) foi apagada automaticamente na sessão
seguinte — essa pasta parece ser resincronizada com o conjunto de skills oficialmente instaladas
a cada invocação da ferramenta Skill, descartando qualquer coisa escrita manualmente.

**Por isso este arquivo está salvo no repositório do projeto** (versionado, não vai sumir).
Pra usar de verdade como skill instalada, rode o fluxo oficial do `skill-creator`
(`package_skill.py` + instalação) quando tiver a ferramenta de apresentar arquivo disponível.
Até lá, cole o conteúdo deste arquivo como instrução direta quando quiser rodar esse garimpo.

## ⚠️ Limitação técnica importante (descoberta em 12/07/2026, não tentar contornar de novo)

O site **não tem CSV em lote como a Caixa**. Testei os seguintes padrões de URL pra combinar
filtro de banco + estado, e **nenhum funciona**:
- `leilao-de-imoveis/sp?banco=itau-unibanco` → ignora o filtro de banco, continua listando Caixa
- `banco_leilao_de_imoveis/itau-unibanco?estado=sp` → ignora o filtro de estado, lista o Brasil todo

**Também confirmado: `?page=2` NÃO pagina** — retorna exatamente o mesmo conteúdo da página 1
(mesmos IDs de imóvel, mesma ordem). Não tente usar esse parâmetro pra buscar mais resultados.
Na prática, isso significa que **o teto real de cobertura por banco é os ~20 imóveis da primeira
página** — não tem como buscar além disso com o método atual (a menos que investigue outro
mecanismo de paginação, possivelmente scroll infinito via JS, que `tavily_extract` não executa).

**Não tente de novo a combinação de query params nem `?page=2`** — já foi testado e confirmado
que não funciona. Se o site mudar o comportamento no futuro, ok testar de novo.

## Duas categorias de busca (validadas em 12/07/2026)

### 1. Leilão extrajudicial em 2ª praça ativa

URLs (uma chamada `tavily_extract` cada, `format: "text"`, `extract_depth: "advanced"`):
```
Itaú Unibanco:  https://www.leilaoimovel.com.br/banco_leilao_de_imoveis/itau-unibanco
Santander:      https://www.leilaoimovel.com.br/banco_leilao_de_imoveis/santander
Bradesco:       https://www.leilaoimovel.com.br/banco_leilao_de_imoveis/bradesco
```
~20 imóveis por banco, nacional, ordem padrão (não dá pra ordenar por desconto via URL).

Cada bloco de imóvel segue este padrão de texto:
```
Data de encerramento: DD/MM/AAAA HH:MM
[tags: Extrajudicial | Judicial | (nome do leiloeiro parceiro, ex "Milan Leilões")]
R$ [valor_atual]   R$ [valor_1a_praca_se_2a_ativa]
[desconto]%
[Tipo] em Leilão em [Cidade] / [UF] - [ID] [Endereço completo]
1ª Praça: DD/MM/AAAA HH:MM R$ [valor_1a_praca]
2ª Praça: DD/MM/AAAA HH:MM R$ [valor_2a_praca]   (se já agendada)
+
```

**Regra crítica de estágio ativo** (validada em 12/07/2026, decisão explícita do usuário): **só
incluir no ranking final imóveis onde a "Data de encerramento" bate com a data da 2ª Praça** (ou
não há 2ª praça listada, ou seja, é praça única). Se a "Data de encerramento" bate com a 1ª Praça,
o imóvel ainda não chegou no desconto real — **excluir do ranking final**, mesmo que o valor da
2ª praça (futura) já pareça atrativo. Não adianta mostrar um preço que ainda não está disponível.

⚠️ **A janela de 2ª praça é curta e volátil** — testado com um caso real (Lins/SP, -74%,
R$204k): a 2ª praça durava só 2 dias, e quando fui confirmar disponibilidade pouco depois já
tinha saído da listagem (arrematado). **Rodar esse garimpo com frequência (idealmente diário)**
se quiser pegar a janela certa, e **sempre confirmar disponibilidade individual** antes de
recomendar qualquer imóvel desta categoria ao usuário (a data de encerramento no card não
garante que ainda está de pé — reabra a página individual pra confirmar).

### 2. Venda Direta (pós-leilão extrajudicial fracassado)

Segundo a Lei 9.514/97, §5º (Lei de Alienação Fiduciária): se o imóvel não recebe lance em
nenhuma das duas praças, a dívida do ex-mutuário é extinta e o banco assume definitivamente a
propriedade, podendo vendê-la diretamente (sem mais disputa/leilão).

URL geral (todos os bancos privados juntos, não dá pra filtrar por banco específico via URL —
testado, não funciona; **e não precisa**, o usuário confirmou em 12/07/2026 que não importa qual
banco, desde que os critérios batam):
```
https://www.leilaoimovel.com.br/leilao/venda-direta-banco
```

**Vantagens confirmadas desta categoria** (texto oficial do site, validado 12/07/2026):
- Sem comissão de leiloeiro (diferente do leilão extrajudicial, que cobra 5%)
- Opção de financiamento e uso de FGTS (ao contrário do leilão extrajudicial em praça, que na
  amostra testada era 100% à vista — ver seção "Financiamento" abaixo)
- **Dívidas de IPTU e condomínio vencidas até a data da compra são quitadas pelo banco** — não
  precisa do cálculo de dívida pessimista/otimista que fazemos pra imóveis Caixa
- Sem prazo de praça correndo — mais estável que a categoria 1, não expira do dia pra noite

⚠️ **Achado da amostra testada (12/07/2026):** os imóveis dessa categoria com marca "Reverts"
(uma gestora/servicer, não é exatamente "o banco" no nome) mostravam **desconto fixo de só 10%**
sobre a avaliação — não é o desconto profundo típico de leilão distressado. Os poucos com
desconto real (29%, 53%) na amostra ficaram bem acima de qualquer teto razoável (R$625k, R$1,19M).
Ou seja: **nesta categoria, é comum ter valor dentro do teto mas desconto abaixo do mínimo, ou
desconto bom mas valor bem acima do teto** — os dois nem sempre andam juntos aqui como andam na
Caixa. Avisar o usuário disso se o garimpo vier com poucos ou nenhum resultado nesta categoria.

## Critérios ativos (ajustados em 12/07/2026 após teste real)

**Filtros obrigatórios (aplicar às duas categorias):**
- `estado == SP` (checar sufixo "/ SP" ou ", SP" no endereço/cidade — não vem filtrado pela URL)
- `desconto_pct ≥ 25%` (afrouxado de 30% em 12/07/2026 após primeiro teste não achar nada — decisão
  explícita do usuário)
- `valor_venda ≤ R$250.000` (ajustado de R$150k/R$300k em 12/07/2026 — mesmo teto pras duas
  categorias, decisão explícita do usuário após ver que o piso de preço desse canal é mais alto
  que o da Caixa)
- `tipo` não pode ser "Terreno", "Galpão", "Comercial", "Sala", "Loja"
- **Categoria 1 (leilão extrajudicial) apenas:** excluir imóveis ainda em 1ª praça (ver regra
  acima)

**Cidades-alvo (mesma lista do garimpo-caixa, ganham +25 pts no score):**
```
INDAIATUBA, SOROCABA, PIRACICABA, ITU, SALTO, MONTE MOR,
RIBEIRAO PRETO, VALINHOS, JUNDIAI, CAMPINAS, VINHEDO,
HOLAMBRA, PAULINIA, SUMARE, NOVA ODESSA
```

**Fórmula de score (0–100):**
```
score  = min(desconto_pct / 50 * 40, 40)   # desconto → até 40 pts
score += 25 se cidade in CIDADES_ALVO
score += 20 se valor ≤ 100k
       14 se valor ≤ 150k
       10 se valor ≤ 200k
        7 se valor ≤ 250k
score += 15 se categoria == "Venda Direta" (dívidas já quitadas + sem comissão de leiloeiro +
       possível financiamento — vale mais que praça única/2ª praça de leilão extrajudicial,
       que é 100% à vista e sem dívidas quitadas)
score += 5 se quartos ≥ 2, 2 se quartos == 1 (se a info estiver disponível — nem todo card mostra)
```

**Prioridade:** score ≥ 70 → 🔴 ALTA | score ≥ 50 → 🟡 MÉDIA | score < 50 → 🟢 BAIXA

---

## Financiamento — checar sempre, não presumir

Diferente da Caixa (onde a maioria dos imóveis populares aceita financiamento com 5% de entrada),
os leilões extrajudiciais de bancos privados testados eram **100% à vista** na amostra vista em
12/07/2026 (confirmado abrindo a página individual de um imóvel do Itaú — campo de pagamento
mostrava só "À vista", nenhuma opção de financiamento). Matérias de imprensa mencionam que
*existem* opções de financiamento em alguns leilões desses bancos, mas não é a regra — **sempre
abrir a página individual e checar o campo de forma de pagamento antes de assumir que financia**,
tanto pra categoria 1 (leilão) quanto pra categoria 2 (Venda Direta, onde financiamento é mais
comum mas ainda não garantido).

---

## PASSO 1 — Buscar as duas categorias

Rodar em paralelo se possível:
- 3 chamadas `tavily_extract` (categoria 1: Itaú, Santander, Bradesco)
- 1 chamada `tavily_extract` (categoria 2: Venda Direta geral)

Total: 4 chamadas de busca inicial, dentro do orçamento "leve" pedido pelo usuário.

## PASSO 1.5 — Filtrar SP e aplicar critérios

Aplicar os filtros obrigatórios (ver seção acima) nas duas categorias. Lembrar da regra de
estágio ativo (só 2ª praça/praça única na categoria 1).

**Se o resultado vier vazio ou com poucos itens, isso é esperado e normal** — já validamos que
esse canal é estruturalmente mais escasso que a Caixa. Reportar isso ao usuário com transparência
em vez de forçar resultados fracos só pra preencher uma tabela.

## PASSO 1.6 — Validar disponibilidade real do top 5

Mesma regra do garimpo-caixa: antes de exibir a tabela final, abrir a página individual dos
**top 5** e confirmar que o imóvel ainda está disponível (não some da listagem, não tem aviso de
"arrematado"/"encerrado"). **Especialmente importante na categoria 1** dado o problema de janela
curta já documentado — um imóvel que parecia bom na busca pode já ter sumido minutos depois.

---

## PASSO 2 — Exibir resultados no chat

Mesmo formato de tabela do garimpo-caixa, com colunas extras de **Banco** e **Categoria**:

```
✅ Garimpo Outros Bancos SP — [DATA]
📊 Leilão extrajudicial (2ª praça/praça única): [X] SP filtrados | Venda Direta: [X] SP filtrados
🔴 [ALTA] de alta prioridade | 🟡 [MEDIA] de média | 🟢 [BAIXA] de baixa

| Nº | Banco | Categoria | Prioridade | Score | Cidade | Valor | Desc. | Tipo | Link |
|----|-------|-----------|------------|-------|--------|-------|-------|------|------|
|  1 | Santander | Leilão (2ª praça) | 🔴 ALTA | 85 | ... | R$... | -40% | Casa | [ver](...) |
...
```

Exibir os **top 15** combinados (as duas categorias juntas, ordenadas por score) por padrão.

**Regras de numeração:** iguais ao garimpo-caixa. Se o usuário pedir "analisa o 3", usar o
número/URL daquela posição pra acionar a skill `analise-imovel` (⚠️ nota: a skill `analise-imovel`
foi construída pra formato Caixa — vai precisar de adaptação manual pra ler dados de leilão
extrajudicial de banco privado, que tem estrutura de matrícula/edital diferente).

---

## Notas de contexto

- Validado em 12/07/2026: Itaú tem ~373 imóveis nacionais em leilão (quase tudo extrajudicial),
  Santander ~786-807, Bradesco ~253. Venda Direta geral (todos os bancos): 1354 imóveis nacionais.
  Volume bem menor que Caixa (~29 mil), o que é exatamente o ponto — menos concorrência segundo
  as fontes pesquisadas no NotebookLM (Smart Leilões).
- Leilão extrajudicial de banco privado **não tem a mesma proteção jurídica simplificada** da
  Venda Direta/Online Caixa — devida diligência de matrícula/edital ainda mais importante aqui.
- 1ª praça costuma ter lance mínimo = valor de avaliação; 2ª praça é o desconto real (geralmente
  50% da 1ª praça nos exemplos vistos, mas variou até -74% num caso real testado).
- O score não substitui due diligence — mesma ressalva do garimpo-caixa.
- Teste real de 12/07/2026 (dois testes seguidos): zero imóveis passaram em todos os critérios
  nas duas rodadas — não é falha da skill, é característica real e documentada do inventário
  desse canal nesse agregador no momento do teste. Rodar esse garimpo esporadicamente e não
  esperar resultado garantido toda vez.

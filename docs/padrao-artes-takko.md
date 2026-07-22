# Padrao de Artes e Legendas Takko Fishing

Este documento define o padrao permanente para gerar artes e legendas de anuncios da Takko Fishing a partir da pasta `dados para upload`.

## Comando

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\gerar-artes-instagram.ps1
```

## Entrada

Cada item deve estar em uma pasta dentro de `dados para upload` e conter:

- `Dados.txt`
- pelo menos uma imagem real do produto (`.jpg`, `.jpeg` ou `.png`)

Formato esperado do `Dados.txt`:

```text
Titulo: Nome do produto
Preco: 1900
Cidade: Londrina
WhatsApp: 43 9173-4399
Descricao: Relacao: 7.4:1
```

O campo `WhatsApp` pode existir na base, mas nao deve aparecer na arte nem na legenda.

## Saida

Para cada item, criar:

```text
artes/
  instagram/
    Nome da pasta do item/
      Nome da pasta do item.png
      Legenda.txt
```

## Arte

Formato:

- `1080x1080`
- post quadrado para Instagram/Facebook
- painel esquerdo com informacoes
- foto real do produto no lado direito
- CTA inferior de marketplace

Paleta:

- azul naval: `#163969`
- azul escuro: `#0E2747`
- azul petroleo: `#216A83`
- azul claro de destaque: `#3BA8EA`
- fundo claro: `#F5F7FA`
- texto escuro: `#111C2C`
- branco: `#FFFFFF`

Regras:

- usar o logo oficial em `Logo/logo_fundo_transparente.png`
- usar necessariamente uma foto real da pasta do item
- nunca gerar foto por IA
- nunca trocar o produto por imagem parecida
- nunca exibir WhatsApp
- nunca exibir QR code ou URL longa
- nunca inventar especificacoes
- usar apenas dados presentes no `Dados.txt`
- destacar preco
- manter visual clean, premium e de marketplace real

Campos permitidos na arte:

- categoria inferida do titulo: `CARRETILHA`, `MOLINETE`, `VARA`, `KIT` ou `EQUIPAMENTO`
- nome do produto vindo do titulo
- relacao, somente quando existir explicitamente na descricao
- cidade
- preco

CTA obrigatorio:

```text
VEJA ESTE ANUNCIO
NA TAKKO FISHING
```

CTA secundario:

```text
COMPRA E CONTATO
PELA PLATAFORMA
SEGURANCA PARA COMPRAR E VENDER
```

## Legenda

A legenda sempre deve seguir esta ordem:

1. Hook inicial
2. Nome do produto
3. Destaques reais do anuncio
4. Preco
5. Cidade
6. CTA marketplace
7. CTA final

Template:

```text
🎣 Olha esse equipamento disponível na Takko Fishing 👀

[NOME DO PRODUTO]

[Relação X.X:1, se existir no Dados.txt]

💰 [PREÇO]
📍 [CIDADE]

Contato direto com o vendedor pela plataforma 👊

De pescador para pescador.

🔗 Veja no link da bio
```

Regras da legenda:

- parecer humana, de pescador para pescador
- nao parecer spam
- nao usar WhatsApp
- nao usar URL longa
- nao inventar specs
- nao usar hashtags em excesso
- usar emojis moderados
- sempre terminar com `🔗 Veja no link da bio`

## Regra de ouro

A arte e a legenda devem parecer um marketplace premium de pesca, moderno, confiavel e focado no produto real.

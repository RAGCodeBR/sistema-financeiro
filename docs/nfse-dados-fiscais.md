# Perfil fiscal recebido para preparação da NFS-e

Configuração do emissor único CNPJ **60.371.448/0001-43**. Dados informados pelo usuário e confrontados com o DANFSe fornecido em 13/11/2026. O PDF privado, sua chave de acesso, dados do tomador, valor e vencimento não foram incorporados ao código, aos testes ou aos rascunhos do sistema.

| Campo | Configuração |
| --- | --- |
| Nome empresarial | LAURO ALVES DE OLIVEIRA JUNIOR LTDA, conforme DANFSe |
| Inscrição municipal | 3220285, informada pelo usuário; o DANFSe exibe hífen no campo municipal |
| Regime | Simples Nacional, ME/EPP |
| Apuração | Tributos federais e municipal pelo Simples (`opSimpNac=3`, `regApTribSN=1`) |
| Regime especial | Nenhum (`regEspTrib=0`), exigido pela regra E0175 para esse enquadramento |
| Serviço nacional | 17.01.01; normalizado `170101` |
| Serviço municipal | `021`, preservando o zero inicial |
| NBS | 1.1401.11.00; normalizada `114011100` |
| Descrição padrão | CONSULTORIA EMPRESARIAL; sem copiar datas, vencimento ou informações de pagamento do exemplo |
| Percentual informado do Simples | 6%; campo de total aproximado `pTotTribSN=6.00` na preparação do modelo fiscal |
| ISS padrão | Sem retenção (`tpRetISSQN=1`); alíquota destacada omitida |
| Incidência de ISS de referência | Santos/SP, IBGE 3548500 |
| Local da prestação | A definir conforme a operação; não é preenchido com o endereço do tomador do exemplo |

## Distinções fiscais preservadas

- Os 6% são o percentual do Simples informado pelo usuário, não uma alíquota de ISS. A preparação não deduz 6% do valor do serviço, não calcula DAS nem efetua retenção com esse percentual.
- Para apuração federal e municipal pelo SN sem retenção, `pAliq` é omitido conforme regras E0625/E0631. Omitir não significa isenção nem ISS zero.
- Se uma operação exigir retenção, deve haver uma alíquota de ISS específica, validada separadamente; o percentual do Simples não é usado como substituto. O perfil preparado nesta fase admite retenção pelo tomador; demais cenários dependem da integração fiscal.
- O DANFSe separa o local da prestação da incidência do ISS. Não se replica o município do cliente para todas as notas ou para a incidência do imposto.
- A série 70000 do exemplo pertence ao Emissor Web. A faixa de sistemas próprios é 00001–49999 (regra E0010). Não foi criada numeração de DPS, copiada série ou emitida nota nesta etapa.

## Implementação e dados já salvos

`nfseFiscalReference.ts` concentra a referência confirmada. Novos cadastros começam com esses dados. Cadastros locais anteriores recebem a opção **Revisar e aplicar dados confirmados**: o formulário permite conferir as alterações antes do salvamento e mantém as notas em rascunho. Valores explícitos anteriores não são silenciosamente substituídos na leitura. Se havia uma alíquota de ISS indevida, a revisão permite removê-la; a validação impede sua inclusão no modelo preparado.

`nfseTaxProfile.ts` normaliza enquadramento, códigos e campos tributários; a saída é uma preparação interna, não um XML DPS completo. Não chama APIs, não assina, não gera número, não transmite e retorna `fiscalReady=false`. O campo descritivo de incidência não é uma tag XML de município: a incidência efetiva depende da parametrização oficial e da validação do serviço.

Os rascunhos e a configuração de interface ainda são locais. A persistência fiscal no servidor e os dados por operação (data completa da competência, tomador/endereço, local da prestação, valores, descontos, retenções e campos aplicáveis de IBS/CBS) fazem parte da etapa de integração da emissão. Uma configuração de referência não é aplicada automaticamente a qualquer outro tipo de serviço.

## Validação oficial consultada

Foram consultados o [leiaute e regras de produção v1.01 de 09/02/2026](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_i-sefin_adn-dps_nfse-snnfse-v1-01-20260209.xlsx) e os [esquemas XSD oficiais correspondentes](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/nfse-esquemas_xsd-v1-01-20260209.zip). Os arquivos de consulta foram mantidos em `.local`; não foram enviados documentos privados para consulta externa.

Antes de assinar ou transmitir, ainda é necessário conectar o A1, verificar revogação e validade, consultar a habilitação e os parâmetros de Santos, implementar persistência e sequenciamento de DPS, montar e validar o XML completo e testar o fluxo em homologação. A consulta inicial ao projeto nesta etapa não encontrou A1 cadastrado. A publicação do perfil de referência não modifica o banco de dados, os certificados ou lançamentos financeiros.

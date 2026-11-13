export const nfseMirrorNotice =
  "SEM VALIDADE FISCAL. Espelho gerado pelo FinCore para conferência; não substitui o DANFSe oficial.";
const namespace = "http://www.sped.fazenda.gov.br/nfse";
type ExpectedDocument = { accessKey: string; dpsId: string };
type ParseXml = (xml: string) => Document;
export function readNfseMirror(
  xml: string,
  expected: ExpectedDocument,
  parse: ParseXml = (value) =>
    new DOMParser().parseFromString(value, "application/xml"),
) {
  const invalid = () =>
    new Error(
      "O XML não corresponde à NFS-e autorizada em homologação. O espelho não foi gerado.",
    );
  if (
    xml.length > 2 * 1024 * 1024 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    !/^\d{50}$/.test(expected.accessKey) ||
    !/^DPS\d{42}$/.test(expected.dpsId)
  )
    throw invalid();
  let doc: Document;
  try {
    doc = parse(xml);
  } catch {
    throw invalid();
  }
  if (
    doc.getElementsByTagName("parsererror").length ||
    doc.documentElement?.localName !== "NFSe" ||
    doc.documentElement.namespaceURI !== namespace
  )
    throw invalid();
  const node = (
    parent: Element | null | undefined,
    ...path: string[]
  ): Element | null => {
    let value = parent || null;
    for (const name of path) {
      const matches = Array.from(value?.childNodes || []).filter(
        (n) =>
          n.nodeType === 1 &&
          (n as Element).namespaceURI === namespace &&
          (n as Element).localName === name,
      ) as Element[];
      if (matches.length > 1) throw invalid();
      value = matches[0] || null;
    }
    return value;
  };
  const text = (parent: Element | null | undefined, ...path: string[]) =>
    node(parent, ...path)?.textContent?.trim() || "";
  const info = node(doc.documentElement, "infNFSe"),
    dps = node(info, "DPS", "infDPS");
  if (
    info?.getAttribute("Id") !== "NFS" + expected.accessKey ||
    dps?.getAttribute("Id") !== expected.dpsId ||
    text(dps, "tpAmb") !== "2" ||
    text(info, "emit", "CNPJ") !== "60371448000143" ||
    text(dps, "prest", "CNPJ") !== "60371448000143"
  )
    throw invalid();
  const person = (value: Element | null, address: Element | null) => ({
    name: text(value, "xNome"),
    document: text(value, "CNPJ") || text(value, "CPF"),
    registration: text(value, "IM"),
    email: text(value, "email"),
    address: [
      text(address, "xLgr"),
      text(address, "nro"),
      text(address, "xCpl"),
      text(address, "xBairro"),
      text(address, "CEP") || text(address, "endNac", "CEP"),
    ]
      .filter(Boolean)
      .join(", "),
  });
  const customer = node(dps, "toma"),
    municipal = node(dps, "valores", "trib", "tribMun");
  return {
    notice: nfseMirrorNotice,
    accessKey: expected.accessKey,
    dpsId: expected.dpsId,
    number: text(info, "nNFSe"),
    series: text(dps, "serie"),
    dpsNumber: text(dps, "nDPS"),
    competence: text(dps, "dCompet"),
    issuedAt: text(dps, "dhEmi"),
    authorizedAt: text(info, "dhProc"),
    issuer: {
      ...person(node(info, "emit"), node(info, "emit", "enderNac")),
      city: text(info, "xLocEmi"),
    },
    customer: person(customer, node(customer, "end")),
    serviceCity: text(info, "xLocPrestacao"),
    incidenceCity: text(info, "xLocIncid"),
    serviceCode: text(dps, "serv", "cServ", "cTribNac"),
    municipalCode: text(dps, "serv", "cServ", "cTribMun"),
    nbsCode: text(dps, "serv", "cServ", "cNBS"),
    description: text(dps, "serv", "cServ", "xDescServ"),
    amount: text(dps, "valores", "vServPrest", "vServ"),
    netAmount: text(info, "valores", "vLiq"),
    retainedAmount: text(info, "valores", "vTotalRet"),
    issWithheld: text(municipal, "tpRetISSQN"),
    simplesOption: text(dps, "prest", "regTrib", "opSimpNac"),
    simplesRate: text(dps, "valores", "trib", "totTrib", "pTotTribSN"),
  };
}
export type NfseMirror = ReturnType<typeof readNfseMirror>;
export async function createNfseMirrorPdf(mirror: NfseMirror): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF();
  const value = (v: string) => v || "Não informado no XML";
  const money = (v: string) =>
    /^\d+\.\d{2}$/.test(v)
      ? Number(v).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        })
      : "Não informado no XML";
  const rows = [
    [
      "Documento",
      `NFS-e ${value(mirror.number)} | DPS ${value(mirror.dpsNumber)} | Série ${value(mirror.series)}`,
    ],
    ["Competência", value(mirror.competence)],
    [
      "Emissão / autorização",
      `${value(mirror.issuedAt)} / ${value(mirror.authorizedAt)}`,
    ],
    [
      "Prestador",
      `${value(mirror.issuer.name)}\nCNPJ: ${value(mirror.issuer.document)}\n${value(mirror.issuer.address)}\n${value(mirror.issuer.city)}`,
    ],
    [
      "Tomador",
      `${value(mirror.customer.name)}\nCPF/CNPJ: ${value(mirror.customer.document)}\n${value(mirror.customer.address)}`,
    ],
    ["Local da prestação", value(mirror.serviceCity)],
    ["Incidência do ISS", value(mirror.incidenceCity)],
    [
      "Serviço / municipal / NBS",
      `${value(mirror.serviceCode)} / ${value(mirror.municipalCode)} / ${value(mirror.nbsCode)}`,
    ],
    ["Descrição", value(mirror.description)],
    ["Valor do serviço", money(mirror.amount)],
    ["Valor líquido", money(mirror.netAmount)],
    ["Total retido", money(mirror.retainedAmount)],
    [
      "ISS retido",
      (
        {
          "1": "Não retido",
          "2": "Retido pelo tomador",
          "3": "Retido pelo intermediário",
        } as Record<string, string>
      )[mirror.issWithheld] || value(mirror.issWithheld),
    ],
    [
      "Simples Nacional",
      mirror.simplesOption === "3"
        ? "Optante ME/EPP"
        : value(mirror.simplesOption),
    ],
    [
      "Percentual informado do Simples",
      mirror.simplesRate ? mirror.simplesRate + "%" : "Não informado no XML",
    ],
    ["Chave de acesso", mirror.accessKey],
    ["Identificador da DPS", mirror.dpsId],
  ];
  autoTable(doc, {
    startY: 37,
    margin: { top: 37, bottom: 19, left: 14, right: 14 },
    head: [["Campo", "Dados do XML autorizado"]],
    body: rows,
    styles: { fontSize: 9, cellPadding: 3, overflow: "linebreak" },
    columnStyles: { 0: { cellWidth: 48 }, 1: { cellWidth: 134 } },
    headStyles: { fillColor: [25, 47, 80] },
    didDrawPage: () => {
      doc.setTextColor(25, 47, 80);
      doc.setFontSize(16);
      doc.text("Espelho da NFS-e - Homologação", 14, 17);
      doc.setFontSize(8);
      doc.setTextColor(170, 45, 45);
      doc.text(doc.splitTextToSize(nfseMirrorNotice, 182), 14, 24);
    },
  });
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(90, 90, 90);
    doc.text(
      `Conferência do XML | Sem validade fiscal | Página ${page}/${doc.getNumberOfPages()}`,
      14,
      286,
    );
  }
  doc.setProperties({
    title: "Espelho de conferência - NFS-e de homologação",
    subject: nfseMirrorNotice,
    creator: "FinCore",
  });
  return doc.output("blob");
}

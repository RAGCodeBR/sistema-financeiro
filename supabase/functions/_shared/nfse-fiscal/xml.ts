import { FiscalError } from "./model.ts";
export function createXmlEngine(deps: any, schemas: Record<string, string>) {
  const buffers = new Map<string, Uint8Array>();
  let sequence = 1;
  const open = new Map<number, { bytes: Uint8Array; offset: number }>();
  // The published TSSerieDPS uses .NET-style anchors. XML Schema regex treats
  // them as literal characters; normalize this one known facet for libxml2.
  for (const [name, text] of Object.entries(schemas))
    buffers.set(
      name,
      new TextEncoder().encode(
        text
          .replace(/<!DOCTYPE[\s\S]*?\]>/, "")
          .replace('value="^0{0,4}\\d{1,5}$"', 'value="0{0,4}\\d{1,5}"'),
      ),
    );
  deps.xmlRegisterInputProvider({
    match: () => true,
    open: (name: string) => {
      const bytes = buffers.get(name.split(/[\\/]/).at(-1)!);
      if (!bytes) return undefined;
      const id = sequence++;
      open.set(id, { bytes, offset: 0 });
      return id;
    },
    read: (id: number, buffer: Uint8Array) => {
      const entry = open.get(id);
      if (!entry) return -1;
      const count = Math.min(buffer.length, entry.bytes.length - entry.offset);
      buffer.set(entry.bytes.subarray(entry.offset, entry.offset + count));
      entry.offset += count;
      return count;
    },
    close: (id: number) => open.delete(id),
  });
  const schemaDoc = deps.XmlDocument.fromString(schemas["DPS_v1.01.xsd"], {
    url: "/nfse/DPS_v1.01.xsd",
    option: 8388608 | 2048,
  });
  let validator: any;
  try {
    validator = deps.XsdValidator.fromDoc(schemaDoc);
  } finally {
    schemaDoc.dispose();
  }
  const validate = (xml: string) => {
    if (xml.length > 256000 || /<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new FiscalError("INVALID_XML", "XML não permitido.");
    let doc: any;
    try {
      doc = deps.XmlDocument.fromString(xml, { option: 8388608 | 2048 });
      validator.validate(doc);
    } catch {
      throw new FiscalError(
        "XSD_VALIDATION",
        "A DPS não passou na validação do esquema nacional. Confira os dados do serviço e do tomador.",
      );
    } finally {
      doc?.dispose();
    }
  };
  return {
    validate,
    verifyResult: (text: string, record: any, key: string) => {
      if (text.length > 2 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(text))
        throw new FiscalError(
          "NATIONAL_XML",
          "Documento nacional inválido.",
          502,
        );
      let returned: any, expected: any;
      try {
        returned = deps.XmlDocument.fromString(text, {
          option: 8388608 | 2048,
        });
        expected = deps.XmlDocument.fromString(record.signed_xml, {
          option: 8388608 | 2048,
        });
        const nodes = returned.find(
          "//*[local-name()='infDPS' and namespace-uri()='http://www.sped.fazenda.gov.br/nfse']",
        );
        const original = expected.get("//*[local-name()='infDPS']"),
          root = returned.get(
            "/*[local-name()='NFSe']/*[local-name()='infNFSe']",
          );
        if (
          nodes.length !== 1 ||
          !root ||
          root.attr("Id")?.value !== "NFS" + key ||
          nodes[0].attr("Id")?.value !== record.dps_id ||
          nodes[0].canonicalizeToString({ mode: 1 }) !==
            original?.canonicalizeToString({ mode: 1 })
        )
          throw new Error("DPS mismatch");
      } catch {
        throw new FiscalError(
          "NATIONAL_XML",
          "O XML retornado não corresponde aos dados da DPS de homologação enviada. Consulte o resultado antes de continuar.",
          502,
        );
      } finally {
        returned?.dispose();
        expected?.dispose();
      }
    },
    sign: (xml: string, privateKey: string, certificate: string) => {
      validate(xml);
      const signer = new deps.SignedXml({
        privateKey,
        publicCert: certificate,
        signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
        canonicalizationAlgorithm:
          "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
      });
      signer.addReference({
        xpath: "/*[local-name()='DPS']/*[local-name()='infDPS']",
        transforms: [
          "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
          "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
        ],
        digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
      });
      signer.computeSignature(xml, {
        location: { reference: "/*[local-name()='DPS']", action: "append" },
      });
      const result = signer.getSignedXml();
      validate(result);
      const verifier = new deps.SignedXml({
        publicCert: certificate,
        getCertFromKeyInfo: () => null,
      });
      verifier.loadSignature(signer.getSignatureXml());
      if (
        !verifier.checkSignature(result) ||
        verifier.getSignedReferences().length !== 1
      )
        throw new FiscalError(
          "INVALID_SIGNATURE",
          "Não foi possível verificar a assinatura da DPS.",
        );
      return result;
    },
    dispose: () => validator.dispose(),
  };
}

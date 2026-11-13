// Scan the large revoked-serial sequence without allocating an ASN.1 object
// tree for every entry. PKIjs still validates the issuer, dates, extensions and
// signature over the ORIGINAL, unmodified TBSCertList bytes.
type DerNode = { start: number; content: number; end: number; tag: number };
export function compactCrl(bytes: Uint8Array, serialNumber: string) {
  if (bytes.length > 12 * 1024 * 1024) throw new Error("CRL size");
  let nodes = 0;
  const read = (offset: number, limit: number): DerNode => {
    if (
      ++nodes > 200000 ||
      offset < 0 ||
      offset + 2 > limit ||
      limit > bytes.length
    )
      throw new Error("DER bounds");
    const start = offset,
      tag = bytes[offset++];
    if ((tag & 31) === 31) throw new Error("DER tag");
    let length = bytes[offset++];
    if (length & 128) {
      const count = length & 127;
      if (!count || count > 4 || offset + count > limit || bytes[offset] === 0)
        throw new Error("DER length");
      length = 0;
      for (let i = 0; i < count; i++) length = length * 256 + bytes[offset++];
      if (length < 128) throw new Error("DER nonminimal");
    }
    if (offset + length > limit) throw new Error("DER length");
    return { start, content: offset, end: offset + length, tag };
  };
  const expect = (node: DerNode, tag: number) => {
    if (node.tag !== tag) throw new Error("DER structure");
    return node;
  };
  const equal = (a: DerNode, b: DerNode) => {
    if (a.end - a.start !== b.end - b.start) return false;
    for (let i = 0; i < a.end - a.start; i++)
      if (bytes[a.start + i] !== bytes[b.start + i]) return false;
    return true;
  };
  const outer = expect(read(0, bytes.length), 48);
  if (outer.end !== bytes.length) throw new Error("DER trailing bytes");
  const tbs = expect(read(outer.content, outer.end), 48),
    algorithm = expect(read(tbs.end, outer.end), 48),
    signature = expect(read(algorithm.end, outer.end), 3);
  if (signature.end !== outer.end || bytes[signature.content] !== 0)
    throw new Error("DER signature");
  let offset = tbs.content;
  if (bytes[offset] === 2) {
    const version = read(offset, tbs.end);
    if (version.end - version.content !== 1 || bytes[version.content] !== 1)
      throw new Error("CRL version");
    offset = version.end;
  }
  const innerAlgorithm = expect(read(offset, tbs.end), 48);
  if (!equal(innerAlgorithm, algorithm))
    throw new Error("CRL signature algorithms");
  offset = expect(read(innerAlgorithm.end, tbs.end), 48).end; // issuer
  const date = (node: DerNode) => {
    if (![23, 24].includes(node.tag) || node.end - node.content > 20)
      throw new Error("CRL time");
    return node;
  };
  offset = date(read(offset, tbs.end)).end;
  if (offset < tbs.end && [23, 24].includes(bytes[offset]))
    offset = date(read(offset, tbs.end)).end;
  const prefixEnd = offset;
  let revoked = false,
    entries: DerNode | undefined;
  const target = serialNumber.toLowerCase().replace(/^0+/, "") || "0";
  if (offset < tbs.end && bytes[offset] === 48) {
    entries = read(offset, tbs.end);
    let entryOffset = entries.content;
    while (entryOffset < entries.end) {
      const entry = expect(read(entryOffset, entries.end), 48),
        serial = expect(read(entry.content, entry.end), 2);
      if (
        serial.end === serial.content ||
        serial.end - serial.content > 21 ||
        bytes[serial.content] & 128
      )
        throw new Error("CRL serial");
      let normalized = "";
      for (let i = serial.content; i < serial.end; i++)
        normalized += bytes[i].toString(16).padStart(2, "0");
      if ((normalized.replace(/^0+/, "") || "0") === target) revoked = true;
      const revokedAt = date(read(serial.end, entry.end));
      let end = revokedAt.end;
      if (end < entry.end) {
        const extensions = expect(read(end, entry.end), 48);
        let cursor = extensions.content;
        while (cursor < extensions.end) {
          const extension = expect(read(cursor, extensions.end), 48),
            oid = expect(read(extension.content, extension.end), 6);
          if (oid.end - oid.content > 32)
            throw new Error("CRL entry extension");
          // certificateIssuer is an indirect-CRL feature, unsupported even if a
          // malformed list omits the issuingDistributionPoint declaration.
          if (
            oid.end - oid.content === 3 &&
            bytes[oid.content] === 85 &&
            bytes[oid.content + 1] === 29 &&
            bytes[oid.content + 2] === 29
          )
            throw new Error("Indirect CRL");
          let valueOffset = oid.end;
          if (bytes[valueOffset] === 1) {
            const critical = read(valueOffset, extension.end);
            if (
              critical.end - critical.content !== 1 ||
              ![0, 255].includes(bytes[critical.content])
            )
              throw new Error("CRL boolean");
            if (bytes[critical.content] !== 0)
              throw new Error("Critical CRL entry extension");
            valueOffset = critical.end;
          }
          const value = expect(read(valueOffset, extension.end), 4);
          if (value.end !== extension.end)
            throw new Error("CRL entry extension");
          cursor = extension.end;
        }
        end = extensions.end;
      }
      if (end !== entry.end) throw new Error("CRL entry");
      entryOffset = entry.end;
    }
    offset = entries.end;
  }
  if (offset < tbs.end) {
    const extensions = expect(read(offset, tbs.end), 160);
    if (extensions.end - extensions.content > 64000)
      throw new Error("CRL extensions");
    offset = extensions.end;
  }
  if (offset !== tbs.end) throw new Error("CRL content");
  const sequence = (parts: Uint8Array[]) => {
    const size = parts.reduce((n, p) => n + p.length, 0),
      length: number[] = [];
    let value = size;
    if (size < 128) length.push(size);
    else {
      while (value) {
        length.unshift(value & 255);
        value = Math.floor(value / 256);
      }
      length.unshift(128 | length.length);
    }
    const result = new Uint8Array(1 + length.length + size);
    result[0] = 48;
    result.set(length, 1);
    let cursor = 1 + length.length;
    for (const part of parts) {
      result.set(part, cursor);
      cursor += part.length;
    }
    return result;
  };
  const compactTbs = sequence([
    bytes.subarray(tbs.content, prefixEnd),
    bytes.subarray(entries?.end ?? prefixEnd, tbs.end),
  ]);
  return {
    compact: sequence([compactTbs, bytes.subarray(algorithm.start, outer.end)]),
    tbs: bytes.subarray(tbs.start, tbs.end),
    revoked,
  };
}

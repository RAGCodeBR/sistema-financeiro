import { generateKeyPairSync } from 'node:crypto';
import forge from 'node-forge';

function keys() {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs1', format: 'pem' } });
  return { publicKey: forge.pki.publicKeyFromPem(pair.publicKey), privateKey: forge.pki.privateKeyFromPem(pair.privateKey) };
}
const rootKeys = keys(), leafKeys = keys(), intermediateKeys = keys();
const root = forge.pki.createCertificate();
root.publicKey = rootKeys.publicKey; root.serialNumber = '01';
root.validity.notBefore = new Date('2020-01-01'); root.validity.notAfter = new Date('2040-01-01');
root.setSubject([{ name: 'commonName', value: 'SYNTHETIC ROOT - TEST ONLY' }]); root.setIssuer(root.subject.attributes);
root.setExtensions([{ name: 'basicConstraints', cA: true, critical: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }]);
root.sign(rootKeys.privateKey, forge.md.sha256.create());
export const rootPem = forge.pki.certificateToPem(root);
const intermediate = forge.pki.createCertificate();
intermediate.publicKey = intermediateKeys.publicKey; intermediate.serialNumber = '03';
intermediate.validity.notBefore = new Date('2020-01-01'); intermediate.validity.notAfter = new Date('2035-01-01');
intermediate.setSubject([{name:'commonName',value:'SYNTHETIC INTERMEDIATE - TEST ONLY'}]); intermediate.setIssuer(root.subject.attributes);
intermediate.setExtensions([{name:'basicConstraints',cA:true,critical:true},{name:'keyUsage',keyCertSign:true,cRLSign:true,critical:true}]);
intermediate.sign(rootKeys.privateKey,forge.md.sha256.create());
const otherRoot = forge.pki.createCertificate();
otherRoot.publicKey=intermediateKeys.publicKey; otherRoot.serialNumber='04';
otherRoot.validity.notBefore=new Date('2020-01-01');otherRoot.validity.notAfter=new Date('2040-01-01');
otherRoot.setSubject([{name:'commonName',value:'UNTRUSTED SYNTHETIC ROOT - TEST ONLY'}]);otherRoot.setIssuer(otherRoot.subject.attributes);
otherRoot.setExtensions([{name:'basicConstraints',cA:true,critical:true},{name:'keyUsage',keyCertSign:true,cRLSign:true,critical:true}]);
otherRoot.sign(intermediateKeys.privateKey,forge.md.sha256.create());
export const untrustedRootPem=forge.pki.certificateToPem(otherRoot);
export const testCnpj = '60371448000143';
export const testPassword = 'synthetic-password-do-not-log';

export function certificateFixture(options = {}) {
  const cert = forge.pki.createCertificate(); cert.publicKey = leafKeys.publicKey; cert.serialNumber = '02';
  cert.validity.notBefore = new Date(options.notBefore || '2025-01-01'); cert.validity.notAfter = new Date(options.notAfter || '2030-01-01');
  cert.setSubject([{ name: 'commonName', value: 'SYNTHETIC COMPANY - TEST ONLY' }]); cert.setIssuer(options.intermediate ? intermediate.subject.attributes : root.subject.attributes);
  const asn = forge.asn1, U = asn.Class.UNIVERSAL, C = asn.Class.CONTEXT_SPECIFIC, T = asn.Type;
  const san = asn.create(U,T.SEQUENCE,true,[asn.create(C,0,true,[asn.create(U,T.OID,false,asn.oidToDer('2.16.76.1.3.3').getBytes()),asn.create(C,0,true,[asn.create(U,T.UTF8,false,options.cnpj || testCnpj)])])]);
  const policies = asn.create(U,T.SEQUENCE,true,[asn.create(U,T.SEQUENCE,true,[asn.create(U,T.OID,false,asn.oidToDer(options.policy || '2.16.76.1.2.1.99999').getBytes())])]);
  cert.setExtensions([
    { name: 'basicConstraints', cA: Boolean(options.ca) },
    { name: 'keyUsage', digitalSignature: options.digitalSignature !== false, critical: true },
    { name: 'extKeyUsage', clientAuth: options.clientAuth !== false },
    ...(options.noCnpj ? [] : [{ id: '2.5.29.17', value: asn.toDer(san).getBytes() }]),
    { id: '2.5.29.32', value: asn.toDer(policies).getBytes() },
  ]);
  cert.sign(options.intermediate ? intermediateKeys.privateKey : rootKeys.privateKey, options.sha1 ? forge.md.sha1.create() : forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(options.noKey ? null : options.mismatchedKey ? intermediateKeys.privateKey : leafKeys.privateKey, options.intermediate ? [root,cert,intermediate] : [cert,root], testPassword, { algorithm: options.algorithm || 'aes256', count: 2048 });
  return { bytes: new Uint8Array(Buffer.from(asn.toDer(p12).getBytes(), 'binary')), asn: p12, rootPem, cert };
}

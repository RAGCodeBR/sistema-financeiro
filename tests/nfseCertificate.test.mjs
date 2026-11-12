import assert from 'node:assert/strict';
import { test } from 'node:test';
import forge from 'node-forge';
import { CertificateError, base64, fromBase64, sealCertificate, openCertificate } from '../supabase/functions/_shared/nfse-certificate/crypto.ts';
import { validateCertificate, MAX_CERTIFICATE_BYTES } from '../supabase/functions/_shared/nfse-certificate/validate.ts';
import { createCertificateHandler } from '../supabase/functions/_shared/nfse-certificate/handler.ts';
import { certificateFixture, rootPem, untrustedRootPem, testCnpj, testPassword } from './helpers/nfseCertificateFixtures.mjs';

const fixture = certificateFixture();
const validate = (bytes = fixture.bytes, password = testPassword, issuer = testCnpj, roots = rootPem) => validateCertificate(forge,bytes,password,issuer,roots);
const code = expected => error => error instanceof CertificateError && error.code === expected;

test('A1 validates the private key, ICP CNPJ, policy, dates and pinned chain; never claims revocation or fiscal readiness', () => {
  const result = validate();
  assert.equal(result.metadata.cnpj,testCnpj); assert.equal(result.metadata.chainVerified,true);
  assert.equal(result.metadata.revocationStatus,'not_checked'); assert.equal(result.metadata.fiscalReady,false);
  assert.match(result.secret.privateKeyPem,/BEGIN RSA PRIVATE KEY/); assert.equal('password' in result.secret,false);
});
test('A1 supports password-protected legacy 3DES containers', () => assert.equal(validate(certificateFixture({ algorithm:'3des' }).bytes).metadata.cnpj,testCnpj));
test('A1 builds and verifies an unordered chain through an intermediate CA', () => {
  const result=validate(certificateFixture({intermediate:true}).bytes);
  assert.equal(result.metadata.chainVerified,true); assert.equal(result.secret.chainPem.length,1);
});
test('A1 rejects a wrong password and malformed or oversized files without leaking parser contents', () => {
  assert.throws(() => validate(fixture.bytes,'WRONG-PASSWORD'),code('INVALID_PFX'));
  assert.throws(() => validate(new Uint8Array([1,2,3])),code('INVALID_PFX'));
  assert.throws(() => validate(new Uint8Array(MAX_CERTIFICATE_BYTES + 1)),code('FILE_SIZE'));
  const noMac=forge.asn1.fromDer(Buffer.from(fixture.bytes).toString('binary'));noMac.value.pop();
  assert.throws(()=>validate(new Uint8Array(Buffer.from(forge.asn1.toDer(noMac).getBytes(),'binary'))),code('INVALID_PFX'));
  assert.throws(()=>validate(certificateFixture({mismatchedKey:true}).bytes),code('KEY_MISMATCH'));
});
test('A1 rejects expiry, future validity, a different CNPJ and missing ICP CNPJ', () => {
  assert.throws(() => validate(certificateFixture({ notAfter:'2021-01-01' }).bytes),code('EXPIRED'));
  assert.throws(() => validate(certificateFixture({ notBefore:'2035-01-01',notAfter:'2036-01-01' }).bytes),code('NOT_YET_VALID'));
  assert.throws(() => validate(fixture.bytes,testPassword,'12345678000190'),code('CNPJ_MISMATCH'));
  assert.throws(() => validate(certificateFixture({ noCnpj:true }).bytes),code('MISSING_CNPJ'));
});
test('A1 rejects A3 policies, missing signing/client-auth usages, CA leafs, weak signature algorithms and containers without a key', () => {
  for (const [options,expected] of [[{policy:'2.16.76.1.2.3.99999'},'NOT_A1'],[{digitalSignature:false},'KEY_USAGE'],[{clientAuth:false},'KEY_USAGE'],[{ca:true},'NOT_LEAF'],[{sha1:true},'SIGNATURE_ALGORITHM'],[{noKey:true},'PRIVATE_KEY']]) assert.throws(() => validate(certificateFixture(options).bytes),code(expected));
});
test('A1 never trusts roots supplied inside the PFX or accepts unconfigured trust', () => {
  assert.throws(() => validate(fixture.bytes,testPassword,testCnpj,''),code('NOT_CONFIGURED'));
  // A valid PEM leaf is not an acceptable root configuration.
  assert.throws(() => validate(fixture.bytes,testPassword,testCnpj,forge.pki.certificateToPem(fixture.cert)),code('NOT_CONFIGURED'));
  assert.throws(() => validate(fixture.bytes,testPassword,testCnpj,untrustedRootPem),code('UNTRUSTED_CHAIN'));
});
test('A1 caps password derivation work before running the MAC', () => {
  const pfx = forge.asn1.fromDer(Buffer.from(fixture.bytes).toString('binary'));
  pfx.value[2].value[2].value = forge.asn1.integerToDer(100001).getBytes();
  assert.throws(() => validate(new Uint8Array(Buffer.from(forge.asn1.toDer(pfx).getBytes(),'binary'))),code('UNSUPPORTED_PFX'));
});
test('AES-GCM custody uses random nonces, authenticates issuer/id/key version, supports old key IDs and rejects tampering', async () => {
  const key = crypto.getRandomValues(new Uint8Array(32)); const keys = { v1:base64(key) }, id = crypto.randomUUID();
  const a = await sealCertificate({ privateKey:'SENSITIVE',password:'NEVER-STORE-THIS' },testCnpj,id,'v1',key);
  const b = await sealCertificate({ privateKey:'SENSITIVE' },testCnpj,id,'v1',key);
  assert.notEqual(a.iv,b.iv); assert.ok(!JSON.stringify(a).includes('SENSITIVE'));
  assert.equal((await openCertificate(a,testCnpj,id,{...keys,v2:base64(crypto.getRandomValues(new Uint8Array(32)))})).privateKey,'SENSITIVE');
  await assert.rejects(openCertificate(a,'12345678000190',id,keys));
  await assert.rejects(openCertificate(a,testCnpj,crypto.randomUUID(),keys));
  const bytes = fromBase64(a.ciphertext); bytes[0] ^= 1;
  await assert.rejects(openCertificate({...a,ciphertext:base64(bytes)},testCnpj,id,keys));
});

const origin = 'https://ragcodebr.github.io', actor = { id:'11111111-1111-4111-8111-111111111111',role:'master',allowedUnits:[],hiddenScreens:[] };
function harness(options = {}) {
  let current = null; const calls = [];
  const handler = createCertificateHandler({
    forge,
    config:{ issuerCnpj:testCnpj,rootsPem:rootPem,keyId:'v1',keys:{v1:base64(crypto.getRandomValues(new Uint8Array(32)))},origins:[origin],...options.config },
    authenticate:async token => token === 'valid' ? {...actor,...options.actor} : null,
    rpc:async (name,params) => {
      calls.push({name,params});
      if(options.failRpc) throw new Error('RAW-DATABASE-SECRET');
      if(name === 'nfse_certificate_attempt') return options.rateLimit !== true;
      if(name === 'nfse_certificate_status') return current;
      if(name === 'nfse_certificate_save') { current={id:params.p_id,...params.p_metadata}; return; }
      if(name === 'nfse_certificate_remove') { current=null; return; }
    },
  });
  const request = (method = 'GET', body, extra = {}) => new Request('https://example.test/nfse-certificate',{method,headers:{origin,authorization:'Bearer valid',...extra},...(body ? {body} : {})});
  const upload = (bytes = fixture.bytes, password = testPassword, expectedId = null) => {
    const form = new FormData(); form.set('file',new File([bytes],'company.pfx')); form.set('password',password); if(expectedId) form.set('expectedId',expectedId);
    return request('POST',form);
  };
  return {handler,calls,request,upload};
}
test('HTTP denies foreign origins, anonymous users, hidden operators and operator writes before parsing any PFX', async () => {
  const h = harness();
  assert.equal((await h.handler(h.request('GET',null,{origin:'https://evil.test'}))).status,403);
  assert.equal((await h.handler(h.request('GET',null,{authorization:'Bearer invalid'}))).status,401);
  assert.equal((await harness({actor:{role:'operador'}}).handler(h.upload())).status,403);
  assert.equal((await harness({actor:{role:'operador',allowedUnits:['__income_write__'],hiddenScreens:['nfse']}}).handler(h.request())).status,403);
  assert.equal(h.calls.length,0);
});
test('HTTP exposes only safe status and stays closed without encryption or trust configuration', async () => {
  const h = harness({config:{keys:{}}}); const status=await h.handler(h.request());
  assert.equal((await status.json()).configured,false); assert.equal(status.headers.get('cache-control'),'no-store');
  assert.equal((await h.handler(h.upload())).status,503);
  assert.equal(h.calls.some(call => call.name === 'nfse_certificate_save'),false);
});
test('HTTP enforces shared rate limits and both declared and streamed body size', async () => {
  const limited=harness({rateLimit:true}); assert.equal((await limited.handler(limited.upload())).status,429);
  const h=harness(); assert.equal((await h.handler(h.request('POST','x',{'content-type':'multipart/form-data; boundary=test','content-length':'99999999'}))).status,413);
  assert.equal((await h.handler(h.request('POST','x'.repeat(MAX_CERTIFICATE_BYTES+20000),{'content-type':'multipart/form-data; boundary=test'}))).status,413);
});
test('HTTP encrypts custody, never returns passwords or private material, requires explicit replacement, and supports removal', async () => {
  const h=harness(); const response=await h.handler(h.upload()); assert.equal(response.status,201);
  const body=await response.text(); assert.ok(!body.includes(testPassword)); assert.ok(!body.includes('PRIVATE KEY')); assert.ok(!body.includes('ciphertext'));
  const certificate=JSON.parse(body).certificate;
  const saved=h.calls.find(call => call.name==='nfse_certificate_save').params;
  assert.equal(saved.p_envelope.version,1); assert.ok(!JSON.stringify(saved).includes(testPassword)); assert.ok(!JSON.stringify(saved).includes('PRIVATE KEY'));
  assert.equal((await h.handler(h.upload())).status,409);
  const replaced=await h.handler(h.upload(fixture.bytes,testPassword,certificate.id)); assert.equal(replaced.status,201);
  const next=(await replaced.json()).certificate;
  const removed=await h.handler(h.request('DELETE',JSON.stringify({expectedId:next.id}),{'content-type':'application/json'})); assert.equal(removed.status,200);
});
test('HTTP reports validation rejection with code-only audit and redacts infrastructure errors', async () => {
  const h=harness(); const response=await h.handler(h.upload(fixture.bytes,'INVALID-SECRET')); assert.equal(response.status,422);
  assert.ok(!JSON.stringify(h.calls).includes('INVALID-SECRET'));
  assert.equal(h.calls.at(-1).params.p_reason_code,'INVALID_PFX');
  const broken=harness({failRpc:true}); const result=await broken.handler(broken.request());
  assert.equal(result.status,503); assert.ok(!(await result.text()).includes('RAW-DATABASE-SECRET'));
});

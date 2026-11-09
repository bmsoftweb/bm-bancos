/**
 * Certificado digital A1 (.pfx / .p12).
 *
 * O arquivo é aberto com node-forge e convertido para PEM. Isso resolve dois
 * problemas de uma vez: o OpenSSL 3 embutido no Node recusa PFX cifrado com
 * RC2-40 (o que a maioria das ACs brasileiras ainda usa), e a chave/certificado
 * em PEM servem tanto para o TLS mútuo quanto para a assinatura XMLDSig.
 *
 * Equivale à aba "Certificado" do exemplo Delphi — sem depender do repositório
 * de certificados do Windows nem de biblioteca externa.
 */
import forge from 'node-forge';

export interface CertificadoCarregado {
  /** Chave privada em PEM (PKCS#8 / PKCS#1) */
  chavePrivadaPem: string;
  /** Certificado do titular em PEM */
  certificadoPem: string;
  /** Certificado do titular em base64, sem cabeçalho — vai dentro do <X509Certificate> */
  certificadoBase64: string;
  /** Cadeia de certificação (emissores), em PEM */
  cadeiaPem: string[];
  info: InfoCertificado;
}

export interface InfoCertificado {
  razaoSocial: string;
  cnpj: string;
  numeroSerie: string;
  emissor: string;
  validoDe: Date;
  validoAte: Date;
  /** Dias que faltam para o vencimento; negativo quando já venceu */
  diasParaVencer: number;
}

/** OID do CNPJ dentro do otherName da extensão subjectAltName (padrão ICP-Brasil) */
const OID_CNPJ_ICP = '2.16.76.1.3.3';

function texto(atributos: any[], nome: string): string {
  const attr = atributos.find((a) => a.name === nome || a.shortName === nome);
  return attr ? String(attr.value) : '';
}

/**
 * Procura o CNPJ do titular. A ICP-Brasil grava em subjectAltName/otherName, mas
 * muitos certificados também repetem o número no fim do CN ("EMPRESA LTDA:12345678000199").
 */
function extrairCnpj(cert: forge.pki.Certificate, commonName: string): string {
  const alt: any = cert.getExtension('subjectAltName');
  if (alt?.altNames) {
    for (const an of alt.altNames as any[]) {
      // type 0 = otherName
      if (an.type === 0 && typeof an.value === 'string') {
        // O valor carrega 8 dígitos de data de nascimento + CPF + ... + CNPJ ao final
        const digitos = an.value.replace(/\D/g, '');
        if (an.oid === OID_CNPJ_ICP && digitos.length >= 14) return digitos.slice(-14);
      }
    }
  }

  const noCn = commonName.replace(/\D/g, '');
  return noCn.length >= 14 ? noCn.slice(-14) : '';
}

/**
 * @param senha senha do arquivo .pfx
 * @throws quando a senha está errada ou o arquivo não é um PKCS#12 válido
 */
export function carregarPfx(pfx: Buffer, senha: string): CertificadoCarregado {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/mac|invalid password|integrity/i.test(msg)) {
      throw new Error('Senha do certificado incorreta.');
    }
    throw new Error(`Não foi possível ler o certificado (.pfx): ${msg}`);
  }

  // Chave privada
  const bagsChave = {
    ...p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag }),
    ...p12.getBags({ bagType: forge.pki.oids.keyBag }),
  };
  const bagChave = (Object.values(bagsChave).flat() as any[]).find((b) => b?.key);
  if (!bagChave) throw new Error('O arquivo não contém a chave privada (certificado A1?).');

  const chavePrivadaPem = forge.pki.privateKeyToPem(bagChave.key);

  // Certificados: o do titular é o único que combina com a chave privada
  const bagsCert = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certs = (Object.values(bagsCert).flat() as any[])
    .map((b) => b?.cert)
    .filter(Boolean) as forge.pki.Certificate[];

  if (!certs.length) throw new Error('O arquivo não contém nenhum certificado.');

  const modulo = (bagChave.key as any).n?.toString(16);
  const titular =
    certs.find((c) => (c.publicKey as any)?.n?.toString(16) === modulo) || certs[0];
  const cadeia = certs.filter((c) => c !== titular);

  const commonName = texto(titular.subject.attributes, 'commonName');
  const certificadoPem = forge.pki.certificateToPem(titular);

  const hoje = new Date();
  const diasParaVencer = Math.floor(
    (titular.validity.notAfter.getTime() - hoje.getTime()) / 86_400_000,
  );

  return {
    chavePrivadaPem,
    certificadoPem,
    certificadoBase64: certificadoPem
      .replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
      .replace(/\s+/g, ''),
    cadeiaPem: cadeia.map((c) => forge.pki.certificateToPem(c)),
    info: {
      razaoSocial: commonName.replace(/:\d+$/, '').trim(),
      cnpj: extrairCnpj(titular, commonName),
      numeroSerie: (titular.serialNumber || '').toUpperCase(),
      emissor:
        texto(titular.issuer.attributes, 'commonName') ||
        texto(titular.issuer.attributes, 'organizationName'),
      validoDe: titular.validity.notBefore,
      validoAte: titular.validity.notAfter,
      diasParaVencer,
    },
  };
}
